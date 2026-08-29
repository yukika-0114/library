-- ============================================================
-- 写真とアルバムを「多対多」にし、達成度(現在値/目標値)を
-- アルバムごとに持たせるための移行。
-- 「すべての写真」一覧では達成度を扱わず、アルバムの中でのみ
-- 達成度を設定・表示するようにする。
-- ============================================================

create table if not exists photo_albums (
  photo_id uuid not null references photos(id) on delete cascade,
  album_id uuid not null references albums(id) on delete cascade,
  current int not null default 0,
  target int not null default 0,
  primary key (photo_id, album_id)
);
alter table photo_albums enable row level security;

create policy "photo_albums: members can read" on photo_albums
  for select using (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_albums.photo_id and m.user_id = auth.uid()
    )
  );
create policy "photo_albums: members can insert" on photo_albums
  for insert with check (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_albums.photo_id and m.user_id = auth.uid()
    )
  );
create policy "photo_albums: members can update" on photo_albums
  for update using (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_albums.photo_id and m.user_id = auth.uid()
    )
  );
create policy "photo_albums: members can delete" on photo_albums
  for delete using (
    exists (
      select 1 from photos p
      join library_members m on m.library_id = p.library_id
      where p.id = photo_albums.photo_id and m.user_id = auth.uid()
    )
  );

alter publication supabase_realtime add table photo_albums;

-- 既存データ(1枚1アルバム・写真ごとの現在値/目標値)を、
-- 新しい多対多テーブルへ移し替える(データは失われません)。
insert into photo_albums (photo_id, album_id, current, target)
select p.id, a.id, coalesce(p.current, 0), coalesce(p.target, 0)
from photos p
join albums a on a.library_id = p.library_id and a.name = p.album
where p.album is not null and p.album <> ''
on conflict do nothing;

-- 写真テーブルからは、もう使わない列を削除。
alter table photos drop column if exists album;
alter table photos drop column if exists current;
alter table photos drop column if exists target;
