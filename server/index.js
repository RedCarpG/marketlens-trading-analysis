'use strict';
/* MarketLens 本地代理：只监听本机，托管 web/ 下的页面，并提供可切换的数据服务（src）：
   etoro   eToro 行情（需密钥，实时报价；K线存到本地，历史随使用增长）
   yahoo   Yahoo Finance（无需密钥，非官方接口；期货约延迟 10 分钟，实时按 15 秒轮询最新价）
   history tools/import-history.js 导入的长周期历史（var/history/<名称>/，只有 1d/1w/1M，不更新）
   GET /api/sources                                     → 各数据服务是否可用、已导入的历史数据集
   GET /api/candles?src=&symbol=&interval=&count=       → 标准化K线数组（旧到新）
   WS  /api/stream?src=&symbol=&interval=               → 推送标准化单根K线（附报价时间 qt）
   旧路径 /api/etoro/candles、/api/etoro/stream 等同 src=etoro。
   密钥只从项目根目录 .env 读取，不发给前端、不写日志。 */
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { TFS, createClient, createTrader, advance, pickPrice, Upstream } = require('./etoro');
const { createStore } = require('./store');
const { createYahoo } = require('./yahoo');

const ROOT = path.resolve(__dirname, '..');
function loadEnv(f) {
  if (!fs.existsSync(f)) return;
  for (const ln of fs.readFileSync(f, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = ln.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnv(path.join(ROOT, '.env'));

const E = process.env, HOST = E.HOST || '127.0.0.1', PORT = +E.PORT || 8787;
const KEYS = !!(E.ETORO_API_KEY && E.ETORO_USER_KEY), PRICE = (E.ETORO_PRICE || 'bid').toLowerCase();
/* ETORO_SYMBOL_MAP=GOLD=18,XAUUSD=18：跳过搜索，直接指定 instrumentId */
const symbolMap = Object.fromEntries((E.ETORO_SYMBOL_MAP || '').split(',').map(s => s.split('=').map(x => x.trim())).filter(([k, v]) => k && /^\d+$/.test(v)).map(([k, v]) => [k, +v]));
/* 本地K线存储放在 var/candles（不入 Git）；ETORO_STORE_DIR 可改位置 */
const store = createStore(E.ETORO_STORE_DIR || path.join(ROOT, 'var', 'candles'));
const client = createClient({ apiKey: E.ETORO_API_KEY, userKey: E.ETORO_USER_KEY, baseUrl: E.ETORO_BASE_URL || 'https://public-api.etoro.com', symbolMap, store });
const upstream = new Upstream(E.ETORO_WS_URL || 'wss://ws.etoro.com/ws', { apiKey: E.ETORO_API_KEY, userKey: E.ETORO_USER_KEY });
const yahoo = createYahoo();
/* 导入的长周期历史：每次请求重新读文件（导入工具可能在代理运行时更新数据） */
const HIST = path.join(ROOT, 'var', 'history');
function readHist(name, tf) {
  try { return JSON.parse(fs.readFileSync(path.join(HIST, name, tf + '.json'), 'utf8')).bars.map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume })); }
  catch { return []; }
}
function histSets() {
  let names = [];
  try { names = fs.readdirSync(HIST).filter(n => fs.statSync(path.join(HIST, n)).isDirectory()); } catch { return []; }
  return names.map(name => {
    const tfs = TFS.filter(tf => fs.existsSync(path.join(HIST, name, tf + '.json'))), d = readHist(name, '1d');
    return { name, tfs, count: d.length, from: d.length ? d[0].timestamp : null, to: d.length ? d[d.length - 1].timestamp : null };
  }).filter(s => s.tfs.length);
}
/* 数据服务：sym 为该服务允许的代码格式；need() 返回不可用的原因；candles(symbol, interval, count) 返回标准化K线 */
const SRCS = {
  etoro: { sym: /^[A-Za-z0-9._-]{1,30}$/, need: () => !KEYS && '未配置 ETORO_API_KEY / ETORO_USER_KEY（见 .env.example）', candles: (s, tf, n) => client.candles(s, tf, n) },
  yahoo: { sym: /^[A-Za-z0-9.^=_-]{1,30}$/, need: () => null, candles: (s, tf, n) => yahoo.candles(s, tf, n) },
  history: {
    sym: /^[A-Za-z0-9_-]{1,40}$/,
    need: () => null,
    candles: async (s, tf, n) => {
      const b = readHist(s, tf);
      if (!b.length) { const e = new Error(`本地历史没有 ${s} 的 ${tf}（用 npm run import 导入；只有 1d/1w/1M）`); e.status = 404; throw e; }
      return b.slice(-n);
    },
  },
};

