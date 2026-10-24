/* 图表指标：开关、配色、自定义绘制、图表高度 */
/* EMA 用 20/50，与信号规则一致。副图（VOL/MACD/RSI/KDJ）开合时高度滑动过渡（slidePane） */
function tog(n, instant) {
  const mn = MAIN.includes(n),
    id = mn ? 'candle_pane' : 'p_' + n;
  if (mn) {
    if (on[n]) chart.removeIndicator(id, n);
    else chart.createIndicator(indSpec(n), true, { id });
    on[n] = on[n] ? 0 : 1;
  } else if (instant || document.hidden || document.body.classList.contains('boot')) {
    /* 打开页面、标签页在后台、或由数据决定（无成交量时移除 VOL）时直接是最终状态，不播放动画 */
    if (on[n]) chart.removeIndicator(id, n);
    else chart.createIndicator(indSpec(n), false, { id, height: SUBH, minHeight: 0 });
    on[n] = on[n] ? 0 : 1;
  } else if (on[n]) {
    on[n] = 0;
    slidePane(n, 0, () => chart.removeIndicator(id, n));
  } else {
    /* 关闭动画还没放完时又打开：副图还在，直接从当前高度滑回去 */
    if (!chart.getIndicatorByPaneId(id, n)) {
      chart.createIndicator(indSpec(n), false, { id, height: 1, minHeight: 0 });
      axisCls();
    }
    on[n] = 1;
    slidePane(n, SUBH);
  }
  document.querySelector(`[data-i="${n}"]`).classList.toggle('on', !!on[n]);
  fitChart();
  ddCount();
  /* 指标结果和副图位置在图表库下一轮计算后才更新，稍后再给新副图的价格轴加样式、画图例 */
  setTimeout(() => {
    axisCls();
    legend();
    nowMark();
  }, 30);
}
/* 图表高度：先填满中间栏剩余高度（第一个副图包含在内），之后每多一个副图加高 80px，中间栏滚动，主图不再被压缩 */
/* ===== 指标配色：图表库默认让所有指标共用同一套 5 色（MA5、EMA20、布林上轨都是同一种橙色），叠在一起分不清。
   改为每个指标一个色系 + 线型：MA=暖橙系细线（周期越长越深越粗）；EMA=青色系粗线；布林=紫色，上下轨虚线、中轨实线、带淡紫底；
   副图：MACD 的 DIF 青 / DEA 橙；RSI 只用 14（与分析一致）紫色，30–70 区间淡底 + 虚线；KDJ 橙/青/洋红。颜色取中等明度，四个主题下都可读 ===== */
const INDSTY = {
  MA: {
    lines: [
      ['#f2b84b', 1],
      ['#e8913a', 1],
      ['#d46a2e', 1.3],
      ['#a8482a', 1.6],
    ],
  },
  EMA: {
    calcParams: [20, 50],
    lines: [
      ['#1fa5b8', 1.8],
      ['#16708f', 1.8],
    ],
  },
  BOLL: {
    lines: [
      ['#8a7fd0', 1, 'dashed'],
      ['#8a7fd0', 1],
      ['#8a7fd0', 1, 'dashed'],
    ],
  },
  MACD: {
    lines: [
      ['#1fa5b8', 1.2],
      ['#e8913a', 1.2],
    ],
  },
  RSI: { calcParams: [14], lines: [['#8a7fd0', 1.4]], draw: () => rsiBand },
  KDJ: {
    lines: [
      ['#e8913a', 1],
      ['#1fa5b8', 1],
      ['#c2549c', 1],
    ],
  },
};
function indSpec(n) {
  const s = INDSTY[n];
  if (!s) return n;
  const o = {
    name: n,
    styles: {
      lines: s.lines.map(([color, size, style]) => ({
        color,
        size,
        style: style || 'solid',
        dashedValue: [4, 3],
        smooth: false,
      })),
    },
  };
  if (s.calcParams) o.calcParams = s.calcParams;
  if (s.draw) o.draw = s.draw();
  if (MAIN.includes(n))
    Object.assign(o, {
      calc: MCALC[n],
      figures: [],
      regenerateFigures: () => [],
      draw: mainDraw(n),
      createTooltipDataSource: mainTip(n),
    });
  return o;
}
/* ===== 主图指标（MA / EMA / BOLL）不参与价格轴缩放 =====
   图表库把主图上指标线的数值也算进价格轴范围：开关布林带时上下轨超出K线的高低点，整个主图会突然压缩/拉伸（“跳一下”），
   MA60、EMA50 远离价格时也一样。这里让价格轴只按K线计算（同 TradingView 的“仅按价格缩放”）：
   这三个指标的 figures 置空（价格轴范围只读 figures 对应的数值），线由 draw 回调自己画，左上角图例的数值由 createTooltipDataSource 提供。
   图表库自带的 MA / EMA 计算要用 figures 的 key 命名结果，所以三个指标的计算也在这里实现，公式与图表库 9.8 一致。
   超出价格轴的部分被主图上下边缘截断（主图上方留有 20%、下方 10% 空白，通常看得到） */
