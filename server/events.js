'use strict';
/* 经济日历、官方数据与新闻（只读，免费公开来源，不需要密钥），由本地代理拉取并缓存：
   - 日历：Forex Factory 本周日历（各国，含影响等级、预期值、前值；第三方整理）、
     BLS 发布日程 ICS（非农、CPI 等的官方时间，覆盖未来几个月）、FOMC 例会日程（美联储公布，内置于下方 FOMC）
   - 官方数据：BLS 公共 API（非农新增、失业率、平均时薪、CPI 的最新公布值）
   - 新闻：RSS（美联储新闻稿 + Google 新闻按主题搜索；.env 的 NEWS_FEEDS 可追加）
   页面只能选预设的主题和语言，代理只访问这里列出的地址。标题等外部文字都是不可信数据：这里去掉标签，页面转义后显示，不参与任何计算或配置。
   拉到的日历按 id 合并存到 var/events/（不入 Git），过去的事件随使用时间积累，可在K线上标出。 */
const fs = require('fs');
const path = require('path');

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const BLS_ICS = 'https://www.bls.gov/schedule/news_release/bls.ics';
const BLS_V1 = 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
const BLS_V2 = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const FED_RSS = 'https://www.federalreserve.gov/feeds/press_all.xml';
const FOMC_URL = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

