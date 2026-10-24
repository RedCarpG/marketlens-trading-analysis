/* 点击高亮（信号 / 交易）与定位 */
/* 点击“近期信号”：定位并用竖条高亮该K线，自动打开相关指标；信号靠近关键价位时加粗标出该价位。再点一次取消 */
/* 高亮的统一规则：再点当前选中的那一项取消；点别的项先清除上一个。hlSel 为选中项的 key（s|信号、o|持仓、c|已平仓） */
/* hlAuto：高亮信号时为它临时打开的指标，取消高亮时自动关回；高亮期间用户自己点了这个指标，就交给用户、不再自动关 */
/* hlTxt / hlLoc：图表标题右侧“选中项”显示的文字，和点它时重新定位的函数（信号只平移，交易平移并缩放） */
let hlSel = null,
  hlAuto = null,
  hlTxt = '',
  hlLoc = null,
  hlFx = [],
  fxAnim = 0;
function clearHl() {
  chart.removeOverlay({ groupId: 'hlx' });
  hlFx = [];
  fxAnim++;
  hlSel = null;
  hlLoc = null;
  fitAnim++;
  if (hlAuto && on[hlAuto]) tog(hlAuto);
  hlAuto = null;
  markSel();
}
/* fromChart：从图上点击触发时，把右侧列表里对应的行滚到可见 */
function hlSig(g, fromChart) {
  let mv = 0;
  const key = 's|' + g.ts + '|' + g.t;
  if (hlSel === key) return clearHl();
  clearHl();
  hlSel = key;
  hlTxt = `${g.dir > 0 ? '▲' : '▼'} ${g.t} · ${fmt(tf, g.ts)}`;
  const ind = SIGIND[SHORT[g.t]];
  if (ind && !on[ind]) {
    tog(ind);
    hlAuto = ind;
  }
  const b = bars[g.i],
    x = lastM.t.a.a,
    px = g.dir > 0 ? b.low : b.high,
    near = lastM.L.find(l => Math.abs(l.p - px) <= x * 0.5),
    A = cssv('--ac');
  hlBands(b.timestamp, b.close);
  /* “信号箭头”标注关着时，临时画出这个信号的箭头 */
  if (!MK.ar)
    chart.createOverlay({
      name: 'fbArrow',
      groupId: 'hlx',
      lock: true,
      points: [{ timestamp: b.timestamp, value: px }],
      extendData: {
        dir: g.dir,
        color: g.dir > 0 ? cssv('--up') : cssv('--dn'),
        tc: cssv('--mu'),
        text: SHORT[g.t] || g.t,
      },
    });
  if (near)
    hlOv({
      name: 'fbLine',
      points: [{ timestamp: b.timestamp, value: near.p }],
      extendData: { color: A, size: 2, left: 1, text: `相关价位 ${near.tfs.join('·')} ${near.p.toFixed(cur.p)}` },
    });
  hlLoc = () => ensureVisible(g.i);
  mv = hlLoc();
  markSel(fromChart);
  /* 指标上的触发点：相关指标刚被打开时结果要等图表库算完，也等定位平移结束再画，随后一起闪烁 */
  const wait = Math.max(mv, 140);
  setTimeout(() => hlSel === key && sigDot(g), wait);
  flashHl(wait + 20);
}
/* 同步右侧列表的选中样式和“选中项”提示。reveal（从图上或复盘面板点选）：切到列表项所在的标签页、展开它所在的块，再滚到可见 */
function markSel(reveal) {
  let hit = null;
  document.querySelectorAll('#pn [data-key]').forEach(e => {
    const on = e.dataset.key === hlSel;
    e.classList.toggle('on', on);
    if (on) hit = e;
  });
  if (hit && reveal) {
    const p = hit.closest('.tabp'),
      d = hit.closest('details');
    if (p && !p.classList.contains('on')) setTab(p.dataset.p);
    const wait = d && !d.open;
    if (wait) d.open = true;
    setTimeout(() => hit.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), wait ? 280 : 30);
  }
  const sp = $('#selp');
  if (hlSel) {
    const st = sp.querySelector('.selt');
    st.textContent = hlTxt;
    st.title = hlTxt + '（点击重新定位）';
  }
  sp.classList.toggle('on', !!hlSel);
}
/* 点击交易：竖条高亮开仓（和平仓）所在K线并定位 */
function hlTrade(t, key, fromChart) {
  let mv = 0;
  if (hlSel === key) return clearHl();
  clearHl();
  hlSel = key;
  hlTxt = `${t.isBuy ? '▲ 买' : '▼ 卖'} @${t.openRate.toFixed(cur.p)} · ${fmt('1h', t.openTs)}${key[0] == 'o' ? ' · 持仓中' : ''}`;
  const A = cssv('--ac');
  /* “我的交易”标注关着时，临时画出这一笔（随高亮一起清除） */
  if (!MK.tr) {
    const r = trMarks(t, key[0] == 'o');
    r.items.forEach(i => chart.createOverlay({ ...i, groupId: 'hlx', lock: true }));
    if (r.labs.length)
      chart.createOverlay({
        name: 'fbLabels',
        groupId: 'hlx',
        lock: true,
        points: r.labs.map(l => ({ timestamp: bars[bars.length - 1].timestamp, value: l.v })),
        extendData: { labs: r.labs, bg: cssv('--pn') },
      });
  }
  [t.openTs, t.closeTs].forEach(x => {
    const s = x && snapTs(x);
    if (s) hlBands(s, t.openRate);
  });
  /* 定位范围：已平仓为开仓到平仓，持仓为开仓到最新K线 */
  const ix = ts => (ts ? bars.findIndex(b => b.timestamp === ts) : -1),
    i1 = ix(snapTs(t.openTs)),
    i2 = t.closeTs ? ix(snapTs(t.closeTs)) : bars.length - 1;
  if (i1 >= 0) {
    hlLoc = () => fitRange(i1, Math.max(i1, i2));
    mv = hlLoc();
  }
  markSel(fromChart);
  flashHl(mv);
}
/* 选中交易时平移并缩放，让这笔交易（开仓到平仓）在画面里不过大也不过小：
   - 目标约占主图宽度的 35%；每根K线不超过 14px（很短的交易不会被放得过大），一般不小于 2.5px；
     很长的交易在 2.5px 时仍超过宽度 60% 的，继续缩小（最小 1px）到占 60%，前后都留出走势；
   - 当前缩放与理想值相差不到 1.6 倍就不缩放，只按 ensureVisible 平移，避免在时长相近的交易之间来回缩放；
   - 缩放时交易中点放到可见区域 62% 处（中间偏右，左侧多留些开仓前的走势）；靠近最新K线时让最新K线至少在 78% 处，右侧不留大片空白；
   - 缩放和平移在约 0.36 秒内同步过渡；拖动、滚轮、取消选中或切换周期时停止 */
