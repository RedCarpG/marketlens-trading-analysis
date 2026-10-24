/* 图上标注：自定义图形注册、单笔交易图形、整体标注绘制 */
/* ===== 图上标注：多周期支撑阻力线、重要信号箭头、参考计划线 ===== */
const SHORT = {
  'EMA20 上穿 EMA50（金叉）': '金叉',
  'EMA20 下穿 EMA50（死叉）': '死叉',
  'MACD 柱由负转正': 'MACD转正',
  'MACD 柱由正转负': 'MACD转负',
  'RSI 自超卖区回升': 'RSI回升',
  'RSI 自超买区回落': 'RSI回落',
  看涨吞没: '看涨吞没',
  看跌吞没: '看跌吞没',
  '锤子线（下影长）': '锤子线',
  '射击之星（上影长）': '射击之星',
  收盘突破布林上轨: '破上轨',
  收盘跌破布林下轨: '破下轨',
};
const KEYSIG = new Set(['金叉', '死叉', '破上轨', '破下轨']); // 这几类总是标出；其余信号只在靠近关键价位时标出
const MKN = { hl: '前高前低', sr: '支撑阻力', ar: '信号箭头', pl: '情景', tr: '我的交易' };
/* “标注”菜单里每个开关前的小图例，与图上画法一致 */
const SW = {
  hl: '<path d="M5 5h17" style="stroke:var(--dn);stroke-dasharray:1.5 3;stroke-width:1.5"/><path d="M5 1l3 4-3 4-3-4z" style="fill:var(--dn)"/>',
  sr: '<rect y="2" width="22" height="6" style="fill:var(--up);opacity:.25"/><path d="M0 5h22" style="stroke:var(--up);stroke-width:1.5"/>',
  ar: '<path d="M6 2l4 7H2z" style="fill:var(--up)"/><path d="M16 8l4-7h-8z" style="fill:var(--dn)"/>',
  pl: '<rect x="1" width="21" height="5" style="fill:var(--up);opacity:.5"/><rect x="1" y="5" width="21" height="5" style="fill:var(--dn);opacity:.5"/><path d="M1 5h21" style="stroke:var(--ac);stroke-width:1.5"/>',
  tr: '<path d="M5 2l4 7H1z" style="fill:var(--tb)"/><path d="M8 6l9-3" style="stroke:var(--up);stroke-width:1.5"/><circle cx="18.5" cy="3" r="2.2" style="fill:none;stroke:var(--up);stroke-width:1.5"/>',
};
/* 点击“近期信号”时自动打开的相关指标 */
const SIGIND = {
  金叉: 'EMA',
  死叉: 'EMA',
  MACD转正: 'MACD',
  MACD转负: 'MACD',
  RSI回升: 'RSI',
  RSI回落: 'RSI',
  破上轨: 'BOLL',
  破下轨: 'BOLL',
};
const TXT = {
  color: '',
  size: 13,
  backgroundColor: 'transparent',
  borderSize: 0,
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
  paddingBottom: 0,
};
/* ===== 标注的视觉规则：每类用不同的“线型 + 形状 + 标签样式”区分，虚线只留给止损/止盈 =====
   支撑阻力  贯穿实线（挡回≥3次为半透明区间），纯文字标签
   前高前低  从形成处起向右的点线射线，起点画 ◆
   信号      小三角，文字用弱化色
   情景      从触发K线起的盈亏框：目标一侧涨色框、止损一侧跌色框，入场实线 + 空心标签
   我的交易  买=蓝色▲、卖=橙色▼（与涨跌色区分），开平仓之间按盈亏着色的实线，平仓空心圆 + 实心盈亏标签
   我的持仓  粗实线 + 实心标签；我的止损/止盈为虚线 + 空心标签
   右侧所有价位标签统一由标签层绘制，自动上下错开，不再互相压住 */
const TRC = [
    ['#2f6fd6', '#d9822b'],
    ['#5b9cf5', '#f0a73a'],
  ],
  DASH = { dot: [1.5, 3], dash: [5, 4], dashdot: [8, 3, 2, 3] };