/* ===== 时间：美国的发布时间都按美东时间（夏令时由 Intl 处理，不手算切换日） ===== */
const ET = 'America/New_York';
const tzFmt = new Map();
function tzOff(t, tz) {
  if (!tzFmt.has(tz))
    tzFmt.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  const p = {};
  for (const x of tzFmt.get(tz).formatToParts(new Date(t))) p[x.type] = +x.value;
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1e3) * 1e3;
}
/* 某时区的墙上时间 → UTC 毫秒 */
function zoned(y, mo, d, h = 0, mi = 0, tz = ET) {
  const w = Date.UTC(y, mo - 1, d, h, mi);
  return w - tzOff(w - tzOff(w, tz), tz);
}
const etDay = new Intl.DateTimeFormat('en-CA', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' });
const etDate = t => etDay.format(new Date(t));
const validTz = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

/* ===== 事件名称：常见英文名 → 中文（未收录的保持原文，页面显示原文） ===== */
const ZH = [
  [/^Non-Farm Employment Change$/, '非农就业人数'],
  [/^ADP Non-Farm Employment Change$/, 'ADP 就业人数'],
  [/^Unemployment Rate$/, '失业率'],
  [/^Unemployment Claims$/, '初请失业金人数'],
  [/^Average Hourly Earnings/, '平均时薪'],
  [/^Core CPI/, '核心 CPI'],
  [/^CPI/, 'CPI'],
  [/^Core PPI/, '核心 PPI'],
  [/^PPI/, 'PPI'],
  [/^Core PCE Price Index/, '核心 PCE 物价指数'],
  [/^PCE Price Index/, 'PCE 物价指数'],
  [/^Advance GDP q\/q$/, 'GDP 季率（初值）'],
  [/^Prelim GDP q\/q$/, 'GDP 季率（修正值）'],
  [/^Final GDP q\/q$/, 'GDP 季率（终值）'],
  [/^Federal Funds Rate$/, '联邦基金利率决议'],
  [/^FOMC Statement$/, 'FOMC 声明'],
  [/^FOMC Press Conference$/, 'FOMC 记者会'],
  [/^FOMC Meeting Minutes$/, 'FOMC 会议纪要'],
  [/^FOMC Economic Projections$/, 'FOMC 经济预测'],
  [/^Fed Chair (.+) (Speaks|Testifies)$/, '美联储主席 $1 讲话'],
  [/^Core Retail Sales/, '核心零售销售'],
  [/^Retail Sales/, '零售销售'],
  [/^ISM Manufacturing PMI$/, 'ISM 制造业 PMI'],
  [/^ISM Services PMI$/, 'ISM 服务业 PMI'],
  [/^JOLTS Job Openings$/, 'JOLTS 职位空缺'],
  [/^(Prelim |Revised )?UoM Consumer Sentiment$/, '密歇根消费者信心'],
  [/^CB Consumer Confidence$/, '谘商会消费者信心'],
  [/^Core Durable Goods Orders/, '核心耐用品订单'],
  [/^Durable Goods Orders/, '耐用品订单'],
  [/^Employment Cost Index/, '就业成本指数'],
  [/^Main Refinancing Rate$/, '欧央行主要再融资利率'],
  [/^ECB Press Conference$/, '欧央行记者会'],
  [/^Official Bank Rate$/, '英央行利率决议'],
  [/^BOJ Policy Rate$/, '日央行利率决议'],
  [/^Monetary Policy Statement$/, '货币政策声明'],
  [/^Bank Holiday$/, '银行假日'],
];
function zhName(title) {
  for (const [re, t] of ZH)
    if (re.test(title))
      return title.replace(re, t).replace(/ m\/m$/, ' 月率').replace(/ y\/y$/, ' 年率').replace(/ q\/q$/, ' 季率').replace(/ +/g, ' ');
  return null;
}
/* 同一次发布的几项归为一组（rel），用于与官方日程核对、图上标注的简称（只看美国） */
const REL = [
  [/^(Non-Farm Employment Change|Unemployment Rate|Average Hourly Earnings)/, 'empsit'],
  [/^(Core )?CPI /, 'cpi'],
  [/^(Core )?PPI /, 'ppi'],
  [/^(Core )?PCE Price Index/, 'pce'],
  [/GDP q\/q$/, 'gdp'],
  [/^(Federal Funds Rate|FOMC Statement|FOMC Press Conference)$/, 'fomc'],
  [/^JOLTS/, 'jolts'],
  [/^Employment Cost Index/, 'eci'],
];
const relOf = title => (REL.find(([re]) => re.test(title)) || [])[1] || null;
const str = v => (v == null ? '' : String(v).trim());
/* 排序与时间范围用：只有日期（全天）的事件取美东当天 0 点 */
const evKey = e => (e.ts != null ? e.ts : zoned(...e.date.split('-').map(Number)));

/* ===== Forex Factory 本周日历：[{ title, country, date(带时区偏移), impact, forecast, previous }] ===== */
const IMP = { High: 3, Medium: 2, Low: 1, Holiday: 0, 'Non-Economic': 0 };
function fromFF(list) {
  if (!Array.isArray(list)) throw new Error('Forex Factory 返回格式不对');
  return list
    .map(e => {
      const ts = Date.parse(e.date), title = str(e.title), ccy = str(e.country).toUpperCase();
      if (!Number.isFinite(ts) || !title) return null;
      return { id: `ff:${ts}:${ccy}:${title}`, ts, ccy, title, zh: zhName(title), imp: IMP[e.impact] ?? 1, rel: ccy == 'USD' ? relOf(title) : null,
        forecast: str(e.forecast), previous: str(e.previous), actual: str(e.actual), src: 'ff' };
    })
    .filter(Boolean);
}

/* ===== iCalendar（BLS 发布日程）：处理折行、TZID、UTC（Z）、全天事件；BLS 说明日程里的时间都是美东时间，没有时区的按美东 ===== */
const unescICS = s => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
function icsTime(ps, v) {
  const m = v.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/);
  if (!m) return {};
  const [, y, mo, d, h, mi, , z] = m, date = `${y}-${mo}-${d}`;
  if (h == null) return { date, ts: null };
  const tz = (ps.match(/TZID="?([^;:"]+)/) || [])[1];
  return { date, ts: z ? Date.UTC(+y, mo - 1, +d, +h, +mi) : zoned(+y, +mo, +d, +h, +mi, tz && validTz(tz) ? tz : ET) };
}
function parseICS(text) {
  const out = [];
  let ev = null;
  for (const ln of String(text).replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (ln == 'BEGIN:VEVENT') ev = {};
    else if (ln == 'END:VEVENT') {
      if (ev) out.push(ev);
      ev = null;
    } else if (ev) {
      const m = ln.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (!m) continue;
      if (m[1] == 'SUMMARY') ev.summary = unescICS(m[3]);
      else if (m[1] == 'UID') ev.uid = m[3].trim();
      else if (m[1] == 'DTSTART') Object.assign(ev, icsTime(m[2], m[3].trim()));
    }
  }
  return out;
}
/* 只取对行情影响大的几项发布；“for October 2026” 记为参考月份 */
const BLSREL = [
  [/^(The )?Employment Situation/i, 'empsit', '非农就业报告', 3],
  [/^Consumer Price Index/i, 'cpi', 'CPI 报告', 3],
  [/^Producer Price Index/i, 'ppi', 'PPI 报告', 2],
  [/^Job Openings and Labor Turnover/i, 'jolts', 'JOLTS 职位空缺报告', 2],
  [/^Employment Cost Index/i, 'eci', '就业成本指数报告', 2],
];
const MON = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
function fromBLS(ics) {
  return parseICS(ics)
    .map(v => {
      const hit = BLSREL.find(([re]) => re.test(v.summary || ''));
      if (!hit || !v.date) return null;
      const m = v.summary.match(/for (\w+),? (\d{4})/) || [], mo = MON[m[1]];
      return { id: 'bls:' + (v.uid || v.date + ':' + v.summary), ts: v.ts, date: v.date, ccy: 'USD', title: v.summary, zh: hit[2] + (mo ? `（${mo}月）` : ''), imp: hit[3], rel: hit[1],
        ref: mo ? `${m[2]}-${String(mo).padStart(2, '0')}` : null, src: 'bls', url: 'https://www.bls.gov/schedule/news_release/' };
    })
    .filter(Boolean);
}

