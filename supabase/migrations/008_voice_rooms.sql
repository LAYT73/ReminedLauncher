-- Remined voice rooms: LiveKit host metadata, invites, chat (Realtime)

create table if not exists public.voice_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  title text not null default 'Voice room',
  status text not null default 'open'
    check (status in ('open', 'closed')),
  porthole_share_code text,
  lk_ws_url text not null default 'ws://127.0.0.1:7880',
  lk_tcp_port integer not null default 7880,
  lk_udp_start integer not null default 7881,
  lk_udp_end integer not null default 7890,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists voice_rooms_host_idx on public.voice_rooms (host_id);
create index if not exists voice_rooms_status_idx on public.voice_rooms (status);

create table if not exists public.voice_room_members (
  room_id uuid not null references public.voice_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member'
    check (role in ('host', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists voice_room_members_user_idx
  on public.voice_room_members (user_id);

create table if not exists public.voice_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.voice_rooms (id) on delete cascade,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (room_id, to_id)
);

create index if not exists voice_invites_to_idx on public.voice_invites (to_id);
create index if not exists voice_invites_room_idx on public.voice_invites (room_id);

create table if not exists public.voice_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.voice_rooms (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists voice_messages_room_created_idx
  on public.voice_messages (room_id, created_at);

alter table public.voice_rooms enable row level security;
alter table public.voice_room_members enable row level security;
alter table public.voice_invites enable row level security;
alter table public.voice_messages enable row level security;

-- Helpers
create or replace function public.is_voice_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.voice_room_members m
    where m.room_id = p_room and m.user_id = auth.uid()
  );
$$;

create or replace function public.can_see_voice_room(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.voice_rooms r
    where r.id = p_room
      and (
        r.host_id = auth.uid()
        or exists (
          select 1 from public.voice_room_members m
          where m.room_id = r.id and m.user_id = auth.uid()
        )
        or exists (
          select 1 from public.voice_invites i
          where i.room_id = r.id
            and (i.to_id = auth.uid() or i.from_id = auth.uid())
        )
      )
  );
$$;

grant select, insert, update, delete on public.voice_rooms to authenticated;
grant select, insert, delete on public.voice_room_members to authenticated;
grant select, insert, update on public.voice_invites to authenticated;
grant select, insert on public.voice_messages to authenticated;
grant execute on function public.is_voice_room_member(uuid) to authenticated;
grant execute on function public.can_see_voice_room(uuid) to authenticated;

-- voice_rooms
-- SELECT must allow host_id directly: INSERT…RETURNING applies SELECT policies,
-- and a brand-new room has no members/invites yet.
drop policy if exists "voice_rooms_select" on public.voice_rooms;
create policy "voice_rooms_select"
  on public.voice_rooms for select
  to authenticated
  using (
    host_id = auth.uid()
    or public.can_see_voice_room(id)
  );

drop policy if exists "voice_rooms_insert_own" on public.voice_rooms;
create policy "voice_rooms_insert_own"
  on public.voice_rooms for insert
  to authenticated
  with check (host_id = auth.uid());

drop policy if exists "voice_rooms_update_host" on public.voice_rooms;
create policy "voice_rooms_update_host"
  on public.voice_rooms for update
  to authenticated
  using (host_id = auth.uid())
  with check (host_id = auth.uid());

drop policy if exists "voice_rooms_delete_host" on public.voice_rooms;
create policy "voice_rooms_delete_host"
  on public.voice_rooms for delete
  to authenticated
  using (host_id = auth.uid());

-- members
drop policy if exists "voice_members_select" on public.voice_room_members;
create policy "voice_members_select"
  on public.voice_room_members for select
  to authenticated
  using (public.can_see_voice_room(room_id));

drop policy if exists "voice_members_insert" on public.voice_room_members;
create policy "voice_members_insert"
  on public.voice_room_members for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.voice_rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );

drop policy if exists "voice_members_delete" on public.voice_room_members;
create policy "voice_members_delete"
  on public.voice_room_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.voice_rooms r
      where r.id = room_id and r.host_id = auth.uid()
    )
  );

-- invites
drop policy if exists "voice_invites_select" on public.voice_invites;
create policy "voice_invites_select"
  on public.voice_invites for select
  to authenticated
  using (from_id = auth.uid() or to_id = auth.uid() or public.is_voice_room_member(room_id));

drop policy if exists "voice_invites_insert" on public.voice_invites;
create policy "voice_invites_insert"
  on public.voice_invites for insert
  to authenticated
  with check (
    from_id = auth.uid()
    and exists (
      select 1 from public.voice_rooms r
      where r.id = room_id and r.host_id = auth.uid() and r.status = 'open'
    )
  );

drop policy if exists "voice_invites_update" on public.voice_invites;
create policy "voice_invites_update"
  on public.voice_invites for update
  to authenticated
  using (to_id = auth.uid() or from_id = auth.uid())
  with check (to_id = auth.uid() or from_id = auth.uid());

-- messages
drop policy if exists "voice_messages_select" on public.voice_messages;
create policy "voice_messages_select"
  on public.voice_messages for select
  to authenticated
  using (public.is_voice_room_member(room_id));

drop policy if exists "voice_messages_insert" on public.voice_messages;
create policy "voice_messages_insert"
  on public.voice_messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_voice_room_member(room_id)
  );

-- Realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.voice_messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.voice_invites;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.voice_room_members;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.voice_rooms;
  exception when duplicate_object then null;
  end;
end $$;
