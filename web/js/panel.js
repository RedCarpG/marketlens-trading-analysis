/* 周期矩阵与右侧面板 */
/* 右侧面板分三个标签页：分析 / 交易（仅 eToro 品种）/ 预警。每次刷新（实时约 300ms 一次）三页都重新生成 HTML，
   由 morph 只更新变化的部分（过渡动画、悬停、滚动位置都不受影响）；点击、勾选、块开合在 #pn 上统一委托处理 */
function matrix() {
  const el = $('#mx');
  if (cur.src == 'csv') {
    morph(el, '<div class="mu sm">CSV 导入为单一周期，不做多周期分析。</div>');
    morph($('#mxs'), '');
    return;
  }
  const f = v => (v == null ? '—' : v.toFixed(cur.p)),
    dc = d => (d > 0 ? 'var(--up)' : d < 0 ? 'var(--dn)' : 'var(--mu)');
  /* 顶栏“周期”按钮上：各周期方向的圆点（1M → 15m），当前周期加圈 */
  morph(
    $('#mxs'),
    [...TFS]
      .reverse()
      .filter(k => C[k] && C[k].a)
      .map(
        k => `<i class="${k == tf ? 'cur' : ''}" style="background:${dc(C[k].bias)}" title="${k} ${BT[C[k].bias]}"></i>`
      )
      .join('')
  );
  /* 前高/前低相对最新价：显示价格、形成时间、距最新价百分比；刚被突破/跌破的那个写在下面 */
  const now = bars.length ? bars[bars.length - 1].close : 0,
    pc = p => `${p > now ? '+' : ''}${((p / now - 1) * 100).toFixed(1)}%`,
    hc = (k, q, b, w) =>
      (q
        ? `${f(q.p)} <span class="mu">${fmt(k, q.ts)} · ${pc(q.p)}</span>`
        : `<span class="mu">近期${w == '突破' ? '新高' : '新低'}</span>`) +
      (b ? `<div class="mu">已${w} ${f(b.p)}</div>` : '');
  morph(
    el,
    `<table><tr><th>周期</th><th>层级</th><th>方向</th><th>前高</th><th>前低</th><th>最近信号</th><th>最后收盘K线</th></tr>${[
      ...TFS,
    ]
      .reverse()
      .map(k => {
        const x = C[k];
        if (!x)
          return `<tr data-f="${k}" class="${k == tf ? 'on' : ''}"><td>${k}</td><td>${ROLE[k]}</td><td colspan="5" class="mu">无数据</td></tr>`;
        if (!x.a)
          return `<tr data-f="${k}" class="${k == tf ? 'on' : ''}"><td>${k}</td><td>${ROLE[k]}</td><td colspan="5" class="mu">已收盘K线 ${x.n} 根，不足 60</td></tr>`;
        const r = prevHL(x, now),
          g = x.a.sigs[x.a.sigs.length - 1];
        return `<tr data-f="${k}" class="${k == tf ? 'on' : ''}"><td><b>${k}</b></td><td class="mu">${ROLE[k]}</td><td style="color:${dc(x.bias)}">${BT[x.bias]}${x.ok ? '' : ' <span class="mu">(参考)</span>'}</td><td>${hc(k, r.hi, r.hiB, '突破')}</td><td>${hc(k, r.lo, r.loB, '跌破')}</td>
<td>${g ? `<span style="color:${dc(g.dir)}">${g.dir > 0 ? '▲' : '▼'}</span> ${g.t} <span class="mu">${x.n - 1 - g.i} 根前</span>` : '<span class="mu">—</span>'}</td><td class="mu">${fmt(k, x.asof)}</td></tr>`;
      })
      .join('')}</table>`
  );
}
function refresh() {
  C[tf] = ctx(tf, bars);
  matrix();
  hdr();
  const m = analyzeMTF(tf, C, bars.length ? bars[bars.length - 1].close : null);
  drawMarks(m);
  evalAlerts(m);
  if (m)
    m.t.a.sigs
      .filter(g => g.i === m.t.n - 1)
      .forEach(g => {
        const k = cur.sym + tf + g.ts + g.t;
        if (!seen.has(k)) {
          seen.add(k);
          Alerts.emit(g, { symbol: cur.sym, tf });
        }
      });
  morph(pane('an'), m ? anPanel(m) : '<div class="empty">已收盘K线不足 60 根，无法分析</div>');
  if (hasTr()) morph(pane('tr'), trPanel());
  morph(pane('al'), alPanel());
  tabBadges();
  legend();
  nowMark();
}
/* 分析页：评分卡（评分、多周期结论）→ 评分说明 → 情景 → 关键价位 → 近期信号 → 关键数值 */
function anPanel(m) {
  const a = m.t.a,
    f = v => v.toFixed(cur.p),
    d = m.v,
    dc = d => (d > 0 ? 'var(--up)' : d < 0 ? 'var(--dn)' : 'var(--mu)'),
    vt = d > 0 ? '偏多' : d < 0 ? '偏空' : '观望',
    ch =
      m.chain
        .map(c => `<span class="cp" style="--c:${dc(c.d)}">${c.tf} ${c.t}</span><span class="ar">›</span>`)
        .join('') + `<span class="cp cur">${tf}</span>`,
    nw = bars[bars.length - 1].close,
    al = dir => (m.want ? `<span class="tag">${dir == m.want ? '顺大周期' : '逆大周期'}</span>` : ''),
    /* 价格行为情景：每个价位一张卡片；有仍有效的触发时显示入场/止损/目标，否则列出两个条件情景 */
    lvi = l => `${l.tfs.join('·')}${l.touch >= 3 ? ` · 挡回${l.touch}次` : ''}`,
    scn =
      m.sc
        .map(c => {
          const act = c.trigs.some(g => g.state == '已触发'),
            head =
              c.k == 'Z'
                ? `<div class="row"><b>价格位于区间 ${f(c.lo.p)} – ${f(c.hi.p)}</b><span class="mu sm">下沿 ${lvi(c.lo)}；上沿 ${lvi(c.hi)}</span></div>`
                : `<div class="row"><b style="color:${dc(c.k == 'S' ? 1 : -1)}">${c.k == 'S' ? '支撑' : '阻力'} ${f(c.lv.p)}</b><span class="mu sm">${lvi(c.lv)} · ${(Math.abs(c.lv.p - nw) / a.a).toFixed(1)} ATR</span></div>`;
          const key = 'v|' + c.k + '|' + (c.k == 'Z' ? c.lo.p : c.lv.p);
          return `<div class="sc${act ? ' act' : ''}${hlSel === key ? ' on' : ''}" data-key="${key}" data-sc="${m.sc.indexOf(c)}" title="点击在图上标出并定位，再点取消">${head}${c.trigs
            .map(
              g => `<div><span style="color:${dc(g.dir)}">${g.dir > 0 ? '▲' : '▼'} ${g.kind}${g.dir > 0 ? '做多' : '做空'}</span><span class="tag">${g.state} · ${g.ago} 根前</span>${al(g.dir)}</div>
<div class="row sm"><span>入场 / 止损 / 目标</span><b>${f(g.entry)} / ${f(g.stop)} / ${f(g.tgt)}</b></div>
<div class="mu sm">触发K线：${g.shape}；目标依据 ${g.tl ? g.tl.tfs.join('·') + ' 价位' : '2 倍风险'}；盈亏比 1:${g.rr.toFixed(1)}（未计成本）</div>`
            )
            .join('')}
${act ? '' : c.alt.map(o => `<div class="mu sm">· 若${o.c} → <span style="color:${dc(o.dir)}">${o.dir > 0 ? '做多' : '做空'}</span>，目标 ${o.t ? f(o.t.p) : '2 倍风险'}${al(o.dir)}</div>`).join('')}</div>`;
        })
        .join('') || '<div class="empty">附近没有关键价位</div>',
    /* 关键价位：上方阻力从高到低、中间最新价、下方支撑从高到低 */
    ML = mainLv(m.L, nw, a.a, tf),
    lvr = l =>
      `<div class="lvr${hlSel === 'l|' + l.p ? ' on' : ''}" data-key="l|${l.p}" data-lv="${l.p}" title="点击在图上标出并定位到最近一次触及，再点取消"><span class="d" style="background:${dc(l.side)}"></span><b style="color:${dc(l.side)}">${f(l.p)}</b><span class="mu sm">${l.side > 0 ? '支撑' : '阻力'} · ${lvi(l)}</span><span class="mu sm">${(Math.abs(l.p - nw) / a.a).toFixed(1)} ATR</span></div>`,
    keys =
      [...ML.res]
        .sort((u, v) => v.p - u.p)
        .map(lvr)
        .join('') +
      `<div class="lvnow">最新 ${f(nw)}</div>` +
      [...ML.sup]
        .sort((u, v) => v.p - u.p)
        .map(lvr)
        .join(''),
    sigs = a.sigs.slice(-8).reverse(),
    sgl =
      sigs
        .map(g => {
          const k = 's|' + g.ts + '|' + g.t;
          return `<div class="sg${hlSel === k ? ' on' : ''}" data-key="${k}" data-n="${a.sigs.indexOf(g)}" title="点击在图上定位，再点取消"><div class="r1"><span style="color:${dc(g.dir)}">${g.dir > 0 ? '▲' : '▼'}</span><span>${g.t}</span><span class="mu sm r">${fmt(tf, g.ts)}</span></div></div>`;
        })
        .join('') || '<div class="empty">暂无</div>';
  return `<section class="hero">
<div class="hrow"><span class="lbl">入场时机评分</span><span class="tag">${m.st}</span></div>
<div class="big" style="color:${dc(d)}">${m.s}<small>${vt}</small></div>
<div class="meter"><i style="left:${m.s}%"></i></div>
<div class="mu sm">本周期 ${a.s}，大周期方向 ${m.adj >= 0 ? '+' : ''}${m.adj}</div>
<div class="lbl" style="margin-top:10px">多周期结论</div><div class="chain">${ch}</div>
</section>
${m.why.length ? blk('why', `评分说明 <span class="n">${m.why.length}</span>`, `<ul class="why">${m.why.map(w => `<li>${w}</li>`).join('')}</ul>`) : ''}
${blk('sc', `价格行为情景 <span class="mu">${tf} · 纯K线</span>`, scn, chip('pl', '图上'))}
${blk('lv', `关键价位 <span class="mu">${tf} 及更大</span>`, keys, chip('hl', '前高前低') + chip('sr', '支撑阻力'))}
${blk('sg', `近期信号 <span class="n">${sigs.length}</span>`, sgl, chip('ar', '图上'))}
${blk('kv', `关键数值 <span class="mu">${tf}</span>`, `<div class="row"><span>RSI(14)</span><b>${a.rsi.toFixed(1)}</b></div><div class="row"><span>ATR(14)</span><b>${f(a.a)}</b></div>${a.hv ? '' : '<div class="row"><span>成交量</span><b class="mu">无（放量项不计分）</b></div>'}`)}
<p class="disc">信号、评分与情景由规则自动生成，未经回测，仅作辅助参考，不构成投资建议。演示数据为随机模拟。</p>`;
}
/* 预警页：总开关、三类提醒（可单独勾选）、通知权限状态、最近 10 条预警 */
function alPanel() {
  const np = !('Notification' in window)
      ? '浏览器不支持系统通知，只在页面内弹出'
      : Notification.permission === 'granted'
        ? '系统通知：已允许'
        : Notification.permission === 'denied'
          ? '系统通知：已被浏览器拒绝（可在网站设置里改回允许），只在页面内弹出'
          : '系统通知：开启预警时会请求权限',
    opt = (k, t, s) =>
      `<label class="opt"><span class="ot">${t}<small>${s}</small></span><input type="checkbox" class="sw" data-al="${k}"${AL[k] ? ' checked' : ''}></label>`,
    lg =
      alLog
        .slice(0, 10)
        .map(
          a =>
            `<div class="lg k-${a.kind}"><span class="mu">${new Date(a.t).toLocaleTimeString('zh-CN', { hour12: false })}</span>${a.text}</div>`
        )
        .join('') || '<div class="empty">暂无</div>';
  return `<div class="alh"><div><b>价格预警</b><div class="mu sm">${AL.on ? `<span class="lvd"></span>监控中 · ${cur.sym} · ${tf}` : '未开启'}</div></div>
<button class="swb${AL.on ? ' on' : ''}" data-al-on role="switch" aria-checked="${!!AL.on}" title="${AL.on ? '关闭预警' : '开启预警'}"></button></div>
<div class="opts">${opt('lv', '到达关键价位', '价格进入关键价位 ±0.15 ATR')}${opt('sc', '情景触发 / 失效', '价格行为情景状态变化')}${opt('sl', '接近我的止损 / 止盈', '距离 0.5 ATR 以内（eToro 持仓）')}</div>
<div class="note2">只监控当前品种和周期，需保持页面打开；开启后自动连接实时行情。${np}。</div>
${blk('all', `最近预警 <span class="n">${Math.min(10, alLog.length)}</span>`, lg)}`;
}
/* 右侧可折叠块：标题右侧放该块对应的图上标注开关；开合状态记在本地，默认展开 */
let BLK = LS.get('blk', {});
const chip = (k, label) =>
  `<button class="chip${MK[k] ? ' on' : ''}" data-mk="${k}" title="在图上显示/隐藏"><svg width="18" height="9" viewBox="0 0 22 10">${SW[k]}</svg>${label}</button>`;
