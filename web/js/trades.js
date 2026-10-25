/* 我的交易：拉取、时间对齐、右侧面板 */
/* ===== 我的交易：eToro 品种为真实交易记录（经本地代理只读拉取，近 364 天已平仓与当前持仓）；
   不论当前用哪个数据服务看价格，只要品种有 eToro 代码就取真实交易（价格口径可能与图上略有差异）；
   模拟品种和比特币用模拟交易（simTrades，按K线确定性生成，标明“模拟”），公开页面上也能体验交易页、图上交易、复盘；CSV 不显示 ===== */
/* TRL：正在拉取（“刷新”按钮转圈） */
let TR = null,
  TRL = 0;
const hasTr = () => cur.src != 'csv';
async function loadTrades() {
  if (!hasTr()) {
    TR = null;
    return;
  }
  if (!(LOCAL && cur.srcs && cur.srcs.etoro)) {
    TR = simTrades(cur);
    if (bars.length) refresh();
    return;
  }
  const sym = cur.sym,
    esym = cur.srcs.etoro,
    t = { sym, closed: [], open: [], err: null, at: Date.now() };
  TRL = 1;
  if (bars.length) refresh();
  const get = async p => {
    const r = await fetch(p);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    return j;
  };
  try {
    [t.closed, t.open] = await Promise.all([
      get(`/api/etoro/trades?symbol=${esym}&days=364`),
      get(`/api/etoro/positions?symbol=${esym}`),
    ]);
  } catch (e) {
    t.err = e.message;
  }
  TRL = 0;
  if (cur.sym !== sym) return;
  TR = t;
  if (bars.length) refresh();
}
/* 模拟交易：在 1 小时K线上按品种代码做种子生成（同一品种每次一样），约 14 笔已平仓 + 1 笔持仓。
   每笔随机方向、持仓 3–36 根、杠杆 5–20 倍、名义金额约 2000 美元 × 杠杆；多数设止损（1.2–2.5 ATR）、部分设止盈（2–3 ATR），
   持仓期间触及止损/止盈就按该价平仓，否则按到期那根K线收盘平仓；盈亏扣一点手续费。只用于演示，与任何真实账户无关 */
