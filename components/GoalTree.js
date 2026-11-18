'use client';

// Draws the goal tree as an SVG, left (your journey) to right (smallest steps).
const NW = 224, NH = 58, COL = 254, ROW = 76, PAD = 24;
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function layout(goals) {
  const ids = new Set(goals.map((g) => g.id));
  const parentOf = (g) => (g.parent_id && ids.has(g.parent_id) ? g.parent_id : 'root');
  const children = {};
  for (const g of goals) (children[parentOf(g)] ||= []).push(g);
  const pos = {};
  let row = 0, maxDepth = 0;
  (function place(id, depth) {
    maxDepth = Math.max(maxDepth, depth);
    const kids = children[id] || [];
    if (!kids.length) { pos[id] = { depth, y: row++ }; return; }
    kids.forEach((k) => place(k.id, depth + 1));
    const ys = kids.map((k) => pos[k.id].y);
    pos[id] = { depth, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  })('root', 0);
  return { pos, parentOf, rows: Math.max(row, 1), maxDepth };
}

export default function GoalTree({ goals, name, selectedId, onSelect }) {
  const { pos, parentOf, rows, maxDepth } = layout(goals);
  const W = PAD * 2 + maxDepth * COL + NW;
  const H = PAD * 2 + (rows - 1) * ROW + NH;
  const at = (id) => ({ x: PAD + pos[id].depth * COL, y: PAD + pos[id].y * ROW });
  const root = at('root');
  const keySelect = (id) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); } };

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="tree" aria-label="Goal tree">
      {goals.map((g) => {
        const a = at(parentOf(g)), b = at(g.id);
        const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
        return <path key={'e' + g.id} className="edge" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
      })}

      <g className="node" tabIndex={0} role="treeitem" aria-label="Your journey — add a top-level goal"
         onClick={() => onSelect(null)} onKeyDown={keySelect(null)}>
        <rect x={root.x} y={root.y} width={NW} height={NH} rx="14" fill="#1B1F3B" />
        <text x={root.x + 16} y={root.y + 25} fontSize="11" fontWeight="700" fill="#F2B16B" letterSpacing=".08em">MY JOURNEY</text>
        <text x={root.x + 16} y={root.y + 44} fontSize="14" fontWeight="700" fill="#fff">{trunc(name || 'You', 24)}</text>
      </g>

      {goals.map((g) => {
        const p = at(g.id);
        const done = g.progress >= 100;
        const color = g.category === 'long' ? '#5B4BB7' : '#D9692F';
        return (
          <g key={g.id} tabIndex={0} role="treeitem" aria-selected={selectedId === g.id}
             aria-label={`${g.title}, ${g.progress}% complete`}
             className={`node ${selectedId === g.id ? 'sel' : ''} ${done ? 'done' : ''}`}
             onClick={() => onSelect(g.id)} onKeyDown={keySelect(g.id)}>
            <rect className="bg" x={p.x} y={p.y} width={NW} height={NH} rx="12" />
            <rect x={p.x} y={p.y + 10} width="4" height={NH - 20} rx="2" fill={color} />
            <text x={p.x + 16} y={p.y + 24} fontSize="13" fontWeight="700" fill="#1B1F3B">{trunc(g.title, 27)}</text>
            <text x={p.x + 16} y={p.y + 40} fontSize="11" fill="#6B6A75">
              {done ? '✓ Completed' : `${g.progress}% · ${g.category === 'long' ? 'Long-term' : 'Short-term'}`}
            </text>
            <rect x={p.x + 16} y={p.y + 47} width={NW - 32} height="4" rx="2" fill="#EFEAE0" />
            <rect x={p.x + 16} y={p.y + 47} width={((NW - 32) * g.progress) / 100} height="4" rx="2" fill="#2F6F62" />
          </g>
        );
      })}
    </svg>
  );
}
