/* 回测线程：加载 core/ 的纯计算脚本，在后台跑 btRun / btReport，页面不卡；进度和结果用 postMessage 传回。
   收到 { all, opts, cost }：all 为各周期K线（入场周期及更大），opts 为回测选项，cost 为成本预设（null = 不计） */
importScripts(
  'core/time.js',
  'core/indicators.js',
  'core/levels.js',
  'core/mtf.js',
  'core/scenarios.js',
  'core/backtest.js'
);
onmessage = e => {
  try {
    postMessage({ done: btPage(e.data, p => postMessage({ prog: p })) });
  } catch (err) {
    postMessage({ err: err.message || String(err) });
  }
};
