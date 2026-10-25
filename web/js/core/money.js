/* 金额币种与汇率换算（纯计算）：交易记录的金额是美元，交易页可换成欧元 / 人民币 */
const CCY = { USD: ['美元', '$'], EUR: ['欧元', '€'], CNY: ['人民币', '¥'] };
/* fx：{ ts: [日期升序], r: [1 美元 = ? 目标货币] }；取 ts 所在日（或之前最近一天）的汇率，早于第一天时用第一天 */
function fxAt(fx, ts) {
  if (ts <= fx.ts[0]) return fx.r[0];
  let lo = 0,
    hi = fx.ts.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (fx.ts[m] <= ts) lo = m;
    else hi = m - 1;
  }
  return fx.r[lo];
}
/* 带币种符号的金额，如 +€12.30、-¥85.00；sign=0 时正数不加 +；一万以上不保留小数 */
function fmtMoney(v, c, sign = 1) {
  const a = Math.abs(v);
  return `${v < 0 ? '-' : sign ? '+' : ''}${CCY[c][1]}${a.toFixed(a >= 10000 ? 0 : 2)}`;
}
