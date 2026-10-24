/* 回测（纯计算，浏览器与 Node 共用；设计见 docs/BACKTEST.md）
   逐根回放入场周期 T 的K线：在每根收盘时只把“当时已收盘”的K线交给页面同一套规则（ctx / analyzeMTF / scenarios），
   记录新出现的信号、当时的评分、新触发的情景；之后才用未来K线度量结果。规则只看 T 及更大的周期，所以只截取这些周期。
   from / to（时间戳，可选）只限定入场时间段：之前的K线照常用于预热，之后的K线照常用于结算。
   成本（每笔扣一次，换算成 R）：spread 点差（价格单位）、fee 隔夜费（价格单位/天）、spreadPct 往返点差与手续费（入场价的 %）、
   carry 隔夜费年化（入场价的 %，按持仓自然日计）。sc：情景收紧选项（null = 页面默认 SC_DEF）。 */
const BT_DEF = {
  tf: '1d',
  warm: 150,
  win: 600,
  hs: [1, 3, 5, 10],
  maxHold: 50,
  spread: 0,
  fee: 0,
  spreadPct: 0,
  carry: 0,
  split: 2 / 3,
  from: null,
  to: null,
  sc: null,
};

/* 已收盘根数：bars 按时间升序，nxt(tf, ts) <= t 的根数（二分） */
function btCount(bars, tf, t) {
  let lo = 0,
    hi = bars.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (nxt(tf, bars[m].timestamp) <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/* 逐根回放，收集事件。all：{ 周期: K线数组（升序） }。大周期的 ctx 只在它出现新的收盘K线时重算 */
function btRun(all, opts = {}) {
  const o = { ...BT_DEF, ...opts },
    T = o.tf,
    B = all[T] || [],
    tfs = TFS.slice(TFS.indexOf(T)).filter(k => all[k] && all[k].length),
    cache = {},
    steps = [],
    sigs = [],
    trades = [],
    seen = new Set();
  for (let i = o.warm; i < B.length; i++) {
    if (o.from != null && B[i].timestamp < o.from) continue;
    if (o.to != null && B[i].timestamp > o.to) break;
    const t = nxt(T, B[i].timestamp),
      Cx = {};
    for (const k of tfs) {
      const bs = all[k],
        m = k === T ? i + 1 : btCount(bs, k, t);
      if (!m) continue;
      if (k === T) Cx[k] = ctx(k, bs.slice(Math.max(0, m - o.win), m));
      else {
        const key = bs[m - 1].timestamp;
        if (!cache[k] || cache[k].key !== key) cache[k] = { key, c: ctx(k, bs.slice(Math.max(0, m - o.win), m)) };
        Cx[k] = cache[k].c;
      }
    }
    const c = Cx[T];
    if (!c || !c.a || !c.ok) continue;
    const px = B[i].close,
      m = analyzeMTF(T, Cx, px, o.sc || undefined);
    if (!m) continue;
    const a = c.a,
      x = a.a,
      near = m.L.some(l => isKey(l, T) && Math.abs(l.p - px) <= x * 0.5);
    steps.push({ i, ts: B[i].timestamp, s: m.s, raw: a.s, adj: m.adj, v: m.v, st: m.st, want: m.want, atr: x });
    for (const g of a.sigs)
      if (g.i === c.n - 1) sigs.push({ i, ts: B[i].timestamp, t: g.t, dir: g.dir, atr: x, want: m.want, near, s: m.s });
    /* 情景：只记触发K线就是刚收盘这根的（ago 0）；之后 6 根内还会被识别到，按 类型+方向+触发时间 去重 */
    for (const cd of m.sc)
      for (const g of cd.trigs) {
        const key = g.kind + g.dir + g.ts;
        if (g.ago !== 0 || seen.has(key)) continue;
        seen.add(key);
        const lv = cd.k == 'Z' ? (g.dir > 0 ? cd.lo : cd.hi) : cd.lv;
        trades.push({
          i,
          ts: g.ts,
          kind: g.kind,
          dir: g.dir,
          entry: g.entry,
          stop: g.stop,
          tgt: g.tgt,
          rr: g.rr,
          shape: g.shape,
          align: m.want ? (m.want === g.dir ? 1 : -1) : 0,
          touch: lv ? lv.touch : 0,
          top: lv ? lv.top : null,
          tfs: lv ? lv.tfs.length : 0,
          atr: x,
        });
      }
  }
  return { opts: o, steps, sigs, trades };
}

/* 模拟成交：入场 = 触发K线收盘；之后逐根检查。开盘就越过止损/目标 → 按开盘价成交；同一根K线内止损和目标都触及 → 按先止损（保守）；
   超过 maxHold 根 → 按收盘价平仓；数据不够判断 → open（不计入统计）。R = （盈亏价差 − 点差 − 隔夜费 × 天数）÷ 初始风险 */
function btSim(B, tr, o) {
  const d = tr.dir,
    risk = Math.abs(tr.entry - tr.stop),
    i = tr.i,
    done = (px, res, j) => {
      const days = (B[j].timestamp - B[i].timestamp) / 864e5;
      const cost = o.spread + o.fee * days + (tr.entry * ((o.spreadPct || 0) + ((o.carry || 0) * days) / 365)) / 100;
      return { res, exitI: j, exitPx: px, bars: j - i, R: ((px - tr.entry) * d - cost) / risk };
    };
  if (!(risk > 0)) return { res: 'invalid' };
  const last = Math.min(B.length - 1, i + o.maxHold);
  for (let j = i + 1; j <= last; j++) {
    const k = B[j];
    if (d > 0 ? k.open <= tr.stop : k.open >= tr.stop) return done(k.open, 'stop', j);
    if (d > 0 ? k.open >= tr.tgt : k.open <= tr.tgt) return done(k.open, 'target', j);
    if (d > 0 ? k.low <= tr.stop : k.high >= tr.stop) return done(tr.stop, 'stop', j);
    if (d > 0 ? k.high >= tr.tgt : k.low <= tr.tgt) return done(tr.tgt, 'target', j);
  }
  if (i + o.maxHold <= B.length - 1) return done(B[i + o.maxHold].close, 'timeout', i + o.maxHold);
  return { res: 'open' };
}

/* 前瞻收益（以 ATR 计，按方向 d）、最大有利/不利波动；未来K线不够时为 null */
function btFwd(B, i, h, d, atr) {
  if (i + h >= B.length) return null;
  let fav = -Infinity,
    adv = -Infinity;
  for (let j = i + 1; j <= i + h; j++) {
    fav = Math.max(fav, d > 0 ? B[j].high - B[i].close : B[i].close - B[j].low);
    adv = Math.max(adv, d > 0 ? B[i].close - B[j].low : B[j].high - B[i].close);
  }
  return { r: ((B[i + h].close - B[i].close) * d) / atr, mfe: fav / atr, mae: adv / atr };
}

/* ===== 统计 ===== */
/* 命中率的 95% 置信区间（Wilson） */
function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n,
    z2 = z * z,
    c = (p + z2 / (2 * n)) / (1 + z2 / n),
    w = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { p, lo: c - w, hi: c + w };
}
/* 均值与 95% 区间（正态近似） */
function mstat(a) {
  const n = a.length;
  if (!n) return { n: 0 };
  const mean = a.reduce((s, v) => s + v, 0) / n,
    sd = n > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0,
    se = sd / Math.sqrt(n);
  return { n, mean, se, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}
/* 秩相关（Spearman），并列取平均秩 */
function spearman(x, y) {
  const rank = a => {
    const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]),
      r = Array(a.length);
    for (let i = 0; i < o.length; ) {
      let j = i;
      while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
      for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const n = x.length;
  if (n < 3) return null;
  const rx = rank(x),
    ry = rank(y),
    mx = (n - 1) / 2;
  let num = 0,
    dx = 0,
    dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - mx);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - mx) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}
