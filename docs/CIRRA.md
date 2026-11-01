# 让桌宠 Cirra 播报预警与信息（计划，未实现）

日期：2026-11-01。状态：第①步已完成（见 SPEC 3.3.11），第②步待做。分支 `ccr-bd0a1e8b-mxsb48`（从 main 0ae4158 重新起），在 worktree `.claude/worktrees/cirra-notify` 里做。

## 1. 要做什么

用户的桌宠项目 Cirra（仓库 cirra-deskpet，Tauri + Node sidecar，常驻 Windows 桌面）能把消息说出来。希望 MarketLens 的预警和信息由她播报：

1. 页面里已有的四类预警（到达关键价位、情景触发 / 失效、接近我的止损 / 止盈、重要经济事件与 BLS 新数），除了弹窗和系统通知，再交给 Cirra 说一遍。
2. 经济日历的提醒和每天早上的“今天有什么重要事件”，**页面没开时也能说**（只要代理在跑）。

已定（2026-11-01 用户说“按推荐来”）：

- 默认只让她播 **经济事件** 和 **我的止损 / 止盈**；价位、情景提醒较频繁，默认不播，可以单独打开。
- 加每天早上的事件播报。
- Cirra 那边不改代码。

## 2. Cirra 那边已经有的（核对 cirra-deskpet 0b7e74b）

- 本地事件端口：Cirra 开着时 sidecar 监听 `127.0.0.1:17421`（`sidecar/config.json` 的 `eventPort` 可改），每次启动生成 token，端口和 token 写在 `~/.cirra/endpoint.json`（`{ port, token, pid }`；环境变量 `CIRRA_ENDPOINT_FILE` 可改位置）。
- `POST /notify`：请求头 `X-Cirra-Token`、`Content-Type: application/json`，Host 必须是 `127.0.0.1:端口` 或 `localhost:端口`，请求体最大 64 KB，成功回 204。
  - 请求体 `{ text, title?, emotion? }`：`text` 必填，显示时截到 200 字；`title` 可选，显示成「title：text」（title 截到 20 字）；`emotion` 只能是 `neutral / happy / sad / surprised / sleepy / worried`，默认 `neutral`，其他值回 400。
  - 不带 CORS 头、不放行预检：**浏览器页面不能直接调**，只能由同一台电脑上的程序（MarketLens 代理）转发。
- 推来的消息进她的通知模组（来源 `notify`，设置里叫“外部通知”）：免打扰、专注时段、全屏时先攒着，之后补说；排着好几条时合成一句（「行情有 3 条：……」）；提醒方式可选 说出来 / 只显示 / 只记录 / 关；记入通知记录。文字原样说出（固定模板，不经过 Claude），朗读时数字、单位由她的念法处理。
- 来源的名字：在 Cirra 本机的 `sidecar/local.json` 写 `{ "notifyLabel": "行情" }`，设置和合并句里就叫“行情”。这是用户本机的配置，不是代码改动。

## 3. 结构

```
页面 alFire(text, kind, say) ──POST /api/cirra/notify──┐
                                                       ├─ server/cirra.js ── 读 ~/.cirra/endpoint.json ── POST /notify ──► Cirra
代理里的日历播报（server/announce.js，页面关着也跑）──────┘   （没开就跳过；token 变了重读一次；限速）
```

- 转发只在 MarketLens 代理里做：浏览器拿不到 Cirra 的 token，Cirra 也故意不让网页直接调。
- 每次发送都重新读 endpoint 文件（Cirra 重启后端口、token 会变）；文件不存在或连不上 = “Cirra 没开”，静默跳过，不影响 MarketLens 自己的提醒。

## 4. 第①步：转发通道 + 页面预警交给 Cirra

### 4.1 代理（server/cirra.js + index.js）

- `createCirra({ file, fetchImpl, now })`：
  - `send({ text, title, emotion })`：读 endpoint 文件 → POST `/notify`（超时 3 秒）。401 时重读一次文件再试（Cirra 刚重启、token 换了）。返回 `{ ok, reason }`，reason 为“Cirra 没开 / token 不对 / Cirra 拒绝：…”。
  - `status()`：文件在不在、端口能不能连上（对端口发一次 GET，Cirra 回 405 即说明在跑；不带 token、不会触发通知）。
  - 限速：每分钟最多 8 条，超出的丢弃并记日志（避免一次行情剧烈波动把她刷屏；她自己也会合并）。
- 新接口：
  - `GET /api/cirra/status` → `{ running, file }`
  - `POST /api/cirra/notify`，请求体 `{ text, kind }`：
    - 现在代理只收 GET，改为**只有这个地址收 POST**；
    - 必须带 `Origin` 且在本机白名单里、`Content-Type: application/json`（跨站网页发不了：不回 CORS 头，预检过不去）、Host 为本机（沿用现有检查）、请求体 ≤ 4 KB；
    - `kind` 只接受 `lv / sc / dn / up / ev / test`，**表情由代理按 kind 决定**（见 4.3），不接收页面传来的 emotion；`text` 去掉换行、截到 200 字。
- `.env.example` 加 `CIRRA_ENDPOINT_FILE=`（可选，和 Cirra 用同一个变量名）。

### 4.2 页面

- `alFire(text, kind, say)`：多一个 `say`——给 Cirra 念的短句（现在的提醒文字信息很密，适合看不适合听）。四类预警的调用处各补一句 `say`；不给时用 `text`。
- 预警页加一块“Cirra 播报”：
  - 开关“让 Cirra 播报”（默认开；只在本地代理打开时显示），下面四个勾选：价位（默认关）、情景（默认关）、止损 / 止盈（默认开）、经济事件（默认开）。存在本地偏好里。
  - 状态一行：“Cirra 在线 / Cirra 没开（打开桌宠后自动连上）”，每 30 秒查一次；按钮“试一下”发一句「MarketLens 连上了」。
  - 只在预警总开关开着时转发（和弹窗、系统通知一样，是 alFire 的又一个出口）。
