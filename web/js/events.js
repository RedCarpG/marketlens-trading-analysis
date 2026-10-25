/* 经济日历、官方数据与新闻：右侧“事件”页、分析页的事件提示、图上事件标注与悬停、事件预警 */
/* ===== 数据经本地代理拉取（/api/events/calendar、/api/events/news，见 server/events.js）。
   不经代理打开（GitHub Pages、直接打开文件）时没有这些数据，页面写明“未覆盖”，不能当作近期没有重要事件。
   - 相关货币：自选项的 ccy（默认 USD，欧元/美元为 EUR+USD）。日历可切换为全部国家；图上标注、分析页提示、预警只看相关货币的高影响事件
   - 新闻主题：自选项的 news（gold / btc，没有时为 macro），可切到“宏观”；中文 / English
   - 外部文字（标题、来源名、预期值等）一律经 esc 转义后显示；链接只接受 http(s)，新窗口打开、不带来源页 ===== */
/* EV：日历响应 { events, data, sources, at, err }；NW：新闻 { key, items, sources, got, err }；EVL / NWL：正在拉取（“刷新”转圈）
   EVO：本地记住的选项——imp 日历最低影响等级（3 高 / 2 中高 / 0 全部）、all 显示全部国家、nw 新闻主题（sym 品种 / macro 宏观）、lang 语言 */
let EV = null,
  NW = null,
  EVL = 0,
  NWL = 0,
  EVO = { imp: 2, all: 0, nw: 'sym', lang: 'zh', ...LS.get('evOpt', {}) },
  evDataRef = null,
  evTimer = 0;
