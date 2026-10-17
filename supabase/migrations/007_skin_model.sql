-- Remined: classic (wide) vs slim arm model for skins
-- Run in Supabase Dashboard → SQL Editor (or: supabase db push)

alter table public.profiles
  add column if not exists skin_model text;

update public.profiles
set skin_model = 'default'
where skin_model is null
   or skin_model not in ('default', 'slim');

alter table public.profiles
  alter column skin_model set default 'default';

alter table public.profiles
  alter column skin_model set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_skin_model_check'
  ) then
    alter table public.profiles
      add constraint profiles_skin_model_check
      check (skin_model in ('default', 'slim'));
  end if;
end $$;

comment on column public.profiles.skin_model is
  'Player model: default = classic/wide arms, slim = Alex-style';
