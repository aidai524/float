# 数据层设计（Data Layer）

> 目标：**先接免费数据源；以后新增数据源时，只动数据层，前后端代码零改动。**
> 本文是 `PLAN.md` 的补充，聚焦"数据如何进来、如何归一、如何被消费、如何扩展"。

---

## 1. 一条不可破的规则

> **前后端只允许读 `api.*` 契约视图 / 版本化 REST 响应；永远不直接读原始表、不感知任何数据源。**

只要守住这条，后面：
- 换供应商
- 加一个免费源
- 同一个事件多源交叉验证
- 加新的字段

都只发生在**数据层内部**，读侧形状不变。

```
        ┌──────────── 数据层（可随意演化）─────────────┐
外部源 → adapters → raw → normalize → resolve → canonical → compute
                                                              │
        └─────────────────────────────────────────────────────┘
                                                              ▼
                              api.* 契约视图（形状冻结，只增不改）
                                                              │
                                            前后端 / Worker / API 只读这里
```

---

## 2. 分层架构

| 层 | 名称 | 表 / 产物 | 职责 | 变化频率 |
|---|---|---|---|---|
| L0 | **Raw 落地** | `raw_payloads` | 原样存外部响应，只增不改，可回放 | 高 |
| L1 | **归一化** | `source_records` | 把各源字段映射成统一形态 | 高 |
| L2 | **实体解析 / 去重** | `events` + `event_provenance` | 跨源合并成唯一"黄金记录" | 中 |
| L3 | **计算** | `event_reactions` / `event_features` | 反应测量、特征向量 | 中 |
| L4 | **契约** | `api.*` 视图 + 版本化 REST | **读侧唯一入口，形状冻结** | 极低 |

**关键点**：L0 的存在让"接错源"可以随时回放重算，不用重新调用外部 API。这是低成本迭代的前提。

---

## 3. 分层数据模型

### 3.1 L0 — Raw 落地（append-only）

```sql
create table raw_payloads (
  id           bigserial primary key,
  source_id    text not null,
  entity       text not null,          -- 'kline' | 'event' | 'token' | 'news'
  fetched_at   timestamptz not null default now(),
  request      jsonb,                  -- 请求参数，便于回放
  payload      jsonb not null,         -- 原始响应
  payload_hash text not null,          -- 幂等
  unique (source_id, entity, payload_hash)
);
```

- **只增不改**；保留 30–90 天后归档到 R2（省钱）。
- 失败请求也落一条 `payload = {error}`，便于排障。

### 3.2 L1 — 归一化记录

```sql
create table source_records (
  id            bigserial primary key,
  source_id     text not null references data_sources(id),
  raw_id        bigint references raw_payloads(id),
  record_type   text not null,             -- 'event' | 'kline' | 'token'
  ext_id        text,                      -- 源自身的 id
  event_type    text,                      -- 统一事件类型
  token_symbol  text,
  chain         text,
  t0            timestamptz,
  t0_confidence text check (t0_confidence in ('high','medium','low')),
  magnitude_usd numeric,
  magnitude_pct numeric,
  source_url    text,
  detail        jsonb not null default '{}',
  dedupe_key    text not null,             -- 源内幂等
  ingested_at   timestamptz default now(),
  unique (source_id, record_type, dedupe_key)
);
```

- **一个源一张影子记录**。同一事件来自 3 个源就有 3 条 `source_records`。
- `detail` 存源特有字段，**不污染公共字段**。

### 3.3 L2 — 黄金记录 + 溯源

