/* 周期上下文与多周期自上而下分析（纯计算） */
/* ===== 多周期自上而下分析（SPEC 3.5） ===== */
const MINB = { '1M': 60 },
  ROLE = { '1M': '背景', '1w': '背景', '1d': '结构', '4h': '区域', '1h': '触发', '15m': '触发' },
  BT = { 1: '偏多', '-1': '偏空', 0: '震荡' };
const MTF_W = { '1M': 3, '1w': 6, '1d': 5, '4h': 4, '1h': 3 }; // 大周期方向对评分的加减分，合计上限 ±15，权重待回测
const closed = (tf, b) => (b.length && nxt(tf, b[b.length - 1].timestamp) > Date.now() ? b.slice(0, -1) : b);
/* 各周期的方向（bias）判断方法，回测对比见 docs/BACKTEST.md 第 15 节：
   ema    EMA20 在 EMA50 上方且收盘在 EMA50 上方为偏多（反之偏空），其余震荡
   struct 摆动结构：最近两个摆动高点、低点都抬高且收盘未跌破最近低点为偏多；都降低且收盘未站上最近高点为偏空
   fast   同 ema，换成 EMA10 / EMA20（转向更快） */
const BIAS_DEF = 'ema';
function trendOf(m, b, a, pv) {
  if (m === 'struct') {
    if (pv.hs.length < 2 || pv.ls.length < 2) return 0;
    const [h1, h2] = pv.hs.slice(-2).map(q => q.p),
      [l1, l2] = pv.ls.slice(-2).map(q => q.p);
    return h2 > h1 && l2 > l1 && a.c > l2 ? 1 : h2 < h1 && l2 < l1 && a.c < h2 ? -1 : 0;
  }
  if (m === 'fast') {
    const C = b.map(x => x.close),
      e10 = ema(C, 10).at(-1);
    return e10 > a.e2 && a.c > a.e2 ? 1 : e10 < a.e2 && a.c < a.e2 ? -1 : 0;
  }
  return a.e2 > a.e5 && a.c > a.e5 ? 1 : a.e2 < a.e5 && a.c < a.e5 ? -1 : 0;
}
function ctx(tf, raw, bm = BIAS_DEF) {
  const b = closed(tf, raw),
    a = analyze(b);
  if (!a) return { tf, n: b.length, a: null, ok: 0 };
  const L = b.slice(-50),
    V = b.slice(-150),
    pv = pivots(b, 2, a.a);
  return {
    tf,
    n: b.length,
    a,
    ok: b.length >= (MINB[tf] || 100),
    bias: trendOf(bm, b, a, pv),
    pv,
    rb: V,
    hi50: Math.max(...L.map(x => x.high)),
    lo50: Math.min(...L.map(x => x.low)),
    hi150: Math.max(...V.map(x => x.high)),
    lo150: Math.min(...V.map(x => x.low)),
    asof: b[b.length - 1].timestamp,
  };
}
/* now：最新价（含未收盘K线），只用于判断当前价位置，不参与信号；sco：情景收紧选项（默认 SC_DEF，回测时可换） */
function analyzeMTF(T, C, now, sco) {
  const t = C[T];
  if (!t || !t.a) return null;
  const hs = TFS.slice(TFS.indexOf(T) + 1)
      .reverse()
      .map(k => C[k])
      .filter(Boolean),
    why = [],
    chain = [];
  let dir = null,
    org = null,
    conf = 0,
    mb = 0,
    adj = 0;
  for (const x of hs) {
    if (!x.ok) {
      why.push(`${x.tf} 已收盘K线 ${x.n} 根，不足 ${MINB[x.tf] || 100} 根，仅作参考`);
      chain.push({ tf: x.tf, t: '数据不足' });
      continue;
    }
    adj += x.bias * (MTF_W[x.tf] || 0);
    chain.push({ tf: x.tf, t: BT[x.bias], d: x.bias });
    if (x.tf == '1M') {
      mb = x.bias;
      continue;
    }
    if (x.tf == '1w') {
      dir = x.bias || mb;
      org = x.bias ? '1w' : mb ? '1M' : null;
      if (mb && x.bias == -mb) why.push('周线与月线方向相反，以周线为准，月线仅作参考');
      continue;
    }
    if (!dir) {
      dir = x.bias;
      org = x.bias ? x.tf : null;
      continue;
    }
    if (x.bias == -dir) {
      if (x.tf == '1d') {
        conf = 1;
        why.push(`日线${BT[x.bias]}，与 ${org} ${BT[dir]}冲突，观望`);
      } else why.push(`${x.tf} ${BT[x.bias]}，视为 ${org} 趋势中的回调`);
    }
  }
  adj = Math.max(-15, Math.min(15, adj));
  const s = Math.max(0, Math.min(100, t.a.s + adj)),
    raw = s >= 65 ? 1 : s <= 35 ? -1 : 0,
    want = conf ? 0 : dir || 0;
  let v = 0,
    st = '观望';
  if (conf);
  else if (!want) {
    v = raw;
    st = raw ? '已触发' : '观望';
    if (dir === 0) why.push('大周期震荡，仅按本周期信号判断');
  } else if (raw == want) {
    v = want;
    st = '已触发';
  } else {
    st = '观察中';
    why.push(
      raw
        ? `${T} 信号${BT[raw]}，与大周期方向相反，不单独给出${raw > 0 ? '做多' : '做空'}建议`
        : `顺 ${org} ${BT[want]}方向，等待 ${T} 触发`
    );
  }
  /* 价位按最新价划分支撑/阻力（当日大跌时，昨日收盘上方的支撑其实已在现价上方），范围也包含最新价 */
  const px0 = now ?? t.a.c,
    x = t.a.a,
    L = levels(T, C, px0, x, Math.min(t.lo150, px0) - x, Math.max(t.hi150, px0) + x);
  return { s, adj, raw, v, st, conf, chain, why, t, L, want, sc: scenarios(T, t, L, px0, sco) };
}
