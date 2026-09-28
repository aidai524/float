-- ============================================================
-- seed/data_sources.sql
-- 首批免费源（按接入顺序）。Tier B 源（binance / curated-unlocks）也先占位。
-- 新增源 = 往这里加一行（Tier A 无需改代码）。
-- ============================================================

insert into data_sources (id, type, auth, cost_tier, priority, rate_limit, refresh, fallback, config) values
-- 1) Binance —— 主价格源（Tier B 适配器）
('binance', 'price', 'none', 'free', 10,
 '{"rpm": 1200, "dailyQuota": 1000000}', '15m', '{}',
 '{"base_url":"https://api.binance.com","kline_interval":"1m"}'),

-- 2) Bybit —— 价格回退源（Tier A 通用适配器）
('bybit', 'price', 'none', 'free', 20,
 '{"rpm": 600, "dailyQuota": 500000}', '15m', '{}',
 '{"base_url":"https://api.bybit.com","kind":"kline","path":"/v5/market/kline",
   "map":{"symbol":"$.result.list[*]","interval":"1"}}'),

-- 3) CoinGecko —— 代币元数据（Tier A）
('coingecko', 'token', 'query', 'free', 30,
 '{"rpm": 30, "dailyQuota": 10000}', '6h', '{}',
 '{"base_url":"https://api.coingecko.com/api/v3","auth":{"type":"query","name":"x_cg_demo_api_key","env":"COINGECKO_API_KEY"},
   "kind":"token_meta","path":"/coins/markets","list_path":"$",
   "map":{"symbol":"$.symbol","name":"$.name","coingecko_id":"$.id","market_cap":"$.market_cap","adv_30d":"$.total_volume"}}'),

-- 4) CoinMarketCal —— 上币 / 解锁事件（Tier A，Free 档）
('coinmarketcal', 'listing', 'header', 'free', 40,
 '{"rpm": 60, "dailyQuota": 5000}', '1h', '{}',
 '{"base_url":"https://api.coinmarketcal.com","auth":{"type":"header","name":"x-api-key","env":"COINMARKETCAL_API_KEY"},
   "kind":"event","path":"/v1/events","list_path":"$.body",
   "pagination":{"type":"page","param":"page","size_param":"max","size":100},
   "map":{"ext_id":"$.id","token_symbol":"$.coins[0].symbol","t0":"$.date_event",
          "source_url":"$.proof","title":"$.title",
          "event_type":{"from_category":true},"t0_confidence":{"const":"high"}},
   "dedupe":["event_type","token_symbol","t0"]}'),

-- 5) CryptoPanic —— 新闻/情绪（Tier A）
('cryptopanic', 'news', 'query', 'free', 50,
 '{"rpm": 30, "dailyQuota": 2000}', '15m', '{}',
 '{"base_url":"https://cryptopanic.com/api/v1","auth":{"type":"query","name":"auth_token","env":"CRYPTOPANIC_API_KEY"},
   "kind":"news","path":"/posts/","list_path":"$.results",
   "map":{"ext_id":"$.id","title":"$.title","t0":"$.published_at","source_url":"$.url"}}'),

-- 6) FRED —— 宏观日历（Tier A）
('fred', 'macro', 'query', 'free', 60,
 '{"rpm": 120, "dailyQuota": 10000}', '1d', '{}',
 '{"base_url":"https://api.stlouisfed.org/fred","auth":{"type":"query","name":"api_key","env":"FRED_API_KEY"},
   "kind":"macro","path":"/series","map":{"ext_id":"$.seriess[0].id","title":"$.seriess[0].title"}}'),

-- 7) 自建解锁精选库 —— Tier B（CSV/JSON 导入）
('curated-unlocks', 'unlock', 'none', 'free', 5,
 '{"rpm": 0, "dailyQuota": 0}', '1d', '{}',
 '{"base_url":"file://packages/data-layer/data/unlocks","kind":"unlock_import"}')

on conflict (id) do nothing;