function simTrades(it) {
  const b = ALL['1h'] || ALL[tf] || [],
    out = { sym: it.sym, closed: [], open: [], err: null, at: Date.now(), demo: 1 };
  if (b.length < 120) return out;
  let s = [...it.sym].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647,
    atr = i => b.slice(Math.max(0, i - 14), i + 1).reduce((a, x) => a + x.high - x.low, 0) / Math.min(15, i + 1),
    mk = (i, id) => {
      const dir = rnd() < 0.5 ? 1 : -1,
        lev = [5, 10, 10, 20][Math.floor(rnd() * 4)],
        p = b[i].close,
        x = atr(i);
      return {
        id,
        dir,
        isBuy: dir > 0,
        openTs: b[i].timestamp + Math.floor(rnd() * 50) * 60e3,
        openRate: p,
        leverage: lev,
        units: +((2000 * lev) / p).toFixed(p < 10 ? 0 : 4),
        sl: rnd() < 0.8 ? p - dir * x * (1.2 + rnd() * 1.3) : 0,
        tp: rnd() < 0.45 ? p + dir * x * (2 + rnd()) : 0,
      };
    };
  let i = Math.max(30, b.length - 480),
    n = 1;
  while (i < b.length - 45 && out.closed.length < 14) {
    const t = mk(i, 'sim' + n++),
      end = Math.min(b.length - 40, i + 3 + Math.floor(rnd() * 34));
    let j = i + 1,
      px = null;
    for (; j <= end && px == null; j++) {
      const k = b[j];
      if (t.sl && (t.dir > 0 ? k.low <= t.sl : k.high >= t.sl)) px = t.sl;
      else if (t.tp && (t.dir > 0 ? k.high >= t.tp : k.low <= t.tp)) px = t.tp;
    }
    j--;
    t.closeRate = px != null ? px : b[j].close;
    t.closeTs = b[j].timestamp + Math.floor(rnd() * 50) * 60e3;
    t.netProfit = +((t.closeRate - t.openRate) * t.dir * t.units - t.units * t.openRate * 0.0004).toFixed(2);
    delete t.dir;
    out.closed.push(t);
    i = j + 6 + Math.floor(rnd() * 30);
  }
  const k = b.length - 1 - (8 + Math.floor(rnd() * 20)),
    o = mk(k, 'sim-open'),
    last = b[b.length - 1].close;
  o.curRate = last;
  o.pnl = +((last - o.openRate) * o.dir * o.units).toFixed(2);
  delete o.dir;
  out.open.push(o);
  return out;
}
/* 交易时间对齐到所在K线的起点；早于已加载数据的返回 null */
function snapTs(t) {
  if (!bars.length || t < bars[0].timestamp) return null;
  let lo = 0,
    hi = bars.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (bars[m].timestamp <= t) lo = m;
    else hi = m - 1;
  }
  return bars[lo].timestamp;
}
/* 交易页：工具栏（图上显示、复盘、刷新）→ 近一年统计 → 当前持仓 → 最近 10 笔已平仓；行可点击定位 */
function trPanel() {
  const f = v => v.toFixed(cur.p),
    dc = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : 'var(--mu)'),
    sg = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`,
    on = k => (hlSel === k ? ' on' : ''),
    side = t => `<span style="color:var(${t.isBuy ? '--tb' : '--ts'})">${t.isBuy ? '▲ 买' : '▼ 卖'}</span>`,
    tools = `<div class="tbar">${chip('tr', '图上显示')}<span class="sp"></span><button class="chip" id="trv" title="逐笔复盘：开仓时的大周期、入场位置、止损、情景">复盘</button><button class="chip" id="trr" title="重新拉取交易记录">${TRL ? '<i class="spin"></i>' : ''}刷新</button></div>`;
  /* 模拟交易标明来源，免得误认为真实账户 */
  const demo =
    TR && TR.demo
      ? '<div class="note2">以下为模拟交易记录（按K线随机生成，仅用于演示），不是真实账户数据。eToro 真实交易需在本机运行代理后打开。</div>'
      : '';
  if (!TR || TR.sym !== cur.sym) return tools + '<div class="empty"><i class="spin"></i>加载中…</div>';
  if (TR.err) return tools + `<div class="empty">${TR.err}</div>`;
  const c = TR.closed,
    w = c.filter(t => t.netProfit > 0).length,
    net = c.reduce((s, t) => s + t.netProfit, 0),
    hold = c.length ? c.reduce((s, t) => s + (t.closeTs - t.openTs), 0) / c.length / 36e5 : null,
    op =
      TR.open
        .map(
          (p, i) =>
            `<div class="sg${on('o|' + p.id)}" data-key="o|${p.id}" data-tro="${i}" title="点击在图上定位，再点取消"><div class="r1">${side(p)}<span>${+p.units.toFixed(4)} @${f(p.openRate)}</span>${p.pnl != null ? `<b class="r" style="color:${dc(p.pnl)}">${sg(p.pnl)}</b>` : ''}</div>
<div class="mu sm">${fmt('1h', p.openTs)}${p.sl > 0 ? ` · 止损 ${f(p.sl)}` : ''}${p.tp > 0 ? ` · 止盈 ${f(p.tp)}` : ''}</div></div>`
        )
        .join('') || '<div class="empty">当前没有该品种持仓</div>',
    cl =
      c
        .slice(-10)
        .reverse()
        .map(
          t =>
            `<div class="sg${on('c|' + t.id)}" data-key="c|${t.id}" data-trc="${c.indexOf(t)}" title="点击在图上定位，再点取消"><div class="r1">${side(t)}<span>${f(t.openRate)} → ${f(t.closeRate)}</span><b class="r" style="color:${dc(t.netProfit)}">${sg(t.netProfit)}</b></div>
<div class="mu sm">${fmt('1h', t.openTs)} – ${fmt('1h', t.closeTs)} · ${+t.units.toFixed(4)} 单位 · ${t.leverage}x</div></div>`
        )
        .join('') || '<div class="empty">近一年没有该品种的已平仓交易</div>';
  return (
    tools +
    demo +
    `<div class="stats"><div class="stat"><span>近一年已平仓</span><b>${c.length} 笔</b></div><div class="stat"><span>胜率</span><b>${c.length ? Math.round((w / c.length) * 100) + '%' : '—'}</b></div>
<div class="stat"><span>净盈亏</span><b style="color:${dc(net)}">${sg(net)}</b></div><div class="stat"><span>平均持仓</span><b>${fmtHold(hold)}</b></div></div>` +
    blk('tro', `当前持仓 <span class="n">${TR.open.length}</span>`, op) +
    blk('trc', `最近平仓 <span class="n">${Math.min(10, c.length)}</span>`, cl)
  );
}
