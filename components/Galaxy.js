'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// 3D galaxy view of the goal tree, drawn on a 2D canvas with a hand-written
// perspective projection and depth sorting. The journey is the sun, top-level
// goals are planets, and each step is a moon orbiting its parent.

const RADIUS = [26, 13, 8, 5.5];
const COLORS = { long: [124, 107, 224], short: [224, 122, 63], done: [63, 156, 136], sun: [242, 177, 107] };
const FOCAL = 900;

function buildSystems(goals) {
  const ids = new Set(goals.map((g) => g.id));
  const kids = {};
  for (const g of goals) {
    const p = g.parent_id && ids.has(g.parent_id) ? g.parent_id : 'root';
    (kids[p] ||= []).push(g);
  }
  const bodies = {};
  // Size each system bottom-up.
  function size(g, depth) {
    const r = RADIUS[Math.min(depth - 1, 3)];
    const ch = kids[g.id] || [];
    const childSystems = ch.map((c) => size(c, depth + 1));
    let orbit = 0;
    if (ch.length) {
      const n = ch.length;
      const base = depth === 1 ? 84 + 7 * n : depth === 2 ? 40 + 3.5 * n : 22 + 2 * n;
      orbit = base + 0.7 * Math.max(...childSystems);
    }
    const system = ch.length ? orbit + Math.max(...childSystems) : r;
    bodies[g.id] = { id: g.id, goal: g, depth, r, orbit, system, children: ch.map((c) => c.id) };
    return system;
  }
  const top = kids.root || [];
  top.forEach((g) => size(g, 1));
  // Place top-level orbits so neighbouring systems don't overlap.
  let R = 0;
  top.forEach((g, i) => {
    const b = bodies[g.id];
    R = i === 0 ? 110 + b.system : R + bodies[top[i - 1].id].system + b.system + 46;
    b.parent = 'root';
    b.orbitR = R;
    b.phase = (i / Math.max(1, top.length)) * Math.PI * 2 + 0.4;
    b.tilt = ((i % 3) - 1) * 0.06;
    b.speed = 0.9 / Math.sqrt(R);
  });
  // Moons share their parent's ring, evenly spaced.
  top.forEach((g) => (function walk(id) {
    const b = bodies[id];
    b.children.forEach((cid, j) => {
      const c = bodies[cid];
      c.parent = id;
      c.orbitR = b.orbit;
      c.phase = (j / b.children.length) * Math.PI * 2 + b.depth * 0.7;
      c.tilt = 0.25 + (b.depth % 2) * 0.15;
      c.speed = 2.2 / Math.sqrt(Math.max(20, b.orbit));
      walk(cid);
    });
  })(g.id));
  Object.values(bodies).forEach((b, i) => { b.idx = i; });
  const extent = top.length ? bodies[top[top.length - 1].id].orbitR + bodies[top[top.length - 1].id].system : 200;
  return { bodies, top: top.map((g) => g.id), extent };
}

