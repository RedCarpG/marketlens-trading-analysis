// server/journal.js：交易日记与我的守则存在本机；代理的 /api/journal
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { createJournal, cleanNote, LIMIT } = require('../server/journal');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ml-journal-'));

test('cleanNote：理由截到 500 字、标签去重截短最多 8 个、心情只认预设的；什么都没写是 null', () => {
  assert.deepEqual(cleanNote({ why: '  追高了\r\n没等回调 ', tags: ['追单', '追单', ' 新闻 驱动 ', '', 'x'.repeat(30)], mood: 'rushed' }), {
    why: '追高了\n没等回调',
    tags: ['追单', '新闻 驱动', 'x'.repeat(12)],
    mood: 'rushed',
  });
  assert.equal(cleanNote({ why: '多'.repeat(900) }).why.length, LIMIT.why);
  assert.equal(cleanNote({ tags: Array.from({ length: 20 }, (_, i) => 't' + i) }).tags.length, LIMIT.tags);
  assert.equal(cleanNote({ why: 'a', mood: '<script>' }).mood, '');
  assert.deepEqual([cleanNote({}), cleanNote(null), cleanNote({ why: '  ', tags: [], mood: 'x' })], [null, null, null]);
});

test('createJournal：守则整理后存下；日记按“品种|交易号”存、能删；重新打开还在；key 不对不存', () => {
  const dir = tmp(),
    file = path.join(dir, 'sub', 'journal.json');
  let t = 1000;
  const j = createJournal(file, { now: () => t++ });
  assert.deepEqual(j.get().notes, {});
  assert.equal(j.get().rules.on.range, 0);
  const rules = j.setRules({ on: { range: 1, hack: 1 }, n: { wide: 99 }, custom: ['不在睡前开仓'] });
  assert.deepEqual([rules.on.range, rules.on.hack, rules.n.wide, rules.custom], [1, undefined, 10, ['不在睡前开仓']]);
  assert.deepEqual(j.setNote('GOLD|123', { why: '计划内', tags: ['计划内'], mood: 'calm' }), { why: '计划内', tags: ['计划内'], mood: 'calm', at: 1000 });
  assert.equal(j.setNote('GC=F|sim-open', { why: 'x' }).at, 1001);
  for (const bad of ['GOLD', 'GOLD|', '../x|1', 'a b|1', 5, null]) assert.equal(j.setNote(bad, { why: 'x' }), undefined);
  assert.equal(j.setNote('GC=F|sim-open', { why: '' }), null);
  const again = createJournal(file).get();
  assert.deepEqual(Object.keys(again.notes), ['GOLD|123']);
  assert.deepEqual([again.rules.on.range, again.rules.custom], [1, ['不在睡前开仓']]);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['journal.json']); // 没有留下临时文件
});

test('createJournal：文件坏了从空的开始，坏的那份改名留着', () => {
  const dir = tmp(),
    file = path.join(dir, 'journal.json'),
    warned = [];
  fs.writeFileSync(file, '{ 坏的');
  const j = createJournal(file, { now: () => 7, warn: m => warned.push(m) });
  assert.deepEqual(j.get().notes, {});
  assert.deepEqual(fs.readdirSync(dir), ['journal.json.broken-7']);
  assert.equal(warned.length, 1);
  j.setNote('GOLD|1', { why: 'x' });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['journal.json', 'journal.json.broken-7']);
});

/* ===== 代理接口 ===== */
function req(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, res => {
      let s = '';
      res.on('data', d => (s += d));
      res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(s); } catch { return null; } })() }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
function startProxy(env) {
  const port = 20000 + Math.floor(Math.random() * 20000),
    p = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('代理没起来')), 15000);
    p.stdout.on('data', d => {
      if (String(d).includes('已启动')) {
        clearTimeout(to);
        resolve({ p, port });
      }
    });
    p.on('exit', c => reject(new Error('代理退出 ' + c)));
  });
}

test('代理 /api/journal：GET 读整份；POST 只收本机页面的 JSON，存守则或一条日记', async () => {
  const dir = tmp(),
    file = path.join(dir, 'journal.json'),
    { p, port } = await startProxy({ JOURNAL_FILE: file, EVENTS_DIR: path.join(dir, 'ev'), CIRRA_ENDPOINT_FILE: path.join(dir, 'none.json'), CIRRA_WATCH: 'off' });
  const O = `http://127.0.0.1:${port}`,
    J = { 'content-type': 'application/json', origin: O },
    post = (body, headers = J) => req(port, 'POST', '/api/journal', { headers, body: JSON.stringify(body) });
  try {
    const first = await req(port, 'GET', '/api/journal');
    assert.equal(first.status, 200);
    assert.deepEqual([first.json.notes, first.json.rules.on.nostop], [{}, 0]);
    assert.equal((await post({ rules: { on: { nostop: 1 } } }, { 'content-type': 'application/json' })).status, 403); // 没有 Origin
    assert.equal((await post({ rules: { on: { nostop: 1 } } }, { ...J, origin: 'http://evil.example' })).status, 403);
    assert.equal((await post({ nothing: 1 })).status, 400);
    assert.equal((await post({ key: '../../x', note: { why: 'x' } })).status, 400);
    assert.equal((await post({ key: 'GOLD|1', note: { why: 'x'.repeat(20000) } })).status, 413);
    const r = await post({ rules: { on: { nostop: 1 }, custom: ['不在睡前开仓'] } });
    assert.deepEqual([r.status, r.json.ok, r.json.rules.on.nostop, r.json.rules.custom], [200, true, 1, ['不在睡前开仓']]);
    const n = await post({ key: 'GOLD|42', note: { why: '回调到支撑才进的', tags: ['计划内'], mood: 'calm' } });
    assert.deepEqual([n.status, n.json.note.why, n.json.note.tags], [200, '回调到支撑才进的', ['计划内']]);
    const all = (await req(port, 'GET', '/api/journal')).json;
    assert.deepEqual([Object.keys(all.notes), all.rules.on.nostop], [['GOLD|42'], 1]);
    assert.deepEqual((await post({ key: 'GOLD|42', note: null })).json, { ok: true, note: null });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).notes, {});
  } finally {
    p.kill();
  }
});
