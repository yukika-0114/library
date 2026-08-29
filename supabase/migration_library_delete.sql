-- ============================================================
-- ライブラリ削除機能を有効にするための権限追加。
-- libraries行を削除すると、外部キーのcascade設定により
-- そのライブラリの写真・アルバム・ギフトボード・メンバー等も
-- 自動的にすべて削除されます。
-- ============================================================

create policy "libraries: members can delete" on libraries
  for delete using (
    exists (
      select 1 from library_members m
      where m.library_id = libraries.id and m.user_id = auth.uid()
    )
  );
