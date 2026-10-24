/* 交易复盘（纯计算）
   对每笔交易只用“开仓那一刻之前已收盘”的K线重算当时的分析，回答四个问题：
   1. 当时大周期什么方向，这笔是顺势还是逆势；
   2. 入场位置：是靠近关键价位入场，还是在价位中间、甚至顶着反向价位入场；
   3. 止损设在多少个 ATR 外（没设或用 eToro 默认的远端止损算“未设”）；
   4. 当时有没有同方向的价格行为情景已触发。
   入场周期取 1h / 4h / 1d 中开仓前已有足够历史（≥100 根已收盘）的最小一个。规则与实时分析完全相同（ctx / analyzeMTF / scenarios）。 */
const RV_TFS = ['1h', '4h', '1d'];
const RV_POS = { good: '靠近关键价位入场', mid: '价位中间入场', bad: '顶着关键价位入场' };
const RV_STOP = {
  none: '未设止损 / 远端默认',
  tight: '止损过紧（<0.5 ATR）',
  ok: '止损正常（0.5–3 ATR）',
  wide: '止损过宽（>3 ATR）',
};
const RV_ALIGN = { 1: '顺大周期', '-1': '逆大周期', 0: '大周期震荡' };

/* all：{ 周期: K线数组（升序） }；t：交易 { isBuy, openTs, openRate, closeTs?, closeRate?, netProfit?, sl, units } */
function reviewTrade(t, all) {
  const dir = t.isBuy ? 1 : -1,
    p = t.openRate,
    Cx = {};
  /* 只保留开仓时已收盘的K线（最多最近 600 根，足够指标暖机和关键价位计算） */
  for (const k of TFS) {
    const b = all[k] || [];
    let n = b.length;
    while (n && nxt(k, b[n - 1].timestamp) > t.openTs) n--;
    if (n) Cx[k] = ctx(k, b.slice(Math.max(0, n - 600), n));
  }
  const T = RV_TFS.find(k => Cx[k] && Cx[k].ok);
  if (!T) return { t, dir, ok: false, reason: '开仓前已收盘的K线不足（1h/4h/1d 都少于 100 根）' };
  const m = analyzeMTF(T, Cx, p),
    x = m.t.a.a,
    keys = m.L.filter(l => isKey(l, T)),
    sup = keys.filter(l => l.p <= p).sort((a, b) => b.p - a.p)[0],
    res = keys.filter(l => l.p >= p).sort((a, b) => a.p - b.p)[0],
    dS = sup ? (p - sup.p) / x : Infinity,
    dR = res ? (res.p - p) / x : Infinity;
  /* 入场位置：做多时支撑在 0.5 ATR 内为“靠近关键价位”，阻力在 0.5 ATR 内为“顶着关键价位”；做空对称；其余为“价位中间” */
  const pos =
    dir > 0 ? (dS <= 0.5 ? 'good' : dR <= 0.5 ? 'bad' : 'mid') : dR <= 0.5 ? 'good' : dS <= 0.5 ? 'bad' : 'mid';
  /* 止损：离开仓价超过 30% 的视为 eToro 默认远端止损，按“未设”处理 */
  const slAtr = t.sl > 0 && Math.abs(t.sl - p) / p < 0.3 ? Math.abs(t.sl - p) / x : null,
    stop = slAtr == null ? 'none' : slAtr < 0.5 ? 'tight' : slAtr > 3 ? 'wide' : 'ok';
  const sc = m.sc.flatMap(c => c.trigs).find(g => g.state == '已触发' && g.dir === dir);
  const closed = t.closeRate != null && t.closeTs != null;
  return {
    t,
    dir,
    ok: true,
    tf: T,
    want: m.want,
    align: m.want ? (m.want === dir ? 1 : -1) : 0,
    chain: m.chain,
    s: m.s,
    atr: x,
    sup: sup ? { p: sup.p, tfs: sup.tfs, d: dS } : null,
    res: res ? { p: res.p, tfs: res.tfs, d: dR } : null,
    pos,
    slAtr,
    stop,
    sc: sc ? { kind: sc.kind, entry: sc.entry } : null,
    /* R 倍数：实际盈亏价差 ÷ 止损价差（只有设了止损才算） */
    r: closed && slAtr != null ? ((t.closeRate - p) * dir) / Math.abs(t.sl - p) : null,
    holdH: closed ? (t.closeTs - t.openTs) / 36e5 : null,
    win: closed && t.netProfit != null ? t.netProfit > 0 : null,
  };
}