/* 一组带方向的前瞻收益：样本数、平均收益、命中率；n < 30 标样本不足 */
function btGroup(rs) {
  const v = rs.filter(r => r != null),
    m = mstat(v),
    w = wilson(v.filter(r => r > 0).length, v.length);
  return { ...m, hit: w, thin: v.length < 30 };
}
/* 一组模拟交易：笔数、胜率、平均 R、盈亏比、最大回撤（R）、平均持仓、各结局占比 */
function btTrades(ts) {
  const c = ts.filter(t => t.out && t.out.R != null),
    R = c.map(t => t.out.R),
    win = R.filter(r => r > 0),
    loss = R.filter(r => r <= 0);
  let eq = 0,
    peak = 0,
    dd = 0;
  for (const r of R) {
    eq += r;
    peak = Math.max(peak, eq);
    dd = Math.max(dd, peak - eq);
  }
  const by = k => c.filter(t => t.out.res === k).length;
  return {
    ...mstat(R),
    hit: wilson(win.length, c.length),
    pf: loss.length ? win.reduce((s, r) => s + r, 0) / -loss.reduce((s, r) => s + r, 0) : null,
    dd,
    total: eq,
    bars: c.length ? c.reduce((s, t) => s + t.out.bars, 0) / c.length : null,
    target: by('target'),
    stop: by('stop'),
    timeout: by('timeout'),
    open: ts.length - c.length,
    thin: c.length < 30,
  };
}

