# HANDOFF —— Float（加密事件研究引擎）

> 换电脑继续开发用。**先读这一份**，再读 `PLAN.md`（阶段计划）/ `TODO.md`（待办）/ `POSITIONING.md`（定位）。
> 最后更新：2026-10-01 · 36 commits · `main` 与 `origin/main` 同步

---

## 0. 一句话

**Float** —— 把加密货币的「已排期事件」（解锁 / 上币 / 宏观）和历史市场反应配对成可查询、可复算的数据产品。
差异化 = **预期 vs 实际**（隐含波动 / 稀释斜率），不是又一个新闻流或情绪面板。

---

## 1. 新电脑快速开始

```bash
git clone git@github.com:aidai524/float.git
cd float
pnpm install          # 需要 Node >= 22 + pnpm 12
```

**`.env` 不在仓库里，必须手动搬过来**（1Password / `scp` / 原来的电脑）。需要的变量见 `.env.example`：

| 变量 | 用途 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 数据库（云端唯一数据源） |
| `SUPABASE_DB_POOLER_URL` | 迁移 / 脚本直连（脚本内批量解析走 psql，避开 PostgREST 8s 超时） |
| `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` | 管理 API |
| `FRED_API_KEY` / `COINMARKETCAL_API_KEY` / `COINGECKO_API_KEY` | 数据源 |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | 部署 Worker |
| `.supabase-db-pass.txt` | 数据库密码（单独文件，gitignored） |

验证环境：

```bash
pnpm probe       # 数据源可达性（本机：除 defillama.com 外都应 ✅）
pnpm test        # 74 个测试
pnpm typecheck
pnpm dev         # 或 pnpm --filter @cee/web dev → http://localhost:4321
```

---

## 2. 基础设施清单

| 组件 | 地址 / 说明 |
|---|---|
| GitHub | `git@github.com:aidai524/float.git`（分支 `main`） |
| Cloudflare Worker | `https://float.aidai524.workers.dev`（站点 + `/api/*` + cron） |
| Supabase | 项目 ref 见 `.env` 的 `SUPABASE_PROJECT_REF`（ap-southeast-1） |
| VPS | Alpine Linux 3.24，跑数据 pipeline（用户自备，IP 见用户记录） |
| 本机 launchd | `ai.float.daily`（每天 01:10，与 VPS cron 二选一） |

---

## 3. 已完成

| 阶段 | 状态 | 内容 |
|---|---|---|
| P0–P3 | ✅ | monorepo / 契约层 / 采集 / 反应引擎 / Astro 前端（总览·日历·事件·代币） |
| P4.1 | ✅ | Deribit DVOL 隐含波动 + 惊讶度（FOMC 1.31×，非农 0.74×） |
| P4.2/4.3 | ✅ 代码+DB | 解锁稀释斜率 + 接收方分类（`api.unlock_*_v1`）；前端 `/unlocks` 页 |
| P6.1 部分 | ✅ | DefiLlama 解锁历史回填（21,506 cliff，含接收方类别/分配名） |
| P7.1 | ✅ | 仓位计算器 `/position`（用历史回撤分布 / 隐含波动定仓位） |
| P5.1 | ✅ 部署 | Cloudflare Worker（静态资源 + `/api/health` + cron 触发器） |
| P5.4 部分 | ✅ | 每日刷新 `pnpm daily`；VPS cron 安装脚本 |

**迁移**：`supabase/migrations/0001…0014`（`0013`=DefiLlama 源+`resolve_source_events()`，`0014`=解锁统计视图）

---

## 4. ⚠️ 关键网络事实（避免重踩）

各机器封锁差异极大，**换机器先跑 `pnpm probe`**：

| 数据源 | 本机 | Cloudflare Worker | VPS(Alpine) |
|---|---|---|---|
| Binance（价格/公告） | ✅ | ❌ 403 | ✅ |
| CoinGecko | ✅ | ✅ | ✅ |
| CoinMarketCap 解锁 | ✅ | ✅ | ✅ |
| Bybit / FRED / CoinMarketCal / Supabase | ✅ | ✅ | ✅ |
| **defillama.com/unlocks** | ❌ ECONNRESET | ❌ 403 质询 | ❌ 403 质询 |
| api.llama.fi/emissions | ✅ 402（付费） | ✅ 402 | ✅ 402 |

**defillama.com 只有真实浏览器能过**（Cloudflare 按 TLS/HTTP2 指纹识别，与登录/Pro 无关——实测不带 cookie 也能取）。
→ 用 `scripts/fetch-defillama-browser.mjs`。VPS 上的**可用组合**：

```bash
apk add --no-cache chromium   # musl 原生；Playwright 官方 glibc 构建在 Alpine 上跑不了
CHROME_PATH=/usr/bin/chromium node scripts/fetch-defillama-browser.mjs   # patchright/headless 一次过，无需 xvfb
```

