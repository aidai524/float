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
# pnpm（Debian：corepack；Alpine 无 corepack → 用 npm 全局装）
sudo corepack enable && corepack prepare pnpm@12.6.0 --activate
# Alpine 改用：apk add nodejs npm git && npm install -g pnpm@12.6.0
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

`defillama.com` 服务器取不到，只能用真实浏览器。**解锁是排期的**，几周跑一次即可。

实测可用组合（Alpine + 系统 Chromium）：**`patchright` + headless**，无需 xvfb。
注意 Playwright/Patchright 官方的 glibc 构建在 musl 的 Alpine 上装不上，必须用系统 Chromium。

```bash
# 1) JS 引擎（二选一；patchright 反检测更强）
#    Alpine 用 npm/pnpm 装 JS 包即可，不需要 install chromium
pnpm add -D patchright

# 2) 系统浏览器 + 字体（Alpine）
apk add --no-cache chromium fontconfig ttf-dejavu
#    Debian/Ubuntu: apt-get install -y chromium；Arch: pacman -S chromium

# 3) 取快照（脚本依次试 patchright/playwright × headless/headful）
CHROME_PATH=/usr/bin/chromium node scripts/fetch-defillama-browser.mjs
#    若 headless 被质询：apk add xvfb && CHROME_PATH=/usr/bin/chromium xvfb-run -a node scripts/fetch-defillama-browser.mjs --headful

# 4) 回填（解析用 psql 避开 PostgREST 8s 超时）
apk add --no-cache postgresql-client
pnpm unlocks:import
```

每周自动跑：

```bash
scripts/install-unlocks-cron.sh install 1 02:00    # 每周一 02:00
scripts/install-unlocks-cron.sh status
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
- **Alpine 上浏览器 spawn ENOENT** → Playwright 官方 Chromium 是 glibc 构建，musl 跑不了；用 `CHROME_PATH=/usr/bin/chromium` + `apk add chromium`。
- **`pnpm unlocks:import` 解析超时** → 装 `postgresql-client`，脚本会走 psql（PostgREST 有 8s 语句超时）。
- **浏览器被 Cloudflare 挡** → 脚本会自动依次试 patchright/playwright × headless/headful；再不行用 `--headful` + xvfb；仍不行则回退到本机浏览器快照后 `scp` 到 VPS。
- **时区**：cron 按 VPS 本地时区。`timedatectl` 设 `UTC` 最省心。