```sql
create table events (
  id             bigserial primary key,
  event_type     text not null,
  token_id       bigint references tokens(id),
  token_symbol   text not null,
  t0             timestamptz not null,
  t0_confidence  text not null,
  magnitude_usd  numeric,
  magnitude_pct  numeric,
  title          text,
  detail         jsonb not null default '{}',
  primary_source text not null,            -- 字段合并时胜出的源
  source_count   int  not null default 1,  -- 有几个源印证
  confidence     numeric not null default 0.6,
  dedupe_key     text not null unique,     -- 跨源黄金 key
  first_seen_at  timestamptz default now(),
  updated_at     timestamptz default now()
);

-- 多对多溯源：一个事件由哪些源记录合成
create table event_provenance (
  event_id   bigint references events(id) on delete cascade,
  record_id  bigint references source_records(id) on delete cascade,
  source_id  text not null,
  is_primary boolean default false,
  primary key (event_id, record_id)
);
```

- **跨源去重键** `dedupe_key = normalize(event_type, token, t0_bucket, magnitude_bucket)`。
- **字段级合并**：按 `data_sources.priority` 高到低取第一个非空值；`source_count` 越多 `confidence` 越高。
- 读侧只看 `events`，完全不关心它来自几个源。

### 3.4 L3 — 计算（沿用 `PLAN.md`）
`event_reactions`、`event_features`。它们只依赖 `events`，与来源无关。

### 3.5 L4 — 契约视图（读侧唯一入口）

```sql
create schema if not exists api;

create view api.events_v1 as
select
  e.id,
  e.event_type,
  e.token_symbol,
  e.t0,
  e.t0_confidence,
  e.magnitude_usd,
  e.magnitude_pct,
  e.title,
  coalesce(e.detail->>'category','unknown') as category,
  e.confidence,
  e.source_count,
  r.ret_5m, r.ret_15m, r.ret_1h, r.ret_4h, r.ret_24h,
  r.vol_1h, r.vol_ratio, r.max_drawdown, r.max_favorable,
  r.price_source, r.methodology_version
from events e
left join event_reactions r
  on r.event_id = e.id and r.methodology_version = current_setting('app.methodology', true);
```

**契约规则（写进 CI）**：
1. 视图**只能加列，不能删列/改类型/改语义**。
2. 破坏性变更 → 新建 `events_v2`，`v1` 保留 N 个版本周期。
3. 新源的独有字段一律进 `detail` / 新增列，不改已有列。
4. 有"契约测试"跑在 CI，形状一变就红。

---

## 4. 扩展机制：加数据源只改数据层

### 4.1 三种扩展成本

| 级别 | 场景 | 需要改什么 | 动前后端？ |
|---|---|---|---|
| **A. 纯配置** | 常见 REST/JSON 源 | 只插一条 `data_sources` 行（含字段映射） | ❌ |
| **B. 新适配器** | 特殊鉴权/分页/格式 | 加一个 `sources/xxx.ts` + 注册 | ❌ |
| **C. 新流水线阶段** | 全新数据类型 | 加一个 pipeline stage | ❌ |

三种情况**都不碰 `apps/web` 和 `apps/api`**。

### 4.2 适配器接口

见 `packages/data-layer/src/types.ts`：

```ts
interface DataSourceAdapter {
  id: string;
  type: SourceType;
  fetch(ctx: FetchContext): Promise<RawPayload[]>;
  normalize(raw: RawPayload): NormalizedRecord[];
}
```

### 4.3 配置驱动的通用适配器（Tier A）

`generic-rest.ts` 读 `data_sources.config`，用 JSON 路径映射把任意 REST 响应映射到统一字段：

```json
{
  "base_url": "https://api.example.com/v1",
  "auth": { "type": "header", "name": "x-api-key", "env": "EXAMPLE_API_KEY" },
  "list_path": "$.data.items",
  "pagination": { "type": "page", "param": "page", "size_param": "limit", "size": 100 },
  "map": {
    "ext_id": "$.id",
    "event_type": { "const": "listing_cex" },
    "token_symbol": "$.coin.symbol",
    "t0": "$.date_event",
    "t0_confidence": { "const": "high" },
    "source_url": "$.proof"
  },
  "dedupe": ["event_type", "token_symbol", "t0"]
}
```

