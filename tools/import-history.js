// 导入长周期历史K线，供回测扩大样本（本地，不入 Git；存到 var/history/<名称>/<周期>.json，格式与本地K线存储相同）。
// 用法：
//   npm run import -- --source yahoo --symbol GC=F --name gc               COMEX 黄金期货日线（2000 年起，含 2011–2015 熊市）
//   npm run import -- --source binance --symbol BTCUSDT --name btc         比特币（Binance 公开接口分页，2017 年起；默认 1d,1w,1M）
//   npm run import -- --source binance --symbol BTCUSDT --name btc --tf 1d,4h,1h,1w,1M
//   npm run import -- --csv 文件.csv --name gold-long                      自己下载的 CSV（列：时间,开,高,低,收[,量]）
// 日线导入后自动聚合出周线（周一 00:00 UTC 起）和月线（每月 1 日起），与页面的时间网格一致。再次运行会按时间合并、补上新数据。
const fs = require('fs');
const path = require('path');
const { createStore } = require('../server/store');
const { loadCore } = require('../tests/load-core');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i < 0 ? d : process.argv[i + 1];
};
const bkt = loadCore()('bkt');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 周线、月线由日线聚合（开 = 第一根开，高低取极值，收 = 最后一根收，量相加） */
function aggregate(daily, tf) {
  const out = [];
  for (const b of daily) {
    const k = bkt(tf, b.timestamp),
      x = out[out.length - 1];
    if (x && x.timestamp === k) {
      x.high = Math.max(x.high, b.high);
      x.low = Math.min(x.low, b.low);
      x.close = b.close;
      x.volume += b.volume;
    } else out.push({ ...b, timestamp: k });
  }
  return out;
}
/* 清洗：去掉缺值；高低价包住开收（部分数据源的期货历史有高低价不含开收的行）；同一时间只留最后一条；按时间排序 */
function clean(bars) {
  const m = new Map();
  for (const b of bars) {
    if (![b.open, b.high, b.low, b.close].every(v => Number.isFinite(v) && v > 0)) continue;
    m.set(b.timestamp, {
      ...b,
      high: Math.max(b.high, b.open, b.close),
      low: Math.min(b.low, b.open, b.close),
      volume: Number.isFinite(b.volume) ? b.volume : 0,
    });
  }
  return [...m.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/* Yahoo 日线时间是纽约午夜（04:00 或 05:00 UTC，少数为当日盘中时刻）：减 3 小时后取 UTC 日期即该交易日，记为当日 00:00 UTC */
function yahooDay(sec) {
  const d = new Date(sec * 1000 - 3 * 36e5);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/* Yahoo Finance 图表接口（无需密钥）。注意：range=max 会被降成月度数据，必须给出起止时间。
   GC=F 为连续主力合约，换月时可能有小跳空（未做价差调整） */
async function yahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=946684800&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Yahoo 返回 ${r.status}`);
  const j = (await r.json()).chart.result[0],
    q = j.indicators.quote[0];
  if (j.meta.dataGranularity !== '1d') throw new Error(`Yahoo 返回的不是日线（${j.meta.dataGranularity}）`);
  return {
    '1d': clean(
      j.timestamp.map((t, i) => ({
        timestamp: yahooDay(t),
        open: q.open[i],
        high: q.high[i],
        low: q.low[i],
        close: q.close[i],
        volume: q.volume[i],
      }))
    ),
  };
}

/* Binance 公开K线（无需密钥）：每次最多 1000 根，从最早开始按 startTime 往后翻页，每页间隔 0.3 秒（远低于限额） */
async function binance(symbol, tfs) {
  const out = {};
  for (const tf of tfs) {
    const rows = [];
    let start = 0;
    for (;;) {
      const r = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&startTime=${start}&limit=1000`
      );
      if (!r.ok) throw new Error(`Binance 返回 ${r.status}：${(await r.text()).slice(0, 200)}`);
      const page = await r.json();
      rows.push(...page);
      process.stdout.write(`\r${symbol} ${tf}：${rows.length} 根`);
      if (page.length < 1000) break;
      start = page[page.length - 1][0] + 1;
      await sleep(300);
    }
    process.stdout.write('\n');
    out[tf] = clean(
      rows.map(k => ({ timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    );
  }
  return out;
}

/* CSV 日线：与页面导入相同的格式（时间可为毫秒/秒时间戳或日期文本；分隔符 , ; 或制表符；首行表头会被跳过）。
   时间统一成该日 00:00 UTC：YYYY-MM-DD 按字面日期；其他日期文本按本机时区解析后取本地日期；时间戳取 UTC 日期 */
function csvDay(s) {
  if (/^\d+$/.test(s)) return bkt('1d', +s < 1e12 ? +s * 1e3 : +s);
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s);
  if (m) return Date.UTC(+m[1], m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? NaN : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}
function csv(text) {
  const o = [];
  for (const ln of text.split(/\r?\n/)) {
    const c = ln.split(/[,;\t]/);
    if (c.length < 5 || isNaN(+c[1])) continue;
    const ts = csvDay(c[0].trim());
    if (isNaN(ts)) continue;
    o.push({ timestamp: ts, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] || 0 });
  }
  return { '1d': clean(o) };
}

async function main() {
  const name = arg('name');
  if (!name || !/^[a-z0-9_-]+$/i.test(name))
    throw new Error('需要 --name（字母、数字、- 或 _），作为 var/history/ 下的目录名');
  const src = arg('source'),
    file = arg('csv');
  let data;
  if (file) data = csv(fs.readFileSync(file, 'utf8'));
  else if (src === 'yahoo') data = await yahoo(arg('symbol', 'GC=F'));
  else if (src === 'binance') data = await binance(arg('symbol', 'BTCUSDT'), arg('tf', '1d,1w,1M').split(','));
  else throw new Error('用 --source yahoo|binance 或 --csv 文件');
  if (data['1d'] && !data['1w']) data['1w'] = aggregate(data['1d'], '1w');
  if (data['1d'] && !data['1M']) data['1M'] = aggregate(data['1d'], '1M');
  const store = createStore(path.join(ROOT, 'var', 'history'));
  for (const [tf, bars] of Object.entries(data)) {
    if (!bars.length) continue;
    const all = store.merge(name, tf, bars),
      d = ts => new Date(ts).toISOString().slice(0, 10);
    console.log(
      `${name} ${tf}：本次 ${bars.length} 根，合计 ${all.length} 根（${d(all[0].timestamp)} → ${d(all[all.length - 1].timestamp)}）`
    );
  }
  console.log(`已存到 var/history/${name}/；回测：npm run backtest -- --data ${name}`);
}

if (require.main === module)
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });

module.exports = { aggregate, clean, csv, yahooDay };
