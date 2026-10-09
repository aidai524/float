# 加密事件研究引擎（Crypto Event Study Engine）需求与阶段计划

> 代号：**MoonEvent**（占位名）
> 定位：GoMoon 的"事件→历史反应测量"内核，做成加密原生版本。
> 主线：**先做 SaaS（解锁 + 上币），后做 Web3 化与 B2B 数据层。**
> 目标：早期月成本 < $50，无专职运维。

---

## 目录

- [0. 一句话定位与核心差异](#0-一句话定位与核心差异)
- [1. 完整需求](#1-完整需求)
  - [1.1 用户角色](#11-用户角色)
  - [1.2 用户故事](#12-用户故事)
  - [1.3 功能需求 FR](#13-功能需求-fr)
  - [1.4 非功能需求 NFR](#14-非功能需求-nfr)
  - [1.5 数据口径（最关键）](#15-数据口径最关键)
- [2. 技术架构（Cloudflare + Supabase）](#2-技术架构cloudflare--supabase)
  - [2.1 架构总览](#21-架构总览)
  - [2.2 组件职责与选型理由](#22-组件职责与选型理由)
  - [2.3 数据库 Schema v1](#23-数据库-schema-v1)
  - [2.4 数据管道](#24-数据管道)
  - [2.5 认证与多租户](#25-认证与多租户)
  - [2.6 第三方数据源对接（含实测结果）](#26-第三方数据源对接含实测结果)
- [3. UI 库推荐](#3-ui-库推荐)
- [4. 阶段性计划（每阶段可独立测试）](#4-阶段性计划每阶段可独立测试)
- [5. 成本与运维](#5-成本与运维)
- [6. 风险与 Kill 条件](#6-风险与-kill-条件)
- [附录 A：目录结构建议](#附录-a目录结构建议)
- [附录 B：环境变量清单](#附录-b环境变量清单)

---

## 0. 一句话定位与核心差异

> **名字：Float** · 定位、边界与命名取舍见 **[POSITIONING.md](./POSITIONING.md)**

**Float 是加密供给侧事件的实测反应参考层。**
不只是告诉你事件几点发生，而是告诉你这类事件历史上发生后价格实际怎么走、样本多大，以及**这次偏离了多少**。

三个不可妥协的信任标签：

1. `Based on historical market data · Not AI-generated`
2. 每个统计都显示 **样本量 N** 和 **口径版本 methodology_version**
3. 方法与数据集**可审计、可验证**（数据质量问题如实标注：`base_after_t0`、流动性三态）

**供给侧楔子：代币解锁 + 交易所上币。** T0 最干净、需求最痛、而且"预期"是链上写死的（零误差）。

**下一步差异化：预期 vs 实际**（Phase 4）——用期权隐含波动与历史斜率，把"历史怎么走"升级成"这次偏离了多少"。

---

## 1. 完整需求

### 1.1 用户角色

| 角色 | 需求 | 付费 |
|---|---|---|
| 散户交易者 | 看事件日历、看某代币历史反应 | 免费（引流/SEO） |
| 进阶交易者（Pro） | 反应分布、可比事件、实时告警、watchlist | $19–39/月 |
| 研究者 / 小基金 | 批量导出、筛选、CSV/API | Pro / API 档 |
| 开发者 / AI Agent | API key、MCP | API 档（按量） |

### 1.2 用户故事

- 作为交易者，我想在解锁前 **7 / 3 / 1 天**收到告警，避免被供给冲击。
- 作为交易者，我想知道某代币**上次解锁后 15m / 1h 实际怎么走**。
- 作为交易者，我想找到**和这次最像的历史事件**，看它们的反应分布。
- 作为研究者，我想按事件类型 / 市值 / 流动性 / 板块**筛选并用 API 拉数据**。

### 1.3 功能需求 FR

| 编号 | 功能 | 说明 | 阶段 |
|---|---|---|---|
| FR-1 | 事件日历 | 解锁 + 上币，按日/周/月视图，可筛选 | P1/P3 |
| FR-2 | 事件详情页 | 单事件：时间、规模、接收方、来源链接 | P3 |
| FR-3 | 反应测量 | T0 相对收益 5m/15m/1h/4h/24h、波动率、成交量、最大回撤/冲高 | P2 |
| FR-4 | 反应分布 | 同类事件样本分布（中位数/分位数）+ 样本量 N | P2/P3 |
| FR-5 | 可比事件 | 特征向量 + KNN，返回 top-K 历史可比事件 | P4 |
| FR-6 | Impact Score | 事件重要性 0–100（规则+AI，可解释） | P4 |
| FR-7 | AI 摘要 | 事件后自动摘要（明确标注 AI 生成，不参与数字） | P4 |
| FR-8 | 告警 | Telegram / Discord / 邮件，T-7/T-3/T-1 与事件后 T+0 | P5 |
| FR-9 | Watchlist | 关注代币/板块，个性化首页 | P5 |
| FR-10 | 搜索与筛选 | 代币、事件类型、市值、流动性、板块、时间窗 | P3 |
| FR-11 | 账号与订阅 | 免费/Pro 分层，Stripe + USDC | P6 |
| FR-12 | 公开 API | REST + API key + 用量计量 + 文档 | P7 |
| FR-13 | MCP Server | 让 AI agent 直接查询（对标 CoinMarketCal） | P7 |
| FR-14 | 可验证数据 | 数据集哈希上链 / 开源方法论 | P7 |
| FR-15 | 事件类型扩展 | 宏观(FOMC/CPI)、主网升级、空投/TGE、ETF、治理 | P8 |

### 1.4 非功能需求 NFR

- **性能**：首屏 LCP < 1.5s（4G）；API p95 < 300ms；日历页可静态化/边缘缓存。
- **成本**：公开 Beta 前月成本 ≤ $5；有付费用户后 ≤ $50。
- **SEO**：每个代币/事件类型页可被索引（事件日历是主要自然流量入口）。
- **可审计**：所有统计写入 `methodology_version`；口径变更需版本号 + changelog。
- **数据质量**：流动性过滤、去重、幂等写入、来源标注。
- **合规**：全站定位"数据/教育"，不提供投资建议；不预测价格。
- **可用性**：核心读路径 99.9%（边缘缓存兜底，DB 挂时仍能出静态页）。

### 1.5 数据口径（最关键）

**T0 定义（按优先级确认，并存 `t0_confidence`）：**

| 事件 | T0 | 置信度 |
|---|---|---|
| 解锁 cliff | 链上/官方时间戳 | high |
| 解锁 linear | 每日 00:00 UTC（取发布时区规则） | medium |
| CEX 上币 | 交易所公告时间 → 实际开盘时间 | high |
| DEX 上币 | 首个有效池子创建时间 | medium |
| TGE/空投 claim | claim 开启时间 | high |
| 主网升级 | 硬分叉区块时间 | high |
| 宏观 FOMC/CPI | 官方发布时刻 | high |

**反应计算口径（v1）：**

```
基准价 base   = T0 前最近一根 1m K 线收盘（fallback: T0 后第一根）
收益 return_Δ = price(T0+Δ) / base - 1        Δ ∈ {5m,15m,1h,4h,24h}
波动 vol_Δ    = 窗口内 1m 对数收益标准差
量能 vol_ratio= 窗口成交量 / 该 token 过去 30 天同时段中位成交量
最大回撤 mdd  = 窗口内最大 (从局部高点回撤)
最大冲高 mfu  = 窗口内最大 (相对 base 的最高涨幅)
```

**交易所口径**：主用 Binance（USDT 永续/现货），缺失回退 Bybit、OKX；`price_source` 落库。
**流动性过滤**：30 天 ADV < 阈值（初值 $500k）的低流动性代币，**只展示样本量不展示分布**，避免噪声误导。
**样本透明**：任何聚合统计必须同时返回 N 与覆盖时间范围。

---

## 2. 技术架构（Cloudflare + Supabase）

### 2.1 架构总览

```
                 ┌──────────────────────────────────────────┐
   浏览器 ───────▶│  Cloudflare Workers + Static Assets       │
                 │  ├─ Astro 静态/SSR 页面（SEO）            │
                 │  ├─ React islands（仪表盘/图表）          │
                 │  └─ Hono API（/api/*）                    │
                 └───────┬───────────────┬──────────────────┘
                         │               │
             ┌───────────▼───┐   ┌───────▼────────────┐
             │  Cloudflare    │   │  Supabase          │
             │  KV (cache)    │   │  ├─ Postgres       │
             │  R2 (导出/数据)│   │  ├─ pgvector(可比) │
             │  Queues(告警)  │   │  ├─ Auth           │
             │  Cron(采集)    │   │  ├─ Realtime       │
             └───────┬────────┘   │  └─ Storage        │
                     │            └────────────────────┘
                     ▼
        外部数据源：Binance/Bybit/OKX、DefiLlama、Tokenomist、
                    CoinMarketCal、CoinGecko、FRED、RSS
```

### 2.2 组件职责与选型理由

| 组件 | 用途 | 为什么 | 免费额度 |
|---|---|---|---|
| **Cloudflare Workers + Static Assets** | 前端托管 + API + 定时任务 | 边缘、零冷启动、静态资源不限带宽；替代 Pages | 免费 10 万请求/天 |
| **Cron Triggers** | 定时采集、计算、告警派发 | 无需自己跑服务器 | 免费档可用 |
| **KV** | 热点读缓存、限流计数 | 读多写少、就近命中 | 10 万读/天 |
| **R2** | CSV/Parquet 导出、备份 | **无 egress 费用** | 10GB 存储 |
| **Queues** | 告警派发、重试 | 削峰、可靠投递（需 Workers Paid） | $5/月 |
| **D1（可选）** | 边缘小表缓存（可选） | 就近读 | 5GB |
| **Supabase Postgres** | 唯一事实源（SoT） | 关系型 + SQL 窗口函数 + pgvector | 500MB（Free）/8GB（Pro） |
| **pgvector** | 可比事件 KNN | 不用额外向量库 | 含在 Postgres |
| **Supabase Auth** | 账号体系 | 内置 JWT/RLS/多租户 | 5 万 MAU |
| **Supabase Realtime** | 实时告警推送（可选） | WebSocket | 含 |
| **Supabase Storage** | 用户导出文件 | | 1GB |
| **Cloudflare Analytics Engine** | 产品指标 | 便宜、边缘 | 免费档 |
| **Workers AI** | 事件摘要（可选） | 无需外部 key、便宜 | 每日免费额度 |

> **原则：Supabase 是唯一 DB，Cloudflare 只做计算与缓存，绝不做双写。**

### 2.3 数据库 Schema v1

> 数据层的完整设计（分层、适配器、契约视图、扩展机制）见 **[DATA-LAYER.md](./DATA-LAYER.md)**；下方 Schema 与之一致。

```sql
-- 代币元数据
create table tokens (
  id            bigserial primary key,
  symbol        text not null,
  name          text,
  coingecko_id  text unique,
  category      text,              -- l1/l2/defi/meme/gaming/ai/...
  market_cap    numeric,
  adv_30d       numeric,           -- 30 天日均成交额（流动性过滤用）
  created_at    timestamptz default now()
);

-- 统一事件表
create table events (
  id              bigserial primary key,
  event_type      text not null,   -- unlock_cliff/unlock_linear/listing_cex/listing_dex/tge/upgrade/macro_fomc/...
  token_id        bigint references tokens(id),
  t0              timestamptz not null,
  t0_confidence   text not null check (t0_confidence in ('high','medium','low')),
  magnitude_usd   numeric,         -- 解锁金额 / 市值等
  magnitude_pct   numeric,         -- 占流通比例
  detail          jsonb,           -- 接收方、轮次、交易所、来源链接等
  source          text,
  source_url      text,
  dedupe_hash     text unique,     -- 幂等去重
  created_at      timestamptz default now()
);
create index on events (event_type, t0);
create index on events (token_id, t0);

-- 反应测量结果（唯一核心资产）
create table event_reactions (
  id                  bigserial primary key,
  event_id            bigint references events(id) on delete cascade,
  price_source        text not null,          -- binance/bybit/okx
  base_price          numeric,
  ret_5m              numeric,
  ret_15m             numeric,
  ret_1h              numeric,
  ret_4h              numeric,
  ret_24h             numeric,
  vol_5m              numeric,
  vol_1h              numeric,
  vol_ratio           numeric,
  max_drawdown        numeric,
  max_favorable       numeric,
  methodology_version text not null default 'v1',
  computed_at         timestamptz default now(),
  unique (event_id, price_source, methodology_version)
);

-- 事件特征向量（可比事件用）
create table event_features (
  event_id     bigint primary key references events(id) on delete cascade,
  feature_vec  vector(32) not null,
  feature_json jsonb not null,               -- 可解释
  created_at   timestamptz default now()
);
create index on event_features using ivfflat (feature_vec vector_cosine_ops);

-- 用户与关注
create table watchlists (
  id         bigserial primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  token_id   bigint references tokens(id),
  created_at timestamptz default now(),
  unique (user_id, token_id)
);

-- 订阅/套餐
create table subscriptions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  tier        text not null default 'free',   -- free/pro/api
  stripe_id   text,
  usdc_tx     text,
  expires_at  timestamptz,
  updated_at  timestamptz default now()
);

-- API 用量
create table api_usage (
  id         bigserial primary key,
  key_id     bigint,
  endpoint   text,
  ts         timestamptz default now()
);

-- 数据源注册表（适配层配置）
create table data_sources (
  id            text primary key,        -- 'binance','coinmarketcal','fred'...
  type          text not null,
  auth          text not null default 'none',
  cost_tier     text not null default 'free',
  rate_limit    jsonb,                   -- {rpm, dailyQuota}
  refresh       text,
  fallback      text[],                  -- 回退源 id
  enabled       boolean default true,
  config        jsonb,                   -- base_url、类目映射等
  updated_at    timestamptz default now()
);

-- 采集运行日志（可观测）
create table ingest_runs (
  id          bigserial primary key,
  source_id   text references data_sources(id),
  started_at  timestamptz default now(),
  finished_at timestamptz,
  ok_count    int default 0,
  fail_count  int default 0,
  error       text,
  meta        jsonb
);
create index on ingest_runs (source_id, started_at desc);
```

启用 **RLS**：`watchlists` / `subscriptions` 仅本人可读写；`events` / `event_reactions` 公开只读。

### 2.4 数据管道

```
Cron(每 15m) ──▶ Worker: ingest-prices      ──▶ Supabase: prices_1m
Cron(每 6h)  ──▶ Worker: ingest-events      ──▶ Supabase: events (upsert by dedupe_hash)
Cron(每 1h)  ──▶ Worker: compute-reactions  ──▶ Supabase: event_reactions
Cron(每 1d)  ──▶ Worker: recompute-features ──▶ Supabase: event_features
Cron(每日 2 次)▶ Worker: dispatch-alerts    ──▶ Queues ──▶ Telegram/Discord/Email
```

- **幂等**：所有写入 `upsert` + `dedupe_hash`。
- **重试**：外部 API 失败进入 Queues 重试，指数退避。
- **回填**：历史数据用一次性脚本（本地跑或 Workers 长任务），不做实时。
- **可复算**：`methodology_version` 变更时，按事件类型重算，不覆盖旧版本。

### 2.5 认证与多租户

- 起步用 **Supabase Auth 邮箱魔法链接**（零成本、零密码）。
- Phase 6 增加**钱包登录（SIWE）**：Self-implement SIWE 并签发 Supabase JWT，或用 Privy / Dynamic / Reown（WalletConnect）免费档。
- 全部权限靠 **RLS + JWT role**，不写业务层权限。

---

### 2.6 第三方数据源对接（含实测结果）★

> 实测时间 2026-09，直接 `curl` / 无头浏览器验证。**这是本项目最大的非技术风险点：价格数据免费好拿，事件数据（尤其解锁）正在快速收费化。**

#### 2.6.1 实测结果

| 数据源 | 接口 | 实测 | 结论 |
|---|---|---|---|
| Binance 现货 K 线 | `api.binance.com/api/v3/klines` | **200，免 key** | ✅ 主价格源 |
| Bybit K 线 | `api.bybit.com/v5/market/kline` | **200，免 key** | ✅ 回退价格源 |
| OKX K 线 | `okx.com/api/v5/market/candles` | 部分网络空响应 | ⚠️ 需代理/备用，非主源 |
| DefiLlama 通用 API | `api.llama.fi/protocol/*` | 200，免费 | ✅ 代币/TVL 元数据 |
| **DefiLlama 解锁/emissions** | `api.llama.fi/emissions/*` | **402 需付费** | ❌ 免费档已取消 |
| CoinGecko | `api.coingecko.com/api/v3/*` | 需 Demo key，易限流 | ⚠️ 只做元数据补充 |
| CoinMarketCal | `x-api-key` 头 | 站点有 Cloudflare bot 防护 | ✅ 有 Free/Standard/Pro/Elite 档，Free=1 seat |
| Binance 公告接口 | `bapis/.../cms/article/list/query` | **202 被挑战** | ⚠️ 走 RSS 或非官方接口 |
| CryptoPanic | `auth_token` | 需 token | ✅ 免费档有 |
| FRED（宏观） | `api.stlouisfed.org` | 需有效 key | ✅ 免费 key |
| Coindar | paid API | 需付费 token | ❌ 暂不用 |

**已知付费价格（2026-07 数据）**：DefiLlama Pro **$49/月**、DefiLlama API **$250/月**（含 100 万调用）；Tokenomist / CryptoRank 企业 API 需询价。

#### 2.6.2 数据源矩阵（按能力 + 成本）

| 能力 | 首选 | 回退 | 刷新频率 | 成本 |
|---|---|---|---|---|
| 1m / 日线行情 | Binance | Bybit → OKX | 1m 每 15min 拉取 | 免费 |
| 代币元数据/市值 | CoinGecko Demo | CoinMarketCap Free | 每 6h | 免费 |
| **上币事件** | CoinMarketCal Free | 交易所公告 RSS + 人工兜底 | 每 1h | 免费 |
| **解锁事件** | CoinMarketCal Free（若含解锁类目） | 自建精选库 → 付费源 | 每日 | 免费起步 |
| 宏观日历 | FRED | 官方发布页静态表 | 每日 | 免费 |
| 新闻/情绪 | CryptoPanic Free | RSS | 每 15min | 免费 |

**解锁数据的现实策略（重要）**：

1. **MVP 阶段**：CoinMarketCal 免费档 + **自建 top 200–300 代币精选解锁库**（来源：项目官方解锁文档、白皮书、链上 vesting 合约）。人工/半自动维护，反而成为早期数据资产。
2. **有收入后**：再上 DefiLlama Pro（$49/月）或 Tokenomist/CryptoRank API，做全量覆盖。
3. **不建议**：早期硬抓付费墙或违反 ToS 的页面。

#### 2.6.3 统一适配层（关键工程决策）

所有外部源走**同一个适配器接口**，业务代码永不直接耦合某个供应商：

```ts
interface DataSource {
  id: string;                       // 'binance', 'coinmarketcal', ...
  type: 'price' | 'unlock' | 'listing' | 'macro' | 'news';
  auth: 'none' | 'api_key';
  costTier: 'free' | 'paid';
  rateLimit: { rpm: number; dailyQuota: number };
  refresh: string;                  // '15m' | '1h' | '1d'
  fallback: string[];               // 源 id 优先级链
  fetch(params: FetchParams): Promise<RawPayload[]>;
  normalize(raw: RawPayload): NormalizedEvent;
}
```

配套能力：
- **优先级链 + 自动降级**：主源失败自动切 fallback，并记录命中源。
- **配额守卫**：每源用一个 KV 计数器，接近限额自动降频/告警，避免打爆被封。
- **溯源字段**：每条事件/价格必须落 `source`、`source_url`、`fetched_at`、`raw_hash`。
- **幂等**：`dedupe_hash = hash(event_type + token + t0 + 关键字段)`。
- **可观测**：`ingest_runs` 记录每次采集的成功数/失败数/耗时。

#### 2.6.4 对接优先级（按阶段）

| 阶段 | 必须接入 | 可选 |
|---|---|---|
| P1 | Binance、Bybit、CoinGecko、CoinMarketCal Free | CryptoPanic、FRED |
| P2 | 自建解锁精选库 | — |
| P3+ | 解锁全量（付费源）、宏观（FRED）、主网升级源 | Kaito / Glassnode 等 |

---

## 3. UI 库推荐

**明确原则：SaaS 风格、数据密集型、首屏快、交互克制。**

### 首选组合（推荐）

| 用途 | 库 | 理由 |
|---|---|---|
| CSS / 设计系统 | **Tailwind CSS v4** | 无运行时、产物小 |
| 组件（复制的） | **shadcn/ui** | 不是依赖，是源码；按需引入，包体最小 |
| Dashboard 组件 | **Tremor** | 专为数据展示：KPI 卡、面积/柱/折线图，SaaS 观感一致 |
| K 线图 | **TradingView Lightweight Charts** | ~45KB，免费，天生支持事件标注线——和 GoMoon 同款思路 |
| 普通图表 | **Recharts** 或 **visx** | Recharts 上手快；visx 更小更可控 |
| 表格 | **TanStack Table** | Headless，支持排序/筛选/虚拟滚动，事件列表首选 |
| 数据请求 | **TanStack Query** | 缓存/重试/乐观更新，减少自研 |
| 框架 | **Astro + React islands** | SEO 页面静态化，只有仪表盘 hydrate，首屏最快 |

### 备选

- **Mantine**：一套完整组件库，数据/表单/图表齐全，**开发最快**；代价是包体比 shadcn 组合大。适合团队小、想少写样式时。
- **Base UI / Radix Primitives**：只要无障碍原语时用（shadcn 已内置 Radix）。
- **uPlot**：极致轻量的时序图（<50KB），图表多、要求快时替代 Recharts。
- **ECharts**：功能最全但体积大（~1MB），非必要不选。

### 明确不推荐

- 重型全功能后台模板（笨重、交互多、加载慢）。
- 花哨动画库、复杂状态机——与"数据快速呈现"目标冲突。
- 一次性引入 Element/Ant 全家桶——包体与风格都不匹配。

---

## 4. 阶段性计划（每阶段可独立测试）

> **定位见 [POSITIONING.md](./POSITIONING.md)**：Float = 加密供给侧事件的实测反应参考层。
> 阶段围绕"供给侧 + 预期 vs 实际"重排；P0–P3 为已完成/部分完成的历史阶段。

### 4.0 已完成回顾（P0–P3）

| Phase | 内容 | 状态 | 遗留（已并入下方新阶段） |
|---|---|---|---|
| P0 基础设施 | monorepo / CI / 契约先行 / 测试 | 🟡 部分 | 部署 → P5，Auth → P8，`apps/api` → P5 |
| P1 数据采集 | 7 个适配器 / 去重 / 溯源 / 幂等 | 🟡 部分 | admin 页与质量报告 → P6.6，无人值守 → P5.4 |
| P2 反应引擎 | 全指标 / 口径版本 / 流动性三态 / 抽检 | ✅ | Bybit 价格回退 → P6.4 |
| P3 前端 | 总览 / 日历 / 事件 / 代币（5 页） | 🟡 部分 | sitemap+SEO → P5.2，Lighthouse → P5.2 |

**额外完成（超出原计划，且是本产品真正的内核）**

- 事件类型基准与分位（`event_type_stats_v1` / `event_baseline_v1` / `category_stats_v1`）
- 代币分类（Jev，417 个 → 13 类）
- 宏观事件（FOMC / CPI / 非农，N=46~72）
- 解锁日历（含金额 / 占供应 / 分配对象 / vesting 类型）
- 数据质量三态（`base_after_t0`、流动性 ok/低/未知、样本量 N 透明）

---

### Phase 4 — 预期引擎（Expectation Engine）★ 核心差异化

**目标**：从"告诉你历史怎么走"升级为"**告诉你这次偏离了多少**"。

- [x] 4.1 **Deribit DVOL 隐含波动**适配器 → 宏观事件的"市场预期" ✅
  - 回填 BTC/ETH DVOL 各 41,584 点（2022-01 起，1h 分辨率）
  - 78 个宏观事件算出惊讶度
  - **发现**：FOMC 惊讶中位 **1.31×**（市场系统性低估波动）；非农 **0.74×**（系统性高估）；CPI 1.09×（定价合理）
- 4.2 **解锁归一化指标（v2）** ✅：稀释改用「占流通量 float」（缺失回退占最大供应），反应剔除 BTC 同期收益
  - 新增 `event_expectation` 表 + `scripts/compute-expectations.ts`（BTC 1m 基准 + 事前 30 天日波动 → excess / z）
  - 契约：`api.event_expectation_v1`、`api.unlock_cohort_v2`、`api.unlock_float_stats_v2`、`api.unlock_category_stats_v2`、`api.unlock_slope_v2`
  - **实测（N=1,363，float ≥ 0.5%，流动性达标）**：每 1% float 稀释 → 4h 市场调整后 **−0.046%（R²=0.006）**，与原始口径（−0.048%，R²=0.006）几乎一样
  - 分桶中位数（4h 调整后）：0.5–1% −0.05% · 1–2% −0.08% · 2–5% −0.11% · 5–10% +0.12% · ≥10% **−0.41%**（N=109，z 中位仅 −0.05σ）
  - **结论：解锁在 4h 尺度没有系统性砸盘；只有 ≥10% 的巨型稀释方向向下。斜率解释力仍低，产品价值改为「分布 + 这次偏离了多少」，不再拿 R² 当卖点**
  - **长窗口与事前漂移（1h K 线，±1h）**：解锁前 3 天中位 **−1.65%**（相对 BTC）；解锁后 3 天 −1.71%、7 天 **−2.70%**（7 天上涨占比 38.6%）
  - 分桶 7 天中位：0.5–1% −1.88% · 1–2% −2.97% · 2–5% −2.92% · 5–10% −3.51% · ≥10% **−5.23%**；前 3 天各桶 −0.8% ~ −2.3%
  - 口径：`event_expectation` 含 `pre_*` / `ret_72h` / `ret_168h` / `z_*`；1h 分辨率，窗口端点 90min 容差，缺失返回 null
  - ⚠️ **placebo 对照（T0−21d，历史不足回退 T0−14d；N=1,309）——已完成**：净 7 天中位 **+0.29%**、均值 −0.22%（**t=−0.36，不显著**）
  - 分桶净 7 天均值：≥10% −1.37%（t=−0.24，N=110）· 1–2% −1.45%（t=−1.56）· 其余桶 |t|<1；净 7 天斜率 +0.11%/1% float（R²=0.0007）
  - 净前 3 天：均值 −0.73%（t=−2.05，边缘）；即事前弱负漂移有一定信号但不足以单独下结论
  - **最终结论：现行数据下，解锁规模不预测超常收益；表观「解锁砸盘」主要是代币自身的非事件漂移。产品价值在「分布 + 对照框架」，而非方向性预测**
- 4.3 **按接收方分类（v2）** ✅：接收方表接入市场调整口径（`unlock_category_stats_v2`）
- 4.4 **上币特征化预期（v1）** ✅：上币形式 × 代币类别 × FDV 档 → 中位与 25–75 区间
  - 迁移 0016：`public.listing_form()`（标题规则，可复算）+ `api.listing_cohort_v1` / `listing_form_stats_v1` / `listing_category_stats_v1` / `listing_fdv_stats_v1` / `listing_baseline_v1`
  - 前端：`/listings` 页 + 事件详情「同类上币预期」面板；反应引擎对 listing 事件改用 96h 窗口（公告常早于开盘），24h 覆盖从 10/163 → 163/164
  - 详情页静态路径改为「最新 1000 ∪ 所有有反应的事件」，历史上币/宏观页可达
  - **实测（379 条，Binance 公告）**：现货新币（N=164）1h 中位 −4.6% · 4h −7.4% · **24h −10.2%（上涨占比仅 24%）**；Seed Tag（N=31）1h −6.5%（10% 上涨）；合约 −4.9%/−14.5%；**RWA bStock（N=36）≈ 0，是唯一不跌的形式**
  - 类别：DeFi 24h −13.3%（上涨 18%）· Meme −12.8% · L1 −9.9% · 基础设施 −7.5% · RWA/稳定币 ≈ 0
  - **结论：上币公告不是「利好」，而是系统性「公开即顶」；产品位（bStock/稳定币）例外**
  - 限制：FDV 档仅覆盖约 1/3（DefiLlama 最大供应；CoinGecko 免费档只给 365 天历史市值）；交易所层级仍退化为单一 Binance；一次公告多代币时样本相关
- 4.5 契约扩展 ✅：`api.event_expectation_v1` 已建立；DVOL 惊讶度在 `events_v1`（未单独立 `api.surprise_v1`）
- 4.6 前端 ✅：事件详情显示 DVOL 惊讶度 + 「市场调整（vs BTC）」面板；`/unlocks` 主指标改为 float 稀释 + 剔除 BTC + z

**验收**

- [x] 任一宏观事件显示隐含波动、实际波动、超预期倍数
- [x] 解锁显示归一化指标及其样本量（v2：float 稀释 + 市场调整）
- [x] 按接收方的反应差异有 N、口径版本与置信说明
- [x] 惊讶度可复算，口径写入 `methodology_version`（expectation = v2）
- [x] 4.4 上币预期区间（v1：形式 × 类别 × FDV；FDV 覆盖约 1/3）

**依赖**：无（Deribit API 免费，已实测可用）

---

### Phase 5 — 上线与分发（Distribution）

**目标**：产品公网可用 + 建立零成本分发通道。

- 5.1 **部署到 Cloudflare**（Workers + Static Assets）+ 自定义域 + `/api/health`
- 5.2 **SEO**：sitemap、结构化数据、提交 Google/Bing；Lighthouse 移动端 ≥ 90，LCP < 1.5s
- 5.3 **公开 Telegram 频道**：每日自动简报（未来 24h 事件 + 同类基准），**无需账号系统**
- 5.4 **Cron 定时任务**：解锁轮询、反应重算、简报推送（替代人工跑脚本）
- 5.5 免责声明与合规文案（全站无投资建议话术）

**验收**

- [ ] 公网可访问；Lighthouse 移动端 ≥ 90
- [ ] sitemap 已提交，主要页面被索引
- [ ] Telegram 频道每日自动推送，内容含样本量 N 与口径版本
- [ ] Cron 连续 7 天无人工干预

**依赖**：Cloudflare API Token + Account ID（用户）

---

### Phase 6 — 供给侧加深（Supply-Side Depth）

**目标**：把供给侧从"未来日历"变成"完整历史 + 结构化画像"。

- 6.1 **DefiLlama Pro** 接入（历史 vesting / emissions）+ 回填 + 重算
- 6.2 归属与接收方画像（团队 / VC / 社区 / 生态 / 金库 / 质押）
- 6.3 供给侧事件补全：增发、销毁、回购、迁移、减半
- 6.4 **Bybit 价格回退**（补齐无 Binance 交易对的标的）
- 6.5 **CoinGecko 元数据**（市值 / 流通量 / 板块）→ Phase 4.4 上币预期的输入
- 6.6 admin 页 + 每日数据质量报告

**验收**

- [ ] 解锁基准出现且 **N ≥ 50**，含按接收方分类
- [ ] 每个代币有市值 / 流通量 / 板块
- [ ] 无 Binance 交易对的事件有回退价格源
- [ ] 每日数据质量报告自动生成（新增 / 失败 / 去重 / 覆盖）

**依赖**：DefiLlama Pro 账号（用户）

---

### Phase 7 — 决策工具（Decision Tools）

**目标**：把数据变成可执行的决策辅助。

- 7.1 **仓位计算器**：用同类事件的历史分布推荐止损（10 / 25 分位）
- 7.2 合约杠杆 / 强平价计算
- 7.3 **热力图**：基准表颜色网格 + 日历密度热力图
- 7.4 **可比事件**（pgvector KNN）：找出历史上最像的事件，给分布对比
- 7.5 新闻轻量关联（CryptoPanic / RSS），仅在事件详情页

**验收**

- [ ] 给定事件与风险金额，输出建议仓位与止损位，并说明依据的样本量
- [ ] 热力图在大样本与小样本上有视觉区分
- [ ] 可比事件 5s 内返回 top-10，特征可解释
- [ ] 新闻缺失时不阻塞页面

---

### Phase 8 — 账号与留存（Accounts & Retention）

- 8.1 Supabase Auth（邮箱魔法链接）
- 8.2 Watchlist（代币 / 事件类型 / 板块）
- 8.3 个性化告警：Telegram / Discord / 邮件，T-7 / T-3 / T-1 与事件后
- 8.4 Cloudflare Queues 派发 + 去重 + 重试

**验收**

- [ ] 同一用户同一事件 24h 内不重复推送
- [ ] 事件后推送延迟 < 5 分钟
- [ ] 派发失败自动重试，最终成功率 > 99%
- [ ] 退订即时生效

---

### Phase 9 — 商业化（Monetization）

- 9.1 免费 / Pro 分层（前后端双校验）
- 9.2 Stripe 订阅 + 7 天试用
- 9.3 USDC 订阅（链上收款）
- 9.4 钱包登录（SIWE）
- 9.5 Rate limiting（Cloudflare KV）

**验收**

- [ ] 免费用户访问 Pro 功能被拦截；升级即时生效，退订到期降级
- [ ] USDC 付款后正确开通
- [ ] 钱包登录与邮箱账号可绑定
- [ ] 超限请求返回明确错误码

---

### Phase 10 — B2B 数据层（Data Layer）

- 10.1 公开 REST API + API key + 用量计量 + 限额
- 10.2 API 文档（OpenAPI 自动生成）
- 10.3 **MCP Server**（让 Claude / Cursor / Codex 直接查询）
- 10.4 数据集开放 / 方法论公开 / 哈希上链
- 10.5 R2 批量导出（CSV / Parquet）

**验收**

- [ ] 新开发者 10 分钟内完成"拿 key → 调通 → 拿到数据"
- [ ] 超限返回 429 + 用量头
- [ ] MCP 可被主流 AI 客户端接入并正确回答
- [ ] 方法论文档公开，任一统计可复现

---

### 明确不做（记录决策，避免反复讨论）

| 不做 | 原因 |
|---|---|
| **TradingView widget / Charting Library** | 服务条款：*"we do not permit commercial usage of any of our services or APIs"*（除单独协议）；widget 需保留归属且商用受限。继续用 `lightweight-charts`（Apache 2.0，无限制） |
| 交易执行 / 下单 / 跟单 | 合规风险高，且非数据产品定位 |
| 社交情绪 / KOL 叙事 | Kaito / 推特生态的地盘，不构成我们的差异化 |
| 自建解锁精选库 | CMC 已覆盖未来、DefiLlama 将覆盖历史，人工维护不划算 |

---


## 5. 成本与运维

### 早期（Phase 0–3，公开 Beta 前）

| 项 | 方案 | 月成本 |
|---|---|---|
| Cloudflare Workers | 免费档 | $0 |
| Cloudflare Static Assets | 静态不限带宽 | $0 |
| Cloudflare KV / R2 | 免费额度内 | $0 |
| Cron Triggers | 免费档 | $0 |
| Supabase | Free（仅开发期，注意 7 天不活跃会暂停） | $0 |
| 数据源 | 交易所公开 API + DefiLlama + CoinGecko 免费档 | $0 |
| 域名 | .com/.io | ~$1 |
| **合计** | | **≈ $1–5/月** |

### 上线后（有真实用户）

| 项 | 方案 | 月成本 |
|---|---|---|
| Cloudflare Workers Paid | Queues + 更高额度 | $5 |
| Supabase Pro | 8GB DB / 100k MAU / 100GB egress | $25 |
| DefiLlama Pro（解锁全量，可选） | $49/月，收入上来再上 | $0–49 |
| Tokenomist / CryptoRank API | 企业询价，MVP 不用 | $0 |
| Workers AI / LLM 摘要 | 用量小 | $0–5 |
| **合计** | | **≈ $35–85/月** |

**降本要点**
- Supabase 是唯一 DB，Cloudflare 只做计算/缓存，**绝不双写**。
- 页面优先静态化 + 边缘缓存，API 结果进 KV（TTL 视数据新鲜度）。
- 重计算（回填）在本地或一次性 Worker 跑，不常驻。
- 用 **R2** 存导出，避免 egress 费。
- 监控用 Cloudflare Analytics Engine，不额外买 APM。

**运维原则**
- 无服务器要管；全部托管。
- 告警走 Queues 重试，不靠人工盯。
- 每日数据质量报告落地到 admin，异常才需人介入。
- 一切口径变更走 `methodology_version`，可回滚。

---

## 6. 风险与 Kill 条件

| 风险 | 应对 |
|---|---|
| DefiLlama 免费化反应数据 | 壁垒放在"可比分析 + 工作流 + 可验证"，不放在原始日历 |
| CoinMarketCal/Tokenomist 快速跟进 | 抢先把"反应分布 + 样本透明"做成标准，并尽早出 API/MCP |
| 低流动性代币噪声/操纵 | 流动性硬过滤；低流动性不出分布 |
| T0 归一化工程债 | 先做高置信度事件；低置信度只标注不计算 |
| 订阅流失高 | 告警 + watchlist 建立日常习惯；免费层做 SEO 引流 |
| 监管 | 全程"数据/教育"定位，无建议无预测；发币延后且谨慎 |
| 幸存者偏差 | 保留退市/dead token 数据，标注覆盖范围 |

**Kill 条件（90 天）**
- 免费日历 + 推特号无法在 90 天内带来自然付费意愿 → 停止 To C，转 B2B 数据层。
- DefiLlama / CoinMarketCal 在 1 个季度内把"反应分布"做成免费功能 → 停止或转型。

---

## 附录 A：目录结构建议

```
crypto-event-engine/
├─ apps/
│  ├─ web/                 # Astro + React islands
│  │  ├─ src/pages/        # calendar / event / token / pricing
│  │  ├─ src/components/   # charts, tables, cards
│  │  └─ src/lib/          # supabase client, api client
│  └─ api/                 # Hono on Workers
│     ├─ src/routes/
│     ├─ src/jobs/         # ingest, compute, dispatch
│     └─ wrangler.toml
├─ packages/
│  └─ shared/              # zod schemas, types, methodology
├─ supabase/
│  └─ migrations/
├─ scripts/                # 回填、一次性任务
└─ PLAN.md
```

## 附录 B：环境变量清单

```
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # 仅 Workers 服务端

# 数据源（按优先级）
BINANCE_BASE_URL=https://api.binance.com
BYBIT_BASE_URL=https://api.bybit.com
OKX_BASE_URL=https://www.okx.com          # 备用，部分网络不可达
COINGECKO_API_KEY=                        # Demo 免费 key
COINMARKETCAL_API_KEY=                    # Free 档
CRYPTOPANIC_API_KEY=
FRED_API_KEY=
# 付费源（MVP 不启用）
DEFILLAMA_PRO_KEY=
TOKENOMIST_API_KEY=

# 支付
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
USDC_RECEIVE_ADDRESS=

# 告警
TELEGRAM_BOT_TOKEN=
DISCORD_WEBHOOK_URL=

# 其他
CF_ACCOUNT_ID=
CF_ANALYTICS_TOKEN=
```

---

*文档版本 v1.0 · 口径版本 methodology v1*
