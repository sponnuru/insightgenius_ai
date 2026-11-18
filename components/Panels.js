'use client';

import { useState } from 'react';

const STEP_CHOICES = [3, 4, 6, 8, 10];
const HOUR_CHOICES = [1, 2, 3, 4, 6, 8];
const QUICK = [
  ['Research options', 'Research the best options for this step and give me a shortlist with pros and cons.'],
  ['Draft it for me', 'Draft whatever this step needs (an email, post, outline or document), ready for me to use.'],
  ['Detailed plan', 'Make a detailed, step-by-step plan for this step with time estimates.'],
  ['Free resources', 'Find free ways to make progress on this step.'],
];

const typeLabel = (c) => (c === 'long' ? 'Long-term' : 'Short-term');
const searchUrl = (r) =>
  r.type === 'video'
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(r.query || r.name)}`
    : `https://www.google.com/search?q=${encodeURIComponent(r.query || r.name)}`;
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

/* ---------------- Edit panel ---------------- */
export function EditPanel({ goal, parent, childCount, steps, busy, remaining, onSetSteps, onUpdate, onBreak, onAddStep, onDelete, onClose }) {
  const [title, setTitle] = useState(goal.title);
  const [newStep, setNewStep] = useState('');
  const [other, setOther] = useState(STEP_CHOICES.includes(steps) ? '' : String(steps));
  const done = goal.progress >= 100;
  const titleEmpty = !title.trim();

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className={`pill ${goal.category}`}>{typeLabel(goal.category)}</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <h3 className="full-title">{goal.title}</h3>
      {parent && <p className="small muted" style={{ margin: '2px 0 0' }}>Step of: {parent.title}</p>}

      <div className="field" style={{ marginTop: 14 }}>
        <label className="f" htmlFor="gt">Edit title</label>
        <input id="gt" type="text" maxLength={200} value={title}
          onChange={(e) => { setTitle(e.target.value); if (e.target.value.trim()) onUpdate({ title: e.target.value.trim() }); }}
          onBlur={() => titleEmpty && setTitle(goal.title)} aria-invalid={titleEmpty} />
        {titleEmpty && <p className="small err-text">A title can't be empty.</p>}
      </div>

      <div className="field">
        <label className="f">Type</label>
        <div className="chips">
          <button className={`chip ${goal.category === 'long' ? 'on' : ''}`} onClick={() => onUpdate({ category: 'long' })}>Long-term</button>
          <button className={`chip ${goal.category === 'short' ? 'on' : ''}`} onClick={() => onUpdate({ category: 'short' })}>Short-term</button>
        </div>
      </div>

      <div className="field">
        <label className="f" htmlFor="gp">Progress: {goal.progress}%</label>
        <input id="gp" type="range" min="0" max="100" step="5" value={goal.progress} onChange={(e) => onUpdate({ progress: +e.target.value })} />
      </div>

      <div className="field">
        <label className="f" htmlFor="gn">Notes</label>
        <textarea id="gn" maxLength={2000} value={goal.notes || ''} placeholder="What does success look like? Any blockers? AI and the agent read these."
          onChange={(e) => onUpdate({ notes: e.target.value })} />
      </div>

      <div className="field">
        <label className="f">AI steps to add</label>
        <div className="chips">
          {STEP_CHOICES.map((n) => (
            <button key={n} className={`chip ${steps === n ? 'on' : ''}`} onClick={() => { setOther(''); onSetSteps(n); }}>{n}</button>
          ))}
          <input className={`other ${!STEP_CHOICES.includes(steps) ? 'on' : ''}`} type="number" min="2" max="15" placeholder="Other"
            aria-label="Other number of steps" value={other}
            onChange={(e) => {
              setOther(e.target.value);
              const n = Math.round(Number(e.target.value));
              if (n >= 2 && n <= 15) onSetSteps(n);
            }} />
        </div>
      </div>

      <button className="btn accent full" onClick={onBreak} disabled={busy} style={{ marginBottom: 10 }}>
        {busy ? <><span className="spin" /> Thinking…</> : childCount ? `✦ AI: add ${steps} more steps` : `✦ AI: break into ${steps} steps`}
      </button>

      <form className="row nowrap" style={{ marginBottom: 12 }}
        onSubmit={(e) => { e.preventDefault(); const t = newStep.trim(); if (t) { onAddStep(t); setNewStep(''); } }}>
        <input type="text" maxLength={200} value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Add a step yourself…" aria-label="New step" />
        <button className="btn">Add</button>
      </form>

      <div className="row">
        <button className="btn sm" onClick={() => onUpdate({ progress: done ? 90 : 100 })}>{done ? 'Mark not complete' : '✓ Mark complete'}</button>
        <div className="spacer" />
        <button className="btn sm ghost danger" onClick={onDelete}>Delete</button>
      </div>
      {remaining !== null && <p className="small muted" style={{ margin: '12px 0 0' }}>{remaining} AI request{remaining === 1 ? '' : 's'} left in this window</p>}
    </div>
  );
}

