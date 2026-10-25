// 规则对比：同一份数据按几组事先定好的规则各回放一次，计入成本，打印对比表；完整结果写到 var/backtest/（本地，不入 Git）。
// 用法：npm run bt:compare -- [--mode sc|exit|bias] [--sets gc,gcbear,btc,etoro] [--id 18] [--hold 50]
//   sc   情景触发规则（docs/BACKTEST.md 第 14 节）
//   exit 出场规则：情景用页面默认规则，只换止损/目标/持仓方式（第 15 节）
//   bias 大周期方向的判断方法（第 16 节）
//   gc / btc：tools/import-history.js 导入的长周期历史；gcbear：gc 的 2011-09 → 2015-12 熊市段；etoro：本地K线存储（--id 指定品种）
// 各组在独立线程里并行跑（单组 1d 全量约 5–40 秒）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..');
/* 事先定好的几组规则（不在结果出来后再加组，避免挑出碰巧好看的组合） */
const MODES = {
  sc: {
    title: '情景触发规则',
    sets: 'gc,btc,etoro',
    variants: [
      { k: 'V0', name: '收紧前规则', sc: { loose: 1, htf: 0, cool: 0 } },
      { k: 'V1', name: '去宽松形态', sc: { loose: 0, htf: 0, cool: 0 } },
      { k: 'V2', name: 'V1+大周期价位', sc: { loose: 0, htf: 1, cool: 0 } },
      { k: 'V3', name: 'V1+冷却10', sc: { loose: 0, htf: 0, cool: 10 } },
      { k: 'V4', name: '全部收紧', sc: { loose: 0, htf: 1, cool: 10 } },
    ],
  },
  exit: {
    title: '出场规则',
    sets: 'gc,btc,etoro',
    variants: [
      { k: 'E0', name: '页面规则', exit: null },
      { k: 'E1', name: '目标1R', exit: { tgtR: 1 } },
      { k: 'E2', name: '目标3R', exit: { tgtR: 3 } },
      { k: 'E3', name: '1R后保本', exit: { be: 1 } },
      { k: 'E4', name: '移动止损2ATR', exit: { tgtR: 0, trail: 2 } },
      { k: 'E5', name: '持有10根', exit: { tgtR: 0, hold: 10 } },
    ],
  },
  bias: {
    title: '大周期方向判断',
    sets: 'gc,gcbear,btc,etoro',
    variants: [
      { k: 'B0', name: '均线20/50', bias: 'ema' },
      { k: 'B1', name: '摆动结构', bias: 'struct' },
      { k: 'B2', name: '快均线10/20', bias: 'fast' },
    ],
  },
};

/* 一组：回放一次；对每种出场规则各按无成本、有成本统计一次 */
function job({ dir, cost, hold, from, to, sc, bias, exits }) {
  const { loadCore } = require('../tests/load-core');
  const { loadDir, COSTS } = require('./backtest');
  const get = loadCore(),
    [btRun, btReport, mstat] = ['btRun', 'btReport', 'mstat'].map(get);
  const all = loadDir(dir),
    run = btRun(all, { tf: '1d', maxHold: hold, from, to, sc: sc && { ...get('SC_DEF'), ...sc }, bias });
  return exits.map(exit => {
    const gross = btReport(all, { ...run, opts: { ...run.opts, exit } }).sce.all.all,
      rep = btReport(all, { ...run, opts: { ...run.opts, ...COSTS[cost], exit } }),
      list = rep.sce.list.filter(t => t.R != null),
      byDir = d => mstat(list.filter(t => t.dir === d).map(t => t.R)),
      al = k => rep.sce.align.find(g => g.k === k) || { n: 0 };
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
      with: { n: al('1').n, mean: al('1').mean },
      against: { n: al('-1').n, mean: al('-1').mean },
      trend: rep.trend,
      kind: rep.sce.kind.map(g => ({ name: g.name, n: g.n, mean: g.mean })),
    };
  });
}

if (!isMainThread) parentPort.postMessage(job(workerData));
else main();

function main() {
  const arg = (k, d) => {
    const i = process.argv.indexOf('--' + k);
    return i < 0 ? d : process.argv[i + 1];
  };
  const mode = MODES[arg('mode', 'sc')];
  if (!mode) throw new Error(`--mode 只能是 ${Object.keys(MODES).join(' / ')}`);
  const etoroId = () => {
    const base = path.join(ROOT, 'var', 'candles'),
      ids = fs.existsSync(base) ? fs.readdirSync(base) : [];
    return arg('id', ids[0]);
  };
  const hist = n => path.join(ROOT, 'var', 'history', n);
  const SETS = {
    gc: () => ({ label: 'GC=F 黄金期货', dir: hist('gc'), cost: 'gold' }),
    gcbear: () => ({
      label: 'GC=F 熊市段',
      dir: hist('gc'),
      cost: 'gold',
      from: Date.UTC(2011, 8, 1),
      to: Date.UTC(2015, 11, 31),
    }),
    btc: () => ({ label: 'BTCUSDT', dir: hist('btc'), cost: 'btc' }),
    etoro: () => ({
      label: `eToro ${etoroId()}`,
      dir: path.join(ROOT, 'var', 'candles', String(etoroId())),
      cost: 'gold',
    }),
  };
  const sets = arg('sets', mode.sets)
    .split(',')
    .filter(s => {
      if (!SETS[s]) throw new Error(`未知数据集 ${s}（可选 ${Object.keys(SETS).join(', ')}）`);
      const ok = fs.existsSync(SETS[s]().dir);
      if (!ok) console.log(`跳过 ${s}：没有 ${path.relative(ROOT, SETS[s]().dir)}（先用 npm run import 导入）`);
      return ok;
    });
  const hold = +arg('hold', 50);
  /* 出场规则不影响回放，一个数据集回放一次再分别模拟；其他模式每组规则各回放一次 */
  const jobs =
    mode === MODES.exit
      ? sets.map(s => ({ s, rows: mode.variants, data: { ...SETS[s](), hold, exits: mode.variants.map(v => v.exit) } }))
      : sets.flatMap(s =>
          mode.variants.map(v => ({
            s,
            rows: [v],
            data: { ...SETS[s](), hold, sc: v.sc, bias: v.bias, exits: [null] },
          }))
        );
  const t0 = Date.now(),
    out = new Array(jobs.length),
    nT = Math.min(jobs.length, Math.max(1, os.cpus().length - 1));
  let next = 0,
    done = 0;
  console.log(`${mode.title}：共 ${jobs.length} 组回放，并行 ${nT} 个线程…`);
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
  Promise.all(Array.from({ length: nT }, runOne))
    .then(() => report(mode, sets, jobs, out, SETS, t0, arg('mode', 'sc')))
    .catch(e => {
      console.error('\n' + (e.stack || e.message));
      process.exit(1);
    });
}

