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
        hlTrade(r.t._o || r.t, row.dataset.k, 1);
      }
    };
    document.addEventListener('keydown', e => e.key === 'Escape' && closeReview());
  }
  void el.offsetWidth; // 刚创建时先排版一次，淡入过渡才会生效
  el.classList.add('open');
  el.innerHTML = `<div class="rvp"><div class="rvh"><b>交易复盘 · ${cur.sym}</b><button data-rv-close>✕</button></div><div class="mu">正在逐笔复盘…</div></div>`;
  /* 金额先换成交易页选的币种（已平仓按平仓日汇率，持仓按当前汇率），统计和洞察都按这个币种；_o 留着原记录给图上高亮用 */
  const ok = fxRate(null) != null,
    ccy = ok ? trCcy : 'USD',
    cv = (v, ts) => (v == null || !ok ? v : v * fxRate(ts));
  const trades = [
    ...TR.closed.map(t => ({ ...t, netProfit: cv(t.netProfit, t.closeTs), _o: t, _k: 'c|' + t.id })),
    ...TR.open.map(t => ({ ...t, pnl: cv(t.pnl, null), _o: t, _k: 'o|' + t.id })),
  ].sort((a, b) => b.openTs - a.openTs);
  /* 每笔顺手对照我的守则（core/rules.js）：同时持仓那条要看这个品种的全部交易 */
  const rvs = [],
    rows = [],
    cx = { events: EV && EV.events, ccy: ccyOf(), trades: [...TR.closed, ...TR.open] };
  for (const t of trades) {
    const rv = reviewTrade(t, ALL);
    rvs.push(rv);
    rows.push({ rv, res: checkRules(rv, JN.rules, cx) });
    await new Promise(r => setTimeout(r, 0));
  }
  RV = {
    sym: cur.sym,
    ccy,
    rvs,
    rows,
    rules: ruleStats(rows, JN.rules),
    sum: summarizeReviews(rvs, CCY[ccy][1]),
    /* 换一种出场会怎样（core/review.js 的 whatIf）、最近几周（core/rules.js 的 weekly） */
    whatif: whatIf(rvs, ALL),
    weeks: weekly(rows, t => jnNote(t._o || t), 6),
  };
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
    sg = v => fmtMoney(v, RV.ccy),
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
  /* 我的守则：每条没守 / 守住时各几笔、胜率、净盈亏 */
  const cell = c => (c.n ? `<td>${c.n}</td><td>${pct(c.win, c.n)}</td><td style="color:${dc(c.net)}">${sg(c.net)}</td>` : '<td class="mu">0</td><td class="mu">—</td><td class="mu">—</td>'),
    rules = RV.rules.length
      ? `<div class="rvr"><div class="mu sm">我的守则（已平仓的 ${sum.n} 笔里，每条没守和守住时的结果；笔数少时只当记录看）</div><table><tr><th></th><th colspan="3">没守</th><th colspan="3">守住</th><th>判断不了</th></tr>
<tr class="mu"><th></th><th>笔数</th><th>胜率</th><th>净盈亏</th><th>笔数</th><th>胜率</th><th>净盈亏</th><th></th></tr>${RV.rules
          .map(r => `<tr><td>${esc(r.text)}</td>${cell(r.broke)}${cell(r.kept)}<td class="mu">${r.unknown || ''}</td></tr>`)
          .join('')}</table></div>`
      : `<div class="mu sm rvr">还没有守则：在交易页点“守则”定几条，这里会统计每条没守时的结果。</div>`,
    atr = v => (v == null ? '—' : v.toFixed(1)),
    path = sum.path.lossMfe != null || sum.path.winMae != null ? `<div><span class="mu sm">走到过哪（ATR）　亏损单平均最高浮盈</span><b>${atr(sum.path.lossMfe)}</b><span class="mu sm">· 盈利单平均最深浮亏</span><b>${atr(sum.path.winMae)}</b></div>` : '';
  /* 最近几周：一周一行。周从周一 00:00 UTC 起 */
  const md = ts => {
      const d = new Date(ts);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    },
    weeks = RV.weeks.length
      ? `<div class="rvr rvw"><div class="mu sm">最近几周（周一 00:00 UTC 起；开仓、守则、日记算在开仓那周，盈亏算在平仓那周）</div><table><tr><th>周</th><th>开</th><th>平（赢）</th><th>净盈亏</th><th>守则没守</th><th>日记</th><th>这一周最该记住的</th></tr>${RV.weeks
          .map(
            w =>
              `<tr><td>${md(w.from)}–${md(w.to - 864e5)}</td><td>${w.opened}</td><td>${w.closed ? `${w.closed}（${w.win}）` : '—'}</td><td style="color:${dc(w.net)}">${w.closed ? sg(w.net) : '—'}</td>
