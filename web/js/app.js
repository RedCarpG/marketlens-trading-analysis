/* 全局状态、主题、数据加载与页面初始化（最后加载） */
/* ===== 界面 ===== */
/* 默认品种：上次选的；否则经本地代理打开时用 eToro GOLD，其他情况（GitHub Pages、直接打开文件）用模拟 GC */
let chart,
  cur = WL.find(w => w.sym == LS.get('sym')) || (LOCAL ? WL[0] : WL.find(w => w.src == 'demo')),
  tf = '1d',
  bars = [],
  ALL = {},
  C = {},
  unsub,
  live = 0,
  scheme = LS.get('scheme', 'intl'),
  /* 第一次打开（本地没有保存过）时：深色主题；图上不画价格行为情景（面板里照常列出，可在“标注”菜单或情景块标题打开） */
  theme = LS.get('theme', 'dark'),
  MK = { hl: 1, sr: 1, ar: 1, pl: 0, tr: 1, ...LS.get('marks', {}) },
  /* PCOL：右侧面板收起成图标条；WCOL：左侧自选收起成竖窄条（都记在本地）；FOCUS：专注模式（只看K线，不记） */
  PCOL = LS.get('pnCol', 0),
  WCOL = LS.get('wlCol', 0),
  FOCUS = 0,
  on = {},
  volPref = 1,
  seen = new Set();
const MAIN = ['MA', 'EMA', 'BOLL'],
  INDS = ['MA', 'EMA', 'BOLL', 'VOL', 'MACD', 'RSI', 'KDJ'];
const PAL = {
    eye: ['#3f9b6e', '#cf5f57'],
    eyeDark: ['#5aa67e', '#c8716a'],
    cyber: ['#00f5a0', '#ff2e88'],
    light: ['#0ecb81', '#f6465d'],
    dark: ['#0ecb81', '#f6465d'],
  },
  TH = { eye: '护眼模式', eyeDark: '深色护眼', light: '浅色模式', dark: '深色模式', cyber: '赛博朋克' },
  /* 设置菜单里主题小圆片的两种颜色：底色 / 强调色 */
  THC = {
    eye: ['#e6ebdc', '#4a7891'],
    eyeDark: ['#1b201c', '#6f9ab0'],
    cyber: ['#07060f', '#00f0ff'],
    light: ['#f4f5f8', '#2563eb'],
    dark: ['#0b0e14', '#4c8dff'],
  };
const DARK = { eyeDark: 1, dark: 1, cyber: 1 },
  GRID = { eye: '#d6dccb', eyeDark: '#2c342d', cyber: '#16123a' };
const fmt = (k, ts) =>
  new Date(ts).toLocaleString(
    'zh-CN',
    k == '1M'
      ? { year: 'numeric', month: 'numeric' }
      : /[dwM]$/.test(k)
        ? { year: '2-digit', month: 'numeric', day: 'numeric' }
        : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
  );
