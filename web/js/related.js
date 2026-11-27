/* 相关品种（分析页的一块，SPEC 3.3.18）：看黄金时顺手看美元指数、美国 10 年期收益率、白银——各自最近动了多少、最近和它是一起动还是反着动。
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
