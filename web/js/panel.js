/* 周期矩阵与右侧面板 */
/* 右侧面板分四个标签页：分析 / 交易 / 事件（经济日历与新闻，见 events.js）/ 预警。每次刷新（实时约 300ms 一次）各页都重新生成 HTML，
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
  morph(pane('ev'), evPanel());
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
${g.trail != null && g.state == '已触发' ? `<div class="row sm"><span>移动止损（回撤 ${SC_DEF.trail} ATR）</span><b>${f(g.trail)}</b></div>` : ''}
<div class="mu sm">触发K线：${g.shape}；目标依据 ${g.tl ? g.tl.tfs.join('·') + ' 价位' : '2 倍风险'}；盈亏比 1:${g.rr.toFixed(1)}（未计成本）</div>`
            )
            .join('')}
${
  act
    ? ''
    : c.alt
        .filter(o => !o.off)
        .map(
          o =>
            `<div class="mu sm">· 若${o.c} → <span style="color:${dc(o.dir)}">${o.dir > 0 ? '做多' : '做空'}</span>，目标 ${o.t ? f(o.t.p) : '2 倍风险'}${al(o.dir)}</div>`
        )
        .join('') || `<div class="mu sm">· ${tf} 本周期价位，只作参考：情景只在更大周期的价位上触发</div>`
}</div>`;
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
${evRisk()}
</section>
${aiBlock()}
${m.why.length ? blk('why', `评分说明 <span class="n">${m.why.length}</span>`, `<ul class="why">${m.why.map(w => `<li>${w}</li>`).join('')}</ul>`) : ''}
${blk('sc', `价格行为情景 <span class="mu">${tf} · 纯K线</span>`, scn, chip('pl', '图上') + '<button class="chip" id="btgo" title="用当前品种的历史K线回测情景、信号和评分（B）">回测</button>')}
${blk('lv', `关键价位 <span class="mu">${tf} 及更大</span>`, keys, chip('hl', '前高前低') + chip('sr', '支撑阻力'))}
${blk('sg', `近期信号 <span class="n">${sigs.length}</span>`, sgl, chip('ar', '图上'))}
${blk('kv', `关键数值 <span class="mu">${tf}</span>`, `<div class="row"><span>RSI(14)</span><b>${a.rsi.toFixed(1)}</b></div><div class="row"><span>ATR(14)</span><b>${f(a.a)}</b></div>${volBlock()}${a.hv ? '' : '<div class="row"><span>成交量</span><b class="mu">无（放量项不计分）</b></div>'}`)}
${ssBlock()}
<p class="disc">信号、评分与情景由规则自动生成，初步回测未发现可靠优势，仅作辅助参考，不构成投资建议。演示数据为随机模拟。</p>`;
}
/* 波动状态（分析页“关键数值”里，ATR 那一行下面）：当前周期的 ATR(14) 在过去一年里排在什么位置，一句事实 + 一条刻度 + 怎么比的。
   计算在 core/context.js 的 volState；已收盘K线没变就不重算 */
let volMemo = { k: '', v: null };
function volBlock() {
  const b = closed(tf, bars),
    k = [cur.sym, cur.src, tf, b.length, b.length ? b[b.length - 1].timestamp : 0].join('|');
  if (volMemo.k !== k) volMemo = { k, v: volState(b) };
  const v = volMemo.v;
  if (!v) return '<div class="volst"><div class="mu sm">波动状态：已收盘K线太少，排不了位</div></div>';
  return `<div class="volst"><div class="vt">${volText(v, { T: tf, dp: cur.p })}</div>
<div class="vbar" title="左边是最小，右边是最大"><i style="left:${((v.below / v.n) * 100).toFixed(1)}%"></i></div>
<div class="mu sm">和它之前 ${v.n} 根已收盘K线（${fmt(tf, v.from)} 起）的 ATR(14) 比，其中 ${v.below} 根比它小。只说波动大小，不说方向。</div></div>`;
}
/* 交易时段（分析页最下面一块）：现在是哪个时段、各时段平常的波幅。时段按 UTC 划分（core/context.js 的 SESS）。
   波幅用已加载的 1 小时K线算（没有时用 15 分钟）：每天每个时段里最高价减最低价，再取平均；旁边写它相当于几个日线 ATR。
   看哪个周期这一块都在；图上的底色只在 15 分钟、1 小时周期画 */
