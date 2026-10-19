-- Per-pack playtime (each installation / version is its own "game").
-- Paste into Supabase Dashboard → SQL Editor after 011 (or alone — does not need 011).
--
-- Pack ids match the launcher:
--   remine catalog:  e.g. "remined"
--   vanilla:         "vanilla-1.21.1"
--   remined-vanilla: "remined-vanilla-1.21.1"

create table if not exists public.pack_playtime (
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id text not null,
  playtime_seconds bigint not null default 0
    check (playtime_seconds >= 0),
  last_played_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, pack_id),
  check (char_length(pack_id) between 1 and 128)
);

create index if not exists pack_playtime_user_idx
  on public.pack_playtime (user_id);

comment on table public.pack_playtime is
  'Steam-style hours + last launch, keyed by Remined pack / version id.';

alter table public.pack_playtime enable row level security;

drop policy if exists "pack_playtime_select_own" on public.pack_playtime;
create policy "pack_playtime_select_own"
  on public.pack_playtime for select
  to authenticated
  using (auth.uid() = user_id);

-- Friends can see each other's pack hours (optional Steam-like).
drop policy if exists "pack_playtime_select_friends" on public.pack_playtime;
create policy "pack_playtime_select_friends"
  on public.pack_playtime for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and (
          (f.requester_id = auth.uid() and f.addressee_id = pack_playtime.user_id)
          or (f.addressee_id = auth.uid() and f.requester_id = pack_playtime.user_id)
        )
    )
  );

drop policy if exists "pack_playtime_insert_own" on public.pack_playtime;
create policy "pack_playtime_insert_own"
  on public.pack_playtime for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "pack_playtime_update_own" on public.pack_playtime;
create policy "pack_playtime_update_own"
  on public.pack_playtime for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomically upsert session seconds for one pack.
-- p_seconds = 0 still touches last_played_at (used on launch).
create or replace function public.record_pack_play_session(
  p_pack_id text,
  p_seconds integer
)
returns table (
  pack_id text,
  playtime_seconds bigint,
  last_played_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pid text := trim(p_pack_id);
  secs integer := greatest(0, least(coalesce(p_seconds, 0), 604800));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if pid is null or pid = '' or char_length(pid) > 128 then
    raise exception 'invalid pack_id';
  end if;

  return query
  insert into public.pack_playtime (user_id, pack_id, playtime_seconds, last_played_at, updated_at)
  values (auth.uid(), pid, secs, now(), now())
  on conflict (user_id, pack_id) do update
  set
    playtime_seconds = public.pack_playtime.playtime_seconds + excluded.playtime_seconds,
    last_played_at = now(),
    updated_at = now()
  returning
    public.pack_playtime.pack_id,
    public.pack_playtime.playtime_seconds,
    public.pack_playtime.last_played_at;
end;
$$;

revoke all on function public.record_pack_play_session(text, integer) from public;
grant execute on function public.record_pack_play_session(text, integer) to authenticated;
