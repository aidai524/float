import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { browserSupabase } from "../lib/supabase-browser";

interface Props {
  supabaseUrl: string;
  supabaseAnonKey: string;
  tokenSymbols: string[];
}

interface WatchRow {
  token_symbol: string;
  created_at: string;
}

const card = "rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4";
const input =
  "rounded border border-[var(--color-line)] bg-[var(--color-bg)] px-2 py-1 text-[13px]";
const btn =
  "rounded bg-[var(--color-acc)] px-3 py-1 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50";

export default function AccountPanel({ supabaseUrl, supabaseAnonKey, tokenSymbols }: Props) {
  const supabase = useMemo(
    () => browserSupabase(supabaseUrl, supabaseAnonKey),
    [supabaseUrl, supabaseAnonKey],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [watch, setWatch] = useState<WatchRow[]>([]);
  const [symbol, setSymbol] = useState("");
  const [chatId, setChatId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [horizons, setHorizons] = useState<number[]>([7, 3, 1]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      setWatch([]);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("watchlists")
        .select("token_symbol,created_at")
        .order("created_at", { ascending: false });
      setWatch((data ?? []) as WatchRow[]);
      const { data: prefs } = await supabase
        .from("alert_prefs")
        .select("telegram_chat_id,enabled,horizons")
        .maybeSingle();
      if (prefs) {
        setChatId(prefs.telegram_chat_id ?? "");
        setEnabled(prefs.enabled ?? true);
        if (Array.isArray(prefs.horizons)) setHorizons(prefs.horizons as number[]);
      }
    })();
  }, [session, supabase]);

  async function signIn() {
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${location.origin}/account` },
    });
    setBusy(false);
    setMsg(error ? `发送失败：${error.message}` : "登录链接已发到邮箱，点击即可进入。");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMsg(null);
  }

  async function addSymbol() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || !session) return;
    setBusy(true);
    const { error } = await supabase
      .from("watchlists")
      .insert({ user_id: session.user.id, token_symbol: sym });
    setBusy(false);
    if (error && error.code !== "23505") {
      setMsg(`添加失败：${error.message}`);
      return;
    }
    setSymbol("");
    setMsg(null);
    const { data } = await supabase
      .from("watchlists")
      .select("token_symbol,created_at")
      .order("created_at", { ascending: false });
    setWatch((data ?? []) as WatchRow[]);
  }

  async function removeSymbol(sym: string) {
    if (!session) return;
    await supabase.from("watchlists").delete().eq("token_symbol", sym);
    setWatch((w) => w.filter((r) => r.token_symbol !== sym));
  }

  async function savePrefs() {
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.from("alert_prefs").upsert({
      user_id: session.user.id,
      telegram_chat_id: chatId.trim() || null,
      enabled,
      horizons,
      updated_at: new Date().toISOString(),
    });
    setBusy(false);
    setMsg(error ? `保存失败：${error.message}` : "告警设置已保存。");
  }

  if (!session) {
    return (
      <section className={card}>
        <h2 className="m-0 text-[14px] font-semibold">登录 / 注册</h2>
        <p className="mb-3 mt-1 text-[12px] text-[var(--color-mut)]">
          邮箱魔法链接登录（无需密码）。登录后可维护 Watchlist，并配置 Telegram 告警。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={input}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && signIn()}
          />
          <button className={btn} onClick={signIn} disabled={busy}>
            发送登录链接
          </button>
        </div>
        {msg && <p className="mb-0 mt-3 text-[12px] text-amber-400">{msg}</p>}
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px]">
            已登录：<span className="font-medium">{session.user.email}</span>
          </div>
          <button
            className="rounded border border-[var(--color-line)] px-3 py-1 text-[12px] hover:text-[var(--color-acc)]"
            onClick={signOut}
          >
            退出
          </button>
        </div>
      </section>

      <section className={card}>
        <h2 className="m-0 text-[14px] font-semibold">Watchlist</h2>
        <p className="mb-3 mt-1 text-[12px] text-[var(--color-mut)]">
          关注代币后，每日简报会检查 T-7 / T-3 / T-1 的解锁、上币等事件。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={input}
            list="token-symbols"
            placeholder="代币符号，如 HEMI"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSymbol()}
          />
          <datalist id="token-symbols">
            {tokenSymbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <button className={btn} onClick={addSymbol} disabled={busy}>
            添加
          </button>
        </div>
        <ul className="mt-3 mb-0 list-none space-y-1 p-0">
          {watch.map((w) => (
            <li key={w.token_symbol} className="flex items-center justify-between text-[13px]">
              <a href={`/token/${w.token_symbol}`} className="no-underline">
                {w.token_symbol}
              </a>
              <button
                className="text-[12px] text-[var(--color-mut)] hover:text-rose-400"
                onClick={() => removeSymbol(w.token_symbol)}
              >
                移除
              </button>
            </li>
          ))}
          {watch.length === 0 && (
            <li className="text-[12px] text-[var(--color-mut)]">还没有关注的代币。</li>
          )}
        </ul>
      </section>

      <section className={card}>
        <h2 className="m-0 text-[14px] font-semibold">Telegram 告警</h2>
        <p className="mb-3 mt-1 text-[12px] text-[var(--color-mut)]">
          给{" "}
          <a href="https://t.me/www333ddd_bot" target="_blank" rel="noopener">
            @www333ddd_bot
          </a>{" "}
          发一条消息（点 Start），并用{" "}
          <a href="https://t.me/userinfobot" target="_blank" rel="noopener">
            @userinfobot
          </a>{" "}
          查询你的数字 ID，填入下面即可接收个人告警。
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            启用告警
          </label>
          <input
            className={input}
            placeholder="Telegram chat ID，如 1068494943"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
          />
          {[7, 3, 1].map((h) => (
            <label key={h} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={horizons.includes(h)}
                onChange={(e) =>
                  setHorizons((hs) =>
                    e.target.checked
                      ? [...new Set([...hs, h])].sort((a, b) => b - a)
                      : hs.filter((x) => x !== h),
                  )
                }
              />
              T-{h}
            </label>
          ))}
          <button className={btn} onClick={savePrefs} disabled={busy}>
            保存
          </button>
        </div>
        {msg && <p className="mb-0 mt-3 text-[12px] text-amber-400">{msg}</p>}
      </section>
    </div>
  );
}
