// 回测命令行：读本地K线存储（var/candles/<instrumentId>/<周期>.json），用页面同一套规则逐根回放（web/js/core/backtest.js），
// 打印汇总表，并把完整结果写到 var/backtest/（本地，不入 Git）。设计见 docs/BACKTEST.md。
// 用法：npm run backtest -- [--id 18] [--tf 1d] [--cost gold|btc] [--spread 0] [--fee 0] [--hold 50] [--warm 150] [--from 2010-01-01] [--to 2016-12-31]
//       npm run backtest -- --data gc        用 tools/import-history.js 导入的长周期历史（var/history/<名称>/）
//       npm run backtest -- --demo GC        用模拟数据跑（检查流程用，模拟行情有趋势成分，不是纯随机）
// --from/--to 只限定入场时间段（之前的K线仍用于预热和大周期判断，之后的K线仍用于结算已开的仓位）
//       --cost 按预设计入成本（见 COSTS）；--sc loose=0,htf=1,cool=10 换情景触发规则（见 web/js/core/scenarios.js）
const fs = require('fs');
const path = require('path');
const { loadCore } = require('../tests/load-core'); // 与测试共用：在 vm 里按浏览器顺序加载 core/
const { toMonths } = require('../server/etoro'); // 月线与代理同一算法：近期由日线聚合，更早的由周线归月

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i < 0 ? d : process.argv[i + 1];
};
const get = loadCore();
const [btRun, btReport, demoAll] = ['btRun', 'btReport', 'demoAll'].map(get);

/* 成本预设（往返点差/手续费占入场价 %，隔夜费年化 %）。都是估计值，按自己的账户调整：
   gold：eToro GOLD 实测 Ask−Bid 约 0.2–0.3 美元（金价 4000 时约 0.007%），取 0.01%；隔夜费按年化 5% 估（多空都收）
   btc：Binance 现货吃单手续费 0.1%×2，不计隔夜（现货不能做空，做空一侧只作对照） */
const COSTS = { none: {}, gold: { spreadPct: 0.01, carry: 5 }, btc: { spreadPct: 0.2, carry: 0 } };
/* --sc 文本 → 情景选项，如 "loose=0,htf=1,cool=10" */
const parseSc = t =>
  t
    ? Object.fromEntries(
        t
          .split(',')
          .map(kv => kv.split('='))
          .map(([k, v]) => [k.trim(), +v])
      )
    : null;

