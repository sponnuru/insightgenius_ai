'use client';

// Draws the goal tree as one SVG, left (your journey) to right (smallest steps).
export const NW = 300, NH = 78, COL = 348, ROW = 94, PAD = 26, TOG = 12;

/** Wraps a title to at most two lines of about 23 characters, adding "…" if longer. */
export function wrapTitle(title, max = 23) {
  const words = String(title).split(/\s+/).filter(Boolean);
  const lines = [];
  let k = 0;
  while (lines.length < 2 && k < words.length) {
    let line = words[k++];
    while (k < words.length && (line + ' ' + words[k]).length <= max) line += ' ' + words[k++];
    lines.push(line);
  }
  const more = k < words.length;
  return lines.map((l, i) => (l.length > max || (more && i === lines.length - 1) ? l.slice(0, max - 1).trimEnd() + '…' : l));
}

export function buildTree(goals) {
  const ids = new Set(goals.map((g) => g.id));
  const parentOf = (g) => (g.parent_id && ids.has(g.parent_id) ? g.parent_id : 'root');
  const children = {};
  for (const g of goals) (children[parentOf(g)] ||= []).push(g);
  const countDesc = (id) => (children[id] || []).reduce((n, k) => n + 1 + countDesc(k.id), 0);
  return { parentOf, children, countDesc };
}

function layout(children, collapsed) {
  const pos = {};
  let row = 0, maxDepth = 0;
  (function place(id, depth) {
    maxDepth = Math.max(maxDepth, depth);
    const kids = id !== 'root' && collapsed.has(id) ? [] : children[id] || [];
    if (!kids.length) { pos[id] = { depth, y: row++ }; return; }
    kids.forEach((k) => place(k.id, depth + 1));
    const ys = kids.map((k) => pos[k.id].y);
    pos[id] = { depth, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  })('root', 0);
  return { pos, rows: Math.max(row, 1), maxDepth };
}

const activate = (fn) => ({
  onClick: (e) => { e.stopPropagation(); fn(); },
  onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); fn(); } },
});

export default function GoalTree({ goals, name, selectedId, collapsed, busyIds, flashIds, onSelect, onToggle, onDelete, onDo, onBreak }) {
  const { parentOf, children, countDesc } = buildTree(goals);
  const { pos, rows, maxDepth } = layout(children, collapsed);
  const W = PAD * 2 + maxDepth * COL + NW + TOG;
  const H = PAD * 2 + (rows - 1) * ROW + NH;
  const at = (id) => ({ x: PAD + pos[id].depth * COL, y: PAD + pos[id].y * ROW });
  const visible = goals.filter((g) => pos[g.id]);
  const root = at('root');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="tree" aria-label="Goal tree">
      {visible.map((g) => {
        const a = at(parentOf(g)), b = at(g.id);
        const x1 = a.x + NW, y1 = a.y + NH / 2, x2 = b.x, y2 = b.y + NH / 2, mx = (x1 + x2) / 2;
        return <path key={'e' + g.id} className="edge" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
      })}

      <g className="node root" tabIndex={0} role="treeitem" aria-label="My journey: add a top-level goal" {...activate(() => onSelect(null))}>
        <rect className="bg" x={root.x} y={root.y} width={NW} height={NH} rx="14" />
        <text x={root.x + 20} y={root.y + 32} className="root-k">MY JOURNEY</text>
        <text x={root.x + 20} y={root.y + 54} className="root-n">{name || 'You'}</text>
      </g>

      {visible.map((g) => {
        const p = at(g.id);
        const done = g.progress >= 100;
        const kids = children[g.id] || [];
        const isCollapsed = collapsed.has(g.id);
        const lines = wrapTitle(g.title);
        const nRes = Array.isArray(g.resources) ? g.resources.length : 0;
        const pending = g.result?.actions?.filter((a) => a.status === 'pending').length || 0;
        const status = (done ? '✓ Completed' : `${g.progress}% · ${g.category === 'long' ? 'Long-term' : 'Short-term'}`) +
          (nRes ? ` · ${nRes} resource${nRes > 1 ? 's' : ''}` : '');
        const cls = ['node', selectedId === g.id && 'sel', done && 'done', busyIds.has(g.id) && 'busy', flashIds.has(g.id) && 'flash']
          .filter(Boolean).join(' ');
        const bx = p.x + NW;
        return (
          <g key={g.id} data-node={g.id} className={cls} tabIndex={0} role="treeitem" aria-selected={selectedId === g.id}
             aria-expanded={kids.length ? !isCollapsed : undefined} aria-label={`${g.title}, ${status}`}
             {...activate(() => onSelect(g.id))}>
            <title>{g.title}</title>
            <rect className="bg" x={p.x} y={p.y} width={NW} height={NH} rx="12" />
            <rect x={p.x + 10} y={p.y + 12} width="4" height={NH - 24} rx="2" className={g.category === 'long' ? 'stripe-long' : 'stripe-short'} />
            {lines.map((l, i) => (
              <text key={i} x={p.x + 24} y={p.y + 24 + i * 17} className="t">{l}</text>
            ))}
            <text x={p.x + 24} y={p.y + 61} className="s">{status}</text>
            <rect x={p.x + 24} y={p.y + NH - 9} width={NW - 48} height="3" rx="1.5" className="bar" />
            <rect x={p.x + 24} y={p.y + NH - 9} width={((NW - 48) * Math.min(100, g.progress)) / 100} height="3" rx="1.5" className="bar-on" />
            {g.result && (
              <text x={bx - 14} y={p.y + 61} textAnchor="end" className={pending ? 'badge warn' : 'badge ok'}>
                {pending ? `${pending} to approve` : '◆ Agent done'}
              </text>
            )}

            <g className="nb del" tabIndex={0} role="button" aria-label={`Delete ${g.title}`} {...activate(() => onDelete(g))}>
              <rect x={bx - 92} y={p.y + 8} width="22" height="20" rx="6" />
              <text x={bx - 81} y={p.y + 22} textAnchor="middle">×</text>
            </g>
            <g className="nb do" tabIndex={0} role="button" aria-label={`Do it for me: ${g.title}`} {...activate(() => onDo(g))}>
              <rect x={bx - 66} y={p.y + 8} width="28" height="20" rx="6" />
              <text x={bx - 52} y={p.y + 22} textAnchor="middle">Do</text>
            </g>
            <g className="nb ai" tabIndex={0} role="button" aria-label={`AI breakdown: ${g.title}`} {...activate(() => onBreak(g))}>
              <rect x={bx - 34} y={p.y + 8} width="24" height="20" rx="6" />
              <text x={bx - 22} y={p.y + 22} textAnchor="middle">✦</text>
            </g>

            {kids.length > 0 && (
              <g className="tog" tabIndex={0} role="button" aria-label={isCollapsed ? `Expand ${g.title}` : `Collapse ${g.title}`}
                 {...activate(() => onToggle(g.id))}>
                <circle cx={bx} cy={p.y + NH / 2} r={TOG} />
                <text x={bx} y={p.y + NH / 2 + 4} textAnchor="middle">{isCollapsed ? `+${countDesc(g.id)}` : '−'}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
