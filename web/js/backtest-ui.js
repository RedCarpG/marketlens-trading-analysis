/* 回测面板：入口在“价格行为情景”块标题的“回测”按钮（快捷键 B）。
   用当前品种已加载的K线（当前数据源）逐根回放：每根收盘时只用当时已收盘的K线，按页面同一套规则算情景、信号、评分，
   再用之后的K线模拟成交。计算在后台线程（bt-worker.js）里跑，不卡页面；不支持线程时（如直接打开 HTML 文件）在主线程跑。
   点交易明细里的一行：关闭面板，在图上标出这笔回测交易。方法和结论见 docs/BACKTEST.md。 */
let BTR = null,
  btW = null;
const BTO = { tf: '1d', sc: 'now', exit: 'page', bias: 'ema', cost: '', ...LS.get('bt', {}) },
  BT_SC = { now: ['当前规则', null], old: ['收紧前', { loose: 1, htf: 0, cool: 0 }] },
  BT_EXITS = {
    page: ['页面目标', null],
    trail: ['移动止损', { tgtR: 0, trail: 2 }],
    hold: ['持有10根', { tgtR: 0, hold: 10 }],
    t1: ['目标1R', { tgtR: 1 }],
    be: ['1R保本', { be: 1 }],
  },
  BT_BIAS = { ema: '均线', struct: '摆动结构', fast: '快均线' },
  BT_COSTN = { none: '不计', gold: '黄金', btc: '比特币' },
  BT_MIN = 400; // 入场周期至少要这么多根（预热 150 根之后还要有足够的样本）
/* 成本默认按品种：比特币用 btc，模拟数据不计，其余按黄金估 */
const btCost = () => BTO.cost || (/BTC/.test(cur.sym) ? 'btc' : cur.src == 'demo' ? 'none' : 'gold');

function openBacktest() {
  let el = $('#btm');
  if (!el) {
    el = document.createElement('div');
    el.id = 'btm';
    document.body.appendChild(el);
    el.onclick = e => {
      if (e.target === el || e.target.closest('[data-bt-close]')) return closeBacktest();
      const o = e.target.closest('[data-bto]');
      if (o && !o.disabled) {
        const [k, v] = o.dataset.bto.split(':');
        if (BTO[k] === v) return;
        BTO[k] = v;
        LS.set('bt', BTO);
        return runBacktest();
      }
      const row = e.target.closest('tr[data-bt]');
      if (row && BTR) hlBt(BTR.res.list[+row.dataset.bt], 'b|' + row.dataset.bt);
    };
    document.addEventListener('keydown', e => e.key === 'Escape' && closeBacktest());
  }
  void el.offsetWidth; // 刚创建时先排版一次，淡入过渡才会生效
  el.classList.add('open');
  runBacktest();
}
function closeBacktest() {
  const el = $('#btm');
  if (el) el.classList.remove('open');
}

/* 选项行：每组一排分段按钮 */
function btOpts() {
  const seg = (k, label, opts, dis = {}) =>
    `<div class="bto"><span class="mu sm">${label}</span><div class="seg">${Object.entries(opts)
      .map(
        ([v, n]) =>
          `<button data-bto="${k}:${v}" class="${(k == 'cost' ? btCost() : BTO[k]) == v ? 'on' : ''}"${dis[v] ? ` disabled title="${dis[v]}"` : ''}>${Array.isArray(n) ? n[0] : n}</button>`
      )
      .join('')}</div></div>`;
  const tfs = { '1d': '1d', '4h': '4h', '1h': '1h' },
    dis = {};
  for (const k in tfs) if (!ALL[k] || ALL[k].length < BT_MIN) dis[k] = `当前数据源的 ${k} 不足 ${BT_MIN} 根`;
  return `<div class="btos">${seg('tf', '入场周期', tfs, dis)}${seg('sc', '情景规则', BT_SC)}${seg('exit', '出场', BT_EXITS)}${seg('bias', '大周期方向', BT_BIAS)}${seg('cost', '成本', BT_COSTN)}</div>`;
}
function btHead(extra = '') {
  return `<div class="rvh"><b>回测 · ${cur.name} · ${SRCN[cur.src] || ''}${extra}</b><button data-bt-close>✕</button></div>`;
}

