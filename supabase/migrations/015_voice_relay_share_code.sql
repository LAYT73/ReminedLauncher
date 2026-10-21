-- Rename the legacy voice tunnel column after the migration to Remined Relay.
-- Idempotent: safe if already renamed or if both names somehow exist.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'voice_rooms'
      and column_name = 'porthole_share_code'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'voice_rooms'
      and column_name = 'relay_share_code'
  ) then
    alter table public.voice_rooms
      rename column porthole_share_code to relay_share_code;
  end if;
end $$;
