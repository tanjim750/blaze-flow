"use client";

import { useEffect, useRef, useState } from "react";

/*
 * Hero background: "light table". A tiny WebGL fragment shader draws slow, soft violet light
 * moving through a dark field, as if a projector's light were spilling across the desk behind
 * the product window. It is rendered at about 1/6 of the screen size and stretched by CSS, so
 * the browser's own smoothing does the softening (no CSS blur filter, almost no GPU cost).
 *
 * Colours are read from the app tokens (--bf-canvas, --bf-brand) at runtime.
 * Budget: at most 30 fps, paused when off screen or the tab is hidden, stops after the
 * first frame for reduced motion. Phones, Data Saver, low-memory devices and browsers without
 * WebGL get a static CSS version of the same light (`data-mode="static"`).
 */

const VERT = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform vec3 bg;uniform vec3 hi;uniform float s;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<4;k++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/r; vec2 q=vec2(uv.x*r.x/r.y,uv.y);
 float T=t*.035;
 vec2 w=vec2(fbm(q*1.6+vec2(T,-T*.6)),fbm(q*1.6+vec2(-T*.8,T)+4.3));
 float f=fbm(q*1.2+w*1.4+vec2(0.,s*.6));
 float bands=.5+.5*sin((q.y+w.x*.35)*9.-T*6.);
 float light=smoothstep(.38,.9,f)*(.75+.25*bands);
 vec2 c=uv-vec2(.5,.36+s*.25);
 float mask=exp(-dot(c*vec2(.9,1.6),c*vec2(.9,1.6))*2.6);
 float top=smoothstep(1.,.55,uv.y);
 float glow=.10*mask;
 vec3 col=mix(bg,hi,clamp(light*mask*top*.55+glow*top,0.,.5));
 gl_FragColor=vec4(col,1.);
}`;

/** Resolve any CSS colour (including oklch) to linear-ish 0..1 RGB via a 1px 2D canvas. */
function tokenRgb(name: string, fallback: [number, number, number]): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const c = document.createElement("canvas"); c.width = c.height = 1;
  const x = c.getContext("2d");
  if (!value || !x) return fallback;
  x.fillStyle = value; x.fillRect(0, 0, 1, 1);
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
  return [r / 255, g / 255, b / 255];
}

function lowPower(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
  return !!nav.connection?.saveData || (nav.deviceMemory ?? 8) < 4 || window.matchMedia("(max-width: 699px)").matches;
}

export function ProHeroBg() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"static" | "live">("static");

  const start = (): (() => void) => {
    const el = canvas.current, box = wrap.current;
    if (!el || !box || lowPower()) return () => {};
    const gl = el.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false });
    if (!gl) return () => {};
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (k: string) => gl.getUniformLocation(prog, k);
    gl.uniform3fv(u("bg"), tokenRgb("--bf-canvas", [0.05, 0.05, 0.06]));
    gl.uniform3fv(u("hi"), tokenRgb("--bf-brand", [0.55, 0.42, 1]));
    const uR = u("r"), uT = u("t"), uS = u("s");

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const SCALE = 1 / 6;
    const resize = () => {
      const w = Math.max(16, Math.round(box.clientWidth * SCALE)), h = Math.max(16, Math.round(box.clientHeight * SCALE));
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; gl.viewport(0, 0, w, h); gl.uniform2f(uR, w, h); }
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(box);

    const start = performance.now();
    let raf = 0, last = 0, visible = true;
    const draw = (now: number) => {
      gl.uniform1f(uT, (now - start) / 1000 + 20);
      gl.uniform1f(uS, Math.min(1, window.scrollY / Math.max(1, box.clientHeight)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const loop = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || reduce.matches) return;
      if (now - last >= 33) { last = now; draw(now); }
      raf = requestAnimationFrame(loop);
    };
    const kick = () => { draw(performance.now()); if (!raf && visible && !document.hidden && !reduce.matches) raf = requestAnimationFrame(loop); };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; kick(); });
    io.observe(box);
    document.addEventListener("visibilitychange", kick);
    reduce.addEventListener?.("change", kick);
    setMode("live");
    kick();
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", kick); reduce.removeEventListener?.("change", kick); };
  };

  useEffect(() => {
    // Start after the page is idle so the shader never competes with the first paint.
    let cleanup = () => {};
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => { cleanup = start(); }, { timeout: 1500 }) : window.setTimeout(() => { cleanup = start(); }, 600);
    return () => { if (w.cancelIdleCallback) w.cancelIdleCallback(id); else clearTimeout(id); cleanup(); };
  }, []);


  return (
    <div ref={wrap} className="pro-hero-bg" data-mode={mode} aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
