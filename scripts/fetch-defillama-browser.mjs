/**
 * 用无头浏览器取 defillama.com/unlocks 的 __NEXT_DATA__（绕 Cloudflare 质询）。
 *
 * defillama.com 对数据中心 IP 一律返回 403「Just a moment...」质询，
 * 本机/VPS/Worker 的 fetch 都过不了，只有真实浏览器渲染能过。
 *
 * 依赖（可选，仅此脚本用，不进主依赖）：
 *   pnpm add -D playwright && pnpm exec playwright install chromium
 *   若 headless 仍被质询，用虚拟显示跑有头模式：
 *     sudo apt install -y xvfb
 *     xvfb-run -a node scripts/fetch-defillama-browser.mjs
 *
 * 用法：
 *   node scripts/fetch-defillama-browser.mjs [输出路径]
 *   # 随后：pnpm unlocks:import
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "缺少 playwright。先跑：\n  pnpm add -D playwright && pnpm exec playwright install chromium",
  );
  process.exit(1);
}

const out = process.argv[2] ?? ".cache/defillama-unlocks-nextdata.json";
const URL = "https://defillama.com/unlocks";

const browser = await chromium.launch({
  headless: process.env.HEADFUL !== "1",
  args: ["--disable-blink-features=AutomationControlled"],
});
try {
  const ctx = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const status = resp?.status() ?? 0;

  // 等 Cloudflare 质询自动放行（标题不再是 Just a moment）
  await page
    .waitForFunction(
      () => !/just a moment|attention required|checking your browser/i.test(document.title),
      {
        timeout: 60_000,
      },
    )
    .catch(() => {});

  const html = await page.content();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m?.[1]) {
    console.error(
      `未拿到 __NEXT_DATA__（可能是 Cloudflare 质询没过）。title="${await page.title()}" status=${status}`,
    );
    console.error("试试有头模式：HEADFUL=1 xvfb-run -a node scripts/fetch-defillama-browser.mjs");
    process.exitCode = 1;
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, m[1]);
    const data = JSON.parse(m[1]).props?.pageProps?.data ?? [];
    const events = data.reduce((n, p) => n + (p.events?.length ?? 0), 0);
    console.log(`✓ 快照已保存：${out}`);
    console.log(`  ${m[1].length} bytes · ${data.length} 协议 · ${events} 原始事件`);
    console.log("  下一步：pnpm unlocks:import");
  }
} finally {
  await browser.close();
}