/* ===== FOMC 例会：第二天美东 14:00 发布声明（14:30 主席记者会）。带 * 的会议附经济预测与点阵图。
   2026 年按美联储日历；2027 年为美联储 2025-09-05 公布的暂定日程（未标经济预测）。2028 年起需按 FOMC_URL 补充 ===== */
const FOMC = {
  2026: ['01-28', '03-18*', '04-29', '06-17*', '07-29', '09-16*', '10-28', '12-09*'],
  2027: ['01-27', '03-17', '04-28', '06-09', '07-28', '09-15', '10-27', '12-08'],
  2028: ['01-26'],
};
function fromFOMC() {
  return Object.entries(FOMC).flatMap(([y, ds]) =>
    ds.map(d => {
      const day = d.replace('*', ''), [mo, dd] = day.split('-').map(Number);
      return { id: `fed:${y}-${day}`, ts: zoned(+y, mo, dd, 14, 0), date: `${y}-${day}`, ccy: 'USD', title: 'FOMC Statement', zh: 'FOMC 利率决议' + (d.endsWith('*') ? '（含经济预测）' : ''),
        imp: 3, rel: 'fomc', src: 'fed', url: FOMC_URL };
    })
  );
}
const fomcLast = () => Math.max(...fromFOMC().map(e => e.ts));

/* ===== 合并：Forex Factory 的条目有预期值、前值，作为主条目；BLS / 美联储的官方日程与它同一次发布（同 rel、美东同一天）时，
   只给主条目标上已与官方日程核对（conf），时间不一致时附上官方时间（ofs）；Forex Factory 还没有的（下周以后）单独列出 ===== */
