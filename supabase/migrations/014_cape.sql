-- Capes: profile column + Storage object `{nick}_cape.png` in the skins bucket.

alter table public.profiles
  add column if not exists cape_path text;

-- Allow own skin + cape objects under skins/
drop policy if exists "skins_own_insert" on storage.objects;
create policy "skins_own_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'skins'
    and name in (
      (select nick || '.png' from public.profiles where id = auth.uid()),
      (select nick || '_cape.png' from public.profiles where id = auth.uid())
    )
  );

drop policy if exists "skins_own_update" on storage.objects;
create policy "skins_own_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'skins'
    and name in (
      (select nick || '.png' from public.profiles where id = auth.uid()),
      (select nick || '_cape.png' from public.profiles where id = auth.uid())
    )
  )
  with check (
    bucket_id = 'skins'
    and name in (
      (select nick || '.png' from public.profiles where id = auth.uid()),
      (select nick || '_cape.png' from public.profiles where id = auth.uid())
    )
  );

drop policy if exists "skins_own_delete" on storage.objects;
create policy "skins_own_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'skins'
    and name in (
      (select nick || '.png' from public.profiles where id = auth.uid()),
      (select nick || '_cape.png' from public.profiles where id = auth.uid())
    )
  );
