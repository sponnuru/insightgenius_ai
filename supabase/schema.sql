-- InsightGenius Goals — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.

-- 1. Goals: one row per node in a member's goal tree
create table if not exists public.goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id   uuid references public.goals(id) on delete cascade,   -- deleting a goal deletes its steps
  title       text not null check (char_length(title) between 1 and 200),
  category    text not null default 'short' check (category in ('short', 'long')),
  progress    integer not null default 0 check (progress between 0 and 100),
  notes       text not null default '' check (char_length(notes) <= 2000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals(user_id);

alter table public.goals enable row level security;
drop policy if exists "Members manage their own goals" on public.goals;
create policy "Members manage their own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Profiles: stores each member's AI suggestions and whether they are out of date
create table if not exists public.profiles (
  user_id            uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  suggestions        jsonb not null default '[]'::jsonb,
  suggestions_stale  boolean not null default true,
  updated_at         timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "Members read own profile" on public.profiles;
drop policy if exists "Members create own profile" on public.profiles;
drop policy if exists "Members update own profile" on public.profiles;
create policy "Members read own profile"   on public.profiles for select using (auth.uid() = user_id);
create policy "Members create own profile" on public.profiles for insert with check (auth.uid() = user_id);
create policy "Members update own profile" on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3. AI usage log: powers the free-tier limit (e.g. 10 AI requests per 3 hours).
--    Members can read and add their own rows but never edit or delete them.
create table if not exists public.ai_usage (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action      text not null,
  created_at  timestamptz not null default now()
);
create index if not exists ai_usage_user_time_idx on public.ai_usage(user_id, created_at);

alter table public.ai_usage enable row level security;
drop policy if exists "Members read own usage" on public.ai_usage;
drop policy if exists "Members log own usage" on public.ai_usage;
create policy "Members read own usage" on public.ai_usage for select using (auth.uid() = user_id);
create policy "Members log own usage"  on public.ai_usage for insert with check (auth.uid() = user_id);

-- 4. Keep updated_at current
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before update on public.goals for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