const MCALC = {
  MA: (list, ind) => {
    const ps = ind.calcParams,
      sums = ps.map(() => 0);
    return list.map((d, i) => {
      const r = {};
      ps.forEach((p, j) => {
        sums[j] += d.close;
        if (i >= p - 1) {
          r['ma' + p] = sums[j] / p;
          sums[j] -= list[i - p + 1].close;
        }
      });
      return r;
    });
  },
  EMA: (list, ind) => {
    const ps = ind.calcParams,
      ema = [];
    let sum = 0;
    return list.map((d, i) => {
      const r = {};
      sum += d.close;
      ps.forEach((p, j) => {
        if (i < p - 1) return;
        ema[j] = i > p - 1 ? (2 * d.close + (p - 1) * ema[j]) / (p + 1) : sum / p;
        r['ema' + (j + 1)] = ema[j];
      });
      return r;
    });
  },
  BOLL: (list, ind) => {
    const [p, k] = ind.calcParams;
    let sum = 0;
    return list.map((d, i) => {
      const r = {};
      sum += d.close;
      if (i >= p - 1) {
        const mid = sum / p;
        let v = 0;
        for (let j = i - p + 1; j <= i; j++) v += (list[j].close - mid) ** 2;
        const md = Math.sqrt(v / p);
        Object.assign(r, { mid, up: mid + k * md, dn: mid - k * md });
        sum -= list[i - p + 1].close;
      }
      return r;
    });
  },
};
/* 每条线的结果 key 和图例名称，顺序与 INDSTY 里的配色一致 */
const mainKeys = (n, ind) =>
  n == 'MA'
    ? ind.calcParams.map(p => ['ma' + p, 'MA' + p])
    : n == 'EMA'
      ? ind.calcParams.map((p, j) => ['ema' + (j + 1), 'EMA' + p])
      : [
          ['up', 'UP'],
          ['mid', 'MID'],
          ['dn', 'DN'],
        ];
