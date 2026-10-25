'use strict';
/* Yahoo Finance 行情（无需密钥，非官方接口，仅供个人研究）：图表接口取K线，最新价用于实时推进。
   周期：15m（最近 60 天）、1h（最近 730 天）、4h 由 1h 按 UTC 4 小时聚合、1d（2000 年起）、1w / 1M 由日线聚合（周一 / 每月 1 日起，与页面时间网格一致）。
   日线时间是交易所所在地午夜，统一记为该交易日 00:00 UTC。期货（如 GC=F 黄金连续合约）报价约延迟 10 分钟，换月时可能有跳空。 */
const TFS = ['15m', '1h', '4h', '1d', '1w', '1M'];
const SRC = { '15m': ['15m', 'range=60d'], '1h': ['60m', 'range=730d'], '4h': ['60m', 'range=730d'], '1d': ['1d', 'period1=946684800'], '1w': ['1d', 'period1=946684800'], '1M': ['1d', 'period1=946684800'] };
const TTL = { '15m': 30e3, '60m': 60e3, '1d': 300e3 };
const day = t => { const d = new Date(t - 3 * 36e5); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
/* 聚合键：日内周期按整点对齐（Yahoo 最后一行的时间是最后成交时刻，如 20:59，要并进它所属的那根），周线周一、月线 1 日 */
const KEY = {
  '15m': t => Math.floor(t / 9e5) * 9e5,
  '1h': t => Math.floor(t / 36e5) * 36e5,
  '4h': t => Math.floor(t / 144e5) * 144e5,
  '1w': t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); },
  '1M': t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); },
};
function aggregate(bars, key) {
  const out = [];
  for (const b of bars) {
    const k = key(b.timestamp), x = out[out.length - 1];
    if (x && x.timestamp === k) { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; x.volume += b.volume; }
    else out.push({ ...b, timestamp: k });
  }
  return out;
}
/* 去掉缺值；高低价包住开收（部分期货历史有高低价不含开收的行）；同一时间只留最后一条 */
function clean(rows) {
  const m = new Map();
  for (const b of rows) {
    if (![b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 0)) continue;
    m.set(b.timestamp, { ...b, high: Math.max(b.high, b.open, b.close), low: Math.min(b.low, b.open, b.close), volume: Number.isFinite(b.volume) ? b.volume : 0 });
  }
  return [...m.values()].sort((a, b) => a.timestamp - b.timestamp);
}
function parse(j, iv) {
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  if (!r || !r.timestamp) return { bars: [], meta: (r && r.meta) || {} };
  const q = r.indicators.quote[0];
  return {
    meta: r.meta,
    bars: clean(r.timestamp.map((t, i) => ({ timestamp: iv === '1d' ? day(t * 1000) : t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] }))),
  };
}

function createYahoo({ base = 'https://query1.finance.yahoo.com' } = {}) {
  const cache = new Map();
  async function chart(sym, iv, span) {
    const k = sym + '|' + iv + '|' + span, c = cache.get(k), ttl = TTL[iv] || 10e3;
    if (c && Date.now() - c.at < ttl) return c.p;
    const p = (async () => {
      const r = await fetch(`${base}/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&${span}${span.startsWith('period1') ? `&period2=${Math.floor(Date.now() / 1000)}` : ''}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!r.ok) { const e = new Error(`Yahoo 返回 ${r.status}`); e.status = r.status === 404 ? 404 : r.status === 429 ? 429 : 502; throw e; }
      return parse(await r.json(), iv);
    })();
    cache.set(k, { at: Date.now(), p });
    p.catch(() => cache.delete(k));
    return p;
  }
  async function candles(sym, tf, count) {
    const [iv, span] = SRC[tf], { bars } = await chart(sym, iv, span);
    return (KEY[tf] ? aggregate(bars, KEY[tf]) : bars).slice(-count).map(b => ({ ...b }));
  }
  /* 最新价与报价时间（1 分钟图的 meta），10 秒内复用 */
  async function quote(sym) {
    const { meta } = await chart(sym, '1m', 'range=1d');
    const px = +meta.regularMarketPrice, t = (+meta.regularMarketTime || 0) * 1000;
    return Number.isFinite(px) && px > 0 ? { price: px, time: t || Date.now() } : null;
  }
  return { candles, quote };
}

module.exports = { TFS, createYahoo, aggregate, clean, parse, KEY };
