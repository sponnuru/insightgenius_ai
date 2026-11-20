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
export function EditPanel({ goal, parent, childCount, steps, busy, remaining, dataItem, onSetSteps, onUpdate, onBreak, onAddStep, onDelete, onClose }) {
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
        <DataSays item={dataItem} current={goal.progress} onSet={(n) => onUpdate({ progress: n })} />
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

/* ---------------- My data ---------------- */
const MAX_SOURCES = 6, MAX_CHARS = 12000, MAX_FILE = 2 * 1024 * 1024;
const TREND = { up: ['Helping', 'up'], down: ['Slowing', 'down'], flat: ['Neutral', 'flat'] };

export function MyDataCard({ sources, signals, goals, dirStale, busy, readOnly, onChange, onDirections, onAnalyze, onReveal, onClose, onError }) {
  const [mode, setMode] = useState('note');
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
  const full = sources.length >= MAX_SOURCES;

  const add = (src) => {
    const t = String(src.text || '');
    onChange([...sources, { id: crypto.randomUUID(), kind: src.kind, name: src.name.slice(0, 120), text: t.slice(0, MAX_CHARS), cut: t.length > MAX_CHARS, direction: '', at: new Date().toISOString() }]);
  };

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_FILE) return onError('That file is over 2 MB. Try a smaller text file.');
    if (!/\.(txt|csv|md|json)$/i.test(f.name)) return onError('Please choose a .txt, .csv, .md or .json file.');
    add({ kind: 'file', name: f.name, text: await f.text() });
  }

  return (
    <div className="card mydata">
      <div className="card-h">
        <h2 style={{ flex: 1 }}>My data</h2>
        <button className="btn ghost sm" onClick={onClose} aria-label="Close My data">✕</button>
      </div>

      {!readOnly && (
        <>
          <p className="small muted" style={{ margin: '0 0 12px' }}>Add real information about yourself, and AI shows which goals it's helping or slowing. Up to {MAX_SOURCES} sources, {MAX_CHARS.toLocaleString()} characters each.</p>
          {sources.map((s) => (
            <div className="src" key={s.id}>
              <div className="row">
                <span className="pill type">{s.kind}</span><b style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{s.name}</b>
                <span className="small muted">{s.text.length.toLocaleString()} chars{s.cut ? ' (cut)' : ''}</span>
                <button className="btn ghost sm danger" onClick={() => onChange(sources.filter((x) => x.id !== s.id))}>Remove</button>
              </div>
              <label className="small muted" htmlFor={'dir' + s.id}>Direction: what to look for</label>
              <input id={'dir' + s.id} type="text" maxLength={400} value={s.direction || ''} placeholder="e.g. hours spent studying, applications sent"
                onChange={(e) => onChange(sources.map((x) => (x.id === s.id ? { ...x, direction: e.target.value } : x)))} />
            </div>
          ))}

          {!full && (
            <div className="src add">
              <div className="chips" style={{ marginBottom: 8 }}>
                <button className={`chip sm ${mode === 'note' ? 'on' : ''}`} onClick={() => setMode('note')}>Note</button>
                <button className={`chip sm ${mode === 'file' ? 'on' : ''}`} onClick={() => setMode('file')}>File</button>
              </div>
              {mode === 'note' ? (
                <form onSubmit={(e) => { e.preventDefault(); if (!text.trim()) return; add({ kind: 'note', name: name.trim() || 'Note', text }); setName(''); setText(''); }}>
                  <input type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Weekly journal" aria-label="Note name" style={{ marginBottom: 8 }} />
                  <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Type or paste text" aria-label="Note text" />
                  <button className="btn sm" style={{ marginTop: 8 }}>Add note</button>
                </form>
              ) : (
                <label className="btn sm filebtn">Choose a text file (txt, csv, md, json)
                  <input type="file" accept=".txt,.csv,.md,.json,text/plain,text/csv,text/markdown,application/json" onChange={onFile} hidden />
                </label>
              )}
            </div>
          )}

          {dirStale && <div className="note" style={{ margin: '10px 0' }}>Your goals changed since the directions were written. Update them so the analysis looks for the right things.</div>}
          <div className="row" style={{ margin: '12px 0' }}>
            <button className="btn sm" disabled={!sources.length || busy.dir} onClick={onDirections}>{busy.dir ? <><span className="spin" /> Updating…</> : 'Update directions from my goals'}</button>
            <button className="btn sm teal" disabled={!sources.length || busy.impact} onClick={onAnalyze}>{busy.impact ? <><span className="spin" /> Analyzing…</> : 'Analyze impact'}</button>
          </div>
        </>
      )}

      {signals ? (
        <div className="signals">
          <div className="small muted">Analyzed {new Date(signals.at).toLocaleString()}</div>
          <p style={{ margin: '6px 0 10px' }}>{signals.summary}</p>
          {signals.items.filter((it) => byId[it.goalId]).map((it) => (
            <div className={`sig ${it.trend}`} key={it.goalId}>
              <span className={`pill trend ${TREND[it.trend][1]}`}>{TREND[it.trend][0]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <button className="linkbtn" onClick={() => onReveal(it.goalId)}>{byId[it.goalId].title}</button>
                <div className="small">{it.evidence}</div>
                {it.source && <div className="small muted">Source: {it.source}</div>}
              </div>
            </div>
          ))}
          {!signals.items.length && <div className="small muted">The data didn't clearly speak to any goal.</div>}
        </div>
      ) : readOnly ? <div className="empty">No analysis yet.</div> : null}
    </div>
  );
}

/** "What your data says" block for the edit panel. */
export function DataSays({ item, current, readOnly, onSet }) {
  if (!item) return null;
  return (
    <div className={`datasays ${item.trend}`}>
      <div className="small"><b>What {readOnly ? 'their' : 'your'} data says:</b> <span className={`trend-word ${item.trend}`}>{TREND[item.trend][0]}</span></div>
      <div className="small">{item.evidence}</div>
      {item.source && <div className="small muted">Source: {item.source}</div>}
      {!readOnly && item.suggested != null && item.suggested !== current && (
        <button className="btn sm" style={{ marginTop: 6 }} onClick={() => onSet(item.suggested)}>Set progress to {item.suggested}%</button>
      )}
    </div>
  );
}
