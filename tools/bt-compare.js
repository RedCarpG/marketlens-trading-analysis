// 情景触发规则对比：同一份数据按几组规则各回放一次，计入成本，打印对比表；完整结果写到 var/backtest/（本地，不入 Git）。
// 用法：npm run bt:compare -- [--sets gc,btc,etoro] [--id 18] [--hold 50]
//   gc / btc：tools/import-history.js 导入的长周期历史；etoro：本地K线存储（--id 指定品种，默认第一个）
// 各组合在独立线程里并行跑（单组 1d 全量约 5–40 秒）。规则含义见 web/js/core/scenarios.js，结论见 docs/BACKTEST.md 第 14 节。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
/* 事先定好的几组规则（不在结果出来后再加组，避免挑出碰巧好看的组合） */
const VARIANTS = [
  { k: 'V0', name: '当前规则', sc: { loose: 1, htf: 0, cool: 0 } },
  { k: 'V1', name: '去宽松形态', sc: { loose: 0, htf: 0, cool: 0 } },
  { k: 'V2', name: 'V1+大周期价位', sc: { loose: 0, htf: 1, cool: 0 } },
  { k: 'V3', name: 'V1+冷却10', sc: { loose: 0, htf: 0, cool: 10 } },
  { k: 'V4', name: '全部收紧', sc: { loose: 0, htf: 1, cool: 10 } },
];

/* 一组：回放一次，按无成本与有成本各统计一次情景 */
function job({ dir, cost, sc, hold }) {
  const { loadCore } = require('../tests/load-core');
  const { loadDir, COSTS } = require('./backtest');
  const get = loadCore(),
    [btRun, btReport, mstat] = ['btRun', 'btReport', 'mstat'].map(get);
  const all = loadDir(dir),
    run = btRun(all, { tf: '1d', maxHold: hold, sc: { ...get('SC_DEF'), ...sc } });
  const gross = btReport(all, run).sce.all.all,
    rep = btReport(all, { ...run, opts: { ...run.opts, ...COSTS[cost] } }),
    list = rep.sce.list.filter(t => t.R != null),
    byDir = d => mstat(list.filter(t => t.dir === d).map(t => t.R));
  const a = rep.sce.all;
  return {
    from: rep.from,
    to: rep.to,
    steps: rep.steps,
    days: rep.sceDays,
    gross: gross.mean,
    net: a.all,
    is: a.is.mean,
    oos: a.oos.mean,
    long: byDir(1),
    short: byDir(-1),
    kind: rep.sce.kind.map(g => ({ name: g.name, n: g.n, mean: g.mean })),
  };
}

if (!isMainThread) parentPort.postMessage(job(workerData));
else main();

function main() {
  const arg = (k, d) => {
    const i = process.argv.indexOf('--' + k);
    return i < 0 ? d : process.argv[i + 1];
  };
  const etoroId = () => {
    const base = path.join(ROOT, 'var', 'candles'),
      ids = fs.existsSync(base) ? fs.readdirSync(base) : [];
    return arg('id', ids[0]);
  };
  const SETS = {
    gc: () => ({ label: 'GC=F 黄金期货', dir: path.join(ROOT, 'var', 'history', 'gc'), cost: 'gold' }),
    btc: () => ({ label: 'BTCUSDT', dir: path.join(ROOT, 'var', 'history', 'btc'), cost: 'btc' }),
    etoro: () => ({
      label: `eToro ${etoroId()}`,
      dir: path.join(ROOT, 'var', 'candles', String(etoroId())),
      cost: 'gold',
    }),
  };
  const sets = arg('sets', 'gc,btc,etoro')
    .split(',')
    .filter(s => {
      if (!SETS[s]) throw new Error(`未知数据集 ${s}（可选 ${Object.keys(SETS).join(', ')}）`);
      const ok = fs.existsSync(SETS[s]().dir);
      if (!ok) console.log(`跳过 ${s}：没有 ${path.relative(ROOT, SETS[s]().dir)}（先用 npm run import 导入）`);
      return ok;
    });
  const hold = +arg('hold', 50),
    jobs = sets.flatMap(s => VARIANTS.map(v => ({ s, v, data: { ...SETS[s](), sc: v.sc, hold } })));
  const t0 = Date.now(),
    out = new Array(jobs.length);
  let next = 0,
    done = 0;
  console.log(`共 ${jobs.length} 组，并行 ${Math.min(jobs.length, Math.max(1, os.cpus().length - 1))} 个线程…`);
  const runOne = () => {
    if (next >= jobs.length) return Promise.resolve();
    const i = next++;
    return new Promise((ok, bad) => {
      const w = new Worker(__filename, { workerData: jobs[i].data });
      w.once('message', r => {
        out[i] = r;
        process.stdout.write(`\r已完成 ${++done}/${jobs.length}`);
        ok();
      });
      w.once('error', bad);
    }).then(runOne);
  };
  Promise.all(Array.from({ length: Math.min(jobs.length, Math.max(1, os.cpus().length - 1)) }, runOne))
    .then(() => report(sets, jobs, out, SETS, t0))
    .catch(e => {
      console.error('\n' + (e.stack || e.message));
      process.exit(1);
    });
}

