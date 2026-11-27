/* 回测线程：加载 core/ 的纯计算脚本，在后台跑 btRun / btReport，页面不卡；进度和结果用 postMessage 传回。
   收到 { all, opts, cost }：all 为各周期K线（入场周期及更大），opts 为回测选项，cost 为成本预设（null = 不计）。
   回测跑完接着跑一遍关键价位统计（core/study.js 的 lvStudy，同一段时间、同一个周期），结果放在 done.lv 里；
   它出错不影响回测的结果（done.lvErr 里写原因） */
importScripts(
  'core/time.js',
  'core/indicators.js',
  'core/levels.js',
  'core/mtf.js',
  'core/scenarios.js',
  'core/alertrules.js',
  'core/alertlog.js',
  'core/backtest.js',
  'core/study.js'
);
onmessage = e => {
  try {
    const { all, opts } = e.data,
      /* 两段各占一半进度 */
      done = btPage(e.data, p => postMessage({ prog: p / 2 }));
    try {
      done.lv = lvReport(
        lvStudy(all, {
          tf: opts.tf,
          ...(opts.from != null ? { from: opts.from } : {}),
          ...(opts.to != null ? { to: opts.to } : {}),
          prog: p => postMessage({ prog: 0.5 + p / 2 }),
        })
      );
    } catch (err) {
      done.lvErr = err.message || String(err);
    }
    postMessage({ done });
  } catch (err) {
    postMessage({ err: err.message || String(err) });
  }
};