const easeOut = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const Galaxy = forwardRef(function Galaxy({ goals, selectedId, busyIds, agentId, signals, onSelect, reducedMotion }, ref) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const state = useRef(null);

  // Mutable scene state that survives re-renders.
  if (!state.current) {
    state.current = {
      cam: { yaw: 0.6, pitch: 0.55, dist: 900, tx: 0, ty: 0, tz: 0 },
      goalCam: null, follow: null, time: 0, last: 0, enteredAt: 0, idleSince: 0,
      born: {}, known: null, hover: null, drag: null, pointers: new Map(),
      stars: Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + 0.3, p: Math.random() * 6 })),
      screen: {}, props: {},
    };
  }
  const S = state.current;
  S.props = { goals, selectedId, busyIds, agentId, signals, onSelect, reducedMotion };

  // Track new goals so they burst out of their parent.
  const sys = buildSystems(goals);
  S.sys = sys;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (S.known) for (const g of goals) if (!S.known.has(g.id)) S.born[g.id] = now;
  S.known = new Set(goals.map((g) => g.id));

  useImperativeHandle(ref, () => ({
    screenPos(id) {
      const p = S.screen[id];
      const c = canvasRef.current;
      if (!p || !c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    },
    reset() { S.follow = null; S.goalCam = { tx: 0, ty: 0, tz: 0, dist: Math.max(700, S.sys.extent * 2.1) }; },
  }));

  // Fly to the selected body, or back to the overview.
  useEffect(() => {
    if (selectedId && S.sys.bodies[selectedId]) {
      S.follow = selectedId;
      const b = S.sys.bodies[selectedId];
      S.goalCam = { dist: Math.max(160, (b.system || b.r) * 4.2 + 120) };
    } else {
      S.follow = null;
      S.goalCam = { tx: 0, ty: 0, tz: 0, dist: Math.max(700, S.sys.extent * 2.1) };
    }
  }, [selectedId, S]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    let raf = 0, W = 0, H = 0;
    S.enteredAt = performance.now();
    S.cam.dist = Math.max(700, S.sys.extent * 2.1);
    S.idleSince = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = wrap.clientWidth; H = wrap.clientHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // World position of a body at time t (recursively around its parent).
    const posCache = {};
    function worldPos(id, t) {
      if (id === 'root') return [0, 0, 0];
      if (posCache[id]) return posCache[id];
      const b = S.sys.bodies[id];
      const P = worldPos(b.parent, t);
      const a = b.phase + t * b.speed;
      let x = Math.cos(a) * b.orbitR, z = Math.sin(a) * b.orbitR, y = 0;
      const ct = Math.cos(b.tilt), st = Math.sin(b.tilt);
      [y, z] = [y * ct - z * st, y * st + z * ct];
      let k = 1;
      const { reducedMotion: rm } = S.props;
      if (!rm) {
        // Entry fly-out, then bursts for new steps.
        const enter = easeOut((performance.now() - S.enteredAt - b.idx * 55) / 750);
        const born = S.born[id] ? easeOut((performance.now() - S.born[id]) / 700) : 1;
        k = Math.min(enter, born);
      }
      const p = [P[0] + x * k, P[1] + y * k, P[2] + z * k];
      posCache[id] = p;
      return p;
    }

    function project(p) {
      const c = S.cam;
      let x = p[0] - c.tx, y = p[1] - c.ty, z = p[2] - c.tz;
      const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      [x, z] = [x * cy - z * sy, x * sy + z * cy];
      const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
      [y, z] = [y * cp - z * sp, y * sp + z * cp];
      const d = z + c.dist;
      if (d < 20) return null;
      const s = FOCAL / d;
      return { x: W / 2 + x * s, y: H / 2 + y * s, s, d };
    }

    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

    function frame(ts) {
      const P = S.props;
      const dt = Math.min(0.05, (ts - (S.last || ts)) / 1000);
      S.last = ts;
      if (!P.reducedMotion && !S.hover) S.time += dt;
      for (const k in posCache) delete posCache[k];
      const t = S.time;

      // Camera: ease towards goal, follow the selected body, rotate when idle.
      const c = S.cam;
      if (S.follow && S.sys.bodies[S.follow]) {
        const fp = worldPos(S.follow, t);
        c.tx += (fp[0] - c.tx) * 0.08; c.ty += (fp[1] - c.ty) * 0.08; c.tz += (fp[2] - c.tz) * 0.08;
      } else if (S.goalCam && 'tx' in S.goalCam) {
        c.tx += (S.goalCam.tx - c.tx) * 0.06; c.ty += (S.goalCam.ty - c.ty) * 0.06; c.tz += (S.goalCam.tz - c.tz) * 0.06;
      }
      if (S.goalCam?.dist) {
        c.dist += (S.goalCam.dist - c.dist) * 0.06;
        if (Math.abs(S.goalCam.dist - c.dist) < 1) S.goalCam = { ...S.goalCam, dist: undefined };
      }
      if (!P.reducedMotion && !S.drag && ts - S.idleSince > 2500) c.yaw += dt * 0.05;

      // Background: deep space, two faint clouds and twinkling stars.
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, W, H);
      for (const [cx, cy, col] of [[0.28, 0.32, [124, 107, 224]], [0.75, 0.7, [63, 156, 136]]]) {
        const g = ctx.createRadialGradient(W * cx, H * cy, 0, W * cx, H * cy, Math.max(W, H) * 0.45);
        g.addColorStop(0, rgba(col, 0.13)); g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      for (const s of S.stars) {
        const a = P.reducedMotion ? 0.6 : 0.35 + 0.35 * Math.sin(ts / 1400 + s.p);
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(s.x * W, s.y * H, s.s, s.s);
      }

      // Orbit paths.
      ctx.lineWidth = 1;
      for (const id of Object.keys(S.sys.bodies)) {
        const b = S.sys.bodies[id];
        const center = worldPos(b.parent, t);
        if (b.parent !== 'root' && S.sys.bodies[b.parent].children[0] !== id) continue; // one ring per parent
        ctx.beginPath();
        for (let i = 0; i <= 64; i++) {
          const a = (i / 64) * Math.PI * 2;
          let x = Math.cos(a) * b.orbitR, z = Math.sin(a) * b.orbitR, y = 0;
          const ct = Math.cos(b.tilt), st = Math.sin(b.tilt);
          [y, z] = [y * ct - z * st, y * st + z * ct];
          const pr = project([center[0] + x, center[1] + y, center[2] + z]);
          if (!pr) continue;
          i === 0 ? ctx.moveTo(pr.x, pr.y) : ctx.lineTo(pr.x, pr.y);
        }
        ctx.strokeStyle = b.parent === 'root' ? 'rgba(160,160,220,0.14)' : 'rgba(160,160,220,0.09)';
        ctx.stroke();
      }

      // Bodies, far to near.
      const items = [];
      const sunP = project([0, 0, 0]);
      if (sunP) items.push({ id: 'root', p: sunP, r: 34 });
      for (const id of Object.keys(S.sys.bodies)) {
        const b = S.sys.bodies[id];
        const p = project(worldPos(id, t));
        if (p) items.push({ id, b, p, r: b.r });
      }
      items.sort((a, b) => b.p.d - a.p.d);
      S.screen = {};
      const labels = [];

      for (const it of items) {
        const { p } = it;
        const R = Math.max(1.5, it.r * p.s);
        S.screen[it.id] = { x: p.x, y: p.y, r: R };
        if (it.id === 'root') {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R * 3);
          g.addColorStop(0, 'rgba(255,220,160,0.95)'); g.addColorStop(0.35, rgba(COLORS.sun, 0.55)); g.addColorStop(1, rgba(COLORS.sun, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R * 3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffe2b0'; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
          labels.push({ id: 'root', x: p.x, y: p.y + R + 16, text: 'MY JOURNEY', pri: 3, sun: true });
          continue;
        }
        const g = it.b.goal;
        const prog = Math.min(100, g.progress) / 100;
        const done = g.progress >= 100;
        const col = done ? COLORS.done : COLORS[g.category === 'long' ? 'long' : 'short'];
        const glowR = R * (1.6 + 2.2 * prog);
        const glow = ctx.createRadialGradient(p.x, p.y, R * 0.6, p.x, p.y, glowR);
        glow.addColorStop(0, rgba(col, 0.25 + 0.45 * prog)); glow.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2); ctx.fill();
        const body = ctx.createRadialGradient(p.x - R * 0.35, p.y - R * 0.35, R * 0.1, p.x, p.y, R);
        body.addColorStop(0, rgba(col.map((v) => Math.min(255, v + 70)), 0.4 + 0.6 * prog));
        body.addColorStop(1, rgba(col.map((v) => v * 0.55), 0.55 + 0.45 * prog));
        ctx.fillStyle = body; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fill();
        if (done) {
          ctx.strokeStyle = rgba(COLORS.done, 0.85); ctx.lineWidth = Math.max(1, R * 0.18);
          ctx.beginPath(); ctx.ellipse(p.x, p.y, R * 1.8, R * 0.55, -0.35, 0, Math.PI * 2); ctx.stroke();
        }
        if (P.selectedId === it.id || S.hover === it.id) {
          ctx.strokeStyle = P.selectedId === it.id ? '#e07a3f' : 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(p.x, p.y, R + 5, 0, Math.PI * 2); ctx.stroke();
        }
        if (P.busyIds?.has(it.id)) {
          const k = (ts % 1200) / 1200;
          ctx.strokeStyle = `rgba(224,122,63,${1 - k})`; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, R + 6 + k * 22, 0, Math.PI * 2); ctx.stroke();
        }
        if (P.agentId === it.id) {
          const a = ts / 380;
          ctx.fillStyle = '#3f9c88';
          ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * (R + 12), p.y + Math.sin(a) * (R + 12) * 0.5, 3.5, 0, Math.PI * 2); ctx.fill();
        }
        if (!P.reducedMotion && S.born[it.id]) {
          const k = (performance.now() - S.born[it.id]) / 900;
          const pp = S.screen[it.b.parent] || p;
          if (k < 1) {
            ctx.strokeStyle = `rgba(224,122,63,${1 - k})`; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(pp.x, pp.y, 8 + k * 60, 0, Math.PI * 2); ctx.stroke();
          } else delete S.born[it.id];
        }
        const sel = P.selectedId === it.id, hov = S.hover === it.id;
        const childOfSel = P.selectedId && it.b.parent === P.selectedId;
        if (it.b.depth === 1 || sel || hov || childOfSel || R > 9) {
          const sig = P.signals?.[it.id];
          const arrow = sig === 'up' ? '▲ ' : sig === 'down' ? '▼ ' : '';
          const title = g.title.length > 28 ? g.title.slice(0, 27) + '…' : g.title;
          labels.push({
            id: it.id, x: p.x, y: p.y + R + 14, text: title, arrow, sig,
            sub: sel || hov ? (done ? '✓ Completed' : `${g.progress}%`) : '',
            pri: sel ? 4 : it.b.depth === 1 ? 2 : hov ? 3 : 1,
          });
        }
      }

      // Labels, skipping overlaps (selected and top-level first).
      labels.sort((a, b) => b.pri - a.pri);
      const placed = [];
      ctx.textAlign = 'center';
      for (const L of labels) {
        ctx.font = L.sun ? '700 11px Manrope, sans-serif' : `${L.pri >= 2 ? 700 : 600} 12px Manrope, sans-serif`;
        const w = ctx.measureText(L.arrow + L.text).width + 8;
        const box = { x: L.x - w / 2, y: L.y - 11, w, h: L.sub ? 30 : 16 };
        if (placed.some((q) => box.x < q.x + q.w && box.x + box.w > q.x && box.y < q.y + q.h && box.y + box.h > q.y)) continue;
        placed.push(box);
        ctx.fillStyle = L.sun ? '#f2b16b' : 'rgba(233,232,244,0.92)';
        if (L.arrow) {
          const aw = ctx.measureText(L.arrow).width, tw = ctx.measureText(L.text).width;
          const sx = L.x - (aw + tw) / 2;
          ctx.textAlign = 'left';
          ctx.fillStyle = L.sig === 'up' ? '#3f9c88' : '#e06060'; ctx.fillText(L.arrow, sx, L.y);
          ctx.fillStyle = 'rgba(233,232,244,0.92)'; ctx.fillText(L.text, sx + aw, L.y);
          ctx.textAlign = 'center';
        } else ctx.fillText(L.text, L.x, L.y);
        if (L.sub) { ctx.font = '600 11px Manrope, sans-serif'; ctx.fillStyle = 'rgba(155,154,180,0.95)'; ctx.fillText(L.sub, L.x, L.y + 15); }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // Interaction: drag to rotate, wheel/pinch to zoom, click to select, hover to pause.
    const hit = (x, y) => {
      let best = null, bestD = Infinity;
      for (const [id, s] of Object.entries(S.screen)) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d <= Math.max(10, s.r + 6) && d < bestD) { best = id; bestD = d; }
      }
      return best;
    };
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const touch = () => { S.idleSince = performance.now(); };

    const down = (e) => {
      canvas.setPointerCapture(e.pointerId);
      S.pointers.set(e.pointerId, local(e));
      const [x, y] = local(e);
      S.drag = { x, y, sx: x, sy: y, moved: false, pinch: S.pointers.size === 2 ? null : undefined };
      touch();
    };
    const move = (e) => {
      const [x, y] = local(e);
      if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, [x, y]);
      if (S.pointers.size === 2) {
        const [a, b] = [...S.pointers.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (S.drag.pinch) { S.cam.dist = Math.min(6000, Math.max(80, S.cam.dist * (S.drag.pinch / d))); S.goalCam = null; }
        S.drag.pinch = d; S.drag.moved = true; touch();
        return;
      }
      if (S.drag) {
        const dx = x - S.drag.x, dy = y - S.drag.y;
        if (Math.hypot(x - S.drag.sx, y - S.drag.sy) > 4) S.drag.moved = true;
        S.cam.yaw += dx * 0.006;
        S.cam.pitch = Math.min(1.45, Math.max(-0.2, S.cam.pitch + dy * 0.005));
        S.drag.x = x; S.drag.y = y; touch();
      } else {
        const h = hit(x, y);
        S.hover = h && h !== 'root' ? h : null;
        canvas.style.cursor = h ? 'pointer' : 'grab';
      }
    };
    const up = (e) => {
      const [x, y] = local(e);
      const wasClick = S.drag && !S.drag.moved && S.pointers.size <= 1;
      S.pointers.delete(e.pointerId);
      if (S.pointers.size === 0) S.drag = null;
      if (wasClick) {
        const h = hit(x, y);
        if (h === 'root') S.props.onSelect(null);
        else if (h) S.props.onSelect(h);
      }
    };
    const wheel = (e) => {
      e.preventDefault();
      S.cam.dist = Math.min(6000, Math.max(80, S.cam.dist * Math.exp(e.deltaY * 0.0012)));
      S.goalCam = S.goalCam ? { ...S.goalCam, dist: undefined } : null;
      touch();
    };
    const leave = () => { S.hover = null; };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('wheel', wheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('wheel', wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="galaxy" ref={wrapRef}>
      <canvas ref={canvasRef} role="img" aria-label="3D galaxy view of your goals. Use the tree view for keyboard access." />
      <button className="btn sm galaxy-reset" onClick={() => onSelect(null)}>Reset view</button>
    </div>
  );
});

export default Galaxy;