const blk = (id, title, body, tools = '') =>
  `<details class="blk" data-b="${id}"${BLK[id] === 0 ? '' : ' open'}><summary><span class="bt">${title}</span><span class="btools">${tools}</span></summary><div class="bb">${body}</div></details>`;
/* 切换某类图上标注：顶栏“标注”菜单和块内开关共用，保持同步 */
function setMK(k) {
  if (hlSel && ((k == 'tr' && hlSel[0] != 's') || (k == 'ar' && hlSel[0] == 's'))) clearHl(); // 避免与高亮时临时画出的图形重复
  MK[k] = MK[k] ? 0 : 1;
  LS.set('marks', MK);
  document.querySelectorAll(`[data-m="${k}"],[data-mk="${k}"]`).forEach(b => b.classList.toggle('on', !!MK[k]));
  drawMarks(lastM);
  ddCount();
}

/* ===== 标签页 ===== */
/* TAB 为当前页（记在本地）；alNew 为不在预警页时新出现的预警数，切到预警页清零 */
let TAB = LS.get('pnTab', 'an'),
  alNew = 0;
const pane = k => $(`#pn .tabp[data-p="${k}"]`);
function setTab(k, save = 1) {
  if (k == 'tr' && !hasTr()) k = 'an';
  TAB = k;
  if (save) LS.set('pnTab', k);
  if (k == 'al') alNew = 0;
  /* 面板标签和收起后图标条上的同一页一起高亮 */
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab == k));
  document.querySelectorAll('#pn .tabp').forEach(p => p.classList.toggle('on', p.dataset.p == k));
  tabBadges();
}
/* 标签上的徽标：交易 = 当前持仓笔数；预警 = 未读条数，开着且无未读时为呼吸圆点。非 eToro 品种隐藏“交易” */
function tabBadges() {
  const et = hasTr(),
    n = TR && TR.sym === cur.sym ? TR.open.length : 0;
  document.querySelectorAll('[data-tab="tr"]').forEach(b => {
    b.hidden = !et;
    b.querySelector('.bdg').textContent = n || '';
  });
  if (!et && TAB == 'tr') return setTab('an', 0);
  document.querySelectorAll('[data-tab="al"] .bdg').forEach(b => {
    b.textContent = alNew || '';
    b.classList.toggle('live', !!AL.on);
  });
  segInd($('#pnt'));
}
/* 本页的块：有展开的就全部收起，否则全部展开（开合状态由 toggle 事件记下） */
function foldAll() {
  const ds = [...pane(TAB).querySelectorAll('details.blk')],
    o = !ds.some(d => d.open);
  ds.forEach(d => (d.open = o));
}
function initPanel() {
  const el = $('#pn');
  el.addEventListener('click', e => {
    const q = s => e.target.closest(s);
    let x;
    if ((x = q('[data-tab]'))) return setTab(x.dataset.tab);
    if (q('#fold')) return foldAll();
    if (q('#pcol')) return setPcol(1);
    /* 块标题里的按钮：只做自己的事，不触发块的开合 */
    if ((x = q('[data-mk]'))) {
      e.preventDefault();
      return setMK(x.dataset.mk);
    }
    if (q('[data-al-on]')) return setAlertsOn(!AL.on);
    if (q('#trr')) return loadTrades();
    if (q('#trv')) return openReview();
    if ((x = q('.sg[data-n]'))) return lastM && hlSig(lastM.t.a.sigs[+x.dataset.n]);
    if ((x = q('.lvr[data-lv]'))) return lastM && hlLevel(lastM.L.find(l => l.p == +x.dataset.lv));
    if ((x = q('.sc[data-sc]'))) return lastM && hlScene(lastM.sc[+x.dataset.sc]);
    if ((x = q('.sg[data-trc]'))) return hlTrade(TR.closed[+x.dataset.trc], x.dataset.key);
    if ((x = q('.sg[data-tro]'))) return hlTrade(TR.open[+x.dataset.tro], x.dataset.key);
  });
  el.addEventListener('change', e => {
    const c = e.target;
    if (!c.dataset.al) return;
    AL[c.dataset.al] = c.checked ? 1 : 0;
    LS.set('alerts', AL);
    alKey = '';
  });
  /* 块的开合记在本地；toggle 不冒泡，在捕获阶段统一接收 */
  el.addEventListener(
    'toggle',
    e => {
      const d = e.target;
      if (!d.matches('details.blk')) return;
      BLK[d.dataset.b] = d.open ? 1 : 0;
      LS.set('blk', BLK);
    },
    true
  );
  /* 周期矩阵在顶栏下拉里：点一行切换周期并收起 */
  $('#mx').addEventListener('click', e => {
    const r = e.target.closest('tr[data-f]');
    if (!r) return;
    document.querySelectorAll('.dd.open').forEach(x => x.classList.remove('open'));
    setTf(r.dataset.f);
  });
  setTab(TAB, 0);
}
