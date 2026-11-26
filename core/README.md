# marketlens-core

MarketLens 的核心计算，给别的程序用（现在是桌宠 Cirra 的插件）：给它各周期的K线，它算出各周期方向、关键价位、现价离最近的支撑和阻力多远，并能压成几句话交给 AI 或语音。

只算事实，不给买卖建议：这些规则的回测没有发现可靠优势（仓库的 docs/BACKTEST.md）。包里没有网络请求，K线由调用方自己取。

## 用法

```js
import { analyzeCandles, describeState } from 'marketlens-core';

// all：{ 周期: K线数组 }，旧到新；要有本周期，更大的周期有几个给几个，每个最近 500 根左右
const a = analyzeCandles('1h', { '1h': h1, '4h': h4, '1d': d1, '1w': w1 });
const s = describeState({ ...a, name: '黄金 GOLD' });
s.text;  // 黄金 GOLD 现价 3570.30。各周期方向（按均线）：周线偏空，日线偏空，4 小时震荡，1 小时偏多。1 小时上，下方最近的支撑是 …
s.facts; // 同样的内容，结构化：{ px, atr, trend, support, resistance, asof }
```

K线的格式：`{ timestamp, open, high, low, close, volume? }`，`timestamp` 是这根K线的开始时间（毫秒，UTC）。最后一根可以还没收盘，分析只用已收盘的；最新价默认取最后一根的收盘，也可以作为第三个参数传进来。

别的接口（都在 `index.d.ts` 里，有说明）：

| 做什么 | 用哪个 |
|---|---|
| 价位、情景的提醒该不该发，以及念出来的句子 | `alCheck`、`alText` |
| 给 AI 的分析包（JSON）和提问模板 | `buildPack`、`packPrompt` |
| 自己拼分析的各步 | `ctx`、`analyzeMTF`、`isKey`、`mainLv`、`prevHL` |
| 周期和时间 | `TFS`、`TFN`、`nxt`、`closed` |
| AI 分析记录的前瞻打分 | `scoreAi`、`aiStats` |

`analyzeMTF` 的结果里还有规则评分、结论和情景（`s`、`v`、`st`、`sc`）。它们是页面上给自己看的参考，不要原样说给人听。

## 源码和打包

实现不在这个文件夹里：就是页面用的 `web/js/core/`（普通脚本，没有 import / export）。这样页面、本地代理、回测和这个包用的是同一份。

- `files.js`：加载顺序和对外的名字。
- `load.js`：不用构建，直接从源码加载（本地代理、命令行工具、测试用）。
- `build.js`：按顺序拼成一个文件、补上导出，出 `dist/index.mjs` 和 `dist/index.cjs`。
- `index.d.ts`：手写的类型。

```
npm run build:core     # 生成 core/dist/
npm run pack:core      # 生成后打成 core/marketlens-core-<版本>.tgz
```

`dist/` 和 `.tgz` 不入 Git。改了 `web/js/core/` 里对外的东西：在 `files.js` 的 `API` 和 `index.d.ts` 里同步；加名字升小版本，改、删已有的升大版本（`package.json` 的 `version`）。`tests/corepkg.test.js` 核对打出来的包和源码算出的结果一致、名字和类型对得上。

## 发版

打出的 `.tgz` 挂到 GitHub Release（标签 `core-v<版本>`），用它的程序在 `package.json` 里写那个地址：

```json
"dependencies": { "marketlens-core": "https://github.com/RedCarpG/marketlens-trading-analysis/releases/download/core-v0.1.0/marketlens-core-0.1.0.tgz" }
```

开发时也可以直接指向本机的文件：`"marketlens-core": "file:X:/Project/MarketLens/core/marketlens-core-0.1.0.tgz"`。
