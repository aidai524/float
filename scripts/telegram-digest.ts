/**
 * Telegram 每日简报（手动运行 / 由 daily-refresh 调用）。
 *
 *   pnpm digest             # 有凭据则发送；无凭据自动 dry-run
 *   pnpm digest --dry-run   # 只打印不发送
 *   pnpm digest --force     # 忽略「今日已发送」标记
 *
 * 配置（.env）：
 *   TELEGRAM_BOT_TOKEN=123456:ABC...
 *   TELEGRAM_CHAT_ID=@your_channel 或 -1001234567890
 */
import { createClient } from "@supabase/supabase-js";
import { maybeSendDigest } from "./lib/digest";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 没 .env 就继续，下面会给出清晰报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const raw = createClient(url, key, { auth: { persistSession: false } });

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

const r = await maybeSendDigest(raw, { dryRun, force });
console.log(r.text);
console.log(`\n— ${r.sent ? "✓ 已发送到 Telegram" : `未发送：${r.reason}`}`);
