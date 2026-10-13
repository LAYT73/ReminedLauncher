-- Seed default pack row (edit anytime in Dashboard — launcher has no hardcoded pack UI copy)

insert into public.packs (
  id, name, tagline, blurb, highlights, gallery, logo_url, wallpaper_url,
  is_default, sort_order, enabled, java_major
) values (
  'vanillapro',
  'VanillaPro',
  'Vanilla+, cinematic shaders, ready for LAN',
  'Fabric build for friends: polished survival look, performance mods, and SkinShuffle skins from Remined.',
  '["Shaders & atmosphere","QoL survival HUD","Shared skins over LAN","One-click from Remined"]'::jsonb,
  '[]'::jsonb,
  null,
  null,
  true,
  0,
  true,
  25
)
on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  blurb = excluded.blurb,
  highlights = excluded.highlights,
  is_default = excluded.is_default,
  updated_at = now();
