import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Shared helpers for the server-only AI routes. Nothing here is sent to the browser.

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const LIMIT = Number(process.env.AI_LIMIT_PER_WINDOW || 10);
export const WINDOW_HOURS = Number(process.env.AI_LIMIT_WINDOW_HOURS || 3);

export const SYSTEM =
  'You are InsightGenius AI, a warm, practical personal-growth coach. ' +
  'You turn goals into specific, achievable actions. Keep every title concise and concrete. ' +
  'Never invent facts such as names, dates, prices or contacts: if you are unsure whether something exists, leave it out.';

export const GOAL_COLUMNS = 'id,parent_id,title,category,progress,notes,resources,result,created_at';

let anthropic; // created on first use so builds don't need the key
export function claude() {
  anthropic ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export const reply = (body, status = 200) => Response.json(body, { status });

/** Verifies the member's Supabase token and returns a client that acts as them (RLS applies). */
export async function authenticate(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: reply({ error: 'Please sign in.' }, 401) };
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } = {}, error } = await db.auth.getUser(token);
  if (error || !user) return { error: reply({ error: 'Your session expired. Please sign in again.' }, 401) };
  return { db, user };
}

/** Fair-use limit (e.g. 10 requests per 3 hours). Returns { used } or { error }. */
export async function checkLimit(db) {
  const since = new Date(Date.now() - WINDOW_HOURS * 3600e3).toISOString();
  const { count, error } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since);
  if (error) return { error: reply({ error: 'Could not check your usage. Try again.', detail: error.message }, 500) };
  if (count >= LIMIT) {
    return { error: reply({ error: `You've used ${LIMIT} AI requests in the last ${WINDOW_HOURS} hours. Please try again later.`, remaining: 0 }, 429) };
  }
  return { used: count };
}

export async function logUsage(db, action) {
  await db.from('ai_usage').insert({ action });
}

export async function loadGoals(db) {
  const { data, error } = await db.from('goals').select(GOAL_COLUMNS).order('created_at');
  if (error) throw Object.assign(new Error('Could not load your goals.'), { detail: error.message });
  return data;
}

/** Asks Claude for JSON that matches `schema` (structured outputs). */
export async function askJSON({ prompt, schema, effort = 'medium', maxTokens = 8000, signal }) {
  const msg = await claude().messages.create(
    {
      model: MODEL,
      max_tokens: maxTokens,
      system: SYSTEM,
      output_config: { effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: prompt }],
    },
    { signal },
  );
  if (msg.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request.'), { detail: 'refusal' });
  if (msg.stop_reason === 'max_tokens') throw Object.assign(new Error('The AI answer was too long.'), { detail: 'max_tokens' });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error('The AI answer could not be read.'), { detail: 'invalid JSON' });
  }
}

/** Turns an error into a friendly message plus the technical reason. */
export function aiError(err) {
  console.error('AI route error:', err);
  const status = err?.status;
  if (status === 429 || status === 529 || err instanceof Anthropic.RateLimitError) {
    return reply({ error: 'The AI is busy right now. Please try again in a minute.', detail: `${status || 429}` }, 503);
  }
  const detail = err?.detail || (status ? `${status} ${err?.error?.error?.message || err.message || ''}`.trim() : err?.message);
  return reply({ error: err?.detail ? err.message : 'Something went wrong with the AI. Please try again.', detail }, 500);
}

/* ---------------- tree helpers ---------------- */

export function indexTree(goals) {
  const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
  const kids = {};
  for (const g of goals) {
    const p = g.parent_id && byId[g.parent_id] ? g.parent_id : 'root';
    (kids[p] ||= []).push(g);
  }
  const pathOf = (g) => {
    const out = [];
    let cur = g;
    while (cur) { out.unshift(cur.title); cur = cur.parent_id && byId[cur.parent_id]; }
    return out.join(' > ');
  };
  return { byId, kids, pathOf };
}

/** Indented outline of the whole tree, for context. */
export function describeTree(goals) {
  if (!goals.length) return '(no goals yet)';
  const { kids } = indexTree(goals);
  const lines = [];
  (function walk(id, depth) {
    for (const g of kids[id] || []) {
      lines.push(`${'  '.repeat(depth)}- ${g.title} [${g.category === 'long' ? 'long-term' : 'short-term'}, ${g.progress}%]${g.notes ? ` (notes: ${g.notes.slice(0, 300)})` : ''}`);
      walk(g.id, depth + 1);
    }
  })('root', 0);
  return lines.join('\n');
}

export const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export const RESOURCE_TYPES = ['video', 'class', 'training', 'school', 'event / expo', 'book', 'community', 'tool'];

export function cleanResources(list, max) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && r.name)
    .slice(0, max)
    .map((r) => ({
      type: RESOURCE_TYPES.includes(r.type) ? r.type : 'tool',
      name: clean(r.name, 160),
      why: clean(r.why, 300),
      query: clean(r.query || r.name, 160),
    }));
}
