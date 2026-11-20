-- InsightGenius Goal Tree: "My data" sources. Private to each member.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run more than once.

create table if not exists public.member_data (
  user_id     uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  sources     jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.member_data enable row level security;
drop policy if exists "Members manage their own data" on public.member_data;
create policy "Members manage their own data" on public.member_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.member_data to authenticated;
drop trigger if exists member_data_touch on public.member_data;
create trigger member_data_touch before update on public.member_data for each row execute function public.touch_updated_at();
