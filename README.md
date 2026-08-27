# フィルムキャビネット — Web/PWA版 セットアップガイド(詳細版)

このガイドは、**プログラミングのコマンド操作(ターミナル)を一切使わずに**公開できる手順です。
上から順番に、1つずつそのまま進めてください。

すでに完了していること: Supabaseで「SQL Editor」から `supabase/schema.sql` を実行し、テーブルを作成済み。
→ ここから続きです。

---

## STEP 1. SupabaseのURLと鍵(キー)をコピーする

1. https://supabase.com/dashboard を開き、作成したプロジェクトをクリックして開く
2. 画面**左側の一番下**にある歯車アイコン「**Settings**」をクリック
3. 出てきたメニューの中の「**API Keys**」(または「API」)をクリック
4. ページの上のほうに **Project URL** という欄があります。`https://xxxxxxxx.supabase.co` のような文字列です。右側のコピーボタンでコピーし、メモ帳などに貼り付けておく
5. 少し下に **Publishable key**(表示によっては「anon key」「anon public」)という欄があります。`sb_publishable_...` または `eyJ...` から始まる長い文字列です。これもコピーしてメモ帳に貼り付ける
   - 似た場所に **secret key** / **service_role** という鍵もありますが、それは絶対に使いません(コピーもしないでください)。使うのは必ず「Publishable」または「anon」と書かれた方です。

メモ帳に、次の2つが貼り付けてある状態にしてください。

```
URL: https://xxxxxxxx.supabase.co
KEY: sb_publishable_xxxxxxxxxxxxxxxx
```

---

## STEP 2. ダウンロードしたファイルをGitHubに置く

GitHubは、ファイルを置いておくための無料サービスです。ここに置いたファイルを、後でVercelという別のサービスが読みに来て公開してくれます。

### 2-1. GitHubのアカウントを作る(すでにお持ちならスキップ)

1. https://github.com を開く
2. 右上の「**Sign up**」からアカウントを作成(メールアドレスとパスワードでOK)

### 2-2. 新しいリポジトリ(保管場所)を作る

1. ログイン後、右上の「**+**」ボタン →「**New repository**」をクリック
2. Repository name に `film-cabinet-app` など好きな名前を入力
3. 「Public」のままでOK(自分だけが編集できるので中身を見られても問題ありません。心配な場合は「Private」を選んでも構いません)
4. 一番下の緑色の「**Create repository**」をクリック

### 2-3. ファイルをアップロードする

1. 作成されたリポジトリのページで、「**Add file**」ボタン →「**Upload files**」をクリック
2. さきほどダウンロードしたzipファイルを展開(解凍)して、**中に入っているファイル・フォルダをすべて選択**する
   - `package.json` / `index.html` / `src` フォルダ / `public` フォルダ / `supabase` フォルダ など全部
   - 一番外側の「film-cabinet-app」というフォルダそのものをドラッグしないでください。その中身を選んでドラッグします(フォルダの中を開いてから、中のファイル全部を選択する)
3. ブラウザの画面に、選択したファイル・フォルダをドラッグ&ドロップする
4. 下の方にある「Commit changes」の緑ボタンをクリック(コメント欄は空欄のままでOK)

アップロードが終わったら、リポジトリのページに `src`、`public`、`supabase`、`package.json` などが並んでいれば成功です。

---

## STEP 3. Vercelで公開する

Vercelは、GitHubに置いたファイルを自動的に「アプリとして動く状態」にビルドして、インターネット上に公開してくれる無料サービスです。

1. https://vercel.com を開き、「**Sign Up**」→「**Continue with GitHub**」でGitHubアカウントと連携してログイン
2. ログイン後、「**Add New...**」→「**Project**」をクリック
3. 「Import Git Repository」の一覧から、さきほど作った `film-cabinet-app` を探して「**Import**」をクリック
   - 一覧に出てこない場合は「Adjust GitHub App Permissions」からリポジトリへのアクセスを許可してください
4. 設定画面が開きます。**Framework Preset** は自動的に「Vite」になっているはずです(なっていなければ選択)
5. 「**Environment Variables**」という欄を開き、以下を1つずつ追加します(Name と Value を入力して「Add」を押すのを2回)

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | STEP1でメモした URL |
   | `VITE_SUPABASE_ANON_KEY` | STEP1でメモした KEY |

6. 「**Deploy**」ボタンをクリック
7. 30秒〜1分ほど待つと、「Congratulations!」という画面とともに、`https://film-cabinet-app-xxxx.vercel.app` のようなURLが発行されます

このURLが、公開されたWebアプリのアドレスです。

---

## STEP 4. Supabaseにログイン用URLを登録する

このステップを忘れると、ログインメールのリンクを押しても正しく戻ってこられません。

1. Supabaseのプロジェクト画面に戻る
2. 左側「**Authentication**」→「**URL Configuration**」を開く
3. 「**Redirect URLs**」という欄に、STEP3で発行されたURL(例: `https://film-cabinet-app-xxxx.vercel.app`)を追加して保存

---

## STEP 5. 実際に使ってみる

1. STEP3で発行されたURLをブラウザ(スマホでもPCでも)で開く
2. メールアドレスを入力して「ログインリンクを送る」
3. 届いたメールを開き、リンクをクリック(自動的にアプリに戻ってログイン完了)
4. 「新しいライブラリを作る」からライブラリを作成
5. 写真を追加してみる

スマホでは、開いた画面の共有ボタン(iPhone)やメニュー(Android)から「ホーム画面に追加」を選ぶと、アプリのように使えます。

---

## うまくいかないときは

- **ログインメールが届かない**:迷惑メールフォルダを確認。それでも届かない場合はSupabaseの「Authentication」→「Logs」でエラーがないか確認
- **写真を追加すると失敗する**:ブラウザの画面を右クリック→「検証」→「Console」タブに赤い文字のエラーが出ていないか確認し、その文言を教えてください
- **Vercelのビルドが失敗する(赤いエラー画面)**:「Deployments」タブから失敗したビルドを開き、ログの内容(特に赤い文字の部分)を教えてください
- 何かのエラーメッセージが出た場合は、そのメッセージをそのままコピーして聞いてください。文言があれば、次にどこを直せばいいか判断できます。

---

## 友だちと共有する

1. ライブラリ作成時に表示される「招待コード」を伝える
2. 友だちが同じURLを開いてログイン
3. 「参加する」欄にコードを入力すると、同じライブラリに参加できます

---

## 補足: 本格的なスマホアプリ(App Store / Google Play配信)にしたい場合

このPWAをそのまま Capacitor というツールで包むと、ほぼコードを変えずにiOS/Androidアプリとしてビルドできます。ただしその作業には開発環境(Xcode/Android Studio)が必要になるため、必要になったタイミングで改めて相談してください。