function merge(list) {
  const prim = list.filter(e => e.src == 'ff').map(e => ({ ...e })), out = [...prim];
  for (const o of list.filter(e => e.src != 'ff')) {
    const d = o.date || etDate(o.ts), hit = prim.filter(e => e.rel && e.rel == o.rel && etDate(e.ts) == d);
    if (!hit.length) {
      out.push({ ...o });
      continue;
    }
    for (const e of hit) {
      e.conf = o.src;
      if (o.ref) e.ref = o.ref;
      /* FOMC 记者会比声明晚半小时，不算时间不一致 */
      if (o.ts && o.rel != 'fomc' && Math.abs(o.ts - e.ts) > 60e3) e.ofs = o.ts;
    }
  }
  return out.sort((a, b) => evKey(a) - evKey(b) || b.imp - a.imp);
}

/* ===== BLS 官方数值：非农（总就业人数的月变化）、失业率、平均时薪、CPI / 核心 CPI。月率用季调序列，年率用未季调序列（与 BLS 新闻稿口径一致） ===== */
const SERIES = {
  CES0000000001: 'nfp', // 非农就业总人数，季调，千人
  LNS14000000: 'unemp', // 失业率，季调，%
  CES0500000003: 'ahe', // 私营部门平均时薪，季调，美元
  CUSR0000SA0: 'cpiSA', // CPI-U 所有项目，季调
  CUUR0000SA0: 'cpi', // CPI-U 所有项目，未季调
  CUSR0000SA0L1E: 'coreSA', // 核心 CPI（除食品和能源），季调
  CUUR0000SA0L1E: 'core', // 核心 CPI，未季调
};
function blsData(j) {
  if (!j || j.status != 'REQUEST_SUCCEEDED' || !j.Results) throw new Error('BLS：' + ((j && j.message && j.message.join('；')) || (j && j.status) || '返回格式不对'));
  const S = {};
  for (const s of j.Results.series || []) {
    const k = SERIES[s.seriesID];
    if (!k) continue;
    S[k] = (s.data || [])
      .filter(d => /^M(0[1-9]|1[0-2])$/.test(d.period))
      .map(d => ({ i: +d.year * 12 + +d.period.slice(1) - 1, v: parseFloat(String(d.value).replace(/,/g, '')), p: (d.footnotes || []).some(f => f && f.code == 'P') }))
      .filter(d => Number.isFinite(d.v))
      .sort((a, b) => a.i - b.i);
  }
  const ym = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
    get = (a, i) => a && a.find(d => d.i == i),
    /* 与 lag 个月前相比；缺月（如数据停发）时不硬算 */
    chg = (a, i) => { const x = get(a, i), y = get(a, i - 1); return x && y ? x.v - y.v : null; },
    pct = (a, i, lag) => { const x = get(a, i), y = get(a, i - lag); return x && y ? (x.v / y.v - 1) * 100 : null; },
    item = (k, name, a, f, unit, dp) => {
      if (!a || !a.length) return null;
      const n = a[a.length - 1].i, val = f(a, n);
      return val == null ? null : { k, name, ref: ym(n), val, prev: f(a, n - 1), unit, dp, prelim: get(a, n).p };
    };
  return [
    item('nfp', '非农就业新增', S.nfp, chg, 'K', 0),
    item('unemp', '失业率', S.unemp, (a, i) => (get(a, i) || {}).v ?? null, '%', 1),
    item('ahe', '平均时薪 月率', S.ahe, (a, i) => pct(a, i, 1), '%', 1),
    item('ahey', '平均时薪 年率', S.ahe, (a, i) => pct(a, i, 12), '%', 1),
    item('cpi', 'CPI 年率', S.cpi, (a, i) => pct(a, i, 12), '%', 1),
    item('cpim', 'CPI 月率', S.cpiSA, (a, i) => pct(a, i, 1), '%', 1),
    item('core', '核心 CPI 年率', S.core, (a, i) => pct(a, i, 12), '%', 1),
    item('corem', '核心 CPI 月率', S.coreSA, (a, i) => pct(a, i, 1), '%', 1),
  ].filter(Boolean);
}

