# 开源选型记录

初次核查：2026-10-20；需求适配更新：2026-10-22。范围：文档、许可证、部分源码静态检查；不代表已完成安全审计或运行验证。

最新决定：首版手动导出摘要给ChatGPT，无AI API。Lightweight Charts仍为图表首选；TradingAgents保留研究参考，不安装为首版依赖；OpenBB继续后置。复用成熟图表与数值组件，不要求把整个AI交易框架变成项目基础。

| 项目 | 已核实 | 本项目决策 |
|---|---|---|
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | Apache-2.0；Python>=3.11；默认股票/公司数据；支持多种模型接口和本地服务器 | 已浅克隆到work/references/TradingAgents用于研究；参考分析角色和模型适配，不直接用默认股票流程分析黄金 |
| [Lightweight Charts](https://github.com/tradingview/lightweight-charts) | Apache-2.0；交互金融图表；README要求NOTICE署名与TradingView链接 | 推荐后续作为前端依赖；不等于行情API，尚未安装 |
| [OpenBB ODP](https://github.com/openbq-org/OpenBB) | 原OpenBB-finance/OpenBB网页跳转到此仓库；README声明Apache-2.0并定位为数据整合平台 | 后续数据源增加后再评估；不假定免费数据或本地UI均包含，尚未拉取 |

TradingAgents锁定研究快照：e8f5503e9b86d5c2710b0c76b1f686703968c9df。检查README、LICENSE、pyproject.toml、tradingagents/default_config.py和目录结构。参考目录保留原许可证与Git历史，不作MarketLens应用代码；未装依赖、未运行、未登录上游模型服务。

默认core_stock_apis、technical_indicators与news_data使用yfinance，公司基本面使用SEC/yfinance。黄金适配至少需要：授权XAU行情、周日4h1h窗口与会话边界、以黄金宏观证据替换公司财报、情景结构校验、事件日历及本地工作台。多代理辩论增加调用成本，不作为首版默认。

正式复用优先固定依赖版本；若复制源码，逐文件保留版权和修改记录，随分发保留LICENSE/NOTICE。不能因仓库私有而移除署名。模型订阅登录等README宣称未作为本项目已验证能力。

GitHub发布：用户已允许私有项目；当前连接器无创建仓库工具，本机gh未登录，因此未创建或推送远端。未来仅上传经检查的自有文档/实现和必要许可，不上传work、行情原件、模型权重或凭据。
