/* 数据源适配器 */
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
        await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${it.sym}&interval=${tf}&limit=500`)).json()
      ).map(k => ({ timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })),
    subscribe: (it, tf, cb) => {
      const w = new WebSocket(`wss://stream.binance.com:9443/ws/${it.sym.toLowerCase()}@kline_${tf}`);
      w.onmessage = e => {
        const m = JSON.parse(e.data),
          k = m.k;
        cb({ timestamp: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, qt: m.E });
      };
      return () => w.close();
    },
  },
  /* eToro：密钥放在你自己的后端代理里，代理返回上述标准化 K 线；路径可按你的后端调整。
     代理会把每次拉到的K线存到本地，历史随使用时间增长，所以这里最多取 3000 根 */
  etoro: {
    history: async (it, tf) => {
      const r = await fetch(`/api/etoro/candles?symbol=${it.sym}&interval=${tf}&count=3000`);
      if (!r.ok) throw 0;
      return r.json();
    },
    subscribe: (it, tf, cb) => {
      const w = new WebSocket(
        location.origin.replace('http', 'ws') + `/api/etoro/stream?symbol=${it.sym}&interval=${tf}`
      );
      w.onmessage = e => cb(JSON.parse(e.data));
      return () => w.close();
    },
  },
};
