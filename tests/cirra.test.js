// 桌宠 Cirra 播报（server/cirra.js 与代理的 /api/cirra/*）：用一个照 cirra-deskpet 事件端口规则写的假 Cirra
//（只收 POST、Host 须为本机、X-Cirra-Token、只收 JSON、emotion 只认那几种），不访问网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createCirra, KIND, clip } = require('../server/cirra');

const EMO = ['neutral', 'happy', 'sad', 'surprised', 'sleepy', 'worried'];
/* 假 Cirra：规则同 cirra-deskpet sidecar/src/events/server.ts；got 记下收到的 { body, headers } */
function fakeCirra(token) {
  const got = [],
    srv = http.createServer((req, res) => {
      const end = (code, msg = '') => res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }).end(msg);
      if (req.method !== 'POST') return end(405, '只收 POST');
      const port = srv.address().port;
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`)
        return end(403, 'Host 不对');
      if (req.headers['x-cirra-token'] !== srv.token) return end(401, 'token 不对');
      if (!(req.headers['content-type'] || '').includes('application/json')) return end(415, '只收 application/json');
      let s = '';
      req.on('data', c => (s += c));
      req.on('end', () => {
        const b = JSON.parse(s);
        if (req.url !== '/notify') return end(404, '没有这个地址');
        if (typeof b.text != 'string' || !b.text.trim()) return end(400, '缺少 text');
        if (b.emotion !== undefined && !EMO.includes(b.emotion)) return end(400, 'emotion 不对');
        got.push({ body: b, headers: req.headers });
        end(204);
      });
    });
  srv.token = token;
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, got, port: srv.address().port })));
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ml-cirra-'));
const writeEp = (file, port, token) => fs.writeFileSync(file, JSON.stringify({ port, token, pid: 1 }));

test('send：按她的协议发到 /notify（Host、token、JSON、表情），截短并压成一行', async () => {
  const d = tmp(),
    file = path.join(d, 'endpoint.json'),
    c = await fakeCirra('tok1');
  try {
    writeEp(file, c.port, 'tok1');
    const ci = createCirra({ file });
    assert.deepEqual(await ci.send({ text: '黄金 GOLD 离你的止损\n3990.00 只差 0.4 个 ATR', emotion: 'worried' }), {
      ok: true,
    });
    assert.deepEqual(c.got[0].body, { text: '黄金 GOLD 离你的止损 3990.00 只差 0.4 个 ATR', emotion: 'worried' });
    assert.equal(c.got[0].headers.host, `127.0.0.1:${c.port}`);
    assert.equal(c.got[0].body.title, undefined); // 不传 title：她的来源名已经是“外部通知 / 行情”
    await ci.send({ text: 'x'.repeat(300), emotion: 'angry' }); // 她不认得的表情改成 neutral
    assert.deepEqual([[...c.got[1].body.text].length, c.got[1].body.emotion], [200, 'neutral']);
    assert.deepEqual(await ci.send({ text: '   ' }), { ok: false, reason: '没有内容' });
    assert.equal(c.got.length, 2);
  } finally {
    c.srv.close();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('send：她没开（没有文件、端口连不上、文件内容不对）时跳过；她重启换了 token 时重读文件再试', async () => {
  const d = tmp(),
    file = path.join(d, 'endpoint.json'),
    c = await fakeCirra('old');
  try {
    const ci = createCirra({ file });
    assert.deepEqual(await ci.send({ text: '在吗' }), { ok: false, reason: 'Cirra 没开' });
    fs.writeFileSync(file, '{"port":"x"}');
    assert.deepEqual(await ci.send({ text: '在吗' }), { ok: false, reason: 'Cirra 没开' });
    const closed = await fakeCirra('t');
    const deadPort = closed.port;
    await new Promise(r => closed.srv.close(r));
    writeEp(file, deadPort, 't');
    assert.deepEqual(await ci.send({ text: '在吗' }), { ok: false, reason: 'Cirra 没开' });

    /* 文件里还是旧 token，发出去才知道她换了：401 后重读文件——这里模拟“发的同时她写了新文件” */
    writeEp(file, c.port, 'old');
    c.srv.token = 'new';
    const realRead = fs.readFileSync;
    let n = 0;
    fs.readFileSync = (f, ...a) => {
      if (f === file && ++n == 2) writeEp(file, c.port, 'new');
      return realRead(f, ...a);
    };
    try {
      assert.deepEqual(await ci.send({ text: '换了 token' }), { ok: true });
    } finally {
      fs.readFileSync = realRead;
    }
    assert.equal(c.got.at(-1).headers['x-cirra-token'], 'new');
    /* 文件里的 token 就是错的：不反复重试 */
    writeEp(file, c.port, 'wrong');
    const r = await ci.send({ text: '错的' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /token/);
  } finally {
    c.srv.close();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('send：每分钟最多 8 条，过一分钟恢复；她没开时不占名额', async () => {
  const d = tmp(),
    file = path.join(d, 'endpoint.json'),
    c = await fakeCirra('t');
  let t = 1e12;
  try {
    const ci = createCirra({ file, now: () => t });
    await ci.send({ text: '没开时' });
    writeEp(file, c.port, 't');
    for (let i = 0; i < 8; i++) assert.equal((await ci.send({ text: '第' + i })).ok, true);
    assert.deepEqual(await ci.send({ text: '第 9 条' }), { ok: false, reason: '一分钟内发得太多，这条没发' });
    t += 60e3;
    assert.equal((await ci.send({ text: '一分钟后' })).ok, true);
    assert.equal(c.got.length, 9);
  } finally {
    c.srv.close();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('status：在线（GET 回 405，不带 token、她不会说话）、没开、端口上不是她', async () => {
  const d = tmp(),
    file = path.join(d, 'endpoint.json'),
    c = await fakeCirra('t'),
    other = http.createServer((q, s) => s.end('hello'));
  await new Promise(r => other.listen(0, '127.0.0.1', r));
  try {
    const ci = createCirra({ file });
    assert.equal((await ci.status()).running, false);
    writeEp(file, c.port, 't');
    assert.deepEqual(await ci.status(), { running: true });
    assert.equal(c.got.length, 0);
    writeEp(file, other.address().port, 't');
    const s = await ci.status();
    assert.equal(s.running, false);
    assert.match(s.reason, /不像 Cirra/);
  } finally {
    c.srv.close();
    other.close();
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('KIND / clip：表情都是她认得的；截短按字符不按字节', () => {
  assert.ok(Object.values(KIND).every(e => EMO.includes(e)));
  assert.equal(KIND.dn, 'worried');
  assert.equal(KIND.up, 'happy');
  assert.equal([...clip('金'.repeat(250))].length, 200);
});

/* 起一个真的代理进程（不配密钥、不访问网络），对 /api/cirra/* 发请求 */
function startProxy(env) {
  const port = 20000 + Math.floor(Math.random() * 20000),
    p = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  return new Promise((resolve, reject) => {
    let out = '';
    p.stdout.on('data', d => {
      out += d;
      if (out.includes('已启动')) resolve({ p, port });
    });
    p.on('exit', code => reject(new Error('代理退出了 ' + code + out)));
  });
}
function req(port, method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers: { host: `127.0.0.1:${port}`, ...headers } },
      res => {
        let s = '';
        res.on('data', c => (s += c));
        res.on('end', () => resolve({ status: res.statusCode, json: s ? JSON.parse(s) : null }));
      }
    );
    r.on('error', reject);
    if (body != null) r.write(body);
    r.end();
  });
}

test('代理 /api/cirra/notify：只收本机页面的 JSON；表情按 kind 定；其他地址仍只收 GET', async () => {
  const d = tmp(),
    file = path.join(d, 'endpoint.json'),
    c = await fakeCirra('t');
  writeEp(file, c.port, 't');
  const { p, port } = await startProxy({ CIRRA_ENDPOINT_FILE: file, EVENTS_DIR: path.join(d, 'ev') });
  const O = `http://127.0.0.1:${port}`,
    J = { 'content-type': 'application/json' },
    post = (headers, body) => req(port, 'POST', '/api/cirra/notify', { headers, body });
  try {
    assert.equal((await post(J, '{"text":"a","kind":"dn"}')).status, 403); // 没有 Origin（不是页面发的）
    assert.equal((await post({ ...J, origin: 'http://evil.example' }, '{"text":"a","kind":"dn"}')).status, 403);
    assert.equal((await post({ origin: O, 'content-type': 'text/plain' }, '{"text":"a","kind":"dn"}')).status, 415);
    assert.equal((await post({ ...J, origin: O }, '{"text":"a","kind":"rm -rf"}')).status, 400);
    assert.equal((await post({ ...J, origin: O }, '{"text":"","kind":"dn"}')).status, 400);
    assert.equal((await post({ ...J, origin: O }, 'not json')).status, 400);
    assert.equal((await post({ ...J, origin: O }, JSON.stringify({ text: 'x'.repeat(5000), kind: 'dn' }))).status, 413);
    assert.equal(c.got.length, 0);
    /* 页面传来的 emotion 不用，按 kind 定 */
    const ok = await post(
      { ...J, origin: O },
      JSON.stringify({ text: '离你的止损只差 0.4 个 ATR', kind: 'dn', emotion: 'happy' })
    );
    assert.deepEqual([ok.status, ok.json], [200, { ok: true }]);
    assert.deepEqual(c.got[0].body, { text: '离你的止损只差 0.4 个 ATR', emotion: 'worried' });
    assert.deepEqual((await req(port, 'GET', '/api/cirra/status')).json, { running: true, file });
    assert.equal((await req(port, 'POST', '/api/candles', { headers: { ...J, origin: O }, body: '{}' })).status, 405);
    /* 她关了：仍回 200，ok 为假 */
    fs.rmSync(file);
    const off = await post({ ...J, origin: O }, '{"text":"在吗","kind":"test"}');
    assert.deepEqual([off.status, off.json], [200, { ok: false, reason: 'Cirra 没开' }]);
  } finally {
    p.kill();
    c.srv.close();
    fs.rmSync(d, { recursive: true, force: true });
  }
});
