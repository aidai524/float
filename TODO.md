# TODO / 待办

> 定位见 [POSITIONING.md](./POSITIONING.md)，阶段计划见 [PLAN.md](./PLAN.md) §4。
> 本文只记**未做**的事 + 已归档的决策。**阶段内的事不再重复列在这里。**

---

## 一、需要用户侧动作的事

| # | 事项 | 为什么需要你 | 阻塞了什么 |
|---|---|---|---|
| U1 | **Cloudflare API Token + Account ID** | 需要你的账号才能部署 | Phase 5 全部（上线、SEO、Cron） |
| U2 | **DefiLlama Pro 账号** | 解锁历史（免费源无历史） | Phase 6.1–6.2、解锁基准 |
| — | ~~FRED API key~~ | ✅ 已提供 | — |

**U2 开通前必确认**：外部报道称 **Pro = $49/月、API = $250/月**，而实测报错指向 *"paid **API plan**"*。
**付款前先确认 unlocks/emissions 接口属于哪一档**——价差 5 倍。
备选：Tokenomist API（询价）、CryptoRank API。

---

## 二、计划外零散事项（不进阶段，但别忘了）

- [ ] **解锁每日轮询**：CMC 只给未来约 24h，需定时累积（将并入 Phase 5.4 Cron）
- [ ] **Polymarket / Kalshi 可达性验证**：本机 TLS 被阻，需在 Cloudflare Workers 上验证
- [ ] **Deribit 限流策略**：期权接口请求量大，需缓存 + 配额守卫（Phase 4.1 内处理）
- [ ] **合规文案审查**：全站无投资建议话术；Telegram 频道同样适用
- [ ] **CoinGecko 接入**：本机网络不通，需在 Workers 上跑（Phase 6.5）

---

## 三、明确不做（已决策，避免反复讨论）

| 不做 | 原因 |
|---|---|
| **TradingView widget / Charting Library** | 服务条款：*"we do not permit commercial usage of any of our services or APIs"*（除单独协议）。继续用 `lightweight-charts`（Apache 2.0，完全自由） |
| 交易执行 / 下单 / 跟单 | 合规风险，且非数据产品定位 |
| 社交情绪 / KOL 叙事 | Kaito 的地盘，非我们的差异化 |
| 自建解锁精选库 | CMC 覆盖未来 + DefiLlama 将覆盖历史，人工维护不划算 |
| 为"规模列"做隐藏逻辑 | 规模列现在**有意义**（解锁有金额/占供应），listing 显示"—"可接受 |

---

## 四、已归档（做完的，留作记录）

<details>
<summary>点击展开</summary>

**当前冲刺（S1–S5）—— 全部完成**

- [x] S1 回填历史事件：2000 条 Binance 公告 → 457 个事件
- [x] S2 批量计算反应：359/457（78%）
- [x] S3 事件类型基准层：`api.event_type_stats_v1`
- [x] S4 事件挂到基准上：`api.event_baseline_v1` 百分位
- [x] S5 总览改前瞻优先

**体验问题**

- [x] 总览去掉装饰性 BTC 标注图，换成基准面板
- [x] 事件详情显示同类分位
- [x] Jev 批量分类：417 个代币全部有 category + asset_class；事件仅剩 9 条 unknown
- [x] 按代币类别的基准：`api.category_stats_v1` + 前端面板
- [x] 「接下来 14 天」按信号强度排序、挂基准、样本不足时提示

**Backlog 中已完成**

- [x] B1 解锁接入（部分）：CMC 免费接口 → 99 条即将解锁，含金额/占供应/分配对象/vesting 类型
- [x] B7 宏观事件：FRED(CPI/NFP) + 美联储官网日历(FOMC) → 204 个事件，188 条反应
- [x] 事件类型枚举 14 → 23
- [x] 命名与定位：**Float**

</details>

---

## 五、已解决的坑（避免重踩）

- **Supabase pooler 5432 挂过** → 切到 **6543（transaction 模式）**
- Supabase 直连是 IPv6，本机不通 → 一律用 `SUPABASE_DB_POOLER_URL`
- PostgREST 默认只暴露 `public` schema → 需暴露 `api` 并授权 `service_role`
- PostgREST `max_rows` 默认 1000，读 K 线会被截断 → 提到 10000
- pnpm 12 拦截构建脚本 → `pnpm-workspace.yaml` 的 `allowBuilds`
- Amphetamine AppleScript 会卡在 macOS 自动化权限 → 改用 `caffeinate`
- 本机 CLT 的 MacOSX27 SDK 与 clang 不匹配 → 亮度工具用 MacOSX15.4 SDK 编译
- **FRED release 101 "FOMC Press Release" 是每日流水**（365/年），不是会议日历 → 改用美联储官网
- **Binance catalog 48 是大杂烩**（合约/股票/保证金/抵押），真上币只占 30% → 需排除规则
- **上币公告常早于开盘**（DAI 公告 11:04 / 开盘 14:00）→ 反应从"首个成交时刻"起算
- **本机网络阻断了** defillama.com / api.coingecko.com / Polymarket（TLS 重置或连接关闭）→ 本地开发不可用，Cloudflare Workers 上应可访问
