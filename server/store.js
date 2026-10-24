'use strict';
/* 本地K线存储：eToro 只给最近 1000 根且不能往前翻页，所以每次拉到的K线都按时间合并进本地文件，历史随使用时间增长。
   文件：<dir>/<instrumentId>/<interval>.json，内容 { instrumentId, interval, updatedAt, bars: [[ts,o,h,l,c,v], ...] }（时间升序）。
   同一时间点以最新拉到的为准（最后一根可能还在形成、数据也可能被修订）。写入先写临时文件再改名，避免中途断电留下半个文件。
   放在 var/ 下（不入 Git），行情原件只留本机。 */
const fs = require('fs');
const path = require('path');

function createStore(dir) {
  const mem = new Map();
  const file = (id, tf) => path.join(dir, String(id), tf + '.json');

  function load(id, tf) {
    const k = id + '|' + tf;
    if (mem.has(k)) return mem.get(k);
    let bars = [];
    try {
      const j = JSON.parse(fs.readFileSync(file(id, tf), 'utf8'));
      bars = j.bars.map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }));
    } catch {
      /* 还没有存过，或文件损坏：当作空的，下一次合并会重写 */
    }
    mem.set(k, bars);
    return bars;
  }

  function save(id, tf, bars) {
    const f = file(id, tf), tmp = f + '.tmp';
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const body = { instrumentId: id, interval: tf, updatedAt: new Date().toISOString(), bars: bars.map(b => [b.timestamp, b.open, b.high, b.low, b.close, b.volume]) };
    fs.writeFileSync(tmp, JSON.stringify(body));
    fs.renameSync(tmp, f);
  }

  /* 把新拉到的K线并入已存的，返回合并后的完整序列（升序） */
  function merge(id, tf, fresh) {
    const m = new Map(load(id, tf).map(b => [b.timestamp, b]));
    for (const b of fresh) m.set(b.timestamp, b);
    const bars = [...m.values()].sort((a, b) => a.timestamp - b.timestamp);
    mem.set(id + '|' + tf, bars);
    save(id, tf, bars);
    return bars;
  }

  /* 已存的品种和周期及其覆盖范围，供页面显示和后台定时补拉 */
  function list() {
    const out = [];
    let ids = [];
    try { ids = fs.readdirSync(dir); } catch { return out; }
    for (const id of ids) {
      let fs2 = [];
      try { fs2 = fs.readdirSync(path.join(dir, id)).filter(f => f.endsWith('.json')); } catch { continue; }
      for (const f of fs2) {
        const tf = f.slice(0, -5), bars = load(isNaN(+id) ? id : +id, tf);
        if (bars.length) out.push({ instrumentId: isNaN(+id) ? id : +id, interval: tf, count: bars.length, from: bars[0].timestamp, to: bars[bars.length - 1].timestamp });
      }
    }
    return out;
  }

  return { load, merge, list };
}

module.exports = { createStore };
