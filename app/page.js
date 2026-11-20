'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import GoalTree, { buildTree } from '../components/GoalTree';
import { AddGoalPanel, AgentPanel, ConfirmDialog, EditPanel, MyDataCard, PlanCard, ResourcesPanel, todayKey } from '../components/Panels';
import Galaxy from '../components/Galaxy';
import Confetti from '../components/Confetti';

const GOAL_COLUMNS = 'id,parent_id,title,category,progress,notes,resources,result,created_at';
const DEFAULT_SETTINGS = { theme: 'dark', collapsed: [], steps: 5, plan: null, planHours: 3, seeded: false, view: 'tree', signals: null, dirSig: null };

/** A short signature of the goal list (ids and titles), used to tell when "My data" directions are out of date. */
function goalsSig(goals) {
  const str = goals.map((g) => `${g.id}:${g.title}`).sort().join('|');
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return String(h >>> 0);
}
const THEME_KEY = 'ig-theme';

const readLocal = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeLocal = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
// Data from storage may come back read-only, so always work on a deep copy.
const deepCopy = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  writeLocal(THEME_KEY, theme === 'light' ? 'light' : 'dark');
}

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="login"><span className="spin" /></div>;
  if (!session) return <Login />;
  return <GoalApp key={session.user.id} session={session} />;
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
        <div className="row"><div className="mark">i</div><b className="brand">InsightGenius AI</b></div>
        <h1>Map your goals. Let AI chart the path.</h1>
        <p className="muted" style={{ margin: '0 0 22px' }}>Build a visual tree of your goals, let AI break them into steps, and get a plan for your day.</p>
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
  const localKey = `ig-goal-tree:${user.id}`;

  const [goals, setGoals] = useState([]);
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, theme: readLocal(THEME_KEY) || 'dark' }));
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [saveState, setSaveState] = useState('saved'); // saved | saving | local
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(null);
  const [busyBreak, setBusyBreak] = useState(() => new Set());
  const [busyRes, setBusyRes] = useState(() => new Set());
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [planOpen, setPlanOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [run, setRun] = useState(null); // { goalId, running, log, error }
  const [confirm, setConfirm] = useState(null);
  const [sources, setSources] = useState([]);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataBusy, setDataBusy] = useState({ dir: false, impact: false });
  const [reducedMotion, setReducedMotion] = useState(false);

  const goalsRef = useRef(goals); goalsRef.current = goals;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const sourcesRef = useRef(sources); sourcesRef.current = sources;
  const pending = useRef({ goals: new Map(), settings: false, sources: false });
  const galaxyRef = useRef(null);
  const confettiRef = useRef(null);
  const queue = useRef(Promise.resolve());
  const timer = useRef(null);
  const agentAbort = useRef(null);
  const treeRef = useRef(null);

  /* ----- saving: debounced, one write at a time, flushed when the page is hidden ----- */
  const enqueue = useCallback((fn) => {
    const p = queue.current.then(fn).catch((e) => {
      setSaveState('local');
      setError('Could not save to your account (' + (e?.message || e) + '). Your changes are kept in this browser.');
    });
    queue.current = p;
    return p;
  }, []);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const goalPatches = pending.current.goals;
    const settingsDirty = pending.current.settings;
    const sourcesDirty = pending.current.sources;
    pending.current = { goals: new Map(), settings: false, sources: false };
    if (!goalPatches.size && !settingsDirty && !sourcesDirty) return queue.current;
    return enqueue(async () => {
      for (const [id, patch] of goalPatches) {
        const { error } = await supabase.from('goals').update(patch).eq('id', id);
        if (error) throw error;
      }
      if (settingsDirty) {
        const { error } = await supabase.from('profiles').upsert({ user_id: user.id, settings: settingsRef.current });
        if (error) throw error;
      }
      if (sourcesDirty) {
        const { error } = await supabase.from('member_data').upsert({ user_id: user.id, sources: sourcesRef.current });
        if (error) throw error;
      }
      if (!pending.current.goals.size && !pending.current.settings && !pending.current.sources) setSaveState('saved');
    });
  }, [enqueue, user.id]);

  const schedule = useCallback(() => {
    setSaveState('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [flush]);

  // Keep a copy in this browser as a fallback.
  useEffect(() => { if (loaded) writeLocal(localKey, { goals, settings }); }, [goals, settings, loaded, localKey]);
  useEffect(() => { applyTheme(settings.theme); }, [settings.theme]);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const on = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  /* ----- load ----- */
  useEffect(() => {
    (async () => {
      const [g, p, d] = await Promise.all([
        supabase.from('goals').select(GOAL_COLUMNS).eq('user_id', user.id).order('created_at'),
        supabase.from('profiles').select('settings').eq('user_id', user.id).maybeSingle(),
        supabase.from('member_data').select('sources').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!d.error && Array.isArray(d.data?.sources)) setSources(deepCopy(d.data.sources));
      if (g.error) {
        const local = deepCopy(readLocal(localKey));
        setError('Could not load your goals from your account (' + g.error.message + ').' + (local ? ' Showing the copy saved in this browser.' : ''));
        if (local) { setGoals(local.goals || []); setSettings((s) => ({ ...s, ...local.settings })); }
        setSaveState('local');
        setLoaded(true);
        return;
      }
      const rows = deepCopy(g.data) || [];
      const saved = deepCopy(p.data?.settings) || {};
      const merged = { ...DEFAULT_SETTINGS, theme: readLocal(THEME_KEY) || 'dark', ...saved };
      setSettings(merged);
      settingsRef.current = merged;
      setGoals(rows);
      setLoaded(true);
      if (!rows.length && !merged.seeded) seedStarter();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  function seedStarter() {
    const root = { id: crypto.randomUUID(), parent_id: null, title: 'Move into a product management role', category: 'long', progress: 10, notes: '' };
    const kids = [
      ['Learn product management fundamentals', 40],
      ['Build a portfolio of product work', 0],
      ['Network with product managers and apply', 0],
    ].map(([title, progress]) => ({ id: crypto.randomUUID(), parent_id: root.id, title, category: 'short', progress, notes: '' }));
    const now = new Date().toISOString();
    setGoals([root, ...kids].map((r) => ({ ...r, resources: null, result: null, created_at: now })));
    updateSettings({ seeded: true });
    enqueue(async () => {
      const a = await supabase.from('goals').insert(root);
      if (a.error) throw a.error;
      const b = await supabase.from('goals').insert(kids);
      if (b.error) throw b.error;
    });
  }

  /* ----- state helpers ----- */
  const updateSettings = useCallback((patch) => {
    setSettings((s) => { const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }; settingsRef.current = next; return next; });
    pending.current.settings = true;
    schedule();
  }, [schedule]);

  const updateGoal = useCallback((id, patch) => {
    const before = goalsRef.current.find((g) => g.id === id);
    if (before && before.progress < 100 && patch.progress >= 100) celebrate(id);
    setGoals((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    const prev = pending.current.goals.get(id) || {};
    pending.current.goals.set(id, { ...prev, ...patch });
    schedule();
  }, [schedule]);

  function celebrate(id) {
    setTimeout(() => {
      let pt = null;
      if (settingsRef.current.view === 'galaxy') pt = galaxyRef.current?.screenPos(id);
      else {
        const r = treeRef.current?.querySelector(`[data-node="${id}"] .bg`)?.getBoundingClientRect();
        if (r) pt = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      if (pt) confettiRef.current?.fire(pt.x, pt.y);
    }, 30);
  }

  const updateSources = useCallback((list) => {
    setSources(list);
    sourcesRef.current = list;
    pending.current.sources = true;
    schedule();
  }, [schedule]);

  async function updateDirections() {
    setError('');
    setDataBusy((b) => ({ ...b, dir: true }));
    try {
      await flush();
      const { directions } = await callAI({ action: 'directions' });
      const byId = Object.fromEntries(directions.map((d) => [d.id, d.direction]));
      updateSources(sourcesRef.current.map((s) => (s.id in byId ? { ...s, direction: byId[s.id] } : s)));
      updateSettings({ dirSig: goalsSig(goalsRef.current) });
    } catch (e) { setError(e.message); }
    setDataBusy((b) => ({ ...b, dir: false }));
  }

  async function analyzeImpact() {
    setError('');
    setDataBusy((b) => ({ ...b, impact: true }));
    try {
      await flush();
      const { signals } = await callAI({ action: 'impact' });
      updateSettings({ signals: { ...signals, at: new Date().toISOString(), sig: goalsSig(goalsRef.current) } });
    } catch (e) { setError(e.message); }
    setDataBusy((b) => ({ ...b, impact: false }));
  }

  const mergeGoals = (rows) => setGoals((gs) => {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const kept = gs.map((g) => (byId.has(g.id) ? { ...g, ...byId.get(g.id) } : g));
    const fresh = rows.filter((r) => !gs.some((g) => g.id === r.id));
    return [...kept, ...deepCopy(fresh)];
  });

  const flash = (ids) => {
    setFlashIds((s) => new Set([...s, ...ids]));
    setTimeout(() => setFlashIds((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; }), 1000);
  };

  const scrollToNode = (id) => setTimeout(() => {
    treeRef.current?.querySelector(`[data-node="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, 60);

  const expand = (ids) => updateSettings((s) => ({ collapsed: s.collapsed.filter((c) => !ids.includes(c)) }));

  const ancestorsOf = (id) => {
    const byId = Object.fromEntries(goalsRef.current.map((g) => [g.id, g]));
    const out = [];
    let cur = byId[id];
    while (cur?.parent_id && byId[cur.parent_id]) { out.push(cur.parent_id); cur = byId[cur.parent_id]; }
    return out;
  };

  function addGoal(title, category, parentId = null) {
    const row = { id: crypto.randomUUID(), parent_id: parentId, title, category, progress: 0, notes: '' };
    setGoals((gs) => [...gs, { ...row, resources: null, result: null, created_at: new Date().toISOString() }]);
    if (parentId) { expand([parentId]); scrollToNode(row.id); } else setSelectedId(row.id);
    flash([row.id]);
    setSaveState('saving');
    enqueue(async () => {
      const { error } = await supabase.from('goals').insert(row);
      if (error) throw error;
      if (!pending.current.goals.size && !pending.current.settings) setSaveState('saved');
    });
  }

  const { children, countDesc } = useMemo(() => buildTree(goals), [goals]);

  function deleteGoal(goal) {
    const gone = new Set([goal.id]);
    let grew = true;
    while (grew) { grew = false; for (const g of goalsRef.current) if (g.parent_id && gone.has(g.parent_id) && !gone.has(g.id)) { gone.add(g.id); grew = true; } }
    setGoals((gs) => gs.filter((g) => !gone.has(g.id)));
    gone.forEach((id) => pending.current.goals.delete(id));
    if (gone.has(selectedId)) setSelectedId(null);
    updateSettings((s) => ({ collapsed: s.collapsed.filter((c) => !gone.has(c)) }));
    enqueue(async () => {
      const { error } = await supabase.from('goals').delete().eq('id', goal.id); // the database removes its steps too
      if (error) throw error;
    });
    setConfirm(null);
  }

  /* ----- AI ----- */
  async function token() {
    const { data } = await supabase.auth.getSession(); // always send a fresh token
    return data.session?.access_token;
  }

  async function callAI(body) {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (typeof json.remaining === 'number') setRemaining(json.remaining);
    if (!res.ok) throw new Error((json.error || 'Something went wrong.') + (json.detail ? ` [${json.detail}]` : ''));
    return json;
  }

  async function fetchResources(ids, auto) {
    setBusyRes((s) => new Set([...s, ...ids]));
    try {
      const { updated } = await callAI({ action: 'resources', goalIds: ids, auto });
      mergeGoals(updated);
    } finally {
      setBusyRes((s) => { const n = new Set(s); ids.forEach((i) => n.delete(i)); return n; });
    }
  }

  async function breakDown(goal) {
    if (busyBreak.has(goal.id)) return;
    setError('');
    setBusyBreak((s) => new Set(s).add(goal.id));
    try {
      await flush(); // make sure the goal is saved before the server reads it
      const { goals: added } = await callAI({ action: 'breakdown', goalId: goal.id, count: settingsRef.current.steps });
      mergeGoals(added);
      expand([goal.id, ...ancestorsOf(goal.id)]);
      flash(added.map((g) => g.id));
      scrollToNode(added[0]?.id || goal.id);
      // Resources come separately, in the background, four steps per request.
      (async () => {
        for (let i = 0; i < added.length; i += 4) {
          try { await fetchResources(added.slice(i, i + 4).map((g) => g.id), true); }
          catch (e) { setError('Steps added, but resources could not be fetched. ' + e.message); break; }
        }
      })();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyBreak((s) => { const n = new Set(s); n.delete(goal.id); return n; });
    }
  }

  async function findResources(goal) {
    setError('');
    try { await flush(); await fetchResources([goal.id], false); } catch (e) { setError(e.message); }
  }

  async function runAgent(goal, instruction) {
    if (run?.running) return;
    setError('');
    const controller = new AbortController();
    agentAbort.current = controller;
    setRun({ goalId: goal.id, running: true, log: [], error: '' });
    const addLog = (text) => setRun((r) => (r ? { ...r, log: [...r.log, text] } : r));
    try {
      await flush();
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ goalId: goal.id, instruction }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        if (typeof json.remaining === 'number') setRemaining(json.remaining);
        throw new Error((json.error || 'The agent could not start.') + (json.detail ? ` [${json.detail}]` : ''));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (typeof ev.remaining === 'number') setRemaining(ev.remaining);
          if (ev.type === 'log') addLog(ev.text);
          if (ev.type === 'done') {
            setGoals((gs) => gs.map((g) => (g.id === goal.id ? { ...g, result: ev.result } : g)));
            if (ev.added?.length) { mergeGoals(ev.added); expand([goal.id]); flash(ev.added.map((g) => g.id)); }
          }
          if (ev.type === 'error') throw new Error(ev.error + (ev.detail ? ` [${ev.detail}]` : ''));
        }
      }
      setRun((r) => (r ? { ...r, running: false } : r));
    } catch (e) {
      const stopped = e?.name === 'AbortError';
      setRun((r) => (r ? { ...r, running: false, error: stopped ? 'Stopped' : e.message, log: [...r.log, stopped ? 'Stopped' : 'Failed'] } : r));
      if (!stopped) setError(e.message);
    } finally {
      agentAbort.current = null;
    }
  }

  function setActionStatus(goal, actionId, status) {
    const result = deepCopy(goal.result);
    result.actions = result.actions.map((a) => (a.id === actionId ? { ...a, status } : a));
    updateGoal(goal.id, { result });
  }

  async function planDay(hours, start) {
    setError('');
    setPlanBusy(true);
    try {
      await flush();
      const { plan } = await callAI({ action: 'plan', hours });
      updateSettings({
        planHours: hours,
        plan: { date: todayKey(), start, hours, focus: plan.focus, items: plan.items.map((i) => ({ id: crypto.randomUUID(), ...i, done: false })) },
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setPlanBusy(false);
    }
  }

  function reveal(id) {
    expand(ancestorsOf(id));
    setSelectedId(id);
    scrollToNode(id);
  }

  function toggle(id) {
    updateSettings((s) => ({ collapsed: s.collapsed.includes(id) ? s.collapsed.filter((c) => c !== id) : [...s.collapsed, id] }));
    scrollToNode(id);
  }

  function collapseAll() {
    updateSettings({ collapsed: goals.filter((g) => (children[g.id] || []).length).map((g) => g.id) });
  }

  function openAgent(goal) {
    setSelectedId(goal.id);
    setTimeout(() => document.getElementById('agent-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
  }

  const selected = goals.find((g) => g.id === selectedId) || null;
  const parent = selected?.parent_id ? goals.find((g) => g.id === selected.parent_id) : null;
  const collapsed = useMemo(() => new Set(settings.collapsed), [settings.collapsed]);
  const busyIds = useMemo(() => new Set([...busyBreak, ...(run?.running ? [run.goalId] : [])]), [busyBreak, run]);
  const signalMap = useMemo(() => Object.fromEntries((settings.signals?.items || []).map((i) => [i.goalId, i.trend])), [settings.signals]);
  const dataItem = selected ? settings.signals?.items?.find((i) => i.goalId === selected.id) : null;
  const dirStale = !!settings.dirSig && sources.length > 0 && settings.dirSig !== goalsSig(goals);
  const isGalaxy = settings.view === 'galaxy';
  const statusText = saveState === 'saving' ? 'Saving…' : saveState === 'local' ? 'Saved in this browser' : 'Saved to your account';

  return (
    <>
      <header className="topbar">
        <div className="mark">i</div><div className="brand">InsightGenius AI</div>
        <span className="save">{loaded ? statusText : ''}</span>
        <div className="spacer" />
        <button className="btn sm dark-ghost" onClick={() => updateSettings({ theme: settings.theme === 'light' ? 'dark' : 'light' })}>
          {settings.theme === 'light' ? '☾ Night mode' : '☀ Day mode'}
        </button>
        <button className="btn sm dark-ghost" onClick={async () => { await flush(); supabase.auth.signOut(); }} title={user.email}>Sign out</button>
      </header>

      <div className="wrap">
        <div className="toolbar">
          {!isGalaxy && <button className="btn sm" onClick={collapseAll}>Collapse all</button>}
          <button className="btn sm teal" onClick={() => setPlanOpen(true)}>Plan my day</button>
          <button className="btn sm" onClick={() => updateSettings({ view: isGalaxy ? 'tree' : 'galaxy' })}>{isGalaxy ? 'Tree view' : '3D view'}</button>
          <button className="btn sm" onClick={() => setDataOpen((o) => !o)}>My data</button>
        </div>

        {error && (
          <div className="note err" role="alert" style={{ marginBottom: 14 }}>
            {error} <button className="btn ghost sm" onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {planOpen && (
          <PlanCard plan={settings.plan} hours={settings.planHours} goals={goals} busy={planBusy}
            onPlan={planDay} onReveal={reveal} onClose={() => setPlanOpen(false)}
            onToggle={(itemId) => updateSettings((s) => ({ plan: { ...s.plan, items: s.plan.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)) } }))} />
        )}

        {dataOpen && (
          <MyDataCard sources={sources} signals={settings.signals} goals={goals} dirStale={dirStale} busy={dataBusy}
            onChange={updateSources} onDirections={updateDirections} onAnalyze={analyzeImpact} onReveal={reveal}
            onClose={() => setDataOpen(false)} onError={setError} />
        )}

        {isGalaxy && loaded ? (
          <div className="tree galaxy-pane">
            <Galaxy ref={galaxyRef} goals={goals} selectedId={selectedId} busyIds={busyBreak} agentId={run?.running ? run.goalId : null}
              signals={signalMap} onSelect={setSelectedId} reducedMotion={reducedMotion} />
          </div>
        ) : (
          <div className="tree" ref={treeRef}>
            {loaded ? (
              <GoalTree goals={goals} name={settings.name || 'You'} selectedId={selectedId} collapsed={collapsed}
                busyIds={busyIds} flashIds={flashIds} signals={signalMap} onSelect={setSelectedId} onToggle={toggle}
                onDelete={(g) => setConfirm(g)} onDo={openAgent} onBreak={breakDown} />
            ) : <div className="empty"><span className="spin" /></div>}
          </div>
        )}

        <div className="panels">
          {selected ? (
            <>
              <EditPanel key={selected.id} goal={selected} parent={parent} childCount={(children[selected.id] || []).length}
                steps={settings.steps} busy={busyBreak.has(selected.id)} remaining={remaining} dataItem={dataItem}
                onSetSteps={(n) => updateSettings({ steps: n })} onUpdate={(patch) => updateGoal(selected.id, patch)}
                onBreak={() => breakDown(selected)} onAddStep={(t) => addGoal(t, 'short', selected.id)}
                onDelete={() => setConfirm(selected)} onClose={() => setSelectedId(null)} />
              <ResourcesPanel goal={selected} busy={busyRes.has(selected.id)} onFind={() => findResources(selected)} />
              <AgentPanel key={'a' + selected.id} goal={selected} run={run} onRun={(text) => runAgent(selected, text)}
                onStop={() => agentAbort.current?.abort()} onAction={(id, status) => setActionStatus(selected, id, status)} />
            </>
          ) : (
            <AddGoalPanel onAdd={addGoal} />
          )}
        </div>
      </div>

      <Confetti ref={confettiRef} />
      {confirm && <ConfirmDialog goal={confirm} count={countDesc(confirm.id)} onCancel={() => setConfirm(null)} onConfirm={() => deleteGoal(confirm)} />}
    </>
  );
}