const lineSty = (n, j) => INDSTY[n].lines[j] || INDSTY[n].lines[0];
function mainDraw(n) {
  return a => {
    const { ctx, indicator, visibleRange, xAxis, yAxis } = a,
      r = indicator.result,
      from = Math.max(0, visibleRange.from - 1),
      to = Math.min(r.length, visibleRange.to + 1);
    if (n == 'BOLL') bollFill(a);
    ctx.save();
    mainKeys(n, indicator).forEach(([k], j) => {
      const [color, size, dash] = lineSty(n, j);
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.setLineDash(dash ? [4, 3] : []);
      ctx.beginPath();
      let pen = false;
      for (let i = from; i < to; i++) {
        const v = r[i] && r[i][k];
        if (v == null || isNaN(v)) {
          pen = false;
          continue;
        }
        const x = xAxis.convertToPixel(i),
          y = yAxis.convertToPixel(v);
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        pen = true;
      }
      ctx.stroke();
    });
    ctx.restore();
    return true;
  };
}
/* 图例：十字光标所在K线（没有时为最右一根可见K线）的各线数值，颜色同线色 */
function mainTip(n) {
  return ({ indicator, crosshair, visibleRange }) => {
    const i = crosshair && crosshair.dataIndex != null ? crosshair.dataIndex : visibleRange.to - 1,
      d = indicator.result[i] || {};
    return {
      values: mainKeys(n, indicator).map(([k, t], j) => {
        const c = lineSty(n, j)[0],
          v = d[k];
        return {
          title: { text: t + ': ', color: c },
          value: { text: v == null || isNaN(v) ? 'n/a' : v.toFixed(indicator.precision), color: c },
        };
      }),
    };
  };
}
/* RSI 30–70 区间铺淡紫底，30/70 两条虚线 */
function rsiBand({ ctx, bounding, yAxis }) {
  const y1 = yAxis.convertToPixel(70),
    y2 = yAxis.convertToPixel(30);
  ctx.save();
  ctx.fillStyle = '#8a7fd014';
  ctx.fillRect(0, y1, bounding.width, y2 - y1);
  ctx.strokeStyle = '#8a7fd066';
  ctx.setLineDash([3, 3]);
  ctx.lineWidth = 1;
  [y1, y2].forEach(y => {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(bounding.width, y);
    ctx.stroke();
  });
  ctx.restore();
  return false;
}
/* 布林带上下轨之间铺一层很淡的紫底（约 7% 不透明度），由 mainDraw 先画底色、再画三条线 */
const BOLLC = '#8a7fd012';
function bollFill({ ctx, indicator, visibleRange, xAxis, yAxis }) {
  const r = indicator.result,
    up = [],
    dn = [];
  for (let i = visibleRange.from; i < visibleRange.to; i++) {
    const d = r[i];
    if (!d || d.up == null || d.dn == null) continue;
    const x = xAxis.convertToPixel(i);
    up.push([x, yAxis.convertToPixel(d.up)]);
    dn.push([x, yAxis.convertToPixel(d.dn)]);
  }
  if (up.length > 1) {
    ctx.save();
    ctx.beginPath();
    up.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let j = dn.length - 1; j >= 0; j--) ctx.lineTo(dn[j][0], dn[j][1]);
    ctx.closePath();
    ctx.fillStyle = BOLLC;
    ctx.fill();
    ctx.restore();
  }
  return false;
}
/* 副图开合动画：新副图从几乎 0 的高度滑出到 80px，关闭时收回到 0 再移除，约 0.26 秒；
   宽屏时主图随之平滑伸缩，窄屏时整个图表的高度也有过渡（CSS）。每帧重排图例，跟着移动的副图图例不跳。
   同一个副图的动画进行中再点一次，从当前高度反向过渡（旧动画作废，它的收尾回调不再执行） */
const SUBH = 80,
  paneAnim = {};