function style() {
  if (!PAL[theme]) theme = 'dark';
  const [g, r] = PAL[theme],
    U = scheme == 'cn' ? r : g,
    D = scheme == 'cn' ? g : r,
    de = document.documentElement,
    rt = de.style;
  de.dataset.theme = theme;
  rt.setProperty('--up', U);
  rt.setProperty('--dn', D);
  rt.setProperty('--tb', TRC[DARK[theme] ? 1 : 0][0]);
  rt.setProperty('--ts', TRC[DARK[theme] ? 1 : 0][1]);
  chart.setStyles(DARK[theme] ? 'dark' : 'light');
  if (GRID[theme]) chart.setStyles({ grid: { horizontal: { color: GRID[theme] }, vertical: { color: GRID[theme] } } });
  /* 赛博朋克：十字光标用青色虚线 */
  if (theme == 'cyber')
    chart.setStyles({
      crosshair: {
        horizontal: { line: { color: '#00f0ff88' }, text: { backgroundColor: '#00b8c4', borderColor: '#00f0ff' } },
        vertical: { line: { color: '#00f0ff88' }, text: { backgroundColor: '#00b8c4', borderColor: '#00f0ff' } },
      },
    });
  /* 左上角自带的K线数值提示与悬停信息卡重复，关掉；指标图例改为页面自绘（见 legend），图表库自带的也关掉。
     价格轴固定 70px 宽：默认按刻度文字自动定宽，滚动时 MACD 等副图的刻度（如 -80.0000 / 40.0000）宽度一变，
     各窗口的画布就要改尺寸，而改了尺寸的画布要等浏览器下一次尺寸回调才重画——表现为K线先动、指标晚一帧才跟上 */
  chart.setStyles({
    yAxis: { size: 70 },
    candle: {
      tooltip: { showRule: 'none' },
      bar: { upColor: U, downColor: D, upBorderColor: U, downBorderColor: D, upWickColor: U, downWickColor: D },
    },
    indicator: {
      tooltip: { showRule: 'none' },
      bars: [
        {
          style: 'fill',
          borderStyle: 'solid',
          borderSize: 1,
          borderDashedValue: [2, 2],
          upColor: U + '99',
          downColor: D + '99',
          noChangeColor: '#888888',
        },
      ],
    },
  });
  document.querySelectorAll('#thm [data-th]').forEach(b => b.classList.toggle('on', b.dataset.th == theme));
  $('#thmn').textContent = TH[theme];
  document.querySelectorAll('#sch [data-sc]').forEach(b => b.classList.toggle('on', b.dataset.sc == scheme));
  segInd($('#sch'));
  drawMarks(lastM);
  nowMark();
}
function stop() {
  if (unsub) {
    unsub();
    unsub = null;
  }
  liveQ = null;
  mktPill();
}
function start() {
  const A = AD[cur.src];
  if (!A || !A.subscribe) return;
  stop();
  liveAt = Date.now();
  unsub = A.subscribe(
    cur,
    tf,
    b => {
      /* 记下最后一笔报价的时间（代理 / Binance 推送里带 qt；模拟数据用收到的时间），交给图表前去掉 */
      liveQ = b.qt || Date.now();
      delete b.qt;
      mktPill();
      const l = bars[bars.length - 1];
      l && b.timestamp === l.timestamp ? (bars[bars.length - 1] = b) : bars.push(b);
      chart.updateData(b);
      refresh();
    },
    bars
  );
}
async function load() {
  stop();
  stMsg('加载中…', 1);
  $('#st').innerHTML = '';
  ALL = {};
  C = {};
  if (cur.src == 'csv') ALL[tf] = cur.bars;
  else {
    const rs = await Promise.allSettled(TFS.map(k => AD[cur.src].history(cur, k)));
    TFS.forEach((k, i) => {
      const v = rs[i].value;
      if (rs[i].status == 'fulfilled' && v && v.length) ALL[k] = v;
    });
  }
  if (!ALL[tf]) {
    stMsg('无法连接实时接口：需在本地或自有服务器运行（预览页面禁止访问外部接口）');
    morph($('#mx'), '');
    return;
  }
  for (const k in ALL) C[k] = ctx(k, ALL[k]);
  show();
  loadTrades();
}
function show() {
  bars = ALL[tf];
  clearHl();
  hideHover();
  volAvail(hasVol(bars));
  chart.setPriceVolumePrecision(cur.p, 0);
  /* 换数据时图表库回到最新K线，右侧留白按右侧面板的宽度设好，最新K线落在价格轴左边 */
  rinAnim++;
  RIN = safeR();
  chart.setOffsetRightDistance(RIN + RGAP);
  chart.applyNewData(bars);
  lastPx = null;
  refresh();
  mktPill();
  fitChart();
  if (live) start();
}
/* 顶栏里的最新价：价格、本周期涨跌（相对上一根K线收盘）、数据来源；实时更新时价格短暂闪一下涨跌色。
   加载中、出错时在K线区域中间显示一条提示（stMsg），有数据后隐藏 */
