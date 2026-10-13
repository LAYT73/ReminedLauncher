# Pack marketing assets

Static images for a pack live in **ReminedPacks** (not in the launcher bundle):

```
assets/<pack_id>/
  logo.png
  wallpaper.jpg
  gallery/gallery-01.jpg …
```

Public URL pattern:

```
https://raw.githubusercontent.com/LAYT73/ReminedPacks/main/assets/<pack_id>/…
```

Then set on the Supabase `packs` row:

- `logo_url`
- `wallpaper_url`
- `gallery` (jsonb array of URLs)

The launcher only reads these fields — no local gallery/logo imports.
