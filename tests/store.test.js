// 本地K线存储：合并去重、最新覆盖旧值、写盘后可重新读出、列出覆盖范围
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../server/store');

const b = (t, c) => ({ timestamp: t, open: c, high: c + 1, low: c - 1, close: c, volume: 0 });

test('merge：按时间合并、去重，同一时间点以新数据为准，并能从磁盘重新读出', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-store-'));
  try {
    const s1 = createStore(dir);
    s1.merge(18, '1h', [b(1, 10), b(2, 11), b(3, 12)]);
    const merged = s1.merge(18, '1h', [b(3, 99), b(4, 13)]); // 第 3 根被修订
    assert.deepEqual(
      merged.map(x => [x.timestamp, x.close]),
      [
        [1, 10],
        [2, 11],
        [3, 99],
        [4, 13],
      ]
    );
    const s2 = createStore(dir); // 新实例只能从磁盘读
    assert.equal(s2.load(18, '1h').length, 4);
    assert.deepEqual(s2.list(), [{ instrumentId: 18, interval: '1h', count: 4, from: 1, to: 4 }]);
    assert.equal(fs.existsSync(path.join(dir, '18', '1h.json.tmp')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('list：目录不存在时返回空', () => {
  assert.deepEqual(createStore(path.join(os.tmpdir(), 'ml-none-' + Date.now())).list(), []);
});
