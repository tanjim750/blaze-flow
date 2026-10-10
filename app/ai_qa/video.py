"""Video side of AI Visual QA: probe, sample frames with exact timestamps, track findings.

Sampling (two ffmpeg decode passes, timestamps read from `showinfo`, never assumed fps):

1. **Baseline + scene changes**: one frame every ``BASE_INTERVAL`` seconds, plus any frame
   whose scene score exceeds ``SCENE_THRESHOLD``.
2. **Densify**: between neighbouring samples whose text differs (a title appearing,
   moving, fading or changing), re-sample every ``DENSE_INTERVAL`` seconds, so start/end
   times are tighter and brief text is less likely to slip between baseline samples.

Near-identical frames (under ``AI_QA_DUP_MAX_CHANGED`` of a small greyscale copy changed) reuse the previous frame's OCR
instead of running it again. ffmpeg auto-rotates, so frames and boxes are in the displayed
orientation. Times are relative to the original upload's timeline (`pts_time`).
"""
import json
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings

from .spelling import normalize

BASE_INTERVAL = 0.5
DENSE_INTERVAL = 0.125
SCENE_THRESHOLD = 0.3
MERGE_GAP_MS = 1200
PTS_RE = re.compile(r'pts_time:\s*([0-9.]+)')


class VideoError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _tool(name):
    path = shutil.which(name)
    if not path:
        raise VideoError('ai_qa_no_ffmpeg', 'Video checks need ffmpeg on the worker.')
    return path


