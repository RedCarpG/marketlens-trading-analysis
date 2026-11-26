'use strict';
/* 常驻预警：页面关着时，代理也按页面同一套规则（web/js/core/）看价位和情景，交给 Cirra 说出来。
   2026-11-27 起默认不开：这件事改由 Cirra 的插件「MarketLens 行情」自己做（代理没开她也能看，docs/ROADMAP.md 第 4 步）。
   两边都开会说两遍，所以只有不用那个插件、或它是旧版本时才在 .env 写 CIRRA_WATCH=gold 打开。
   - 看哪些：.env 的 CIRRA_WATCH，见 parseWatch。不看持仓：止损止盈仍只在页面。
   - Cirra 没开时不取数（不消耗行情额度）。
   - 不补说：状态存在文件里，重启不重复；但间隔超过 3 个轮询（代理或她关过）就重新建立基准，不说错过的那些。 */
const fs = require('fs');
const path = require('path');
const { loadCore } = require('../core/load'); // 不用构建，直接从 web/js/core/ 加载（页面、测试、回测工具用的是同一份）
const { KIND } = require('./cirra');

const NEED = 500;
/* CIRRA_WATCH：`名称|数据服务|代码|周期|小数位` 用分号隔开，小数位可省略（默认 2），数据服务只能是 etoro / yahoo（本地历史不更新）。
   不填或 off 为不看；gold 为看黄金 1h（有行情密钥用 eToro，否则 Yahoo） */
function parseWatch(text, { keys, tfs, warn = console.warn }) {
  const t = (text || '').trim();
  if (!t || t.toLowerCase() === 'off') return [];
  if (t.toLowerCase() === 'gold') return [keys ? { name: '黄金 GOLD', src: 'etoro', symbol: 'GOLD', tf: '1h', dp: 2 } : { name: '黄金 GC', src: 'yahoo', symbol: 'GC=F', tf: '1h', dp: 2 }];
  return t.split(';').map(s => s.trim()).filter(Boolean).flatMap(s => {
    const [name, src, symbol, tf, dp] = s.split('|').map(x => x.trim());
    if (!name || !symbol || !['etoro', 'yahoo'].includes(src) || !tfs.includes(tf) || (src === 'etoro' && !keys)) {
      warn(`[watch] 忽略 CIRRA_WATCH 里的“${s}”（格式 名称|etoro或yahoo|代码|周期|小数位；eToro 需要行情密钥）`);
      return [];
    }
    return [{ name, src, symbol, tf, dp: /^\d$/.test(dp || '') ? +dp : 2 }];
  });
}

function createWatch({ list, candles, cirra, file, pollMs = 300e3, get = loadCore(), now = () => Date.now(), warn = console.warn }) {
  const [TFS, nxt, ctx, analyzeMTF, alCheck, alText] = ['TFS', 'nxt', 'ctx', 'analyzeMTF', 'alCheck', 'alText'].map(get);
  let state = {}, busy = false, timer = null;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 第一次运行，或文件坏了：重新建立基准 */ }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(state));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { warn(`[watch] 存状态失败：${e.message}`); }
  };
  /* 大周期K线只在本周期收新K线时重取，轮询之间只取本周期（价位要用最新价） */
  async function one(w) {
    const bars = await candles(w.src, w.symbol, w.tf, NEED);
    if (!bars.length) throw new Error('没有K线');
    const last = bars[bars.length - 1].timestamp;
    if (!w.C || w.last !== last) {
      const up = TFS.slice(TFS.indexOf(w.tf) + 1), C = {};
      for (const k of up) {
        try { C[k] = ctx(k, await candles(w.src, w.symbol, k, NEED)); }
        catch (e) { warn(`[watch] ${w.symbol} ${k}：${e.message}（这轮不看这个周期）`); }
      }
      w.C = C;
      w.last = last;
    }
    w.C[w.tf] = ctx(w.tf, bars);
    const px = bars[bars.length - 1].close, m = analyzeMTF(w.tf, w.C, px);
    if (!m) throw new Error(`已收盘K线不足（${bars.length} 根）`);
    const key = `${w.src}|${w.symbol}|${w.tf}`, t = now();
    let st = state[key];
    if (!st || t - st.at > pollMs * 3) st = { arm: {}, sc: null };
    const hits = alCheck(m, w.tf, px, st, { dp: w.dp });
    state[key] = { arm: st.arm, sc: st.sc, at: t };
    save();
    for (const h of hits) {
      const s = alText(h, { sym: w.symbol, name: w.name, T: w.tf, px, dp: w.dp });
      const r = await cirra.send({ text: s.say, emotion: KIND[s.ck], kind: s.ck });
      if (!r.ok) warn(`[watch] 没说出去：${r.reason}`);
    }
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      if (!(await cirra.status()).running) return;
      for (const w of list) {
        try {
          await one(w);
          w.err = null;
        } catch (e) {
          if (w.err !== e.message) warn(`[watch] ${w.symbol} ${w.tf}：${e.message}`); // 同样的错只记一次
          w.err = e.message;
        }
      }
    } finally { busy = false; }
  }
  return {
    tick,
    /* 给页面看：哪些品种和周期由代理负责（页面就不再转发这一组，免得说两遍） */
    list: () => list.map(({ name, src, symbol, tf }) => ({ name, src, symbol, tf })),
    start(first = 10e3) {
      if (!list.length || timer) return;
      const loop = () => { timer = setTimeout(() => tick().finally(loop), pollMs); timer.unref(); };
      timer = setTimeout(() => tick().finally(loop), first);
      timer.unref();
    },
    stop() { clearTimeout(timer); timer = null; },
  };
}

module.exports = { createWatch, parseWatch };
