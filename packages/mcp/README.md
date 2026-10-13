# float-mcp

Float 的 MCP（Model Context Protocol）Server —— 让 Claude Desktop / Cursor / Codex 等
AI 客户端直接查询**加密事件（解锁 / 上币 / 宏观）的实测反应数据**：

- 事件反应：5m / 15m / 1h / 4h / 24h 收益、波动、量比、回撤
- 同类基准：按事件类型 / float 稀释分桶 / 接收方类别的分布（带样本量 N）
- 预期 vs 实际：DVOL 惊讶度、剔除 BTC 的市场调整、placebo 净效应
- 日历：未来 N 天的解锁 / 上币 / 宏观事件

数据源：<https://float.aidai524.workers.dev>（只读公开 API，边缘缓存 5 分钟）。

## 安装 / 使用

无需安装，直接在 MCP 客户端配置：

```json
{
  "mcpServers": {
    "float": {
      "command": "npx",
      "args": ["-y", "float-mcp"]
    }
  }
}
```

本地开发也可以直接跑仓库里的文件：

```json
{
  "mcpServers": {
    "float": {
      "command": "node",
      "args": ["/绝对路径/float/packages/mcp/bin/float-mcp.mjs"]
    }
  }
}
```

## 工具

| 工具 | 说明 |
|---|---|
| `search_events` | 搜索事件（`event_type` / `symbol` / `from` / `to` / `has_reaction`） |
| `get_event` | 单事件详情：反应 + 同类分位 + 溯源 |
| `get_calendar` | 未来 N 天解锁 / 上币 / 宏观 |
| `get_event_type_stats` | 按事件类型的历史基准（中位 / 上涨占比 / N） |
| `get_unlock_stats` | 解锁 v2：float 分桶 / 接收方 / 净效应斜率 |
| `get_listing_stats` | 上币：形式 / 类别 / FDV 档 |

示例提问：

> 未来一周有哪些大额解锁？历史上这类解锁后价格怎么走？
> Binance 最近上了哪些币？24 小时反应中位数是多少？

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `FLOAT_API_BASE` | `https://float.aidai524.workers.dev` | 指向其他部署（自建/预览） |
| `HTTPS_PROXY` / `HTTP_PROXY` | — | 检测到时代理自动生效（依赖内置 undici） |

## 免责声明

基于历史市场数据，非 AI 生成，**非投资建议**。所有统计都带样本量与口径版本。
