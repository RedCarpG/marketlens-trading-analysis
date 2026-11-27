'use strict';
/* 持仓看守：页面关着时，代理自己每分钟看一次持仓，把两件事交给 Cirra 说（docs/ROADMAP.md 第 6 步，SPEC 3.3.17）：
   - 价格离我的止损 / 止盈近了（判定和句子与页面共用：core/alertrules.js 的 slCheck / slText）；
   - 新开了一笔：对照我的守则，说哪几条没守（core/review.js 的 reviewTrade + core/rules.js 的 checkRules / checkSay）。
   为什么在代理里而不在 Cirra 的插件里：要读持仓，账户数据不进插件；交给她的只有一句话，没有金额、数量、盈亏。
   - 说不说是它自己的两个开关 { sl, ck }，存在状态文件里，在页面预警页的“页面关着也说”那一块勾（POST /api/cirra/prefs）。
     不跟页面的预警开关走：那些是每个浏览器各存一份的，页面关着、换个浏览器就对不上。
     默认两样都不说，也不取数——不会因为升级就自己开口。
   - 只看 list 里的品种（.env 的 CIRRA_POS，见 parsePos）；别的品种的持仓不看。
   - Cirra 没开时不取数。两样都没开时也不取数。
   - 不补说：止损 / 止盈的布防状态存在文件里，重启不重复；隔了很久（代理或她关过）就重新建立基准。
     新开的那一笔只在开仓后 FRESH 之内说，过了就只记下、不说。
   - ATR 用 1 小时图的（页面用的是当时在看的那个周期，所以页面的弹窗和她开口不一定在同一刻）。 */
const fs = require('fs');
const path = require('path');
const { loadCore } = require('../core/load');
const { KIND } = require('./cirra');

const FRESH = 30 * 60e3,
  TF = '1h',
  NEED = 700;
/* CIRRA_POS：不填 = 看黄金 GOLD（行情密钥和交易密钥都配了才看）；off = 不看；
   也可以写 `名称|eToro 代码|小数位|货币` 用分号隔开（小数位默认 2，货币默认 USD，多个用逗号），例如 `黄金 GOLD|GOLD|2;欧元|EURUSD|5|EUR,USD` */
function parsePos(text, { keys, tkeys, warn = console.warn }) {
  const t = (text || '').trim();
  if (t.toLowerCase() === 'off' || !keys || !tkeys) return [];
  if (!t) return [{ name: '黄金 GOLD', symbol: 'GOLD', dp: 2, ccy: ['USD'] }];
  return t.split(';').map(s => s.trim()).filter(Boolean).flatMap(s => {
    const [name, symbol, dp, ccy] = s.split('|').map(x => x.trim());
    if (!name || !/^[A-Za-z0-9._-]{1,30}$/.test(symbol || '')) {
      warn(`[pos] 忽略 CIRRA_POS 里的“${s}”（格式 名称|eToro 代码|小数位|货币）`);
      return [];
    }
    const cc = (ccy || 'USD').split(',').map(x => x.trim().toUpperCase()).filter(x => /^[A-Z]{3}$/.test(x));
    return [{ name: name.slice(0, 20), symbol, dp: /^\d$/.test(dp || '') ? +dp : 2, ccy: cc.length ? cc : ['USD'] }];
  });
}

/* positions()：当前持仓（全部品种）；closed()：已平仓（查“同时最多几笔”用）；resolve(代码) → 品种号；candles(代码, 周期, 根数)；
   calendar()：经济日历（“重要数据公布前后不开仓”用，取不到就那一条判断不了）；rules()：存着的守则 */
