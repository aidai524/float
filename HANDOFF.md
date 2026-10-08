# HANDOFF —— Float（加密事件研究引擎）

> 换电脑继续开发用。**先读这一份**，再读 `PLAN.md`（阶段计划）/ `TODO.md`（待办）/ `POSITIONING.md`（定位）。
> 最后更新：2026-10-08 · 45 commits · `main` 与 `origin/main` 同步

---

## 0. 一句话

**Float** —— 把加密货币的「已排期事件」（解锁 / 上币 / 宏观）和历史市场反应配对成可查询、可复算的数据产品。
差异化 = **预期 vs 实际**（隐含波动 / 稀释斜率），不是又一个新闻流或情绪面板。

---

## 1. 换开发机：先把这份清单做完，再开始开发

> **只换开发机。** 测试/部署机（VPS + Cloudflare Worker）不动——**不要**在新机器上装 cron，也**不要**重复部署。

### 前置

- Node ≥ 22、pnpm 12、git
- GitHub SSH key：`ssh -T git@github.com` 显示 `Hi aidai524!`
- 网络：Omarchy 本机所有外网走 `127.0.0.1:7897`；`.mise.toml` 已设 `NODE_USE_ENV_PROXY=1`（否则 Node fetch 不走代理，脚本全 ECONNRESET）；用 `mise exec -- pnpm …` 或重新激活 shell 生效
- 可选：`psql`（要跑迁移/回填才需要）；macOS 的 launchd **不要装**（VPS 已在跑）

### 步骤

**1) 克隆**

```bash
git clone git@github.com:aidai524/float.git
cd float
```

**2) 建 `.env`（不在仓库里，需安全搬过来：1Password / scp）**

| 新机器用途 | 需要的变量 |
|---|---|
| 只写代码 + 本地预览 | `SUPABASE_URL`、`SUPABASE_ANON_KEY` |
| + 跑脚本/回填 | 再加 `SUPABASE_SERVICE_ROLE_KEY`、`SUPABASE_DB_POOLER_URL`、`FRED_API_KEY`、`COINMARKETCAL_API_KEY`、`COINGECKO_API_KEY` |
| + 部署 Worker（可选） | 再加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |

格式照 `.env.example`。另外 `.supabase-db-pass.txt`（数据库密码）也是单独文件、gitignored。

**3) 安装依赖**

```bash
pnpm install
```

**4) 一道验证（全绿才算完成）**

```bash
node -v && pnpm -v      # Node ≥22 / pnpm 12
pnpm typecheck          # 0 errors
pnpm test               # 74 passed
pnpm probe              # 除 defillama.com 外应全 ✅
pnpm --filter @cee/web dev   # http://localhost:4321 能打开总览，有数据
```

**5) 按需（谨慎）**

- 要本地跑迁移/回填：装 `psql`，`scripts/db-migrate.sh`（**会改云端库**）
- **不要**跑 `scripts/install-daily-cron.sh` / `install-unlocks-cron.sh` —— VPS 已经在定时刷新，重复会冲突

### 完成标准

- [ ] `pnpm test` 全绿、`pnpm typecheck` 0 error
- [ ] `pnpm dev` 首页能打开且显示数据
- [ ] `git pull` 无冲突、工作区干净（`git status`）
- [ ] 没有在本机新增 cron / launchd

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
| **P4.2/4.3 v2** | ✅ 代码+数据 | float 稀释（占流通）+ 市场调整（−BTC）+ z 标准化 + 3/7d 长窗 + 事前漂移 + **placebo 对照**；`event_expectation` 表 + 5 个 `_v2` 视图；`pnpm expectations` 脚本 |
| P4.2/4.3 | ✅ 代码+DB | 解锁稀释斜率 + 接收方分类（`api.unlock_*_v1`）；前端 `/unlocks` 页 |
| P6.1 部分 | ✅ | DefiLlama 解锁历史回填（21,506 cliff，含接收方类别/分配名） |
| P7.1 | ✅ | 仓位计算器 `/position`（用历史回撤分布 / 隐含波动定仓位） |
| P5.1 | ✅ 部署 | Cloudflare Worker（静态资源 + `/api/health` + cron 触发器） |
| P5.4 部分 | ✅ | 每日刷新 `pnpm daily`；VPS cron 安装脚本 |

