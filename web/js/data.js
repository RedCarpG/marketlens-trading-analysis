/* 数据源适配器 */
/* ===== 数据服务：名称、说明；PROXY 里的服务要经本地代理（server/）访问，GitHub Pages 等处不可用 ===== */
const SRCN = { etoro: 'eToro', yahoo: 'Yahoo', binance: 'Binance', history: '本地历史', demo: '模拟', csv: '本地 CSV' },
  SRCT = {
    etoro: '实时报价，需在 .env 配置 eToro 密钥；K线存到本机，历史随使用增长',
    yahoo: '免费，无需密钥；期货报价约延迟 10 分钟，实时每 15 秒更新一次',
    binance: '实时，免费，浏览器直连',
    history: '导入的长周期历史（npm run import），只有日/周/月线，不更新',
  },
  PROXY = new Set(['etoro', 'yahoo', 'history']);
/* 品种在当前数据服务里的代码 */
const ssym = it => (it.srcs && it.srcs[it.src]) || it.sym;
/* 恢复每个品种上次选的数据服务；不经本地代理打开时换成不需要代理的服务（没有就保持原样，自选里不列出） */
WL.forEach(w => {
  if (!w.srcs) return;
  const s = LS.get('src.' + w.sym);
  if (s && w.srcs[s]) w.src = s;
  if (!LOCAL && PROXY.has(w.src)) w.src = Object.keys(w.srcs).find(k => !PROXY.has(k)) || w.src;
});
/* 经本地代理的数据服务：GET /api/candles 取历史，WS /api/stream 接实时（本地历史没有实时，也只有 tfs 里的周期） */
const viaProxy = (src, count, live = 1, tfs = TFS) => ({
  history: async (it, tf) => {
    if (!tfs.includes(tf)) return [];
    const r = await fetch(
      `/api/candles?src=${src}&symbol=${encodeURIComponent(ssym(it))}&interval=${tf}&count=${count}`
    );
    if (!r.ok) throw 0;
    return r.json();
  },
  subscribe: live
    ? (it, tf, cb) => {
        const w = new WebSocket(
          location.origin.replace('http', 'ws') +
            `/api/stream?src=${src}&symbol=${encodeURIComponent(ssym(it))}&interval=${tf}`
        );
        w.onmessage = e => cb(JSON.parse(e.data));
        return () => w.close();
      }
    : null,
});
/* ===== 数据适配层：每个数据源实现 history(item,tf) 与 subscribe(item,tf,cb)，返回 [{timestamp,open,high,low,close,volume}] ===== */
const AD = {
  demo: {
    history: async (it, tf) => demoAll(it)[tf].map(x => ({ ...x })),
    subscribe: (it, tf, cb, bars) => {
      let l = { ...bars[bars.length - 1] },
        k = 0,
        sg = (bars.slice(-30).reduce((s, x) => s + x.high - x.low, 0) / 30) * 0.35;
      const id = setInterval(() => {
        if (++k % 25 == 0)
          l = {
            timestamp: nxt(tf, l.timestamp),
            open: l.close,
            high: l.close,
            low: l.close,
            close: l.close,
            volume: 0,
          };
        const px = l.close + gs(Math.random) * sg;
        l = {
          ...l,
          close: px,
          high: Math.max(l.high, px),
          low: Math.min(l.low, px),
          volume: l.volume + Math.round(Math.random() * 80),
        };
        cb(l);
      }, 800);
      return () => clearInterval(id);
    },
  },
  binance: {
    history: async (it, tf) =>
      (
        await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${ssym(it)}&interval=${tf}&limit=500`)).json()
      ).map(k => ({ timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })),
    subscribe: (it, tf, cb) => {
      const w = new WebSocket(`wss://stream.binance.com:9443/ws/${ssym(it).toLowerCase()}@kline_${tf}`);
      w.onmessage = e => {
        const m = JSON.parse(e.data),
          k = m.k;
        cb({ timestamp: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, qt: m.E });
      };
      return () => w.close();
    },
  },
  /* eToro：密钥放在本地代理里；代理把每次拉到的K线存到本地，历史随使用时间增长，所以最多取 3000 根 */
  etoro: viaProxy('etoro', 3000),
  /* Yahoo：日线自 2000 年起，15m 只有最近 60 天、1h/4h 最近两年 */
  yahoo: viaProxy('yahoo', 8000),
  history: viaProxy('history', 8000, 0, ['1d', '1w', '1M']),
};
