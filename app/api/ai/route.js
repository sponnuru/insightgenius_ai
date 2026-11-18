import {
  LIMIT, RESOURCE_TYPES, aiError, askJSON, authenticate, checkLimit, clean, cleanResources,
  describeTree, indexTree, loadGoals, logUsage, reply, GOAL_COLUMNS,
} from '../../../lib/server/ai';

// Server-only route: the Claude API key never reaches the browser.
export const runtime = 'nodejs';
export const maxDuration = 120;

const AUTO_RESOURCE_WINDOW_MS = 20 * 60e3; // resources for brand-new AI steps don't use up a request

export async function POST(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const { db, user } = auth;

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  if (!['breakdown', 'resources', 'plan'].includes(action)) return reply({ error: 'Unknown action.' }, 400);

  const limit = await checkLimit(db);
  if (limit.error) return limit.error;
  const remainingAfter = LIMIT - limit.used - 1;

  try {
    // Always read goals from the database: never trust goal text sent by the browser.
    const goals = await loadGoals(db);

    if (action === 'breakdown') return await breakdown({ db, goals, body, remainingAfter, signal: req.signal });
    if (action === 'resources') return await resources({ db, goals, body, used: limit.used, signal: req.signal });
    if (action === 'plan') return await plan({ db, goals, body, remainingAfter, signal: req.signal });
  } catch (err) {
    return aiError(err);
  }
}

/* ---------------- ✦ Break it down ---------------- */
async function breakdown({ db, goals, body, remainingAfter, signal }) {
  const { byId, kids, pathOf } = indexTree(goals);
  const goal = byId[body.goalId];
  if (!goal) return reply({ error: 'Goal not found.' }, 404);
  const n = Math.min(15, Math.max(2, Math.round(Number(body.count) || 5)));
  const existing = (kids[goal.id] || []).map((g) => g.title);

  const { steps } = await askJSON({
    signal,
    schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Imperative milestone, at most 10 words' },
              category: { type: 'string', enum: ['short', 'long'] },
            },
            required: ['title', 'category'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
    prompt:
      `Break this goal into exactly ${n} concrete, sequential milestones the member can act on, in the order they should be done.\n\n` +
      `Goal: "${goal.title}"\nWhere it sits in the tree: ${pathOf(goal)}` +
      (goal.notes ? `\nMember's notes: ${goal.notes}` : '') +
      (existing.length
        ? `\nSteps that already exist under this goal (do not repeat them; the new steps should go deeper or cover what is missing): ${existing.join('; ')}`
        : '') +
      `\n\nThe member's whole goal tree, for context:\n${describeTree(goals)}`,
  });

  const rows = (steps || []).filter((s) => s && s.title).slice(0, n).map((s) => ({
    parent_id: goal.id,
    title: clean(s.title, 200),
    category: s.category === 'long' ? 'long' : 'short',
  }));
  if (!rows.length) throw Object.assign(new Error('The AI did not return any steps.'), { detail: 'empty' });
  const { data: inserted, error } = await db.from('goals').insert(rows).select(GOAL_COLUMNS);
  if (error) throw Object.assign(new Error('Could not save the new steps.'), { detail: error.message });
  await logUsage(db, 'breakdown');
  return reply({ goals: inserted, remaining: remainingAfter });
}

