/* 两项研究（纯计算，浏览器与 Node 共用）：关键价位统计、事件研究。结果只描述过去发生过什么，不是预测，也不是建议。

   ===== 关键价位统计（docs/BACKTEST.md 第 5 节 D）=====
   问的是：价格走到一条“关键价位”时，之后是被挡回的多，还是穿过去的多？和随便一条线比有没有不同？
   做法和回测一样逐根回放：在每根K线收盘时只用“当时已收盘”的K线算出价位（analyzeMTF），价格第一次走进某条线 near 个 ATR 以内
   记一次“触及”（离开 far 个 ATR 后才重新算；第一次见到时已经在里面的不算），然后才用之后的K线判定结果——
   判定用预警记录的同一个函数 lvOutcome（alertlog.js）：之后 n 根内先往回走 1 个 ATR 是“被挡回”，先穿过去 1 个 ATR 是“穿过去”，否则“未定”。
   三类线一起记，才有得比：
     key    关键价位（isKey：多个周期都有、被挡回 3 次以上、或来自更大的周期）
     plain  普通价位（同一套摆动点算出来、但不够“关键”的）
     grid   对照：随便一条过去的收盘价（每隔 gridStep 根取一根的收盘，最近 gridBack 根以内，离任何关键价位 gridGap 个 ATR 以上的）。
            它不是任何规则挑出来的。价格是“走过来”碰到线的，所以随便一条线也是被挡回的略多（起点就在来的那一侧），
            关键价位要明显高过它才算真的更能挡。
   关键价位很密（黄金日线上同时有十几条，约一半的价格都在某一条的 0.25 个 ATR 以内），所以对照线只要求离它们 gridGap 远，
   并且把「有多少时间价格就在关键价位上」（atKey）一起报出来：这个比例越高，「走到关键价位了」这句话本身的信息越少。 */
const LS_DEF = {
  tf: '1d',
  warm: 150,
  win: 600,
  near: 0.25,
  far: 0.5,
  n: 10,
  from: null,
  to: null,
  gridStep: 13,
  gridBack: 300,
  gridGap: 0.25,
};

/* 逐根回放的骨架（和 btRun 一样：大周期的 ctx 只在它出新的收盘K线时重算）。fn(i, m, px, x) 在每根有分析结果的K线收盘时叫一次 */
function stReplay(all, o, fn) {
  const T = o.tf,
    B = all[T] || [],
    tfs = TFS.slice(TFS.indexOf(T)).filter(k => all[k] && all[k].length),
    cache = {};
  for (let i = o.warm; i < B.length; i++) {
    if (o.prog && i % 50 === 0) o.prog(i / B.length);
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
      m = analyzeMTF(T, Cx, px);
    if (m) fn(i, m, px, c.a.a);
  }
}

/* 回放一遍，返回每一次触及：{ i, ts, kind, lp, px, atr, side（1 从上面来 = 在试支撑，-1 从下面来 = 在试阻力）,
   top 来自的最大周期, tfs 参与的周期数, touch 之前被挡回的次数, st（bounce / break / open）, k 第几根 }。
   结果还没走完 n 根的（数据末尾）不记 */