→ **接入一个标准 REST 事件源，零代码。**

### 4.4 注册与解析

`registry.ts` 维护 `id → adapter`。`pipeline.ts` 启动时：
1. 从 `data_sources` 读 `enabled = true` 的源。
2. 按 `priority` 与 `fallback` 组成优先级链。
3. 逐源：配额检查 → fetch → 写 `raw_payloads` → normalize → upsert `source_records`。
4. 写 `ingest_runs` 观测记录。

---

## 5. 降级、配额与可观测

| 能力 | 实现 |
|---|---|
| 主源失败降级 | `data_sources.fallback = ['bybit','okx']`，按序尝试 |
| 配额守卫 | 每源一个 KV 计数器，接近 `dailyQuota` 自动降频 + 告警 |
| 重试 | 失败入 Cloudflare Queues，指数退避 |
| 幂等 | `raw_payloads.payload_hash`、`source_records.dedupe_key`、`events.dedupe_key` |
| 可观测 | `ingest_runs`（成功/失败/耗时）+ 每日数据质量报告 |
| 回放 | 从 `raw_payloads` 重跑 normalize / resolve，不重调外部 API |

---

## 6. 新增数据源的 Playbook

无论 A/B/C，读侧都不用动。标准步骤：

1. **插注册行**：`insert into data_sources ... `（`seed/data_sources.sql`）
2. **接适配器**：
   - Tier A：只填 `config`（含 `map`）。
   - Tier B：在 `packages/data-layer/src/sources/` 加文件 + `register()`。
3. **跑回填**：`scripts/backfill.ts --source xxx`（写 L0→L1→L2）。
4. **验收**：`select * from api.events_v1 where ...` 能查到；`ingest_runs` 正常。
5. **CI 契约测试**：确认 `api.*` 视图列未变。

> 全程 **不修改** `apps/web`、`apps/api`。

---

## 7. 首批免费源接入顺序

| 顺序 | 源 | 类型 | 接入方式 | 说明 |
|---|---|---|---|---|
| 1 | Binance | price | Tier B（`binance.ts`） | K 线，免 key，主源 |
| 2 | Bybit | price | Tier A（generic-rest） | 回退源 |
| 3 | CoinGecko | token | Tier A | 元数据，Demo key |
| 4 | CoinMarketCal | listing/unlock | Tier A | Free 档，`x-api-key` |
| 5 | CryptoPanic | news | Tier A | 免费 token |
| 6 | FRED | macro | Tier A | 免费 key |
| 7 | 自建解锁精选库 | unlock | Tier B（CSV/JSON 导入） | top 200–300 代币 |

后 4 个全部是 Tier A 纯配置——正好验证"加源不动代码"。

---

## 8. 目录结构

```
packages/data-layer/
├─ src/
│  ├─ types.ts            # 接口与类型
│  ├─ registry.ts         # 适配器注册表
│  ├─ pipeline.ts         # fetch → raw → normalize
│  ├─ resolve.ts          # 跨源去重 → events + provenance
│  ├─ quota.ts            # KV 配额守卫
│  └─ sources/
│     ├─ binance.ts       # Tier B 示例
│     └─ generic-rest.ts  # Tier A 通用适配器
supabase/
├─ migrations/
│  ├─ 0001_data_sources.sql
│  ├─ 0002_raw_and_records.sql
│  ├─ 0003_canonical.sql
│  └─ 0004_contract_views.sql
└─ seed/
   └─ data_sources.sql
```

---

## 9. 与 `PLAN.md` 的对应

- 本文细化 `PLAN.md` §2.3 Schema、§2.4 数据管道、§2.6 数据源对接。
- `PLAN.md` 的 Phase 1 落地时，以本文的 L0–L4 为准。
- `PLAN.md` 的 §1.5 口径（T0、反应计算、流动性过滤）在 L3 生效，并写 `methodology_version`。

---

*数据层设计 v1.0*
