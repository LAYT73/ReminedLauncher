-- Friend activity (Discord-style), derived from the local game log.
-- Codes: loading | menu | sp | lan | mp | death | advancement
-- Never holds server addresses or world names. Null when not playing.
alter table public.sessions add column if not exists activity text;
comment on column public.sessions.activity is
  'Friend-visible activity code: loading | menu | sp | lan | mp | death | advancement';
