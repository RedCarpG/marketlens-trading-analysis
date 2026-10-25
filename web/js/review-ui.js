/* 交易复盘面板：入口在“我的交易”块标题的“复盘”按钮。
   用当前已加载的各周期K线（含代理本地存储积累的更长历史）逐笔复盘，逐笔让出主线程，计算期间界面不卡。
   点表格里的一笔：关闭面板，在图上高亮这笔交易，并在右侧“交易”页选中它（在最近 10 笔里时）。 */
let RV = null;

async function openReview() {
  if (!TR || TR.sym !== cur.sym || TR.err) return;
  let el = $('#rvm');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rvm';
    document.body.appendChild(el);
    el.onclick = e => {
      if (e.target === el || e.target.closest('[data-rv-close]')) closeReview();
      const row = e.target.closest('tr[data-k]');
      if (row) {
        const r = RV.rvs[+row.dataset.i];
        closeReview();
        hlTrade(r.t, row.dataset.k, 1);
      }
    };
    document.addEventListener('keydown', e => e.key === 'Escape' && closeReview());
  }
  void el.offsetWidth; // 刚创建时先排版一次，淡入过渡才会生效
  el.classList.add('open');
  el.innerHTML = `<div class="rvp"><div class="rvh"><b>交易复盘 · ${cur.sym}</b><button data-rv-close>✕</button></div><div class="mu">正在逐笔复盘…</div></div>`;
  const trades = [
    ...TR.closed.map(t => ({ ...t, _k: 'c|' + t.id })),
    ...TR.open.map(t => ({ ...t, _k: 'o|' + t.id })),
  ].sort((a, b) => b.openTs - a.openTs);
  const rvs = [];
  for (const t of trades) {
    rvs.push(reviewTrade(t, ALL));
    await new Promise(r => setTimeout(r, 0));
  }
  RV = { sym: cur.sym, rvs, sum: summarizeReviews(rvs) };
  renderReview();
}

function closeReview() {
  const el = $('#rvm');
  if (el) el.classList.remove('open');
}

function renderReview() {
  const { rvs, sum } = RV,
    f = v => v.toFixed(cur.p),
    dc = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : 'var(--mu)'),
    sg = v => `${v >= 0 ? '+' : ''}${v.toFixed(Math.abs(v) >= 100 ? 0 : 2)}`,
    pct = (w, n) => (n ? Math.round((w / n) * 100) + '%' : '—'),
    open = rvs.filter(r => r.win == null).length;
  /* 分组表：笔数、胜率、净盈亏，右侧细条按净盈亏绝对值占比 */
  const gt = (title, gs) => {
    const mx = Math.max(1, ...gs.map(g => Math.abs(g.net)));
    return `<div><div class="mu sm">${title}</div><table><tr><th></th><th>笔数</th><th>胜率</th><th>净盈亏</th></tr>${gs
      .map(
        g =>
          `<tr><td>${g.name}</td><td>${g.n}</td><td>${pct(g.win, g.n)}</td><td style="color:${dc(g.net)}">${sg(g.net)}
<div class="rvbar" style="width:${(Math.abs(g.net) / mx) * 100}%;background:${dc(g.net)}"></div></td></tr>`
      )
      .join('')}</table></div>`;
  };
  const posName = r =>
    r.dir > 0
      ? { good: '靠近支撑做多', mid: '价位中间', bad: '顶着阻力做多' }[r.pos]
      : { good: '靠近阻力做空', mid: '价位中间', bad: '贴着支撑做空' }[r.pos];
  const tag = (txt, cls) => `<span class="tg-${cls}">${txt}</span>`;
  const rows = rvs
    .map((r, i) => {
      const t = r.t,
        head = `<td>${fmt('1h', t.openTs)}</td><td style="color:var(${t.isBuy ? '--tb' : '--ts'})">${t.isBuy ? '▲ 买' : '▼ 卖'}</td>
<td>${f(t.openRate)} → ${t.closeRate != null ? f(t.closeRate) : '持仓中'}</td><td style="color:${dc(t.netProfit ?? t.pnl ?? 0)}">${t.netProfit != null ? sg(t.netProfit) : t.pnl != null ? sg(t.pnl) + '（浮）' : '—'}</td>`;
      if (!r.ok) return `<tr data-k="${t._k}" data-i="${i}">${head}<td colspan="7" class="mu">${r.reason}</td></tr>`;
      return `<tr data-k="${t._k}" data-i="${i}">${head}<td>${r.tf}</td>
<td>${r.align > 0 ? tag('顺势', 'good') : r.align < 0 ? tag('逆势', 'bad') : tag('震荡', 'mid')}</td>
<td>${tag(posName(r), r.pos)}</td>
<td>${r.slAtr == null ? tag('未设', 'bad') : tag(r.slAtr.toFixed(1) + ' ATR', r.stop == 'ok' ? 'good' : 'bad')}</td>
<td>${r.r == null ? '—' : r.r.toFixed(1) + 'R'}</td><td>${r.sc ? tag(r.sc.kind, 'good') : '<span class="mu">—</span>'}</td><td>${fmtHold(r.holdH)}</td></tr>`;
    })
    .join('');
  $('#rvm').innerHTML = `<div class="rvp">
<div class="rvh"><b>交易复盘 · ${RV.sym} · 近一年 ${sum.n} 笔已平仓${open ? `（另 ${open} 笔持仓不计入统计）` : ''}</b><button data-rv-close>✕</button></div>
<div class="mu sm">只用开仓那一刻之前已收盘的K线，按与实时分析相同的规则重算当时的大周期方向、关键价位和情景；入场周期取 1h / 4h / 1d 中历史够用的最小一个。规则的初步回测未发现可靠优势（可在回测面板查看），只用来帮你反思交易习惯。</div>
<div class="rvs"><div><span class="mu sm">胜率</span><b>${pct(sum.win, sum.n)}</b><span class="mu sm">${sum.win}/${sum.n}</span></div>
<div><span class="mu sm">净盈亏</span><b style="color:${dc(sum.net)}">${sg(sum.net)}</b></div>
<div><span class="mu sm">平均持仓　盈利单</span><b>${fmtHold(sum.holdWin)}</b><span class="mu sm">· 亏损单</span><b>${fmtHold(sum.holdLoss)}</b></div></div>
${sum.insights.length ? `<div class="rvi"><b>值得注意</b><ul>${sum.insights.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
<div class="rvg">${gt('大周期方向', sum.groups.align)}${gt('入场位置', sum.groups.pos)}${gt('止损设置', sum.groups.stop)}${gt('价格行为情景', sum.groups.sc)}</div>
<div class="mu sm" style="margin:10px 0 4px">逐笔明细（点一行在图上查看这笔交易）</div>
<div class="rvtw"><table class="rvt"><tr><th>开仓</th><th>方向</th><th>入场 → 平仓</th><th>盈亏</th><th>周期</th><th>大周期</th><th>入场位置</th><th>止损</th><th>结果</th><th>情景</th><th>持仓</th></tr>${rows}</table></div></div>`;
}