function lvStudy(all, opts = {}) {
  const o = { ...LS_DEF, ...opts },
    T = o.tf,
    B = all[T] || [],
    arm = {},
    touches = [];
  let steps = 0,
    atKey = 0,
    keys = 0;
  stReplay(all, o, (i, m, px, x) => {
    steps++;
    /* 顺手量一下关键价位有多密：这一刻有几条、价格是不是正好在某一条的 near 个 ATR 以内 */
    const K = m.L.filter(l => isKey(l, T));
    keys += K.length;
    if (K.some(l => Math.abs(l.p - px) <= x * o.near)) atKey++;
    const hit = (kind, id, lp, extra) => {
      const d = Math.abs(px - lp);
      if (!armStep(arm, kind + '|' + id, d <= x * o.near, d >= x * o.far)) return;
      const out = lvOutcome({ lp, atr: x, bt: B[i].timestamp, px }, B, o.n);
      if (!out || out.st == 'wait') return;
      touches.push({
        i,
        ts: B[i].timestamp,
        kind,
        lp,
        px,
        atr: x,
        side: px >= lp ? 1 : -1,
        st: out.st,
        k: out.k,
        ...extra,
      });
    };
    for (const l of m.L)
      hit(isKey(l, T) ? 'key' : 'plain', l.p.toFixed(6), l.p, { top: l.top, tfs: l.tfs.length, touch: l.touch });
    /* 对照线：按K线的序号定（序号是 gridStep 的倍数的那些根），所以同一条线一直是同一条；贴着关键价位的不要 */
    for (let j = Math.max(o.warm, Math.ceil((i - o.gridBack) / o.gridStep) * o.gridStep); j < i; j += o.gridStep) {
      const lp = B[j].close;
      if (!m.L.some(l => isKey(l, T) && Math.abs(l.p - lp) < x * o.gridGap))
        hit('grid', String(B[j].timestamp), lp, {});
    }
  });
  return {
    opts: o,
    tf: T,
    steps,
    atKey: steps ? atKey / steps : null,
    keys: steps ? keys / steps : null,
    from: B.length ? B[Math.min(B.length - 1, o.warm)].timestamp : null,
    to: B.length ? B[B.length - 1].timestamp : null,
    touches,
  };
}

/* 一组触及的汇总：n 全部、bounce 被挡回、brk 穿过去、open 未定；rate = 被挡回 ÷（被挡回 + 穿过去），附 Wilson 95% 区间 */
function lvCell(a) {
  const bounce = a.filter(t => t.st == 'bounce').length,
    brk = a.filter(t => t.st == 'break').length,
    w = wilson(bounce, bounce + brk);
  return {
    n: a.length,
    bounce,
    brk,
    open: a.length - bounce - brk,
    rate: w ? w.p : null,
    lo: w ? w.lo : null,
    hi: w ? w.hi : null,
  };
}
/* 分组：三类线；关键价位再按 之前被挡回几次、来自哪个周期、几个周期都有、在试支撑还是阻力 拆开。
   edge：关键价位的被挡回比例减去对照线的（两者的区间不重叠时 sure 为真）。样本少于 30 的组 thin 为真，只当记录看 */
