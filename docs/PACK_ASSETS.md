# Pack catalog assets

Pack presentation assets live in **ReminedPacks**, not in the launcher bundle:

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

Set the corresponding fields on the Supabase `packs` row:

- `logo_url`
- `wallpaper_url`
- `gallery` (jsonb array of URLs)

The launcher reads these URLs from the catalog. It does not import pack
marketing media from the application repository.