/* ===== 数据 ===== */
function loadDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`没有 ${path.relative(ROOT, dir)}`);
  const all = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const tf = f.replace(/\.json$/, ''),
      j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    all[tf] = j.bars.map(([timestamp, open, high, low, close, volume]) => ({
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
function pickId() {
  const base = path.join(ROOT, 'var', 'candles');
  const ids = fs.existsSync(base) ? fs.readdirSync(base) : [];
  if (!ids.length) throw new Error('本地没有K线存储（var/candles 为空）：先运行代理并打开页面积累数据，或用 --demo');
  if (ids.length > 1 && !arg('id')) console.log(`本地有多个品种 ${ids.join(', ')}，用 --id 指定；先用 ${ids[0]}`);
  return arg('id', ids[0]);
}

/* ===== 输出格式：中文按两个字符宽对齐 ===== */
const wid = s => [...String(s)].reduce((w, c) => w + (/[⺀-￿]/.test(c) ? 2 : 1), 0);
const pad = (s, w, r) => {
  s = String(s ?? '');
  const p = ' '.repeat(Math.max(0, w - wid(s)));
  return r ? p + s : s + p;
};
function table(head, rows, right = []) {
  const ws = head.map((h, i) => Math.max(wid(h), ...rows.map(r => wid(r[i] ?? ''))));
  const line = r => r.map((c, i) => pad(c, ws[i], right.includes(i))).join('  ');
  console.log(line(head));
  console.log(ws.map(w => '-'.repeat(w)).join('  '));
  rows.forEach(r => console.log(line(r)));
  console.log();
}
const f2 = v => (v == null || Number.isNaN(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2));
const pct = w => (w ? `${Math.round(w.p * 100)}% [${Math.round(w.lo * 100)}–${Math.round(w.hi * 100)}]` : '—');
const mean = g => (g && g.n ? f2(g.mean) + (g.thin ? '*' : '') : '—');
const day = ts => (ts == null ? '—' : new Date(ts).toISOString().slice(0, 10));

/* ===== 主流程 ===== */
function main() {
  const demo = arg('demo'),
    data = arg('data'),
    id = demo || data ? null : pickId();
  const all = demo
    ? demoAll({ sym: demo, base: 2650 })
    : loadDir(data ? path.join(ROOT, 'var', 'history', data) : path.join(ROOT, 'var', 'candles', String(id)));
  const label = demo ? `模拟 ${demo}` : data ? `历史 ${data}` : `instrument ${id}`;
  const date = s => (s ? Date.parse(s + 'T00:00:00Z') : undefined);
  const cost = COSTS[arg('cost', 'none')];
  if (!cost) throw new Error(`--cost 只能是 ${Object.keys(COSTS).join(' / ')}`);
  const sc = parseSc(arg('sc'));
  const opts = {
    tf: arg('tf', '1d'),
    spread: +arg('spread', 0),
    fee: +arg('fee', 0),
    ...cost,
    sc: sc && { ...get('SC_DEF'), ...sc },
    maxHold: +arg('hold', 50),
    warm: +arg('warm', 150),
    from: date(arg('from')),
    to: date(arg('to')),
  };
  if (!all[opts.tf]) throw new Error(`没有 ${opts.tf} 的K线`);
  const t0 = Date.now();
  const run = btRun(all, opts);
  const rep = btReport(all, run);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n回测 · ${label} · ${rep.tf} · ${day(rep.from)} → ${day(rep.to)}（${rep.steps} 根，用时 ${sec} 秒）`);
  console.log(
    `样本外自 ${day(rep.cut)}；同期涨跌 ${f2(rep.hold)}%；成本 ${arg('cost', 'none')}（点差 ${opts.spread}、隔夜费 ${opts.fee}/天、往返 ${opts.spreadPct || 0}%、隔夜年化 ${opts.carry || 0}%），最长持仓 ${opts.maxHold} 根`
  );
  if (opts.sc) console.log(`情景规则：${JSON.stringify(opts.sc)}`);
  console.log('单位：信号与评分为 ATR（14），情景为 R（以初始止损为 1）；* = 样本不足 30；[ ] 为 95% 区间\n');

  console.log('一、信号（按信号方向计；基准 = 同期每一根都按同方向持有；净优势 = 信号均值 − 基准）');
  const base5 = rep.base[5].all.up.mean;
  table(
    [
      '信号',
      '方向',
      '次数',
      '5根命中率',
      '5根均值',
      '净优势',
      '10根均值',
      '样本内5根',
      '样本外5根',
      '顺大周期',
      '逆大周期',
      'MFE/MAE(10)',
    ],
    rep.sig
      .sort((a, b) => b.n - a.n)
      .map(r => [
        r.t,
        r.dir > 0 ? '多' : '空',
        r.n,
        pct(r.h[5].all.hit),
        mean(r.h[5].all),
        r.h[5].all.n ? f2(r.h[5].all.mean - base5 * r.dir) : '—',
        mean(r.h[10].all),
        mean(r.h[5].is),
        mean(r.h[5].oos),
        mean(r.with),
        mean(r.against),
        `${f2(r.mfe)} / ${f2(r.mae)}`,
      ]),
    [2, 4, 5, 6, 7, 8, 9, 10]
  );
  console.log(`基准：每根都做多持有 5 根平均 ${f2(base5)} ATR，10 根 ${f2(rep.base[10].all.up.mean)} ATR\n`);

  console.log('二、入场时机评分（正 = 之后上涨）');
  table(
    ['分数段', '根数', '5根后', '上涨比例(5)', '10根后', '上涨比例(10)'],
    rep.score.buckets.map(b => [
      `${b.lo}–${b.hi}`,
      b.n,
      mean(b.h[5]),
      pct(b.h[5].hit),
      mean(b.h[10]),
      pct(b.h[10].hit),
    ]),
    [1, 2, 4]
  );
  for (const h of [5, 10]) {
    const r = rep.score.rho[h];
    console.log(
      `秩相关（评分 vs ${h} 根后涨跌）：全样本 ${f2(r.all.s)}，样本内 ${f2(r.is.s)}，样本外 ${f2(r.oos.s)}；不含大周期加减分 ${f2(r.all.raw)}`
    );
  }
  const st = rep.score.state[10];
  console.log(
    `状态（10 根后，按方向）：偏多 ${st.long.n} 根 均值 ${mean(st.long)} 命中 ${pct(st.long.hit)}；偏空 ${st.short.n} 根 均值 ${mean(st.short)} 命中 ${pct(st.short.hit)}；观望 ${st.flat} 根\n`
  );

  console.log('三、价格行为情景（按页面的入场/止损/目标模拟成交）');
  const trow = (name, g) => [
    name,
    g.n,
    pct(g.hit),
    g.n ? `${f2(g.mean)}${g.thin ? '*' : ''} [${f2(g.lo)}, ${f2(g.hi)}]` : '—',
    g.pf == null ? '—' : g.pf.toFixed(2),
    f2(g.total),
    g.dd == null ? '—' : g.dd.toFixed(1),
    g.bars == null ? '—' : g.bars.toFixed(1),
    `${g.target}/${g.stop}/${g.timeout}`,
  ];
  const head = ['分组', '笔数', '胜率', '平均R', '盈亏比', '累计R', '最大回撤R', '平均持仓', '目标/止损/超时'];
  table(
    head,
    [trow('全部', rep.sce.all.all), trow('样本内', rep.sce.all.is), trow('样本外', rep.sce.all.oos)],
    [1, 4, 5, 6, 7]
  );
  table(
    head,
    rep.sce.kind.map(g => trow(g.name, g)),
    [1, 4, 5, 6, 7]
  );
  table(
    head,
    rep.sce.align.map(g => trow(g.name, g)),
    [1, 4, 5, 6, 7]
  );
  table(
    head,
    rep.sce.dirAlign.map(g => trow(g.name, g)),
    [1, 4, 5, 6, 7]
  );
  table(
    head,
    rep.sce.rr.map(g => trow(g.name, g)),
    [1, 4, 5, 6, 7]
  );
  const open = rep.sce.all.all.open;
  if (open) console.log(`另有 ${open} 笔到数据末尾仍未结束，未计入。\n`);

  const out = path.join(ROOT, 'var', 'backtest');
  fs.mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const span = opts.from || opts.to ? `-${day(rep.from).slice(0, 4)}_${day(rep.to).slice(0, 4)}` : '';
  const file = path.join(out, `${demo ? 'demo-' + demo : data ? data : 'id' + id}-${rep.tf}${span}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(rep, null, 1));
  console.log(`完整结果：${path.relative(ROOT, file)}`);
}

if (require.main === module) main();
module.exports = { loadDir, COSTS, parseSc };