function lvReport(study) {
  const T = study.tf,
    of = f => study.touches.filter(f),
    key = of(t => t.kind == 'key'),
    row = (id, name, a) => ({ id, name, ...lvCell(a), thin: a.length < 30 }),
    kinds = [
      row('key', '关键价位', key),
      row(
        'plain',
        '普通价位',
        of(t => t.kind == 'plain')
      ),
      row(
        'grid',
        '对照：随便一条过去的收盘价',
        of(t => t.kind == 'grid')
      ),
    ],
    [k, , g] = kinds,
    groups = {
      touch: [
        row(
          't0',
          '之前没被挡回过',
          key.filter(t => !t.touch)
        ),
        row(
          't1',
          '被挡回过 1–2 次',
          key.filter(t => t.touch >= 1 && t.touch <= 2)
        ),
        row(
          't3',
          '被挡回过 3 次以上',
          key.filter(t => t.touch >= 3)
        ),
      ],
      top: [
        row(
          'own',
          '只来自本周期',
          key.filter(t => t.top == T)
        ),
        row(
          'htf',
          '来自更大的周期',
          key.filter(t => t.top != T)
        ),
      ],
      tfs: [
        row(
          'one',
          '只有一个周期有',
          key.filter(t => t.tfs <= 1)
        ),
        row(
          'multi',
          '两个以上周期都有',
          key.filter(t => t.tfs >= 2)
        ),
      ],
      side: [
        row(
          'sup',
          '从上面来（在试支撑）',
          key.filter(t => t.side > 0)
        ),
        row(
          'res',
          '从下面来（在试阻力）',
          key.filter(t => t.side < 0)
        ),
      ],
    };
  for (const k2 of Object.keys(groups)) groups[k2] = groups[k2].filter(r => r.n);
  return {
    tf: T,
    n: study.opts.n,
    steps: study.steps,
    /* 关键价位有多密：平均同时有几条；有多少时间收盘价就在某一条的触及范围里 */
    keys: study.keys,
    atKey: study.atKey,
    from: study.from,
    to: study.to,
    kinds,
    groups,
    edge: k.rate != null && g.rate != null ? { diff: k.rate - g.rate, sure: k.lo > g.hi || k.hi < g.lo } : null,
  };
}
/* 汇总成一句话（面板、文档用）。只说过去的比例，不说“所以会怎样” */
function lvText(rep) {
  const [k, , g] = rep.kinds,
    pc = v => Math.round(v * 100) + '%';
  if (!k.n || k.rate == null) return '这段数据里关键价位被碰到的次数太少，没有统计。';
  const cmp =
    g.rate == null
      ? ''
      : rep.edge.sure
        ? `，比随便一条线（${pc(g.rate)}）${rep.edge.diff > 0 ? '高' : '低'}，差距超出了误差范围`
        : `，随便一条线是 ${pc(g.rate)}，两者的差距在误差范围内`;
  return `过去 ${k.n} 次走到关键价位，之后 ${rep.n} 根内分出结果的 ${k.bounce + k.brk} 次里被挡回 ${pc(k.rate)}${cmp}。${k.thin ? '次数不到 30，只当记录看。' : ''}`;
}

/* ===== 事件研究（路线图 B1）=====
   问的是：过去每次非农、CPI、FOMC 公布以后，价格动了多少？和平常同一时刻比大多少？
   用 1 小时K线。公布时刻常在一根K线的中间（美东 8:30 = 一根的第 30 分钟），所以“公布后一小时左右”取两根：
   公布所在的那一根和它的下一根（公布前最多 59 分钟 + 公布后 1–2 小时）。量两样：
     range 这两根的最高价减最低价；move 第二根的收盘减公布那一根的开盘（带方向）。
   对照（base）：公布日之前 baseDays 个有K线的日子里，同一个 UTC 小时起的两根的 range，取中位数；那些日子里有别的重要事件
   落在这两根里的不算。ratio = range ÷ base。另外量当天：公布所在的 UTC 日的最高减最低，和之前 baseDays 天的中位数比（dayRatio）。
   bars：1 小时K线（升序）；events：[{ ts, rel（empsit 非农 / cpi / fomc…）, zh, title }]，只算 ts 落在K线范围内、前面够 minBase 天对照的。 */
