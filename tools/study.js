// 两项研究的命令行（纯计算在 web/js/core/study.js，结论写在 docs/BACKTEST.md 第 18、19 节）：
//   npm run study -- levels --data gc [--tf 1d] [--from 2011-01-01] [--to 2015-12-31]   关键价位统计，用导入的长周期历史（var/history/<名称>/）
//   npm run study -- levels --id 18 [--tf 1d]                                           用本地K线存储（var/candles/<品种号>/）
//   npm run study -- levels --yahoo GC=F --tf 1h                                         经本机代理取 Yahoo 的K线（代理要开着）
//   npm run study -- events [--yahoo GC=F]                                               事件研究：Yahoo 的 1 小时K线 + 代理的经济日历（代理要开着）
// 结果打印出来，并写到 var/study/（本地，不入 Git）。只描述过去发生过什么，不是预测。
const fs = require('fs');
const path = require('path');
const { loadCore } = require('../core/load');
const { toMonths } = require('../server/etoro');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i < 0 ? d : process.argv[i + 1];
};
const get = loadCore();
const [TFS, lvStudy, lvReport, lvText, evStudy, evReport, evText] = [
  'TFS',
  'lvStudy',
  'lvReport',
  'lvText',
  'evStudy',
  'evReport',
  'evText',
].map(get);
const plain = v => JSON.parse(JSON.stringify(v));
const PROXY = `http://127.0.0.1:${process.env.PORT || 8787}`;

/* ===== 数据 ===== */
function loadDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`没有 ${path.relative(ROOT, dir)}`);
  const all = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    all[f.replace(/\.json$/, '')] = j.bars.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }));
  }
  if (all['1d'] && all['1w'] && !all['1M']) {
    const md = toMonths(all['1d']);
    all['1M'] = toMonths(all['1w'])
      .filter(m => m.timestamp <= md[0].timestamp)
      .concat(md.slice(1));
  }
  return all;
}
async function proxyGet(p) {
  let r;
  try {
    r = await fetch(PROXY + p);
  } catch {
    throw new Error(`连不上本机代理（${PROXY}）：先在 server/ 里 npm start，或 tools\\autostart.ps1 start`);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok || j == null) throw new Error(`代理回 ${r.status}${j && j.error ? '：' + j.error : ''}`);
  return j;
}
async function loadYahoo(sym, tf) {
  const all = {};
  for (const k of TFS.slice(TFS.indexOf(tf)))
    all[k] = await proxyGet(`/api/candles?src=yahoo&symbol=${encodeURIComponent(sym)}&interval=${k}&count=8000`);
  return all;
}