let lastPx = null;
function stMsg(t, busy) {
  const n = $('#note');
  n.innerHTML = `${busy ? '<i class="spin"></i>' : ''}${t}`;
  n.hidden = false;
}
function hdr() {
  const st = $('#st');
  if (!bars.length) return;
  $('#note').hidden = true;
  if (!st.querySelector('.px')) {
    st.innerHTML = '<span class="px"></span><span class="chg"></span><span class="src"></span>';
    lastPx = null;
  }
  const b = bars[bars.length - 1],
    p = bars[bars.length - 2],
    f = v => v.toFixed(cur.p),
    chg = p ? b.close - p.close : 0,
    px = st.querySelector('.px'),
    c = st.querySelector('.chg'),
    sg = chg >= 0 ? '+' : '';
  st.querySelector('.src').textContent =
    cur.src == 'demo' ? '模拟数据' : cur.src == 'csv' ? '本地 CSV' : cur.name.split(' · ')[1] || '';
  px.textContent = f(b.close);
  c.textContent = p ? `${sg}${f(chg)}  ${sg}${((chg / p.close) * 100).toFixed(2)}%` : '';
  c.style.color = chg > 0 ? 'var(--up)' : chg < 0 ? 'var(--dn)' : 'var(--mu)';
  if (lastPx != null && b.close !== lastPx) {
    px.classList.remove('fu', 'fd');
    void px.offsetWidth;
    px.classList.add(b.close > lastPx ? 'fu' : 'fd');
  }
  lastPx = b.close;
}
function setLive(v) {
  live = v ? 1 : 0;
  $('#lv').classList.toggle('on', !!live);
  $('#lv').title = live ? '实时行情已连接，点击断开' : '连接实时行情';
  mktPill();
}
/* ===== 行情状态（顶栏价格右侧的小标签）：现在看到的是实时报价，还是已经休市 / 不是实时 =====
   - 实时开着：按最后一笔报价的时间判断。2 分钟内有报价 → “实时 · 交易中”；超过 2 分钟没有新报价 → “休市 · 最后报价 …”
     （休市时订阅只会收到一笔旧报价，代理把报价自带的时间一起推过来，所以一连上就能判断）；刚连上还没收到 → “连接中”。
   - 实时关着：看已加载的 15 分钟K线，最后一根结束已超过 30 分钟 → “休市 · 最后K线 …”，否则 → “非实时”（点“实时”接收报价）。
     Binance（加密货币全天交易）不判休市；模拟、CSV 另标。每秒刷新一次 */
let liveQ = null,
  liveAt = 0;
function mktPill() {
  const el = $('#mkt');
  if (!el || !cur) return;
  const now = Date.now(),
    t = ts =>
      new Date(ts).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    b15 = ALL['15m'],
    lastEnd = b15 && b15.length ? nxt('15m', b15[b15.length - 1].timestamp) : 0;
  let k, txt, tip;
  if (cur.src == 'demo') [k, txt, tip] = ['dim', '模拟数据', '随机模拟行情，仅用于演示'];
  else if (cur.src == 'csv') [k, txt, tip] = ['dim', '本地 CSV', '导入的历史数据，不是实时行情'];
  else if (live && unsub) {
    if (liveQ == null)
      [k, txt, tip] =
        now - liveAt > 15e3
          ? ['off', '暂无报价', '已连接实时行情，但还没收到报价']
          : ['wait', '连接中…', '正在连接实时行情'];
    else if (now - liveQ < 120e3)
      [k, txt, tip] = [
        'on',
        '实时 · 交易中',
        '最后报价 ' + new Date(liveQ).toLocaleTimeString('zh-CN', { hour12: false }),
      ];
    else [k, txt, tip] = ['closed', '休市 · 最后报价 ' + t(liveQ), '超过 2 分钟没有新报价：市场休市或报价暂停'];
  } else if (cur.src != 'binance' && lastEnd && now - lastEnd > 30 * 60e3)
    [k, txt, tip] = [
      'closed',
      '休市 · 最后K线 ' + t(lastEnd),
      '最近的 15 分钟K线早已结束，市场应在休市中；点“实时”可确认',
    ];
  else [k, txt, tip] = ['off', '非实时', '显示的是加载时的数据；点顶栏“实时”接收实时报价'];
  el.className = 'mkt mkt-' + k;
  el.title = tip;
  if (el.textContent !== txt) el.innerHTML = `<i></i>${txt}`;
}
setInterval(mktPill, 1000);
function setTf(k) {
  if (!k || (k == tf && ALL[k])) return;
  tf = k;
  document.querySelectorAll('#tfs button').forEach(b => b.classList.toggle('on', b.dataset.f == k));
  segInd($('#tfs'));
  stop();
  ALL[k] ? show() : load();
}
/* 自选（左侧）：按 grp 分组（GRPS 决定顺序）；名称里“ · ”后面是数据来源（eToro、Binance），放到右侧小标签。
   顶栏显示当前品种名（点它开合自选），收起后的竖窄条显示品种代码 */