function slidePane(n, to, done) {
  const id = 'p_' + n,
    sz = chart.getSize(id),
    from = sz ? sz.height : 0,
    tok = (paneAnim[n] = (paneAnim[n] || 0) + 1),
    t0 = performance.now();
  const step = now => {
    if (paneAnim[n] !== tok) return;
    const p = Math.min(1, (now - t0) / 260),
      e = 1 - Math.pow(1 - p, 3);
    chart.setPaneOptions({ id, height: Math.max(1, Math.round(from + (to - from) * e)), minHeight: 0 });
    legend();
    if (p < 1) requestAnimationFrame(step);
    else if (done) done();
  };
  requestAnimationFrame(step);
}
/* 图表高度：宽屏时K线铺满窗口（副图从主图高度里分出）；窄屏时主图约 60% 屏高，之后每多一个副图加高 80px */
function fitChart() {
  const k = INDS.filter(n => on[n] && !MAIN.includes(n)).length;
  $('#chart').style.height = WIDE()
    ? ''
    : Math.round(Math.max(360, innerHeight * 0.6) + 80 * Math.max(0, k - 1)) + 'px';
  layout();
}
/* ===== 指标图例（页面自绘） =====
   图表库的图例画在每个窗口左上角，整页布局下会被顶栏和左侧面板挡住，所以关掉（style 里 showRule: 'none'），改为 HTML：
   主图图例在顶栏下方、面板右侧，副图图例在各自窗口左上角（同样避开面板），面板开合时随 --L 平滑移动。
   数值取十字光标所在K线（hovI），没有时取最新一根；颜色与线色一致，柱子按正负（成交量按K线涨跌）取涨跌色 */
function legend(i) {
  const el = $('#lgd');
  if (!el || !chart || !bars.length) return;
  if (i == null) i = hovI >= 0 ? hovI : bars.length - 1;
  const nf = (v, p) =>
      v == null || isNaN(v) ? 'n/a' : v.toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p }),
    dcol = v => (v > 0 ? 'var(--up)' : v < 0 ? 'var(--dn)' : 'var(--mu)'),
    panes = {};
  INDS.filter(n => on[n]).forEach(n => {
    const pid = MAIN.includes(n) ? 'candle_pane' : 'p_' + n,
      ind = chart.getIndicatorByPaneId(pid, n);
    if (!ind) return;
    const d = (ind.result || [])[i] || {},
      p = n == 'VOL' ? 0 : ind.precision;
    let vals,
      li = 0;
    if (MAIN.includes(n)) vals = mainKeys(n, ind).map(([k, t], j) => [t, nf(d[k], p), lineSty(n, j)[0]]);
    else
      vals = ind.figures
        .filter(f => f.title)
        .map(f => {
          const v = d[f.key],
            c =
              f.type == 'bar'
                ? n == 'VOL'
                  ? dcol(bars[i].close - bars[i].open)
                  : dcol(v)
                : ((INDSTY[n] && INDSTY[n].lines[li++]) || [])[0] || 'var(--mu)';
          return [f.title.replace(/:\s*$/, ''), nf(v, p), c];
        });
    /* 正在滑出的副图太矮时先不显示图例，免得压到相邻窗口 */
    const sz = pid != 'candle_pane' && chart.getSize(pid);
    if (sz === null || (sz && sz.height < 26)) return;
    (panes[pid] = panes[pid] || []).push(
      `<div class="lgr"><b>${ind.shortName}${ind.calcParams.length ? `(${ind.calcParams.join(',')})` : ''}</b>${vals
        .map(([t, v, c]) => `<span style="color:${c}">${t} ${v}</span>`)
        .join('')}</div>`
    );
  });
  morph(
    el,
    Object.entries(panes)
      .map(
        ([pid, rows]) =>
          `<div class="lgp" style="top:${pid == 'candle_pane' ? safeT() + 6 : chart.getSize(pid).top + 4}px">${rows.join('')}</div>`
      )
      .join('')
  );
}
function ddCount() {
  const a = INDS.filter(n => on[n]).length,
    b = Object.keys(MKN).filter(k => MK[k]).length;
  $('#insb').innerHTML = `指标<span class="cnt">${a}</span>`;
  $('#mksb').innerHTML = `标注<span class="cnt">${b}</span>`;
}
/* 无成交量时移除并禁用 VOL，换回有成交量的数据时按用户原来的选择恢复 */
function volAvail(hv) {
  const bt = document.querySelector('[data-i="VOL"]');
  bt.disabled = !hv;
  bt.title = hv ? '' : '该数据源不提供成交量';
  if (!hv && on.VOL) tog('VOL', 1);
  else if (hv && volPref && !on.VOL) tog('VOL', 1);
}
