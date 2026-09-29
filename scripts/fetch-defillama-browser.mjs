/**
 * 用真实浏览器取 defillama.com/unlocks 的 __NEXT_DATA__（绕 Cloudflare 质询）。
 *
 * 为什么需要浏览器：defillama.com 对数据中心 IP 的 Node/curl fetch 一律返回
 * 403「Just a moment...」JS 质询（TLS/HTTP2 指纹识别），只有真实 Chromium 能过。
 * 这与登录/Pro 无关——不带任何 cookie 的浏览器 fetch 也能拿到全量数据。
 *
 * 引擎：
 *   - playwright  普通 Playwright（真 Chromium）
 *   - patchright  反检测分支，专治 Cloudflare（需单独安装）
 *
 * 安装（至少一个）：
 *   pnpm add -D playwright  && pnpm exec playwright  install chromium
 *   pnpm add -D patchright  && pnpm exec patchright  install chromium
 *
 * 用法：
 *   node scripts/fetch-defillama-browser.mjs                 # 依次试 4 种组合
 *   node scripts/fetch-defillama-browser.mjs --headful       # 有头（需 xvfb-run）
 *   node scripts/fetch-defillama-browser.mjs --engine=patchright
 *   node scripts/fetch-defillama-browser.mjs [输出路径]
 *
 * 典型 VPS 流程：
 *   sudo apt-get install -y xvfb
 *   xvfb-run -a node scripts/fetch-defillama-browser.mjs --headful
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const URL = "https://defillama.com/unlocks";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CHALLENGE = /just a moment|attention required|checking your browser|enable javascript/i;

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
};
const has = (name) => args.includes(`--${name}`);
const out = args.find((a) => !a.startsWith("--")) ?? ".cache/defillama-unlocks-nextdata.json";

/** 策略顺序：patchright 优先（反检测强），再退回普通 playwright；headless→headful */
function strategies() {
  const engine = flag("engine");
  const headful = has("headful");
  if (engine) return [{ engine, headless: !headful }];
  if (headful)
    return [
      { engine: "patchright", headless: false },
      { engine: "playwright", headless: false },
    ];
  return [
    { engine: "patchright", headless: true },
    { engine: "patchright", headless: false },
    { engine: "playwright", headless: true },
    { engine: "playwright", headless: false },
  ];
}

async function attempt(mod, { engine, headless }) {
  const label = `${engine} / ${headless ? "headless" : "headful"}`;
  process.stdout.write(`→ ${label} … `);
  let browser;
  try {
    browser = await mod.chromium.launch({
      headless,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (e) {
    console.log(`启动失败：${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return null;
  }
  try {
    const ctx = await browser.newContext({ locale: "en-US", userAgent: UA });
    const page = await ctx.newPage();
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90_000 });

    // 等 JS 质询自动放行
    await page
      .waitForFunction(
        () => !/just a moment|attention required|checking your browser/i.test(document.title),
        {
          timeout: 60_000,
        },
      )
      .catch(() => {});

    const title = await page.title();
    let json = await page.evaluate(
      () => document.getElementById("__NEXT_DATA__")?.textContent ?? null,
    );
    if (!json) {
      const html = await page.content();
      json =
        html.match(
          /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
        )?.[1] ?? null;
    }
    if (!json) {
      const blocked = CHALLENGE.test(title);
      console.log(
        `✗ 未拿到数据（title="${title}" status=${resp?.status() ?? "?"}${blocked ? " · 仍是质询页" : ""}）`,
      );
      return null;
    }
    const data = JSON.parse(json).props?.pageProps?.data ?? [];
    const events = data.reduce((n, p) => n + (p.events?.length ?? 0), 0);
    console.log(`✓ 成功`);
    return { label, json, protocols: data.length, events };
  } catch (e) {
    console.log(`✗ ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    return null;
  } finally {
    await browser.close();
  }
}

let won = null;
for (const s of strategies()) {
  let mod;
  try {
    mod = await import(s.engine);
  } catch {
    console.log(`→ ${s.engine} 未安装，跳过（pnpm add -D ${s.engine}）`);
    continue;
  }
  won = await attempt(mod, s);
  if (won) break;
}

if (!won) {
  console.error(
    "\n所有策略都失败。下一步：\n" +
      "  1) 安装 patchright：pnpm add -D patchright && pnpm exec patchright install chromium\n" +
      "  2) 有头模式：sudo apt-get install -y xvfb && xvfb-run -a node scripts/fetch-defillama-browser.mjs --headful\n" +
      "  3) 仍不行 → 住宅代理，或回退到本机浏览器快照后 scp 到 VPS",
  );
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, won.json);
console.log(`\n✓ 快照已保存：${out}`);
console.log(
  `  引擎：${won.label} · ${won.json.length} bytes · ${won.protocols} 协议 · ${won.events} 原始事件`,
);
console.log("  下一步：pnpm unlocks:import");
