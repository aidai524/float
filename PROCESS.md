# 开发流程（PROCESS）

> 与 [PLAN.md](./PLAN.md)、[DATA-LAYER.md](./DATA-LAYER.md) 配套。

## 一句话

**规格 → 契约冻结 → 并行实现 → 自动验证 → 人工验收。**

## 1. 主循环

```
PLAN.md（总纲）
  └─ 每个 Phase 一份 Spec（输入/输出/验收）
       └─ 拆成 Issue（每个可独立测试，带验收标准）
            └─ 契约先行：冻结 packages/shared + api.* 视图列   ← 并行的前提
                 └─ 各角色在独立 git worktree 并行实现
                      └─ CI 质量门（唯一裁判）
                           └─ 人工验收（Phase 边界 / 破坏性变更）
```

## 2. 契约先行（Contract-first）

并行开发能否成立，取决于契约是否先冻结：

- `packages/shared` 的 zod schema = 读侧契约
- `supabase/migrations/0004_contract_views.sql` 的 `api.*` 列 = 读侧契约
- `packages/shared/tests/contracts.test.ts` 在 CI 中比对两者，任何一侧改了列形状即失败
- 契约规则：**只增列**，不删列 / 不改类型 / 不改语义；破坏性变更新建 `_v2`

## 3. CI 质量门

每次 PR 必跑（见 `.github/workflows/ci.yml`）：

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`（单元测试 + 契约测试）

后续补充：migration dry-run、Preview 部署 smoke test、前端 Lighthouse 阈值。

## 4. 数据变更协议（数据产品专属）

- migration 必须**可逆**
- 口径变更 → `methodology_version` +1 + changelog + 重算 runbook
- 回填脚本必须**可断点续跑**（幂等）
- CI **禁止**直连生产库

## 5. 多角色并行（herdr + pi）

每个角色一个 **git worktree** + 独立 agent，避免同文件冲突。

| 角色 | 模型 | 可改动范围 |
|---|---|---|
| 架构 / 编排 | deepseek-v4-pro + 人 | 契约、`main` |
| 数据层工程师 | deepseek-flash | `packages/data-layer/` |
| 后端 / Worker | deepseek-flash | `apps/api/` |
| 前端 | deepseek-flash | `apps/web/` |
| QA / 契约测试 | deepseek-flash | `tests/` |
| 数据质量 | Jev + deepseek-flash | 抽检脚本、质量报告 |
| 代码评审 | deepseek-v4-pro | 只读 |

### 并行能成立的约束

1. 契约先冻结
2. 一人一 worktree
3. 目录所有权明确
4. 契约单一真源（agent 只能读，改要 RFC）
5. CI 是唯一裁判，不接受自评
6. 测试文件命名带角色后缀，避免冲突

> 建议：先串行跑通 Phase 0–1，再从 Phase 2（任务边界最清晰）开始并行。

## 6. Jev（System One）使用规范

Jev **不是**编程模型，它返回类型化判断 + 概率，不生成文本。定位是"判断原语"。

| 用途 | 原语 | 落点 |
|---|---|---|
| 事件类型分类 | `Choice` | L1 normalize |
| 跨源实体解析 | `Noul` | L2 resolve |
| 字段/日期抽取 | `Choice` | L1 |
| 可比事件重排 | `Score` | L3 / Phase 4 |
| Impact Score 维度打分 | `Score`（composite scoring） | Phase 4 |
| 新闻相关性过滤 | `Noul` | Phase 1 |
| 结果验证 | `Noul` | QA |
| 置信度分级 | 概率阈值 | 全局 |

规则：

- 代码控制流程，Jev 只提供语义判断；**数字永远来自代码/数据，不来自模型**
- 用 `gate()` 做置信度分级：高置信自动接受、中间转人工、低置信拒绝
- 概率 ≠ 置信度：Noul 用 `probabilityToConfidence()` 转换
- 一次请求并行提多个问题（更便宜更快）
- 密钥只在服务端使用，绝不进前端

## 7. 人工决策门（agent 不能拍板）

- 契约变更
- 破坏性 migration
- 生产部署
- 发币 / 合规相关
- Phase 验收

## 8. 环境自动化

| 能力 | 脚本 | 说明 |
|---|---|---|
| 手机通知 | `scripts/notify.sh` | Bark；有进展或需决策时调用 |
| 保持清醒 + 压暗屏幕 | `scripts/devsession.sh` | caffeinate + DisplayServices；空闲 10 分钟恢复 |
| 真实数据源 dry-run | `pnpm ingest:dryrun` | 内存假 DB，验证采集路径 |

## 9. 当前进度

| Phase | 内容 | 状态 |
|---|---|---|
| 0 | 项目基线 + 契约冻结 | ✅ 完成 |
| 0.5 | Jev 判断模块 | ✅ 完成（分类 0.98 / 去重 0.96 实测） |
| 1 | 数据采集与统一事件库 | 🚧 进行中 |
| 2 | 反应计算引擎 | ⏳ |
| 3 | MVP 前端 | ⏳ |