function report(sets, jobs, out, SETS, t0) {
  const wid = s => [...String(s)].reduce((w, c) => w + (/[⺀-￿]/.test(c) ? 2 : 1), 0),
    pad = (s, w, r) => {
      s = String(s ?? '');
      const p = ' '.repeat(Math.max(0, w - wid(s)));
      return r ? p + s : s + p;
    },
    f2 = v => (v == null || Number.isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2)),
    day = ts => new Date(ts).toISOString().slice(0, 10);
  const head = [
    '规则',
    '笔数',
    '每年',
    '触发天数',
    '胜率',
    '毛R',
    '净R [95%]',
    '样本内净R',
    '样本外净R',
    '做多净R',
    '做空净R',
    '盈亏比',
    '最大回撤R',
  ];
  console.log(`\n\n情景触发规则对比（1d，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）；净 = 计入成本；单位 R`);
  for (const s of sets) {
    const rows = jobs.map((j, i) => [j, out[i]]).filter(([j]) => j.s === s),
      r0 = rows[0][1],
      yrs = (r0.to - r0.from) / 864e5 / 365.25,
      cfg = SETS[s]();
    console.log(`\n${cfg.label} · ${day(r0.from)} → ${day(r0.to)}（${r0.steps} 根）· 成本 ${cfg.cost}`);
    const body = rows.map(([j, r]) => [
      `${j.v.k} ${j.v.name}`,
      r.net.n,
      (r.net.n / yrs).toFixed(0),
      `${Math.round((r.days / r.steps) * 100)}%`,
      r.net.hit ? `${Math.round(r.net.hit.p * 100)}%` : '—',
      f2(r.gross),
      r.net.n ? `${f2(r.net.mean)} [${f2(r.net.lo)}, ${f2(r.net.hi)}]` : '—',
      f2(r.is),
      f2(r.oos),
      `${f2(r.long.mean)} (${r.long.n})`,
      `${f2(r.short.mean)} (${r.short.n})`,
      r.net.pf == null ? '—' : r.net.pf.toFixed(2),
      r.net.dd == null ? '—' : r.net.dd.toFixed(1),
    ]);
    const ws = head.map((h, i) => Math.max(wid(h), ...body.map(b => wid(b[i]))));
    const line = b => b.map((c, i) => pad(c, ws[i], i > 0)).join('  ');
    console.log(line(head));
    console.log(ws.map(w => '-'.repeat(w)).join('  '));
    body.forEach(b => console.log(line(b)));
  }
  const dir = path.join(ROOT, 'var', 'backtest');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `compare-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      jobs.map((j, i) => ({ set: j.s, variant: j.v, ...out[i] })),
      null,
      1
    )
  );
  console.log(`\n完整结果：${path.relative(ROOT, file)}`);
}
