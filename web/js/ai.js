/* AI 分析：把当前分析整理成分析包（core/aipack.js），复制给 AI；计划见 docs/AI.md（第①步：复制；之后接入 Cirra） */
/* AIC：最近一次复制 { t, n 字数, ok } */
let AIC = null;
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
  if (lastM) morph(pane('an'), anPanel(lastM));
  /* 新闻还没拉过时顺便拉一次，下次复制就带上 */
  if (LOCAL && !(NW && NW.key == nwTopic() + '|' + EVO.lang)) loadNews();
}
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
  return blk(
    'ai',
    'AI 分析 <span class="mu">复制给 AI</span>',
    `<div class="tbar"><button class="chip" id="aic" title="把当前的多周期状态、价位、情景、K线、事件、新闻、我的持仓整理成分析包，连同提问一起复制">复制分析包</button><button class="chip" id="aiv" title="在新标签页里看要复制的全文">查看</button></div>
${st}<div class="note2">粘贴到 claude.ai 或其他 AI 里，它会按固定结构给出倾向、要盯的价位、多空情景、事件风险和需要改变判断的条件。AI 只作分析助手：这些规则本身没有回测优势，AI 的判断也无法用历史回测检验。</div>`
  );
}
