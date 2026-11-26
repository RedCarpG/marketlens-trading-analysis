/* 我画的预警线、预警记录（纯计算）：线的整理与到价判定、记录的整理、价位类预警之后怎样了 */
/* ===== 我画的线 =====
   一个品种的线是 [{ id, p 价格, t 加的时间 }]；id 就是按品种小数位写出来的价格，所以同一个价位只有一条 */
const ML_MAX = 20;
/* 整理存下来的线：去掉价格不是正数的、重复的，最多 ML_MAX 条，按价格从高到低 */
function normLines(v) {
  const seen = new Set();
  return (Array.isArray(v) ? v : [])
    .filter(l => l && Number.isFinite(l.p) && l.p > 0 && typeof l.id == 'string' && !seen.has(l.id) && seen.add(l.id))
    .map(l => ({ id: l.id, p: l.p, t: Number.isFinite(l.t) ? l.t : 0 }))
    .slice(0, ML_MAX)
    .sort((a, b) => b.p - a.p);
}
/* 加一条线。返回 { lines 新的数组, added 加上的那条 } 或 { lines 原样, reason 为什么没加 } */
function addLine(lines, p, now, dp = 2) {
  p = +p;
  if (!Number.isFinite(p) || p <= 0) return { lines, reason: '价格要是大于 0 的数' };
  const id = p.toFixed(dp);
  if (!(+id > 0)) return { lines, reason: '价格要是大于 0 的数' };
  if (lines.some(l => l.id == id)) return { lines, reason: `${id} 已经有一条线了` };
  if (lines.length >= ML_MAX) return { lines, reason: `一个品种最多 ${ML_MAX} 条线，先删掉几条` };
  const added = { id, p: +id, t: now };
  return { lines: normLines([...lines, added]), added };
}
/* 到价判定，和关键价位同一套：进入 ±0.15 ATR 提醒，离开 0.5 ATR 后重新布防，第一次见到已经在线上的不提醒（armStep）。
   arm 是布防状态（原地更新），返回这次该提醒的线 */
function lineCheck(lines, px, atr, arm) {
  return lines.filter(l => {
    const d = Math.abs(px - l.p);
    return armStep(arm, 'ml|' + l.id, d <= atr * 0.15, d >= atr * 0.5);
  });
}
/* 一条线到价时的文字：text 弹窗用，say 给 Cirra 念；kind 是弹窗和记录的样式，交给 Cirra 时归到“关键价位”（ck 为 lv） */
function lineText(l, { sym, name, T, px, dp = 2 }) {
  const f = v => v.toFixed(dp);
  return {
    text: `${sym} ${T} 价格 ${f(px)} 到了我画的线 ${f(l.p)}`,
    say: `${name} 到了你画的线 ${f(l.p)} 附近`,
    kind: 'ml',
    ck: 'lv',
  };
}

/* ===== 预警记录 =====
   一条记录：{ id, t 时间, sym 品种, tf 周期, ty 类型, kind 样式, text 文字, px 当时的价格, dp 小数位, src 数据源 }；
   价位类（关键价位 lv、我画的线 ml）另带 lp 价位、atr 当时的 ATR、bt 当时那根K线的起点，用来之后判定怎样了；
   判定有了结论后写进 o（bounce 反弹 / break 突破 / open 未定）、ok（第几根）、ob（同一根里两头都到）。新的在前 */