/* ---------------- Add a goal ---------------- */
export function AddGoalPanel({ onAdd }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('long');
  return (
    <div className="card">
      <form onSubmit={(e) => { e.preventDefault(); const t = title.trim(); if (t) { onAdd(t, category); setTitle(''); } }}>
        <h2 style={{ marginBottom: 12 }}>Add a goal</h2>
        <div className="field"><input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Move into a product management role" aria-label="Goal title" /></div>
        <div className="field chips">
          <button type="button" className={`chip ${category === 'long' ? 'on' : ''}`} onClick={() => setCategory('long')}>Long-term</button>
          <button type="button" className={`chip ${category === 'short' ? 'on' : ''}`} onClick={() => setCategory('short')}>Short-term</button>
        </div>
        <button className="btn primary full">+ Add goal</button>
      </form>
      <p className="small muted" style={{ margin: '14px 0 0' }}>
        Tip: on any goal, <b>✦</b> has AI break it into steps, <b>Do</b> runs an agent on it, <b>×</b> deletes it, and <b>+</b> / <b>−</b> shows or hides its steps.
      </p>
    </div>
  );
}

/* ---------------- Resources ---------------- */
export function ResourcesPanel({ goal, busy, onFind }) {
  const list = Array.isArray(goal.resources) ? goal.resources : [];
  return (
    <div className="card">
      <div className="card-h">
        <h2 style={{ flex: 1 }}>Resources</h2>
        <button className="btn sm" onClick={onFind} disabled={busy}>{busy ? <span className="spin" /> : list.length ? 'Refresh' : 'Find resources'}</button>
      </div>
      {list.length === 0 ? (
        <div className="empty">{busy ? 'Finding resources…' : 'Find videos, classes, books, events and communities for this step.'}</div>
      ) : (
        <>
          {list.map((r, i) => (
            <div className="res" key={i}>
              <div className="row"><span className="pill type">{r.type}</span></div>
              <b>{r.name}</b>
              {r.why && <div className="small muted">{r.why}</div>}
              <a className="small link" href={searchUrl(r)} target="_blank" rel="noopener noreferrer">
                {r.type === 'video' ? 'Search YouTube ↗' : 'Search the web ↗'}
              </a>
            </div>
          ))}
          <p className="small muted" style={{ margin: '10px 0 0' }}>Suggested by AI. Use the search links to confirm each one exists and is current.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Do it for me ---------------- */
export function AgentPanel({ goal, run, onRun, onStop, onAction }) {
  const [text, setText] = useState('');
  const running = run?.running && run.goalId === goal.id;
  const otherRunning = run?.running && run.goalId !== goal.id;
  const result = goal.result;

  return (
    <div className="card" id="agent-panel">
      <h2 style={{ marginBottom: 10 }}>Do it for me</h2>
      <div className="chips" style={{ marginBottom: 10 }}>
        {QUICK.map(([label, prompt]) => (
          <button key={label} className={`chip sm ${text === prompt ? 'on' : ''}`} onClick={() => setText(prompt)}>{label}</button>
        ))}
      </div>
      <textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Or tell the agent what you need for this step…" aria-label="Agent request" />
      <div className="row" style={{ marginTop: 10 }}>
        {running ? (
          <button className="btn full" onClick={onStop}>Stop</button>
        ) : (
          <button className="btn teal full" disabled={otherRunning} onClick={() => onRun(text.trim())}>
            {otherRunning ? 'Agent busy on another step' : 'Run agent'}
          </button>
        )}
      </div>

      {run && run.goalId === goal.id && run.log.length > 0 && (running || run.error) && (
        <ul className="log">
          {run.log.map((l, i) => <li key={i}>{l}</li>)}
          {running && <li><span className="spin" /> Working…</li>}
        </ul>
      )}

      {result && !running && (
        <div className="result">
          <div className="small muted">{new Date(result.at).toLocaleString()} · “{result.instruction}”</div>
          <div className="md"><Markdown text={result.summary} /></div>
          <div className="row">
            <button className="btn sm" onClick={() => copy(result.summary)}>Copy</button>
            {result.added > 0 && <span className="small muted">{result.added} follow-up step{result.added > 1 ? 's' : ''} added</span>}
          </div>

          {result.lookups?.length > 0 && (
            <>
              <h4>To check online</h4>
              {result.lookups.map((l, i) => (
                <div key={i} className="small item">
                  {l.question} <a className="link" href={`https://www.google.com/search?q=${encodeURIComponent(l.query)}`} target="_blank" rel="noopener noreferrer">Search ↗</a>
                </div>
              ))}
            </>
          )}

          {result.actions?.length > 0 && (
            <>
              <h4>Needs your approval</h4>
              <p className="small muted" style={{ margin: '0 0 6px' }}>Nothing is sent for you. Approving only records your decision.</p>
              {result.actions.map((a) => (
                <div key={a.id} className={`action ${a.status}`}>
                  <div className="row"><span className="pill type">{a.kind}</span><b style={{ flex: 1 }}>{a.title}</b>
                    {a.status !== 'pending' && <span className="small muted">{a.status === 'approved' ? 'Approved' : 'Dismissed'}</span>}</div>
                  <div className="small pre">{a.details}</div>
                  <div className="row">
                    {a.status === 'pending' && <>
                      <button className="btn sm teal" onClick={() => onAction(a.id, 'approved')}>Approve</button>
                      <button className="btn sm ghost" onClick={() => onAction(a.id, 'dismissed')}>Dismiss</button>
                    </>}
                    <button className="btn sm ghost" onClick={() => copy(`${a.title}\n\n${a.details}`)}>Copy text</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Today's plan ---------------- */
const pad = (n) => String(n).padStart(2, '0');
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export function nextQuarterHour() {
  const d = new Date();
  const m = Math.ceil((d.getHours() * 60 + d.getMinutes()) / 15) * 15;
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
function clock(mins) {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function PlanCard({ plan, hours, goals, busy, onPlan, onToggle, onReveal, onClose }) {
  const [h, setH] = useState(plan?.hours || hours || 3);
  const [start, setStart] = useState(plan?.start || nextQuarterHour());
  const byId = Object.fromEntries(goals.map((g) => [g.id, g]));

  let t = (() => { const [a, b] = (plan?.start || start).split(':').map(Number); return a * 60 + b; })();
  const items = (plan?.items || []).map((it) => { const from = t; t += it.minutes + 5; return { ...it, from, to: from + it.minutes }; });
  const doneCount = items.filter((i) => i.done).length;
  const total = items.reduce((n, i) => n + i.minutes, 0);

  return (
    <div className="card plan">
      <div className="card-h">
        <h2 style={{ flex: 1 }}>Today's plan</h2>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close plan">✕</button>
      </div>
      <div className="row" style={{ gap: 14, marginBottom: 12 }}>
        <div className="chips" role="group" aria-label="Time available">
          {HOUR_CHOICES.map((n) => <button key={n} className={`chip sm ${h === n ? 'on' : ''}`} onClick={() => setH(n)}>{n}h</button>)}
        </div>
        <label className="small row" style={{ gap: 6 }}>Start <input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <button className="btn teal" disabled={busy} onClick={() => onPlan(h, start)}>
          {busy ? <><span className="spin" /> Planning…</> : plan ? 'Re-plan my day' : 'Plan my day'}
        </button>
      </div>

      {plan && plan.date !== todayKey() && <div className="note" style={{ marginBottom: 10 }}>This plan is from {plan.date}. Re-plan for today.</div>}
      {plan && (
        <>
          {plan.focus && <p style={{ margin: '0 0 10px' }}><b>Focus:</b> {plan.focus}</p>}
          {items.map((it) => (
            <div key={it.id} className={`block ${it.done ? 'done' : ''}`}>
              <input type="checkbox" checked={!!it.done} onChange={() => onToggle(it.id)} aria-label={`Done: ${it.title}`} />
              <div style={{ flex: 1 }}>
                <div className="small muted">{clock(it.from)} – {clock(it.to)} · {it.minutes} min</div>
                <b>{it.title}</b>
                {it.why && <div className="small muted">{it.why}</div>}
                {byId[it.goalId] && <button className="linkbtn small" onClick={() => onReveal(it.goalId)}>Step: {byId[it.goalId].title} →</button>}
              </div>
            </div>
          ))}
          <p className="small muted" style={{ margin: '8px 0 0' }}>{doneCount} of {items.length} blocks done · {total} minutes planned</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Confirm dialog ---------------- */
export function ConfirmDialog({ goal, count, onCancel, onConfirm }) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="cd-h" onClick={onCancel}>
      <div className="card dialog" onClick={(e) => e.stopPropagation()}>
        <h2 id="cd-h" style={{ marginBottom: 8 }}>Delete this goal?</h2>
        <p style={{ margin: '0 0 18px' }}>“{goal.title}”{count ? ` and its ${count} step${count > 1 ? 's' : ''}` : ''} will be removed. This can't be undone.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} autoFocus>Cancel</button>
          <button className="btn danger-fill" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Tiny, safe Markdown renderer ---------------- */
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <b key={i}>{part.slice(2, -2)}</b>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code>
        : part,
  );
}
export function Markdown({ text }) {
  const blocks = [];
  let list = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    const li = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const ordered = /^\s*\d+\./.test(line);
      if (!list || list.ordered !== ordered) { list = { ordered, items: [] }; blocks.push(list); }
      list.items.push(li[1]);
      continue;
    }
    list = null;
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    blocks.push(h ? { h: h[2] } : { p: line });
  }
  return blocks.map((b, i) => {
    if (b.items) { const L = b.ordered ? 'ol' : 'ul'; return <L key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>; }
    if (b.h) return <h4 key={i}>{inline(b.h)}</h4>;
    return <p key={i}>{inline(b.p)}</p>;
  });
}
