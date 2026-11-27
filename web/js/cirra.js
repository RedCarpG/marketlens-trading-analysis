/* 桌宠 Cirra 播报：预警交给本地代理，由代理转给 Cirra 说出来（代理那边见 server/cirra.js） */
/* ===== 每次 alFire 发出预警时，按这里的勾选决定要不要交给 Cirra（是弹窗、系统通知之外的又一个出口，所以只在预警总开关开着时才有）。
   CI：本地记住的选项——on 总开关（默认开）；lv 价位、sc 情景（默认关，较频繁）；sl 我的止损 / 止盈、ev 经济事件（默认开）；
   ck 开仓体检（默认关：说的是你有没有守自己的规矩，会进她的通知记录和聊天上下文，要你自己打开）。
   给她念的是 alFire 的 say（比弹窗文字短、口语化），没有时用弹窗文字。只在经本地代理打开时有（公开演示页没有代理）。
   页面转去的“经济事件”，她自己连着日历时由她丢掉，不会说两遍 ===== */
let CI = { on: 1, lv: 0, sc: 0, sl: 1, ev: 1, ck: 0, ...LS.get('cirra', {}) },
  /* CS：/api/cirra/status——她在不在（running）、代理常驻预警看哪些（watch）、要不要显示“让 Cirra 分析”（ask）；CL：最近一次交给她的结果 { t, ok, reason } */
  CS = null,
  CL = null;
/* 交给代理的类型（决定她的表情）→ 属于哪个勾选 */
/* ml = 我画的线：和关键价位用同一个勾选，但类型分开（见 core/alertlog.js 的 lineText） */
const CIG = { lv: 'lv', ml: 'lv', sc: 'sc', scx: 'sc', dn: 'sl', up: 'sl', ev: 'ev', ck: 'ck', cko: 'ck' };
/* 品种念出来的名字：自选列表里“ · ”前面那段（如“黄金 GOLD”） */
const ciName = () => cur.name.split(' · ')[0];
async function ciPost(text, kind) {
  try {
    const r = await fetch('/api/cirra/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, kind }),
    });
    const j = await r.json().catch(() => ({}));
    CL = { t: Date.now(), ok: !!j.ok, reason: j.ok ? '' : j.reason || j.error || 'HTTP ' + r.status };
  } catch (_) {
    CL = { t: Date.now(), ok: false, reason: '代理没回话' };
  }
  if (!CL.ok && /没开/.test(CL.reason)) CS = { ...CS, running: false, reason: CL.reason };
  else if (CL.ok) CS = { ...CS, running: true };
  ciRedraw();
}
/* 当前品种和周期的价位、情景由代理的常驻预警负责时（server/watch.js），页面不再转发，免得说两遍 */
/* 只挡代理自己算得出来的那几类；我画的线（ml）代理不知道，照常转 */
/* 持仓那两类（止损 / 止盈、开仓体检）：代理的持仓看守（server/poswatch.js）看着这个品种、并且那一类开着时也不转发，由它说——页面关着它也在。
   它的两个开关存在代理那边（不是这个浏览器里），所以换个浏览器、关了页面都一样；没开的那一类页面照旧自己转 */
const ciPosOn = k =>
  !!(CS && CS.pos && CS.pos.on && CS.pos.prefs[k] && cur.srcs && CS.pos.symbols.includes(cur.srcs.etoro));
const ciByProxy = kind =>
  ((kind == 'lv' || kind == 'sc' || kind == 'scx') &&
    !!(CS && CS.watch) &&
    CS.watch.some(w => w.src == cur.src && w.symbol == ssym(cur) && w.tf == tf)) ||
  ((kind == 'dn' || kind == 'up') && ciPosOn('sl')) ||
  ((kind == 'ck' || kind == 'cko') && ciPosOn('ck'));