**其他硬约束**
- **PostgREST 有 8s 语句超时** → 批量解析必须走 psql（`resolve_source_events()`），RPC 会超时。
- **前端是 SSG**：构建时从 Supabase 拉数据烘焙成静态页。**改了数据要重新 `pnpm deploy` 才上线**（旧数据不会自动刷新）。
- **Binance 对美区 IP 返回 451** → VPS/代理别选美国区。

---

## 5. 数据现状（2026-10-01）

```
events            22,521
  unlock_cliff    21,508   ← DefiLlama，21,506 含供应占比
  listing_cex        423
  unlock_linear      336   ← 仅 CMC 滚动窗口
  macro_cpi/nfp/fomc 75/73/56
  unknown             50
有反应的事件        2,127（其中 unlock_cliff 1,580）
tokens               512
price_candles     33,140
dvol_points       83,168
```

**Phase 4.2 结果（弱信号，需改进）**：`api.unlock_slope_v1` → N=1,399，`slope_4h_per_pct = -0.000412`，**R²=0.0015**。
即「每 1% 稀释 → 4h 约 -0.04%」，但解释力极低，不能作为卖点。见「下一步 #2」。

---

## 6. 下一步（按优先级）

### P0 — 收尾当前工作（半小时）
1. **重新部署 Worker**：`pnpm deploy`（会 build web + deploy worker）。当前 `/unlocks` 线上 **404**，因为 Worker 跑的是旧构建。
2. **确认 VPS 两个 cron**：`scripts/install-daily-cron.sh status` + `crontab -l`（应有 `float-daily` 和 `float-unlocks`）。
3. 提交/推送任何未提交改动（当前工作区是干净的）。

### P1 — 让解锁信号真的有用（Phase 4.2/4.3 v2）
现在 R²≈0，问题可能是：把「日度线性排放」和「悬崖解锁」混在一起、没做流动性过滤、没分接收方。
- 只用 cliff 且 `magnitude_pct >= 1%`；按 `tokens.adv_30d` 过滤微盘
- 分接收方看斜率（insiders / privateSale 通常比 community 重）
- 引入更大的观察窗（24h / 7d）和事件前基线
- 目标：给出**有统计意义**的「稀释 → 反应」区间，而不是一个 R²≈0 的斜率

### P2 — 上线与分发（Phase 5）
- 5.2 SEO + 性能：**首页 HTML 3.5MB**（把所有事件渲染进去了），Lighthouse ≥90 需分页/懒加载
- 5.3 公开 Telegram 频道：每日简报（未来 24h 解锁 + 同类基准，含 N 与口径版本）
- 5.5 全站合规文案（无投资建议）

### P3 — 供给侧加深（Phase 6）
- **linear 解锁**：目前没导（`noOfTokens` 是「每周速率」不是额度，硬算会虚高）。需要单独的速率表达。
- Bybit 价格回退（补齐无 Binance 交易对的标的）
- CoinGecko 元数据（市值/流通/板块）→ 上币预期输入
- DefiLlama Pro CSV（可选，若能解封更干净的历史）

### 明确不做
TradingView widget（商用条款）、交易执行、社交情绪、自建解锁精选库。

---

## 7. 约定与坑

- **密钥**：`.env`、`.supabase-db-pass.txt`、`.cache/`（8.6MB 快照）、`.wrangler/` 都已 gitignore，**永不提交**。
- **提交风格**：`feat(phaseX.Y): 中文描述`，一个功能一个 commit。
- **质量门**：`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`（lint 有 1 个既有 warning，可忽略）。
- **并行会话**：本仓库可能同时有多个 agent 会话在改（`54af2da`/`684ea7d` 就不是同一个会话做的）。**动手前先 `git pull` / `git log`**。
- **Deploy**：`pnpm deploy` = build web + `wrangler deploy`。Worker 的 `/api/_diag/{sources,db}` 是诊断端点（`?resolve=1` 才触发重型解析）。
- **VPS 上 npm/pnpm 混用**：`git pull` 若因 `package.json` 冲突，`git checkout package.json` 后用 pnpm 重装。

---

## 8. 关键文件

```
packages/data-layer/     采集 + 反应引擎（与环境无关，可在 Node/Worker 跑）
  src/sources/defillama-unlocks.ts   DefiLlama __NEXT_DATA__ 解析
supabase/migrations/     0001…0014（契约优先）
scripts/
  probe-sources.ts                 数据源可达性
  backfill-unlocks.ts              DefiLlama 回填（psql 解析）
  fetch-defillama-browser.mjs      浏览器快照（patchright/playwright × headless/headful）
  compute-reactions.ts             反应引擎（--min-pct）
  install-daily-cron.sh / install-unlocks-cron.sh
apps/web/                Astro SSG 前端
apps/worker/             Cloudflare Worker（静态资源 + /api + cron）
DATA-LAYER.md / PLAN.md / TODO.md / POSITIONING.md / DEPLOY-VPS.md
```
