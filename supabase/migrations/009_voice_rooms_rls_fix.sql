-- Fix voice_rooms RLS: host can insert/select without depending only on
-- membership helpers (INSERT…RETURNING was blocked for new hosts).

grant select, insert, update, delete on public.voice_rooms to authenticated;
grant select, insert, delete on public.voice_room_members to authenticated;
grant select, insert, update on public.voice_invites to authenticated;
grant select, insert on public.voice_messages to authenticated;

grant execute on function public.is_voice_room_member(uuid) to authenticated;
grant execute on function public.can_see_voice_room(uuid) to authenticated;

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
