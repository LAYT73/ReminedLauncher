-- Rich presence: show friends who are currently in a voice room.
alter table public.sessions
  add column if not exists in_voice boolean not null default false;