const ES_DEF = { baseDays: 40, minBase: 10, rels: ['empsit', 'cpi', 'fomc'] };
const ES_NAME = { empsit: '非农', cpi: 'CPI', fomc: 'FOMC 利率决议' };
const stMedian = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
function evStudy(bars, events, opts = {}) {
  const o = { ...ES_DEF, ...opts },
    H = 36e5,
    D = 864e5,
    at = new Map(bars.map((b, i) => [b.timestamp, i])),
    hot = (events || []).filter(e => typeof e.ts == 'number' && e.imp >= 3),
    /* 一个时刻起的两根：返回 { range, move }；下一根不是紧接着的那一小时（休市、缺K线）返回 null */
    win = t0 => {
      const i = at.get(t0);
      if (i == null) return null;
      const a = bars[i],
        b = bars[i + 1];
      if (!b || b.timestamp - a.timestamp > H) return null;
      return { range: Math.max(a.high, b.high) - Math.min(a.low, b.low), move: b.close - a.open };
    },
    /* 某个 UTC 日的最高减最低 */
    days = new Map();
  for (const b of bars) {
    const d = Math.floor(b.timestamp / D),
      x = days.get(d);
    if (x) {
      x.hi = Math.max(x.hi, b.high);
      x.lo = Math.min(x.lo, b.low);
    } else days.set(d, { hi: b.high, lo: b.low });
  }
  const busy = new Set(hot.map(e => Math.floor(e.ts / H) * H)),
    rows = [];
  for (const e of hot) {
    if (!o.rels.includes(e.rel)) continue;
    const t0 = Math.floor(e.ts / H) * H,
      w = win(t0);
    if (!w) continue;
    const base = [],
      dbase = [];
    for (let k = 1; base.length < o.baseDays && k <= o.baseDays * 2; k++) {
      const t = t0 - k * D;
      /* 那天这两根里有别的重要事件的不当对照 */
      if (busy.has(t) || busy.has(t + H)) continue;
      const b = win(t);
      if (b) base.push(b.range);
    }
    const d0 = Math.floor(e.ts / D);
    for (let k = 1; dbase.length < o.baseDays && k <= o.baseDays * 2; k++) {
      const x = days.get(d0 - k);
      if (x) dbase.push(x.hi - x.lo);
    }
    if (base.length < o.minBase) continue;
    const bm = stMedian(base),
      day = days.get(d0),
      dm = stMedian(dbase);
    rows.push({
      ts: e.ts,
      rel: e.rel,
      name: e.zh || e.title || ES_NAME[e.rel] || e.rel,
      range: w.range,
      move: w.move,
      base: bm,
      ratio: bm > 0 ? w.range / bm : null,
      dayRange: day ? day.hi - day.lo : null,
      dayBase: dm,
      dayRatio: day && dm > 0 ? (day.hi - day.lo) / dm : null,
    });
  }
  /* 同一次公布在日历里可能有几条（非农报告拆成新增、失业率、时薪；FOMC 的声明和半小时后的记者会）：同一类落在同一根K线里的只留一条 */
  const seen = new Set();
  return rows
    .sort((a, b) => a.ts - b.ts)
    .filter(r => !seen.has(r.rel + Math.floor(r.ts / H)) && seen.add(r.rel + Math.floor(r.ts / H)));
}
/* 按事件类型汇总：n 次数，range / ratio / dayRatio 的中位数，ratio 的最小最大，涨跌各几次（按 move 的正负）。
   次数少于 8 的 thin 为真 */
function evReport(rows, rels = ES_DEF.rels) {
  return rels
    .map(rel => {
      const a = rows.filter(r => r.rel == rel),
        rs = a.map(r => r.ratio).filter(v => v != null);
      return {
        rel,
        name: ES_NAME[rel] || rel,
        n: a.length,
        range: stMedian(a.map(r => r.range)),
        ratio: stMedian(rs),
        min: rs.length ? Math.min(...rs) : null,
        max: rs.length ? Math.max(...rs) : null,
        dayRatio: stMedian(a.map(r => r.dayRatio).filter(v => v != null)),
        up: a.filter(r => r.move > 0).length,
        down: a.filter(r => r.move < 0).length,
        from: a.length ? a[0].ts : null,
        thin: a.length < 8,
      };
    })
    .filter(r => r.n);
}
/* 一类事件的一句话（事件卡片、聊天用）：只说过去动了多少，方向只报涨跌各几次，不说“所以会怎样” */
function evText(r, dp = 2) {
  if (!r || !r.n) return '';
  const x = v => v.toFixed(1);
  return `过去 ${r.n} 次${r.name}公布后一小时左右，波幅的中位数是 ${r.range.toFixed(dp)}，是平常同一时刻的 ${x(r.ratio)} 倍（最小 ${x(r.min)} 倍，最大 ${x(r.max)} 倍）；之后 ${r.up} 次是涨的、${r.down} 次是跌的。${r.thin ? '次数少，只当记录看。' : ''}`;
}
