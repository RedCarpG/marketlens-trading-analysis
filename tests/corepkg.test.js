// marketlens-core 这个包（core/）：打出来的两份（import 用、require 用）和页面、代理用的源码算出的结果一致，
// 对外的名字和清单、类型文件、package.json 对得上。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadCore } = require('../core/load');
const { build } = require('../core/build');
const { FILES, API, VERSION, SRC, DATA_SRC, DATA_FILES, DATA_API } = require('../core/files');

const ROOT = path.join(__dirname, '..');
const plain = v => JSON.parse(JSON.stringify(v));
/* 打到临时目录里：不依赖、也不改动 core/dist */
async function built() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlcore-'));
  build(dir);
  /* .mjs 在临时目录里没有 package.json 也按 ESM 加载 */
  return { dir, cjs: require(path.join(dir, 'index.cjs')), mjs: await import(pathToFileURL(path.join(dir, 'index.mjs')).href) };
}

test('打出来的包：两份都能加载，导出的名字就是清单里那些，带版本号', async () => {
  const { dir, cjs, mjs } = await built();
  try {
    const want = [...API, 'VERSION'].sort();
    assert.deepEqual(Object.keys(cjs).sort(), want);
    assert.deepEqual(Object.keys(mjs).sort(), want);
    assert.equal(cjs.VERSION, VERSION);
    assert.equal(mjs.VERSION, require('../core/package.json').version);
    for (const k of API) assert.notEqual(cjs[k], undefined, k);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('打出来的包和源码（vm 加载）算出的结果一样：分析、摘要、预警、分析包', async () => {
  const { dir, cjs, mjs } = await built();
  try {
    /* 模拟数据截止到现在；三边都用真实时间，最后一根是否收盘的判断一致 */
    const get = loadCore(),
      src = Object.fromEntries(API.map(k => [k, get(k)]));
    for (const it of [
      { sym: 'GC', base: 2650, p: 2, name: '黄金 GC' },
      { sym: 'EURUSD', base: 1.08, p: 5, name: '欧元/美元' },
    ]) {
      const all = plain(get('demoAll')(it));
      for (const tf of ['15m', '4h', '1d', '1w']) {
        const run = c => {
          const a = c.analyzeCandles(tf, all),
            st = { arm: {}, sc: null };
          c.alCheck(a.m, tf, a.px, st, { dp: it.p });
          const near = a.m.L.filter(l => c.isKey(l, tf))[0],
            hits = near ? c.alCheck(a.m, tf, near.p + a.m.t.a.a * 2, st, { dp: it.p }) : [];
          return plain({
            m: a.m,
            say: c.describeState({ ...a, name: it.name, dp: it.p }),
            arm: st,
            hits,
            text: near ? c.alText({ type: 'lv', l: near }, { sym: it.sym, name: it.name, T: tf, px: a.px, dp: it.p }) : null,
            pack: c.buildPack({
              item: { sym: it.sym, name: it.name, p: it.p, source: '模拟数据' },
              tf,
              all,
              C: a.C,
              m: a.m,
              now: 1795000000000, // 固定：generatedAt 不随时间变
              events: null,
              news: null,
              trades: null,
            }),
          });
        };
        const want = run(src);
        assert.ok(want.m && want.say.text, `${it.sym} ${tf} 应该有分析`);
        assert.deepEqual(run(cjs), want, `require 用的那份 ${it.sym} ${tf}`);
        assert.deepEqual(run(mjs), want, `import 用的那份 ${it.sym} ${tf}`);
      }
    }
    assert.equal(cjs.packPrompt({ a: 1 }), src.packPrompt({ a: 1 }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('清单、类型文件、页面、发布内容对得上', () => {
  /* 清单里的文件都在；web/js/core/ 里没有清单外的脚本 */
  const onDisk = fs
    .readdirSync(SRC)
    .filter(f => f.endsWith('.js'))
    .map(f => f.slice(0, -3))
    .sort();
  assert.deepEqual([...FILES].sort(), onDisk);
  /* 页面加载的 core 脚本都在清单里 */
  const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8'),
    page = [...html.matchAll(/src="js\/core\/([\w-]+)\.js"/g)].map(m => m[1]);
  assert.ok(page.length >= 10);
  for (const f of page) assert.ok(FILES.includes(f), `页面加载了清单外的 core/${f}.js`);
  /* 对外的每个名字在类型文件里都有声明 */
  const dts = fs.readFileSync(path.join(ROOT, 'core', 'index.d.ts'), 'utf8');
  for (const k of [...API, 'VERSION'])
    assert.match(dts, new RegExp(`export (declare )?(function|const) ${k}\\b`), `index.d.ts 里没有 ${k}`);
  /* 发布的只有打出来的文件、类型和说明；入口指向存在的文件名 */
  const pkg = require('../core/package.json');
  assert.deepEqual(pkg.files, ['dist', 'index.d.ts', 'data.d.ts', 'README.md']);
  assert.deepEqual(pkg.exports['.'], { types: './index.d.ts', import: './dist/index.mjs', require: './dist/index.cjs' });
  assert.deepEqual(pkg.exports['./data'], { types: './data.d.ts', default: './dist/data/index.cjs' });
  assert.ok(fs.existsSync(path.join(ROOT, 'core', 'README.md')));
  /* 取数入口对外的每个名字在 data.d.ts 里都有声明 */
  const ddts = fs.readFileSync(path.join(ROOT, 'core', 'data.d.ts'), 'utf8');
  for (const k of [...Object.values(DATA_API).flat(), 'VERSION'])
    assert.match(ddts, new RegExp(`export (declare )?(function|const) ${k}\\b`), `data.d.ts 里没有 ${k}`);
});

test('取数入口（marketlens-core/data）：打出来能用，import 也认得出名字；请求函数换成假的，不访问网络', async () => {
  const { dir } = await built();
  try {
    const data = require(path.join(dir, 'data', 'index.cjs')),
      viaImport = await import(pathToFileURL(path.join(dir, 'data', 'index.cjs')).href),
      names = [...Object.values(DATA_API).flat(), 'VERSION'].sort();
    assert.deepEqual(Object.keys(data).sort(), names);
    for (const k of names) assert.notEqual(viaImport[k], undefined, `import 认不出 ${k}`);
    assert.equal(data.VERSION, VERSION);
    /* Yahoo：照它的图表接口回两根日线 */
    const asked = [],
      day = Date.UTC(2026, 9, 1) / 1000,
      yahoo = data.createYahoo({
        fetchImpl: async url => {
          asked.push(String(url));
          return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 102, regularMarketTime: day }, timestamp: [day, day + 86400], indicators: { quote: [{ open: [100, 101], high: [103, 104], low: [99, 100], close: [101, 102], volume: [5, 6] }] } }] } }));
        },
      }),
      bars = await yahoo.candles('GC=F', '1d', 500);
    assert.deepEqual(bars.map(b => b.close), [101, 102]);
    assert.match(asked[0], /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\/GC%3DF\?interval=1d&period1=/);
    assert.deepEqual(await yahoo.quote('GC=F'), { price: 102, time: day * 1000 });
    /* 日历：所有来源都取不到时不抛错，内置的 FOMC 日程还在，来源状态里写着没取到；提示走 warn，不直接写控制台 */
    const warned = [],
      events = data.createEvents({ dir: path.join(dir, 'ev'), fetchImpl: async () => { throw new Error('离线'); }, warn: m => warned.push(m) }),
      cal = await events.calendar();
    assert.ok(cal.events.some(e => e.src == 'fed' && e.rel == 'fomc'));
    assert.deepEqual(cal.sources.filter(s => !s.ok).map(s => s.name).sort(), ['BLS 发布日程', 'BLS 官方数据', 'Forex Factory 本周日历']);
    assert.ok(warned.length >= 2 && warned.every(m => /离线/.test(m)));
    assert.deepEqual((await events.news('gold', 'zh')).items, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('取数的模块只用 Node 自带的 fs / path（打进包里不带别的依赖）', () => {
  const { dataFiles } = require('../core/build');
  const files = dataFiles();
  assert.deepEqual(Object.keys(files).sort(), ['data/events.cjs', 'data/index.cjs', 'data/yahoo.cjs']);
  for (const f of DATA_FILES) assert.ok(fs.existsSync(path.join(DATA_SRC, f + '.js')));
});

test('正式代码不引用 tests/ 目录', () => {
  for (const dir of ['server', 'tools', 'core'])
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith('.js')))
      assert.doesNotMatch(fs.readFileSync(path.join(ROOT, dir, f), 'utf8'), /require\(['"]\.\.\/tests\//, `${dir}/${f}`);
});
