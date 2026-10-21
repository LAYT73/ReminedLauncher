-- Relay share code for friend Join (replaces direct IP publishing)
alter table public.sessions
  add column if not exists share_code text;

comment on column public.sessions.share_code is 'Relay share code while hosting Open-to-LAN';
comment on column public.sessions.game_port is 'Minecraft Open-to-LAN TCP port while hosting';