let ssMemo = { k: '', v: null };
function ssBlock() {
  const T = cur.src == 'csv' ? null : ['1h', '15m'].find(k => ALL[k] && ALL[k].length);
  if (!T) return '';
  const b = closed(T, ALL[T]),
    k = [cur.sym, cur.src, T, b.length, b.length ? b[b.length - 1].timestamp : 0].join('|');
  if (ssMemo.k !== k) ssMemo = { k, v: sessStats(b, T) };
  const st = ssMemo.v,
    f = v => v.toFixed(cur.p),
    da = C['1d'] && C['1d'].a ? C['1d'].a.a : null,
    now = Date.now(),
    /* 本机时间的几点：按今天算（夏令时跟着变）；整点只写点数，差半小时的时区写出分钟 */
    lh = h => {
      const d = new Date(new Date(now).setUTCHours(h % 24, 0, 0, 0));
      return d.getHours() + (d.getMinutes() ? ':' + String(d.getMinutes()).padStart(2, '0') : '');
    },
    cs = SESS.find(s => s.k == sessOf(now)),
    rows = st.rows
      .map(r => {
        const s = SESS.find(q => q.k == r.k);
        return `<div class="ssr${cs.k == r.k ? ' now' : ''}"><i class="d" style="background:${SESSC[r.k]}"></i><span class="sn"><b>${s.n}</b><small>UTC ${s.from}–${s.to} 点 · 本机 ${lh(s.from)}–${lh(s.to)} 点</small></span>${
          r.n
            ? `<span class="sv" title="${r.n} 天的平均"><b>${f(r.avg)}</b><small>${da ? (r.avg / da).toFixed(2) + ' 个日线 ATR' : r.n + ' 天'}</small></span>`
            : '<span class="sv mu sm">没有够整段的K线</span>'
        }</div>`;
      })
      .join('');
  return blk(
    'ss',
    `交易时段 <span class="mu">平常的波幅</span>`,
    `<div class="mu sm ssn">现在是${cs.n}（UTC ${new Date(now).toISOString().slice(11, 16)}）</div>${rows}
<div class="note2">波幅 = 一个时段里最高价减最低价，对已加载的 ${TFN[T]}K线里的 ${st.days} 天（${fmt('1d', st.from)} 起）取平均，单位是价格${da ? `；旁边是它相当于几个日线 ATR（现在的日线 ATR ${f(da)}）` : ''}。还没走完的时段、K线不到一半的时段不算。${SESS_TFS.includes(tf) ? '' : `图上的底色只在 15 分钟、1 小时周期画，${tf} 周期不画。`}</div>`,
    chip('ss', '图上')
  );
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
<div class="opts">${opt('lv', '到达关键价位', '价格进入关键价位 ±0.15 ATR')}${opt('sc', '情景触发 / 失效', '价格行为情景状态变化')}${opt('sl', '接近我的止损 / 止盈', '距离 0.5 ATR 以内（eToro 持仓）')}${opt('ck', '开仓体检', '新开一笔时对照我的守则，说哪几条没守（eToro 持仓，每分钟看一次；守则在交易页定）')}${opt('ev', '重要经济事件', `${ccyOf().join(' / ')} 高影响事件公布前 30 / 5 分钟；BLS 公布新的非农、CPI 时（需本地代理）`)}</div>
<div class="note2">价位、情景、止损止盈只监控当前品种和周期，需保持页面打开；开启后自动连接实时行情。${np}。</div>
${ciPanel()}
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
  if (k == 'ev') loadNews();
  /* 面板标签和收起后图标条上的同一页一起高亮 */
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab == k));
  document.querySelectorAll('#pn .tabp').forEach(p => p.classList.toggle('on', p.dataset.p == k));
  tabBadges();
}
/* 标签上的徽标：交易 = 当前持仓笔数；事件 = 24 小时内相关货币的高影响事件数；预警 = 未读条数，开着且无未读时为呼吸圆点。CSV 隐藏“交易” */
function tabBadges() {
  const et = hasTr(),
    n = TR && TR.sym === cur.sym ? TR.open.length : 0;
  document.querySelectorAll('[data-tab="tr"]').forEach(b => {
    b.hidden = !et;
    b.querySelector('.bdg').textContent = n || '';
  });
  if (!et && TAB == 'tr') return setTab('an', 0);
  document.querySelectorAll('[data-tab="ev"] .bdg').forEach(b => (b.textContent = evSoon() || ''));
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
    if ((x = q('[data-go]'))) return setTab(x.dataset.go);
    if (q('#fold')) return foldAll();
    if (q('#pcol')) return setPcol(1);
    /* 块标题里的按钮：只做自己的事，不触发块的开合 */
    if ((x = q('[data-mk]'))) {
      e.preventDefault();
      return setMK(x.dataset.mk);
    }
    if (q('[data-al-on]')) return setAlertsOn(!AL.on);
    if (q('[data-ci-on]')) return setCiOn(!CI.on);
    if (q('#cit')) return ciTest();
    if (q('#trr')) return loadTrades();
    if ((x = q('[data-trccy]'))) return x.disabled || setTrCcy(x.dataset.trccy);
    if (q('#trv')) return openReview();
    /* 守则、日记、体检（journal.js）：先于下面“点一行在图上定位” */
    if (q('#trg') || q('[data-jn-rules]')) return jnOpen('rules');
    if ((x = q('[data-jn]') || q('.ckl'))) {
      const row = x.closest('.sg'),
        t = row && TR && (row.dataset.tro != null ? TR.open[+row.dataset.tro] : TR.closed[+row.dataset.trc]);
      return t && jnOpen('note', t);
    }
    if (q('#btgo')) return openBacktest();
    if (q('#evr')) return loadEvents(), loadNews(1);
    if (q('#aia')) return aiAsk();
    if (q('#aic')) return aiCopy();
    if (q('#aiv')) return aiView();
    if ((x = q('[data-evo]'))) return setEvOpt(x.dataset.evo, x.dataset.v);
    if ((x = q('.evr[data-ev]'))) return hlEvent(EV && EV.events && EV.events.find(e => e.id == x.dataset.ev));
    if ((x = q('.sg[data-n]'))) return lastM && hlSig(lastM.t.a.sigs[+x.dataset.n]);
    if ((x = q('.lvr[data-lv]'))) return lastM && hlLevel(lastM.L.find(l => l.p == +x.dataset.lv));
    if ((x = q('.sc[data-sc]'))) return lastM && hlScene(lastM.sc[+x.dataset.sc]);
    if ((x = q('.sg[data-trc]'))) return hlTrade(TR.closed[+x.dataset.trc], x.dataset.key);
    if ((x = q('.sg[data-tro]'))) return hlTrade(TR.open[+x.dataset.tro], x.dataset.key);
  });
  el.addEventListener('change', e => {
    const c = e.target;
    /* Cirra 播报的四个勾选 */
    if (c.dataset.ci) {
      CI[c.dataset.ci] = c.checked ? 1 : 0;
      LS.set('cirra', CI);
      return;
    }
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