/* ===== RSS 2.0 / Atom：只取标题、链接、时间、来源；去掉 CDATA、标签，解开实体 ===== */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) => (c[0] == '#' ? String.fromCodePoint(c[1].toLowerCase() == 'x' ? parseInt(c.slice(2), 16) : +c.slice(1)) : ENT[c.toLowerCase()] ?? m));
/* 先去掉原样的标签（CDATA 里的 HTML），解开实体后再去掉转义过的标签（Atom 的 type="html"） */
const plain = s =>
  decode(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' '))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function parseFeed(xml) {
  const blocks = String(xml).match(/<item\b[\s\S]*?<\/item>/gi) || String(xml).match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    const tag = n => { const m = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i')); return m ? plain(m[1]) : ''; };
    let link = tag('link');
    if (!/^https?:\/\//i.test(link)) { const m = b.match(/<link\b[^>]*href="([^"]+)"/i); link = m ? decode(m[1]) : ''; }
    const source = tag('source');
    let title = tag('title');
    /* Google 新闻的标题末尾带“ - 来源”，来源另有字段，去掉重复 */
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -source.length - 3);
    return { title, link: /^https?:\/\//i.test(link) ? link : '', ts: Date.parse(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')), source };
  }).filter(x => x.title);
}

/* ===== 新闻：主题 × 语言 → Google 新闻搜索（近 2 天）+ 美联储新闻稿（官方）+ .env 追加的 RSS ===== */
const TOPIC = {
  gold: { zh: '黄金 OR 金价', en: 'gold price OR gold futures' },
  btc: { zh: '比特币 OR 加密货币', en: 'bitcoin OR crypto' },
  macro: { zh: '美联储 OR 非农 OR CPI OR 通胀 OR 美元', en: 'Federal Reserve OR nonfarm payrolls OR CPI inflation OR dollar' },
};
const LANGS = { zh: { hl: 'zh-CN', gl: 'CN', ceid: 'CN:zh-Hans' }, en: { hl: 'en-US', gl: 'US', ceid: 'US:en' } };
const gnews = (q, lang) => 'https://news.google.com/rss/search?' + new URLSearchParams({ q: q + ' when:2d', ...LANGS[lang] });
const TAGS = [
  ['非农', /非农|nonfarm|non-farm|payroll|jobs report|就业报告/i],
  ['CPI', /\bCPI\b|通胀|inflation|消费者物价/i],
  ['美联储', /美联储|联储|\bFed\b|FOMC|Federal Reserve|利率决议|降息|加息|rate (cut|hike)/i],
  ['黄金', /黄金|金价|\bgold\b|XAU/i],
  ['比特币', /比特币|bitcoin|\bBTC\b|加密货币|\bcrypto/i],
  ['关税', /关税|tariff/i],
];
/* NEWS_FEEDS=名称|https://地址,名称2|https://地址2（地址里不能有逗号） */
function parseFeeds(s) {
  return String(s || '')
    .split(',')
    .map(x => x.trim().split('|').map(y => y.trim()))
    .map(([a, b]) => (b ? [a, b] : [a, a]))
    .filter(([, u]) => /^https?:\/\//i.test(u))
    .map(([name, url]) => ({ name: name.slice(0, 40), url }));
}

/* ===== 存储：var/events/*.json，先写临时文件再改名 ===== */
function jsonFile(f) {
  return {
    load(d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } },
    save(v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); },
  };
}

/* 返回的日历：最近 8 天及以后的全部事件；更早的只留高影响（供图上标注），最多回看 400 天 */
const KEEP = 400 * 864e5, RECENT = 8 * 864e5;

