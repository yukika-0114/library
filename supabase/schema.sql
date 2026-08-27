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
  album text not null default '',
  favorite boolean not null default false,
  current int not null default 0,
  target int not null default 0,
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
