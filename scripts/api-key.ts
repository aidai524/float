/**
 * API key 管理（service role 直接写 public.api_keys）：
 *
 *   pnpm api-key create --name "alice" [--email a@b.com] [--plan pro]
 *   pnpm api-key list
 *   pnpm api-key revoke <id>
 *
 * 明文 key（float_…）只在 create 时打印一次；库里只存 SHA-256。
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // 继续走缺参报错
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const cmd = process.argv[2] ?? "list";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  if (cmd === "create") {
    const name = arg("--name");
    if (!name) {
      console.error('用法：pnpm api-key create --name "alice" [--email a@b] [--plan pro]');
      process.exit(1);
    }
    const plaintext = `float_${randomBytes(24).toString("hex")}`;
    const { data, error } = await db
      .from("api_keys")
      .insert({
        name,
        email: arg("--email") ?? null,
        plan: arg("--plan") ?? "free",
        key_hash: sha256(plaintext),
      })
      .select("id,name,email,plan,created_at")
      .single();
    if (error) throw error;
    console.log("✓ 已创建（明文只显示这一次，请立即保存）：");
    console.log(`  key  = ${plaintext}`);
    console.log(`  meta = ${JSON.stringify(data)}`);
    return;
  }

  if (cmd === "revoke") {
    const id = process.argv[3];
    if (!id) {
      console.error("用法：pnpm api-key revoke <id>");
      process.exit(1);
    }
    const { error } = await db.from("api_keys").update({ revoked: true }).eq("id", Number(id));
    if (error) throw error;
    console.log(`✓ 已吊销 #${id}（缓存最长 60s 后生效）`);
    return;
  }

  // list
  const { data, error } = await db
    .from("api_keys")
    .select("id,name,email,plan,revoked,created_at")
    .order("id", { ascending: false });
  if (error) throw error;
  if (!data?.length) {
    console.log("（还没有 API key）");
    return;
  }
  for (const k of data as any[]) {
    console.log(
      `#${k.id} ${k.name}${k.email ? ` <${k.email}>` : ""} · ${k.plan}${k.revoked ? " · REVOKED" : ""}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
