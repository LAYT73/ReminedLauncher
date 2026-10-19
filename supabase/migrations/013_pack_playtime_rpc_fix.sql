-- Fix record_pack_play_session so PostgREST always gets a row back.
-- Paste into Supabase SQL Editor (after 012).

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
  pid text := trim(both from coalesce(p_pack_id, ''));
  secs integer := greatest(0, least(coalesce(p_seconds, 0), 604800));
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if pid = '' or char_length(pid) > 128 then
    raise exception 'invalid pack_id';
  end if;

  insert into public.pack_playtime as ppt
    (user_id, pack_id, playtime_seconds, last_played_at, updated_at)
  values (uid, pid, secs, now(), now())
  on conflict (user_id, pack_id) do update
  set
    playtime_seconds = ppt.playtime_seconds + excluded.playtime_seconds,
    last_played_at = now(),
    updated_at = now();

  return query
  select ppt.pack_id, ppt.playtime_seconds, ppt.last_played_at
  from public.pack_playtime ppt
  where ppt.user_id = uid and ppt.pack_id = pid;
end;
$$;

revoke all on function public.record_pack_play_session(text, integer) from public;
grant execute on function public.record_pack_play_session(text, integer) to authenticated;

-- Nudge PostgREST schema cache (Dashboard → Settings → API → Reload also works).
notify pgrst, 'reload schema';
