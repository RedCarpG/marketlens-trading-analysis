'use strict';
/* 桌宠 Cirra（cirra-deskpet）播报：她开着时在本机事件端口收 POST /notify，端口和每次启动生成的 token 写在 ~/.cirra/endpoint.json
   （CIRRA_ENDPOINT_FILE 可改位置，和 Cirra 用同一个变量名）。协议见 cirra-deskpet 的 docs/stage4.md §4：
   请求头 X-Cirra-Token、Content-Type: application/json，Host 须为 127.0.0.1:端口；请求体 { text, title?, emotion? }，成功回 204。
   浏览器页面拿不到 token（她也故意不让网页直接调），所以由本地代理转发。每次发送都重读文件（她重启后端口、token 会变）；
   文件不在或连不上就当她没开，静默跳过，不影响 MarketLens 自己的提醒。 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.cirra', 'endpoint.json');
/* 她认得的表情（cirra-deskpet sidecar/src/core/protocol.ts 的 EMOTIONS），别的值她回 400 */
const EMOTIONS = ['neutral', 'happy', 'sad', 'surprised', 'sleepy', 'worried'];
/* 预警类型 → 她的表情（页面不传表情，由这里决定）。scx = 情景失效 / 到目标 / 被取代；test = “试一下”；brief = 代理的早报（announce.js） */
const KIND = { lv: 'neutral', sc: 'surprised', scx: 'neutral', dn: 'worried', up: 'happy', ev: 'surprised', brief: 'neutral', test: 'happy' };
/* 她的气泡显示时截到 200 字，这里先截好 */
const clip = s => [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()].slice(0, 200).join('');

function createCirra({ file = FILE, fetchImpl = fetch, now = () => Date.now(), limit = 8 } = {}) {
  const sent = [];
  function read() {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Number.isInteger(j.port) && j.port > 0 && j.port < 65536 && typeof j.token == 'string' && j.token ? j : null;
    } catch {
      return null;
    }
  }
  const post = (ep, body) =>
    fetchImpl(`http://127.0.0.1:${ep.port}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cirra-token': ep.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3e3),
    });
  /* 说一句：返回 { ok, reason }。每分钟最多 limit 条（行情剧烈波动时不把她刷屏；她自己也会把排着的合成一句）；
     401 时重读一次文件再试（她刚重启、token 换了） */
  async function send({ text, emotion = 'neutral' }) {
    const body = { text: clip(text), emotion: EMOTIONS.includes(emotion) ? emotion : 'neutral' };
    if (!body.text) return { ok: false, reason: '没有内容' };
    const ep = read();
    if (!ep) return { ok: false, reason: 'Cirra 没开' };
    const t = now();
    while (sent.length && t - sent[0] >= 60e3) sent.shift();
    if (sent.length >= limit) return { ok: false, reason: '一分钟内发得太多，这条没发' };
    sent.push(t);
    try {
      let r = await post(ep, body);
      if (r.status === 401) {
        const ep2 = read();
        if (ep2 && (ep2.token !== ep.token || ep2.port !== ep.port)) r = await post(ep2, body);
      }
      if (r.ok) return { ok: true };
      if (r.status === 401) return { ok: false, reason: 'Cirra 的 token 对不上（她刚重启？）' };
      return { ok: false, reason: `Cirra 拒绝：${r.status} ${clip(await r.text().catch(() => '')).slice(0, 80)}`.trim() };
    } catch {
      return { ok: false, reason: 'Cirra 没开' };
    }
  }
  /* 她在不在：endpoint 文件在、端口上有人回话。对 /notify 发 GET，她回 405（只收 POST）——不带 token，不会触发通知 */
  async function status() {
    const ep = read();
    if (!ep) return { running: false, reason: `没找到 ${file}（Cirra 没开）` };
    try {
      const r = await fetchImpl(`http://127.0.0.1:${ep.port}/notify`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      return r.status === 405 ? { running: true } : { running: false, reason: `端口 ${ep.port} 上回话的不像 Cirra（${r.status}）` };
    } catch {
      return { running: false, reason: 'Cirra 没开（端口连不上）' };
    }
  }
  /* 只看文件在不在（不连端口）：代理的日历播报用它决定这一轮要不要看日历 */
  const present = () => !!read();
  return { send, status, present, file };
}

module.exports = { createCirra, KIND, clip };
