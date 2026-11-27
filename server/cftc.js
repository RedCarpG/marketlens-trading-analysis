'use strict';
/* CFTC 每周持仓报告（Commitments of Traders，分类版、只含期货）：美国商品期货交易委员会的公开数据，不需要密钥。
   每一期是周二收盘时的持仓，通常周五下午（美东）公布，节假日那周会晚。这里只取“管理基金”（Managed Money：对冲基金、CTA 这类）的多、空和总未平仓。
   取来的存在 var/cftc/<合约代码>.json（CFTC_DIR 可改位置）；每 6 小时最多取一次，失败时用已存的并带上原因，10 分钟后再试。
   只访问下面这一个地址；合约代码只收 6 位的数字 / 大写字母（黄金期货是 088691）。 */
const fs = require('fs');
const path = require('path');

const BASE = 'https://publicreporting.cftc.gov/resource/72hh-3qpy.json';
const CODE = /^[0-9A-Z]{6}$/;
const WEEKS = 110; // 两年多一点：页面拿最近 52 期排位
const FIELDS = ['report_date_as_yyyy_mm_dd', 'market_and_exchange_names', 'contract_units', 'open_interest_all', 'm_money_positions_long_all', 'm_money_positions_short_all'];

/* 接口的行 → [{ ts 那一期是哪天的（UTC 零点）, oi 未平仓, long, short }]，旧的在前；日期或数字不对的丢掉，同一天的只留一条 */
function parseRows(list) {
  const by = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    const ts = Date.parse(String(r.report_date_as_yyyy_mm_dd || '').slice(0, 10) + 'T00:00:00Z'),
      row = { ts, oi: +r.open_interest_all, long: +r.m_money_positions_long_all, short: +r.m_money_positions_short_all };
    if (Number.isFinite(ts) && [row.oi, row.long, row.short].every(v => Number.isFinite(v) && v >= 0)) by.set(ts, row);
  }
  return [...by.values()].sort((a, b) => a.ts - b.ts);
}

function createCftc({ dir, fetchImpl = fetch, now = () => Date.now(), ttl = 6 * 36e5, backoff = 600e3, ua = 'MarketLens/0.4 (personal market dashboard)', base = BASE, warn = console.warn }) {
  const mem = new Map(), inflight = new Map();
  const file = code => path.join(dir, code + '.json');
  function load(code) {
    if (mem.has(code)) return mem.get(code);
    let d = { at: 0, tried: 0, name: '', units: '', rows: [] };
    try {
      const j = JSON.parse(fs.readFileSync(file(code), 'utf8'));
      if (j && Array.isArray(j.rows)) d = { at: +j.at || 0, tried: 0, name: String(j.name || ''), units: String(j.units || ''), rows: j.rows };
    } catch { /* 还没取过 */ }
    mem.set(code, d);
    return d;
  }
  async function pull(code) {
    const u = base + '?' + new URLSearchParams({ cftc_contract_market_code: code, $order: 'report_date_as_yyyy_mm_dd DESC', $limit: String(WEEKS), $select: FIELDS.join(',') });
    const r = await fetchImpl(u, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(20e3) });
    if (!r.ok) throw new Error(`CFTC 返回 ${r.status}`);
    const list = JSON.parse(await r.text()), rows = parseRows(list);
    if (!rows.length) throw new Error('CFTC 没有这个合约的数据');
    const d = { at: now(), tried: now(), name: String((list[0] && list[0].market_and_exchange_names) || '').slice(0, 80), units: String((list[0] && list[0].contract_units) || '').slice(0, 80), rows };
    mem.set(code, d);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file(code) + '.tmp', JSON.stringify({ at: d.at, name: d.name, units: d.units, rows }));
      fs.renameSync(file(code) + '.tmp', file(code));
    } catch (e) { warn(`[cftc] 存不下来：${e.message}`); }
    return d;
  }
  /* { code, name, units, at 取到的时间, rows, err? }；一期都没有、又取不到时抛错 */
  async function get(code) {
    if (!CODE.test(code || '')) throw Object.assign(new Error('合约代码须为 6 位数字或大写字母'), { status: 400 });
    let d = load(code);
    const t = now();
    if (t - d.at >= ttl && t - d.tried >= backoff) {
      if (!inflight.has(code)) inflight.set(code, pull(code).finally(() => inflight.delete(code)));
      try { d = await inflight.get(code); } // 取到了：新的那份上没有 err
      catch (e) {
        d.tried = t;
        d.err = e.name === 'TimeoutError' ? 'CFTC 太久没回' : e.message;
        warn(`[cftc] ${code}：${d.err}`);
      }
    }
    if (!d.rows.length) throw new Error(d.err || '还没有数据');
    return { code, name: d.name, units: d.units, at: d.at, rows: d.rows, ...(d.err ? { err: d.err } : {}) };
  }
  return { get };
}

module.exports = { createCftc, parseRows, CODE };
