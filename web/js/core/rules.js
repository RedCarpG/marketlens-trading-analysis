/* 我的守则与开仓体检（纯计算）
   守则是你自己定的规矩：从下面几条里勾选（有的带一个数），再加几条自己写的文字。
   体检：拿一笔交易的复盘结果（review.js 的 reviewTrade：开仓那一刻的大周期、入场位置、止损）逐条对照，
   每条给出 守住 / 没守 / 判断不了。自己写的文字没法自动判断，只列出来让你自己核对。
   这些只是把你定的规矩照实核对一遍，不是建议：规则本身回测没有可靠优势（docs/BACKTEST.md）。 */
const RULE_DEFS = [
  { id: 'range', text: '大周期震荡时不开仓' },
  { id: 'counter', text: '不逆着大周期开仓' },
  { id: 'nostop', text: '开仓要设止损' },
  { id: 'wide', text: '止损不超过 {n} 个 ATR', n: 3, min: 0.5, max: 10, step: 0.5 },
  { id: 'against', text: '不顶着关键价位开仓（做多顶着阻力、做空贴着支撑）' },
  { id: 'event', text: '重要数据公布前后 {n} 小时内不开仓', n: 2, min: 0.5, max: 24, step: 0.5 },
  { id: 'stack', text: '同一品种同时最多 {n} 笔', n: 1, min: 1, max: 10, step: 1 },
];
const RULE_LIMIT = { custom: 10, text: 60 };
const ruleText = (d, n) => d.text.replace('{n}', +n);
/* 存下来的守则（可能是旧的、手改坏的）整理成 { on: { id: 0|1 }, n: { id: 数 }, custom: [文字] }；默认都不勾 */
function normRules(r) {
  r = r && typeof r == 'object' ? r : {};
  const on = {},
    n = {};
  for (const d of RULE_DEFS) {
    on[d.id] = r.on && r.on[d.id] ? 1 : 0;
    if (d.n != null) {
      const v = r.n ? +r.n[d.id] : NaN;
      n[d.id] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.n;
    }
  }
  const custom = (Array.isArray(r.custom) ? r.custom : [])
    .map(s => [...String(s == null ? '' : s).replace(/\s+/g, ' ').trim()].slice(0, RULE_LIMIT.text).join(''))
    .filter(Boolean)
    .slice(0, RULE_LIMIT.custom);
  return { on, n, custom };
}
/* 勾上的那几条：[{ id, text, n }] */
const activeRules = rules => RULE_DEFS.filter(d => rules.on[d.id]).map(d => ({ id: d.id, n: rules.n[d.id], text: ruleText(d, rules.n[d.id]) }));
/* 有没有设有效的止损：离开仓价超过 30% 的是 eToro 默认的远端止损，按没设算（和 reviewTrade 一样） */
const hasStop = t => t.sl > 0 && Math.abs(t.sl - t.openRate) / t.openRate < 0.3;

/* 体检。rv：reviewTrade 的结果；rules：normRules 的结果；
   x：{ events 经济日历的事件 [{ ts, imp, ccy, zh, title }]、ccy 相关货币、trades 这个品种的全部交易（已平仓 + 持仓，查同时持仓用） }。
   返回 { items: [{ id, text, ok: true 守住 / false 没守 / null 判断不了, note }], broke, kept, unknown, custom } */
function checkRules(rv, rules, x = {}) {
  const t = rv.t,
    na = why => ({ ok: null, note: why }),
    need = f => (rv.ok ? f() : na('开仓前的K线不够，没法重算当时的分析')),
    by = {
      range: () => need(() => (rv.align === 0 ? { ok: false, note: '开仓时大周期震荡' } : { ok: true })),
      counter: () => need(() => (rv.align < 0 ? { ok: false, note: `大周期${rv.want > 0 ? '偏多' : '偏空'}，这笔是反着做的` } : { ok: true })),
      nostop: () => (hasStop(t) ? { ok: true } : { ok: false, note: '没设止损（或只有远端的默认止损）' }),
      wide: n =>
        need(() =>
          rv.slAtr == null
            ? na('没设止损，量不了宽度')
            : rv.slAtr > n
              ? { ok: false, note: `止损在 ${rv.slAtr.toFixed(1)} 个 ATR 外` }
              : { ok: true, note: `${rv.slAtr.toFixed(1)} 个 ATR` }
        ),
      against: () =>
        need(() =>
          rv.pos == 'bad'
            ? { ok: false, note: rv.dir > 0 ? `上方 ${rv.res.d.toFixed(1)} 个 ATR 就是阻力` : `下方 ${rv.sup.d.toFixed(1)} 个 ATR 就是支撑` }
            : { ok: true }
        ),
      event: n => {
        const ev = (x.events || []).filter(e => typeof e.ts == 'number');
        /* 日历是从开始用这个工具起慢慢攒的：比最早那条还早的交易，没有记录可对照 */
        if (!ev.length || t.openTs < Math.min(...ev.map(e => e.ts))) return na('那时的经济日历没有记录');
        const ccy = x.ccy || ['USD'],
          near = ev
            .filter(e => e.imp >= 3 && ccy.includes(e.ccy) && Math.abs(e.ts - t.openTs) <= n * 36e5)
            .sort((a, b) => Math.abs(a.ts - t.openTs) - Math.abs(b.ts - t.openTs))[0];
        if (!near) return { ok: true };
        const h = Math.abs(near.ts - t.openTs) / 36e5,
          name = [...String(near.zh || near.title || '重要数据')].slice(0, 20).join('');
        return { ok: false, note: `${name}${near.ts >= t.openTs ? `还有 ${h.toFixed(1)} 小时公布` : `刚公布 ${h.toFixed(1)} 小时`}` };
      },
      stack: n => {
        const others = (x.trades || []).filter(o => o.id !== t.id && o.openTs <= t.openTs && (o.closeTs == null || o.closeTs > t.openTs)).length;
        return others + 1 > n ? { ok: false, note: `开仓时已经有 ${others} 笔` } : { ok: true };
      },
    },
    items = activeRules(rules).map(r => ({ id: r.id, text: r.text, note: '', ...by[r.id](r.n) }));
  return {
    items,
    broke: items.filter(i => i.ok === false).length,
    kept: items.filter(i => i.ok === true).length,
    unknown: items.filter(i => i.ok == null).length,
    custom: rules.custom,
  };
}
/* 新开仓时说的话。name 是念出来的品种名；没有勾守则、或一条都判断不了时返回 null（没什么可说）。
   text 弹窗用（带每条的原因），say 给 Cirra 念（短，只有价位没有金额）；ck：ck 有没守的 / cko 都守住了 */
