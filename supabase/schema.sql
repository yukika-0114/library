-- ============================================================
-- フィルムキャビネット: Supabase schema
-- Run this in your Supabase project's SQL editor (Database -> SQL Editor).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---- libraries -------------------------------------------------
create table if not exists libraries (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'マイライブラリ',
  invite_code text unique not null default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

-- ---- library membership (who can see/edit a library) ----------
create table if not exists library_members (
  library_id uuid not null references libraries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (library_id, user_id)
);

-- ---- photos ------------------------------------------------------
create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references libraries(id) on delete cascade,
  title text not null default '',
  url text not null,
  path text not null, -- storage object path, used to delete the file
  tags text[] not null default '{}',
  favorite boolean not null default false,
  position int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists photos_library_idx on photos (library_id, position);

-- ---- albums --------------------------------------------------
create table if not exists albums (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references libraries(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (library_id, name)
);

-- ---- photo <-> album membership, with per-album progress ------
-- A photo can belong to several albums at once; achievement (current/target)
-- is tracked per (photo, album) pair rather than on the photo itself, since
-- the same photo may have different goals in different albums.
create table if not exists photo_albums (
  photo_id uuid not null references photos(id) on delete cascade,
  album_id uuid not null references albums(id) on delete cascade,
  current int not null default 0,
  target int not null default 0,
  position int not null default 0,
  primary key (photo_id, album_id)
);

-- ---- per-library appearance settings --------------------------
create table if not exists library_settings (
  library_id uuid primary key references libraries(id) on delete cascade,
  accent text not null default '#35e6ff',
  glow text not null default '#ff2fc0',
  intensity numeric not null default 1
);

-- ============================================================
-- Row Level Security: a user may only see/edit data in libraries
-- they are a member of.
-- ============================================================

alter table libraries enable row level security;
alter table library_members enable row level security;
alter table photos enable row level security;
alter table albums enable row level security;
alter table photo_albums enable row level security;
alter table library_settings enable row level security;

-- libraries: any signed-in user can create one; members can read it;
-- lookup by invite_code is allowed for anyone signed in (needed to join).
create policy "libraries: members can read" on libraries
  for select using (
    exists (
      select 1 from library_members m
      where m.library_id = libraries.id and m.user_id = auth.uid()
    )
    or auth.uid() is not null -- allow lookup by invite code to join
  );

create policy "libraries: signed-in users can create" on libraries
  for insert with check (auth.uid() is not null);

create policy "libraries: members can delete" on libraries
  for delete using (
    exists (
      select 1 from library_members m
      where m.library_id = libraries.id and m.user_id = auth.uid()
    )
  );

-- library_members: a user can see their own memberships, and can add
-- themself to a library (covers both "create" and "join by code").
create policy "library_members: user can read own memberships" on library_members
  for select using (user_id = auth.uid());

create policy "library_members: user can join" on library_members
  for insert with check (user_id = auth.uid());

-- photos / albums / library_settings: full access for library members
create policy "photos: members can read" on photos
  for select using (
    exists (
      select 1 from library_members m
      where m.library_id = photos.library_id and m.user_id = auth.uid()
    )
  );
create policy "photos: members can write" on photos
  for insert with check (
    exists (
      select 1 from library_members m
      where m.library_id = photos.library_id and m.user_id = auth.uid()
    )
  );
create policy "photos: members can update" on photos
  for update using (
    exists (
      select 1 from library_members m
      where m.library_id = photos.library_id and m.user_id = auth.uid()
    )
  );
create policy "photos: members can delete" on photos
  for delete using (
    exists (
      select 1 from library_members m
      where m.library_id = photos.library_id and m.user_id = auth.uid()
    )
  );

create policy "albums: members can read" on albums
  for select using (
    exists (
      select 1 from library_members m
      where m.library_id = albums.library_id and m.user_id = auth.uid()
    )
  );
create policy "albums: members can write" on albums
  for insert with check (
    exists (
      select 1 from library_members m
      where m.library_id = albums.library_id and m.user_id = auth.uid()
    )
  );
create policy "albums: members can delete" on albums
  for delete using (
    exists (
      select 1 from library_members m
      where m.library_id = albums.library_id and m.user_id = auth.uid()
    )
  );

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

create policy "library_settings: members can read" on library_settings
  for select using (
    exists (
      select 1 from library_members m
      where m.library_id = library_settings.library_id and m.user_id = auth.uid()
    )
  );
create policy "library_settings: members can write" on library_settings
  for insert with check (
    exists (
      select 1 from library_members m
      where m.library_id = library_settings.library_id and m.user_id = auth.uid()
    )
  );
create policy "library_settings: members can update" on library_settings
  for update using (
    exists (
      select 1 from library_members m
      where m.library_id = library_settings.library_id and m.user_id = auth.uid()
    )
  );

-- ============================================================
-- Realtime: let the app subscribe to live changes.
-- ============================================================
alter publication supabase_realtime add table photos;
alter publication supabase_realtime add table albums;
alter publication supabase_realtime add table photo_albums;
alter publication supabase_realtime add table library_settings;

-- ============================================================
-- Storage bucket for photo files.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- Public read (needed so <img src> works without signed URLs).
create policy "photos bucket: public read"
  on storage.objects for select
  using (bucket_id = 'photos');

-- Only library members may upload/delete objects under their library's
-- folder (object path convention: "<library_id>/<photo_id>.jpg").
create policy "photos bucket: members can upload"
  on storage.objects for insert
  with check (
    bucket_id = 'photos'
    and exists (
      select 1 from library_members m
      where m.library_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
    )
  );

create policy "photos bucket: members can delete"
  on storage.objects for delete
  using (
    bucket_id = 'photos'
    and exists (
      select 1 from library_members m
      where m.library_id::text = (storage.foldername(name))[1]
        and m.user_id = auth.uid()
    )
  );

-- ============================================================
-- シークレットルーム機能: メールアドレス不要・共通パスワードで
-- 入室できる部屋。パスワードのハッシュは専用テーブルに保存し、
-- 通常のAPI経由では一切読み出せないようにする(SECURITY DEFINER
-- 関数からのみアクセス可能)。
-- ============================================================

create table if not exists library_secrets (
  library_id uuid primary key references libraries(id) on delete cascade,
  password_hash text not null
);
alter table library_secrets enable row level security;
-- 意図的にポリシーを一切追加しない = 通常のAPI経由では誰も
-- select/insert/update/deleteできない(SECURITY DEFINER関数のみ操作可)。

-- 部屋を作成する(管理者がメールでログインした状態で呼び出す)
create or replace function create_secret_room(room_name text, room_password text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  new_id uuid;
begin
  if room_password is null or length(room_password) < 4 then
    raise exception 'パスワードは4文字以上にしてください';
  end if;

  insert into libraries (name)
  values (coalesce(nullif(trim(room_name), ''), 'シークレットルーム'))
  returning libraries.id into new_id;

  insert into library_secrets (library_id, password_hash)
  values (new_id, crypt(room_password, gen_salt('bf')));

  insert into library_members (library_id, user_id)
  values (new_id, auth.uid());

  return query
    select libraries.id, libraries.name, libraries.invite_code
    from libraries where libraries.id = new_id;
end;
$$;

-- 共通パスワードで部屋に入る(メール不要・匿名ログイン済みの状態で呼び出す)
create or replace function join_secret_room(room_password text)
returns table (id uuid, name text, invite_code text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  match_id uuid;
begin
  select library_secrets.library_id into match_id
  from library_secrets
  where library_secrets.password_hash = crypt(room_password, library_secrets.password_hash)
  limit 1;

  if match_id is null then
    raise exception 'パスワードが正しくありません';
  end if;

  insert into library_members (library_id, user_id)
  values (match_id, auth.uid())
  on conflict do nothing;

  return query
    select libraries.id, libraries.name, libraries.invite_code
    from libraries where libraries.id = match_id;
end;
$$;

grant execute on function create_secret_room(text, text) to authenticated;
grant execute on function join_secret_room(text) to authenticated;
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
  position int not null default 0,
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
