'use strict';
/* eToro 只读行情：REST K线、品种ID解析、实时报价订阅。只调用 market-data 接口，不接入任何交易或账户接口。
   接口依据 https://api-portal.etoro.com （2026-10-22 核对）：K线最多 1000 根、只能取最近的 N 根、没有月线。 */
const { randomUUID } = require('crypto');
const WebSocket = require('ws');

const IV = { '15m': 'FifteenMinutes', '1h': 'OneHour', '4h': 'FourHours', '1d': 'OneDay', '1w': 'OneWeek' };
const STEP = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 };
const TTL = { '15m': 20e3, '1h': 60e3, '4h': 120e3, '1d': 300e3, '1w': 600e3 }; // 缓存时长，节省每分钟 60 次的额度
const TFS = [...Object.keys(IV), '1M'];

/* 月份键：加 12 小时再取 UTC 月份，兼容日线从前一天 22:00 UTC 开盘的品种 */
const mkey = t => { const d = new Date(t + 432e5); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
function toMonths(bars) {
  const out = [];
  for (const b of bars) {
    const k = mkey(b.timestamp), x = out[out.length - 1];
    if (x && x.timestamp === k) { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; x.volume += b.volume; }
    else out.push({ ...b, timestamp: k });
  }
  return out;
}

/* 带密钥的 GET 与缓存：同一请求在缓存期内复用，并发请求共享同一个 Promise；失败不缓存 */
function http({ apiKey, userKey, baseUrl }) {
  const cache = new Map();
  async function get(path) {
    const r = await fetch(baseUrl + path, { headers: { 'x-api-key': apiKey, 'x-user-key': userKey, 'x-request-id': randomUUID() } });
    if (!r.ok) { const e = new Error(`eToro 返回 ${r.status}`); e.status = r.status; e.detail = (await r.text()).slice(0, 300); throw e; }
    return r.json();
  }
  function cached(key, ttl, fn) {
    const c = cache.get(key);
    if (c && Date.now() - c.at < ttl) return c.p;
    const p = fn();
    cache.set(key, { at: Date.now(), p });
    p.catch(() => cache.delete(key));
    return p;
  }
  return { get, cached };
}

function createClient({ apiKey, userKey, baseUrl, symbolMap = {}, store = null }) {
  const { get, cached } = http({ apiKey, userKey, baseUrl }), ids = new Map(Object.entries(symbolMap));
  /* v2 按 symbol 精确查询；v1 search 是前缀匹配且分页，GOLD 会被 GOLD.24-7、各期货合约挤出第一页 */
  async function resolve(sym) {
    if (ids.has(sym)) return ids.get(sym);
    const d = await cached('id:' + sym, 864e5, () => get('/api/v2/market-data/instruments?' + new URLSearchParams({ symbols: sym })));
    const hit = (d.results || []).find(i => String(i.symbol).toUpperCase() === sym.toUpperCase());
    if (!hit) { const e = new Error(`eToro 未找到品种 ${sym}`); e.status = 404; throw e; }
    ids.set(sym, hit.instrumentId);
    return hit.instrumentId;
  }
  /* 总是取最近 1000 根并缓存，不同 count 的请求共用；有本地存储时把这 1000 根并入已存历史，返回合并后的完整序列 */
  async function fetch1000(id, tf) {
    const d = await get(`/api/v1/market-data/instruments/${id}/history/candles/desc/${IV[tf]}/1000`);
    const list = (d.candles && d.candles[0] && d.candles[0].candles) || [];
    const fresh = list.map(c => ({ timestamp: Date.parse(c.fromDate), open: +c.open, high: +c.high, low: +c.low, close: +c.close, volume: +c.volume || 0 }))
      .filter(b => Number.isFinite(b.timestamp) && Number.isFinite(b.close)).sort((a, b) => a.timestamp - b.timestamp);
    return store ? store.merge(id, tf, fresh) : fresh;
  }
  const raw = (id, tf) => cached(`c:${id}:${tf}`, TTL[tf], () => fetch1000(id, tf));
  /* 后台补拉：把本地已存过的每个品种/周期重新拉一次（绕过缓存），保证长时间不开页面时 15m 等短周期也不断档 */
  async function refreshStored() {
    if (!store) return 0;
    let n = 0;
    for (const { instrumentId, interval } of store.list()) {
      if (!IV[interval]) continue;
      try { await fetch1000(instrumentId, interval); n++; } catch (e) { console.warn(`[store] 补拉 ${instrumentId} ${interval} 失败：${e.message}`); }
      await new Promise(r => setTimeout(r, 1500)); // 放慢节奏，远低于每分钟 60 次的额度
    }
    return n;
  }
  /* 月线：eToro 不提供。近期月份由日线聚合（准确）；日线覆盖不到的早期月份由周线按周起始日归月（跨月的周会有偏差） */
  async function monthly(id) {
    const [d, w] = await Promise.all([raw(id, '1d'), raw(id, '1w')]), md = toMonths(d);
    if (!md.length) return toMonths(w);
    return toMonths(w).filter(m => m.timestamp <= md[0].timestamp).concat(md.slice(1));
  }
  async function candles(sym, tf, count) {
    const id = await resolve(sym);
    return (tf === '1M' ? await monthly(id) : await raw(id, tf)).slice(-count).map(b => ({ ...b }));
  }
  return { resolve, candles, refreshStored };
}

/* eToro 部分时间字段不带时区（如 "2026-10-22T18:57:30.053"），按 UTC 处理 */
const utc = s => (s ? Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z') : NaN);

/* 个人交易记录（只读）：使用单独的只读密钥，只调用 GET 接口，不接入下单 */
function createTrader({ apiKey, userKey, baseUrl }) {
  const { get, cached } = http({ apiKey, userKey, baseUrl });
  /* 已平仓：接口返回 minDate 至今，单次回看不超过 1 年（文档：最多 1 年减 1 天），按页取，最多 20 页 */
  async function closed(days) {
    const minDate = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10), all = [];
    for (let page = 1; page <= 20; page++) {
      const d = await get('/api/v1/trading/info/trade/history?' + new URLSearchParams({ minDate, page, pageSize: 100 }));
      const a = Array.isArray(d) ? d : d.items || d.trades || [];
      all.push(...a);
      if (a.length < 100) break;
    }
    return all.map(t => ({ id: t.positionId, instrumentId: t.instrumentId, isBuy: !!t.isBuy, openTs: utc(t.openTimestamp), openRate: +t.openRate, closeTs: utc(t.closeTimestamp), closeRate: +t.closeRate,
      units: +t.units || 0, leverage: +t.leverage || 1, netProfit: +t.netProfit || 0, fees: +t.fees || 0, investment: +t.investment || 0, sl: +t.stopLossRate || 0, tp: +t.takeProfitRate || 0 }))
      .filter(t => Number.isFinite(t.openTs) && Number.isFinite(t.closeTs)).sort((a, b) => a.closeTs - b.closeTs);
  }
  /* 当前持仓：/real/pnl 比 /portfolio 多了每笔的浮动盈亏和当前价；只含手动持仓，不含跟单（mirrors） */
  async function open() {
    const d = await get('/api/v1/trading/info/real/pnl'), ps = (d.clientPortfolio && d.clientPortfolio.positions) || [];
    return ps.map(p => ({ id: p.positionID, instrumentId: p.instrumentID, isBuy: !!p.isBuy, openTs: utc(p.openDateTime), openRate: +p.openRate, units: +p.units || 0, leverage: +p.leverage || 1,
      amount: +p.amount || 0, sl: p.isNoStopLoss ? 0 : +p.stopLossRate || 0, tp: p.isNoTakeProfit ? 0 : +p.takeProfitRate || 0,
      pnl: p.unrealizedPnL ? +p.unrealizedPnL.pnL : null, curRate: p.unrealizedPnL ? +p.unrealizedPnL.closeRate : null })).filter(p => Number.isFinite(p.openTs));
  }
  return { closed: days => cached('closed:' + days, 60e3, () => closed(days)), open: () => cached('open', 15e3, open) };
}

/* 用实时报价推进当前K线：同一周期内更新高低收，越过周期边界则按 REST K线的时间网格开新K线 */
function advance(bar, tf, price, t) {
  let ts = bar.timestamp;
  if (tf === '1M') { const k = mkey(t); if (k > ts) ts = k; }
  else if (t >= ts + STEP[tf]) ts += Math.floor((t - ts) / STEP[tf]) * STEP[tf];
  if (ts !== bar.timestamp) return { timestamp: ts, open: price, high: price, low: price, close: price, volume: 0 };
  return { ...bar, close: price, high: Math.max(bar.high, price), low: Math.min(bar.low, price) };
}

function pickPrice(c, mode) {
  const bid = +c.Bid, ask = +c.Ask, last = +c.LastExecution;
  const v = mode === 'ask' ? ask : mode === 'mid' ? (bid + ask) / 2 : mode === 'last' ? last : bid;
  return Number.isFinite(v) && v > 0 ? v : null;
}

/* 共用一条上游 WebSocket，按 instrumentId 引用计数订阅。
   文档称 instrument:<id> 无需鉴权，但实测（2026-10-22）未鉴权会返回 SessionNotAuthenticated，所以连上后先 Authenticate 再订阅 */
class Upstream {
  constructor(url, keys) { this.url = url; this.keys = keys; this.subs = new Map(); this.ws = null; this.authed = false; this.retry = 0; }
  add(id, fn) {
    let s = this.subs.get(id);
    if (!s) { s = new Set(); this.subs.set(id, s); this.send('Subscribe', [id]); }
    s.add(fn);
    this.ensure();
    return () => {
      s.delete(fn);
      if (s.size) return;
      this.subs.delete(id);
      this.send('Unsubscribe', [id]);
      if (!this.subs.size) this.close();
    };
  }
  ensure() {
    if (this.ws) return;
    const ws = this.ws = new WebSocket(this.url);
    this.authed = false;
    ws.on('open', () => ws.send(JSON.stringify({ id: randomUUID(), operation: 'Authenticate', data: { userKey: this.keys.userKey, apiKey: this.keys.apiKey } })));
    ws.on('message', d => {
      let m; try { m = JSON.parse(d); } catch { return; } // 上游偶尔发送非 JSON 帧（如 \u0000）
      if (m.operation && m.success === false) console.warn(`[etoro ws] ${m.operation} 失败：${m.errorCode || ''} ${m.errorMessage || ''}`);
      if (m.operation === 'Authenticate' && m.success) { this.authed = true; this.retry = 0; if (this.subs.size) this.send('Subscribe', [...this.subs.keys()]); }
      for (const x of m.messages || []) {
        const s = this.subs.get(+String(x.topic).split(':')[1]);
        if (!s) continue;
        let c; try { c = typeof x.content === 'string' ? JSON.parse(x.content) : x.content; } catch { continue; }
        s.forEach(f => f(c));
      }
    });
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.subs.size) setTimeout(() => this.ensure(), Math.min(30e3, 1e3 * 2 ** this.retry++));
    });
    ws.on('error', e => console.warn('[etoro ws]', e.message));
  }
  send(op, list) {
    if (!this.ws || !this.authed || this.ws.readyState !== WebSocket.OPEN) return;
    const data = { topics: list.map(i => 'instrument:' + i) };
    if (op === 'Subscribe') data.snapshot = true;
    this.ws.send(JSON.stringify({ id: randomUUID(), operation: op, data }));
  }
  close() { const w = this.ws; this.ws = null; if (w) w.close(); }
}

module.exports = { TFS, createClient, createTrader, advance, pickPrice, Upstream, toMonths };
