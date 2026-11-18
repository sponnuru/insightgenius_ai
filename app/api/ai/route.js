import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

// Server-only route: the Claude API key never reaches the browser.
export const runtime = 'nodejs';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const LIMIT = Number(process.env.AI_LIMIT_PER_WINDOW || 10);
const WINDOW_HOURS = Number(process.env.AI_LIMIT_WINDOW_HOURS || 3);

let anthropic; // created on first use so builds don't need the key
const reply = (body, status = 200) => Response.json(body, { status });

export async function POST(req) {
  // 1. Who is calling? Verify the member's Supabase session token.
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return reply({ error: 'Please sign in.' }, 401);

  // This client acts *as the member*, so Row Level Security still applies.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user } = {}, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return reply({ error: 'Your session expired. Please sign in again.' }, 401);

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  if (!['breakdown', 'suggest'].includes(action)) return reply({ error: 'Unknown action.' }, 400);

  // 2. Fair-use limit (e.g. 10 requests per 3 hours).
  const since = new Date(Date.now() - WINDOW_HOURS * 3600e3).toISOString();
  const { count, error: countErr } = await db.from('ai_usage').select('id', { count: 'exact', head: true }).gte('created_at', since);
  if (countErr) return reply({ error: 'Could not check your usage. Try again.' }, 500);
  if (count >= LIMIT) return reply({ error: `You've used ${LIMIT} AI requests in the last ${WINDOW_HOURS} hours. Please try again later.`, remaining: 0 }, 429);

  // 3. Read the member's goals from the database (never trust goal text sent by the browser).
  const { data: goals, error: goalsErr } = await db.from('goals').select('id,parent_id,title,category,progress,notes').order('created_at');
  if (goalsErr) return reply({ error: 'Could not load your goals.' }, 500);
  const context = describeGoals(goals);

  try {
    if (action === 'breakdown') {
      const goal = goals.find((g) => g.id === body.goalId);
      if (!goal) return reply({ error: 'Goal not found.' }, 404);
      const existing = goals.filter((g) => g.parent_id === goal.id).map((g) => g.title);

      const { steps } = await askClaude({
        tool: 'save_steps',
        description: 'Save 3-5 sequential milestones for the goal.',
        schema: {
          type: 'object',
          properties: {
            steps: {
              type: 'array', minItems: 3, maxItems: 5,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Imperative milestone, max 10 words' },
                  category: { type: 'string', enum: ['short', 'long'] },
                },
                required: ['title', 'category'],
              },
            },
          },
          required: ['steps'],
        },
        prompt:
          `Break this goal into 3-5 concrete, sequential milestones the member can act on.\n\n` +
          `Goal to break down: "${goal.title}"` +
          (goal.notes ? `\nMember's notes: ${goal.notes}` : '') +
          (existing.length ? `\nSteps that already exist (don't repeat them): ${existing.join('; ')}` : '') +
          `\n\nThe member's full goal tree, for context:\n${context}`,
      });

      const rows = (steps || []).slice(0, 5).filter((s) => s && s.title).map((s) => ({
        parent_id: goal.id,
        title: String(s.title).slice(0, 200),
        category: s.category === 'long' ? 'long' : 'short',
      }));
      const { data: inserted, error } = await db.from('goals').insert(rows).select();
      if (error) throw error;
      await logUsage(db, action);
      await db.from('profiles').upsert({ user_id: user.id, suggestions_stale: true });
      return reply({ goals: inserted, remaining: LIMIT - count - 1 });
    }

    if (action === 'suggest') {
      const { suggestions } = await askClaude({
        tool: 'save_suggestions',
        description: 'Save the 3 most valuable next steps for this week.',
        schema: {
          type: 'object',
          properties: {
            suggestions: {
              type: 'array', minItems: 1, maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Short imperative step, max 12 words' },
                  why: { type: 'string', description: 'One sentence on why this matters now' },
                },
                required: ['title', 'why'],
              },
            },
          },
          required: ['suggestions'],
        },
        prompt: `Recommend the 3 most valuable, specific next steps for this member's coming week, based on their goals and progress. Avoid generic advice.\n\nGoal tree:\n${context}`,
      });

      const clean = (suggestions || []).slice(0, 3).map((s) => ({ title: String(s.title).slice(0, 200), why: String(s.why || '').slice(0, 400) }));
      const { error } = await db.from('profiles').upsert({ user_id: user.id, suggestions: clean, suggestions_stale: false });
      if (error) throw error;
      await logUsage(db, action);
      return reply({ suggestions: clean, remaining: LIMIT - count - 1 });
    }
  } catch (err) {
    console.error('AI route error:', err);
    const busy = err?.status === 429 || err?.status === 529;
    return reply({ error: busy ? 'The AI is busy right now. Please try again in a minute.' : 'Something went wrong generating that. Please try again.' }, busy ? 503 : 500);
  }
}

async function askClaude({ tool, description, schema, prompt }) {
  anthropic ||= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      'You are InsightGenius AI, a warm, practical personal-growth coach. ' +
      'You turn goals into specific, achievable actions. Keep every title concise and concrete.',
    tools: [{ name: tool, description, input_schema: schema }],
    tool_choice: { type: 'tool', name: tool },   // forces structured JSON output
    messages: [{ role: 'user', content: prompt }],
  });
  const block = msg.content.find((b) => b.type === 'tool_use');
  if (!block) throw new Error('No structured output returned');
  return block.input;
}

async function logUsage(db, action) {
  await db.from('ai_usage').insert({ action });
}

function describeGoals(goals) {
  if (!goals.length) return '(no goals yet)';
  const byId = Object.fromEntries(goals.map((g) => [g.id, g]));
  return goals.map((g) => {
    const parent = g.parent_id && byId[g.parent_id];
    return `- ${g.title} [${g.category === 'long' ? 'long-term' : 'short-term'}, ${g.progress}% done${parent ? `, step of "${parent.title}"` : ''}]${g.notes ? ` — notes: ${g.notes}` : ''}`;
  }).join('\n');
}
