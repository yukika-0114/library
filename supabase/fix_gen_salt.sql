-- pgcrypto (gen_salt / crypt) は Supabase では "extensions" スキーマに
-- インストールされるため、関数の検索パスに追加する修正。

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
