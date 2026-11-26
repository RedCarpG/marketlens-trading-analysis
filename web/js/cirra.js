/* 桌宠 Cirra 播报：预警交给本地代理，由代理转给 Cirra 说出来（代理那边见 server/cirra.js） */
/* ===== 每次 alFire 发出预警时，按这里的勾选决定要不要交给 Cirra（是弹窗、系统通知之外的又一个出口，所以只在预警总开关开着时才有）。
   CI：本地记住的选项——on 总开关（默认开）；lv 价位、sc 情景（默认关，较频繁）；sl 我的止损 / 止盈、ev 经济事件（默认开）。
   给她念的是 alFire 的 say（比弹窗文字短、口语化），没有时用弹窗文字。只在经本地代理打开时有（公开演示页没有代理）。
   页面转去的“经济事件”，她自己连着日历时由她丢掉，不会说两遍 ===== */
let CI = { on: 1, lv: 0, sc: 0, sl: 1, ev: 1, ...LS.get('cirra', {}) },
  /* CS：/api/cirra/status——她在不在（running）、代理常驻预警看哪些（watch）、要不要显示“让 Cirra 分析”（ask）；CL：最近一次交给她的结果 { t, ok, reason } */
  CS = null,
  CL = null;
/* 交给代理的类型（决定她的表情）→ 属于哪个勾选 */
const CIG = { lv: 'lv', sc: 'sc', scx: 'sc', dn: 'sl', up: 'sl', ev: 'ev' };
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
const ciByProxy = kind =>
  CIG[kind] != 'sl' &&
  CIG[kind] != 'ev' &&
  !!(CS && CS.watch) &&
  CS.watch.some(w => w.src == cur.src && w.symbol == ssym(cur) && w.tf == tf);
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
<div class="opts${CI.on ? '' : ' off'}">${opt('ev', '经济事件', '公布前 30 / 5 分钟、BLS 公布新数')}${opt('sl', '我的止损 / 止盈', '价格接近时')}${opt('lv', '关键价位', '较频繁，默认不播')}${opt('sc', '情景触发 / 失效', '默认不播')}</div>
<div class="note2">预警开着时，勾选的几类除了弹窗也交给桌宠 Cirra 说出来（经本地代理转发，她没开时跳过）。她那边的免打扰、专注时段照常生效。${CS && CS.watch && CS.watch.length ? `<br>代理在后台看 ${CS.watch.map(w => esc(w.name) + ' ' + TFN[w.tf]).join('、')} 的价位和情景，页面关着也会说，不受上面两个勾选影响；页面在同一品种和周期上不再重复转发。` : ''}</div>`;
}
function setCiOn(v) {
  CI.on = v ? 1 : 0;
  LS.set('cirra', CI);
  ciRedraw();
}
function ciTest() {
  ciPost('MarketLens 连上了', 'test');
}
