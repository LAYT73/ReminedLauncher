-- Localized pack copy. Additive only: older launchers select explicit columns
-- (name, tagline, blurb, highlights) and never see this one.
-- Shape: { "<locale>": { "name"?, "tagline"?, "blurb"?, "highlights"?: string[] } }
-- Missing locale or field falls back to the base (English) columns.

alter table public.packs
  add column if not exists i18n jsonb not null default '{}'::jsonb;

comment on column public.packs.i18n is
  'Per-locale overrides of name/tagline/blurb/highlights, e.g. {"ru": {...}}';

update public.packs
set i18n = jsonb_set(
  i18n,
  '{ru}',
  jsonb_build_object(
    'tagline', 'Vanilla+, кинематографичные шейдеры, плавный интерфейс',
    'blurb', 'Сборка на Fabric для друзей: красивый survival, моды на производительность и скины SkinShuffle из Remined.',
    'highlights', jsonb_build_array(
      'Шейдеры и атмосфера',
      'Удобный HUD для выживания',
      'Общие скины по LAN',
      'Запуск в один клик из Remined'
    )
  )
)
where id = 'vanillapro';
