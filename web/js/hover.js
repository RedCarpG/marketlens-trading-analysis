/* 悬停K线的高亮与信息卡 */
/* ===== 悬停K线：淡竖条高亮（比点击选中的竖条更淡）+ 跟随鼠标的信息卡 ===== */
let hovI = -1,
  hovXY = null;
const fmtFull = ts =>
  new Date(ts).toLocaleString(
    'zh-CN',
    /[dwM]$/.test(tf)
      ? { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }
      : {
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }
  );
function hovHTML(i) {
  const b = bars[i],
    p = bars[i - 1],
    f = v => v.toFixed(cur.p),
    dc = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : 'var(--mu)'),
    chg = p ? b.close - p.close : 0,
    a = lastM && lastM.t.a.a,
    rg = b.high - b.low,
    bd = Math.abs(b.close - b.open),
    uw = b.high - Math.max(b.open, b.close),
    lw = Math.min(b.open, b.close) - b.low,
    shape =
      rg <= 0
        ? '—'
        : bd <= rg * 0.1
          ? '十字星'
          : lw >= rg * 0.5
            ? '长下影'
            : uw >= rg * 0.5
              ? '长上影'
              : bd >= rg * 0.7
                ? b.close > b.open
                  ? '大阳线'
                  : '大阴线'
                : b.close >= b.open
                  ? '阳线'
                  : '阴线',
    sg = lastM ? lastM.t.a.sigs.filter(g => g.i === i) : [],
    forming = i === bars.length - 1 && nxt(tf, b.timestamp) > Date.now(),
    evs = evHover(b),
    trs =
      TR && TR.sym === cur.sym
        ? [
            ...TR.closed.flatMap(t => [
              snapTs(t.openTs) === b.timestamp ? [t, '开仓'] : null,
              snapTs(t.closeTs) === b.timestamp ? [t, '平仓'] : null,
            ]),
            ...TR.open.map(t => (snapTs(t.openTs) === b.timestamp ? [t, '开仓（持仓中）'] : null)),
          ].filter(Boolean)
        : [];
  return `<div class="hh"><b>${fmtFull(b.timestamp)}</b>${forming ? '<span class="tag" style="margin:0">未收盘</span>' : ''}</div>
<div class="hg"><span>开</span><b>${f(b.open)}</b><span>高</span><b>${f(b.high)}</b><span>低</span><b>${f(b.low)}</b><span>收</span><b style="color:${dc(b.close - b.open)}">${f(b.close)}</b></div>
${p ? `<div class="row"><span>涨跌</span><b style="color:${dc(chg)}">${chg >= 0 ? '+' : ''}${f(chg)}（${chg >= 0 ? '+' : ''}${((chg / p.close) * 100).toFixed(2)}%）</b></div>` : ''}
<div class="row"><span>振幅</span><b>${f(rg)}${a ? ` · ${(rg / a).toFixed(1)} ATR` : ''}</b></div><div class="row"><span>形态</span><b>${shape}</b></div>
${hasVol(bars) ? `<div class="row"><span>成交量</span><b>${b.volume.toLocaleString()}</b></div>` : ''}
${evs ? `<div class="hs hev">${evs}</div>` : ''}
${
  sg.length || trs.length
    ? `<div class="hs">${sg.map(g => `<div><span style="color:${dc(g.dir)}">${g.dir > 0 ? '▲' : '▼'}</span> ${g.t}</div>`).join('')}
${trs.map(([t, w]) => `<div><span style="color:var(${t.isBuy ? '--tb' : '--ts'})">${t.isBuy ? '▲' : '▼'}</span> 我的${t.isBuy ? '买' : '卖'}单${w} @${f(w == '平仓' ? t.closeRate : t.openRate)}${w == '平仓' ? ` <b style="color:${dc(t.netProfit)}">${money(t.netProfit, t.closeTs)}</b>` : ''}</div>`).join('')}</div>`
    : ''
}`;
}
function onHover(d) {
  const i = d && d.dataIndex;
  if (i == null || i < 0 || i >= bars.length || !d.kLineData) {
    hideHover();
    return;
  }
  if (i !== hovI) {
    hovI = i;
    chart.removeOverlay({ groupId: 'hov' });
    chart.createOverlay({
      name: 'fbVBand',
      groupId: 'hov',
      lock: true,
      points: [{ timestamp: bars[i].timestamp, value: bars[i].close }],
      extendData: { color: cssv('--mu'), alpha: '26' },
    });
    /* 副图（MACD、RSI 等）同一根K线也加淡竖条 */
    INDS.filter(n => on[n] && !MAIN.includes(n)).forEach(n =>
      chart.createOverlay(
        {
          name: 'fbVBand',
          groupId: 'hov',
          lock: true,
          points: [{ timestamp: bars[i].timestamp, value: 0 }],
          extendData: { color: cssv('--mu'), alpha: '1f' },
        },
        'p_' + n
      )
    );
    $('#hov').innerHTML = hovHTML(i);
    legend(i);
  }
  $('#hov').style.display = 'block';
  placeHover();
}
/* 卡片放在鼠标右下方，靠近右/下边缘时翻到另一侧 */
function placeHover() {
  const el = $('#hov');
  if (!hovXY || el.style.display != 'block') return;
  const c = $('#chart'),
    w = el.offsetWidth,
    h = el.offsetHeight;
  let x = hovXY[0] + 16,
    y = hovXY[1] + 16;
  if (x + w > c.clientWidth - 70 - safeR()) x = hovXY[0] - w - 16;
  if (y + h > c.clientHeight - 8) y = hovXY[1] - h - 16;
  /* 不放到左侧自选和顶栏下面 */
  el.style.transform = `translate(${Math.max(safeL() + 4, x)}px,${Math.max(safeT() + 4, y)}px)`;
}
function hideHover() {
  if (hovI < 0 && $('#hov').style.display != 'block') return;
  hovI = -1;
  chart.removeOverlay({ groupId: 'hov' });
  $('#hov').style.display = 'none';
  legend();
}
