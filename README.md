# Crypto Event Study Engine

加密事件研究引擎：不只是告诉你事件几点发生，而是告诉你这类事件历史上发生后，价格在 5m / 15m / 1h / 4h 实际怎么走、样本多大、可比事件是谁。

> 基于历史市场数据，非 AI 生成。每个统计都带样本量 N 与口径版本 `methodology_version`。

## 文档

- **[PLAN.md](./PLAN.md)** — 完整需求与阶段性计划（Phase 0–8、验收标准、成本）
- **[DATA-LAYER.md](./DATA-LAYER.md)** — 数据层设计（L0–L4 分层、适配器、契约视图、扩展机制）

## 技术栈

- **计算/托管**：Cloudflare Workers + Static Assets、Cron Triggers、KV、R2、Queues
- **数据/认证**：Supabase（Postgres + pgvector + Auth + RLS）
- **前端**：Astro + React islands + Tailwind + shadcn/ui + Tremor + Lightweight Charts
- **数据层**：可插拔适配器，读侧只依赖 `api.*` 契约视图
- **判断模型**：TypeSafe / Jev（System One，返回类型化判断 + 概率）

## 环境要求

- Node.js >= 22
- pnpm 12（`corepack enable pnpm`）
- macOS（仅开发会话守护与亮度控制需要）

## 快速开始

```bash
pnpm install
cp .env.example .env          # 填入密钥（TypeSafe、Bark 等）

# 可选：编译亮度工具（devsession 用）
./tools/build-brightness.sh
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm test` | 单元测试 + 契约测试 |
| `pnpm lint` | ESLint |
| `pnpm format` / `format:check` | Prettier |
| `scripts/devsession.sh start\|stop\|status` | 保持电脑清醒 + 屏幕压暗 |
| `scripts/notify.sh "标题" "正文"` | Bark 手机通知 |

### 开发会话守护

```bash
scripts/devsession.sh start
```

进程活跃时用 `caffeinate` 保持电脑不休眠，并把屏幕亮度压到最低；空闲 10 分钟后自动恢复亮度、允许休眠。活跃判定基于 `$PI_SESSION_FILE` 的修改时间。

## 目录结构

```
apps/           # web / api（后续）
packages/
  shared/       # 读侧契约（zod schema）+ 契约测试
  data-layer/   # 适配器、采集流水线、实体解析
supabase/
  migrations/   # 0001 源注册 / 0002 raw+L1 / 0003 黄金记录 / 0004 契约视图
  seed/         # 首批免费数据源
scripts/        # notify、devsession
tools/          # brightness（C）
.github/        # CI
```

## 不可破的规则

1. **前后端只读 `api.*` 契约视图**，永不直接读基础表、永不感知数据源。
2. **契约只增列**，不删列 / 不改类型 / 不改语义；破坏性变更新建 `_v2`。
3. **加数据源只改数据层**，不碰 `apps/web`、`apps/api`。
4. 口径变更必须 `methodology_version` +1 + 变更说明。

契约由 CI 保障：`packages/shared/tests/contracts.test.ts` 解析 SQL 视图列并与 zod schema 比对，不一致即失败。

## 当前状态

- [x] Phase 0：项目基线 + 契约冻结
- [ ] Phase 1：数据采集与统一事件库（解锁 + 上币）
- [ ] Phase 2：反应计算引擎
- [ ] Phase 3：MVP 前端（日历 + 事件详情）
