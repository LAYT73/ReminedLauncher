-- Party (iteration 1): a voice room doubles as a shared-world party.
--
-- Backward compatibility with 1.0.x clients (code at git HEAD 95a0b95):
--   * Room create (features/voice → entities/voice-room/api/rooms.ts createVoiceRoom):
--     inserts voice_rooms with only the old columns (new columns get defaults:
--     pack_id null, game_state 'idle', lan_port null, max_members 8). Then inserts
--     the host member row. The host member insert passes the new insert policy
--     through the host branch (room open, count 0 < max).
--   * Guest accept (respondVoiceInvite): updates voice_invites first (unchanged
--     policy), then upserts voice_room_members as role 'member'. The new insert
--     policy accepts it because a voice_invites row to_id = caller exists (any
--     status). On conflict (rejoin) the row is already a member, which is
--     allowed regardless of the member cap.
--   * LiveKit reconnect (useLiveSession ensureVoiceRoomMember): upsert on
--     (room_id,user_id). Adding an UPDATE grant + own-row update policy makes
--     the DO UPDATE branch succeed; the guard trigger only blocks changes to
--     room_id/user_id/role/joined_at, which the old client never changes.
--   * Old clients never read or write the new columns, so their queries are
--     unaffected (PostgREST `select *` just returns extra fields).
--   * Room close/leave/delete paths are unchanged (delete policies untouched).
-- Everything here is idempotent (add column if not exists, drop policy if exists).

-- ---------------------------------------------------------------------------
-- voice_rooms: party data
-- ---------------------------------------------------------------------------
alter table public.voice_rooms
  add column if not exists pack_id text null;

alter table public.voice_rooms
  add column if not exists game_state text not null default 'idle';

alter table public.voice_rooms
  add column if not exists lan_port integer null;

alter table public.voice_rooms
  add column if not exists max_members integer not null default 8;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.voice_rooms'::regclass
      and conname = 'voice_rooms_game_state_check'
  ) then
    alter table public.voice_rooms
      add constraint voice_rooms_game_state_check
      check (game_state in ('idle', 'launching', 'in_world', 'open'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.voice_rooms'::regclass
      and conname = 'voice_rooms_lan_port_check'
  ) then
    alter table public.voice_rooms
      add constraint voice_rooms_lan_port_check
      check (lan_port is null or lan_port between 1 and 65535);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.voice_rooms'::regclass
      and conname = 'voice_rooms_max_members_check'
  ) then
    alter table public.voice_rooms
      add constraint voice_rooms_max_members_check
      check (max_members between 2 and 32);
  end if;
end $$;

-- Host updates of these columns are covered by the existing
-- "voice_rooms_update_host" policy (009): host_id = auth.uid().

-- ---------------------------------------------------------------------------
-- voice_room_members: per-member party state
-- ---------------------------------------------------------------------------
alter table public.voice_room_members
  add column if not exists state text not null default 'joined';

alter table public.voice_room_members
  add column if not exists progress smallint null;

alter table public.voice_room_members
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.voice_room_members'::regclass
      and conname = 'voice_room_members_state_check'
  ) then
    alter table public.voice_room_members
      add constraint voice_room_members_state_check
      check (state in ('joined', 'installing', 'ready', 'in_game', 'in_world'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.voice_room_members'::regclass
      and conname = 'voice_room_members_progress_check'
  ) then
    alter table public.voice_room_members
      add constraint voice_room_members_progress_check
      check (progress is null or progress between 0 and 100);
  end if;
end $$;

-- Helpers (security definer so policies do not recurse through RLS).
create or replace function public.voice_room_member_count(p_room uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from public.voice_room_members m where m.room_id = p_room;
$$;

create or replace function public.voice_room_join_allowed(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.voice_rooms r
    where r.id = p_room
      and r.status = 'open'
      and (
        -- Re-asserting an existing membership (LiveKit reconnect) is always fine.
        exists (
          select 1 from public.voice_room_members m
          where m.room_id = r.id and m.user_id = auth.uid()
        )
        or (
          public.voice_room_member_count(r.id) < r.max_members
          and (
            r.host_id = auth.uid()
            or exists (
              select 1 from public.voice_invites i
              where i.room_id = r.id and i.to_id = auth.uid()
            )
            or exists (
              select 1 from public.friendships f
              where f.status = 'accepted'
                and (
                  (f.requester_id = r.host_id and f.addressee_id = auth.uid())
                  or (f.addressee_id = r.host_id and f.requester_id = auth.uid())
                )
            )
          )
        )
      )
  );
$$;

grant execute on function public.voice_room_member_count(uuid) to authenticated;
grant execute on function public.voice_room_join_allowed(uuid) to authenticated;

-- Insert policy: tightened. The host branch is kept so the host's own row and
-- any legacy host-side insert keep working.
drop policy if exists "voice_members_insert" on public.voice_room_members;
create policy "voice_members_insert"
  on public.voice_room_members for insert
  to authenticated
  with check (
    (user_id = auth.uid() and public.voice_room_join_allowed(room_id))
    or exists (
      select 1 from public.voice_rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );

-- Members may update only their own row. Column scope is enforced by the guard
-- trigger below (state/progress/updated_at are the intended write surface).
grant update on public.voice_room_members to authenticated;

drop policy if exists "voice_members_update_own" on public.voice_room_members;
create policy "voice_members_update_own"
  on public.voice_room_members for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.voice_room_members_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.room_id is distinct from old.room_id
    or new.user_id is distinct from old.user_id
    or new.role is distinct from old.role
    or new.joined_at is distinct from old.joined_at then
    raise exception 'voice_room_members: only state, progress and updated_at may change';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists voice_room_members_guard on public.voice_room_members;
create trigger voice_room_members_guard
  before update on public.voice_room_members
  for each row execute function public.voice_room_members_guard();

-- Realtime: the four voice tables are already in the supabase_realtime
-- publication (008). New columns ride along automatically. voice_room_members
-- UPDATE events are consumed as "refetch the list" (subscribeRoomMembers), so
-- the default replica identity (new row is complete) is enough; no
-- REPLICA IDENTITY FULL is needed.
