# MarketLens

个人行情观察与分析工具：K线铺满整页，自上而下多周期分析（1M / 1w → 1d → 4h → 1h / 15m）、关键价位与前高前低、价格行为情景、价格预警、交易复盘，以及经济日历（非农、CPI、FOMC 等）、BLS 官方数据与新闻。只读行情，不下单。

**在线演示：** https://redcarpg.github.io/marketlens-trading-analysis/
演示页使用模拟K线、模拟交易记录和公开的加密货币行情；规则的初步回测未发现可靠优势（见 docs/BACKTEST.md），不构成投资建议。

## 本地运行（含实时行情与个人交易记录）

1. 复制 `.env.example` 为 `.env`，填入行情数据服务的只读 API 密钥（不需要任何写权限；`.env` 不入 Git）。
2. `cd server && npm install && npm start`
3. 浏览器打开 http://127.0.0.1:8787/

本地代理只监听本机，只托管 `web/` 下的页面，密钥只保存在本机；说明见 [server/README.md](server/README.md)。不填密钥也能启动，模拟数据、CSV 导入、公开行情和经济日历与新闻照常可用。经济日历与新闻需经本地代理获取，演示页上显示“未覆盖”。

## 目录

- `web/` 页面（KLineChart 9.8，普通脚本，无构建步骤）；`web/js/core/` 为纯计算，可在 Node 中测试；`web/js/data.js` 为数据源适配器，每个数据源一项
- `server/` 本地代理（Node.js：行情与实时推送、交易记录、本地K线存储、经济日历与新闻）
- `tests/` `npm test`（Node 自带 node:test）
- `docs/SPEC.md` 规格与设计记录；`docs/CONT.md` 进度记录