/* 度量与汇总：信号（按类型和方向，对比同方向的“每根都做”基准）、评分（分组、秩相关、状态）、情景（模拟成交）；
   每项都给全样本、样本内（时间轴前 split）、样本外三列 */
function btReport(all, run) {
  const o = run.opts,
    B = all[o.tf],
    H = o.hs,
    cut = run.steps.length ? run.steps[Math.floor(run.steps.length * o.split)].ts : Infinity,
    part = (a, f) => ({ all: f(a), is: f(a.filter(e => e.ts < cut)), oos: f(a.filter(e => e.ts >= cut)) });
  /* 基准：每一根都按某方向持有 h 根的收益 */
  const base = {};
  for (const h of H)
    base[h] = part(run.steps, a => {
      const up = a.map(s => btFwd(B, s.i, h, 1, s.atr)).filter(Boolean);
      return { up: mstat(up.map(f => f.r)), n: up.length };
    });
  /* 信号 */
  for (const g of run.sigs) g.f = Object.fromEntries(H.map(h => [h, btFwd(B, g.i, h, g.dir, g.atr)]));
  const types = [...new Set(run.sigs.map(g => g.t))],
    sig = types.map(t => {
      const es = run.sigs.filter(g => g.t === t),
        dir = es[0].dir,
        row = { t, dir, n: es.length, h: {} };
      for (const h of H) row.h[h] = part(es, a => btGroup(a.map(g => g.f[h] && g.f[h].r)));
      const h5 = H.includes(5) ? 5 : H[H.length - 1];
      row.with = btGroup(es.filter(g => g.want === g.dir).map(g => g.f[h5] && g.f[h5].r));
      row.against = btGroup(es.filter(g => g.want === -g.dir).map(g => g.f[h5] && g.f[h5].r));
      row.flat = btGroup(es.filter(g => !g.want).map(g => g.f[h5] && g.f[h5].r));
      row.near = btGroup(es.filter(g => g.near).map(g => g.f[h5] && g.f[h5].r));
      const hx = H[H.length - 1],
        fs = es.map(g => g.f[hx]).filter(Boolean);
      row.mfe = mstat(fs.map(f => f.mfe)).mean;
      row.mae = mstat(fs.map(f => f.mae)).mean;
      return row;
    });
  /* 评分：按分数分组的后续涨跌（以 ATR 计，正 = 上涨）；分数与后续涨跌的秩相关；状态（v = ±1）按方向的表现 */
  const BK = [0, 20, 35, 50, 65, 80, 101],
    hz = H.filter(h => h >= 5),
    sc = { buckets: [], rho: {}, rhoRaw: {}, state: {} };
  for (let b = 0; b < BK.length - 1; b++) {
    const es = run.steps.filter(s => s.s >= BK[b] && s.s < BK[b + 1]),
      row = { lo: BK[b], hi: Math.min(100, BK[b + 1] - 1), n: es.length, h: {} };
    for (const h of hz) row.h[h] = btGroup(es.map(s => (btFwd(B, s.i, h, 1, s.atr) || {}).r ?? null));
    sc.buckets.push(row);
  }
  for (const h of hz) {
    const es = run.steps.map(s => [s, btFwd(B, s.i, h, 1, s.atr)]).filter(([, f]) => f);
    sc.rho[h] = part(
      es.map(([s, f]) => ({ ts: s.ts, s: s.s, raw: s.raw, r: f.r })),
      a => ({
        s: spearman(
          a.map(e => e.s),
          a.map(e => e.r)
        ),
        raw: spearman(
          a.map(e => e.raw),
          a.map(e => e.r)
        ),
        n: a.length,
      })
    );
    sc.state[h] = {
      long: btGroup(run.steps.filter(s => s.v > 0).map(s => (btFwd(B, s.i, h, 1, s.atr) || {}).r ?? null)),
      short: btGroup(run.steps.filter(s => s.v < 0).map(s => (btFwd(B, s.i, h, -1, s.atr) || {}).r ?? null)),
      flat: run.steps.filter(s => !s.v).length,
    };
  }
  /* 情景：模拟成交后按类型、顺逆大周期、盈亏比分组 */
  for (const tr of run.trades) tr.out = btSim(B, tr, o);
  const grp = (f, names) =>
      Object.entries(names)
        .map(([k, name]) => ({ k, name, ...btTrades(run.trades.filter(t => String(f(t)) === k)) }))
        .filter(g => g.n || g.open),
    kinds = [...new Set(run.trades.map(t => t.kind))];
  const sce = {
    all: part(run.trades, btTrades),
    kind: grp(t => t.kind, Object.fromEntries(kinds.map(k => [k, k]))),
    align: grp(t => t.align, { 1: '顺大周期', '-1': '逆大周期', 0: '大周期震荡' }),
    /* 方向 × 顺逆：牛市里“顺势”几乎都是做多，只有分开看做空一侧，才能区分“顺势有效”和“牛市做多有效” */
    dirAlign: grp(t => (t.dir > 0 ? 'L' : 'S') + t.align, {
      L1: '做多·顺大周期',
      S1: '做空·顺大周期',
      'L-1': '做多·逆大周期',
      'S-1': '做空·逆大周期',
      L0: '做多·大周期震荡',
      S0: '做空·大周期震荡',
    }),
    rr: grp(t => (t.rr < 1.5 ? 'a' : t.rr < 2.5 ? 'b' : 'c'), { a: '盈亏比 < 1.5', b: '1.5–2.5', c: '≥ 2.5' }),
    list: run.trades.map(t => ({
      ts: t.ts,
      kind: t.kind,
      dir: t.dir,
      entry: t.entry,
      stop: t.stop,
      tgt: t.tgt,
      rr: t.rr,
      align: t.align,
      ...t.out,
    })),
  };
  /* 同期涨跌：回放区间第一根到最后一根（设了 to 时不含区间之后用于结算的K线） */
  const first = B[run.steps.length ? run.steps[0].i : 0],
    lastB = B[run.steps.length ? run.steps[run.steps.length - 1].i : B.length - 1];
  return {
    tf: o.tf,
    opts: o,
    from: run.steps.length ? run.steps[0].ts : null,
    to: run.steps.length ? run.steps[run.steps.length - 1].ts : null,
    cut,
    steps: run.steps.length,
    sceDays: new Set(run.trades.map(t => t.i)).size,
    hold: first && lastB ? (lastB.close / first.close - 1) * 100 : null,
    base,
    sig,
    score: sc,
    sce,
  };
}