function regOverlays() {
  const ov = (name, totalStep, fn) =>
    klinecharts.registerOverlay({
      name,
      totalStep,
      needDefaultPointFigure: false,
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: false,
      createPointFigures: fn,
    });
  /* 横线：默认贯穿主图；ray=从该点所在K线起向右；diamond=起点画 ◆；nol=只画 ◆ 不画线；text=左侧文字（用于高亮） */
  ov('fbLine', 2, ({ overlay, coordinates, bounding }) => {
    const e = overlay.extendData,
      { x, y } = coordinates[0],
      x0 = e.ray ? x : 0,
      fg = [];
    if (!e.nol)
      fg.push({
        type: 'line',
        attrs: {
          coordinates: [
            { x: x0, y },
            { x: bounding.width, y },
          ],
        },
        styles: {
          style: e.dash ? 'dashed' : 'solid',
          dashedValue: DASH[e.dash] || [4, 3],
          size: e.size || 1,
          color: e.color,
        },
        ignoreEvent: true,
      });
    if (e.diamond)
      fg.push({
        type: 'polygon',
        attrs: {
          coordinates: [
            { x, y: y - 5 },
            { x: x + 4, y },
            { x, y: y + 5 },
            { x: x - 4, y },
          ],
        },
        styles: { style: 'fill', color: e.color },
        ignoreEvent: true,
      });
    if (e.text)
      fg.push({
        type: 'text',
        attrs: { x: x0 + 8, y: y - 3, text: e.text, align: 'left', baseline: 'bottom' },
        styles: { ...TXT, color: e.color },
        ignoreEvent: true,
      });
    /* tag：线起点处的小实心标记（如 SL / TP） */
    if (e.tag)
      fg.push({
        type: 'text',
        attrs: { x: x0 + 8, y, text: e.tag, align: 'left', baseline: 'middle' },
        styles: {
          ...TXT,
          size: 11,
          weight: 'bold',
          color: '#fff',
          backgroundColor: e.color,
          borderRadius: 2,
          paddingLeft: 3,
          paddingRight: 3,
          paddingTop: 1,
          paddingBottom: 1,
        },
        ignoreEvent: true,
      });
    return fg;
  });
  /* 线段：两点之间（用于把我的止损/止盈与持仓开仓点连起来） */
  ov('fbSeg', 3, ({ overlay, coordinates }) => [
    {
      type: 'line',
      attrs: { coordinates },
      styles: { style: 'solid', size: overlay.extendData.size || 1.5, color: overlay.extendData.color },
      ignoreEvent: true,
    },
  ]);
  /* 箭头：看多在最低价下方向上，看空在最高价上方向下 */
  ov('fbArrow', 2, ({ overlay, coordinates }) => {
    const e = overlay.extendData,
      { x, y } = coordinates[0],
      s = e.dir > 0 ? 1 : -1,
      t = y + 5 * s,
      b = y + 13 * s;
    return [
      {
        type: 'polygon',
        attrs: {
          coordinates: [
            { x, y: t },
            { x: x - 4, y: b },
            { x: x + 4, y: b },
          ],
        },
        styles: { style: 'fill', color: e.color },
      },
      {
        type: 'text',
        attrs: { x, y: b + 2 * s, text: e.text, align: 'center', baseline: s > 0 ? 'top' : 'bottom' },
        styles: { ...TXT, size: 12, color: e.tc || e.color },
        ignoreEvent: true,
      },
    ];
  });
  /* 区间：两个价格之间的半透明带 */
  ov('fbZone', 3, ({ overlay, coordinates, bounding }) => {
    const e = overlay.extendData,
      y1 = Math.min(coordinates[0].y, coordinates[1].y),
      y2 = Math.max(coordinates[0].y, coordinates[1].y),
      w = bounding.width;
    return [
      {
        type: 'rect',
        attrs: { x: 0, y: y1, width: w, height: Math.max(2, y2 - y1) },
        styles: { style: 'fill', color: e.color + '22' },
        ignoreEvent: true,
      },
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: 0, y: y1 },
            { x: w, y: y1 },
          ],
        },
        styles: { style: 'solid', size: 1, color: e.color + '66' },
        ignoreEvent: true,
      },
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: 0, y: y2 },
            { x: w, y: y2 },
          ],
        },
        styles: { style: 'solid', size: 1, color: e.color + '66' },
        ignoreEvent: true,
      },
    ];
  });
  /* 竖条：高亮某一根K线；line 为真时中间再加一条细虚线（点击选中用，比悬停的淡竖条更明确） */
  ov('fbVBand', 2, ({ overlay, coordinates, bounding, barSpace }) => {
    const e = overlay.extendData,
      al = e.a != null ? Math.round(Math.min(255, e.a)).toString(16).padStart(2, '0') : e.alpha || '38',
      w = Math.max(6, ((barSpace && barSpace.bar) || 6) + 4),
      x = coordinates[0].x,
      r = [
        {
          type: 'rect',
          attrs: { x: x - w / 2, y: 0, width: w, height: bounding.height },
          styles: { style: 'fill', color: e.color + al },
          ignoreEvent: true,
        },
      ];
    if (e.line)
      r.push({
        type: 'line',
        attrs: {
          coordinates: [
            { x, y: 0 },
            { x, y: bounding.height },
          ],
        },
        styles: { style: 'dashed', dashedValue: [3, 3], size: 1, color: e.color + 'aa' },
        ignoreEvent: true,
      });
    return r;
  });
  /* 最新K线分界：最新一根K线右边缘画一条竖虚线，右侧（还没走出来的区域）铺一层淡淡的强调色，主图和各副图都画 */
  ov('fbNow', 2, ({ overlay, coordinates, bounding, barSpace }) => {
    const e = overlay.extendData,
      x = coordinates[0].x + ((barSpace && barSpace.halfGapBar) || 3);
    if (x >= bounding.width) return [];
    return [
      {
        type: 'rect',
        attrs: { x, y: 0, width: bounding.width - x, height: bounding.height },
        styles: { style: 'fill', color: e.color + '1a' },
        ignoreEvent: true,
      },
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x, y: 0 },
            { x, y: bounding.height },
          ],
        },
        styles: { style: 'dashed', dashedValue: [4, 4], size: 1, color: e.color + 'b0' },
        ignoreEvent: true,
      },
    ];
  });
  /* 圆点：高亮信号时标出指标上的触发点（如 MACD 柱转正处、RSI 回升处、EMA 金叉处），外圈半透明 */
  ov('fbDot', 2, ({ overlay, coordinates }) => {
    const e = overlay.extendData,
      { x, y } = coordinates[0];
    return [
      {
        type: 'circle',
        attrs: { x, y, r: e.r + 4 },
        styles: { style: 'fill', color: e.color + '30' },
        ignoreEvent: true,
      },
      {
        type: 'circle',
        attrs: { x, y, r: e.r },
        styles: { style: 'stroke_fill', color: e.color + '55', borderColor: e.color, borderSize: 2 },
        ignoreEvent: true,
      },
    ];
  });
  /* 情景盈亏框：点依次为 入场/目标/止损（时间都取触发K线），从触发K线画到右边缘 */
  ov('fbBox', 4, ({ overlay, coordinates, bounding }) => {
    const e = overlay.extendData,
      [en, tg, sl] = coordinates,
      x0 = en.x,
      w = Math.max(0, bounding.width - x0),
      up = tg.y < en.y,
      box = (a, c) => ({
        type: 'rect',
        attrs: { x: x0, y: Math.min(a.y, en.y), width: w, height: Math.max(1, Math.abs(a.y - en.y)) },
        styles: { style: 'fill', color: c },
        ignoreEvent: true,
      });
    return [
      box(tg, e.win + '26'),
      box(sl, e.loss + '26'),
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: x0, y: en.y },
            { x: bounding.width, y: en.y },
          ],
        },
        styles: { style: 'solid', size: 1.5, color: e.color },
        ignoreEvent: true,
      },
      {
        type: 'text',
        attrs: { x: x0 + 4, y: en.y + (up ? 4 : -4), text: e.text, align: 'left', baseline: up ? 'top' : 'bottom' },
        styles: {
          ...TXT,
          color: e.color,
          backgroundColor: e.bg,
          borderColor: e.color,
          borderSize: 1,
          borderRadius: 3,
          paddingLeft: 4,
          paddingRight: 4,
          paddingTop: 2,
          paddingBottom: 2,
        },
        ignoreEvent: true,
      },
    ];
  });
  /* 我的已平仓交易：开仓三角（买▲在价下、卖▼在价上）→ 按盈亏着色的实线 → 平仓空心圆 + 实心盈亏标签 */
  const tri = (x, y, buy) =>
    buy
      ? [
          { x, y: y + 2 },
          { x: x - 6, y: y + 12 },
          { x: x + 6, y: y + 12 },
        ]
      : [
          { x, y: y - 2 },
          { x: x - 6, y: y - 12 },
          { x: x + 6, y: y - 12 },
        ];
  ov('fbTrade', 3, ({ overlay, coordinates, barSpace }) => {
    const e = overlay.extendData,
      [a, b] = coordinates,
      hb = ((barSpace && barSpace.bar) || 6) / 2;
    return [
      /* 开平仓之间的时间 × 价格范围铺一层很淡的盈亏色 */
      {
        type: 'rect',
        attrs: {
          x: Math.min(a.x, b.x) - hb,
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x) + hb * 2,
          height: Math.max(2, Math.abs(b.y - a.y)),
        },
        styles: { style: 'fill', color: e.pl + '1c' },
        ignoreEvent: true,
      },
      /* 连线、三角、圆、标签可点击（底色框不响应，避免挡住图表拖动） */
      { type: 'line', attrs: { coordinates: [a, b] }, styles: { style: 'solid', size: 1.5, color: e.pl } },
      { type: 'polygon', attrs: { coordinates: tri(a.x, a.y, e.buy) }, styles: { style: 'fill', color: e.color } },
      {
        type: 'circle',
        attrs: { x: b.x, y: b.y, r: 4 },
        styles: { style: 'stroke', color: e.pl, borderColor: e.pl, borderSize: 2 },
      },
      {
        type: 'text',
        attrs: { x: b.x + 8, y: b.y, text: e.text, align: 'left', baseline: 'middle' },
        styles: {
          ...TXT,
          size: 11,
          color: '#fff',
          backgroundColor: e.pl,
          borderRadius: 3,
          paddingLeft: 3,
          paddingRight: 3,
          paddingTop: 1,
          paddingBottom: 1,
        },
      },
    ];
  });
  /* 我的持仓：点依次为 开仓 / 当前价；开仓价到当前价之间从开仓K线起铺一层盈亏色（浮盈涨色、浮亏跌色），开仓三角 + 粗实线延伸到右边缘（标签在标签层） */
  ov('fbPos', 3, ({ overlay, coordinates, bounding }) => {
    const e = overlay.extendData,
      { x, y } = coordinates[0],
      cy = coordinates[1] ? coordinates[1].y : y;
    return [
      {
        type: 'rect',
        attrs: { x, y: Math.min(y, cy), width: Math.max(0, bounding.width - x), height: Math.max(1, Math.abs(cy - y)) },
        styles: { style: 'fill', color: e.pl + '22' },
        ignoreEvent: true,
      },
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x, y },
            { x: bounding.width, y },
          ],
        },
        styles: { style: 'solid', size: 2, color: e.color },
      },
      { type: 'polygon', attrs: { coordinates: tri(x, y, e.buy) }, styles: { style: 'fill', color: e.color } },
    ];
  });
  /* 右侧标签层：所有价位标签在此统一绘制。按 y 排序后上下推开至少 18px（先向下推、超出底部再向上收），被推开的用细线连回原价位。
   右侧面板展开时价格轴左移 RIN，标签跟着贴在价格轴左边（线条仍延伸到面板下面）。
   样式：plain=纯文字（半透明底），outline=空心框，fill=实心框 */
  ov('fbLabels', 2, ({ overlay, coordinates, bounding }) => {
    const e = overlay.extendData,
      h = bounding.height,
      w = bounding.width - RIN,
      G = 18,
      L = e.labs
        .map((l, i) => ({ ...l, y: coordinates[i].y }))
        .filter(l => l.y >= -2 && l.y <= h + 2)
        .sort((a, b) => a.y - b.y);
    L.forEach((l, i) => {
      l.ay = Math.max(l.y, i ? L[i - 1].ay + G : 8);
    });
    for (let i = L.length - 1; i >= 0; i--) {
      const lim = i == L.length - 1 ? h - 8 : L[i + 1].ay - G;
      if (L[i].ay > lim) L[i].ay = lim;
    }
    const pad = { paddingLeft: 4, paddingRight: 4, paddingTop: 1, paddingBottom: 1, borderRadius: 3 };
    return L.flatMap(l => {
      const st =
          l.kind == 'fill'
            ? { ...pad, color: '#fff', backgroundColor: l.color }
            : l.kind == 'outline'
              ? { ...pad, color: l.color, backgroundColor: e.bg, borderColor: l.color, borderSize: 1 }
              : { color: l.color, backgroundColor: e.bg + 'cc', paddingLeft: 2, paddingRight: 2 },
        fg = [];
      if (Math.abs(l.ay - l.y) > 2)
        fg.push({
          type: 'line',
          attrs: {
            coordinates: [
              { x: w - 3, y: l.y },
              { x: w - 3, y: l.ay },
            ],
          },
          styles: { style: 'solid', size: 1, color: l.color },
          ignoreEvent: true,
        });
      fg.push({
        type: 'text',
        attrs: { x: w - 8, y: l.ay, text: l.text, align: 'right', baseline: 'middle' },
        styles: { ...TXT, ...st },
        ignoreEvent: true,
      });
      return fg;
    });
  });
}
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
/* 图上点击：交易/持仓/信号箭头可点击高亮；点在图上空白处取消高亮（拖动图表不算点击）。
   ovHit 记录刚点中图形的时间，让随后冒泡上来的 DOM click 不再当作“点空白” */
