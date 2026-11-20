import {
  LIMIT, MODEL, SYSTEM, GOAL_COLUMNS, authenticate, checkLimit, claude, clean, describeTree,
  indexTree, loadGoals, logUsage, reply,
} from '../../../lib/server/ai';

// "Do it for me": a tool-using agent loop that runs on the server and streams its activity
// to the browser as one JSON object per line. Nothing it proposes is ever sent automatically.
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_TURNS = 10;
const ACTION_KINDS = ['email', 'message', 'calendar', 'sign-up', 'purchase'];

const TOOLS = [
  {
    name: 'get_goal_context',
    description: 'Returns the step, its notes, path, parent, existing sub-steps, sibling steps, any previous agent result, and the whole goal tree. Call this first.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'save_findings',
    description: 'Save the finished deliverable (a shortlist, a complete draft, or a plan) as Markdown. Under 400 words. Start with a one-line summary. Call this exactly once, when done.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { markdown: { type: 'string' } },
      required: ['markdown'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_follow_up_steps',
    description: 'Add up to 3 child steps under this step for the member to do next.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, category: { type: 'string', enum: ['short', 'long'] } },
            required: ['title', 'category'],
            additionalProperties: false,
          },
        },
      },
      required: ['steps'],
      additionalProperties: false,
    },
  },
  {
    name: 'propose_action',
    description: 'Queue an email, message, calendar event, sign-up or purchase for the member to approve. It is never performed automatically. Up to 4. Put the full ready-to-send text in details.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ACTION_KINDS },
        title: { type: 'string' },
        details: { type: 'string' },
      },
      required: ['kind', 'title', 'details'],
      additionalProperties: false,
    },
  },
  {
    name: 'request_lookup',
    description: 'List a fact you cannot know (prices, dates, availability, contacts) for the member to check online. Up to 4.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { question: { type: 'string' }, search: { type: 'string', description: 'A web search query that answers it' } },
      required: ['question', 'search'],
      additionalProperties: false,
    },
  },
];

const AGENT_SYSTEM =
  SYSTEM +
  '\n\nYou are acting as the member\'s agent on one step of their goal tree. Work like this: call get_goal_context, ' +
  'do the work in your head (you cannot browse the web), then call save_findings once with the finished deliverable. ' +
  'Optionally add follow-up steps, propose actions that need the member\'s approval (never claim you sent or booked anything), ' +
  'and list facts they should check online. Be specific and useful; produce the real draft or shortlist, not advice about making one.';

