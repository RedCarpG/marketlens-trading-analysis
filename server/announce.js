'use strict';
/* 代理自己播报经济日历给桌宠 Cirra（页面关着也说，只要代理在跑；计划见 docs/CIRRA.md §5）：
   - 相关货币（CIRRA_CCY，默认 USD）的高影响事件公布前 30 分钟、5 分钟各一句，同一时间的几项合成一句；
   - BLS 公布新的非农、CPI 月份时一句（说过的月份存在 var/cirra.json，重启不重复）；
   - 每天早上一句今天的重要事件：本机时间到 CIRRA_BRIEFING（默认 07:00）之后、Cirra 在的时候说一次。
   只在 Cirra 开着时看日历（她不在就不拉上游、也不说）。去重同页面预警：第一次看到时已在提醒范围内的不说，代理刚启动不补说错过的那次。
   日历来自 events.calendar()（有自己的缓存，30 秒看一次不会多拉上游）。外部来的事件名原样念，不交给任何 AI。 */
const fs = require('fs');
const path = require('path');

const CCYN = { USD: '美元', EUR: '欧元', GBP: '英镑', JPY: '日元', CNY: '人民币', CHF: '瑞郎', CAD: '加元', AUD: '澳元', NZD: '纽元' };
const pad = n => String(n).padStart(2, '0');
/* 本机时间（代理跑在你的电脑上，按电脑的时区） */
const hm = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const day = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const name = e => e.zh || e.title;
/* 同一时间的几项：去重、最多念 3 个 */
function names(es) {
  const ns = [...new Set(es.map(name))];
  return ns.slice(0, 3).join('、') + (ns.length > 3 ? ' 等' : '');
}
const ccyPre = c => (c == 'USD' ? '' : (CCYN[c] || c) + ' ');

/* BLS 新数念给她的句子（与页面 evDataAlert 的说法一致）：非农千人 → “新增 18 万” */
function blsSay(items, old) {
  const g = k => items.find(x => x.k == k),
    pct = x => x.val.toFixed(x.dp) + '%',
    wan = v => (v < 0 ? '减少 ' : '新增 ') + +(Math.abs(v) / 10).toFixed(1) + ' 万',
    n = g('nfp'),
    u = g('unemp'),
    c = g('cpi'),
    cc = g('core'),
    say = [];
  if (n && n.ref != old.nfp) say.push(`${+n.ref.slice(5)} 月非农${wan(n.val)}${u ? '，失业率 ' + pct(u) : ''}`);
  if (c && c.ref != old.cpi) say.push(`${+c.ref.slice(5)} 月 CPI 年率 ${pct(c)}${cc ? '，核心 ' + pct(cc) : ''}`);
  return say.length ? 'BLS 公布了：' + say.join('；') : '';
}

/* 今天的早报：今天（本机日期）还没公布的高影响事件，同一时间合成一项，最多 5 项。
   没取到日历时照实说没取到；日程里没有时只说“日程里没有”，不说“没有风险” */
function briefingText(r, t, ccy) {
  const cn = ccy.map(c => CCYN[c] || c).join('、');
  if (!r || !r.events || !r.sources || !r.sources.slice(0, 2).some(s => s.ok)) return '今天的经济日历没取到，重要事件要自己留意一下。';
  const today = day(t),
    es = r.events.filter(e => e.imp >= 3 && e.ts && ccy.includes(e.ccy) && day(e.ts) == today);
  if (!es.length) return `今天的日程里没有${cn}的高影响事件。`;
  const left = es.filter(e => e.ts > t);
  if (!left.length) return `今天${cn}的重要事件都已经公布了。`;
  const g = new Map();
  left.forEach(e => g.set(e.ts, [...(g.get(e.ts) || []), e]));
  const items = [...g].map(([ts, es2]) => `${hm(ts)} ${ccy.length > 1 ? ccyPre(es2[0].ccy) : ''}${names(es2)}`);
  return `今天有 ${items.length} 个重要事件：${items.slice(0, 5).join('；')}${items.length > 5 ? ' 等' : ''}`;
}

