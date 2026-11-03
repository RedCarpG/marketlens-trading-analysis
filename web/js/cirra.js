/* 桌宠 Cirra 播报：预警交给本地代理，由代理转给 Cirra 说出来（代理那边见 server/cirra.js） */
/* ===== 每次 alFire 发出预警时，按这里的勾选决定要不要交给 Cirra（是弹窗、系统通知之外的又一个出口，所以只在预警总开关开着时才有）。
   CI：本地记住的选项——on 总开关（默认开）；lv 价位、sc 情景（默认关，较频繁）；sl 我的止损 / 止盈、ev 经济事件（默认开）。
   给她念的是 alFire 的 say（比弹窗文字短、口语化），没有时用弹窗文字。只在经本地代理打开时有（公开演示页没有代理）。
   代理自己在播报经济日历时（/api/cirra/status 的 announce，server/announce.js），页面不再转“经济事件”，免得同一件事说两遍 ===== */
let CI = { on: 1, lv: 0, sc: 0, sl: 1, ev: 1, ...LS.get('cirra', {}) },
  /* CS：她在不在、代理播不播日历（/api/cirra/status）；CL：最近一次交给她的结果 { t, ok, reason } */
  CS = null,
  CL = null;
/* 交给代理的类型（决定她的表情）→ 属于哪个勾选 */
const CIG = { lv: 'lv', sc: 'sc', scx: 'sc', dn: 'sl', up: 'sl', ev: 'ev' };
/* 周期念出来的说法 */
const TFN = { '15m': '15 分钟', '1h': '1 小时', '4h': '4 小时', '1d': '日线', '1w': '周线', '1M': '月线' };
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
/* alFire 调用：kind 为上面 CIG 里的类型 */
function cirraSay(text, kind) {
  if (!LOCAL || !CI.on || !CI[CIG[kind]]) return;
  /* 还不知道代理播不播（状态没回来）时也先不转，宁可少说一次也不说两遍 */
  if (kind == 'ev' && (!CS || CS.announce !== null)) return;
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
<div class="opts${CI.on ? '' : ' off'}">${
    CS && CS.announce
      ? `<div class="opt"><span class="ot">经济事件<small>代理直接播报（页面关着也说）：${esc(CS.announce.ccy.join(' / '))} 公布前 30 / 5 分钟、BLS 新数${CS.announce.briefing ? '、每天 ' + esc(CS.announce.briefing) + ' 后一次早报' : ''}；在 .env 改（CIRRA_EVENTS、CIRRA_CCY、CIRRA_BRIEFING）</small></span><span class="tag">代理播报</span></div>`
      : opt('ev', '经济事件', '公布前 30 / 5 分钟、BLS 公布新数')
  }${opt('sl', '我的止损 / 止盈', '价格接近时')}${opt('lv', '关键价位', '较频繁，默认不播')}${opt('sc', '情景触发 / 失效', '默认不播')}</div>
<div class="note2">预警开着时，勾选的几类除了弹窗也交给桌宠 Cirra 说出来（经本地代理转发，她没开时跳过）。她那边的免打扰、专注时段照常生效。</div>`;
}
function setCiOn(v) {
  CI.on = v ? 1 : 0;
  LS.set('cirra', CI);
  ciRedraw();
}
function ciTest() {
  ciPost('MarketLens 连上了', 'test');
}
