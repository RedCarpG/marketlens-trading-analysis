# MarketLens 工作续接

（2026-10-24 由 FinBot 更名为 MarketLens；本地目录同日改为 X:\Project\MarketLens，浏览器本地偏好键前缀改为 marketlens. 并自动迁移旧的 finbot.*）

更新：2026-11-26；状态：规格v0.4；当前阶段：eToro GOLD 数据源、交易记录、复盘、经济日历与新闻、Cirra 播报与常驻预警均已接入；之后的方向和顺序见 docs/ROADMAP.md。密钥配置、真实联调记录、个人交易记录与复盘结果只保存在本地 docs/private/LOCAL_NOTES.md（不入 Git）。

目标：个人行情观察与分析工具，以黄金期货GC为主，KLineChart图表，规则评分与参考计划，后续加预警与回测；只读行情，不下单。分析方法为自上而下多周期：1M/1w定背景→1d结构→4h区域→1h/15m触发（SPEC 3.5节）；页面已实现1w/1M、analyzeMTF与周期状态矩阵初版（仅模拟数据验证，权重未回测）。

已完成：前端第一版及多周期初版（2026-10-24 拆分为 web/ 目录并加 node:test 测试，见 SPEC 第10节）；SPEC更新为v0.4（以《FinBot-项目说明》为准），v0.3归档。server\ Node.js代理：托管页面、/api/etoro/candles（15m–1M，月线由日线/周线合成）、/api/etoro/stream（订阅instrument:<id>报价推进当前K线）、按周期缓存、只监听127.0.0.1、只托管白名单文件、WS校验来源。eToro接口已对照api-portal.etoro.com核实（见SPEC 3.2、server/README.md）。用模拟上游测过全部周期、实时推送、共享订阅、来源校验与无密钥503。

联调（2026-10-22）：eToro 行情六个周期与实时推送已用真实密钥验证，修复了实时需先鉴权、品种改用 v2 精确查询两处问题；具体结果见本地笔记。

成交量为0已处理（2026-10-22）：无成交量时放量项不计分、VOL移除并禁用、面板注明（SPEC 3.3）。

界面调整（2026-10-22）：默认绿涨红跌+护眼主题（可切深色护眼/浅色/深色）、默认周期1d，自选列表分组折叠（模拟默认收起），经代理打开时默认选eToro GOLD；偏好存localStorage。

分析模块（2026-10-22）：图上画多周期合并的支撑阻力线、重要信号箭头、参考计划线（可分别开关），面板显示关键价位，计划改用合并价位（SPEC 3.3.1）。用GOLD全部周期验证，未回测。随后：价位按最新价选取（修正大跌日支撑全在现价上方）、各周期前高/前低（矩阵+图）、多次挡回画成区间、失效计划不画线。

界面与情景（2026-10-22）：整页一屏三栏各自滚动、矩阵/左栏/顶栏菜单可收起、加副图不压缩主图、点击信号高亮；计划线移除，改为纯K线价格行为情景（SPEC 3.3.2/3.3.3）。

交易记录（2026-10-22）：用户选择API方式。代理新增 /api/etoro/trades 与 /api/etoro/positions（单独的只读交易密钥 ETORO_TRADE_API_KEY/ETORO_TRADE_USER_KEY），页面在图上标开平仓与持仓、面板显示统计（SPEC 3.3.4）。API请求加Host/Origin校验。已用真实交易密钥验证。

交易复盘与K线存储（2026-10-24）：代理把每次拉到的eToro K线合并存到 var/candles（历史随使用增长，每6小时后台补拉）；“我的交易”块新增“复盘”面板，逐笔重算开仓时的大周期、入场位置、止损、情景并汇总（SPEC 3.2、3.3.7）。复盘结果只记在本地笔记。