function createAnnouncer({ calendar, cirra, ccy = ['USD'], briefing = '07:00', file, now = () => Date.now() }) {
  const st = (() => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  })();
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(st));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { console.warn('[announce] 存不了状态：' + e.message); }
  };
  /* 布防：第一次看到时已在范围内的不说 */
  const arm = {};
  async function check(k, near, far, text, kind) {
    if (!(k in arm)) return void (arm[k] = !near);
    if (arm[k] && near) {
      arm[k] = false;
      await cirra.send({ text, kind });
    } else if (!arm[k] && far) arm[k] = true;
  }
  let busy = false;
  async function tick() {
    if (busy || !cirra.present()) return;
    busy = true;
    try {
      let r = null;
      try { r = await calendar(); } catch (e) { console.warn('[announce] 日历：' + e.message); }
      const t = now();
      /* 1. 公布前 30 / 5 分钟 */
      if (r && r.events) {
        const g = new Map();
        r.events.forEach(e => {
          if (e.imp < 3 || !e.ts || !ccy.includes(e.ccy) || e.ts <= t || e.ts > t + 2 * 36e5) return;
          const k = e.ts + '|' + e.ccy;
          g.set(k, [...(g.get(k) || []), e]);
        });
        for (const [k, es] of g) {
          const d = es[0].ts - t,
            fc = es.filter(e => e.forecast).slice(0, 2).map(e => `${name(e)} 预期 ${e.forecast}`).join('，');
          for (const m of [30, 5])
            await check(`${k}|${m}`, d <= m * 60e3, d > m * 60e3, `${ccyPre(es[0].ccy)}${names(es)}还有 ${Math.ceil(d / 60e3)} 分钟公布${fc ? '，' + fc : ''}`, 'ev');
        }
      }
      /* 2. BLS 新数：第一次只记下现在的月份；她没开时没说出去的，12 小时内还会补说 */
      const items = r && r.data && r.data.items;
      if (items && items.length) {
        const refs = { nfp: (items.find(x => x.k == 'nfp') || {}).ref || st.refs?.nfp, cpi: (items.find(x => x.k == 'cpi') || {}).ref || st.refs?.cpi };
        if (!st.refs) { st.refs = refs; save(); }
        else if (refs.nfp != st.refs.nfp || refs.cpi != st.refs.cpi) {
          const text = blsSay(items, st.refs),
            ok = text && (await cirra.send({ text, kind: 'ev' })).ok;
          if (!text || ok || !r.data.at || t - r.data.at > 12 * 36e5) { st.refs = refs; save(); }
        }
      }
      /* 3. 早报：到点后、她在的时候说一次；没说出去（她刚关了）下一轮再试 */
      if (briefing && st.briefed != day(t) && hm(t) >= briefing) {
        if ((await cirra.send({ text: briefingText(r, t, ccy), kind: 'brief' })).ok) { st.briefed = day(t); save(); }
      }
    } finally {
      busy = false;
    }
  }
  return { tick, state: st };
}

/* .env：CIRRA_EVENTS（默认开，0 关）、CIRRA_CCY（默认 USD，可写 USD,EUR）、CIRRA_BRIEFING（HH:MM，默认 07:00，留空不播早报） */
function announceConfig(E) {
  const on = E.CIRRA_EVENTS == null || !/^(0|false|off|no)$/i.test(String(E.CIRRA_EVENTS).trim()),
    ccy = String(E.CIRRA_CCY || 'USD').toUpperCase().split(/[,\s]+/).filter(c => /^[A-Z]{3}$/.test(c)),
    b = E.CIRRA_BRIEFING == null ? '07:00' : String(E.CIRRA_BRIEFING).trim(),
    m = b.match(/^(\d{1,2}):(\d{2})$/),
    briefing = m && +m[1] < 24 && +m[2] < 60 ? `${pad(+m[1])}:${m[2]}` : '';
  return { on, ccy: ccy.length ? ccy : ['USD'], briefing };
}

module.exports = { createAnnouncer, announceConfig, briefingText, blsSay };