function wl() {
  $('#symb').textContent = cur.name.split(' · ')[0];
  $('#wls').textContent = cur.sym;
  const gs = [...new Set(WL.map(w => w.grp))].sort(
    (a, b) => ((GRPS.indexOf(a) + 99) % 99) - ((GRPS.indexOf(b) + 99) % 99)
  );
  /* 不经本地代理打开（如 GitHub Pages）时不列 eToro 品种 */
  $('#wl').innerHTML = gs
    .filter(g => WL.some(w => w.grp == g && (LOCAL || w.src != 'etoro')))
    .map(
      g =>
        `<div class="mh">${g}</div>` +
        WL.map((w, i) => [w, i])
          .filter(([w]) => w.grp == g && (LOCAL || w.src != 'etoro'))
          .map(([w, i]) => {
            const [nm, src] = w.name.split(' · ');
            const off = w.src == 'etoro' && !LOCAL;
            return `<button class="wi${w == cur ? ' on' : ''}" data-k="${i}" title="${off ? '需在本机运行代理（server 目录 npm start）后从 127.0.0.1 打开' : w.name}"><span>${nm}</span><i>${w.src == 'demo' ? '模拟' : w.src == 'csv' ? '本地' : off ? '需本地代理' : src || '实时'}</i></button>`;
          })
          .join('')
    )
    .join('');
}
/* ===== 整页布局 =====
   宽屏时K线铺满窗口，顶栏、左侧自选、右侧面板浮在上面。layout() 量出顶栏高度写进 --tbh，左侧自选占用的宽度写进 --L，
   右侧面板（收起时为图标条）占用的宽度写进 --R；价格轴随 --R 左移，K线让到价格轴左边（setRin）；
   主图顶部按顶栏高度留白（K线不钻到顶栏下面），并重排图例。两侧开合、专注模式、窗口或顶栏尺寸变化时调用。
   safeL / safeR / safeT：K线可见区域到图表容器左、右、上边的距离（像素），高亮定位、悬停信息卡按它们避让 */
