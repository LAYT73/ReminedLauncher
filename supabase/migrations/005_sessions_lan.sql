-- LAN / ZeroTier join fields on presence sessions
alter table public.sessions
  add column if not exists game_port integer,
  add column if not exists zt_ip text;

comment on column public.sessions.game_port is 'Minecraft Open-to-LAN TCP port while hosting';
comment on column public.sessions.zt_ip is 'ZeroTier managed IPv4 for Join';
