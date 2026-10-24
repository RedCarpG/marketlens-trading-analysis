# MarketLens 本地代理

托管 `web/` 下的页面（只允许 html/css/js），并转发 eToro 只读行情。只监听本机，只调用 market-data 接口，不接入下单或账户接口。

## 启动

1. 项目根目录复制 `.env.example` 为 `.env`，填写 eToro 的 `ETORO_API_KEY`、`ETORO_USER_KEY`（只读权限即可，不需要任何写权限）。
2. 在 `server\` 下执行一次 `npm install`，之后 `npm start`。
3. 浏览器打开 http://127.0.0.1:8787/ ，左侧选“黄金 GOLD · eToro”。

不填密钥也能启动：模拟、CSV、Binance 照常可用，eToro 接口返回 503。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /api/etoro/candles?symbol=&interval=&count=` | 标准化K线数组（旧到新），`interval` 为 15m/1h/4h/1d/1w/1M，`count` 1–1000，默认 500 |
| `WS /api/etoro/stream?symbol=&interval=` | 推送标准化单根K线，同一 timestamp 为更新当前K线；附带 `qt`（最后一笔报价的时间，毫秒），页面用来判断交易中 / 休市 |
| `GET /api/etoro/trades?symbol=&days=` | 我的已平仓交易（近 `days` 天，1–364，默认 364）；给了 symbol 只返回该品种 |
| `GET /api/etoro/positions?symbol=` | 我的当前持仓（含浮动盈亏、止损止盈）；给了 symbol 只返回该品种 |
| `GET /api/store` | 本地K线存储概况：每个品种/周期已存根数与起止时间 |
| `GET /api/health` | 是否已配置行情密钥（keys）、交易密钥（trade）、实时报价口径 |

所有 `/api/` 请求只接受以 `127.0.0.1:端口` / `localhost:端口` 访问，带其他来源的 Origin 一律拒绝（防止其他网站通过 DNS 重绑定读取数据）。

## 个人交易记录（只读）

- 使用单独的只读密钥 `ETORO_TRADE_API_KEY` / `ETORO_TRADE_USER_KEY`（不需要任何写权限）；与行情密钥分开（品种→instrumentId 的解析用行情密钥，交易密钥只调用下面两个交易接口）。
- 已平仓：`GET /api/v1/trading/info/trade/history?minDate=&page=&pageSize=100`，接口规定单次回看不超过 1 年，代理按页取（最多 20 页）并缓存 60 秒。
- 持仓：`GET /api/v1/trading/info/real/pnl` 的 `clientPortfolio.positions`（比 `/portfolio` 多了 `unrealizedPnL`），缓存 15 秒。只含手动持仓，不含跟单（mirrors）。
- eToro 部分时间字段不带时区，按 UTC 解析。

## 与 eToro 接口的对应（2026-10-22 按 api-portal.etoro.com 核对）

- 品种：`/api/v2/market-data/instruments?symbols=GOLD` 按 symbol 精确解析为 instrumentId 并缓存（GOLD = 18，"Gold (Non Expiry)"）；也可在 `.env` 用 `ETORO_SYMBOL_MAP=GOLD=18` 直接指定。v1 的 search 是前缀匹配且分页，GOLD 会被 GOLD.24-7 和各期货合约挤出第一页，所以不用。
- K线：`/api/v1/market-data/instruments/{id}/history/candles/desc/{interval}/1000`。只能取最近 1000 根，没有起止时间参数。
- **月线**：eToro 不提供。近期月份由日线聚合（1000 根日线约 4 年）；更早的月份由周线按周起始日归月，跨月的那一周会有偏差。
- 实时：连接 `wss://ws.etoro.com/ws`，先 `Authenticate`（密钥在 WSS 消息里发给 eToro），再订阅 `instrument:<id>`，用报价推进当前K线；多个页面共用一条上游连接，最多每 300ms 推送一次。文档称该频道无需鉴权，实测未鉴权会返回 `SessionNotAuthenticated`。上游约每秒一条报价，偶尔发送非 JSON 帧（`\u0000`），已忽略。
- 限速：文档写每分钟 60–120 次（市场数据接口共享额度）。代理按周期缓存 20 秒到 10 分钟，一次页面加载约 7 次上游请求。

## 真实联调记录

真实密钥的联调结果记在本地笔记 `docs/private/LOCAL_NOTES.md`（不入 Git）。要点已体现在上面的接口说明里：报价口径为 Bid、CFD 成交量为 0、实时需先鉴权。

## 待定

- `GOLD` 是跟踪黄金的 CFD，不是 GC 期货（同一时刻比 Micro Gold Dec26 期货低约 14 美元）。eToro 也有 Micro Gold 期货（如 `GOLD.DEC26`，ID 207010，乘数 10，有真实成交量），价格与 GC 相同，但每个合约只有上市以来的历史（Dec26 只有约 223 根日线、45 根周线），做多周期需要跨合约拼接连续合约。

## 本地K线存储

eToro 每次只返回最近 1000 根且不能往前翻页，所以代理把每次拉到的K线按时间合并存到 `var/candles/<instrumentId>/<interval>.json`（`var/` 不入 Git，可用 `ETORO_STORE_DIR` 改位置）。同一时间点以最新数据为准；写入先写临时文件再改名。`/api/etoro/candles` 返回合并后的完整序列（单次最多 5000 根），历史随使用时间增长。代理启动 1 分钟后及之后每 6 小时，把已存过的品种/周期再拉一遍，避免长时间不开页面时 15m（1000 根约 10 天）断档。