/* 交易记录用单独的只读密钥，与行情密钥分开 */
const TKEYS = !!(E.ETORO_TRADE_API_KEY && E.ETORO_TRADE_USER_KEY);
const trader = createTrader({ apiKey: E.ETORO_TRADE_API_KEY, userKey: E.ETORO_TRADE_USER_KEY, baseUrl: E.ETORO_BASE_URL || 'https://public-api.etoro.com' });

/* 页面文件：只托管 web/ 目录下的 html/css/js；路径规范化后必须仍在 web/ 内，防止 ../ 穿越读到 .env 等 */
const WEB = path.join(ROOT, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serveWeb(u, res) {
  let rel;
  try { rel = u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return false; }
  const f = path.resolve(WEB, rel), type = MIME[path.extname(f)];
  if (!type || !f.startsWith(WEB + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
  return true;
}
const ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
/* 只接受以本机地址访问的 API 请求，防止其他网站通过 DNS 重绑定读取行情和交易记录 */
const HOSTS = new Set([...ORIGINS].map(o => o.slice(7)));
const SYM = /^[A-Za-z0-9._-]{1,30}$/;

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
function params(u) {
  const src = u.pathname.startsWith('/api/etoro/') ? 'etoro' : u.searchParams.get('src') || '', S = SRCS[src];
  if (!S) return { err: `src 须为 ${Object.keys(SRCS).join('/')}` };
  const symbol = u.searchParams.get('symbol') || '', interval = u.searchParams.get('interval') || '';
  if (!S.sym.test(symbol)) return { err: 'symbol 无效' };
  if (!TFS.includes(interval)) return { err: `interval 须为 ${TFS.join('/')}` };
  /* 有本地存储后历史可以超过 1000 根，单次最多返回 5000 根 */
  return { src, S, symbol, interval, count: Math.min(8000, Math.max(1, parseInt(u.searchParams.get('count'), 10) || 500)) };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  if (req.method !== 'GET') return json(res, 405, { error: '只支持 GET' });
  /* 旧地址（拆分前的单文件页面）跳到首页 */
  if (u.pathname === '/market-analyzer.html') { res.writeHead(302, { location: '/' }); return res.end(); }
  if (!u.pathname.startsWith('/api/') && serveWeb(u, res)) return;
  if (u.pathname.startsWith('/api/') && (!HOSTS.has(req.headers.host) || (req.headers.origin && !ORIGINS.has(req.headers.origin)))) return json(res, 403, { error: 'forbidden' });
  if (u.pathname === '/api/health') return json(res, 200, { ok: true, keys: KEYS, trade: TKEYS, price: PRICE });
  if (u.pathname === '/api/sources') return json(res, 200, { etoro: { ok: KEYS }, yahoo: { ok: true }, history: { ok: true, sets: histSets() } });
  /* 本地K线存储概况：每个品种/周期的根数与起止时间 */
  if (u.pathname === '/api/store') return json(res, 200, store.list());
  /* 个人交易：已平仓 ?symbol=&days=（1–364，默认 364）与当前持仓 ?symbol=；给了 symbol 时只返回该品种 */
  if (u.pathname === '/api/etoro/trades' || u.pathname === '/api/etoro/positions') {
    if (!TKEYS) return json(res, 503, { error: '未配置 ETORO_TRADE_API_KEY / ETORO_TRADE_USER_KEY（见 .env.example）' });
    const sym = u.searchParams.get('symbol') || '', days = Math.min(364, Math.max(1, parseInt(u.searchParams.get('days'), 10) || 364));
    if (sym && !SYM.test(sym)) return json(res, 400, { error: 'symbol 无效' });
    try {
      const id = sym && KEYS ? await client.resolve(sym) : null, list = u.pathname.endsWith('trades') ? await trader.closed(days) : await trader.open();
      return json(res, 200, id == null ? list : list.filter(t => t.instrumentId === id));
    } catch (e) {
      console.warn(`[${u.pathname.split('/').pop()}] ${e.message}${e.status === 401 || e.status === 403 ? '（检查交易密钥及其读取交易记录的权限）' : ''}`);
      return json(res, e.status === 429 ? 429 : e.status === 401 || e.status === 403 ? 403 : 502, { error: e.message });
    }
  }
  if (u.pathname === '/api/candles' || u.pathname === '/api/etoro/candles') {
    const p = params(u);
    if (p.err) return json(res, 400, { error: p.err });
    const need = p.S.need();
    if (need) return json(res, 503, { error: need });
    try { return json(res, 200, await p.S.candles(p.symbol, p.interval, p.count)); }
    catch (e) {
      if (e.status !== 404) console.warn(`[candles] ${p.src} ${p.symbol} ${p.interval}: ${e.message}${e.detail ? ' ' + e.detail : ''}`);
      return json(res, e.status === 429 ? 429 : e.status === 404 ? 404 : 502, { error: e.message });
    }
  }
  json(res, 404, { error: 'not found' });
});

/* 实时：用 REST 最新一根K线做起点，再用实时报价推进；每个连接最多每 300ms 推送一次。
   推送的K线附带 qt = 最后一笔报价的时间（eToro 报价自带的 Date），页面据此判断是在交易中还是已休市（休市时订阅只收到一笔旧报价）。
   yahoo 没有推送接口：每 15 秒取一次最新价推进当前K线；本地历史不提供实时 */
const WSP = new Set(['/api/stream', '/api/etoro/stream']);
const wss = new WebSocketServer({ server, verifyClient: ({ origin, req }) => WSP.has(new URL(req.url, 'http://local').pathname) && HOSTS.has(req.headers.host) && (!origin || ORIGINS.has(origin)) });
wss.on('connection', async (ws, req) => {
  const p = params(new URL(req.url, 'http://local'));
  if (p.err || p.S.need() || p.src === 'history') return ws.close(1008, p.err || (p.src === 'history' ? 'no live data' : 'no keys'));
  let bar, unsub, timer = null, closed = false, qt = 0;
  ws.on('close', () => { closed = true; clearTimeout(timer); if (unsub) unsub(); });
  if (p.src === 'yahoo') {
    try {
      const seed = await yahoo.candles(p.symbol, p.interval, 1);
      if (closed) return;
      if (!seed.length) return ws.close(1011, 'no candles');
      bar = seed[0];
      const tick = async () => {
        try {
          const q = await yahoo.quote(p.symbol);
          if (closed) return;
          if (q) { bar = advance(bar, p.interval, q.price, q.time); if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...bar, qt: q.time })); }
        } catch (e) { console.warn(`[stream] yahoo ${p.symbol}: ${e.message}`); }
        if (!closed) timer = setTimeout(tick, 15e3);
      };
      tick();
    } catch (e) {
      console.warn(`[stream] yahoo ${p.symbol} ${p.interval}: ${e.message}`);
      ws.close(1011, 'upstream error');
    }
    return;
  }
  try {
    const id = await client.resolve(p.symbol), seed = await client.candles(p.symbol, p.interval, 1);
    if (closed) return;
    if (!seed.length) return ws.close(1011, 'no candles');
    bar = seed[0];
    unsub = upstream.add(id, c => {
      const px = pickPrice(c, PRICE), t = Date.parse(c.Date) || Date.now();
      if (px == null) return;
      bar = advance(bar, p.interval, px, t);
      qt = t;
      if (!timer) timer = setTimeout(() => { timer = null; if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ ...bar, qt })); }, 300);
    });
  } catch (e) {
    console.warn(`[stream] ${p.symbol} ${p.interval}: ${e.message}`);
    ws.close(1011, 'upstream error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MarketLens 已启动：http://${HOST}:${PORT}/`);
  if (!KEYS) console.warn('未配置 ETORO_API_KEY / ETORO_USER_KEY：页面可用（模拟、CSV、Binance、Yahoo、本地历史），eToro 数据服务不可用');
  if (!TKEYS) console.warn('未配置 ETORO_TRADE_API_KEY / ETORO_TRADE_USER_KEY：不显示个人交易记录');
  const st = store.list();
  console.log(`本地K线存储：${st.length ? st.map(s => `${s.instrumentId}/${s.interval} ${s.count}根`).join('，') : '暂无（打开页面后开始积累）'}`);
});

/* 后台补拉：启动 1 分钟后一次，之后每 6 小时一次，把已存过的品种/周期再拉一遍，避免长时间不开页面时短周期断档 */
if (KEYS) {
  const refresh = () => client.refreshStored().then(n => n && console.log(`[store] 已补拉 ${n} 组K线`)).catch(e => console.warn('[store]', e.message));
  setTimeout(refresh, 60e3).unref();
  setInterval(refresh, 6 * 36e5).unref();
}
