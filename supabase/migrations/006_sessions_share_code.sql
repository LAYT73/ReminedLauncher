-- Porthole share code for friend Join (replaces ZeroTier IP publishing)
alter table public.sessions
  add column if not exists share_code text;

comment on column public.sessions.share_code is 'Porthole share/lobby code while hosting Open-to-LAN';
comment on column public.sessions.game_port is 'Minecraft Open-to-LAN TCP port while hosting';
