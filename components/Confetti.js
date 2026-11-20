'use client';

import { forwardRef, useImperativeHandle, useRef } from 'react';

// A short confetti burst from a point on the page, used when a goal reaches 100%.
const COLORS = ['#e07a3f', '#3f9c88', '#7c6be0', '#f2b16b', '#e9e8f4'];

const Confetti = forwardRef(function Confetti(_props, ref) {
  const canvasRef = useRef(null);
  const parts = useRef([]);
  const running = useRef(false);

  useImperativeHandle(ref, () => ({
    fire(x, y) {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      for (let i = 0; i < 90; i++) {
        const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 6;
        parts.current.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4,
          w: 5 + Math.random() * 5, h: 3 + Math.random() * 4, c: COLORS[i % COLORS.length], life: 0 });
      }
      if (!running.current) { running.current = true; requestAnimationFrame(step); }
    },
  }));

  function step() {
    const c = canvasRef.current;
    if (!c) { running.current = false; return; }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== innerWidth * dpr || c.height !== innerHeight * dpr) { c.width = innerWidth * dpr; c.height = innerHeight * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.current = parts.current.filter((p) => p.life < 110);
    for (const p of parts.current) {
      p.life++; p.vy += 0.18; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.life / 110); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (parts.current.length) requestAnimationFrame(step);
    else { running.current = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
});

export default Confetti;