let fitAnim = 0;
function fitRange(a, b, frac = 0.35) {
  const X = i =>
      chart.convertToPixel({ timestamp: bars[i].timestamp, value: bars[i].close }, { paneId: 'candle_pane' }).x,
    w = chart.getSize('candle_pane', 'main').width,
    L = Math.min(safeL(), w * 0.3),
    W = w - L - Math.min(safeR(), w * 0.4),
    sx = f => L + f * W,
    n = b - a + 1,
    s0 = chart.getBarSpace();
  let s1 = Math.min(14, (W * frac) / n);
  if (s1 < 2.5) s1 = Math.max(1, Math.min(2.5, (W * Math.max(0.6, frac)) / n));
  if (Math.abs(Math.log(s0 / s1)) < Math.log(1.6)) return ensureVisible(a, b);
  const mid = (a + b) / 2,
    xLast = x => x + (bars.length - 1 - mid) * s1;
  let xT = sx(0.62);
  if (xLast(xT) < sx(0.78)) xT += sx(0.78) - xLast(xT);
  const xc0 = (X(a) + X(b)) / 2,
    id = ++fitAnim,
    t0 = performance.now();
  const step = now => {
    if (id !== fitAnim) return;
    const p = Math.min(1, (now - t0) / 360),
      e = 1 - Math.pow(1 - p, 3);
    chart.setBarSpace(s0 * Math.pow(s1 / s0, e));
    chart.scrollByDistance(xc0 + (xT - xc0) * e - (X(a) + X(b)) / 2);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return 380;
}
/* 高亮定位按主图的实际像素计算（按K线根数估算会受右侧留白影响，偏差很大）：
   已在 8%–80% 宽度内就不动（右侧常被价位标签挡住，太贴左边缘也看不清）；超出左侧 → 放到 62% 处（中间偏右）；超出右侧 → 放到 70% 处；
   开平仓跨度超过半屏 → 中点放到 60%。scrollByDistance(d) 实测让目标右移 d 像素 */
function ensureVisible(a, b = a) {
  const X = i =>
      chart.convertToPixel({ timestamp: bars[i].timestamp, value: bars[i].close }, { paneId: 'candle_pane' }).x,
    w = chart.getSize('candle_pane', 'main').width,
    L = Math.min(safeL(), w * 0.3),
    W = w - L - Math.min(safeR(), w * 0.4),
    sx = f => L + f * W,
    xa = X(a),
    xb = X(b);
  let d = 0;
  if (xb - xa > W * 0.5) d = sx(0.6) - (xa + xb) / 2;
  else if (xa < sx(0.08)) d = sx(0.62) - xa;
  else if (xb > sx(0.8)) d = sx(0.7) - xb;
  if (Math.abs(d) > 1)
    try {
      chart.scrollByDistance(d, 300);
      return 320;
    } catch (_) {}
  return 0;
}
/* 关键价位、价格行为情景的高亮（与信号/交易同一套选中规则，再点取消）：
   价位：加粗横线标出；找本周期上一次触及它的K线（影线在 0.25 ATR 内，跳过最近 5 根正在发生的走势），
   不另外标K线，而是缩放到上一次触及和最新K线同在画面里（约占可见区域 80%），能对照当时和现在；
   情景：有触发时竖条标出触发K线，从触发K线起画入场（实线）、止损（橙色虚线）、目标（虚线）并定位；没有触发时同价位处理（区间卡片标出上下沿） */
function lastTouch(p) {
  const x = lastM.t.a.a * 0.25;
  for (let i = bars.length - 6; i >= 0; i--) if (bars[i].low - x <= p && bars[i].high + x >= p) return i;
  return -1;
}
/* 让上一次触及到最新K线都在画面里 */
const fitTouch = i => fitRange(i, bars.length - 1, 0.8);
function hlMark(ps, key, txt) {
  if (hlSel === key) return clearHl() || false;
  clearHl();
  hlSel = key;
  hlTxt = txt;
  const A = cssv('--ac'),
    ts = bars[bars.length - 1].timestamp;
  ps.forEach(p => hlOv({ name: 'fbLine', points: [{ timestamp: ts, value: p }], extendData: { color: A, size: 2 } }));
  return true;
}
function hlLevel(l, fromChart) {
  let mv = 0;
  if (!l) return;
  const f = v => v.toFixed(cur.p),
    i = lastTouch(l.p);
  if (
    !hlMark(
      [l.p],
      'l|' + l.p,
      `${l.side > 0 ? '支撑' : '阻力'} ${f(l.p)}${i >= 0 ? ' · 上次触及 ' + fmt(tf, bars[i].timestamp) : ''}`
    )
  )
    return;
  if (i >= 0) {
    hlLoc = () => fitTouch(i);
    mv = hlLoc();
  }
  markSel(fromChart);
  flashHl(mv);
}
function hlScene(c, fromChart) {
  let mv = 0;
  if (!c) return;
  const f = v => v.toFixed(cur.p),
    key = 'v|' + c.k + '|' + (c.k == 'Z' ? c.lo.p : c.lv.p),
    g = c.trigs[0],
    lv = c.k == 'Z' ? [c.lo.p, c.hi.p] : [c.lv.p];
  if (!g) {
    const i = lastTouch(lv[lv.length - 1]);
    if (
      !hlMark(
        lv,
        key,
        c.k == 'Z' ? `区间 ${f(c.lo.p)} – ${f(c.hi.p)}` : `${c.k == 'S' ? '支撑' : '阻力'}情景 ${f(c.lv.p)}`
      )
    )
      return;
    if (i >= 0) {
      hlLoc = () => fitTouch(i);
      mv = hlLoc();
    }
    markSel(fromChart);
    return flashHl(mv);
  }
  if (
    !hlMark([], key, `${g.dir > 0 ? '▲' : '▼'} ${g.kind}${g.dir > 0 ? '做多' : '做空'} · ${fmt(tf, g.ts)} · ${g.state}`)
  )
    return;
  const i = bars.findIndex(b => b.timestamp === g.ts),
    A = cssv('--ac');
  [
    [g.entry, A, 0],
    [g.stop, '#d9822b', 'dash'],
    [g.tgt, A, 'dash'],
  ].forEach(([v, color, dash]) =>
    hlOv({ name: 'fbLine', points: [{ timestamp: g.ts, value: v }], extendData: { color, size: 1.5, ray: 1, dash } })
  );
  if (i >= 0) {
    hlBands(g.ts, g.entry);
    hlLoc = () => ensureVisible(i);
    mv = hlLoc();
  }
  markSel(fromChart);
  flashHl(mv);
}
/* ===== 高亮图形与闪烁 =====
   hlOv：画一个随高亮一起清除的图形，并记下它的初始样式，供 flashHl 闪烁。
   hlBands：竖条同时画在主图和所有打开的副图（MACD、RSI 等）上，指标里也能看到选中的是哪根K线。
   flashHl：选中后约 0.9 秒内闪三下——竖条加深、横线加粗、圆点放大，然后回到常态 */
function hlOv(o, paneId) {
  const id = chart.createOverlay({ ...o, groupId: 'hlx', lock: true }, paneId);
  if (id) hlFx.push({ id, e: o.extendData });
  return id;
}
function hlBands(ts, v) {
  const A = cssv('--ac');
  hlOv({ name: 'fbVBand', points: [{ timestamp: ts, value: v }], extendData: { color: A, a: 36, line: 1 } });
  INDS.filter(n => on[n] && !MAIN.includes(n)).forEach(n =>
    hlOv({ name: 'fbVBand', points: [{ timestamp: ts, value: 0 }], extendData: { color: A, a: 30, line: 1 } }, 'p_' + n)
  );
}
/* 信号对应指标上的触发点：EMA 金叉/死叉标在 EMA20 上，布林突破标在上/下轨，MACD 转正/转负标在柱子上，RSI 标在 RSI 线上 */
const SIGDOT = {
  金叉: ['EMA', 'ema1'],
  死叉: ['EMA', 'ema1'],
  破上轨: ['BOLL', 'up'],
  破下轨: ['BOLL', 'dn'],
  MACD转正: ['MACD', 'macd'],
  MACD转负: ['MACD', 'macd'],
  RSI回升: ['RSI', 'rsi1'],
  RSI回落: ['RSI', 'rsi1'],
};
function sigDot(g) {
  const m = SIGDOT[SHORT[g.t]];
  if (!m || !on[m[0]]) return;
  const pid = MAIN.includes(m[0]) ? 'candle_pane' : 'p_' + m[0],
    ind = chart.getIndicatorByPaneId(pid, m[0]),
    v = ind && ind.result[g.i] && ind.result[g.i][m[1]];
  if (v == null || isNaN(v)) return;
  const id = hlOv(
    {
      name: 'fbDot',
      points: [{ timestamp: bars[g.i].timestamp, value: v }],
      extendData: { color: g.dir > 0 ? cssv('--up') : cssv('--dn'), r: 4 },
    },
    pid
  );
  if (id && !fxWait) flashHl();
}
/* 闪烁要等定位的平移/缩放结束再开始（delay = 移动所需毫秒）：两者同时进行时，每帧改图形样式会让标注层的重绘排到平移那一帧之后，
   标注就比K线慢一帧、看起来是K线先动标注后动 */
let fxWait = 0;
function flashHl(delay = 0) {
  const tok = ++fxAnim;
  if (delay > 0) {
    fxWait = 1;
    return setTimeout(() => {
      if (tok !== fxAnim) return;
      fxWait = 0;
      flashHl();
    }, delay);
  }
  fxWait = 0;
  const t0 = performance.now(),
    items = hlFx.slice();
  const step = now => {
    if (tok !== fxAnim) return;
    const p = Math.min(1, (now - t0) / 900),
      f = Math.abs(Math.sin(p * Math.PI * 3)) * (1 - p * 0.6) * (p < 1 ? 1 : 0);
    items.forEach(({ id, e }) => {
      const x = { ...e };
      if (e.a != null) x.a = e.a + (170 - e.a) * f;
      else if (e.r != null) x.r = e.r + 5 * f;
      else if (e.size != null) x.size = e.size + 2.5 * f;
      chart.overrideOverlay({ id, extendData: x });
    });
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