/* ===== 输出 ===== */
const wid = s => [...String(s)].reduce((w, c) => w + (/[⺀-￿]/.test(c) ? 2 : 1), 0);
const pad = (s, w, r) => {
  s = String(s ?? '');
  const p = ' '.repeat(Math.max(0, w - wid(s)));
  return r ? p + s : s + p;
};
const day = t => (t == null ? '—' : new Date(t).toISOString().slice(0, 10));
const pc = v => (v == null ? '—' : (v * 100).toFixed(0) + '%');
function save(name, data) {
  const dir = path.join(ROOT, 'var', 'study');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${name}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`);
  fs.writeFileSync(f, JSON.stringify(data));
  console.log(`\n完整结果：${path.relative(ROOT, f)}`);
}

async function levels() {
  const tf = arg('tf', '1d'),
    label = arg('data') ? arg('data') : arg('yahoo') ? 'yahoo-' + arg('yahoo') : 'id' + arg('id', '18'),
    all = arg('data')
      ? loadDir(path.join(ROOT, 'var', 'history', arg('data')))
      : arg('yahoo')
        ? await loadYahoo(arg('yahoo'), tf)
        : loadDir(path.join(ROOT, 'var', 'candles', arg('id', '18'))),
    opts = {
      tf,
      ...(arg('from') ? { from: Date.parse(arg('from')) } : {}),
      ...(arg('to') ? { to: Date.parse(arg('to')) } : {}),
    };
  if (!all[tf] || !all[tf].length) throw new Error(`这份数据没有 ${tf} 周期`);
  const t0 = Date.now(),
    study = lvStudy(all, opts),
    rep = plain(lvReport(study)),
    line = r =>
      console.log(
        `  ${pad(r.name, 30)}${pad(r.n, 7, 1)}${pad(r.bounce, 8, 1)}${pad(r.brk, 8, 1)}${pad(r.open, 7, 1)}${pad(pc(r.rate), 9, 1)}   ${r.rate == null ? '' : `[${pc(r.lo)}, ${pc(r.hi)}]`}${r.thin ? '  样本少' : ''}`
      );
  const first = study.touches[0],
    last = study.touches[study.touches.length - 1];
  console.log(
    `关键价位统计 · ${label} · ${tf} · ${day(first && first.ts)} → ${day(last && last.ts)} · 回放 ${rep.steps} 根（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`
  );
  console.log(
    `关键价位平均同时有 ${rep.keys.toFixed(1)} 条；${pc(rep.atKey)} 的时间收盘价就在某一条的 0.25 个 ATR 以内\n`
  );
  console.log(
    `  ${pad('', 30)}${pad('触及', 7, 1)}${pad('被挡回', 8, 1)}${pad('穿过去', 8, 1)}${pad('未定', 7, 1)}${pad('挡回比例', 9, 1)}   95% 区间`
  );
  rep.kinds.forEach(line);
  for (const [title, k] of [
    ['之前被挡回的次数', 'touch'],
    ['来自哪个周期', 'top'],
    ['几个周期都有', 'tfs'],
    ['在试支撑还是阻力', 'side'],
  ]) {
    console.log(`\n  关键价位 · ${title}`);
    rep.groups[k].forEach(line);
  }
  console.log('\n' + lvText(rep));
  save(`levels-${label}-${tf}`, { label, opts, rep, touches: study.touches });
}

async function events() {
  const sym = arg('yahoo', 'GC=F'),
    bars = await proxyGet(`/api/candles?src=yahoo&symbol=${encodeURIComponent(sym)}&interval=1h&count=8000`),
    cal = await proxyGet('/api/events/calendar'),
    rows = plain(
      evStudy(
        bars,
        cal.events.filter(e => e.ccy == 'USD')
      )
    ),
    rep = plain(evReport(rows)),
    dp = bars[bars.length - 1].close >= 100 ? 2 : 4;
  console.log(
    `事件研究 · ${sym} · 1 小时K线 ${day(bars[0].timestamp)} → ${day(bars[bars.length - 1].timestamp)}（${bars.length} 根）· 算得出的公布 ${rows.length} 次\n`
  );
  console.log(
    `  ${pad('', 16)}${pad('次数', 6, 1)}${pad('波幅中位数', 12, 1)}${pad('是平常的', 10, 1)}${pad('最小', 7, 1)}${pad('最大', 7, 1)}${pad('当天是平常的', 14, 1)}${pad('涨 / 跌', 9, 1)}`
  );
  for (const r of rep)
    console.log(
      `  ${pad(r.name, 16)}${pad(r.n, 6, 1)}${pad(r.range.toFixed(dp), 12, 1)}${pad(r.ratio.toFixed(1) + ' 倍', 10, 1)}${pad(r.min.toFixed(1), 7, 1)}${pad(r.max.toFixed(1), 7, 1)}${pad(r.dayRatio == null ? '—' : r.dayRatio.toFixed(1) + ' 倍', 14, 1)}${pad(`${r.up} / ${r.down}`, 9, 1)}${r.thin ? '  次数少' : ''}`
    );
  console.log('');
  for (const r of rep) console.log(evText(r, dp));
  console.log('\n逐次：');
  for (const r of rows)
    console.log(
      `  ${new Date(r.ts).toISOString().slice(0, 16)}  ${pad(r.rel, 7)} 波幅 ${pad(r.range.toFixed(dp), 8, 1)}  平常 ${pad(r.base.toFixed(dp), 7, 1)}  ${pad(r.ratio.toFixed(1), 5, 1)} 倍  之后 ${r.move >= 0 ? '+' : ''}${r.move.toFixed(dp)}`
    );
  save(`events-${sym.replace(/[^\w]/g, '')}`, { sym, rep, rows });
}

(async () => {
  const cmd = process.argv[2];
  if (cmd == 'levels') await levels();
  else if (cmd == 'events') await events();
  else {
    console.log(
      '用法：npm run study -- levels --data gc [--tf 1d] | levels --yahoo GC=F --tf 1h | events [--yahoo GC=F]'
    );
    process.exitCode = 1;
  }
})().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
