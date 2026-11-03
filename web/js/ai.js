/* AI 分析：把当前分析整理成分析包（core/aipack.js），复制给 AI，或交给桌宠 Cirra 的 AI；计划见 docs/AI.md */
/* AIC：最近一次复制 { t, n 字数, ok }；AIR：最近一次“让 Cirra 分析” { busy, t, sym, tf, ok, text, summary, writer, cached, reason } */
let AIC = null,
  AIR = null;
const aiRedraw = () => lastM && morph(pane('an'), anPanel(lastM));
/* 从页面的全局状态收集分析包的输入 */
function aiInput() {
  const [nm, src] = cur.name.split(' · ');
  const nk = nwTopic() + '|' + EVO.lang,
    N = NW && NW.key == nk ? NW : null;
  return {
    item: {
      sym: cur.sym,
      name: nm,
      p: cur.p,
      source: cur.src == 'demo' ? '模拟数据' : cur.src == 'csv' ? '本地 CSV' : src || cur.src,
    },
    tf,
    all: ALL,
    C,
    m: lastM,
    now: Date.now(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    market: ($('#mkt') && $('#mkt').textContent) || null,
    events: !LOCAL
      ? { coverage: '未覆盖：公开演示页没有本地代理，没有检查经济日历' }
      : EV && EV.events
        ? {
            coverage: EV.err
              ? '上次的数据（刷新失败：' + EV.err + '）'
              : '已接入：Forex Factory 本周日历 + BLS / 美联储官方日程',
            list: EV.events,
            data: (EV.data && EV.data.items) || [],
            ccy: ccyOf(),
          }
        : { coverage: '未获取到' + (EV && EV.err ? '：' + EV.err : '（加载中）') },
    news: !LOCAL ? { coverage: '未覆盖：公开演示页没有本地代理' } : N && N.items ? N : { coverage: '新闻还没加载' },
    trades: TR && TR.sym === cur.sym && !TR.err ? TR : null,
  };
}
const aiText = () => packPrompt(buildPack(aiInput()));
/* 复制：本机地址和 https 下用剪贴板接口，不行时退回选中文本复制 */
async function aiCopy() {
  if (!bars.length) return;
  const text = aiText();
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch (_) {}
    ta.remove();
  }
  AIC = { t: Date.now(), n: text.length, ok };
  aiRedraw();
  /* 新闻还没拉过时顺便拉一次，下次复制就带上 */
  if (LOCAL && !(NW && NW.key == nwTopic() + '|' + EVO.lang)) loadNews();
}
/* 让 Cirra 分析：经本地代理交给她的 /ask（她聊天的那个模型、你的登录；不带工具、不进她的对话），
   整段回答显示在这里，开头那句结论她自己念。一般 1–2 分钟；她那边一次只做一份 */
async function aiAsk() {
  if (!LOCAL || !bars.length || (AIR && AIR.busy)) return;
  const sym = cur.sym,
    tf0 = tf;
  AIR = { busy: 1, t: Date.now(), sym, tf: tf0 };
  aiRedraw();
  let r;
  try {
    const res = await fetch('/api/ai/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: aiText() }),
    });
    r = await res.json().catch(() => ({}));
    if (!res.ok) r = { ok: false, reason: r.error || 'HTTP ' + res.status };
  } catch (_) {
    r = { ok: false, reason: '代理没回话' };
  }
  AIR = { ...r, busy: 0, t: r.at || Date.now(), sym, tf: tf0 };
  aiRedraw();
}
/* 回答里的 **粗体** 显示成粗体，其余原样（先转义再替换，外部文字进不了 HTML） */
const aiHtml = t => esc(t).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
/* 查看：在新标签页里看全文（纯文本） */
function aiView() {
  if (!bars.length) return;
  const u = URL.createObjectURL(new Blob([aiText()], { type: 'text/plain;charset=utf-8' }));
  window.open(u, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(u), 60e3);
}
/* 分析页里的一块 */
function aiBlock() {
  const st = AIC
    ? `<div class="mu sm">${new Date(AIC.t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} ${AIC.ok ? `已复制（约 ${(AIC.n / 1000).toFixed(1)} 千字）` : '复制失败，请点“查看”后手动复制'}</div>`
    : '';
  const hm = t => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }),
    off = CS && !CS.running,
    ask = LOCAL
      ? `<button class="chip" id="aia"${AIR && AIR.busy ? ' disabled' : ''} title="${off ? 'Cirra 现在没开' : '交给桌宠 Cirra 的 AI 分析（她聊天的那个模型），结论她会念出来'}">${AIR && AIR.busy ? '<i class="spin"></i>' : ''}让 Cirra 分析</button>`
      : '',
    res = !AIR
      ? ''
      : AIR.busy
        ? `<div class="air mu sm"><i class="spin"></i>Cirra 正在分析 ${esc(AIR.sym)} ${AIR.tf}…（一般 1–2 分钟）</div>`
        : AIR.ok
          ? `<div class="air"><div class="mu sm">${hm(AIR.t)} · ${esc(AIR.sym)} ${AIR.tf} · Cirra${AIR.writer ? '（' + esc(AIR.writer) + '）' : ''}${AIR.cached ? ' · 15 分钟内同一份，用的上次结果' : ''}${AIR.sym != cur.sym || AIR.tf != tf ? ' · <b>不是当前品种 / 周期</b>' : ''}</div><div class="airt">${aiHtml(AIR.text)}</div></div>`
          : `<div class="note2 aino">没分析成：${esc(AIR.reason || '')}</div>`;
  return blk(
    'ai',
    `AI 分析 <span class="mu">${LOCAL ? '交给 Cirra 或复制给 AI' : '复制给 AI'}</span>`,
    `<div class="tbar">${ask}<button class="chip" id="aic" title="把当前的多周期状态、价位、情景、K线、事件、新闻、我的持仓整理成分析包，连同提问一起复制">复制分析包</button><button class="chip" id="aiv" title="在新标签页里看要复制的全文">查看</button></div>
${res}${st}<div class="note2">${LOCAL ? '“让 Cirra 分析”用她聊天的那个模型（你的登录），需要新版 Cirra、并在她的设置里打开「MarketLens 行情」；结论她念出来，全文在这里。也可以复制' : '复制'}后粘贴到 claude.ai 等 AI 里。AI 只作分析助手：这些规则本身没有回测优势，AI 的判断也无法用历史回测检验。</div>`
  );
}
