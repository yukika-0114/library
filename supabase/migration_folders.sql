-- ============================================================
-- 「アルバム」機能(達成度を持たない、純粋な整理フォルダ)を追加。
-- 既存の albums / photo_albums テーブルは「ギフトボード」として
-- そのまま使い続けます(名前はUI表示だけを変更、テーブル名は不変)。
-- ============================================================

create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references libraries(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (library_id, name)
);
alter table folders enable row level security;

create table if not exists photo_folders (
  photo_id uuid not null references photos(id) on delete cascade,
  folder_id uuid not null references folders(id) on delete cascade,
  primary key (photo_id, folder_id)
);
alter table photo_folders enable row level security;

create policy "folders: members can read" on folders
  for select using (
    exists (
      select 1 from library_members m
      where m.library_id = folders.library_id and m.user_id = auth.uid()
    )
  );
create policy "folders: members can write" on folders
  for insert with check (
    exists (
      select 1 from library_members m
      where m.library_id = folders.library_id and m.user_id = auth.uid()
    )
  );
create policy "folders: members can delete" on folders
  for delete using (
    exists (
      select 1 from library_members m
      where m.library_id = folders.library_id and m.user_id = auth.uid()
    )
  );

create policy "photo_folders: members can read" on photo_folders
  for select using (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_folders.photo_id and m.user_id = auth.uid()
    )
  );
create policy "photo_folders: members can insert" on photo_folders
  for insert with check (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_folders.photo_id and m.user_id = auth.uid()
    )
  );
create policy "photo_folders: members can delete" on photo_folders
  for delete using (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_folders.photo_id and m.user_id = auth.uid()
    )
  );

alter publication supabase_realtime add table folders;
alter publication supabase_realtime add table photo_folders;
