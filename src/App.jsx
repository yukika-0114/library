import React, { useEffect, useState } from "react";
import { supabase } from "./supabaseClient.js";
import PhotoLibrary from "./PhotoLibrary.jsx";
import { Film, Loader2, Copy, Check, LogOut } from "lucide-react";

const GATE_CSS = `
.gate-root {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #05070d;
  background:
    radial-gradient(circle at 12% -8%, rgba(53,230,255,0.14), transparent 42%),
    radial-gradient(circle at 92% 108%, rgba(255,47,192,0.12), transparent 46%),
    #05070d;
  color: #eaf3ff;
  font-family: 'Inter', system-ui, sans-serif;
  padding: 24px;
}
.gate-card {
  width: 100%;
  max-width: 380px;
  background: #0b0f1c;
  border: 1px solid #223049;
  border-radius: 14px;
  padding: 28px 24px;
}
.gate-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #35e6ff;
  font-weight: 600;
  font-size: 17px;
  margin-bottom: 18px;
}
.gate-card h2 { font-size: 15px; font-weight: 500; margin: 0 0 14px; }
.gate-card p { font-size: 13px; color: #7c8ba8; line-height: 1.6; margin: 0 0 14px; }
.gate-card input {
  width: 100%;
  background: #121a2c;
  border: 1px solid #223049;
  color: #eaf3ff;
  border-radius: 8px;
  padding: 11px 12px;
  font-size: 16px;
  margin-bottom: 10px;
}
.gate-card input:focus { outline: none; border-color: #35e6ff; }
.gate-card button {
  width: 100%;
  background: #35e6ff;
  color: #06121a;
  border: none;
  border-radius: 8px;
  padding: 11px 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.gate-card button:disabled { opacity: 0.6; }
.gate-tabs {
  display: flex;
  gap: 6px;
  background: #121a2c;
  border: 1px solid #223049;
  border-radius: 9px;
  padding: 3px;
  margin-bottom: 18px;
}
.gate-tabs button {
  width: auto;
  flex: 1;
  background: transparent;
  color: #7c8ba8;
  padding: 8px 10px;
  font-size: 13px;
  border-radius: 6px;
}
.gate-tabs button.active {
  background: #35e6ff;
  color: #06121a;
}
.gate-card button.secondary {
  background: transparent;
  border: 1px solid #223049;
  color: #eaf3ff;
  margin-top: 8px;
}
.gate-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 20px 0;
  color: #7c8ba8;
  font-size: 11px;
}
.gate-divider::before, .gate-divider::after {
  content: "";
  flex: 1;
  height: 1px;
  background: #223049;
}
.gate-error {
  color: #ff4d6d;
  font-size: 12.5px;
  margin: -4px 0 12px;
}
.gate-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.gate-list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #121a2c;
  border: 1px solid #223049;
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13.5px;
}
.gate-list-item:hover { border-color: #35e6ff; }
.gate-code-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #121a2c;
  border: 1px solid #223049;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  margin-bottom: 6px;
}
.gate-code-row button {
  width: auto;
  background: transparent;
  color: #7c8ba8;
  padding: 4px;
}
.gate-signout {
  margin-top: 18px;
  text-align: center;
}
.gate-signout button {
  width: auto;
  background: transparent;
  color: #7c8ba8;
  font-size: 12px;
  font-weight: 400;
}
.gate-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  color: #7c8ba8;
}
.spin { animation: gate-spin 1s linear infinite; }
@keyframes gate-spin { to { transform: rotate(360deg); } }
`;