function runBacktest() {
  const el = $('#btm');
  if (!el || !bars.length) return;
  if (cur.src == 'csv') {
    el.innerHTML = `<div class="rvp">${btHead()}<div class="mu">CSV 只有一个周期，没有大周期，无法按页面规则回测。</div></div>`;
    return;
  }
  if (!ALL[BTO.tf] || ALL[BTO.tf].length < BT_MIN)
    BTO.tf = ['1d', '4h', '1h'].find(k => ALL[k] && ALL[k].length >= BT_MIN) || '1d';
  const T = BTO.tf,
    B = ALL[T];
  if (!B || B.length < BT_MIN) {
    el.innerHTML = `<div class="rvp">${btHead()}${btOpts()}<div class="mu">当前数据源的K线不够回测（入场周期至少 ${BT_MIN} 根）。可在设置 → 数据源里换成历史更长的服务。</div></div>`;
    return;
  }
  const sc = BT_SC[BTO.sc][1],
    cost = btCost(),
    job = {
      all: Object.fromEntries(
        TFS.slice(TFS.indexOf(T))
          .filter(k => ALL[k])
          .map(k => [k, ALL[k]])
      ),
      opts: {
        tf: T,
        sc: sc && { ...SC_DEF, ...sc },
        bias: BTO.bias == 'ema' ? null : BTO.bias,
        exit: BT_EXITS[BTO.exit][1],
      },
      cost: BT_COSTS[cost] || null,
    },
    key = [cur.sym, cur.src, T, B.length, B[B.length - 1].timestamp, BTO.sc, BTO.exit, BTO.bias, cost].join('|');
  if (BTR && BTR.key === key) return renderBacktest();
  const busy = p =>
    (el.innerHTML = `<div class="rvp">${btHead(` · ${T}`)}${btOpts()}<div class="btprog"><i style="width:${Math.round(p * 100)}%"></i></div><div class="mu sm">正在逐根回放 ${B.length.toLocaleString()} 根 ${T} K线… ${Math.round(p * 100)}%</div></div>`);
  busy(0);
  const done = res => {
    BTR = { key, res, cost };
    renderBacktest();
  };
  const fail = msg =>
    (el.innerHTML = `<div class="rvp">${btHead()}${btOpts()}<div class="mu">回测出错：${msg}</div></div>`);
  /* 主线程兜底：先让“正在回放”画出来再算 */
  const local = () =>
    setTimeout(() => {
      try {
        done(btPage(job));
      } catch (e) {
        fail(e.message);
      }
    }, 30);
  if (btW) btW.terminate();
  try {
    btW = new Worker('js/bt-worker.js');
  } catch {
    btW = null;
    return local();
  }
  let last = 0;
  btW.onmessage = e => {
    const m = e.data;
    if (m.prog != null) {
      if (m.prog - last > 0.02) busy((last = m.prog));
    } else if (m.err) fail(m.err);
    else done(m.done);
  };
  btW.onerror = e => {
    e.preventDefault();
    btW = null;
    local();
  };
  btW.postMessage(job);
}

