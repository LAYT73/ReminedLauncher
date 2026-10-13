-- Account username (unique), separate from Remined id in profiles.nick
-- Run in Supabase SQL Editor after 003.

alter table public.profiles
  add column if not exists username text;

-- Case-insensitive uniqueness (nulls allowed until claim)
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

-- Backfill missing usernames from Remined id: user{nick}
update public.profiles
set username = 'user' || nick
where username is null
  and nick is not null
  and length(nick) = 7;