/* ---------------- Resources for one or more steps ---------------- */
async function resources({ db, goals, body, used, signal }) {
  const { byId, pathOf } = indexTree(goals);
  const ids = (Array.isArray(body.goalIds) ? body.goalIds : []).slice(0, 4);
  const targets = ids.map((id) => byId[id]).filter(Boolean);
  if (!targets.length) return reply({ error: 'Goal not found.' }, 404);

  // Background fetch right after ✦: free once per brand-new step. Everything else counts as a request.
  const now = Date.now();
  const free = body.auto === true && targets.every((g) => !g.resources && now - new Date(g.created_at).getTime() < AUTO_RESOURCE_WINDOW_MS);
  const perStep = free ? '2-3' : '6-8';
  const max = free ? 3 : 8;

  const { items } = await askJSON({
    signal,
    effort: 'low',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'integer', description: 'The step number from the list' },
              resources: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: RESOURCE_TYPES },
                    name: { type: 'string' },
                    why: { type: 'string', description: 'One short sentence on how it helps with this step' },
                    query: { type: 'string', description: 'A search query that finds this exact resource' },
                  },
                  required: ['type', 'name', 'why', 'query'],
                  additionalProperties: false,
                },
              },
            },
            required: ['step', 'resources'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
    prompt:
      `Suggest ${perStep} learning resources for each step below: videos, classes, trainings, schools, events or expos, books, communities or tools.\n` +
      `Name only real, well-known resources that you are confident exist. Do not invent names, dates or prices. Prefer evergreen resources over one-off events.\n\n` +
      targets.map((g, i) => `${i + 1}. "${g.title}" (path: ${pathOf(g)})${g.notes ? ` notes: ${g.notes.slice(0, 300)}` : ''}`).join('\n'),
  });

  const updated = [];
  for (const [i, g] of targets.entries()) {
    const found = (items || []).find((it) => it.step === i + 1);
    const list = cleanResources(found?.resources, max);
    if (!list.length) continue;
    const { data, error } = await db.from('goals').update({ resources: list }).eq('id', g.id).select('id,resources').single();
    if (!error && data) updated.push(data);
  }
  if (!free) await logUsage(db, 'resources');
  return reply({ updated, remaining: LIMIT - used - (free ? 0 : 1) });
}

/* ---------------- Plan my day ---------------- */
async function plan({ db, goals, body, remainingAfter, signal }) {
  const hours = [1, 2, 3, 4, 6, 8].includes(Number(body.hours)) ? Number(body.hours) : 3;
  const budget = hours * 60;
  const { kids, pathOf } = indexTree(goals);

  // Actionable leaves: under 100% with no unfinished children.
  const candidates = goals
    .filter((g) => g.progress < 100 && !(kids[g.id] || []).some((k) => k.progress < 100))
    .slice(0, 60);
  if (!candidates.length) return reply({ error: 'Everything is complete. Add a new goal or step to plan your day.' }, 400);

  const out = await askJSON({
    signal,
    schema: {
      type: 'object',
      properties: {
        focus: { type: 'string', description: 'One sentence on the theme of the day' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'integer', description: 'Step number from the list' },
              task: { type: 'string', description: 'One concrete action for today, not the whole step' },
              minutes: { type: 'integer' },
              why: { type: 'string', description: 'One short sentence' },
            },
            required: ['step', 'task', 'minutes', 'why'],
            additionalProperties: false,
          },
        },
      },
      required: ['focus', 'items'],
      additionalProperties: false,
    },
    prompt:
      `Plan the member's day. They have ${hours} hour${hours > 1 ? 's' : ''} (${budget} minutes) available.\n` +
      `Rules: balance across their top-level goals; prefer steps already in progress and steps that unblock others; put demanding work first; ` +
      `use blocks of 15-90 minutes; 3-8 blocks; the total must fit within ${budget} minutes. Each task is one concrete action for today, not the whole step.\n\n` +
      `Steps to choose from:\n` +
      candidates.map((g, i) => `${i + 1}. ${pathOf(g)} [${g.progress}%]${g.notes ? ` notes: ${g.notes.slice(0, 200)}` : ''}`).join('\n'),
  });

  let total = 0;
  const items = [];
  for (const it of out.items || []) {
    const g = candidates[(it.step | 0) - 1];
    if (!g || !it.task) continue;
    const minutes = Math.min(120, Math.max(10, Math.round(Number(it.minutes) || 30)));
    if (total + minutes > budget) continue;
    total += minutes;
    items.push({ goalId: g.id, title: clean(it.task, 200), minutes, why: clean(it.why, 300) });
    if (items.length >= 8) break;
  }
  if (!items.length) throw Object.assign(new Error('The AI did not return a usable plan.'), { detail: 'empty' });
  await logUsage(db, 'plan');
  return reply({ plan: { focus: clean(out.focus, 300), hours, items }, remaining: remainingAfter });
}