/* 改持仓看守的一个开关（k：sl / ck）：交给代理存着，回来的是它现在的状态 */
async function ciPosSet(k, v) {
  if (!CS || !CS.pos) return;
  const want = { ...CS.pos.prefs, [k]: v ? 1 : 0 };
  try {
    const r = await fetch('/api/cirra/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(want),
      }),
      j = await r.json().catch(() => ({}));
    if (j.ok && j.pos) CS = { ...CS, pos: j.pos };
  } catch (_) {}
  ciRedraw();
}
/* alFire 调用：kind 为上面 CIG 里的类型 */
function cirraSay(text, kind) {
  if (!LOCAL || !CI.on || !CI[CIG[kind]] || ciByProxy(kind)) return;
  ciPost(text, kind);
}
/* 状态每 30 秒查一次（只读：对她的端口发 GET，不会让她说话） */
async function ciStatus() {
  if (!LOCAL) return;
  try {
    CS = await (await fetch('/api/cirra/status')).json();
  } catch (_) {
    CS = { ...CS, running: false, reason: '代理没回话' };
  }
  ciRedraw();
}
if (LOCAL) setInterval(ciStatus, 30e3);
function ciRedraw() {
  if (typeof pane == 'function' && pane('al')) morph(pane('al'), alPanel());
}
/* 持仓看守的一块：页面关着也说的两样（开关存在代理那边），它上一条交给她的话（那句话里没有金额） */
function ciPosPanel() {
  const P = CS && CS.pos;
  if (!P || !P.on) return '';
  const hm = t => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    opt = (k, t, s) =>
      `<label class="opt"><span class="ot">${t}<small>${s}</small></span><input type="checkbox" class="sw" data-cip="${k}"${P.prefs[k] ? ' checked' : ''}></label>`,
    last = P.last
      ? `<div class="mu sm">它上一条 ${fmt('1d', P.last.t)} ${hm(P.last.t)}：${esc(P.last.text)}${P.last.ok ? '' : '（没说出去：' + esc(P.last.reason || '') + '）'}</div>`
      : '';
  return `<div class="alh ci"><div><b>页面关着也说</b><div class="mu sm">代理自己看 ${P.symbols.map(esc).join('、')} 的持仓</div>${last}</div></div>
<div class="opts">${opt('sl', '我的止损 / 止盈', '离它不到 0.5 个 ATR 时说一声')}${opt('ck', '开仓体检', '新开一笔时说哪几条守则没守；只有守则的名字，不带金额')}</div>
${P.err ? `<div class="note2">它上一次没看成：${esc(P.err)}</div>` : ''}
${more('它怎么看的', `代理每分钟读一次你的持仓，开机就在，不用开着这个页面；Cirra 没开、或者上面两样都没勾时它不读。这两个开关存在代理那边，和上面“Cirra 播报”的勾选、预警总开关是分开的；勾上的那一类由它说，页面在这个品种上就不再转发，免得说两遍。离止损多近按 1 小时图的 ATR 算（页面的弹窗按你当时在看的周期算，所以不一定同时响）。新开的一笔只在开仓后半小时内说。交给 Cirra 的只有一句话，没有金额、数量和盈亏。`)}`;
}
/* 预警页里的一块：总开关、她在不在、四个勾选、“试一下” */
function ciPanel() {
  if (!LOCAL) return '';
  const st = !CS
      ? '<span class="mu">查看中…</span>'
      : CS.running
        ? '<span class="ciok">● Cirra 在线</span>'
        : `<span class="cino" title="${esc(CS.reason || '')}">● Cirra 没开</span><span class="mu">（打开桌宠后自动连上）</span>`,
    last = CL
      ? `<div class="mu sm">上一条 ${new Date(CL.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} ${CL.ok ? '已交给 Cirra' : '没说出去：' + esc(CL.reason)}</div>`
      : '',
    opt = (k, t, s) =>
      `<label class="opt"><span class="ot">${t}<small>${s}</small></span><input type="checkbox" class="sw" data-ci="${k}"${CI[k] ? ' checked' : ''}${CI.on ? '' : ' disabled'}></label>`;
  return `<div class="alh ci"><div><b>Cirra 播报</b><div class="sm">${st}</div>${last}</div>
<button class="chip" id="cit" title="让 Cirra 说一句“MarketLens 连上了”">试一下</button>
<button class="swb${CI.on ? ' on' : ''}" data-ci-on role="switch" aria-checked="${!!CI.on}" title="${CI.on ? '不让 Cirra 播报' : '让 Cirra 播报'}"></button></div>
<div class="opts${CI.on ? '' : ' off'}">${opt('ev', '经济事件', '公布前 30 / 5 分钟、BLS 公布新数')}${opt('sl', '我的止损 / 止盈', '价格接近时')}${opt('ck', '开仓体检', '新开一笔时说哪几条守则没守；只有守则的名字，不带金额。默认不播')}${opt('lv', '关键价位', '较频繁，默认不播')}${opt('sc', '情景触发 / 失效', '默认不播')}</div>
<div class="note2">预警开着时，勾选的几类除了弹窗也交给桌宠 Cirra 说出来（经本地代理转发，她没开时跳过）。她那边的免打扰、专注时段照常生效。${CS && CS.watch && CS.watch.length ? `<br>代理在后台看 ${CS.watch.map(w => esc(w.name) + ' ' + TFN[w.tf]).join('、')} 的价位和情景，页面关着也会说，不受上面两个勾选影响；页面在同一品种和周期上不再重复转发。` : ''}</div>
${ciPosPanel()}`;
}
function setCiOn(v) {
  CI.on = v ? 1 : 0;
  LS.set('cirra', CI);
  ciRedraw();
}
function ciTest() {
  ciPost('MarketLens 连上了', 'test');
}
