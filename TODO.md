# TODO / 待办

> 已完成项见 README「当前状态」，本文件只记录**未做**的事，含原因与前置条件。

---

## 当前冲刺：让产品第一次能回答一个问题

**问题**：页面只能"查单个历史事件的反应"，且 75% 没有数据、规模列 100% 为空、一半事件类型是 `unknown`。
**根因**：造了"测量"，没造"对照"。信号 = 事件 × 历史基准 × 样本量，后两者都没有。

- [x] **S1 · 回填历史事件**：2000 条 Binance 公告 → 457 个事件（原 51）
- [x] **S2 · 批量计算反应**：359 / 457（78% 覆盖）；回填模式不落 K 线
- [x] **S3 · 事件类型基准层**：`api.event_type_stats_v1`（N / 中位数 / 上涨占比）
- [x] **S4 · 事件挂到基准上**：`api.event_baseline_v1` 百分位，详情页显示"同类历史 X 分位"
- [x] **S5 · 总览改前瞻优先**：未来 7 天 + 倒计时 + "接下来会发生什么"

### 关键发现（第一次有信号）

```
Binance 现货上币 · crypto（N=323）
  5m 中位 -0.44%   1h 中位 -4.12%   4h 中位 -6.54%   24h 中位 -9.88%
  4h 上涨占比 29%

Binance 上币 · RWA（N=25）
  1h 中位 +0.21%   24h 中位 -1.84%   （明显比 crypto 温和）
```

> 反直觉：**上币历史上是跌的**，不是拉盘。

### 本轮修的方法论问题
- **锚点**：上币公告常早于开盘（如 DAI 公告 11:04、开盘 14:00），改为从**首个成交时刻**起算
- **合并**：listing 事件按"日"去重（同一代币同一天的多次公告 = 同一事件）
- **抽取**：支持多代币公告（一条公告含 3 个代币 → 3 个事件）与中文代币名
- **排除**：合约上线 / 股票交易 / 保证金 / 代币化证券抵押 等噪音

### 遗留体验问题
- [x] 总览去掉装饰性的 BTC 标注图，换成基准面板
- [x] 事件详情显示同类分位
- [ ] `unknown` 事件（41 条）在"接下来会发生什么"里仍占多数，需优先展示 listing/unlock
- [ ] 无数据时隐藏「规模」列

---

## Backlog（明确暂缓，做完当前冲刺再排）

### B1 · 真实解锁事件接入
**为什么暂缓**：需要先做数据源决策（要花钱或要人工）。
**现状**：CoinMarketCal 免费档对 vesting 覆盖很弱——实测 2 条 "unlock" 还是 Jev 对质押激励的误判。
**选项**：
- 自建 top 200–300 代币精选库（免费，人工维护）
- DefiLlama Pro（$49/月）
- Tokenomist API（询价）

**接入时前端零改动**：`magnitude_usd` / `magnitude_pct` 已在契约里并已渲染。

### B2 · Bybit 价格回退
**为什么暂缓**：只影响 3 条事件（AVGO / BTW 等 Binance 无交易对）。
**做法**：`reactions` 加价格源优先级链（Binance → Bybit → OKX）。

### B3 · 事件后 24h 反应的定期重算
**现状**：21 条足够老的事件里 18 条已有 24h 反应，基本不是问题。
**做法**：加定时任务（Cloudflare Cron）定期重跑 `pnpm reactions`，而不是人工跑。

### B4 · CoinGecko 代币元数据接入
**为什么暂缓**：本机网络对 `api.coingecko.com` TLS 被重置，本地跑不通。
**备注**：Cloudflare Workers 上不受影响；key 已存。
**用途**：Phase 3/4 的代币市值/板块筛选、可比事件分组。

### B5 · 部署上线
**为什么暂缓**：产品完整后再对外。
**前置**：Cloudflare API Token + Account ID；`apps/web` 已可静态构建（71 页）。
**备注**：也已向用户确认——不着急。

---

## 已解决的坑（记录避免重踩）

- Colima 本机网络无法拉 Docker 镜像（DNS + TLS 中断）→ 改用云端 Supabase + pooler
- Supabase 直连是 IPv6，本机不通 → 一律用 `SUPABASE_DB_POOLER_URL`
- PostgREST 默认只暴露 `public` schema → 需暴露 `api` 并授权 `service_role`
- PostgREST `max_rows` 默认 1000，读 K 线会被截断 → 提到 10000
- pnpm 12 拦截构建脚本 → `pnpm-workspace.yaml` 的 `allowBuilds`
- Amphetamine AppleScript 会卡在 macOS 自动化权限 → 改用 `caffeinate`
- 本机 CLT 的 MacOSX27 SDK 与 clang 不匹配 → 亮度工具用 MacOSX15.4 SDK 编译
