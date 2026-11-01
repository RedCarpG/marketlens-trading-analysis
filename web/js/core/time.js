/* 周期与时间网格（纯计算，无 DOM，可在 Node 中测试） */
const STEP = { '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5, '1M': 2629746e3 },
  TFS = Object.keys(STEP);
/* K线起点：周线从周一 00:00 UTC 起，月线从每月 1 日起，其余按固定步长对齐 */
const bkt = (tf, t) => {
  if (tf == '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  if (tf == '1w') return Math.floor((t - 3456e5) / 6048e5) * 6048e5 + 3456e5;
  return Math.floor(t / STEP[tf]) * STEP[tf];
};
/* 未来时刻 ts 大约落在第几根K线：按最近 100 根的实际平均间隔估算（已含休市），至少在最新K线之后一根 */
const futIdx = (bs, ts) => {
  const n = bs.length,
    k = Math.min(100, n - 1),
    avg = k > 0 ? (bs[n - 1].timestamp - bs[n - 1 - k].timestamp) / k : 864e5;
  return n - 1 + Math.max(1, Math.round((ts - bs[n - 1].timestamp) / avg));
};
const nxt = (tf, t) => {
  if (tf == '1M') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return t + STEP[tf];
};
