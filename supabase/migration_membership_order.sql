-- ============================================================
-- ギフトボード・アルバムそれぞれに、写真全体とは独立した
-- 並び順を持たせる。
-- ============================================================

alter table photo_albums add column if not exists position int not null default 0;
alter table photo_folders add column if not exists position int not null default 0;

-- 既存データに、写真全体の並び順を初期値として割り当てる
-- (これまでは全体の並び順しかなかったため、違和感のない初期状態にする)。
with ranked_albums as (
  select pa.photo_id, pa.album_id,
         row_number() over (partition by pa.album_id order by p.position) as rn
  from photo_albums pa
  join photos p on p.id = pa.photo_id
)
update photo_albums pa
set position = ranked_albums.rn
from ranked_albums
where pa.photo_id = ranked_albums.photo_id
  and pa.album_id = ranked_albums.album_id;

with ranked_folders as (
  select pf.photo_id, pf.folder_id,
         row_number() over (partition by pf.folder_id order by p.position) as rn
  from photo_folders pf
  join photos p on p.id = pf.photo_id
)
update photo_folders pf
set position = ranked_folders.rn
from ranked_folders
where pf.photo_id = ranked_folders.photo_id
  and pf.folder_id = ranked_folders.folder_id;