<td${w.broke ? ' style="color:var(--dn)"' : ''}>${w.broke ? w.broke + ' 次' : RV.rules.length ? '0' : '—'}</td><td>${w.notes ? `${w.notes} 条${w.tags.length ? ' · ' + w.tags.map(g => esc(g)).join(' ') : ''}` : '—'}</td><td class="rvl">${esc(w.lesson)}</td></tr>`
          )
          .join('')}</table></div>`
      : '',
    rr = v => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}R`),
    wi = RV.whatif.some(w => w.n)
      ? `<div class="rvr"><div class="mu sm">如果换一种出场（同一批入场，按 R 也就是初始风险的倍数算，不计点差和隔夜费；用入场周期的K线从开仓下一根起模拟）</div><table><tr><th></th><th>笔数</th><th>实际平均</th><th>换成后平均</th><th>比实际好的</th><th></th></tr>${RV.whatif
          .map(
            w =>
              `<tr><td>${w.name}</td><td>${w.n}</td><td style="color:${dc(w.actual || 0)}">${rr(w.actual)}</td><td style="color:${dc(w.alt || 0)}">${rr(w.alt)}</td><td>${w.n ? `${w.better} / ${w.n}` : '—'}</td>
<td class="mu">${[w.assumed ? `${w.assumed} 笔没设止损，按 2 个 ATR 当风险` : '', w.pending ? `${w.pending} 笔K线不够走完，没算` : ''].filter(Boolean).join('；')}</td></tr>`
          )
          .join('')}</table><div class="mu sm">笔数少时只当参考：这是事后拿同一批入场重算，不代表以后也会这样。</div></div>`
      : '';
  const rows = rvs
    .map((r, i) => {
      const t = r.t,
        res = RV.rows[i].res,
        bad = res.items.filter(x => x.ok === false),
        note = jnNote(t._o || t),
        rule = !res.items.length
          ? '<span class="mu">—</span>'
          : bad.length
            ? `<span class="tg-bad" title="${esc(bad.map(x => x.text + (x.note ? '（' + x.note + '）' : '')).join('\n'))}">✕ ${bad.length}</span>`
            : res.kept
              ? tag('✓', 'good')
              : '<span class="mu">?</span>',
        diary = note ? `<span title="${esc(note.why)}">${note.tags.map(g => esc(g)).join(' ') || '✎'}</span>` : '',
        head = `<td>${fmt('1h', t.openTs)}</td><td style="color:var(${t.isBuy ? '--tb' : '--ts'})">${t.isBuy ? '▲ 买' : '▼ 卖'}</td>
<td>${f(t.openRate)} → ${t.closeRate != null ? f(t.closeRate) : '持仓中'}</td><td style="color:${dc(t.netProfit ?? t.pnl ?? 0)}">${t.netProfit != null ? sg(t.netProfit) : t.pnl != null ? sg(t.pnl) + '（浮）' : '—'}</td>`;
      if (!r.ok) return `<tr data-k="${t._k}" data-i="${i}">${head}<td colspan="8" class="mu">${r.reason}</td><td>${rule}</td><td class="mu">${diary}</td></tr>`;
      return `<tr data-k="${t._k}" data-i="${i}">${head}<td>${r.tf}</td>
<td>${r.align > 0 ? tag('顺势', 'good') : r.align < 0 ? tag('逆势', 'bad') : tag('震荡', 'mid')}</td>
<td>${tag(posName(r), r.pos)}</td>
<td>${r.slAtr == null ? tag('未设', 'bad') : tag(r.slAtr.toFixed(1) + ' ATR', r.stop == 'ok' ? 'good' : 'bad')}</td>
<td>${r.r == null ? '—' : r.r.toFixed(1) + 'R'}</td><td>${r.sc ? tag(r.sc.kind, 'good') : '<span class="mu">—</span>'}</td><td>${fmtHold(r.holdH)}</td>
<td title="持仓期间最深浮亏 / 最高浮盈，按开仓时的 ATR">${atr(r.mae)} / ${atr(r.mfe)}</td><td>${rule}</td><td class="mu">${diary}</td></tr>`;
    })
    .join('');
  $('#rvm').innerHTML = `<div class="rvp">
<div class="rvh"><b>交易复盘 · ${RV.sym} · 近一年 ${sum.n} 笔已平仓${open ? `（另 ${open} 笔持仓不计入统计）` : ''}</b><button data-rv-close>✕</button></div>
<div class="mu sm">只用开仓那一刻之前已收盘的K线，按与实时分析相同的规则重算当时的大周期方向、关键价位和情景；入场周期取 1h / 4h / 1d 中历史够用的最小一个。规则的初步回测未发现可靠优势（可在回测面板查看），只用来帮你反思交易习惯。</div>
<div class="rvs"><div><span class="mu sm">胜率</span><b>${pct(sum.win, sum.n)}</b><span class="mu sm">${sum.win}/${sum.n}</span></div>
<div><span class="mu sm">净盈亏（${CCY[RV.ccy][0]}）</span><b style="color:${dc(sum.net)}">${sg(sum.net)}</b></div>
<div><span class="mu sm">平均持仓　盈利单</span><b>${fmtHold(sum.holdWin)}</b><span class="mu sm">· 亏损单</span><b>${fmtHold(sum.holdLoss)}</b></div>${path}</div>
${sum.insights.length ? `<div class="rvi"><b>值得注意</b><ul>${sum.insights.map(s => `<li>${s}</li>`).join('')}</ul></div>` : ''}
${weeks}
${rules}
${wi}
<div class="rvg">${gt('大周期方向', sum.groups.align)}${gt('入场位置', sum.groups.pos)}${gt('止损设置', sum.groups.stop)}${gt('价格行为情景', sum.groups.sc)}${gt('开仓在星期几（UTC）', sum.groups.dow)}${gt('开仓时段（UTC）', sum.groups.sess)}</div>
<div class="mu sm" style="margin:10px 0 4px">逐笔明细（点一行在图上查看这笔交易）</div>
<div class="rvtw"><table class="rvt"><tr><th>开仓</th><th>方向</th><th>入场 → 平仓</th><th>盈亏</th><th>周期</th><th>大周期</th><th>入场位置</th><th>止损</th><th>结果</th><th>情景</th><th>持仓</th><th>浮亏 / 浮盈</th><th>守则</th><th>日记</th></tr>${rows}</table></div></div>`;
}