- 公开演示页（不经代理）不显示这一块。

### 4.3 念的句子与表情

| 预警 | 给 Cirra 的句子（例） | 表情 |
|---|---|---|
| 到达关键价位 `lv` | 黄金 GOLD 到了支撑 4010.20 附近 | neutral |
| 情景触发 `sc` | 黄金 GOLD 日线出现支撑反弹做多，入场 4012.35，止损 3990.00 | surprised |
| 情景失效 / 到目标 `sc` | 黄金 GOLD 那个支撑反弹做多失效了 | neutral |
| 接近我的止损 `dn` | 黄金 GOLD 离你的止损 3990.00 只差 0.4 个 ATR | worried |
| 接近我的止盈 `up` | 黄金 GOLD 离你的止盈 4080.00 只差 0.4 个 ATR | happy |
| 事件即将公布 `ev` | FOMC 声明、联邦基金利率决议还有 30 分钟公布，预期 3.50% | surprised |
| BLS 公布新数 `ev` | BLS 公布了：9 月非农新增 18 万，失业率 4.3% | surprised |
| 试一下 `test` | MarketLens 连上了 | happy |

- 品种用名称（如“黄金 GOLD”），周期写成“日线 / 4 小时”等；非农写成“新增 18 万”而不是“+180K”，方便念。
- 不传 title（她的来源名已经是“外部通知 / 行情”），避免念成「MarketLens：……」。

## 5. 第②步：代理自己播报经济日历（页面关着也说）

- `server/announce.js`：代理启动后每 30 秒看一次 `events.calendar()`（它自己有缓存，不会多拉上游）：
  - 相关货币（`.env` 的 `CIRRA_CCY`，默认 USD）的高影响事件，公布前 30 分钟、5 分钟各说一次，同一时间的几项合成一句；
  - BLS 公布新的非农、CPI 月份时说一次（上次说过的月份存在 `var/cirra.json`，重启不重复）；
  - 每天早上一次今日播报：本机时间 7:00 之后代理第一次在跑时，说今天的高影响事件（「今天有 2 个重要事件：14:00 谘商会消费者信心；20:00 FOMC 利率决议」）。日历没取到时说“今天的经济日历没取到”；没有事件时说“今天的日程里没有 USD 的高影响事件”（并说明 Forex Factory 只覆盖本周）——不说“今天没风险”。
  - 去重规则同页面预警：第一次看到时已在提醒范围内的不说（代理刚启动时不补说已经错过的那次）。
- `.env`：`CIRRA_EVENTS=1`（默认开；Cirra 没开时什么都不发）、`CIRRA_CCY=USD`、`CIRRA_BRIEFING=07:00`（留空不播早报）。
- 开着时，页面不再把“经济事件”类转发给 Cirra（避免同一件事说两遍）；预警页那一项改写为“经济事件由代理直接播报（页面关着也会说）”。页面从 `/api/cirra/status` 得知代理播报开没开。
- 已知取舍：代理不知道你在不在电脑前（Cirra 自己的早报会等你回到电脑前）；7 点后代理第一次运行就播，没人听时这句会留在她的通知记录和对话记录里。

## 6. 测试与验证

- 单测（node:test，不访问网络）：
  - `server/cirra.js`：用临时 endpoint 文件 + 本机临时端口上的假 Cirra——发送格式（Host、token、Content-Type、请求体）、Cirra 没开时跳过、401 后重读文件重试、限速、截短与去换行；
  - `/api/cirra/notify`：没有 Origin / 外站 Origin / 非 JSON / kind 不认识 / 太大 → 拒绝；表情按 kind；其他地址仍只收 GET；
  - `server/announce.js`：注入时间——30 / 5 分钟各一次、合并同一时间、启动基准不补说、BLS 新月份只说一次且重启不重复、早报每天一次、日历失败时的说法。
- 联调：在开发环境里用 cirra-deskpet 自己的事件端口代码（`sidecar/src/events/server.ts`，用 tsx 跑）当真 Cirra，确认协议对得上（这一步只验证接口，不出声音、不显示桌宠）。
- 页面：用浏览器 + 假 Cirra 检查预警页这一块、勾选、状态、“试一下”，以及触发预警时代理确实转发、关掉的类不转发。
- 真机（只有用户能做）：本机开着 Cirra 和 MarketLens，点“试一下”，看她说不说、表情对不对；可选在 Cirra 的 `sidecar/local.json` 写 `{ "notifyLabel": "行情" }`。

## 7. 不做（以后再说）

- 不改 Cirra 的代码。
- 反过来让 Cirra 查 MarketLens（聊天里问她“金价多少”“今天有什么事件”）：Cirra 支持给聊天加 MCP 服务器，以后可以给 MarketLens 做一个只读 MCP；这次不做。
- 价位、情景提醒由代理在后台算（页面关着也提醒）：分析代码在浏览器里，搬到代理要另做，不在这次范围。

## 8. 改动的文件（预计）

- 新增：`server/cirra.js`、`server/announce.js`、`tests/cirra.test.js`、`tests/announce.test.js`
- 修改：`server/index.js`（两个接口、启动播报）、`web/js/alerts.js`（alFire 多一个出口、say 句子）、`web/js/events.js`（事件提醒的 say 句子）、`web/js/panel.js`（预警页一块）、`web/css/app.css`、`.env.example`、`server/README.md`、`docs/SPEC.md`（新一节）、`docs/CONT.md`

分两次提交：第①步做完跑测试、浏览器检查后提交推送，再做第②步。