function report(mode, sets, jobs, out, SETS, t0, key) {
  const wid = s => [...String(s)].reduce((w, c) => w + (/[⺀-￿]/.test(c) ? 2 : 1), 0),
    pad = (s, w, r) => {
      s = String(s ?? '');
      const p = ' '.repeat(Math.max(0, w - wid(s)));
      return r ? p + s : s + p;
    },
    f2 = v => (v == null || Number.isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2)),
    ci = g => (g && g.n ? `${f2(g.mean)} [${f2(g.lo)}, ${f2(g.hi)}]` : '—'),
    day = ts => new Date(ts).toISOString().slice(0, 10);
  const sceHead = [
      '笔数',
      '每年',
      '胜率',
      '毛R',
      '净R [95%]',
      '样本内净R',
      '样本外净R',
      '做多净R',
      '做空净R',
      '盈亏比',
      '最大回撤R',
    ],
    sceRow = (r, yrs) => [
      r.net.n,
      (r.net.n / yrs).toFixed(0),
      r.net.hit ? `${Math.round(r.net.hit.p * 100)}%` : '—',
      f2(r.gross),
      ci(r.net),
      f2(r.is),
      f2(r.oos),
      `${f2(r.long.mean)} (${r.long.n})`,
      `${f2(r.short.mean)} (${r.short.n})`,
      r.net.pf == null ? '—' : r.net.pf.toFixed(2),
      r.net.dd == null ? '—' : r.net.dd.toFixed(1),
    ];
  const COLS = {
    sc: {
      head: ['规则', '触发天数', ...sceHead],
      row: (v, r, yrs) => [`${v.k} ${v.name}`, `${Math.round((r.days / r.steps) * 100)}%`, ...sceRow(r, yrs)],
    },
    exit: {
      head: ['出场', ...sceHead, '平均持仓', '目标/止损/移动/超时'],
      row: (v, r, yrs) => [
        `${v.k} ${v.name}`,
        ...sceRow(r, yrs),
        r.net.bars == null ? '—' : r.net.bars.toFixed(1),
        `${r.net.target}/${r.net.stop}/${r.net.trail}/${r.net.timeout}`,
      ],
    },
    bias: {
      head: ['方法', '有方向', '偏多日20根', '偏空日20根', '漂移', '方向优势 [95%]', '情景顺/逆净R', '情景净R'],
      row: (v, r) => {
        const t = r.trend;
        return [
          `${v.k} ${v.name}`,
          `${Math.round(((t.up.n + t.dn.n) / t.n) * 100)}%`,
          `${f2(t.up.mean)} (${t.up.n})`,
          `${f2(t.dn.mean)} (${t.dn.n})`,
          f2(t.drift),
          ci(t.edge),
          `${f2(r.with.mean)} (${r.with.n}) / ${f2(r.against.mean)} (${r.against.n})`,
          ci(r.net),
        ];
      },
    },
  }[key];
  const unit = key === 'bias' ? '方向收益单位 ATR（持有 20 根），情景单位 R' : '单位 R';
  console.log(`\n\n${mode.title}对比（1d，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）；净 = 计入成本；${unit}`);
  for (const s of sets) {
    const rows = jobs.flatMap((j, i) => (j.s === s ? j.rows.map((v, k) => [v, out[i][k]]) : [])),
      r0 = rows[0][1],
      yrs = (r0.to - r0.from) / 864e5 / 365.25,
      cfg = SETS[s]();
    console.log(`\n${cfg.label} · ${day(r0.from)} → ${day(r0.to)}（${r0.steps} 根）· 成本 ${cfg.cost}`);
    const body = rows.map(([v, r]) => COLS.row(v, r, yrs));
    const ws = COLS.head.map((h, i) => Math.max(wid(h), ...body.map(b => wid(b[i]))));
    const line = b => b.map((c, i) => pad(c, ws[i], i > 0)).join('  ');
    console.log(line(COLS.head));
    console.log(ws.map(w => '-'.repeat(w)).join('  '));
    body.forEach(b => console.log(line(b)));
  }
  const dir = path.join(ROOT, 'var', 'backtest');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `compare-${key}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      jobs.flatMap((j, i) => j.rows.map((v, k) => ({ set: j.s, variant: v, ...out[i][k] }))),
      null,
      1
    )
  );
  console.log(`\n完整结果：${path.relative(ROOT, file)}`);
}
