-- Remined: skins bucket RLS + friendship delete
-- Remined public id = profiles.nick (7 chars). No new column required.
-- Run in Supabase Dashboard → SQL Editor (paste all).

-- Bucket (safe if already created)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skins',
  'skins',
  true,
  262144, -- 256 KB hard cap server-side
  array['image/png']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Public read (friends avatars)
drop policy if exists "skins_public_read" on storage.objects;
create policy "skins_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'skins');

-- One object per account: `{nick}.png` where nick is your Remined id
drop policy if exists "skins_own_insert" on storage.objects;
create policy "skins_own_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'skins'
    and name = (
      select nick || '.png' from public.profiles where id = auth.uid()
    )
  );

drop policy if exists "skins_own_update" on storage.objects;
create policy "skins_own_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'skins'
    and name = (
      select nick || '.png' from public.profiles where id = auth.uid()
    )
  )
  with check (
    bucket_id = 'skins'
    and name = (
      select nick || '.png' from public.profiles where id = auth.uid()
    )
  );

drop policy if exists "skins_own_delete" on storage.objects;
create policy "skins_own_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'skins'
    and name = (
      select nick || '.png' from public.profiles where id = auth.uid()
    )
  );

-- Friends can remove a friendship
drop policy if exists "friendships_delete_participants" on public.friendships;
create policy "friendships_delete_participants"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Self-heal profile row if trigger missed it
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);