function renderBacktest() {
  const r = BTR.res,
    el = $('#btm');
  if (!el) return;
  const f2 = v => (v == null || Number.isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2)),
    dc = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : 'var(--mu)'),
    ci = g => (g && g.n ? `${f2(g.mean)} <span class="mu sm">[${f2(g.lo)}, ${f2(g.hi)}]</span>` : '—'),
    pct = w => (w ? Math.round(w.p * 100) + '%' : '—'),
    fp = v => v.toFixed(cur.p),
    a = r.sce.all.all,
    yrs = Math.max(0.1, (r.to - r.from) / 864e5 / 365.25),
    thin = g => (g.thin ? '<span class="mu">*</span>' : '');
  /* 资金曲线：按出场时间累计净 R；虚线为样本内 / 样本外分界 */
  const done = r.list.filter(t => t.R != null).sort((x, y) => x.exitTs - y.exitTs),
    W = 1000,
    H = 150;
  let eq = 0;
  const pts = done.map(t => [t.exitTs, (eq += t.R)]),
    ys = [0, ...pts.map(p => p[1])],
    lo = Math.min(...ys),
    hi = Math.max(...ys),
    X = ts => ((ts - r.from) / Math.max(1, r.to - r.from)) * W,
    Y = v => H - 8 - ((v - lo) / Math.max(1e-9, hi - lo)) * (H - 16),
    line = `M0 ${Y(0)} ` + pts.map(([t, v]) => `L${X(t).toFixed(1)} ${Y(v).toFixed(1)}`).join(' '),
    svg = pts.length
      ? `<svg class="bteq" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" class="z"/>${r.cut < r.to ? `<line x1="${X(r.cut)}" x2="${X(r.cut)}" y1="0" y2="${H}" class="c"/>` : ''}
<path d="${line}" class="l" style="stroke:${dc(eq)}"/></svg>
<div class="bteql mu sm"><span>${fmt(r.tf, r.from)}</span><span>累计 ${f2(eq)}R · 最高 ${f2(hi)} · 最低 ${f2(lo)}${r.cut < r.to ? ` · 虚线后为样本外（${fmt(r.tf, r.cut)} 起）` : ''}</span><span>${fmt(r.tf, r.to)}</span></div>`
      : '<div class="mu">这段时间没有触发情景。</div>';
  /* 分组表：笔数、胜率、平均R（* 为不足 30 笔） */
  const gt = (title, gs) =>
    `<div><div class="mu sm">${title}</div><table><tr><th></th><th>笔数</th><th>胜率</th><th>平均R</th></tr>${gs
      .map(
        g =>
          `<tr><td>${g.name}</td><td>${g.n}</td><td>${pct(g.hit)}</td><td style="color:${dc(g.mean)}">${f2(g.mean)}${thin(g)}</td></tr>`
      )
      .join('')}</table></div>`;
  const part = [
      { name: '全部', ...a },
      { name: '样本内', ...r.sce.all.is },
      { name: '样本外', ...r.sce.all.oos },
    ],
    exits = [
      ['目标', a.target],
      ['止损', a.stop],
      ['移动止损/保本', a.trail],
      ['超时', a.timeout],
    ];
  const sigs = r.sig
    .slice()
    .sort((x, y) => y.n - x.n)
    .map(s => {
      const h = s.h[5];
      return `<tr><td>${s.t}</td><td style="color:${dc(s.dir)}">${s.dir > 0 ? '多' : '空'}</td><td>${s.n}</td><td>${pct(h.all.hit)}</td><td style="color:${dc(h.all.mean)}">${f2(h.all.mean)}${thin(h.all)}</td><td>${h.all.n && r.base5 != null ? f2(h.all.mean - r.base5 * s.dir) : '—'}</td><td>${f2(h.is.mean)}</td><td>${f2(h.oos.mean)}</td></tr>`;
    })
    .join('');
  const sc = r.score,
    st = sc.state[10],
    buckets = sc.buckets
      .map(
        b =>
          `<tr><td>${b.lo}–${b.hi}</td><td>${b.n}</td><td style="color:${dc(b.h[10].mean)}">${f2(b.h[10].mean)}</td><td>${pct(b.h[10].hit)}</td></tr>`
      )
      .join('');
  const rows = r.list
    .map((t, i) => [t, i])
    .reverse()
    .map(
      ([t, i]) =>
        `<tr data-bt="${i}"><td>${fmt(r.tf, t.ts)}</td><td style="color:${dc(t.dir)}">${t.dir > 0 ? '▲ 多' : '▼ 空'}</td><td>${t.kind}</td>
<td>${fp(t.entry)} / ${fp(t.stop)} / ${fp(t.tgt)}</td><td>${t.align > 0 ? '顺' : t.align < 0 ? '逆' : '—'}</td>
<td>${{ target: '目标', stop: '止损', trail: '移动/保本', timeout: '超时', open: '未结束' }[t.res] || t.res}</td><td>${t.bars ?? '—'}</td><td style="color:${dc(t.R)}">${t.R == null ? '—' : f2(t.R)}</td></tr>`
    )
    .join('');
  el.innerHTML = `<div class="rvp">
${btHead(` · ${r.tf} · ${fmt(r.tf, r.from)} → ${fmt(r.tf, r.to)}（${r.steps.toLocaleString()} 根）`)}
${btOpts()}
<div class="rvs"><div><span class="mu sm">情景</span><b>${a.n}</b><span class="mu sm">笔 · 每年 ${(a.n / yrs).toFixed(0)}</span></div>
<div><span class="mu sm">胜率</span><b>${pct(a.hit)}</b></div>
<div><span class="mu sm">平均 R（${BT_COSTN[BTR.cost]}成本）</span><b style="color:${dc(a.mean)}">${f2(a.mean)}</b><span class="mu sm">[${f2(a.lo)}, ${f2(a.hi)}] · 不计成本 ${f2(r.gross.mean)}</span></div>
<div><span class="mu sm">累计</span><b style="color:${dc(a.total)}">${f2(a.total)}R</b><span class="mu sm">最大回撤 ${a.dd == null ? '—' : a.dd.toFixed(1)}R</span></div>
<div><span class="mu sm">同期涨跌</span><b>${f2(r.hold)}%</b></div></div>
${svg}
<div class="rvg">${gt('按类型', r.sce.kind)}${gt('方向 × 大周期', r.sce.dirAlign)}${gt('样本内 / 外', part)}<div><div class="mu sm">出场方式</div><table>${exits.map(([n, v]) => `<tr><td>${n}</td><td>${v}</td></tr>`).join('')}</table><div class="mu sm" style="margin-top:6px">平均持仓 ${a.bars == null ? '—' : a.bars.toFixed(1)} 根${a.open ? ` · ${a.open} 笔到数据末尾未结束` : ''}</div></div></div>
<div class="rvg"><div style="grid-column:span 2"><div class="mu sm">信号（之后 5 根，单位 ATR；净优势 = 减去每根都同向持有的基准）</div><table><tr><th>信号</th><th>方向</th><th>次数</th><th>命中</th><th>均值</th><th>净优势</th><th>样本内</th><th>样本外</th></tr>${sigs}</table></div>
<div><div class="mu sm">入场时机评分（之后 10 根）</div><table><tr><th>分数</th><th>根数</th><th>均值</th><th>上涨</th></tr>${buckets}</table>
<div class="mu sm" style="margin-top:6px">秩相关：5 根 ${f2(sc.rho[5].all.s)}，10 根 ${f2(sc.rho[10].all.s)}（样本外 ${f2(sc.rho[10].oos.s)}）<br>偏多 ${st.long.n} 根 均值 ${f2(st.long.mean)}；偏空 ${st.short.n} 根 均值 ${f2(st.short.mean)}（按方向）</div></div></div>
<div class="mu sm" style="margin:10px 0 4px">情景交易明细（新到旧；入场 / 止损 / 目标；点一行在图上查看）</div>
<div class="rvtw btlist"><table class="rvt"><tr><th>触发</th><th>方向</th><th>类型</th><th>入场 / 止损 / 目标</th><th>大周期</th><th>出场</th><th>持仓</th><th>R</th></tr>${rows}</table></div>
<div class="mu sm" style="margin-top:10px">每根K线收盘时只用当时已收盘的K线，按页面同一套规则判断；入场 = 触发K线收盘价；同一根K线止损和目标都触及按先止损；跳空按开盘价成交。成本为估计值。* = 不足 30 笔。回测结果不代表未来表现，不构成投资建议；方法与结论见 docs/BACKTEST.md。</div>
</div>`;
}