const WIDE = () => matchMedia('(min-width:901px)').matches;
const safeL = () => (!WIDE() || FOCUS ? 0 : (WCOL ? $('#wlr') : $('#wlp')).getBoundingClientRect().width + 16);
const safeR = () => (!WIDE() || FOCUS ? 0 : (PCOL ? $('#rail') : $('#pn')).getBoundingClientRect().width + 16);
const safeT = () => (!WIDE() || FOCUS ? 0 : $('.top').offsetHeight + 8);
let gapTop = 0;
function layout() {
  const rt = document.documentElement.style,
    tb = $('.top').offsetHeight,
    R = safeR();
  rt.setProperty('--tbh', tb + 'px');
  rt.setProperty('--L', safeL() + 'px');
  rt.setProperty('--R', R + 'px');
  if (!chart) return;
  axisCls();
  setRin(R);
  /* 留白按顶栏高度算，与是否专注模式无关：进出专注模式时K线不跳动。
     图表库的 gap.top 是价格范围的比例：要让上方空出 M 像素，比例 = (M/h)(1+下方比例)/(1−M/h) */
  const h = chart.getSize('candle_pane').height,
    M = tb + 8 + 40,
    g = WIDE() && h > M * 2 ? Math.max(0.2, ((M / h) * 1.1) / (1 - M / h)) : 0.2;
  if (Math.abs(g - gapTop) > 0.005) {
    gapTop = g;
    chart.setPaneOptions({ id: 'candle_pane', gap: { top: g, bottom: 0.1 } });
  }
  legend();
}
/* 给主图和各副图的价格轴元素加上 .yax（CSS 按 --R 平移、垫半透明底）；新加副图后要再调一次 */
function axisCls() {
  ['candle_pane', ...INDS.filter(n => on[n] && !MAIN.includes(n)).map(n => 'p_' + n)].forEach(id => {
    const d = chart.getDom(id, 'yAxis');
    if (!d || d.classList.contains('yax')) return;
    /* 新加的价格轴直接放到位，不播放平移过渡 */
    d.style.transition = 'none';
    d.classList.add('yax');
    void d.offsetWidth;
    d.style.transition = '';
  });
}
/* 价格轴左移的同时（CSS 过渡 0.34 秒），右侧价位标签层按 RIN 让到价格轴左边：
   正停在最新K线处时逐帧调整图表库的右侧留白，最新K线跟着价格轴移动；在看历史行情时不挪画面，面板下面的K线透过半透明底仍看得到，
   只逐帧重绘让标签跟上（右侧留白在下次换数据时按当前宽度设好，见 show） */
/* RGAP：最新K线右边留出的空白（像素），这块“还没走出来”的区域另铺底色，见 nowMark */
const RGAP = 80;
let RIN = 0,
  rinAnim = 0;
