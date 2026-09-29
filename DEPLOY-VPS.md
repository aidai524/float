# VPS 部署（数据 pipeline）

> 结论先行：**数据 pipeline 跑 VPS，站点托管继续用 Cloudflare Worker。**
> 实测（`pnpm probe`）：VPS 除 `defillama.com/unlocks` 外全部可达；该源对任何数据中心 IP
> 都返回 Cloudflare 质询，只有真实浏览器能取 → 用 `scripts/fetch-defillama-browser.mjs` 周期性快照。

## 0. 选机器

- **区域必须非美国**：Binance 对美区 IP 返回 `451`。推荐 `Singapore`（与 Supabase `ap-southeast-1` 同区，延迟低）、`London`、`Frankfurt`、`Tokyo`。
- 配置：**1 vCPU / 1–2 GB** 足够（只有 Node 脚本 + 偶尔的无头浏览器）。想常驻 Chromium 建议 2 GB。

## 1. 基础环境

```bash
# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
# pnpm（用 corepack，版本跟随 package.json）
sudo corepack enable
corepack prepare pnpm@12.6.0 --activate
```

## 2. 拉代码 + 依赖

```bash
git clone git@github.com:aidai524/float.git
cd float
pnpm install
```

## 3. 配置 `.env`

```bash
cp .env.example .env
$EDITOR .env      # 填 SUPABASE_*、FRED_API_KEY、COINMARKETCAL_API_KEY 等
```

`.env` 已被 `.gitignore` 排除，不会入库。脚本会用 `process.loadEnvFile()` 兜底读取。

## 4. 先探测可达性（关键）

```bash
pnpm probe
```

预期：Binance / Bybit / CMC / CoinGecko / FRED / CoinMarketCal / Supabase 全部 ✅，
`defillama-unlocks` ❌（Cloudflare 质询，正常）。

## 5. 应用迁移

```bash
# 需要 psql
sudo apt-get install -y postgresql-client
scripts/db-migrate.sh          # 应用 supabase/migrations + seed
```

## 6. 安装每日定时任务（cron）

```bash
scripts/install-daily-cron.sh install 01:10
scripts/install-daily-cron.sh status
```

每天 01:10 跑 `pnpm daily`：刷新 CMC 解锁 / Binance·Bybit 公告 / CoinMarketCal →
解析事件 → 打印简报。日志在 `.devsession/daily.log`。

## 7. DefiLlama 解锁快照（需要浏览器）

`defillama.com` 服务器取不到，只能用无头浏览器。**解锁是排期的**，几周跑一次即可。

```bash
pnpm add -D playwright
pnpm exec playwright install --with-deps chromium

# 试一次（headless 若被质询，用有头 + xvfb）
node scripts/fetch-defillama-browser.mjs
# 失败就：
sudo apt-get install -y xvfb
HEADFUL=1 xvfb-run -a node scripts/fetch-defillama-browser.mjs

# 成功后回填
pnpm unlocks:import
```

若想每周自动跑，加一条 cron：

```bash
# 每周一 02:00：取快照 → 回填
( crontab -l; echo '0 2 * * 1 cd '"$PWD"' && PATH="/usr/local/bin:/usr/bin:/bin:$(dirname $(command -v node))" node scripts/fetch-defillama-browser.mjs && pnpm unlocks:import >> .devsession/unlocks.log 2>&1 # float-unlocks' ) | crontab -
```

## 各部分跑在哪（现状）

| 组件 | 位置 | 原因 |
|---|---|---|
| 站点 + `/api/health` | Cloudflare Worker | CDN / 边缘 |
| CMC 解锁 / 公告 / 宏观 / 反应 | VPS cron | 常开、源可达 |
| DefiLlama 解锁快照 | VPS 浏览器（周期） | 仅浏览器能过质询 |
| Supabase | 云端 | 唯一数据源 |

## 常见坑

- **Binance 451** → VPS 区域在美国，换区。
- **cron 找不到 pnpm/node** → `install-daily-cron.sh` 已注入 PATH；手工改 crontab 时记得带。
- **Playwright 被 Cloudflare 挡** → `HEADFUL=1 xvfb-run` 重试；仍不行则回退到本机浏览器快照后 `scp` 到 VPS。
- **时区**：cron 按 VPS 本地时区。`timedatectl` 设 `UTC` 最省心。