function checkSay(name, isBuy, res) {
  const what = `${name}${isBuy ? '多' : '空'}单`,
    bad = res.items.filter(i => i.ok === false);
  if (bad.length)
    return {
      text: `新开的${what}：${bad.length} 条守则没守——${bad.map(i => i.text + (i.note ? `（${i.note}）` : '')).join('；')}`,
      say: `你新开的${what}，有 ${bad.length} 条守则没守：${bad.map(i => i.text.replace(/（.*?）/g, '')).join('；')}。`,
      kind: 'dn',
      ck: 'ck',
    };
  if (!res.kept) return null;
  const tail = res.unknown ? `，另有 ${res.unknown} 条判断不了` : '';
  return {
    text: `新开的${what}：${res.kept} 条守则都守住了${tail}`,
    say: `你新开的${what}，${res.kept} 条守则都守住了${tail}。`,
    kind: 'up',
    ck: 'cko',
  };
}
/* 复盘里的守则统计：每条守则没守 / 守住的各有几笔、赢几笔、净盈亏。rows：[{ rv, res }]，只算已平仓的 */
function ruleStats(rows, rules) {
  const done = rows.filter(r => r.rv.win != null),
    cell = a => ({ n: a.length, win: a.filter(r => r.rv.win).length, net: a.reduce((s, r) => s + r.rv.t.netProfit, 0) });
  return activeRules(rules).map(rule => {
    const of = ok => done.filter(r => (r.res.items.find(i => i.id == rule.id) || {}).ok === ok);
    return { id: rule.id, text: rule.text, broke: cell(of(false)), kept: cell(of(true)), unknown: of(null).length };
  });
}

/* ===== 每周一页：最近几周各开了几笔、平了几笔、守则没守几次、写了几条日记，以及这一周最该记住的一件事 =====
   rows：[{ rv, res }]（复盘 + 体检，金额已经换成显示用的币种）；noteOf(t) 取这笔的日记（没有返回 null）。
   周从周一 00:00 UTC 起（和周线K线一样）。开仓、守则、日记算在开仓那一周，盈亏算在平仓那一周。
   “最该记住的”按固定的顺序挑，不靠模型：这周没守最多的那条守则（至少 2 次）→ 这周亏得最多的一笔（带它没守的守则和你当时写的理由）→ 没守的那一两条 → 都守住了。 */
function weekly(rows, noteOf = () => null, weeks = 6, now = Date.now()) {
  const W = 6048e5,
    wk0 = bkt('1w', now),
    out = [];
  for (let k = 0; k < weeks; k++) {
    const from = wk0 - k * W,
      to = from + W,
      opened = rows.filter(r => r.rv.t.openTs >= from && r.rv.t.openTs < to),
      closed = rows.filter(r => r.rv.win != null && r.rv.t.closeTs >= from && r.rv.t.closeTs < to);
    if (!opened.length && !closed.length) continue;
    const broke = {};
    opened.forEach(r => r.res.items.filter(i => i.ok === false).forEach(i => (broke[i.text] = (broke[i.text] || 0) + 1)));
    const top = Object.entries(broke).sort((a, b) => b[1] - a[1])[0],
      worst = closed.filter(r => r.rv.t.netProfit < 0).sort((a, b) => a.rv.t.netProfit - b.rv.t.netProfit)[0],
      notes = opened.map(r => noteOf(r.rv.t)).filter(Boolean),
      tags = {};
    notes.forEach(n => (n.tags || []).forEach(g => (tags[g] = (tags[g] || 0) + 1)));
    let lesson;
    if (top && top[1] >= 2) lesson = `「${top[0]}」这周没守 ${top[1]} 次`;
    else if (worst) {
      const bad = worst.res.items.filter(i => i.ok === false).map(i => i.text),
        n = noteOf(worst.rv.t);
      lesson = `亏得最多的一笔${bad.length ? `没守：${bad.join('；')}` : '守则都守住了'}${n && n.why ? `；当时写的是“${[...n.why.replace(/\s+/g, ' ')].slice(0, 40).join('')}”` : ''}`;
    } else if (top) lesson = `没守的：${Object.keys(broke).join('；')}`;
    else if (opened.length && opened.every(r => !r.res.items.some(i => i.ok === false)) && opened.some(r => r.res.kept)) lesson = '开的每一笔都守住了守则';
    else lesson = '';
    out.push({
      from,
      to,
      opened: opened.length,
      closed: closed.length,
      win: closed.filter(r => r.rv.win).length,
      net: closed.reduce((s, r) => s + r.rv.t.netProfit, 0),
      broke: Object.values(broke).reduce((s, v) => s + v, 0),
      brokeTop: top ? { text: top[0], n: top[1] } : null,
      notes: notes.length,
      tags: Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([g]) => g),
      lesson,
    });
  }
  return out;
}
