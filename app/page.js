'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import GoalTree from '../components/GoalTree';

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="login"><span className="spin" /></div>;
  if (!session) return <Login />;
  return <GoalApp session={session} />;
}

/* ---------------- Sign in (email magic link) ---------------- */
function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  const [msg, setMsg] = useState('');

  async function submit(e) {
    e.preventDefault();
    setState('sending');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) { setState('error'); setMsg(error.message); } else setState('sent');
  }

  return (
    <div className="login">
      <div className="card">
        <div className="row"><div className="mark">i</div><b className="brand" style={{ color: 'var(--ink)' }}>InsightGenius AI</b></div>
        <h1>Map your goals. Let AI chart the path.</h1>
        <p className="muted" style={{ margin: '0 0 22px' }}>Build a visual tree of your goals, track progress, and break any goal into clear next steps.</p>
        {state === 'sent' ? (
          <div className="note teal">Check <b>{email}</b> for a sign-in link. You can close this tab.</div>
        ) : (
          <form onSubmit={submit}>
            <div className="field">
              <label className="f" htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <button className="btn primary full" disabled={state === 'sending'}>
              {state === 'sending' ? <span className="spin" /> : 'Email me a sign-in link'}
            </button>
            {state === 'error' && <div className="note err" style={{ marginTop: 12 }}>{msg}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------- The goal tree app ---------------- */
function GoalApp({ session }) {
  const user = session.user;
  const [goals, setGoals] = useState([]);
  const [profile, setProfile] = useState({ suggestions: [], suggestions_stale: true });
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    (async () => {
      const [g, p] = await Promise.all([
        supabase.from('goals').select('*').order('created_at'),
        supabase.from('profiles').select('suggestions,suggestions_stale').eq('user_id', user.id).maybeSingle(),
      ]);
      if (g.error) setError('Could not load your goals: ' + g.error.message);
      setGoals(g.data || []);
      if (p.data) setProfile(p.data);
      setLoaded(true);
    })();
  }, [user.id]);

  const selected = goals.find((g) => g.id === selectedId) || null;

  // On phones the editor sits below the tree: bring it into view when a goal is tapped.
  useEffect(() => {
    if (selectedId && window.innerWidth < 960) document.querySelector('.side')?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedId]);

  async function markStale() {
    if (profile.suggestions_stale) return;
    setProfile((p) => ({ ...p, suggestions_stale: true }));
    await supabase.from('profiles').upsert({ user_id: user.id, suggestions_stale: true });
  }

  async function addGoal(title, category, parentId = null) {
    const { data, error } = await supabase.from('goals')
      .insert({ title, category, parent_id: parentId }).select().single();
    if (error) return setError(error.message);
    setGoals((gs) => [...gs, data]);
    if (!parentId) setSelectedId(data.id);
    markStale();
    return data;
  }

  async function updateGoal(id, patch) {
    setGoals((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    const { error } = await supabase.from('goals').update(patch).eq('id', id);
    if (error) setError('Could not save: ' + error.message);
    markStale();
  }

  async function deleteGoal(goal) {
    if (!window.confirm(`Delete “${goal.title}” and every step beneath it?`)) return;
    const { error } = await supabase.from('goals').delete().eq('id', goal.id);
    if (error) return setError(error.message);
    // mirror the database's cascade locally
    const gone = new Set([goal.id]);
    let grew = true;
    while (grew) { grew = false; for (const g of goals) if (g.parent_id && gone.has(g.parent_id) && !gone.has(g.id)) { gone.add(g.id); grew = true; } }
    setGoals((gs) => gs.filter((g) => !gone.has(g.id)));
    setSelectedId(null);
    markStale();
  }

  async function callAI(body) {
    const { data } = await supabase.auth.getSession(); // always send a fresh token
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (typeof json.remaining === 'number') setRemaining(json.remaining);
    if (!res.ok) throw new Error(json.error || 'Something went wrong.');
    return json;
  }

  async function breakDown(goal) {
    setBusy((b) => ({ ...b, breakdown: true })); setError('');
    try {
      const { goals: added } = await callAI({ action: 'breakdown', goalId: goal.id });
      setGoals((gs) => [...gs, ...added]);
      setProfile((p) => ({ ...p, suggestions_stale: true }));
    } catch (e) { setError(e.message); }
    setBusy((b) => ({ ...b, breakdown: false }));
  }

  async function suggest() {
    setBusy((b) => ({ ...b, suggest: true })); setError('');
    try {
      const { suggestions } = await callAI({ action: 'suggest' });
      setProfile({ suggestions, suggestions_stale: false });
    } catch (e) { setError(e.message); }
    setBusy((b) => ({ ...b, suggest: false }));
  }

  return (
    <>
      <header className="topbar">
        <div className="mark">i</div><div className="brand">InsightGenius AI</div>
        <div className="spacer" />
        <span className="email">{user.email}</span>
        <button className="btn sm dark-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      <div className="wrap">
        <div className="head">
          <div>
            <h1>Goal tree</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>Click any goal to edit it. Changes mark your suggestions as out of date.</p>
          </div>
          <div className="spacer" />
          <div className="legend"><span><i style={{ background: '#5B4BB7' }} />Long-term</span><span><i style={{ background: '#D9692F' }} />Short-term</span><span><i style={{ background: '#2F6F62' }} />Progress</span></div>
        </div>

        {error && <div className="note err" style={{ marginBottom: 14 }} role="alert">{error} <button className="btn ghost sm" onClick={() => setError('')}>Dismiss</button></div>}

        <div className="layout">
          <div className="tree">
            {loaded
              ? <GoalTree goals={goals} name={user.email.split('@')[0]} selectedId={selectedId} onSelect={setSelectedId} />
              : <div className="empty"><span className="spin" /></div>}
          </div>

          <aside className="side">
            <div className="card">
              {selected
                ? <GoalEditor key={selected.id} goal={selected} childCount={goals.filter((g) => g.parent_id === selected.id).length}
                    busy={busy.breakdown} onClose={() => setSelectedId(null)} onUpdate={(patch) => updateGoal(selected.id, patch)}
                    onAddStep={(t) => addGoal(t, 'short', selected.id)} onBreakDown={() => breakDown(selected)} onDelete={() => deleteGoal(selected)} />
                : <NewGoal onAdd={addGoal} />}
            </div>

            <div className="card">
              <div className="card-h">
                <h2 style={{ flex: 1 }}>Suggested next steps</h2>
                <button className="btn sm" onClick={suggest} disabled={busy.suggest}>
                  {busy.suggest ? <span className="spin" /> : profile.suggestions.length ? 'Refresh' : 'Generate'}
                </button>
              </div>
              {profile.suggestions_stale && profile.suggestions.length > 0 && (
                <div className="note teal" style={{ marginBottom: 12 }}>Your goals changed since these were generated. Refresh for updated suggestions.</div>
              )}
              {profile.suggestions.length === 0
                ? <div className="empty">Get AI suggestions tailored to your goal tree.</div>
                : profile.suggestions.map((s, i) => (
                    <div className="sugg" key={i}>
                      <b>{s.title}</b>
                      <div className="small muted" style={{ margin: '2px 0 8px' }}>{s.why}</div>
                      <button className="btn sm" onClick={() => addGoal(s.title, 'short')}>+ Add as goal</button>
                    </div>
                  ))}
              {remaining !== null && <p className="small muted" style={{ margin: '12px 0 0' }}>{remaining} AI request{remaining === 1 ? '' : 's'} left in this window</p>}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function NewGoal({ onAdd }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('long');
  async function submit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    await onAdd(t, category);
    setTitle('');
  }
  return (
    <form onSubmit={submit}>
      <h2 style={{ marginBottom: 6 }}>Add a goal</h2>
      <p className="small muted" style={{ margin: '0 0 14px' }}>Top-level goals branch from your journey. Select a goal to add steps beneath it.</p>
      <div className="field"><input type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Move into a product management role" aria-label="Goal title" /></div>
      <div className="field chips">
        <button type="button" className={`chip ${category === 'long' ? 'on' : ''}`} onClick={() => setCategory('long')}>Long-term</button>
        <button type="button" className={`chip ${category === 'short' ? 'on' : ''}`} onClick={() => setCategory('short')}>Short-term</button>
      </div>
      <button className="btn primary full">+ Add goal</button>
      <div className="note" style={{ marginTop: 16 }}>Tip: add a big goal, select it, then use <b>AI: break it down</b> to generate a step-by-step path.</div>
    </form>
  );
}

function GoalEditor({ goal, childCount, busy, onClose, onUpdate, onAddStep, onBreakDown, onDelete }) {
  const [title, setTitle] = useState(goal.title);
  const [notes, setNotes] = useState(goal.notes || '');
  const [progress, setProgress] = useState(goal.progress);
  const [step, setStep] = useState('');
  const done = goal.progress >= 100;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={`pill ${goal.category}`}>{goal.category === 'long' ? 'Long-term' : 'Short-term'}</span>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={onClose} aria-label="Close editor">✕</button>
      </div>

      <div className="field">
        <label className="f" htmlFor="gt">Goal</label>
        <input id="gt" type="text" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { const t = title.trim(); if (t && t !== goal.title) onUpdate({ title: t }); else setTitle(goal.title); }} />
      </div>

      <div className="field">
        <label className="f">Type</label>
        <div className="chips">
          <button className={`chip ${goal.category === 'long' ? 'on' : ''}`} onClick={() => onUpdate({ category: 'long' })}>Long-term</button>
          <button className={`chip ${goal.category === 'short' ? 'on' : ''}`} onClick={() => onUpdate({ category: 'short' })}>Short-term</button>
        </div>
      </div>

      <div className="field">
        <label className="f" htmlFor="gp">Progress: {progress}%</label>
        <input id="gp" type="range" min="0" max="100" step="5" value={progress}
          onChange={(e) => setProgress(+e.target.value)}
          onPointerUp={() => progress !== goal.progress && onUpdate({ progress })}
          onKeyUp={() => progress !== goal.progress && onUpdate({ progress })} />
      </div>

      <div className="field">
        <label className="f" htmlFor="gn">Notes</label>
        <textarea id="gn" maxLength={2000} value={notes} placeholder="What does success look like? Any blockers?"
          onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (goal.notes || '') && onUpdate({ notes })} />
      </div>

      <button className="btn accent full" onClick={onBreakDown} disabled={busy} style={{ marginBottom: 10 }}>
        {busy ? <><span className="spin" /> Thinking…</> : '✦ AI: break it down'}
      </button>

      <form className="row" style={{ marginBottom: 12, flexWrap: 'nowrap' }}
        onSubmit={(e) => { e.preventDefault(); const t = step.trim(); if (t) { onAddStep(t); setStep(''); } }}>
        <input type="text" maxLength={200} value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step yourself…" aria-label="New step" />
        <button className="btn">Add</button>
      </form>

      <div className="row">
        <button className="btn sm" onClick={() => { const p = done ? 90 : 100; setProgress(p); onUpdate({ progress: p }); }}>
          {done ? 'Mark not done' : '✓ Mark complete'}
        </button>
        <div className="spacer" />
        <button className="btn sm ghost danger" onClick={onDelete}>Delete</button>
      </div>
      {childCount > 0 && <p className="small muted" style={{ margin: '12px 0 0' }}>{childCount} step{childCount > 1 ? 's' : ''} beneath this goal</p>}
    </div>
  );
}