/* 汇总：只统计已平仓且复盘成功的交易；按顺逆势、入场位置、止损、是否有同向情景分组，并给出几条最值得注意的结论 */
function summarizeReviews(rvs) {
  const ok = rvs.filter(r => r.ok && r.win != null),
    net = a => a.reduce((s, r) => s + r.t.netProfit, 0),
    loss = -ok.filter(r => r.t.netProfit < 0).reduce((s, r) => s + r.t.netProfit, 0);
  const grp = (f, names) =>
    Object.entries(names)
      .map(([key, name]) => {
        const a = ok.filter(r => String(f(r)) === key);
        return { key, name, n: a.length, win: a.filter(r => r.win).length, net: net(a) };
      })
      .filter(g => g.n);
  const groups = {
    align: grp(r => r.align, RV_ALIGN),
    pos: grp(r => r.pos, RV_POS),
    stop: grp(r => r.stop, RV_STOP),
    sc: grp(r => (r.sc ? 'y' : 'n'), { y: '有同向情景已触发', n: '无同向情景' }),
  };
  const avg = a => (a.length ? a.reduce((s, r) => s + r.holdH, 0) / a.length : null),
    holdWin = avg(ok.filter(r => r.win)),
    holdLoss = avg(ok.filter(r => !r.win));
  /* 结论：每个维度（顺逆势、入场位置、止损、情景）里净亏最多且至少 2 笔的那一组，按净亏从大到小，说明它占全部亏损额的比例；
     再补最赚钱的一组、持仓时长和止损的情况 */
  const insights = [];
  const worst = Object.values(groups)
    .map(gs => gs.filter(g => g.n >= 2 && g.net < 0).sort((a, b) => a.net - b.net)[0])
    .filter(Boolean)
    .sort((a, b) => a.net - b.net);
  if (loss > 0)
    for (const w of worst)
      insights.push(
        `${w.name}：${w.n} 笔，胜率 ${Math.round((w.win / w.n) * 100)}%，净亏 ${w.net.toFixed(0)}，相当于全部亏损额的 ${Math.round((-w.net / loss) * 100)}%`
      );
  const best = Object.values(groups)
    .flat()
    .filter(g => g.n >= 2 && g.net > 0)
    .sort((a, b) => b.net - a.net)[0];
  if (best)
    insights.push(
      `${best.name}：${best.n} 笔，胜率 ${Math.round((best.win / best.n) * 100)}%，净赚 ${best.net.toFixed(0)}`
    );
  if (holdWin != null && holdLoss != null && holdLoss > holdWin * 1.5)
    insights.push(
      `亏损单平均持仓 ${fmtHold(holdLoss)}，是盈利单（${fmtHold(holdWin)}）的 ${(holdLoss / holdWin).toFixed(1)} 倍，可能存在“亏损单拿太久”`
    );
  const noStop = ok.filter(r => r.stop == 'none').length;
  if (noStop) insights.push(`${noStop} 笔没有设置有效止损（未设或只有 eToro 默认的远端止损）`);
  return { n: ok.length, win: ok.filter(r => r.win).length, net: net(ok), holdWin, holdLoss, groups, insights };
}

const fmtHold = h => (h == null ? '—' : h < 48 ? h.toFixed(1) + ' 小时' : (h / 24).toFixed(1) + ' 天');