function createEvents({ dir, ua = 'MarketLens/0.4 (personal market dashboard)', blsKey = '', feeds = [], fetchImpl = fetch, now = () => Date.now(), urls = {} }) {
  const U = { ff: FF_URL, ics: BLS_ICS, bls: blsKey ? BLS_V2 : BLS_V1, fed: FED_RSS, gnews, ...urls };
  const calF = jsonFile(path.join(dir, 'calendar.json')), blsF = jsonFile(path.join(dir, 'bls.json'));
  const cal = calF.load({ events: [], meta: {} });
  cal.meta = cal.meta || {};
  let bls = blsF.load({});
  /* 每个来源的状态：at 最后成功、tried 最后尝试、err 最后错误（页面显示覆盖情况） */
  const st = { ff: { name: 'Forex Factory 本周日历', at: cal.meta.ff || 0 }, ics: { name: 'BLS 发布日程', at: cal.meta.ics || 0 }, bls: { name: 'BLS 官方数据', at: bls.at || 0, err: bls.err } };
  const inflight = new Map();
  const once = (k, fn) => {
    if (!inflight.has(k)) inflight.set(k, fn().finally(() => inflight.delete(k)));
    return inflight.get(k);
  };

  async function get(url, init = {}) {
    const r = await fetchImpl(url, { ...init, headers: { 'user-agent': ua, accept: '*/*', ...(init.headers || {}) }, signal: AbortSignal.timeout(15e3) });
    if (!r.ok) { const e = new Error(`${new URL(url).hostname} 返回 ${r.status}`); e.status = r.status; throw e; }
    return r.text();
  }
  /* 新拉到的某来源事件替换存储里该来源同一时间段内的旧事件（改期、取消的随之去掉），其余保留；只留最近 400 天 */
  function absorb(srcId, fresh) {
    if (fresh.length) {
      const ks = fresh.map(evKey), lo = Math.min(...ks), hi = Math.max(...ks), ids = new Set(fresh.map(e => e.id));
      cal.events = cal.events.filter(e => e.src != srcId || ids.has(e.id) || evKey(e) < lo || evKey(e) > hi);
      const m = new Map(cal.events.map(e => [e.id, e]));
      for (const e of fresh) m.set(e.id, e);
      cal.events = [...m.values()];
    }
    const t = now();
    cal.events = cal.events.filter(e => evKey(e) >= t - KEEP);
  }
  /* 按 ttl 刷新某来源；失败时保留已存的数据，backoff 后再试 */
  async function fresh(k, ttl, backoff, fn) {
    const s = st[k], t = now();
    if (t - (s.at || 0) < ttl || t - (s.tried || 0) < backoff) return;
    s.tried = t;
    try {
      await once(k, fn);
      s.at = now();
      s.err = null;
      cal.meta[k] = s.at;
      calF.save(cal);
    } catch (e) {
      s.err = e.message;
      console.warn(`[events] ${s.name}：${e.message}`);
    }
  }
  const refreshFF = async () => {
    let j;
    try { j = JSON.parse(await get(U.ff, { headers: { accept: 'application/json' } })); } catch (e) { throw e instanceof SyntaxError ? new Error('返回的不是 JSON（可能被限速，稍后再试）') : e; }
    absorb('ff', fromFF(j));
  };
  const refreshICS = async () => {
    const t = await get(U.ics, { headers: { accept: 'text/calendar' } });
    if (!/BEGIN:VCALENDAR/.test(t)) throw new Error('返回的不是日历文件（可能被拒绝访问）');
    absorb('bls', fromBLS(t));
  };
  /* BLS 公共 API（未注册每天 25 次）：平时 12 小时一次；非农、CPI 公布后 1 小时内每 10 分钟查一次，直到拿到新数；结果存盘，重启不重复查询 */
  async function refreshData(events) {
    const t = now(), at = bls.at || 0,
      rel = events.filter(e => (e.rel == 'empsit' || e.rel == 'cpi') && e.ts && e.ts <= t - 2 * 60e3).reduce((m, e) => Math.max(m, e.ts), 0),
      due = !at || t - at > 12 * 36e5 || (rel && at < rel + 36e5 && t - at >= 10 * 60e3);
    if (!due || t - (st.bls.tried || 0) < 5 * 60e3) return;
    st.bls.tried = t;
    try {
      const y = new Date(t).getUTCFullYear(),
        body = { seriesid: Object.keys(SERIES), startyear: String(y - 2), endyear: String(y), ...(blsKey ? { registrationkey: blsKey } : {}) },
        items = blsData(JSON.parse(await once('bls', () => get(U.bls, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))));
      bls = { at: now(), items };
      st.bls.at = bls.at;
      st.bls.err = null;
    } catch (e) {
      st.bls.err = e.message;
      bls = { ...bls, at: bls.at || 0, err: e.message };
      console.warn(`[events] BLS 官方数据：${e.message}`);
    }
    blsF.save({ ...bls, at: bls.at || 0 });
  }

  async function calendar() {
    await Promise.all([fresh('ff', 36e5, 10 * 60e3, refreshFF), fresh('ics', 12 * 36e5, 30 * 60e3, refreshICS)]);
    const t = now(), all = merge([...cal.events, ...fromFOMC()]);
    await refreshData(all);
    const events = all.filter(e => evKey(e) >= t - RECENT || (e.imp >= 3 && evKey(e) >= t - KEEP));
    const fomc = { name: 'FOMC 日程（内置）', at: null, err: fomcLast() < t ? '内置的 FOMC 日程已过期，需按美联储日历补充' : null, url: FOMC_URL };
    return {
      at: t,
      events,
      data: { at: bls.at || null, items: bls.items || [], err: st.bls.err || null, url: 'https://www.bls.gov/bls/newsrels.htm' },
      sources: [st.ff, st.ics, fomc, st.bls].map(s => ({ name: s.name, ok: !s.err && (s.at != null ? s.at > 0 : true), at: s.at || null, err: s.err || null })),
    };
  }

  /* 新闻：每个 RSS 缓存 5 分钟；合并后按标题去重、按时间倒序，最多 60 条 */
  const nc = new Map();
  async function feed(f) {
    const c = nc.get(f.url), t = now();
    if (c && t - c.at < (c.err ? 2 * 60e3 : 5 * 60e3)) return c;
    try {
      const items = parseFeed(await once('n:' + f.url, () => get(f.url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } })));
      const r = { at: t, items, err: null };
      nc.set(f.url, r);
      return r;
    } catch (e) {
      const r = { at: t, items: c ? c.items : [], err: e.message };
      nc.set(f.url, r);
      return r;
    }
  }
  async function news(topic, lang) {
    if (!TOPIC[topic] || !LANGS[lang]) throw new Error('topic 或 lang 无效');
    const list = [{ name: lang == 'zh' ? 'Google 新闻' : 'Google News', url: U.gnews(TOPIC[topic][lang], lang) }, { name: '美联储新闻稿', url: U.fed, off: 1 }, ...feeds];
    const rs = await Promise.all(list.map(feed)), t = now(), seen = new Set(), items = [];
    rs.forEach((r, i) =>
      r.items.forEach(x => {
        const k = x.title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 48);
        if (!k || seen.has(k)) return;
        seen.add(k);
        const ts = Number.isFinite(x.ts) ? Math.min(x.ts, t) : null;
        if (ts != null && ts < t - 7 * 864e5) return;
        items.push({ id: k, title: x.title.slice(0, 300), link: x.link, source: (x.source || list[i].name).slice(0, 60), feed: list[i].name, off: !!list[i].off, ts, tags: TAGS.filter(([, re]) => re.test(x.title)).map(([n]) => n) });
      })
    );
    items.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    return { at: t, topic, lang, items: items.slice(0, 60), sources: list.map((f, i) => ({ name: f.name, ok: !rs[i].err, at: rs[i].at, err: rs[i].err, n: rs[i].items.length })) };
  }

  return { calendar, news };
}

module.exports = { createEvents, parseFeeds, TOPIC, LANGS, zoned, etDate, zhName, parseICS, fromFF, fromBLS, fromFOMC, merge, blsData, parseFeed };
