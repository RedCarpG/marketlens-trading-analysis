/* 价格行为情景（纯计算） */
/* ===== 价格行为情景（纯K线）：在最近的关键支撑/阻力上，各给“反弹/回落”和“突破/跌破后回踩”两个条件情景 =====
   触发（多头，空头对称）：最近 6 根已收盘K线中，有K线最低价触及支撑 0.25 ATR 内、收盘仍在支撑上方，且为止跌形态
   （下影≥K线长度 40%、看涨吞没，或阳线收在上部 40%）。此前 20 根内曾收盘跌破该价位 → 突破回踩（前阻力转支撑）；
   最低价刺破价位 → 假跌破；否则 → 支撑反弹。入场=触发K线收盘，止损=触发K线极值与价位外 0.25 ATR，
   目标=下一个反向关键价位（不足 1 倍风险时用 2 倍风险）。之后的K线触及止损为失效、触及目标为已到目标。 */
function scenarios(T, t, L, now) {
  const rb = t.rb,
    n = rb.length,
    x = t.a.a,
    tol = x * 0.25,
    M = mainLv(L, now, x, T),
    byD = a => [...a].sort((u, v) => Math.abs(u.p - now) - Math.abs(v.p - now)),
    S = byD(M.sup),
    R = byD(M.res);
  const det = (lv, dir, nx) => {
    const p = lv.p;
    for (let i = n - 1; i >= Math.max(1, n - 6); i--) {
      const b = rb[i],
        pb = rb[i - 1],
        rg = b.high - b.low || 1e-9;
      if (!(dir > 0 ? b.low <= p + tol && b.close > p : b.high >= p - tol && b.close < p)) continue;
      const wick = dir > 0 ? Math.min(b.open, b.close) - b.low : b.high - Math.max(b.open, b.close),
        eng =
          dir > 0
            ? pb.close < pb.open && b.close > b.open && b.close >= pb.open && b.open <= pb.close
            : pb.close > pb.open && b.close < b.open && b.close <= pb.open && b.open >= pb.close,
        body =
          dir > 0 ? b.close > b.open && b.close >= b.low + rg * 0.6 : b.close < b.open && b.close <= b.high - rg * 0.6,
        shape =
          wick >= rg * 0.4
            ? dir > 0
              ? '长下影'
              : '长上影'
            : eng
              ? dir > 0
                ? '看涨吞没'
                : '看跌吞没'
              : body
                ? dir > 0
                  ? '强阳收回'
                  : '强阴收回'
                : null;
      if (!shape) continue;
      const was = rb.slice(Math.max(0, i - 20), i).some(k => (dir > 0 ? k.close < p - x * 0.1 : k.close > p + x * 0.1)),
        pierce = dir > 0 ? b.low < p - x * 0.05 : b.high > p + x * 0.05,
        kind = was
          ? dir > 0
            ? '突破回踩'
            : '跌破回抽'
          : pierce
            ? dir > 0
              ? '假跌破'
              : '假突破'
            : dir > 0
              ? '支撑反弹'
              : '阻力回落',
        entry = b.close,
        stop = dir > 0 ? Math.min(b.low, p) - tol : Math.max(b.high, p) + tol,
        risk = Math.abs(entry - stop),
        tl = nx && (dir > 0 ? nx.p > entry + risk : nx.p < entry - risk) ? nx : null,
        tgt = tl ? tl.p : entry + 2 * risk * dir;
      let state = '已触发';
      for (let j = i + 1; j < n; j++) {
        const k = rb[j];
        if (dir > 0 ? k.low <= stop : k.high >= stop) {
          state = '失效';
          break;
        }
        if (dir > 0 ? k.high >= tgt : k.low <= tgt) {
          state = '已到目标';
          break;
        }
      }
      if (state == '已触发' && (dir > 0 ? now <= stop : now >= stop)) state = '失效（未收盘）';
      return {
        dir,
        kind,
        shape,
        i,
        ts: b.timestamp,
        entry,
        stop,
        tgt,
        tl,
        rr: Math.abs(tgt - entry) / risk,
        state,
        ago: n - 1 - i,
      };
    }
    return null;
  };
  /* 卡片：R=上方阻力，S=下方支撑；最近的阻力和支撑相距不足 0.5 ATR 时，价格其实处在一个区间里，合并为 Z 卡片，并顺延给出外侧的阻力/支撑 */
  const mk = (k, lv, up, dn) => ({
      k,
      lv,
      trigs: [det(lv, k == 'R' ? -1 : 1, k == 'R' ? dn : up)].filter(Boolean),
      alt:
        k == 'R'
          ? [
              { dir: -1, c: '触及后出现滞涨K线（长上影/看跌吞没）', t: dn },
              { dir: 1, c: '收盘突破后回踩不破', t: up },
            ]
          : [
              { dir: 1, c: '回踩出现止跌K线（长下影/看涨吞没）', t: up },
              { dir: -1, c: '收盘跌破后回抽不过', t: dn },
            ],
    }),
    out = [];
  if (R[0] && S[0] && R[0].p - S[0].p < x * 0.5) {
    if (R[1]) out.push(mk('R', R[1], R[2], R[0]));
    out.push({
      k: 'Z',
      lo: S[0],
      hi: R[0],
      trigs: [det(S[0], 1, R[1]), det(R[0], -1, S[1])].filter(Boolean),
      alt: [
        { dir: 1, c: '收盘站上区间上沿后回踩不破', t: R[1] },
        { dir: -1, c: '收盘跌破区间下沿后回抽不过', t: S[1] },
      ],
    });
    if (S[1]) out.push(mk('S', S[1], S[0], S[2]));
  } else {
    if (R[0]) out.push(mk('R', R[0], R[1], S[0]));
    if (S[0]) out.push(mk('S', S[0], R[0], S[1]));
  }
  /* 多空同时“已触发”（价格在区间内来回）时，以较新的触发为准，较早的作废 */
  const act = out.flatMap(c => c.trigs).filter(g => g.state == '已触发'),
    last = act.reduce((a, g) => (!a || g.i > a.i ? g : a), null);
  if (last)
    act.forEach(g => {
      if (g.dir != last.dir) g.state = '被反向触发取代';
    });
  return out;
}
