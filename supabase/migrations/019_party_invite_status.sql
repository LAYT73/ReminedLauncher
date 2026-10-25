-- Party (iteration 2): an invite row admits its friend only while it is
-- 'pending' or 'accepted'. A declined invite must not grant entry.
--
-- Backward compatibility with 1.0.2 clients (code at git HEAD 95a0b95):
--   * Guest accept (respondVoiceInvite in entities/voice-room/api/invites.ts)
--     updates voice_invites to 'accepted' BEFORE it upserts voice_room_members.
--     The member insert therefore still finds a usable invite ('accepted').
--   * Guest decline sets 'declined' and never inserts a member row, so nothing
--     changes for it.
--   * Re-invite (inviteFriendToRoom upserts on room_id,to_id with status
--     'pending') moves the row back to 'pending', so a re-invite grants entry again.
--   * Old clients never read or write the new columns; only the member insert
--     policy calls this function, so their queries are unaffected.
-- Idempotent: create or replace with the same signature and grants.

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
              where i.room_id = r.id
                and i.to_id = auth.uid()
                and i.status in ('pending', 'accepted')
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

grant execute on function public.voice_room_join_allowed(uuid) to authenticated;
