# MarketLens 本地代理

托管 `web/` 下的页面（只允许 html/css/js），转发 eToro 只读行情，并拉取经济日历、BLS 官方数据与新闻。只监听本机，只调用 market-data 接口，不接入下单或账户接口。

## 启动

1. 项目根目录复制 `.env.example` 为 `.env`，填写 eToro 的 `ETORO_API_KEY`、`ETORO_USER_KEY`（只读权限即可，不需要任何写权限）。
2. 在 `server\` 下执行一次 `npm install`，之后 `npm start`。
3. 浏览器打开 http://127.0.0.1:8787/ ，左侧选“黄金 GOLD · eToro”。

不填密钥也能启动：模拟、CSV、Binance、经济日历与新闻照常可用，eToro 接口返回 503。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /api/etoro/candles?symbol=&interval=&count=` | 标准化K线数组（旧到新），`interval` 为 15m/1h/4h/1d/1w/1M，`count` 1–1000，默认 500 |
| `WS /api/etoro/stream?symbol=&interval=` | 推送标准化单根K线，同一 timestamp 为更新当前K线；附带 `qt`（最后一笔报价的时间，毫秒），页面用来判断交易中 / 休市 |
| `GET /api/etoro/trades?symbol=&days=` | 我的已平仓交易（近 `days` 天，1–364，默认 364）；给了 symbol 只返回该品种 |
| `GET /api/etoro/positions?symbol=` | 我的当前持仓（含浮动盈亏、止损止盈）；给了 symbol 只返回该品种 |
| `GET /api/events/calendar` | 经济日历与 BLS 最新官方数据，见下文“经济日历与新闻” |
| `GET /api/events/news?topic=&lang=` | 新闻，`topic` 为 gold / btc / macro，`lang` 为 zh / en |
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

## 经济日历与新闻（server/events.js）

全部是公开来源，不需要密钥；代理在服务器端拉取并缓存，页面只能选预设的主题和语言，代理不会去访问页面传来的任意地址。标题等外部文字只当作数据：去掉标签后返回，页面转义后显示。

| 来源 | 地址 | 内容 | 缓存 |
|---|---|---|---|
| Forex Factory 本周日历 | `nfs.faireconomy.media/ff_calendar_thisweek.json` | 各国本周事件：时间（带时区偏移）、影响等级、预期值、前值。第三方整理，只覆盖本周 | 1 小时（该站限速，失败后 10 分钟再试） |
| BLS 发布日程 | `www.bls.gov/schedule/news_release/bls.ics` | 非农（Employment Situation）、CPI、PPI、JOLTS、就业成本指数的官方发布时间，覆盖未来几个月；时间为美东时间 | 12 小时 |
| FOMC 日程 | 内置于 `events.js` 的 `FOMC` | 2026 年按美联储日历，2027 年为美联储 2025-09-05 公布的暂定日程，至 2028-01；声明为第二天美东 14:00。过期后页面提示需要补充 | — |
| BLS 公共 API | `api.bls.gov/publicAPI/v1`（填 `BLS_API_KEY` 用 v2） | 非农就业总人数（算月变化）、失业率、平均时薪、CPI / 核心 CPI（月率用季调、年率用未季调） | 12 小时；非农、CPI 公布后 1 小时内每 10 分钟查一次；存 `var/events/bls.json`，重启不重复查询（未注册每天 25 次） |
| 新闻 | Google 新闻 RSS 搜索（近 2 天，按主题和语言）、美联储新闻稿 `www.federalreserve.gov/feeds/press_all.xml`、`.env` 的 `NEWS_FEEDS` | 标题、链接、来源、时间；按标题去重，最多 60 条 | 每个 RSS 5 分钟 |

- 合并：Forex Factory 的条目作为主条目（有预期值）；BLS / 美联储日程与它同一次发布（同一组、美东同一天）时只标“已核对官方日程”，时间不一致时附上官方时间；Forex Factory 还没有的（下周以后）单独列出。
- 存储：拉到的日历按 id 合并存到 `var/events/calendar.json`（`EVENTS_DIR` 可改位置），同一来源同一时间段的旧条目被新数据替换（改期、取消的随之去掉）；保留最近 400 天，过去的事件随使用时间积累，页面在K线上标出。
- 返回：最近 8 天及以后的全部事件，更早的只返回高影响事件；每个来源的最后成功时间和错误（`sources`），页面据此显示覆盖情况。
- 时区：美国的发布时间按美东时间换算成 UTC（夏令时由 Node 的 Intl 处理），测试覆盖了美欧夏令时错开的那几周。
- **未经真实环境联调**：开发环境的网络不允许访问这些站点，解析按各来源公开的格式编写并用样例测试（`tests/events.test.js`）。第一次在本机运行时，看页面“事件”页顶部的来源状态；某个来源报错（如 BLS 返回 403）时，按 `.env.example` 设置 `EVENTS_UA`。

## 本地K线存储

eToro 每次只返回最近 1000 根且不能往前翻页，所以代理把每次拉到的K线按时间合并存到 `var/candles/<instrumentId>/<interval>.json`（`var/` 不入 Git，可用 `ETORO_STORE_DIR` 改位置）。同一时间点以最新数据为准；写入先写临时文件再改名。`/api/etoro/candles` 返回合并后的完整序列（单次最多 5000 根），历史随使用时间增长。代理启动 1 分钟后及之后每 6 小时，把已存过的品种/周期再拉一遍，避免长时间不开页面时 15m（1000 根约 10 天）断档。
