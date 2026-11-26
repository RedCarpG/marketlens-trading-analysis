'use strict';
/* 交易日记与我的守则：存在本机 var/journal.json（var/ 不入 Git，JOURNAL_FILE 可改位置）。
   { v: 1, rules: 守则（web/js/core/rules.js 的 normRules 整理过的）, notes: { "品种|交易号": { why, tags, mood, at } } }
   都是你自己写的东西，只在这台电脑上：不发给任何上游，也不交给 Cirra。
   写入先写临时文件再改名；文件坏了就从空的开始（坏的那份改名留着，不覆盖）。 */
const fs = require('fs');
const path = require('path');
const { loadCore } = require('../core/load');

const LIMIT = { why: 500, tags: 8, tag: 12, notes: 3000 };
/* 开仓时的心情（页面上显示成中文，见 web/js/journal.js 的 MOODS） */
const MOODS = ['calm', 'confident', 'excited', 'rushed', 'afraid', 'hesitant', 'bored', 'revenge'];
const KEY = /^[A-Za-z0-9=^.\-]{1,20}\|[A-Za-z0-9_\-]{1,40}$/;
const clip = (s, n) => [...String(s == null ? '' : s)].slice(0, n).join('');

/* 一条日记整理干净；什么都没写的返回 null（等于删掉） */
function cleanNote(n) {
  n = n && typeof n == 'object' ? n : {};
  const why = clip(String(n.why == null ? '' : n.why).replace(/\r\n?/g, '\n').trim(), LIMIT.why),
    tags = [...new Set((Array.isArray(n.tags) ? n.tags : []).map(t => clip(String(t).replace(/\s+/g, ' ').trim(), LIMIT.tag)).filter(Boolean))].slice(0, LIMIT.tags),
    mood = MOODS.includes(n.mood) ? n.mood : '';
  return why || tags.length || mood ? { why, tags, mood } : null;
}

function createJournal(file, { now = () => Date.now(), warn = console.warn } = {}) {
  const normRules = loadCore()('normRules'),
    plain = v => JSON.parse(JSON.stringify(v));
  let doc = null;
  function load() {
    if (doc) return doc;
    doc = { v: 1, rules: plain(normRules(null)), notes: {} };
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return doc; // 还没有这个文件
    }
    try {
      const j = JSON.parse(raw);
      if (!j || typeof j != 'object') throw new Error('不是对象');
      doc.rules = plain(normRules(j.rules));
      for (const [k, n] of Object.entries(j.notes && typeof j.notes == 'object' ? j.notes : {})) {
        const c = KEY.test(k) && cleanNote(n);
        if (c) doc.notes[k] = { ...c, at: Number.isFinite(n.at) ? n.at : 0 };
      }
    } catch (e) {
      const keep = `${file}.broken-${now()}`;
      try { fs.renameSync(file, keep); } catch { /* 改不了名就算了，下面写入时会覆盖 */ }
      warn(`[journal] ${file} 读不了（${e.message}），从空的开始；原文件留在 ${keep}`);
    }
    return doc;
  }
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, file);
  }
  return {
    get: () => load(),
    /* 换成新的守则（整份），返回整理后的 */
    setRules(rules) {
      load().rules = plain(normRules(rules));
      save();
      return doc.rules;
    },
    /* 写一条日记；note 为空或什么都没写就是删掉。key 不对返回 undefined；删掉返回 null */
    setNote(key, note) {
      if (typeof key != 'string' || !KEY.test(key)) return undefined;
      const c = cleanNote(note),
        d = load();
      if (!c) delete d.notes[key];
      else {
        if (!d.notes[key] && Object.keys(d.notes).length >= LIMIT.notes) throw new Error(`日记已经有 ${LIMIT.notes} 条，先删掉一些旧的`);
        d.notes[key] = { ...c, at: now() };
      }
      save();
      return d.notes[key] || null;
    },
  };
}

module.exports = { createJournal, cleanNote, MOODS, LIMIT };
