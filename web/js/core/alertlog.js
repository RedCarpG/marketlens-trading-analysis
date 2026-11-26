/* 我画的预警线（纯计算）：线的整理与到价判定、到价时的句子 */
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
/* 一条线到价时的文字：text 弹窗用，say 给 Cirra 念；kind 是弹窗的样式，交给 Cirra 时归到“关键价位”（ck 为 lv） */
function lineText(l, { sym, name, T, px, dp = 2 }) {
  const f = v => v.toFixed(dp);
  return {
    text: `${sym} ${T} 价格 ${f(px)} 到了我画的线 ${f(l.p)}`,
    say: `${name} 到了你画的线 ${f(l.p)} 附近`,
    kind: 'ml',
    ck: 'lv',
  };
}
