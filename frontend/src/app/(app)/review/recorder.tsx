"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Circle, Mic, MonitorSmartphone, Square, Trash2, Video } from "lucide-react";
import type { RecordedClip } from "./writer";

/**
 * Voice and screen feedback, captured in the browser.
 *
 * These are real recordings, not a mock: `MediaRecorder` produces a blob, and for a cut
 * with a project review record the blob is uploaded as an attachment on the note that
 * carries it (see `attachRecording` in `writer.ts`). The API needed no new endpoint —
 * a review comment already accepts arbitrary files, and the attachment's mime type is
 * enough to decide whether it plays back as audio or video.
 *
 * Capture needs a real device and a user gesture, so nothing here can run in a headless
 * browser; every failure path therefore reports what the browser said rather than
 * silently producing an empty clip.
 */

export type CaptureMode = "voice" | "screen" | "camera" | "camera-screen";

const MODES: { mode: CaptureMode; icon: typeof Mic; label: string; hint: string }[] = [
  { mode: "voice", icon: Mic, label: "Voice", hint: "Microphone only" },
  { mode: "screen", icon: MonitorSmartphone, label: "Screen", hint: "Screen and microphone" },
  { mode: "camera", icon: Camera, label: "Camera", hint: "Camera and microphone" },
  { mode: "camera-screen", icon: Video, label: "Camera + screen", hint: "Screen with a camera inset" },
];

const pickMimeType = (candidates: string[]) =>
  candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) ?? "";

export function Recorder({ onClip, disabled }: { onClip: (clip: RecordedClip) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<CaptureMode | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const tracks = useRef<MediaStreamTrack[]>([]);
  const stopCompositing = useRef<(() => void) | null>(null);

  const releaseDevices = useCallback(() => {
    tracks.current.forEach((track) => track.stop());
    tracks.current = [];
    stopCompositing.current?.();
    stopCompositing.current = null;
  }, []);

  // A live capture and a blob URL both outlive this component unless they are released.
  useEffect(() => () => {
    releaseDevices();
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, [releaseDevices]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - started), 200);
    return () => clearInterval(timer);
  }, [recording]);

  const discard = useCallback(() => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
    setElapsed(0);
  }, [clip]);

  const start = useCallback(async (next: CaptureMode) => {
    setError(null);
    discard();
    try {
      const { stream, extra, cleanup } = await capture(next);
      tracks.current = [...stream.getTracks(), ...extra];
      stopCompositing.current = cleanup;
      const startedAt = Date.now();
      const isVoice = next === "voice";
      const mimeType = pickMimeType(isVoice
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        : ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]);
      const instance = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: BlobPart[] = [];
      instance.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      instance.onstop = () => {
        const type = instance.mimeType || mimeType || (isVoice ? "audio/webm" : "video/webm");
        const blob = new Blob(chunks, { type });
        releaseDevices();
        setRecording(false);
        if (!blob.size) { setError("The recording came back empty, so nothing was captured."); return; }
        setClip({ blob, url: URL.createObjectURL(blob), mimeType: type, kind: isVoice ? "voice" : "screen", durationMs: Date.now() - startedAt });
      };
      // A display capture ends when the viewer presses the browser's own "Stop sharing".
      stream.getVideoTracks().forEach((track) => { track.onended = () => { if (instance.state === "recording") instance.stop(); }; });
      recorder.current = instance;
      instance.start();
      setMode(next);
      setElapsed(0);
      setRecording(true);
    } catch (cause) {
      releaseDevices();
      setRecording(false);
      setError(cause instanceof Error && cause.name === "NotAllowedError"
        ? "Blaze Flow was not given permission to record."
        : cause instanceof Error ? cause.message : "Recording could not be started.");
    }
  }, [discard, releaseDevices]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  if (clip) {
    return (
      <div className="rvr rvr-preview">
        {clip.kind === "voice"
          ? <audio src={clip.url} controls />
          : <video src={clip.url} controls playsInline />}
        <div>
          <span>{clip.kind === "voice" ? "Voice comment" : "Screen recording"} · {seconds(clip.durationMs)}</span>
          <button type="button" onClick={discard} aria-label="Discard recording"><Trash2 />Discard</button>
          <button type="button" className="rvr-attach" onClick={() => { onClip(clip); setClip(null); setElapsed(0); }}>Attach to comment</button>
        </div>
      </div>
    );
  }

  if (recording) {
    return (
      <div className="rvr rvr-live" role="status">
        <i aria-hidden="true" />
        <span>Recording {MODES.find((item) => item.mode === mode)?.label.toLowerCase()} · {seconds(elapsed)}</span>
        <button type="button" onClick={stop}><Square fill="currentColor" />Stop</button>
      </div>
    );
  }

  return (
    <div className="rvr">
      <div className="rvr-modes" role="group" aria-label="Record feedback">
        {MODES.map(({ mode: value, icon: Icon, label, hint }) => (
          <button key={value} type="button" disabled={disabled} title={hint} onClick={() => void start(value)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
        <Circle className="rvr-dot" aria-hidden="true" />
      </div>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

const seconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/**
 * Acquires the tracks for a capture mode.
 *
 * `camera-screen` is the only one that cannot be handed to `MediaRecorder` directly: two
 * video tracks cannot be recorded into one file, so the screen and the camera are drawn
 * onto a canvas each frame and the canvas's own stream is recorded instead. `extra` holds
 * the source tracks so the caller can stop them, since they are no longer reachable
 * through the returned stream, and `cleanup` cancels the draw loop — without it the
 * compositing keeps running for the life of the page once a recording ends.
 */
type Capture = { stream: MediaStream; extra: MediaStreamTrack[]; cleanup: (() => void) | null };

async function capture(mode: CaptureMode): Promise<Capture> {
  if (mode === "voice") return { stream: await navigator.mediaDevices.getUserMedia({ audio: true }), extra: [], cleanup: null };
  if (mode === "camera") return { stream: await navigator.mediaDevices.getUserMedia({ video: true, audio: true }), extra: [], cleanup: null };

  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);

  if (mode === "screen") {
    microphone?.getAudioTracks().forEach((track) => display.addTrack(track));
    return { stream: display, extra: microphone?.getTracks() ?? [], cleanup: null };
  }

  const camera = await navigator.mediaDevices.getUserMedia({ video: true });
  const screenVideo = await play(display);
  const cameraVideo = await play(camera);
  const canvas = document.createElement("canvas");
  canvas.width = screenVideo.videoWidth || 1280;
  canvas.height = screenVideo.videoHeight || 720;
  const context = canvas.getContext("2d")!;
  const inset = Math.round(canvas.width / 5);
  let frame = 0;
  const draw = () => {
    context.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
    context.drawImage(cameraVideo, canvas.width - inset - 24, canvas.height - inset - 24, inset, inset);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  const composed = canvas.captureStream(30);
  [...(microphone?.getAudioTracks() ?? []), ...display.getAudioTracks()].forEach((track) => composed.addTrack(track));
  return {
    stream: composed,
    extra: [...display.getTracks(), ...camera.getTracks(), ...(microphone?.getTracks() ?? [])],
    cleanup: () => cancelAnimationFrame(frame),
  };
}

function play(stream: MediaStream): Promise<HTMLVideoElement> {
  const element = document.createElement("video");
  element.srcObject = stream;
  element.muted = true;
  element.playsInline = true;
  return element.play().then(() => element);
}