const esc = s =>
  String(s == null ? '' : s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const ccyOf = () => cur.ccy || ['USD'];
const nwTopic = () => (EVO.nw == 'macro' ? 'macro' : cur.news || 'macro');
const TOPN = { gold: '黄金', btc: '比特币', macro: '宏观' },
  IMPN = ['假日', '低', '中', '高'],
  /* 图上标注和悬停用的简称（同一次发布的几项合成一个） */
  EVSHORT = {
    empsit: '非农',
    cpi: 'CPI',
    ppi: 'PPI',
    pce: 'PCE',
    gdp: 'GDP',
    fomc: 'FOMC',
    jolts: 'JOLTS',
    eci: 'ECI',
  };
const evName = e => e.zh || e.title;
const evShort = e => EVSHORT[e.rel] || evName(e).slice(0, 10);
/* 相关货币的高影响事件 */
const evHot = e => e.imp >= 3 && e.ts && ccyOf().includes(e.ccy);
/* 时间都按本机时区显示 */
const evTime = ts => new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
function evDay(ts) {
  const d = new Date(ts),
    t = new Date();
  t.setHours(0, 0, 0, 0);
  const n = Math.round((new Date(ts).setHours(0, 0, 0, 0) - t) / 864e5),
    s = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
  return n == 0 ? '今天 · ' + s : n == 1 ? '明天 · ' + s : n == -1 ? '昨天 · ' + s : s;
}
function evLeft(d) {
  const m = Math.ceil(d / 60e3),
    h = Math.floor(m / 60);
  return m < 60 ? `${m} 分钟` : h < 24 ? `${h} 小时 ${m % 60} 分` : `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
}
function evAgo(d) {
  const m = Math.floor(d / 60e3);
  return m < 1
    ? '刚刚'
    : m < 60
      ? `${m} 分钟前`
      : m < 1440
        ? `${Math.floor(m / 60)} 小时前`
        : `${Math.floor(m / 1440)} 天前`;
}
/* BLS 数值的显示：非农为千人（+120K），其余为百分比；失业率不带正负号 */
function dv(x, prev) {
  const v = prev ? x.prev : x.val;
  if (v == null) return '—';
  return x.unit == 'K'
    ? `${v >= 0 ? '+' : ''}${v.toFixed(0)}K`
    : `${x.k != 'unemp' && v >= 0 ? '+' : ''}${v.toFixed(x.dp)}%`;
}

/* ===== 拉取 ===== */
async function loadEvents() {
  clearTimeout(evTimer);
  if (!LOCAL) {
    EV = { off: 1 };
    return evRedraw();
  }
  EVL = 1;
  evRedraw();
  try {
    const r = await fetch('/api/events/calendar'),
      j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    EV = j;
    evDataAlert();
  } catch (e) {
    /* 失败时保留上次的数据，标出错误 */
    EV = { ...(EV && EV.events ? EV : {}), err: e.message || '代理未运行？' };
  }
  EVL = 0;
  evRedraw();
  evalEventAlerts();
  /* 相关货币的高影响事件刚公布（1 小时内）时每 2 分钟刷新一次，等官方数据；否则 10 分钟一次 */
  const now = Date.now(),
    hot = EV.events && EV.events.some(e => evHot(e) && e.ts <= now && e.ts > now - 36e5);
  evTimer = setTimeout(loadEvents, hot ? 2 * 60e3 : 10 * 60e3);
}
/* 新闻：打开“事件”页、换品种、改主题/语言时拉取；3 分钟内同一主题不重复拉（代理另有 5 分钟缓存） */
async function loadNews(force) {
  if (!LOCAL) return;
  const key = nwTopic() + '|' + EVO.lang,
    [topic, lang] = key.split('|');
  if (!force && NW && NW.key == key && Date.now() - NW.got < 3 * 60e3) return;
  NWL = 1;
  evRedraw();
  try {
    const r = await fetch(`/api/events/news?topic=${topic}&lang=${lang}`),
      j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    if (nwTopic() + '|' + EVO.lang == key) NW = { ...j, key, got: Date.now() };
  } catch (e) {
    if (nwTopic() + '|' + EVO.lang == key)
      NW = { items: [], ...(NW && NW.key == key ? NW : {}), key, got: Date.now(), err: e.message || '代理未运行？' };
  }
  NWL = 0;
  evRedraw();
}
/* 事件数据变了：重画事件页、分析页提示和图上标注。倒计时每 30 秒也走这里 */
function evRedraw() {
  morph(pane('ev'), evPanel());
  if (bars.length && lastM) {
    morph(pane('an'), anPanel(lastM));
    drawMarks(lastM);
  }
  tabBadges();
}
setInterval(evRedraw, 30e3);
setInterval(() => TAB == 'ev' && loadNews(), 5 * 60e3);
const evSoon = () => {
  const now = Date.now();
  return EV && EV.events ? EV.events.filter(e => evHot(e) && e.ts > now && e.ts < now + 24 * 36e5).length : 0;
};

/* ===== 预警：相关货币的高影响事件公布前 30 分钟、5 分钟各提醒一次（同一时间的几项合成一条）；BLS 公布新的非农、CPI 时提醒 ===== */
function evalEventAlerts() {
  if (!AL.on || !AL.ev || !EV || !EV.events) return;
  const now = Date.now(),
    g = new Map();
  EV.events.forEach(e => {
    if (!evHot(e) || e.ts <= now || e.ts > now + 2 * 36e5) return;
    const k = e.ts + '|' + e.ccy;
    g.set(k, [...(g.get(k) || []), e]);
  });
  g.forEach((es, k) => {
    const d = es[0].ts - now,
      ns = [...new Set(es.map(evName))],
      fc = es
        .filter(e => e.forecast)
        .slice(0, 2)
        .map(e => `${evName(e)} 预期 ${e.forecast}`)
        .join('，');
    [30, 5].forEach(m =>
      alArmCheck(
        'ev|' + k + '|' + m,
        d <= m * 60e3,
        d > m * 60e3,
        `${evTime(es[0].ts)} ${es[0].ccy} ${ns.slice(0, 3).join('、')}${ns.length > 3 ? ' 等' : ''}即将公布（还有 ${evLeft(d)}）${fc ? '：' + fc : ''}`,
        'ev'
      )
    );
  });
}
setInterval(evalEventAlerts, 20e3);
function evDataAlert() {
  const it = EV && EV.data && EV.data.items,
    g = k => it && it.find(x => x.k == k);
  if (!it || !it.length) return;
  const ref = ['nfp', 'cpi'].map(k => (g(k) || {}).ref || '');
  if (evDataRef && AL.on && AL.ev) {
    const n = g('nfp'),
      u = g('unemp'),
      c = g('cpi'),
      cc = g('core'),
      parts = [];
    if (n && ref[0] != evDataRef[0])
      parts.push(`${+n.ref.slice(5)}月非农 ${dv(n)}（前值 ${dv(n, 1)}）${u ? '，失业率 ' + dv(u) : ''}`);
    if (c && ref[1] != evDataRef[1])
      parts.push(`${+c.ref.slice(5)}月 CPI 年率 ${dv(c)}${cc ? '，核心 ' + dv(cc) : ''}`);
    if (parts.length) alFire('BLS 公布：' + parts.join('；'), 'ev');
  }
  evDataRef = ref;
}

/* ===== 图上标注：相关货币的高影响事件，在公布时间所在的K线上画竖点线 + 底部简称（同一根K线的合成一个）。
   日线及以上只标非农、CPI、FOMC，免得每周的初请等把图铺满；相邻的标签分两行错开 ===== */
function evMarks() {
  if (!MK.ev || !EV || !EV.events || !bars.length) return [];
  const t0 = bars[0].timestamp,
    t1 = nxt(tf, bars[bars.length - 1].timestamp),
    big = /[dwM]$/.test(tf),
    g = new Map();
  EV.events.forEach(e => {
    if (!evHot(e) || e.ts < t0 || e.ts >= t1 || (big && !['empsit', 'cpi', 'fomc'].includes(e.rel))) return;
    const s = snapTs(e.ts),
      o = g.get(s) || { e, ns: [] },
      n = evShort(e);
    if (!o.ns.includes(n)) o.ns.push(n);
    g.set(s, o);
  });
  const color = cssv('--mu'),
    bg = cssv('--pn');
  return [...g].map(([ts, { e, ns }], i) => ({
    name: 'fbEvent',
    points: [{ timestamp: ts, value: bars[0].close }],
    onClick: ovClick(() => hlEvent(e, 1)),
    extendData: { color, bg, row: i % 2, text: ns.slice(0, 3).join('·') + (ns.length > 3 ? '…' : '') },
  }));
}
/* 悬停信息卡：这根K线时间内的相关事件（中高影响），最多 4 条 */
function evHover(b) {
  if (!EV || !EV.events) return '';
  const t1 = nxt(tf, b.timestamp),
    es = EV.events.filter(e => e.imp >= 2 && e.ts && e.ts >= b.timestamp && e.ts < t1 && ccyOf().includes(e.ccy));
  return es
    .slice(0, 4)
    .map(
      e =>
        `<div><span class="evf i${e.imp}"></span>${/[dwM]$/.test(tf) ? '' : evTime(e.ts) + ' '}${esc(evName(e))}${e.actual ? ` 公布 <b>${esc(e.actual)}</b>` : ''}${e.forecast ? ` <span class="mu">预期 ${esc(e.forecast)}</span>` : ''}</div>`
    )
    .join('')
    .concat(es.length > 4 ? `<div class="mu">另有 ${es.length - 4} 项</div>` : '');
}

/* ===== 分析页评分卡里的事件提示：24 小时内有相关货币的高影响事件（或 1 小时内刚公布）时提醒；没有覆盖时写明“未覆盖” ===== */
function evRisk() {
  if (!LOCAL) return '<div class="evw off" data-go="ev">经济日历：未覆盖（需本地代理）</div>';
  if (!EV) return '';
  if (!EV.events)
    return `<div class="evw off" data-go="ev">经济日历：未获取到${EV.err ? '（' + esc(EV.err) + '）' : ''}</div>`;
  const now = Date.now(),
    es = EV.events.filter(e => evHot(e) && e.ts > now - 36e5 && e.ts < now + 24 * 36e5);
  if (!es.length) return '';
  const ts = es[0].ts,
    d = ts - now,
    ns = [...new Set(es.filter(e => e.ts == ts).map(evName))],
    nm = esc(ns.slice(0, 2).join('、')) + (ns.length > 2 ? ` 等 ${ns.length} 项` : '');
  return `<div class="evw${d <= 0 ? ' past' : ''}" data-go="ev" title="点击查看经济日历">${d > 0 ? `⚠ ${evDay(ts).split(' · ')[0]} ${evTime(ts)} ${nm}（还有 ${evLeft(d)}）` : `${nm} 刚公布（${evAgo(-d)}）`}<small>公布前后波动可能放大；评分与情景未考虑事件</small></div>`;
}

/* ===== 事件页：工具栏 → 来源覆盖情况 → 下一个重要事件 → 官方数据 → 经济日历 → 新闻 ===== */
function evPanel() {
  if (!LOCAL)
    return `<div class="evoff"><b>经济日历与新闻：未覆盖</b><div class="mu sm">需要在本机运行代理（server 目录 npm start）后从 127.0.0.1 打开。本页没有检查经济日历和新闻，<b>不代表近期没有重要事件</b>。</div></div>`;
  const now = Date.now(),
    tools = `<div class="tbar">${chip('ev', '图上标注')}<span class="sp"></span><button class="chip" id="evr" title="重新拉取日历、官方数据与新闻">${EVL || NWL ? '<i class="spin"></i>' : ''}刷新</button></div>`;
  if (!EV || (!EV.events && !EV.err)) return tools + '<div class="empty"><i class="spin"></i>加载中…</div>';
  const evs = EV.events || [],
    cc = ccyOf().join(' / '),
    srcs = (EV.sources || [])
      .map(
        s =>
          `<span class="src ${s.ok ? 'ok' : 'bad'}" title="${esc(s.err || (s.at ? '更新于 ' + fmt('1h', s.at) : ''))}">${s.ok ? '✓' : '✕'} ${esc(s.name)}</span>`
      )
      .join(''),
    calOk = (EV.sources || []).slice(0, 2).some(s => s.ok),
    warn = EV.err
      ? `<div class="evoff"><b>${evs.length ? '刷新失败，显示的是上次的数据' : '经济日历：未获取到'}</b><div class="mu sm">${esc(EV.err)}。不代表近期没有重要事件。</div></div>`
      : !calOk
        ? '<div class="evoff"><b>日历来源暂时都不可用</b><div class="mu sm">下面只有本地已存的事件和内置的 FOMC 日程，可能不完整。</div></div>'
        : '';
  /* 下一个重要事件（同一时间的几项合成一张卡） */
  const nx = evs.filter(e => evHot(e) && e.ts > now - 15 * 60e3),
    nts = nx.length ? nx[0].ts : 0,
    ng = nx.filter(e => e.ts == nts),
    nd = nts - now,
    next = ng.length
      ? `<section class="evh${nd < 24 * 36e5 ? ' soon' : ''}"><div class="hrow"><span class="lbl">下一个重要事件 · ${esc(cc)}</span><span class="tag">${nd > 0 ? '还有 ' + evLeft(nd) : '刚公布 · ' + evAgo(-nd)}</span></div>
<div class="evt">${esc([...new Set(ng.map(evName))].join('、'))}</div>
<div class="mu sm">${evDay(nts)} ${evTime(nts)}${ng.some(e => e.conf || e.src != 'ff') ? ' · 已核对官方日程' : ''}</div>
${ng
  .filter(e => e.forecast || e.previous || e.actual)
  .map(
    e =>
      `<div class="row sm"><span>${esc(evName(e))}</span><b>${e.actual ? '公布 ' + esc(e.actual) + ' · ' : ''}${e.forecast ? '预期 ' + esc(e.forecast) : ''}${e.previous ? ` <span class="mu">前值 ${esc(e.previous)}</span>` : ''}</b></div>`
  )
  .join('')}</section>`
      : `<div class="empty">已获取的日程里没有 ${esc(cc)} 的高影响事件</div>`;
  /* 官方数据（BLS） */
  const D = EV.data || {},
    dat =
      (D.items || [])
        .map(
          x =>
            `<div class="evd"><span>${esc(x.name)}<small>${+String(x.ref).slice(5)}月${x.prelim ? ' · 初值' : ''}</small></span><b>${dv(x)}</b><span class="dp">前值 ${dv(x, 1)}</span></div>`
        )
        .join('') || `<div class="empty">${D.err ? esc(D.err) : '暂无'}</div>`,
    datNote =
      D.err && D.items && D.items.length
        ? `<div class="note2">最近一次更新失败：${esc(D.err)}，显示的是上次的数据</div>`
        : '';
  /* 经济日历：昨天起 3 周，按本机日期分组 */
  const opt = (k, v, n, t) =>
      `<button class="chip${EVO[k] == v ? ' on' : ''}" data-evo="${k}" data-v="${v}"${t ? ` title="${t}"` : ''}>${n}</button>`,
    d0 = new Date();
  d0.setHours(0, 0, 0, 0);
  const when = e => (e.ts != null ? e.ts : Date.parse(e.date + 'T00:00:00')),
    list = evs.filter(
      e =>
        (EVO.all || ccyOf().includes(e.ccy) || e.ccy == 'ALL') &&
        e.imp >= EVO.imp &&
        when(e) >= d0 - 864e5 &&
        when(e) < now + 21 * 864e5
    );
  let day = '',
    rows = '';
  list.forEach(e => {
    const w = when(e),
      dk = new Date(w).toDateString();
    if (dk != day) {
      rows += `<div class="evday" data-key="d|${dk}">${evDay(w)}</div>`;
      day = dk;
    }
    rows += evRow(e, now);
  });
  const cal =
    `<div class="tbar">${opt('imp', 3, '高')}${opt('imp', 2, '中高')}${opt('imp', 0, '全部')}<span class="sp"></span>${opt('all', 0, esc(cc), '只看与当前品种相关的货币')}${opt('all', 1, '全部国家')}</div>` +
    (rows || '<div class="empty">这段时间没有符合条件的事件</div>');
  /* 新闻 */
  const nk = nwTopic() + '|' + EVO.lang,
    N = NW && NW.key == nk ? NW : null,
    nt = `<div class="tbar">${cur.news ? opt('nw', 'sym', TOPN[cur.news]) : ''}${opt('nw', 'macro', '宏观')}<span class="sp"></span>${opt('lang', 'zh', '中文')}${opt('lang', 'en', 'EN')}</div>`,
    nbad = N && N.sources ? N.sources.filter(s => !s.ok) : [],
    nws = !N
      ? '<div class="empty"><i class="spin"></i>加载中…</div>'
      : (N.err ? `<div class="note2">刷新失败：${esc(N.err)}</div>` : '') +
        (nbad.length
          ? `<div class="note2">暂不可用：${nbad.map(s => `${esc(s.name)}（${esc(s.err)}）`).join('、')}</div>`
          : '') +
        (N.items
          .slice(0, 30)
          .map(x => {
            const u = /^https?:\/\//i.test(x.link) ? x.link : '';
            return `<a class="nwi" data-key="n|${esc(x.id)}"${u ? ` href="${esc(u)}" target="_blank" rel="noopener noreferrer"` : ''}><div class="nt">${esc(x.title)}</div><div class="mu sm">${x.off ? '<span class="tag o">官方</span>' : ''}${esc(x.source)}${x.ts ? ' · ' + evAgo(now - x.ts) : ''}${(x.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></a>`;
          })
          .join('') || '<div class="empty">暂无</div>');
  return `${tools}<div class="srcs">${srcs}</div>${warn}${next}
${blk('evd', `官方数据 <span class="mu">BLS${D.at ? ' · ' + fmt('1h', D.at) : ''}</span>`, dat + datNote)}
${blk('evc', `经济日历 <span class="n">${list.length}</span>`, cal)}
${blk('nws', `新闻 <span class="mu">${TOPN[nwTopic()]} · ${EVO.lang == 'zh' ? '中文' : 'English'}</span>`, nt + nws)}
<p class="disc">日历来自 Forex Factory（第三方整理，预期值为该站汇总，只覆盖本周），并与 BLS、美联储的官方日程核对；BLS / FOMC 日程覆盖之后几个月。官方数据来自 BLS 公共 API。新闻为第三方 RSS 标题，未经核实。事件不参与评分和情景；公布前后波动可能放大，不能据此判断涨跌方向。时间为本机时区。</p>`;
}
/* 日历的一行：时间、货币、影响等级（三格）、名称（✓ 已与官方日程核对）、公布/预期/前值；已过去且在已加载K线范围内的可点击定位 */
function evRow(e, now) {
  const past = e.ts && e.ts <= now,
    go = past && bars.length && e.ts >= bars[0].timestamp,
    k = 'e|' + e.id,
    vals = [
      e.actual && `公布 <b>${esc(e.actual)}</b>`,
      e.forecast && `预期 ${esc(e.forecast)}`,
      e.previous && `前值 ${esc(e.previous)}`,
    ]
      .filter(Boolean)
      .join(' · '),
    ok = e.conf || e.src != 'ff',
    tip = [
      e.title,
      `影响：${IMPN[e.imp]}`,
      e.conf ? `已与${e.conf == 'bls' ? ' BLS ' : '美联储'}官方日程核对` : '',
      e.src == 'bls' ? '来源：BLS 发布日程' : e.src == 'fed' ? '来源：美联储 FOMC 日程' : '',
      go ? '点击在图上定位，再点取消' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  return `<div class="evr i${e.imp}${past ? ' past' : ''}${go ? ' go' : ''}${hlSel === k ? ' on' : ''}" data-key="${esc(k)}"${go ? ` data-ev="${esc(e.id)}"` : ''} title="${esc(tip)}"><div class="r1"><span class="et">${e.ts ? evTime(e.ts) : '时间未定'}</span><span class="cc">${esc(e.ccy)}</span><span class="im"><i></i><i></i><i></i></span><span class="en">${esc(evName(e))}${ok ? '<span class="ok">✓</span>' : ''}</span></div>${vals ? `<div class="ev2 mu sm">${vals}</div>` : ''}${e.ofs ? `<div class="ev2 warn sm">官方日程为 ${evTime(e.ofs)}，与此处时间不一致</div>` : ''}</div>`;
}
/* 事件页里的选项（重要性、国家、新闻主题、语言）：记在本地，改新闻选项时重新拉取 */
function setEvOpt(k, v) {
  EVO[k] = /^\d+$/.test(v) ? +v : v;
  LS.set('evOpt', EVO);
  if (k == 'nw' || k == 'lang') loadNews();
  evRedraw();
}
