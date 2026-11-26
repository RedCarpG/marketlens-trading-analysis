'use strict';
/* AI 分析留痕（docs/AI.md §6）：每次“让 Cirra 分析”成功后记一条到 var/ai/log.jsonl（不入 Git，只在本机），
   页面按之后走出来的K线给它打分（web/js/core/aiscore.js）。AI 的判断没法用历史回测检验（模型见过之后的行情），只能这样从现在起前瞻地记。
   一行一条：{ id, at, sym, src, tf, price, atr, barTime, bias, summary, writer, text } */
const fs = require('fs');
const path = require('path');

/* 回答里第 2 项“倾向：偏多 / 偏空 / 观望”；找不到返回 null（不打分） */
function parseBias(text) {
  const m = String(text).match(/倾向[^：:\n]{0,6}[：:]\s*[*_]*\s*(偏多|偏空|观望)/);
  return m ? m[1] : null;
}

/* 页面带来的这次分析的背景：只收认得的字段 */
function cleanMeta(m, TFS) {
  if (!m || typeof m != 'object') return null;
  const num = v => (Number.isFinite(v) ? v : null),
    str = (v, n) => (typeof v == 'string' && v.length <= n ? v : null),
    o = {
      sym: str(m.sym, 30),
      src: str(m.src, 20),
      tf: TFS.includes(m.tf) ? m.tf : null,
      price: num(m.price),
      atr: num(m.atr),
      barTime: num(m.barTime),
    };
  return o.sym && o.tf && o.price != null ? o : null;
}

function createAiLog(dir) {
  const file = path.join(dir, 'log.jsonl');
  function append(rec) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify(rec) + '\n');
  }
  /* 最近 limit 条（新的在后），可按品种、周期筛；坏行跳过 */
  function list({ sym, tf, limit = 200 } = {}) {
    let lines = [];
    try {
      lines = fs.readFileSync(file, 'utf8').split('\n');
    } catch {
      return [];
    }
    const out = [];
    for (const ln of lines) {
      if (!ln.trim()) continue;
      try {
        const r = JSON.parse(ln);
        if ((!sym || r.sym === sym) && (!tf || r.tf === tf)) out.push(r);
      } catch {
        /* 坏行不管 */
      }
    }
    return out.slice(-limit);
  }
  return { append, list, file };
}

module.exports = { createAiLog, parseBias, cleanMeta };