**迁移**：`supabase/migrations/0001…0015`（`0013`=DefiLlama 源+`resolve_source_events()`，`0014`=解锁统计视图 v1，`0015`=expectation/placebo/净效应 + 解锁 v2 视图）

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

**Phase 4.2/4.3 v2 结果（N=1,364，float ≥ 0.5%，流动性达标）**：
- 表观：解锁后 7 天中位 **−2.70%**（相对 BTC），≥10% 桶 −5.23%
- **但加 placebo 对照（同代币 T0−21d/14d 非事件窗口）后：净 7 天中位 +0.29%、均值 −0.22%（t=−0.36）→ 不显著**
- 分桶净 7 天均值：≥10% −1.37%（t=−0.24）· 1–2% −1.45%（t=−1.56）· 其余 |t|<1；净 7 天斜率 +0.11%/1% float（R²=0.0007）
- 净前 3 天：均值 −0.73%（t=−2.05，边缘）
- **结论：解锁规模不预测超常收益；表观「解锁砸盘」主要是代币自身的非事件漂移。产品价值在「分布 + 对照框架」，不是方向性预测**
- 口径 v1 斜率（`unlock_slope_v1`）：N=1,399、R²=0.0015，保留作历史对照

---

## 6. 下一步（按优先级）

### P0 — 收尾当前工作（在**部署/运行机**上做，不是开发机）
1. **重新部署站点**：`pnpm deploy`（= build web + deploy worker）。线上 `/unlocks` 现在 **404**，因为站点是 SSG，上次构建（在 `unlocks.astro` 之前）没有这个页。**任何代码或数据变化都需要重新构建+部署才上线**。
2. **确认 VPS 两个 cron**：`scripts/install-daily-cron.sh status` + `crontab -l`（应有 `float-daily` 和 `float-unlocks`）。
3. 确认工作区干净、已推送（当前 `048d15a` 是干净的）。

### P1 — 解锁 v2 已完成，转向上币预期（Phase 4.4）
解锁方向性信号已证伪（见上）；不要再花时间找「稀释 → 收益」斜率。下一步做**上币预期**：

- 前置：`tokens.market_cap` 全空 → 需 Phase 6.5 CoinGecko 元数据（本机经 7897 代理可达）
- 降级方案（不阻塞）：代币类别 × ADV 流动性档 → 上币反应区间（数据已有：listing_cex 427 条、category 490/512、adv 375/512）
- 交易所层级维度退化成单一 Binance，需先补 Bybit/OKX 公告源

### P2 — 上线与分发（Phase 5）
- 5.2 SEO + 性能：**首页 HTML 4.7MB**（把所有事件渲染进去了），无 sitemap/robots
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
  src/expectations.ts               市场调整 / 长窗 / placebo 净效应（纯函数）
supabase/migrations/     0001…0014（契约优先）
scripts/
  probe-sources.ts                 数据源可达性
  backfill-unlocks.ts              DefiLlama 回填（psql 解析）
  fetch-defillama-browser.mjs      浏览器快照（patchright/playwright × headless/headful）
  compute-reactions.ts             反应引擎（--min-pct）
  compute-expectations.ts          市场调整 + 长窗 + 事前漂移 + placebo（pnpm expectations）
  install-daily-cron.sh / install-unlocks-cron.sh
apps/web/                Astro SSG 前端
apps/worker/             Cloudflare Worker（静态资源 + /api + cron）
DATA-LAYER.md / PLAN.md / TODO.md / POSITIONING.md / DEPLOY-VPS.md
```