export async function POST(req) {
  const auth = await authenticate(req);
  if (auth.error) return auth.error;
  const { db, user } = auth;

  const body = await req.json().catch(() => ({}));
  const instruction = clean(body.instruction, 1000) || 'Do the most useful next thing for this step.';

  const limit = await checkLimit(db);
  if (limit.error) return limit.error;

  let goals;
  try { goals = await loadGoals(db, user.id); } catch (e) { return reply({ error: e.message, detail: e.detail }, 500); }
  const { byId, kids, pathOf } = indexTree(goals);
  const goal = byId[body.goalId];
  if (!goal) return reply({ error: 'Goal not found.' }, 404);

  // An agent run counts as one request, even if it is stopped part-way.
  await logUsage(db, 'agent');
  const remaining = LIMIT - limit.used - 1;

  const encoder = new TextEncoder();
  const signal = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {} };
      const log = (text) => send({ type: 'log', text });

      const found = { markdown: '', steps: [], actions: [], lookups: [] };

      const runTool = (name, input) => {
        switch (name) {
          case 'get_goal_context': {
            log('Reading the step and your goal tree');
            const parent = goal.parent_id && byId[goal.parent_id];
            const siblings = (kids[goal.parent_id && byId[goal.parent_id] ? goal.parent_id : 'root'] || []).filter((g) => g.id !== goal.id);
            return JSON.stringify({
              step: { title: goal.title, category: goal.category, progress: goal.progress, notes: goal.notes || '' },
              path: pathOf(goal),
              parent: parent ? parent.title : null,
              sub_steps: (kids[goal.id] || []).map((g) => `${g.title} (${g.progress}%)`),
              sibling_steps: siblings.map((g) => `${g.title} (${g.progress}%)`),
              previous_result: goal.result ? { instruction: goal.result.instruction, summary: goal.result.summary } : null,
              tree: describeTree(goals),
            });
          }
          case 'save_findings':
            found.markdown = clean(input.markdown, 6000);
            log('Saved the findings');
            return 'Saved.';
          case 'add_follow_up_steps': {
            const room = 3 - found.steps.length;
            const add = (input.steps || []).filter((s) => s && s.title).slice(0, Math.max(0, room))
              .map((s) => ({ title: clean(s.title, 200), category: s.category === 'long' ? 'long' : 'short' }));
            found.steps.push(...add);
            if (add.length) log(`Adding ${add.length} follow-up step${add.length > 1 ? 's' : ''}`);
            return room > 0 ? `Will add ${add.length} step(s).` : 'Limit of 3 follow-up steps reached.';
          }
          case 'propose_action':
            if (found.actions.length >= 4) return 'Limit of 4 proposed actions reached.';
            found.actions.push({
              id: crypto.randomUUID(),
              kind: ACTION_KINDS.includes(input.kind) ? input.kind : 'message',
              title: clean(input.title, 200),
              details: clean(input.details, 3000),
              status: 'pending',
            });
            log(`Proposed for your approval: ${clean(input.title, 80)}`);
            return 'Queued for the member\'s approval. It will not be sent automatically.';
          case 'request_lookup':
            if (found.lookups.length >= 4) return 'Limit of 4 lookups reached.';
            found.lookups.push({ question: clean(input.question, 300), query: clean(input.search, 200) });
            log(`To check online: ${clean(input.question, 80)}`);
            return 'Listed for the member to check.';
          default:
            return `Unknown tool ${name}`;
        }
      };

      try {
        log('Starting the agent');
        const messages = [{
          role: 'user',
          content: `Step: "${goal.title}"\nThe member's request: ${instruction}`,
        }];

        let lastText = '';
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          if (signal?.aborted) throw new Error('stopped');
          const msg = await claude().messages.create(
            { model: MODEL, max_tokens: 16000, system: AGENT_SYSTEM, tools: TOOLS, output_config: { effort: 'medium' }, messages },
            { signal },
          );
          if (msg.stop_reason === 'refusal') throw Object.assign(new Error('The AI declined this request.'), { detail: 'refusal' });
          messages.push({ role: 'assistant', content: msg.content });

          const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
          if (text) lastText = text;

          const uses = msg.content.filter((b) => b.type === 'tool_use');
          if (!uses.length || msg.stop_reason !== 'tool_use') break;
          messages.push({
            role: 'user',
            content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: runTool(u.name, u.input || {}) })),
          });
        }

        // Fallback: if the model answered in plain text instead of calling save_findings.
        if (!found.markdown) found.markdown = clean(lastText, 6000);
        if (!found.markdown) throw Object.assign(new Error('The agent finished without a result.'), { detail: 'no findings' });

        let added = [];
        if (found.steps.length) {
          const { data, error } = await db.from('goals')
            .insert(found.steps.map((s) => ({ ...s, parent_id: goal.id })))
            .select(GOAL_COLUMNS);
          if (!error) added = data;
        }

        const result = {
          at: new Date().toISOString(),
          instruction,
          summary: found.markdown,
          added: added.length,
          actions: found.actions,
          lookups: found.lookups,
        };
        const { error: saveErr } = await db.from('goals').update({ result }).eq('id', goal.id);
        if (saveErr) throw Object.assign(new Error('Could not save the result.'), { detail: saveErr.message });

        log('Done');
        send({ type: 'done', result, added, remaining });
      } catch (err) {
        if (signal?.aborted || err?.message === 'stopped' || err?.name === 'AbortError') {
          send({ type: 'error', error: 'Stopped.', remaining });
        } else {
          console.error('Agent error:', err);
          const busy = err?.status === 429 || err?.status === 529;
          send({
            type: 'error',
            error: busy ? 'The AI is busy right now. Please try again in a minute.' : err?.detail ? err.message : 'The agent ran into a problem.',
            detail: err?.detail || (err?.status ? `${err.status}` : err?.message),
            remaining,
          });
        }
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