界面改版（2026-10-24）：设计变量（颜色/圆角/阴影/动效）重写 app.css；顶栏周期改分段滑块、指标菜单分主图/副图、实时开关带呼吸点、设置菜单分外观/数据；图表标题行显示最新价与涨跌，右侧“选中项”提示（点文字重新定位，✕/Esc 取消）；右侧分“分析 / 交易 / 预警”标签页（徽标：持仓笔数、未读预警），块可一键全收/全展；下拉、折叠、标签页、提示、复盘面板均有过渡动画；面板刷新改为只更新变化节点（web/js/ui.js 的 morph + 事件委托），不再闪烁或吞点击（SPEC 3.3.8）。已在浏览器验证四种主题、窄屏与各项交互。选中交易时自动平移并缩放到交易约占主图宽度35%（K线14px封顶、长交易最多占60%），相近时长的交易之间不重复缩放（SPEC 3.3.3）。修复开关布林带时主图“跳一下”：主图价格轴只按K线计算，MA/EMA/BOLL 改为页面自绘，不再影响缩放（SPEC 3.3.5）。

整页布局（2026-10-24）：K线铺满窗口作为背景；顶栏半透明浮在上方，左栏自选并入顶栏品种下拉，周期矩阵改为顶栏下拉；分析/交易/预警面板移到左侧（压在旧K线上，价格轴和最新K线不被挡），可收成图标条（[）或进入专注模式（F）；面板透明度可选通透/适中/不透明；指标图例改为页面自绘以避开顶栏和面板；高亮定位、悬停卡按可见区域避让；窄屏恢复上下排列（SPEC 3.3.9）。已在浏览器验证宽屏（护眼/深色）、收起、专注、快捷键、矩阵下拉和手机宽度。同日按用户要求调整：分析面板回到右侧，展开时价格轴（含副图）左移到面板左边、最新K线随之让开，K线画布仍延伸到半透明面板下；自选移到左侧半透明面板，可收成竖窄条；快捷键 [ 开合自选、] 开合面板（SPEC 3.3.9）。副图开合加高度滑动动画（SPEC 3.3.8）。关键价位、情景可点击高亮并定位（价位缩放到上次触及与最新K线同屏，不标K线）；选中定位改为略偏右（52%）；无成交量时移除 VOL 不再播放动画（SPEC 3.3.3）。高亮闪烁、副图联动（竖条 + 指标触发点）、点击光晕与回弹、新增赛博朋克主题（SPEC 3.3.8）。修复滑动时指标比K线晚一帧：价格轴固定 70px 宽；标注晚一帧：高亮闪烁改为定位结束后开始。最新K线右侧加竖虚线分界、右侧区域淡色底。标注字体加大（13px）。新图标（放大镜 + K线，docs/icon.svg），用作标签页图标和顶栏标志。顶栏加行情状态标签（实时 · 交易中 / 休市 / 非实时），代理推送附带报价时间 qt（需重启代理，已重启）；选中定位改到 62%。

公开与 GitHub Pages（2026-10-24）：仓库改为公开，历史重建为一个干净的提交；密钥配置、真实联调记录、个人交易记录与复盘结果移到本地 docs/private/LOCAL_NOTES.md（已 gitignore）；Pages 发布 web/，用模拟K线、模拟交易和 Binance 公开行情。同日改为全新的公开仓库 https://github.com/RedCarpG/marketlens-trading-analysis（Pages：https://redcarpg.github.io/marketlens-trading-analysis/），本地 origin 指向它；旧仓库 web-trading-MarketLens 不再使用，由用户自行删除。

首次使用默认（2026-10-24）：深色主题、图上不画价格行为情景；README 本地运行改为不提具体数据服务商。

回测设计（2026-10-24）：见 docs/BACKTEST.md（草案，未实现）。逐根回放、只用当时已收盘K线、复用页面同一套规则；检验信号、评分、价格行为情景（按 R 模拟成交），附置信区间与样本内外拆分。现有数据只有 1d（约 3.2 年可回测）样本够用。

回测第一阶段（2026-10-24）：已实现 1d 引擎、命令行 `npm run backtest`、测试（不偷看未来、成交规则、随机游走空白对照）。GOLD 1d 首次结果：信号与评分暂无可靠优势；情景约不赚不亏，顺大周期 +0.36R 但与“牛市做多”无法区分；情景触发过于频繁（65% 的天数）。详见 docs/BACKTEST.md 第 12 节。

回测数据扩充（2026-10-25）：`npm run import` 导入 Yahoo GC=F 日线（2000 起，含 2011–2015 熊市）和 Binance BTCUSDT（2017 起，分页）到 var/history/；回测加 `--data`、`--from/--to`，报告加“方向 × 顺逆大周期”表。结论：顺大周期的优势是牛市做多（黄金熊市里多·顺 −0.34R、近十年多·逆 +0.43R）；情景整体约 0R（黄金 25 年 +0.01R、比特币 −0.02R）；评分秩相关约 0。详见 docs/BACKTEST.md 第 13 节。

情景收紧（2026-10-25）：情景加收紧选项 `SC_DEF`（去掉强阳收回、只在大周期价位、同一价位冷却 10 根），回测加成本预设 `--cost gold|btc` 与 `--sc`，新增 `npm run bt:compare`（5 组规则 × gc / btc / eToro 并行对比）。收紧后触发少 6–8 倍，但平均 R 没有变好（各组毛R ±0.07 内，黄金计入成本后全部显著为负）。页面默认改为全部收紧，只为减少噪音和成本；本周期价位的卡片标“只作参考”。详见 docs/BACKTEST.md 第 14 节。

出场、大周期、数据源、回测面板（2026-10-25）：
- 出场规则（第 15 节）：不设目标、2 ATR 移动止损或持有 10 根，在四份数据上比页面目标每笔多 0.1–0.5R（黄金熊市里做空一侧受益），但情景整体仍无可靠优势；页面已触发的情景多显示移动止损价。
- 大周期方向（第 16 节）：摆动结构、快均线都不比均线好（黄金熊市里更差），默认不变，方法可选（`BIAS_DEF`）。
- 数据源可切换：代理统一为 `/api/sources`、`/api/candles?src=`、`/api/stream?src=`，新增 Yahoo（免费、期货延迟约 10 分钟）和本地长周期历史；设置 → 数据源按品种切换；真实交易跟着品种走。
- 页面回测面板（第 17 节）：情景标题“回测”按钮 / 快捷键 B，后台线程回放当前数据，可切换规则、出场、大周期方法和成本，点明细在图上查看。

经济日历与新闻（2026-10-25）：按用户要求加入获取时事的能力。代理新增 server/events.js 与 /api/events/calendar、/api/events/news：Forex Factory 本周日历（预期 / 前值）与 BLS 发布日程、内置 FOMC 日程（至 2028-01）核对合并；BLS 公共 API 给出非农、失业率、时薪、CPI 最新值；新闻为 Google 新闻 RSS（主题 × 中文 / EN）+ 美联储新闻稿，可在 .env 的 NEWS_FEEDS 追加。全部免费、无需密钥，日历存 var/events。页面新增“事件”页（来源状态、下一个重要事件倒计时、官方数据、经济日历、新闻）、分析页评分卡的事件提示、图上“经济事件”标注与悬停、预警“重要经济事件”（公布前 30 / 5 分钟，BLS 公布新数时）。不经代理打开时写“未覆盖”。事件不参与评分与情景。开发环境网络访问不到这些站点，未经真实联调：解析按公开格式写、用样例测试（tests/events.test.js），页面用模拟上游在浏览器里检查过；第一次本机运行时看“事件”页顶部的来源状态，BLS 403 时设 EVENTS_UA。详见 SPEC 3.3.10、server/README.md。

交易页金额币种（2026-10-25）：可选美元 / 欧元 / 人民币；eToro 交易账户金额为美元、接口不提供换币种，代理新增 `/api/fx`（eToro EURUSD / USDCNH 日线，取不到用 Yahoo）；已平仓按平仓日汇率、持仓按当前汇率，交易页、图上标注、悬停、复盘、预警都标币种。

代理常驻预警（2026-11-02）：server/watch.js 在页面关着时看价位和情景并交给 Cirra，判定与页面共用 core/alertrules.js；转发带 source=market 和 kind；止损止盈仍只在页面。见 docs/CIRRA.md §9。

桌宠 Cirra 播报第①步（2026-11-01）：用户的桌宠 Cirra（cirra-deskpet）能把消息说出来，按 docs/CIRRA.md 的计划接入。代理新增 server/cirra.js 与 /api/cirra/status、POST /api/cirra/notify（唯一收 POST 的地址，限本机页面的 JSON），读 ~/.cirra/endpoint.json 转给她的 /notify；她没开时静默跳过，token 换了重读，每分钟最多 8 条，表情按类型定。页面 alFire 多一个出口（web/js/cirra.js），每类预警另写一句口语化的短句；预警页加“Cirra 播报”块（总开关默认开；经济事件、止损止盈默认播，价位、情景默认不播；试一下；她在不在）。Cirra 那边不改代码。测试 tests/cirra.test.js；另用 cirra-deskpet 自己的事件端口代码当真 Cirra 联调通过，浏览器检查过；她真正开口要本机验证。详见 SPEC 3.3.11。下一步：第②步代理自己播报经济日历与早报。

第②步（2026-11-03）：代理自己播报经济日历（server/announce.js，页面关着也说）：公布前 30 / 5 分钟、BLS 新数、每天 07:00 后早报；CIRRA_EVENTS / CIRRA_CCY / CIRRA_BRIEFING；开着时页面不再转经济事件。测试 tests/announce.test.js，实跑联调通过。

AI 分析第①步（2026-11-03）：计划见 docs/AI.md（回测为什么没找到优势、AI 能做和不能做的、接入方式）。用户确认：默认交给 Cirra 的 AI，暂不做直接调 API。已做分析包（web/js/core/aipack.js）与分析页“AI 分析”块（复制分析包、查看，web/js/ai.js），粘贴到 claude.ai 等使用；测试 tests/aipack.test.js，浏览器检查过。第②步（2026-11-03）：“让 Cirra 分析”——cirra-deskpet 新分支 marketlens/ask（从 DEV 起，worktree）加了事件端口 POST /ask（market/ask.ts：用她聊天的模型问一次、不带工具、套“数据不是指令”的说明、她念结论；模块关着 403、一次一份 429、4 分钟 504），全部 1506 个测试、typecheck、lint 通过；MarketLens 这边 POST /api/ai/analyze（每天 AI_DAILY 次、15 分钟缓存）和分析页按钮、结果显示。同时发现 Cirra DEV 已有 MarketLens 模块（她自己看日历），所以本仓库的日历播报改为默认关、每条转发带 source: market 和 kind。真模型回答和她开口要本机验收。

AI 分析第④步（2026-11-03）：留痕与前瞻打分。“让 Cirra 分析”成功后代理记到 var/ai/log.jsonl（品种、来源、周期、价格、ATR、解析出的倾向、结论、全文）；页面按之后第 5 / 20 根已收盘K线按方向计 ATR 打分并汇总，不到 30 次写“还不够判断”。测试 tests/aiscore.test.js。

路线图与第 0 步收尾（2026-11-26）：写了 docs/ROADMAP.md（定位、作为 Cirra 一部分的做法、方向、顺序）。第 0 步：
- 真机核对：经济日历与新闻的五个来源都取到；页面显示 Cirra 在线，“试一下”发出并被收下，但 Cirra 里“MarketLens 行情”插件当时没开，所以她没说（插件没开时她照样回成功，这边看不出来）；常驻预警用 eToro GOLD 1h 跑了一轮，真正碰到价位的那次还没等到。
- 代理开机自启：tools/autostart.ps1（启动文件夹里一个快捷方式，后台运行，输出写 var/proxy.log），已在本机装上；端口被占用时代理给一句说明后退出。
- 文档：DATA_VALIDATION.md 移到 archive；SPEC 第 5 节指向 ROADMAP；server/README.md 去掉“未经真实联调”和作废的 notifyLabel。
- 远端分支 ccr-bd0a1e8b-mxsb48 在第①步之后和本地分叉：它有代理播日历（已取消）和 AI 分析（docs/AI.md、分析包、让 Cirra 分析、留痕打分），没有常驻预警；本地相反。main 提交的是本地这条线；AI 分析同一天晚些时候合进来了（见下一段）。它依赖的 Cirra 接口 `POST /ask`（cirra-deskpet 分支 marketlens/ask）现在的 Cirra 里没有。

合 AI 分析线（2026-11-26，路线图第 0.5 步）：把分支 ccr-bd0a1e8b-mxsb48 合进 main。留下的：分析包（core/aipack.js）、分析页“AI 分析”块（复制分析包、查看）、代理的 /api/ai/analyze 和 /api/ai/log、留痕与打分（server/ailog.js、core/aiscore.js）。没合的：代理播日历（server/announce.js 和它的测试、CIRRA_EVENTS / CIRRA_CCY / CIRRA_BRIEFING）。改的：“让 Cirra 分析”默认收起，.env 写 CIRRA_ASK=1 才显示（Cirra 主线没有 /ask；她对任何 GET 都回 405，探测不出来，所以用开关）；转给 Cirra 的 source: market 统一在 server/cirra.js 里加；测试里起的代理关掉常驻预警。测试 66 项通过，浏览器里看过分析页和预警页。上面“桌宠 Cirra 播报第①步”之后的三段（代理播日历、AI 分析第①②步、第④步）是分支上 2026-11-03 的原始记录，其中代理播日历没有合进来。

核心库第一段（2026-11-26，路线图第 1 步）：新增 core/（marketlens-core 0.1.0）。源码还是 web/js/core/ 那一份；core/load.js 是不用构建的加载器（从 tests/load-core.js 搬过来，代理和命令行工具改用它，server/ 不再引用 tests/），core/build.js 拼成 dist/index.mjs 和 index.cjs，npm run pack:core 打成 tgz。新加 web/js/core/summary.js：analyzeCandles（从K线直接得到分析）和 describeState（四句只有事实的话 + 结构化的 facts，不带评分、结论、情景）。测试 tests/summary.test.js、tests/corepkg.test.js（包和源码逐字段一致），共 76 项通过；用真实 GOLD K线和一个空项目试过打出来的包。（当时 tgz 只在本机；同一天晚些时候提交、推送并发了 Release，见下文。）设计见 SPEC 第 11 节、core/README.md。同日删掉了远端旧分支 ccr-bd0a1e8b-mxsb48（内容已全在 main）。

Cirra 插件 1.1.0（2026-11-26，路线图第 2 步，在 X:\Project\Cirra\cirra-plugins 的分支 feature/marketlens-core，工作区 X:\Project\Cirra\wt-marketlens-core）：装 marketlens-core，新工具 market_levels、早上多一句位置（通知种类「早上的行情位置」）、事迹（BLS 新数据、日线大波动）、每日小结「行情提醒」；不写品种时先 eToro GOLD、没配密钥用 Yahoo GC=F。插件测试 39 项、类型检查通过，编好的插件连本机代理试过。还没做完的：本仓库的提交还没推送，Release 没发（这个会话里推送被权限检查拦下），所以插件的依赖暂时指着本机的 tgz，分支没有合进 DEV。

第 2 步收尾（2026-11-26，同一天晚些时候）：main 已推送；发了 Release `core-v0.1.0`（挂 marketlens-core-0.1.0.tgz，下载下来的哈希和本机的、和插件 lockfile 里的一致）；插件的依赖换成 Release 地址，合进了 cirra-plugins 的本地 DEV（7bff8d5，合并后的提交上插件测试 39 项、类型检查通过，dist 里已是 1.1.0），临时工作区和功能分支删了。cirra-plugins 没有推送（归它的管理会话）。

守则、开仓体检、交易日记（2026-11-26，路线图第 3 步的 A1、A2、A4）：新增 web/js/core/rules.js（七条可勾选的守则 + 自己写的文字、逐条体检、新开仓时说的话、复盘统计）、web/js/journal.js（交易页的守则对话框、每笔持仓的体检一行、每笔交易的日记、每分钟看一次持仓并在新开仓时弹一条）、server/journal.js 和 /api/journal（存在本机 var/journal.json）；core/review.js 加了走到过哪（最深浮亏 / 最高浮盈）、星期、时段；复盘面板加守则表、两张分组表、三列明细；预警页和 Cirra 播报各多一项“开仓体检”（给 Cirra 的默认关，类型 ck / cko）。守则默认一条都不勾。测试 tests/rules.test.js、tests/journal.test.js，共 91 项通过；浏览器里用模拟品种走了一遍，测试时写的 var/journal.json 已删。路线图 §6 剩下的两件事用户定了按推荐。详见 SPEC 3.3.13。

第 3 步后半（2026-11-26，A3、A5）：core/review.js 加 whatIf（同一批真实入场换三种出场，用回测的 btSim，按 R 比实际），core/rules.js 加 weekly（最近几周一周一行，带“这一周最该记住的”）；复盘面板多两张表。测试 tests/whatif.test.js，共 96 项通过；浏览器里用模拟品种看过。第 3 步的改动都还没提交。

第 3 步已提交并推送（4cae25f，2026-11-27）。

第 4 步（2026-11-27）：marketlens-core 0.2.0 加取数入口 marketlens-core/data（core/build.js 把 server/yahoo.js、server/events.js 原样复制进包，core/data.d.ts 是类型；createYahoo 的请求函数、createEvents 的提示函数可以换掉）。代理的常驻预警 server/watch.js 改成默认不开（CIRRA_WATCH=gold 再打开）。Cirra 插件 1.2.0（cirra-plugins）：sources.ts（先问代理、连不上自己取）、levelwatch.ts（自己每 5 分钟看黄金 1 小时图的价位）、页面转来的同类不说两遍、设置里两项、联网权限多了几个公开来源。本仓库测试 98 项、插件测试 51 项通过；停掉代理和开着代理各实际跑了一遍编好的插件。

第 4 步收尾（2026-11-27）：main 已推送；发了 Release core-v0.2.0（下载下来的哈希和插件 lockfile 里的一致）；插件依赖换成 Release 地址，合进 cirra-plugins 的本地 DEV（c728f1c，合并后的提交上插件测试 51 项、类型检查通过，dist 里已是 1.2.0），临时工作区和功能分支删了。cirra-plugins 没有推送（归它的管理会话）。注意：代理的常驻预警已经默认不开，Cirra 里的插件更新并打开之前没有人盯价位。

第 5 步第一批（2026-11-27，云端会话，分支 claude/busy-tesla-2iwogl，开了到 main 的 PR，没有自己合）：路线图的 B4、B2、C1、C3 四项，都不依赖本机数据。新增 web/js/core/context.js（波动状态 volState / volText；交易时段 SESS / sessOf / sessBands / sessStats，core/review.js 的时段分组改用这一份）和 web/js/core/alertlog.js（我画的线 normLines / addLine / lineCheck / lineText；预警记录 normLog / logAdd；价位类预警之后怎样了 lvOutcome / outcomeText / outcomeStats），都加进了 core/files.js 的 FILES 和 web/index.html，对外接口 API 和包版本没动。页面：分析页“关键数值”里多一句波动状态、最下面多一块“交易时段”；“标注”菜单多一项“交易时段”（默认关，只在 15 分钟、1 小时周期画）；预警页多一个勾选项“我画的线”、一块“我画的线”（输入价格或在图上点），“最近预警”换成存在浏览器本地的“预警记录”（按类型筛、清空、价位类的补一句之后怎样了）。本地存储多两个键：marketlens.mylines、marketlens.allog。改到的界面文件：alerts.js、panel.js、marks.js、app.css，另有 app.js 一行（标注菜单里“交易时段”的说明）。测试 tests/context.test.js、tests/alertlog.test.js，共 110 项通过；无头浏览器里用模拟品种把四项走了一遍，深色、浅色、窄屏都看过。没验证的：真实行情下的样子、Cirra 真的开口、系统通知。细节见 SPEC 3.3.14。过程中看到两处原来就有的问题，没有顺手改，写在 PR 说明里：浅色主题下图上一部分价位标签成了实心色块（标签底色用 `#fff` 拼透明度得到无效颜色）；窄屏下页面可以横向滚动（收起的顶栏下拉菜单撑宽了页面）。

界面整理（2026-11-27，云端会话，分支 claude/ui-declutter，叠在上面那个 PR 的分支上，等它合并后再对 main 开 PR）：用户定的范围是只修毛病、减拥挤，不换风格。做了：右侧价位标签写短并放进最新K线右边的空白（RGAP 80 → 164，窄屏 96），不再盖住最新的K线；信号箭头的字压到一起时只留新的；浅色主题标签成色块的问题修了（cssv 把三位十六进制补成六位）；窄屏不再能横向滚动（下拉菜单贴着顶栏展开）；预警页重排成 总开关 → 我画的线 → 预警记录 → 提醒哪几类（默认收着）→ Cirra 播报；各处的说明收成一行小字、点开才展开；弹出提示从窗口右下角挪到K线区域左下角。改到的文件：marks.js、panel.js、app.css，另有 app.js 一行（RGAP）。纯计算没动，测试仍是 110 项；五个主题和窄屏都看过。细节见 SPEC 3.3.15。

下一步：验收这个 PR 并合进 main，再验收界面整理那条分支；用户在 Cirra 里更新并打开插件、验收（第 2、4 步）；在交易页定自己的守则，用真实交易看复盘面板（第 3 步）；然后是第 5 步剩下的 B1（事件研究）、D1（关键价位统计），要用本机 var/ 里的历史K线。见 docs/ROADMAP.md §5。情景入场条件仍无优势，不再细调；GC数据（eToro Micro Gold期货拼接连续合约或另找GC源）以后再议。

已定（2026-10-22）：先用eToro GOLD（黄金CFD），GC期货数据源以后再议。
待定：Binance适配器是否需要验证；v0.3中未写入项目说明的内容（手动ChatGPT分析包、SQLite留痕）是否还要。（经济日历与新闻的真实联调已于 2026-11-26 通过；DATA_VALIDATION.md 已归档。）GitHub：当前仓库 https://github.com/RedCarpG/marketlens-trading-analysis（公开；2026-10-24 由 web-trading-MarketLens-app 改名；命名：全小写连字符，品牌名 + 用途；main），.env、server/node_modules、work/ 均未上传。

环境：Node v24.22.1（2026-11-26 核对；此前为 v18.14.0）、Python 3.10.1、Git 2.35.1、Docker 26.0.0。

文件：docs/SPEC.md当前规格；docs/ROADMAP.md路线图；docs/archive/SPEC-v0.1~v0.3.md历史；server/（index.js、etoro.js、README.md）；.env.example；docs/OPEN_SOURCE_REVIEW.md早期选型（图表推荐已被KLineChart取代）；work/references/TradingAgents研究副本。