let ovHit = 0,
  downXY = null;
const ovClick = fn => () => {
  ovHit = Date.now();
  fn();
  return true;
};
/* 单笔交易/持仓的图上图形与右侧标签：drawMarks 画全部交易时用，“我的交易”隐藏时高亮某一笔也用它临时画出这一笔。
   持仓：止损/止盈离现价 30% 以内才画（过滤 eToro 默认的远端止损）；止损/止盈为从开仓K线起的点划线 + 起点 SL/TP 标记 + 从开仓价连过来的竖线，
   右侧实心标签写出触及时的大约盈亏（价格差 × 数量，未计费用） */
function trMarks(t, open) {
  const U = cssv('--up'),
    D = cssv('--dn'),
    [TB, TS] = TRC[DARK[theme] ? 1 : 0],
    f = v => v.toFixed(cur.p),
    ts = bars[bars.length - 1].timestamp,
    now = bars[bars.length - 1].close,
    sg = v => `${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 100 ? 0 : 2)}`,
    items = [],
    labs = [],
    lab = (v, text, color) => labs.push({ v, text, color, kind: 'fill' });
  if (!open) {
    const a = snapTs(t.openTs),
      b = snapTs(t.closeTs);
    if (a && b)
      items.push({
        name: 'fbTrade',
        points: [
          { timestamp: a, value: t.openRate },
          { timestamp: b, value: t.closeRate },
        ],
        onClick: ovClick(() => hlTrade(t, 'c|' + t.id, 1)),
        extendData: { buy: t.isBuy, color: t.isBuy ? TB : TS, pl: t.netProfit >= 0 ? U : D, text: sg(t.netProfit) },
      });
    return { items, labs };
  }
  const a = snapTs(t.openTs) || bars[0].timestamp,
    up = (now - t.openRate) * (t.isBuy ? 1 : -1) >= 0,
    pAt = v => (v - t.openRate) * (t.isBuy ? 1 : -1) * t.units;
  items.push({
    name: 'fbPos',
    points: [
      { timestamp: a, value: t.openRate },
      { timestamp: ts, value: now },
    ],
    onClick: ovClick(() => hlTrade(t, 'o|' + t.id, 1)),
    extendData: { buy: t.isBuy, color: t.isBuy ? TB : TS, pl: up ? U : D },
  });
  lab(
    t.openRate,
    `持仓 ${t.isBuy ? '多' : '空'} ${+t.units.toFixed(2)} @${f(t.openRate)}${t.pnl != null ? ' ' + sg(t.pnl) : ''}`,
    t.pnl == null ? (t.isBuy ? TB : TS) : t.pnl >= 0 ? U : D
  );
  [
    [t.sl, '我的止损', 'SL', D],
    [t.tp, '我的止盈', 'TP', U],
  ].forEach(([v, n, tag, c]) => {
    if (v > 0 && Math.abs(v - now) / now < 0.3) {
      items.push({
        name: 'fbSeg',
        points: [
          { timestamp: a, value: t.openRate },
          { timestamp: a, value: v },
        ],
        extendData: { color: c },
      });
      items.push({
        name: 'fbLine',
        points: [{ timestamp: a, value: v }],
        extendData: { color: c, size: 1.5, dash: 'dashdot', ray: 1, tag },
      });
      lab(v, `${n} ${f(v)} · ≈${sg(pAt(v))}`, c);
    }
  });
  return { items, labs };
}
let ovSig = '',
  lastM = null;
