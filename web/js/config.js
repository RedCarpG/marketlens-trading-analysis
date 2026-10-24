/* 页面通用：DOM 简写、自选列表、本机偏好存储 */
const $ = s => document.querySelector(s);
/* 是否经本地代理打开：eToro 行情、交易记录和K线存储都要通过本机代理（127.0.0.1），在其他地方（如 GitHub Pages、直接打开文件）不可用 */
const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname) && location.protocol.startsWith('http');
/* grp：左侧分组；新增品种时指定分组，GRPS 决定分组顺序 */
const WL = [
  { sym: 'GOLD', name: '黄金 GOLD · eToro', src: 'etoro', p: 2, grp: '黄金' },
  { sym: 'BTCUSDT', name: '比特币 · Binance', src: 'binance', p: 2, grp: '加密货币' },
  { sym: 'GC', name: '黄金期货 GC', src: 'demo', p: 2, base: 2650, grp: '模拟' },
  { sym: 'AAPL', name: '苹果 AAPL', src: 'demo', p: 2, base: 230, grp: '模拟' },
  { sym: 'EURUSD', name: '欧元/美元', src: 'demo', p: 5, base: 1.08, grp: '模拟' },
];
const GRPS = ['黄金', '美股', '外汇', '加密货币', '模拟', '本地'];
/* 本机偏好（主题、配色、分组折叠、上次品种）；存储不可用时用默认值 */
/* 项目原名 FinBot：首次以新名字运行时，把旧的 finbot.* 偏好复制到 marketlens.* */
try {
  const ks = Object.keys(localStorage);
  if (!ks.some(k => k.startsWith('marketlens.')))
    ks.filter(k => k.startsWith('finbot.')).forEach(k =>
      localStorage.setItem('marketlens.' + k.slice(7), localStorage.getItem(k))
    );
} catch (_) {}
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem('marketlens.' + k);
      return v == null ? d : JSON.parse(v);
    } catch (_) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('marketlens.' + k, JSON.stringify(v));
    } catch (_) {}
  },
};