function setRin(to) {
  if (Math.abs(to - RIN) < 1 || !bars.length) {
    RIN = to;
    return;
  }
  const from = RIN,
    id = ++rinAnim,
    t0 = performance.now(),
    atEnd = chart.getVisibleRange().realTo >= bars.length;
  const step = now => {
    if (id !== rinAnim) return;
    const p = Math.min(1, (now - t0) / 340),
      e = 1 - Math.pow(1 - p, 3);
    RIN = from + (to - from) * e;
    if (atEnd) chart.setOffsetRightDistance(RIN + RGAP);
    else chart.scrollByDistance(0);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function setPcol(v) {
  PCOL = v ? 1 : 0;
  LS.set('pnCol', PCOL);
  document.body.classList.toggle('pcol', !!PCOL);
  layout();
}
function setWcol(v) {
  WCOL = v ? 1 : 0;
  LS.set('wlCol', WCOL);
  document.body.classList.toggle('wcol', !!WCOL);
  layout();
}
function setFocus(v) {
  FOCUS = v ? 1 : 0;
  document.body.classList.toggle('focus', !!FOCUS);
  document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
  layout();
}
function init() {
  if (!window.klinecharts) {
    stMsg('图表库加载失败，请检查网络后刷新');
    return;
  }
  chart = klinecharts.init('chart');
  regOverlays();
  /* 标注菜单：每项前面画该类标注在图上的样子 */
  const MKD = {
    hl: '当前及更大周期的前高 / 前低',
    sr: '关键支撑阻力，挡回多次的画成区间',
    ar: '近期信号的位置',
    pl: '情景的入场 / 止损 / 目标',
    tr: '我的开平仓、持仓与止损止盈',
  };
  $('#mks').innerHTML =
    '<div class="mh">图上标注</div>' +
    Object.entries(MKN)
      .map(
        ([k, n]) =>
          `<button data-m="${k}" class="mi${MK[k] ? ' on' : ''}"><svg width="22" height="10" viewBox="0 0 22 10">${SW[k]}</svg><span class="mt">${n}<small>${MKD[k]}</small></span></button>`
      )
      .join('');
  $('#mks').onclick = e => {
    const bt = e.target.closest('[data-m]');
    if (bt) setMK(bt.dataset.m);
  };
  /* 顶栏下拉：点按钮开合，点菜单外关闭；菜单内可连续切换 */
  document.querySelectorAll('.dd>.ddb').forEach(
    b =>
      (b.onclick = e => {
        const d = b.parentElement,
          o = d.classList.contains('open');
        document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
        if (!o) d.classList.add('open');
        e.stopPropagation();
      })
  );
  document.addEventListener('click', e => {
    if (!e.target.closest('.dd')) document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
  });
  /* 打开设置时刷新“本地K线存储”的概况 */
  $('#setd .ddb').addEventListener('click', loadStoreInfo);
  /* 图表尺寸随容器变化自动适配（之后副图位置会变，重排图例）；顶栏换行时高度变化，重新布局 */
  new ResizeObserver(() => {
    chart.resize();
    axisCls();
    legend();
  }).observe($('#chart'));
  new ResizeObserver(() => layout()).observe($('.top'));
  /* 自选：点一项切换品种；顶栏的品种名、自选标题的按钮、收起后的竖窄条都可开合自选 */
  $('#wl').onclick = e => {
    const b = e.target.closest('[data-k]');
    if (!b || WL[+b.dataset.k] == cur) return;
    cur = WL[+b.dataset.k];
    if (cur.src != 'csv') LS.set('sym', cur.sym);
    wl();
    load();
  };
  /* 面板收起 / 展开、专注模式；图标条上点某一页的图标直接展开到那一页。打开页面时直接是上次的状态，不播放收起动画 */
  document.body.classList.add('boot');
  document.body.classList.toggle('pcol', !!PCOL);
  document.body.classList.toggle('wcol', !!WCOL);
  setTimeout(() => document.body.classList.remove('boot'), 400);
  $('#symb').onclick = () => setWcol(!WCOL);
  $('#wcol').onclick = () => setWcol(1);
  $('#wlr').onclick = () => setWcol(0);
  $('#rail').onclick = e => {
    const b = e.target.closest('[data-tab],#pexp');
    if (!b) return;
    if (b.dataset.tab) setTab(b.dataset.tab);
    setPcol(0);
  };
  $('#focb').onclick = () => setFocus(1);
  $('#focx').onclick = () => setFocus(0);
  /* 点击反馈：按下可点的元素时外圈扩散一圈光晕（.tap，动画结束后移除），配合 CSS 里按下缩小、松开回弹 */
  document.addEventListener('pointerdown', e => {
    const t = e.target.closest && e.target.closest('button,.btn,.sg,.lvr,.sc,.wi,.selt');
    if (!t || t.disabled) return;
    t.classList.remove('tap');
    void t.offsetWidth;
    t.classList.add('tap');
  });
  document.addEventListener('animationend', e => /^tap/.test(e.animationName) && e.target.classList.remove('tap'));
  /* 按下鼠标或滚轮时停止选中交易后的缩放过渡，交给用户操作 */
  $('#chart').addEventListener('mousedown', e => {
    downXY = [e.clientX, e.clientY];
    fitAnim++;
  });
  $('#chart').addEventListener('wheel', () => fitAnim++, { passive: true });
  /* 悬停：信息卡挂在图表容器里；十字光标移动时更新内容，鼠标移动时更新位置，离开图表时隐藏 */
  ['hov', 'lgd'].forEach(id => {
    const el = document.createElement('div');
    el.id = id;
    $('#chart').appendChild(el);
  });
  chart.subscribeAction('onCrosshairChange', onHover);
  $('#chart').addEventListener('mousemove', e => {
    const r = $('#chart').getBoundingClientRect();
    hovXY = [e.clientX - r.left, e.clientY - r.top];
    placeHover();
  });
  $('#chart').addEventListener('mouseleave', hideHover);
  $('#chart').addEventListener('click', e => {
    if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4 || Date.now() - ovHit < 400) return;
    if (hlSel) clearHl();
  });
  $('#tfs').innerHTML = TFS.map(k => `<button data-f="${k}" class="${k == tf ? 'on' : ''}">${k}</button>`).join('');
  $('#tfs').onclick = e => setTf(e.target.dataset.f);
  segInd($('#tfs'));
  /* 选中项：点文字重新定位到选中的K线，✕ 取消。
     快捷键：Esc 依次关菜单 → （复盘面板开着时由面板自己处理）→ 取消选中 → 退出专注模式；[ 开合左侧自选；] 开合右侧面板；F 专注模式 */
  $('#selp .selt').onclick = () => hlLoc && hlLoc();
  $('#selp .selx').onclick = clearHl;
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target.closest && e.target.closest('input,textarea,select'))) return;
    if (e.key == 'Escape') {
      if ($('.dd.open')) return document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
      if ($('#rvm.open')) return;
      if (hlSel) return clearHl();
      if (FOCUS) setFocus(0);
      return;
    }
    if ($('#rvm.open') || !WIDE()) return;
    if (e.key == '[') setWcol(!WCOL);
    else if (e.key == ']') setPcol(!PCOL);
    else if (e.key == 'f' || e.key == 'F') setFocus(!FOCUS);
  });
  /* 指标菜单每个按钮前画该指标的配色小样，和图上一致 */
  const isw = k => {
    const s = INDSTY[k];
    if (!s) return '';
    return `<svg width="18" height="10" viewBox="0 0 18 10">${s.lines
      .slice(0, 3)
      .map(([c, w, st], j, a) => {
        const y = a.length == 1 ? 5 : 2 + (j * 6) / (a.length - 1);
        return `<path d="M0 ${y}h18" style="stroke:${c};stroke-width:${Math.max(1.4, w)}${st ? ';stroke-dasharray:3 2' : ''}"/>`;
      })
      .join('')}</svg>`;
  };
  /* 指标菜单分“主图 / 副图”两组，每项写明参数 */
  const IND_D = {
      MA: '均线 5 / 10 / 30 / 60',
      EMA: '20 / 50，与金叉死叉信号一致',
      BOLL: '布林带 20, 2',
      VOL: '成交量',
      MACD: '12 / 26 / 9',
      RSI: '14，与分析一致',
      KDJ: '9 / 3 / 3',
    },
    mi = k =>
      `<button class="mi" data-i="${k}">${isw(k) || '<svg width="18" height="10"></svg>'}<span class="mt">${k}<small>${IND_D[k]}</small></span></button>`;
  $('#ins').innerHTML =
    `<div class="mh">主图</div>${MAIN.map(mi).join('')}` +
    `<div class="mh">副图</div>${INDS.filter(k => !MAIN.includes(k))
      .map(mi)
      .join('')}`;
  $('#ins').onclick = e => {
    const bt = e.target.closest('[data-i]'),
      k = bt && bt.dataset.i;
    if (!k || bt.disabled) return;
    tog(k);
    if (k == 'VOL') volPref = !!on.VOL;
    if (k === hlAuto) hlAuto = null;
  };
  /* 设置：主题用四个小圆片直接选；涨跌配色两项分段 */
  $('#thm').innerHTML = Object.keys(TH)
    .map(k => `<button data-th="${k}" title="${TH[k]}" style="--a:${THC[k][0]};--b:${THC[k][1]}"></button>`)
    .join('');
  $('#thm').onclick = e => {
    const b = e.target.closest('[data-th]');
    if (!b) return;
    theme = b.dataset.th;
    LS.set('theme', theme);
    style();
  };
  $('#sch').innerHTML = '<button data-sc="intl">绿涨红跌</button><button data-sc="cn">红涨绿跌</button>';
  $('#sch').onclick = e => {
    const b = e.target.closest('[data-sc]');
    if (!b || b.dataset.sc == scheme) return;
    scheme = b.dataset.sc;
    LS.set('scheme', scheme);
    style();
  };
  /* 面板透明度：通透 / 适中 / 不透明（不透明同时关掉背景模糊，较老的电脑更流畅） */
  const GL = { clear: '通透', mid: '适中', solid: '不透明' },
    setGlass = k => {
      if (!GL[k]) k = 'mid';
      LS.set('glass', k);
      document.documentElement.dataset.glass = k;
      document.querySelectorAll('#gls [data-gl]').forEach(b => b.classList.toggle('on', b.dataset.gl == k));
      segInd($('#gls'));
    };
  $('#gls').innerHTML = Object.entries(GL)
    .map(([k, n]) => `<button data-gl="${k}">${n}</button>`)
    .join('');
  $('#gls').onclick = e => {
    const b = e.target.closest('[data-gl]');
    if (b) setGlass(b.dataset.gl);
  };
  setGlass(LS.get('glass', 'mid'));
  style();
  ['MA', 'VOL', 'MACD'].forEach(tog);
  $('#lv').onclick = () => {
    setLive(!live);
    live ? start() : stop();
  };
  $('#csv').onchange = e => {
    /* 选好文件后收起设置菜单 */
    const fl = e.target.files[0];
    document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
    if (!fl) return;
    fl.text().then(tx => {
      const o = [];
      tx.split(/\r?\n/).forEach(ln => {
        const c = ln.split(/[,;\t]/);
        if (c.length < 5 || isNaN(+c[1])) return;
        const ts = /^\d+$/.test(c[0].trim()) ? (+c[0] < 1e12 ? +c[0] * 1e3 : +c[0]) : Date.parse(c[0]);
        if (isNaN(ts)) return;
        o.push({ timestamp: ts, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] || 0 });
      });
      o.sort((a, b) => a.timestamp - b.timestamp);
      if (o.length < 60) {
        stMsg('CSV 至少需要 60 行有效数据（列：时间,开,高,低,收,量）');
        return;
      }
      const it = { sym: 'CSV', name: 'CSV 导入', src: 'csv', p: o[0].close < 10 ? 4 : 2, bars: o, grp: '本地' };
      WL.push(it);
      cur = it;
      wl();
      load();
    });
    e.target.value = '';
  };
  addEventListener('resize', () => {
    fitChart();
    chart.resize();
    segInd($('#tfs'));
    segInd($('#pnt'));
  });
  layout();
  /* 上次开着预警：打开页面时直接进入实时模式继续监控 */
  if (AL.on) setLive(1);
  initPanel();
  wl();
  load();
}
init();

/* 设置菜单里的“本地K线存储”：代理把每次拉到的 eToro K线存在本机，这里列出各周期已积累的根数和起始时间 */
async function loadStoreInfo() {
  const el = $('#storeinfo');
  if (!LOCAL) {
    el.textContent = '需通过本地代理打开';
    return;
  }
  try {
    const list = await (await fetch('/api/store')).json();
    if (!list.length) {
      el.textContent = '暂无，打开 eToro 品种后开始积累';
      return;
    }
    const order = TFS.slice().reverse();
    el.innerHTML = list
      .sort((a, b) => a.instrumentId - b.instrumentId || order.indexOf(a.interval) - order.indexOf(b.interval))
      .map(
        s =>
          `<div>#${s.instrumentId} ${s.interval}：${s.count.toLocaleString()} 根 <span class="mu">自 ${fmt(s.interval, s.from)}</span></div>`
      )
      .join('');
  } catch {
    el.textContent = '读取失败（代理未运行？）';
  }
}