def probe(path):
    """Duration (ms), display width/height and frame rate, from ffprobe."""
    result = subprocess.run(
        [_tool(settings.FFPROBE_COMMAND), '-v', 'error', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration',
         '-of', 'json', str(path)],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise VideoError('ai_qa_unreadable_video', 'This video could not be read.')
    data = json.loads(result.stdout or '{}')
    streams = data.get('streams') or []
    if not streams:
        raise VideoError('ai_qa_unreadable_video', 'This file has no video stream.')
    stream = streams[0]
    try:
        duration_ms = int(float(data.get('format', {}).get('duration') or 0) * 1000)
    except ValueError:
        duration_ms = 0
    rotation = 0
    for side in stream.get('side_data_list') or []:
        rotation = int(float(side.get('rotation', 0) or 0))
    rotation = rotation or int((stream.get('tags') or {}).get('rotate', 0) or 0)
    width, height = int(stream.get('width') or 0), int(stream.get('height') or 0)
    if abs(rotation) % 180 == 90:
        width, height = height, width
    return {'duration_ms': duration_ms, 'width': width, 'height': height,
            'frame_rate': stream.get('avg_frame_rate') or stream.get('r_frame_rate'), 'rotation': rotation}


def _extract(source, outdir, select, *, prefix, max_frames, scale_width):
    outdir.mkdir(parents=True, exist_ok=True)
    vf = f"select='{select}',scale='min({scale_width},iw)':-2,showinfo"
    result = subprocess.run(
        [_tool(settings.FFMPEG_COMMAND), '-hide_banner', '-nostdin', '-v', 'info', '-i', str(source),
         '-an', '-sn', '-vf', vf, '-fps_mode', 'vfr', '-frames:v', str(max_frames),
         '-q:v', '3', str(outdir / f'{prefix}%06d.jpg')],
        capture_output=True, text=True, timeout=settings.AI_QA_FFMPEG_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise VideoError('ai_qa_unreadable_video', 'Frames could not be extracted from this video.')
    times = [float(m.group(1)) for line in result.stderr.splitlines() if 'Parsed_showinfo' in line
             for m in [PTS_RE.search(line)] if m]
    files = sorted(outdir.glob(f'{prefix}*.jpg'))
    return [(round(t * 1000), f) for t, f in zip(times, files)]


def sample_baseline(source, outdir, *, max_frames):
    select = f'isnan(prev_selected_t)+gte(t-prev_selected_t\\,{BASE_INTERVAL})+gt(scene\\,{SCENE_THRESHOLD})'
    return _extract(source, outdir, select, prefix='b', max_frames=max_frames, scale_width=settings.AI_QA_FRAME_WIDTH)


def sample_windows(source, outdir, windows, *, max_frames):
    if not windows or max_frames <= 0:
        return []
    spans = '+'.join(f'between(t\\,{a / 1000:.3f}\\,{b / 1000:.3f})' for a, b in windows)
    select = f'({spans})*(isnan(prev_selected_t)+gte(t-prev_selected_t\\,{DENSE_INTERVAL}))'
    return _extract(source, outdir, select, prefix='d', max_frames=max_frames, scale_width=settings.AI_QA_FRAME_WIDTH)


FINGERPRINT_SIZE = (160, 90)
PIXEL_DELTA = 24


def fingerprint(path):
    """A small greyscale copy of the frame, for near-duplicate checks."""
    from PIL import Image

    with Image.open(path) as image:
        return image.convert('L').resize(FINGERPRINT_SIZE, Image.BILINEAR)


def changed_fraction(a, b):
    """Share of fingerprint pixels that changed noticeably between two frames.

    A whole-frame perceptual hash misses a subtitle appearing on a static shot (a few percent
    of the frame), so this counts local changes instead: a new subtitle lights up hundreds
    of pixels while compression noise stays under the delta.
    """
    from PIL import ImageChops

    histogram = ImageChops.difference(a, b).histogram()
    changed = sum(histogram[PIXEL_DELTA:])
    return changed / (a.size[0] * a.size[1])


def text_signature(lines):
    return frozenset(normalize(line.text) for line in lines if line.text.strip())


def dense_windows(samples, *, limit=200):
    """Gaps between neighbouring baseline samples whose visible text differs."""
    windows = []
    for (t0, sig0), (t1, sig1) in zip(samples, samples[1:]):
        if sig0 != sig1 and (sig0 or sig1) and t1 - t0 > DENSE_INTERVAL * 1000 * 1.5:
            windows.append((t0 + 1, t1 - 1))
    return windows[:limit]


# --------------------------------------------------------------------------- tracking

@dataclass
class Sighting:
    time_ms: int
    candidate: object  # spelling.Candidate


@dataclass
class Track:
    key: str
    category: str
    sightings: list = field(default_factory=list)

    @property
    def start_ms(self):
        return self.sightings[0].time_ms

    @property
    def end_ms(self):
        return self.sightings[-1].time_ms

    @property
    def last_region(self):
        return self.sightings[-1].candidate.region


def _centre(region):
    return region['x'] + region['width'] / 2, region['y'] + region['height'] / 2


def _iou(a, b):
    ax2, ay2 = a['x'] + a['width'], a['y'] + a['height']
    bx2, by2 = b['x'] + b['width'], b['y'] + b['height']
    iw = max(0.0, min(ax2, bx2) - max(a['x'], b['x']))
    ih = max(0.0, min(ay2, by2) - max(a['y'], b['y']))
    inter = iw * ih
    union = a['width'] * a['height'] + b['width'] * b['height'] - inter
    return inter / union if union > 0 else 0.0


def same_place(a, b):
    """Overlapping boxes, or a moving title whose centre drifted only a little."""
    if _iou(a, b) > 0.3:
        return True
    (ax, ay), (bx, by) = _centre(a), _centre(b)
    return abs(ax - bx) < 0.15 and abs(ay - by) < 0.1


def build_tracks(frames):
    """frames: [(time_ms, [Candidate, ...]), ...] in time order -> [Track, ...].

    A sighting joins an open track when its category and normalised word match, it is
    within ``MERGE_GAP_MS`` of the track's last sighting, and it is in the same place (or
    close enough for moving text). Otherwise it starts a new track.
    """
    from difflib import SequenceMatcher

    tracks = []
    for time_ms, candidates in frames:
        for cand in candidates:
            word = normalize(cand.detected_text)
            match = None
            for track in reversed(tracks):
                if time_ms - track.end_ms > MERGE_GAP_MS:
                    continue
                if track.category != cand.category:
                    continue
                if SequenceMatcher(None, track.key, word).ratio() < 0.85:
                    continue
                if same_place(track.last_region, cand.region):
                    match = track
                    break
            if match and match.end_ms != time_ms:
                match.sightings.append(Sighting(time_ms, cand))
            elif match is None:
                tracks.append(Track(key=word, category=cand.category, sightings=[Sighting(time_ms, cand)]))
    return tracks


def visible_frames(track, frame_regions):
    """How many sampled frames inside the track's span had any OCR text where it sits."""
    count = 0
    for time_ms, regions in frame_regions:
        if track.start_ms <= time_ms <= track.end_ms and any(same_place(track.sightings[0].candidate.region, r) for r in regions):
            count += 1
    return max(count, len(track.sightings))