function drawMarks(m) {
  lastM = m;
  const f = v => v.toFixed(cur.p),
    items = [],
    labs = [],
    U = cssv('--up'),
    D = cssv('--dn'),
    A = cssv('--ac'),
    BG = cssv('--pn'),
    MU = cssv('--mu'),
    [TB, TS] = TRC[DARK[theme] ? 1 : 0],
    ts = bars.length ? bars[bars.length - 1].timestamp : 0,
    lab = (v, text, color, kind = 'plain') => labs.push({ v, text, color, kind });
  if (m) {
    const now = bars.length ? bars[bars.length - 1].close : m.t.a.c,
      x = m.t.a.a,
      M = mainLv(m.L, now, x, tf),
      pm = [];
    /* 价位标注：支撑阻力（挡回≥3次的画成区间）+ 当前及更大周期的前高/前低；同侧相距 0.3 ATR 内的合并成一条，标签拼在一起 */
    if (MK.sr)
      M.sup.concat(M.res).forEach(l =>
        pm.push({
          p: l.p,
          side: l.side,
          big: TFW[l.top] >= 5,
          low: TFW[l.top] < TFW[tf],
          zone: l.touch >= 3 ? [Math.min(l.zlo, l.p - x * 0.15), Math.max(l.zhi, l.p + x * 0.15)] : null,
          t: `${l.tfs.join('·')} ${l.side > 0 ? '支撑' : '阻力'}${l.touch >= 3 ? ` 挡回${l.touch}次` : ''}`,
        })
      );
    if (MK.hl)
      TFS.slice(TFS.indexOf(tf)).forEach(k => {
        const r = prevHL(C[k], now);
        if (r.hi) pm.push({ p: r.hi.p, ts: r.hi.ts, side: -1, big: TFW[k] >= 5, hl: k, t: '前高' });
        if (r.lo) pm.push({ p: r.lo.p, ts: r.lo.ts, side: 1, big: TFW[k] >= 5, hl: k, t: '前低' });
      });
    pm.sort((a, b) => a.p - b.p);
    const mg = [];
    for (const q of pm) {
      const g = mg[mg.length - 1];
      if (g && g.side == q.side && q.p - g.p <= x * 0.3) {
        g.m.push(q);
        g.big = g.big || q.big;
        g.zone = g.zone || q.zone;
      } else mg.push({ ...q, m: [q] });
    }
    /* 合并后各部分价格相同时只写一次价格，不同时各写各的（前高/前低是精确的K线高低点，支撑阻力是合并后的代表价） */
    mg.forEach(g => {
      const hl = g.m.filter(q => q.hl),
        sr = g.m.filter(q => !q.hl),
        col = g.side > 0 ? U : D,
        parts = [
          ...(hl.length
            ? [
                {
                  t: `◆${hl
                    .map(q => q.hl)
                    .sort((a, b) => TFW[b] - TFW[a])
                    .join('·')}${hl[0].t}`,
                  p: hl[0].p,
                },
              ]
            : []),
          ...sr.map(q => ({ t: q.t, p: q.p })),
        ],
        same = parts.every(q => f(q.p) == f(parts[0].p)),
        text = same
          ? parts.map(q => q.t).join(' · ') + ' ' + f(parts[0].p)
          : parts.map(q => `${q.t} ${f(q.p)}`).join(' · '),
        o = hl.length ? hl.reduce((a, q) => (q.ts < a.ts ? q : a)) : null,
        ot = o && (snapTs(o.ts) || bars[0].timestamp);
      if (g.zone)
        items.push({
          name: 'fbZone',
          points: [
            { timestamp: ts, value: g.zone[1] },
            { timestamp: ts, value: g.zone[0] },
          ],
          extendData: { color: col },
        });
      else if (sr.length)
        items.push({
          name: 'fbLine',
          points: [{ timestamp: ts, value: g.p }],
          extendData: { color: sr.every(q => q.low) ? col + '99' : col, size: g.big ? 1.5 : 1 },
        });
      /* 前高/前低：单独出现时画点线射线；与支撑阻力重合时只在形成处画 ◆ */
      if (o)
        items.push({
          name: 'fbLine',
          points: [{ timestamp: ot, value: o.p }],
          extendData: { color: col, size: g.big ? 1.5 : 1, dash: 'dot', ray: 1, diamond: 1, nol: sr.length > 0 },
        });
      lab(g.p, text, col);
    });
    /* 最近 80 根内的重要信号，同一根K线同方向的合并成一个箭头，最多 8 个 */
    if (MK.ar) {
      const n = m.t.n,
        grp = new Map();
      for (const g of m.t.a.sigs) {
        if (g.i < n - 80 || !bars[g.i]) continue;
        const b = bars[g.i],
          px = g.dir > 0 ? b.low : b.high,
          near = m.L.find(l => isKey(l, tf) && Math.abs(l.p - px) <= x * 0.5),
          sn = SHORT[g.t] || g.t;
        if (!KEYSIG.has(sn) && !near) continue;
        const k = g.i + ':' + g.dir,
          o = grp.get(k) || { g, b, px, near, ns: [] };
        o.ns.push(sn);
        o.near = o.near || near;
        grp.set(k, o);
      }
      [...grp.values()].slice(-8).forEach(({ g, b, px, near, ns }) =>
        items.push({
          name: 'fbArrow',
          points: [{ timestamp: b.timestamp, value: px }],
          onClick: ovClick(() => hlSig(g, 1)),
          extendData: {
            dir: g.dir,
            color: g.dir > 0 ? U : D,
            tc: MU,
            text: ns.join('+') + (near ? `·${g.dir > 0 ? '支撑' : '阻力'}` : ''),
          },
        })
      );
    }
    /* 情景：只画仍有效（已触发、未止损未到目标）的——从触发K线起的盈亏框 + 右侧空心标签 */
    if (MK.pl)
      m.sc
        .flatMap(c => c.trigs)
        .forEach(g => {
          if (g.state != '已触发') return;
          items.push({
            name: 'fbBox',
            points: [
              { timestamp: g.ts, value: g.entry },
              { timestamp: g.ts, value: g.tgt },
              { timestamp: g.ts, value: g.stop },
            ],
            extendData: {
              color: A,
              win: U,
              loss: D,
              bg: BG,
              text: `${g.kind}${g.dir > 0 ? '做多' : '做空'} · 1:${g.rr.toFixed(1)}`,
            },
          });
          lab(g.entry, `入场 ${f(g.entry)}`, A, 'outline');
          lab(g.tgt, `目标 ${f(g.tgt)}`, U, 'outline');
          lab(g.stop, `止损 ${f(g.stop)}`, D, 'outline');
        });
    /* 我的交易：最近 60 笔已平仓（开平仓都在已加载数据范围内的），以及当前持仓和它们的止损/止盈 */
    if (MK.tr && TR && TR.sym === cur.sym) {
      TR.closed.slice(-60).forEach(t => items.push(...trMarks(t).items));
      TR.open.forEach(p => {
        const r = trMarks(p, 1);
        items.push(...r.items);
        labs.push(...r.labs);
      });
    }
  }
  if (labs.length)
    items.push({
      name: 'fbLabels',
      points: labs.map(l => ({ timestamp: ts, value: l.v })),
      extendData: { labs, bg: BG },
    });
  const sig = JSON.stringify([
    cur.sym,
    tf,
    theme,
    scheme,
    items.map(i => [i.name, i.points, i.extendData.text, i.extendData.labs && i.extendData.labs.map(l => l.text)]),
  ]);
  if (sig === ovSig) return;
  ovSig = sig;
  chart.removeOverlay({ groupId: 'fb' });
  items.forEach(i => chart.createOverlay({ ...i, groupId: 'fb', lock: true }));
}
/* 最新K线分界线：最新K线、打开的副图或主题变了才重画（实时推送时同一根K线更新不重画） */
let nowSig = '';
function nowMark() {
  if (!bars.length) return;
  const ps = ['candle_pane', ...INDS.filter(n => on[n] && !MAIN.includes(n)).map(n => 'p_' + n)],
    ts = bars[bars.length - 1].timestamp,
    color = cssv('--ac'),
    sig = ts + ps.join() + color;
  if (sig === nowSig) return;
  nowSig = sig;
  chart.removeOverlay({ groupId: 'now' });
  ps.forEach(pid =>
    chart.createOverlay(
      {
        name: 'fbNow',
        groupId: 'now',
        lock: true,
        zLevel: -1,
        points: [{ timestamp: ts, value: 0 }],
        extendData: { color },
      },
      pid
    )
  );
}
