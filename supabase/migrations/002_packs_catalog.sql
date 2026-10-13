-- Remined pack catalog (UI + which packs exist). Artifacts live on GitHub Releases.

create table if not exists public.packs (
  id text primary key,
  name text not null,
  tagline text not null default '',
  blurb text not null default '',
  highlights jsonb not null default '[]'::jsonb,
  gallery jsonb not null default '[]'::jsonb,
  logo_url text,
  wallpaper_url text,
  is_default boolean not null default false,
  sort_order int not null default 0,
  enabled boolean not null default true,
  java_major int not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.packs enable row level security;

drop policy if exists "packs_select_all" on public.packs;
create policy "packs_select_all"
  on public.packs for select
  to anon, authenticated
  using (enabled = true);

-- Only service role / dashboard inserts; no client writes