function SignIn() {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [stage, setStage] = useState("email"); // "email" | "code"
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function switchMode(next) {
    setMode(next);
    setStage("email");
    setCode("");
    setError("");
  }

  async function sendCode(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: mode === "signup" },
    });
    setBusy(false);
    if (error) {
      if (mode === "login" && /signup|not found|not allowed/i.test(error.message)) {
        setError(
          "このメールアドレスのアカウントが見つかりませんでした。初めての方は「新規作成」からどうぞ。"
        );
      } else {
        setError(error.message);
      }
      return;
    }
    setStage("code");
  }

  async function confirmCode(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) {
      setError("コードが正しくないか、期限切れの可能性があります。もう一度お試しください。");
    }
    // On success, the session updates automatically and App.jsx moves on —
    // nothing else to do here.
  }

  return (
    <div className="gate-root">
      <style>{GATE_CSS}</style>
      <div className="gate-card">
        <div className="gate-brand">
          <Film size={20} strokeWidth={1.75} />
          <span>フィルムキャビネット</span>
        </div>

        {stage === "email" && (
          <div className="gate-tabs">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              onClick={() => switchMode("login")}
            >
              ログイン
            </button>
            <button
              type="button"
              className={mode === "signup" ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              新規作成
            </button>
          </div>
        )}

        {stage === "email" ? (
          <form onSubmit={sendCode}>
            <h2>{mode === "signup" ? "新しいアカウントを作成" : "メールアドレスでログイン"}</h2>
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <p className="gate-error">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy && <Loader2 size={15} className="spin" />}
              確認コードを送る
            </button>
            <p style={{ marginTop: 14, fontSize: 11.5 }}>
              パスワードは不要です。届いたメール内の確認コードをこの画面で入力して
              {mode === "signup" ? "アカウントを作成します。" : "ログインします。"}
            </p>
          </form>
        ) : (
          <form onSubmit={confirmCode}>
            <h2>確認コードを入力</h2>
            <p>
              <strong style={{ color: "#eaf3ff" }}>{email}</strong>{" "}
              宛に確認コードを送信しました。メールを確認して入力してください。
            </p>
            <input
              inputMode="numeric"
              autoFocus
              placeholder="コードを入力"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ textAlign: "center", letterSpacing: "0.3em", fontSize: 20 }}
            />
            {error && <p className="gate-error">{error}</p>}
            <button type="submit" disabled={busy || code.trim().length === 0}>
              {busy && <Loader2 size={15} className="spin" />}
              {mode === "signup" ? "作成してログイン" : "ログイン"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setStage("email");
                setCode("");
                setError("");
              }}
            >
              メールアドレスを変更する
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function LibraryGate({ session, onReady }) {
  const [libraries, setLibraries] = useState(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadLibraries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadLibraries() {
    const { data, error } = await supabase
      .from("library_members")
      .select("library_id, libraries ( id, name, invite_code )")
      .eq("user_id", session.user.id);
    if (error) {
      setError(error.message);
      setLibraries([]);
      return;
    }
    setLibraries((data || []).map((r) => r.libraries).filter(Boolean));
  }

  async function createLibrary(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase
      .from("libraries")
      .insert({ name: newName.trim() || "マイライブラリ" })
      .select()
      .single();
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    const { error: memberErr } = await supabase
      .from("library_members")
      .insert({ library_id: data.id, user_id: session.user.id });
    setBusy(false);
    if (memberErr) {
      setError(memberErr.message);
      return;
    }
    onReady(data);
  }

  async function joinLibrary(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase
      .from("libraries")
      .select("*")
      .eq("invite_code", joinCode.trim())
      .maybeSingle();
    if (error || !data) {
      setError("招待コードが見つかりませんでした");
      setBusy(false);
      return;
    }
    const { error: memberErr } = await supabase
      .from("library_members")
      .upsert({ library_id: data.id, user_id: session.user.id });
    setBusy(false);
    if (memberErr) {
      setError(memberErr.message);
      return;
    }
    onReady(data);
  }

  if (libraries === null) {
    return (
      <div className="gate-loading">
        <style>{GATE_CSS}</style>
        <Loader2 size={22} className="spin" />
      </div>
    );
  }

  return (
    <div className="gate-root">
      <style>{GATE_CSS}</style>
      <div className="gate-card">
        <div className="gate-brand">
          <Film size={20} strokeWidth={1.75} />
          <span>フィルムキャビネット</span>
        </div>

        {libraries.length > 0 && (
          <>
            <h2>ライブラリを選ぶ</h2>
            <div className="gate-list">
              {libraries.map((lib) => (
                <div
                  key={lib.id}
                  className="gate-list-item"
                  onClick={() => onReady(lib)}
                >
                  <span>{lib.name}</span>
                  <span style={{ color: "#7c8ba8", fontSize: 11 }}>開く →</span>
                </div>
              ))}
            </div>
            <div className="gate-divider">または</div>
          </>
        )}

        <form onSubmit={createLibrary}>
          <h2>新しいライブラリを作る</h2>
          <input
            placeholder="ライブラリ名(例: 家族の写真)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy && <Loader2 size={15} className="spin" />}
            作成する
          </button>
        </form>

        <div className="gate-divider">友だちのライブラリに参加</div>

        <form onSubmit={joinLibrary}>
          <input
            placeholder="招待コードを入力"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
          />
          <button type="submit" className="secondary" disabled={busy}>
            参加する
          </button>
        </form>

        {error && <p className="gate-error" style={{ marginTop: 12 }}>{error}</p>}

        <div className="gate-signout">
          <button onClick={() => supabase.auth.signOut()}>
            <LogOut size={13} style={{ marginRight: 4 }} />
            ログアウト
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteBanner({ library, onDismiss }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gate-root">
      <style>{GATE_CSS}</style>
      <div className="gate-card">
        <div className="gate-brand">
          <Film size={20} strokeWidth={1.75} />
          <span>{library.name}</span>
        </div>
        <h2>友だちを招待する</h2>
        <p>このコードを共有すると、相手も同じライブラリで写真を追加・編集できます。</p>
        <div className="gate-code-row">
          <span style={{ flex: 1 }}>{library.invite_code}</span>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(library.invite_code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <button onClick={onDismiss} style={{ marginTop: 10 }}>
          ライブラリを開く
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [library, setLibrary] = useState(null);
  const [showInvite, setShowInvite] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setLibrary(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="gate-loading">
        <style>{GATE_CSS}</style>
        <Loader2 size={22} className="spin" />
      </div>
    );
  }

  if (!session) return <SignIn />;

  if (!library) {
    return (
      <LibraryGate
        session={session}
        onReady={(lib) => {
          setLibrary(lib);
          setShowInvite(true);
        }}
      />
    );
  }

  if (showInvite) {
    return (
      <InviteBanner
        library={library}
        onDismiss={() => setShowInvite(false)}
      />
    );
  }

  return (
    <PhotoLibrary
      library={library}
      session={session}
      onLeaveLibrary={() => setLibrary(null)}
    />
  );
}
