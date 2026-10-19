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
uniform vec2 r;uniform float t;uniform vec3 bg;uniform vec3 hi;uniform vec3 co;uniform float s;uniform vec2 m;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int k=0;k<4;k++){v+=a*n(p);p=p*2.02+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 vec2 uv=gl_FragCoord.xy/r; float ar=r.x/r.y; vec2 q=vec2(uv.x*ar,uv.y);
 float T=t*.06;
 vec2 mm=(m-.5)*vec2(.18,.12);
 vec2 w=vec2(fbm(q*1.3+vec2(T,-T*.7)+mm),fbm(q*1.3+vec2(-T*.9,T*.8)+4.3-mm));
 float f=fbm(q*1.05+w*1.6+vec2(0.,s*.8));
 float g=fbm(q*.9-w*1.2+vec2(7.1,-T*.5));
 float bands=.5+.5*sin((q.y+w.x*.4)*7.-T*7.);
 float light=smoothstep(.34,.86,f)*(.7+.3*bands);
 float cool=smoothstep(.42,.9,g);
 vec2 c=(uv-vec2(.5+mm.x*.8,.42+s*.3))*vec2(ar*.55,1.);
 float mask=exp(-dot(c,c)*2.3);
 float side=exp(-pow((uv.x-(.16+mm.x)) *2.4,2.)-pow((uv.y-.3)*2.2,2.));
 float side2=exp(-pow((uv.x-(.86+mm.x))*2.4,2.)-pow((uv.y-.55)*2.,2.));
 float top=smoothstep(1.02,.5,uv.y);
 // Keep the headline band (upper middle) calmer so the text keeps its contrast.
 float hl=1.-.55*exp(-pow((uv.x-.5)*2.6,2.)-pow((uv.y-.74)*5.,2.));
 vec3 col=bg;
 col=mix(col,co,clamp(cool*(side*.55+side2*.4+mask*.15)*top*hl,0.,.42));
 col=mix(col,hi,clamp((light*(mask*.75+side2*.25)+.14*mask)*top*hl,0.,.62));
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
    gl.uniform3fv(u("co"), tokenRgb("--bf-info", [0.35, 0.55, 0.95]));
    const uR = u("r"), uT = u("t"), uS = u("s"), uM = u("m");
    // Pointer: eased toward the target each frame, so the light leans gently rather than jumps.
    const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
    const fine = window.matchMedia("(pointer: fine)").matches;
    const onMove = (e: PointerEvent) => { mouse.tx = e.clientX / window.innerWidth; mouse.ty = 1 - e.clientY / window.innerHeight; };
    if (fine) window.addEventListener("pointermove", onMove, { passive: true });

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
      mouse.x += (mouse.tx - mouse.x) * 0.06; mouse.y += (mouse.ty - mouse.y) * 0.06;
      gl.uniform2f(uM, mouse.x, mouse.y);
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
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); window.removeEventListener("pointermove", onMove); document.removeEventListener("visibilitychange", kick); reduce.removeEventListener?.("change", kick); };
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