function createPosWatch({ list, positions, closed, resolve, candles, calendar, rules, cirra, file, pollMs = 60e3, get = loadCore(), now = () => Date.now(), warn = console.warn }) {
  const [TFS, nxt, ctx, slCheck, slText, reviewTrade, normRules, activeRules, checkRules, checkSay] = ['TFS', 'nxt', 'ctx', 'slCheck', 'slText', 'reviewTrade', 'normRules', 'activeRules', 'checkRules', 'checkSay'].map(get);
  const plain = v => JSON.parse(JSON.stringify(v));
  let state = { prefs: { sl: 0, ck: 0, at: 0 }, seen: {}, arm: {}, at: 0, last: [] },
    busy = false,
    timer = null,
    err = null;
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j == 'object')
      state = {
        prefs: { sl: j.prefs && j.prefs.sl ? 1 : 0, ck: j.prefs && j.prefs.ck ? 1 : 0, at: (j.prefs && +j.prefs.at) || 0 },
        seen: j.seen && typeof j.seen == 'object' ? j.seen : {},
        arm: j.arm && typeof j.arm == 'object' ? j.arm : {},
        at: +j.at || 0,
        last: Array.isArray(j.last) ? j.last.slice(-10) : [],
      };
  } catch { /* 第一次运行，或文件坏了：从空的开始（两样都不说，等你在页面上勾） */ }
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(state));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { warn(`[pos] 存状态失败：${e.message}`); }
  };
  /* 1 小时图的 ATR：只在走到下一根K线时重取 */
  const atrs = {};
  async function atrOf(w) {
    const t = now(), c = atrs[w.symbol];
    if (c && t < c.until) return c;
    const bars = await candles(w.symbol, TF, NEED);
    if (!bars.length) throw new Error('没有K线');
    const cx = ctx(TF, bars);
    if (!cx || !cx.ok || !(cx.a.a > 0)) throw new Error(`已收盘K线不足（${bars.length} 根）`);
    return (atrs[w.symbol] = { x: cx.a.a, px: bars[bars.length - 1].close, until: nxt(TF, bars[bars.length - 1].timestamp) });
  }
  async function say(s) {
    const r = await cirra.send({ text: s.say, emotion: KIND[s.ck], kind: s.ck });
    state.last = [...state.last, { t: now(), kind: s.ck, text: s.say, ok: !!r.ok, ...(r.ok ? {} : { reason: r.reason }) }].slice(-10);
    if (!r.ok) warn(`[pos] 没说出去：${r.reason}`);
  }
  /* 新开的一笔：重算开仓那一刻的分析，逐条对照守则 */
  async function checkNew(w, p, mine) {
    const R = normRules(rules());
    if (!activeRules(R).length) return; // 没勾守则，没什么可对照的
    const all = {};
    for (const k of TFS) {
      try { all[k] = await candles(w.symbol, k, NEED); }
      catch (e) { warn(`[pos] ${w.symbol} ${k}：${e.message}（体检不看这个周期）`); }
    }
    let ev, past = [];
    try { ev = (await calendar()).events; } catch (e) { warn(`[pos] 日历没取到：${e.message}（“重要数据前后”那条判断不了）`); }
    try { const id = await resolve(w.symbol); past = (await closed()).filter(t => t.instrumentId === id); }
    catch (e) { warn(`[pos] 已平仓的交易没取到：${e.message}`); }
    const res = checkRules(reviewTrade(p, all), R, { events: ev, ccy: w.ccy, trades: [...past, ...mine] }),
      s = checkSay(w.name, p.isBuy, res);
    if (s) await say(plain(s));
  }
  async function one(w, open, fresh) {
    const id = await resolve(w.symbol),
      mine = open.filter(p => p.instrumentId === id),
      ids = mine.map(p => String(p.id)),
      seen = state.seen[w.symbol],
      born = seen ? mine.filter(p => !seen.includes(String(p.id))) : []; // 第一次见到这个品种：只记下已有的
    state.seen[w.symbol] = [...new Set([...(seen || []), ...ids])].slice(-100);
    /* 布防状态：隔太久重新建立基准；已经平掉的持仓清掉 */
    let arm = fresh ? {} : state.arm[w.symbol] || {};
    arm = Object.fromEntries(Object.entries(arm).filter(([k]) => ids.includes(k.split('|')[1])));
    if (state.prefs.sl && mine.some(p => p.sl > 0 || p.tp > 0)) {
      const a = await atrOf(w);
      for (const p of mine) {
        const px = p.curRate > 0 ? p.curRate : a.px;
        for (const h of slCheck([p], px, a.x, arm)) await say(plain(slText(h, { sym: w.symbol, name: w.name, px, x: a.x, dp: w.dp })));
      }
    }
    state.arm[w.symbol] = arm;
    if (state.prefs.ck)
      for (const p of born) {
        if (now() - p.openTs > FRESH) continue;
        await checkNew(w, p, mine);
      }
  }
  async function tick() {
    if (busy || !list.length || (!state.prefs.sl && !state.prefs.ck)) return;
    busy = true;
    try {
      if (!(await cirra.status()).running) return;
      const t = now(), fresh = !state.at || t - state.at > pollMs * 5;
      let open;
      try {
        open = await positions();
        err = null;
      } catch (e) {
        if (err !== e.message) warn(`[pos] 持仓没取到：${e.message}`); // 同样的错只记一次
        err = e.message;
        return;
      }
      for (const w of list) {
        try {
          await one(w, open, fresh);
          w.err = null;
        } catch (e) {
          if (w.err !== e.message) warn(`[pos] ${w.symbol}：${e.message}`);
          w.err = e.message;
        }
      }
      state.at = t;
      save();
    } finally { busy = false; }
  }
  return {
    tick,
    /* 在页面上勾的两个开关：{ sl, ck } */
    setPrefs(p) {
      /* 止损 / 止盈刚打开：布防状态可能是很久以前的，清掉重新建立基准（和页面开关预警时一样），不然一打开就响 */
      if (p && p.sl && !state.prefs.sl) state.arm = {};
      state.prefs = { sl: p && p.sl ? 1 : 0, ck: p && p.ck ? 1 : 0, at: now() };
      save();
      return this.status();
    },
    /* 给页面看：看不看、看哪些品种、现在的开关、上一条说了什么（那句话本身没有金额） */
    status: () => ({ on: list.length > 0, symbols: list.map(w => w.symbol), prefs: { sl: state.prefs.sl, ck: state.prefs.ck }, last: state.last[state.last.length - 1] || null, err: err || (list.find(w => w.err) || {}).err || null }),
    start(first = 15e3) {
      if (!list.length || timer) return;
      const loop = () => { timer = setTimeout(() => tick().finally(loop), pollMs); timer.unref(); };
      timer = setTimeout(() => tick().finally(loop), first);
      timer.unref();
    },
    stop() { clearTimeout(timer); timer = null; },
  };
}

module.exports = { createPosWatch, parsePos, FRESH };