/* 在图上标出一笔回测交易：入场到出场的盈亏框、入场和出场K线竖条，并缩放到这段时间 */
function hlBt(t, key) {
  closeBacktest();
  if (tf != BTR.res.tf) setTf(BTR.res.tf);
  if (hlSel === key) return clearHl();
  clearHl();
  hlSel = key;
  const sg = v => (v >= 0 ? '+' : '') + v.toFixed(2),
    [TB, TS] = TRC[DARK[theme] ? 1 : 0];
  hlTxt = `回测 ${t.dir > 0 ? '▲ 做多' : '▼ 做空'} ${t.kind} · ${fmt(tf, t.ts)}${t.R != null ? ` · ${sg(t.R)}R` : ' · 未结束'}`;
  const a = snapTs(t.ts),
    b = t.exitTs ? snapTs(t.exitTs) : bars[bars.length - 1].timestamp,
    px = t.exitPx ?? bars[bars.length - 1].close;
  if (a && b)
    chart.createOverlay({
      name: 'fbTrade',
      groupId: 'hlx',
      lock: true,
      points: [
        { timestamp: a, value: t.entry },
        { timestamp: b, value: px },
      ],
      extendData: {
        buy: t.dir > 0,
        color: t.dir > 0 ? TB : TS,
        pl: (t.R ?? 0) >= 0 ? cssv('--up') : cssv('--dn'),
        text: t.R != null ? sg(t.R) + 'R' : '未结束',
      },
    });
  if (a) hlBands(a, t.entry);
  if (b && t.exitTs) hlBands(b, px);
  let mv = 0;
  const ix = ts => bars.findIndex(x => x.timestamp === ts),
    i1 = ix(a),
    i2 = ix(b);
  if (i1 >= 0) {
    hlLoc = () => fitRange(i1, Math.max(i1, i2));
    mv = hlLoc();
  }
  markSel();
  flashHl(mv);
}
