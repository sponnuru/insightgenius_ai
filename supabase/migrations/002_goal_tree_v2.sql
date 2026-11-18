-- InsightGenius Goal Tree v2 — one-time update for an existing database.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.

-- Learning resources and the "Do it for me" agent result, stored on each goal
alter table public.goals add column if not exists resources jsonb;
alter table public.goals add column if not exists result    jsonb;

-- Each member's page settings: theme, collapsed branches, AI step count, today's plan
alter table public.profiles add column if not exists settings jsonb not null default '{}'::jsonb;

-- Let signed-in members use the tables (row security still limits each member to their own rows)
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert on public.ai_usage to authenticated;
grant usage, select on sequence public.ai_usage_id_seq to authenticated;
