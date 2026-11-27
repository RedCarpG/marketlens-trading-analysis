/* 分析页里两块要另外取数的“情境”：相关品种（下面），期货持仓（CFTC 每周报告，在文件中间）。
   相关品种（SPEC 3.3.18）：看黄金时顺手看美元指数、美国 10 年期收益率、白银——各自最近动了多少、最近和它是一起动还是反着动。
   计算在 core/context.js 的 relRow / relText；这里只管取数和显示。看哪些写在自选列表每个品种的 rel 里（config.js）。
   日线都经本地代理从 Yahoo 取（约延迟 10–15 分钟），所以只在经代理打开、看真实品种时有；公开演示页和模拟品种没有。
   被比的这一边：品种有 Yahoo 代码时也用 Yahoo 的日线（同一家的日期好对齐），没有就用已加载的日线。
   只列数，不说谁带动谁、也不由此推以后。
   REL：{ key 品种, at 取到的时间, busy, rows: [{ k, name, p, unit, ...relRow 的结果 } | { k, name, err }], base 被比的那边用的是什么, bad 一样都没取到 } */
let REL = null;
const REL_TTL = 10 * 60e3,
  REL_RETRY = 60e3;
const relOn = () => LOCAL && !!cur.rel && cur.src != 'demo' && cur.src != 'csv';
async function loadRel() {
  if (!relOn()) return;
  const key = cur.sym,
    old = REL && REL.key == key ? REL : null;
  if (old && (old.busy || Date.now() - old.at < (old.bad ? REL_RETRY : REL_TTL))) return;
  REL = { ...(old || {}), key, busy: 1 };
  const get = async s => {
      const r = await fetch(`/api/candles?src=yahoo&symbol=${encodeURIComponent(s)}&interval=1d&count=150`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    y = cur.srcs && cur.srcs.yahoo;
  let base = ALL['1d'] || [],
    from = '已加载的日线';
  if (y)
    try {
      base = await get(y);
      from = `Yahoo ${y} 的日线`;
    } catch (_) {}
  const rows = await Promise.all(
    cur.rel.map(async d => {
      try {
        const v = relRow(base, await get(d.k), { unit: d.unit });
        return v ? { ...d, ...v } : { ...d, err: 'K线太少' };
      } catch (e) {
        return { ...d, err: e.message };
      }
    })
  );
  if (cur.sym !== key) return;
  REL = { key, at: Date.now(), rows, base: from, bad: rows.every(x => x.err) };
  if (bars.length) refresh();
}
/* ===== 期货持仓（CFTC 每周报告，SPEC 3.3.19）=====
   自选列表里写了 cot 的品种才有（config.js：合约代码、念出来的名字）。经本地代理取（代理 6 小时取一次并存着），页面一小时问一次。
   计算在 core/context.js 的 cotState / cotText。只列数：这一期净多多少、前一期多少、在之前 52 期里排在哪。
   COT：{ key 品种, at, busy, v: cotState 的结果, name 报告里的合约名, err 取数时的问题, bad 一期都没取到 } */
let COT = null;
const COT_TTL = 60 * 60e3;
const cotOn = () => LOCAL && !!cur.cot && cur.src != 'demo' && cur.src != 'csv';
async function loadCot() {
  if (!cotOn()) return;
  const key = cur.sym,
    old = COT && COT.key == key ? COT : null;
  if (old && (old.busy || Date.now() - old.at < (old.bad ? REL_RETRY : COT_TTL))) return;
  COT = { ...(old || {}), key, busy: 1 };
  let next;
  try {
    const r = await fetch(`/api/cftc?code=${encodeURIComponent(cur.cot.code)}`),
      j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    next = { key, at: Date.now(), v: cotState(j.rows), name: j.name, err: j.err || null };
  } catch (e) {
    next = { ...(old || {}), key, at: Date.now(), busy: 0, err: e.message, bad: !(old && old.v) };
  }
  if (cur.sym !== key) return;
  COT = next;
  if (bars.length) refresh();
}
function cotBlock() {
  if (!cotOn()) return '';
  loadCot();
  const S = COT && COT.key == cur.sym ? COT : null,
    title = `期货持仓 <span class="mu">CFTC · 每周</span>`;
  if (!S || (!S.v && !S.err)) return blk('cot', title, '<div class="empty"><i class="spin"></i>加载中…</div>');
  if (!S.v) return blk('cot', title, `<div class="empty">没取到：${esc(S.err)}</div>`);
  const v = S.v,
    age = Math.floor((Date.now() - v.ts) / 864e5),
    chg = (a, b) => (b == null ? '' : ` <small class="mu cotd">${a - b >= 0 ? '+' : '−'}${cotNum(a - b)}</small>`),
    row = (n, a, b) => `<div class="row sm"><span>${n}</span><b>${cotNum(a)} 手${chg(a, b)}</b></div>`;
  return blk(
    'cot',
    title,
    `<div class="rls">${esc(cotText(v, { name: cur.cot.name }))}</div>
${v.pct == null ? '' : `<div class="vbar" title="左边是之前 ${v.n} 期里净多最少的，右边是最多的"><i style="left:${((v.below / v.n) * 100).toFixed(1)}%"></i></div>`}
${row('管理基金 多', v.long, v.prev && v.prev.long)}${row('管理基金 空', v.short, v.prev && v.prev.short)}${row('全部未平仓', v.oi)}
${age > 10 ? `<div class="note2">这一期已经是 ${age} 天前的了（节假日那周、或者 CFTC 停摆时会晚出）。</div>` : ''}${S.err ? `<div class="note2">最近一次没取到新的：${esc(S.err)}，显示的是存着的</div>` : ''}
${more('这是什么、怎么读', `美国商品期货交易委员会（CFTC）每周的持仓报告（分类版，只含期货）：${esc(S.name || cur.cot.name)}。“管理基金”是报告里的 Managed Money 一类，主要是对冲基金和商品交易顾问。数字是那个周二收盘时的，通常周五下午（美东）才公布，所以看到时至少是三天前的事。净多 = 多头减空头，一手黄金期货是 100 盎司；小字是比前一期多了还是少了。刻度是这一期的净多在之前 ${v.n} 期里的位置。这只是一份滞后的记录：持仓多或少都不说明接下来往哪边走，这里也不拿它当信号。`)}`
  );
}
/* 分析页里的那一块；每次画面板时顺手看一眼要不要重取（十分钟一次） */
function relBlock() {
  if (!relOn()) return '';
  loadRel();
  const R = REL && REL.key == cur.sym && REL.rows ? REL : null,
    me = cur.name.split(/[ ·]/)[0];
  if (!R) return blk('rel', '相关品种', '<div class="empty"><i class="spin"></i>加载中…</div>');
  const dc = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : 'var(--mu)'),
    md = t => `${new Date(t).getUTCMonth() + 1}/${new Date(t).getUTCDate()}`,
    col = (v, unit) => `<b style="color:${dc(v)}">${relChg(v, unit)}</b>`,
    how = x =>
      x.rel == null
        ? '<span class="mu">相关没算出来</span>'
        : `${x.rel > 0 ? `和${me}同向` : x.rel < 0 ? `和${me}反着走` : x.relL ? `${x.nL} 天里偏${x.relL > 0 ? '同向' : '反向'}` : `和${me}看不出关系`} <span class="mu" title="最近 ${x.n} 个交易日每天涨跌的相关系数${x.rL != null ? `；${x.nL} 个交易日是 ${x.rL.toFixed(2)}` : ''}">${x.r.toFixed(2)}${x.rL != null ? ` · ${x.nL} 天 ${x.rL.toFixed(2)}` : ''}</span>`,
    row = x =>
      x.err
        ? `<div class="rlr"><span class="rn">${esc(x.name)}</span><span class="mu sm">没取到（${esc(x.err)}）</span></div>`
        : `<div class="rlr"><span class="rn">${esc(x.name)}<small>${md(x.ts)}</small></span><b>${x.last.toFixed(x.p)}</b>
<small>当天 ${col(x.d1, x.unit)} · 5 天 ${col(x.d5, x.unit)}</small><small class="rh">${how(x)}</small></div>`,
    sum = relText(
      R.rows.filter(x => !x.err),
      me
    );
  return blk(
    'rel',
    `相关品种 <span class="mu">日线</span>`,
    `${sum ? `<div class="rls">${esc(sum)}</div>` : ''}${R.rows.map(row).join('')}
${more('怎么算的', `日线来自 Yahoo，约延迟 10–15 分钟；${esc(me)}这一边用的是${esc(R.base)}。“当天”是最新一根日线比前一根，各品种交易时间不同，名字旁边写着那一根是哪一天的；收益率的变化按基点（0.01 个百分点）。相关是两边都有K线的最近 20 个交易日里，每天涨跌的相关系数：+1 是每天同涨同跌，−1 是每天相反，旁边另给一个 60 个交易日的作对照。20 天的样本很小，两串不相干的数也常算出 ±0.4 上下，所以绝对值不到 0.55 的不算；这时如果 60 个交易日的那个到了 0.33（样本多，门槛可以低），写“60 天里偏同向 / 偏反向”，否则写“看不出关系”。这只是过去的数：不说明谁带动谁，过去反着走也不等于以后还反着走。`)}`
  );
}