const AL_MAX = 300;
/* 记录的类型（预警页按它筛） */
const AL_TY = {
  lv: '关键价位',
  ml: '我画的线',
  sc: '情景',
  sl: '止损 / 止盈',
  ck: '开仓体检',
  ev: '经济事件',
  ot: '其他',
};
/* 交给 Cirra 的类型（alFire 的 ck）→ 记录的类型 */
const AL_CK = { lv: 'lv', sc: 'sc', scx: 'sc', dn: 'sl', up: 'sl', ev: 'ev', ck: 'ck', cko: 'ck' };
const alTyOf = ck => AL_CK[ck] || 'ot';
const AL_O = ['bounce', 'break', 'open'];
function normRec(r) {
  if (!r || !Number.isFinite(r.t) || typeof r.text != 'string' || !r.text) return null;
  const num = v => (Number.isFinite(v) ? v : null),
    o = {
      id: typeof r.id == 'string' && r.id ? r.id : String(r.t),
      t: r.t,
      sym: String(r.sym || ''),
      tf: String(r.tf || ''),
      ty: AL_TY[r.ty] ? r.ty : 'ot',
      kind: /^\w{1,8}$/.test(r.kind) ? r.kind : 'lv',
      text: r.text.slice(0, 400),
      px: num(r.px),
      dp: Number.isInteger(r.dp) && r.dp >= 0 && r.dp <= 8 ? r.dp : 2,
      src: String(r.src || ''),
    };
  if (num(r.lp) > 0 && num(r.atr) > 0 && num(r.bt) != null && o.px != null) {
    o.lp = r.lp;
    o.atr = r.atr;
    o.bt = r.bt;
    if (AL_O.includes(r.o)) {
      o.o = r.o;
      o.ok = num(r.ok) || 0;
      if (r.ob) o.ob = 1;
    }
  }
  return o;
}
/* 整理存下来的记录：坏的丢掉，按时间新的在前，最多 AL_MAX 条 */
function normLog(v) {
  return (Array.isArray(v) ? v : [])
    .map(normRec)
    .filter(Boolean)
    .sort((a, b) => b.t - a.t)
    .slice(0, AL_MAX);
}
/* 记一条（放在最前面），超过 AL_MAX 丢掉最旧的；整理不出来的不记 */
function logAdd(log, r) {
  const o = normRec(r);
  return o ? [o, ...log].slice(0, AL_MAX) : log;
}
/* 价位类预警之后怎样了（定义照 docs/BACKTEST.md 第 5 节 D）。从预警所在那根K线的下一根起最多看 n 根（默认 10）：
   先离开价位、回到来的那一侧 ≥1 个 ATR → 反弹（bounce）；先穿过价位、到另一侧 ≥1 个 ATR → 突破（break）；
   n 根走完两边都没到 → 未定（open）；同一根里两头都到、分不出先后 → 也算未定（both 为 1）；还没走完 n 根 → 还在看（wait）。
   来的那一侧：预警时价格在价位上方（正好在价位上也算）是从上面来。ATR 用预警当时的。距离从价位算起，不是从预警时的价格。
   b：这个周期已收盘的K线（升序）。返回 { st, k 第几根（wait 时是已经过了几根）, dir 这一下往上 1 / 往下 -1 }；
   记录和这批K线对不上时返回 null：预警比最早一根还早、找不到那一根、或者当时的价格离那一根的高低点超过 0.25 个 ATR
   （换了数据源，或者模拟行情重新生成过） */
function lvOutcome(r, b, n = 10) {
  if (!r || !(r.lp > 0) || !(r.atr > 0) || r.bt == null || r.px == null || !b.length) return null;
  if (r.bt > b[b.length - 1].timestamp) return { st: 'wait', k: 0 };
  let lo = 0,
    hi = b.length - 1;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (b[m].timestamp < r.bt) lo = m + 1;
    else hi = m;
  }
  const x0 = b[lo];
  if (x0.timestamp !== r.bt || r.px > x0.high + r.atr * 0.25 || r.px < x0.low - r.atr * 0.25) return null;
  const side = r.px >= r.lp ? 1 : -1,
    up = r.lp + r.atr,
    dn = r.lp - r.atr;
  for (let k = 1; k <= n; k++) {
    const x = b[lo + k];
    if (!x) return { st: 'wait', k: k - 1 };
    const u = x.high >= up,
      d = x.low <= dn;
    if (u && d) return { st: 'open', k, both: 1 };
    if (u || d) return { st: (u ? 1 : -1) == side ? 'bounce' : 'break', k, dir: u ? 1 : -1 };
  }
  return { st: 'open', k: n };
}
/* 把结论写成一句。r：记录（用来判断往上还是往下）；o：lvOutcome 的结果，或者记录里存下来的 { st: r.o, k: r.ok, both: r.ob }。
   “反弹”这一类按方向写成 向上反弹 / 向下回落，“突破”这一类写成 向上突破 / 向下跌破 */
function outcomeText(r, o, n = 10) {
  if (!o) return '';
  if (o.st == 'wait')
    return o.k ? `之后：过了 ${o.k} 根，两边都还没走出 1 个 ATR，看满 ${n} 根再说` : '之后：等后面的K线收盘再看';
  if (o.st == 'open')
    return o.both
      ? `之后第 ${o.k} 根里上下都走出了 1 个 ATR，分不出先后（未定）`
      : `之后 ${n} 根里，往回走和穿过去都没到 1 个 ATR（未定）`;
  const up = (r.px >= r.lp ? 1 : -1) * (o.st == 'bounce' ? 1 : -1) > 0,
    w = o.st == 'bounce' ? (up ? '向上反弹' : '向下回落') : up ? '向上突破' : '向下跌破';
  return `之后第 ${o.k} 根：${w}了 1 个 ATR 以上（${o.st == 'bounce' ? '被挡回' : '穿过去了'}）`;
}
/* 价位类记录的结论各有几条：{ n, bounce, brk, open, none 还没有结论的（还在看，或者K线对不上、没加载到） } */
function outcomeStats(log) {
  const a = log.filter(r => r.lp != null),
    c = s => a.filter(r => r.o == s).length;
  return { n: a.length, bounce: c('bounce'), brk: c('break'), open: c('open'), none: a.filter(r => !r.o).length };
}
