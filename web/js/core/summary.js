/* 给页面以外的调用方（本地代理、Cirra 插件）的两个入口（纯计算）：
   analyzeCandles  从各周期K线直接得到分析，不用自己拼 ctx 和 analyzeMTF；
   describeState   把分析压成几句只有事实的话（各周期方向、现价离最近的关键价位多远），给 AI 或语音用。
   describeState 故意不带评分、结论和情景：这些规则回测没有可靠优势（docs/BACKTEST.md），说出来容易被当成买卖建议 */

/* all：{ 周期: K线数组（旧到新，最后一根可以没收盘） }，要有 tf 本身，更大的周期有几个算几个；
   px：最新价，不给时用 tf 最后一根的收盘。返回 { tf, C（各周期 ctx）, px, m（analyzeMTF 的结果，已收盘K线不足时为 null） } */
function analyzeCandles(tf, all, px) {
  if (!TFS.includes(tf)) throw new Error(`周期须为 ${TFS.join(' / ')}`);
  const C = {};
  TFS.slice(TFS.indexOf(tf)).forEach(k => {
    if (all && all[k] && all[k].length) C[k] = ctx(k, all[k]);
  });
  const bars = (all && all[tf]) || [],
    price = px ?? (bars.length ? bars[bars.length - 1].close : null);
  return { tf, C, px: price, m: C[tf] && price != null ? analyzeMTF(tf, C, price) : null };
}

/* 一句话里价位旁边的说明：来自哪些周期、被挡回几次 */
const lvNote = l => l.tfs.map(k => TFN[k]).join('、') + (l.touch >= 2 ? `，挡回 ${l.touch} 次` : '');

/* o：analyzeCandles 的返回值，再加 name（念出来的品种名，如“黄金 GOLD”）和 dp（价格小数位，默认 2）。
   返回 { text, lines, facts }：text 是 lines 拼起来的一段；facts 是同样内容的结构化数据，调用方想自己组织句子时用。
   距离都按 tf 的 ATR 计。只描述，不给方向上的结论 */
function describeState(o) {
  const { name, tf, C, m, px, dp = 2 } = o,
    f = v => v.toFixed(dp),
    trend = [...TFS]
      .slice(TFS.indexOf(tf))
      .reverse()
      .filter(k => C[k])
      .map(k => ({ tf: k, bias: C[k].a ? C[k].bias : null, ok: !!C[k].ok }));
  if (!m) {
    const line = `${name} ${TFN[tf]}已收盘的K线不够，暂时没有分析。`;
    return { text: line, lines: [line], facts: { tf, px: px ?? null, atr: null, trend, support: null, resistance: null, asof: null } };
  }
  const x = m.t.a.a,
    key = m.L.filter(l => isKey(l, tf)),
    near = side =>
      key.filter(l => (side > 0 ? l.p <= px : l.p > px)).sort((a, b) => Math.abs(a.p - px) - Math.abs(b.p - px))[0] || null,
    fact = l => l && { price: l.p, tfs: l.tfs, touch: l.touch, atr: +(Math.abs(l.p - px) / x).toFixed(1) },
    sup = near(1),
    res = near(-1),
    say = (l, word, where) => {
      if (!l) return `${where}没有算出关键${word}`;
      const d = Math.abs(l.p - px) / x;
      return d <= 0.15
        ? `现价就在${word} ${f(l.p)} 附近（${lvNote(l)}）`
        : `${where}最近的${word}是 ${f(l.p)}（${lvNote(l)}），离现价 ${d.toFixed(1)} 个 ATR`;
    },
    lines = [
      `${name} 现价 ${f(px)}。`,
      `各周期方向（按均线）：${trend.map(t => TFN[t.tf] + (t.bias == null ? '数据不足' : BT[t.bias] + (t.ok ? '' : '（K线偏少，仅作参考）'))).join('，')}。`,
      `${TFN[tf]}上，${say(sup, '支撑', '下方')}；${say(res, '阻力', '上方')}。`,
      `${TFN[tf]}一根K线平常的波动（ATR）约 ${f(x)}。`,
    ];
  return {
    text: lines.join(''),
    lines,
    facts: { tf, px, atr: x, trend, support: fact(sup), resistance: fact(res), asof: m.t.asof },
  };
}
