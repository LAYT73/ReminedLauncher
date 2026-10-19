-- DEPRECATED for UI: use 012_pack_playtime.sql (per-pack hours).
-- Safe to keep if already applied — global columns are unused by the launcher now.
-- Steam-style playtime + last launch on profiles (legacy).

alter table public.profiles
  add column if not exists playtime_seconds bigint not null default 0;

alter table public.profiles
  add column if not exists last_played_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_playtime_seconds_nonneg'
  ) then
    alter table public.profiles
      add constraint profiles_playtime_seconds_nonneg
      check (playtime_seconds >= 0);
  end if;
end $$;

comment on column public.profiles.playtime_seconds is
  'Total time with Minecraft launched via Remined (seconds).';
comment on column public.profiles.last_played_at is
  'Last time the user launched (or finished) a game session via Remined.';

-- Atomically add session seconds and refresh last_played_at.
-- p_seconds = 0 still touches last_played_at (used on launch).
create or replace function public.record_play_session(p_seconds integer)
returns table (
  playtime_seconds bigint,
  last_played_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  secs integer := greatest(0, least(coalesce(p_seconds, 0), 604800)); -- max 7d / call
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query
  update public.profiles
  set
    playtime_seconds = public.profiles.playtime_seconds + secs,
    last_played_at = now(),
    updated_at = now()
  where id = auth.uid()
  returning
    public.profiles.playtime_seconds,
    public.profiles.last_played_at;
end;
$$;

revoke all on function public.record_play_session(integer) from public;
grant execute on function public.record_play_session(integer) to authenticated;
