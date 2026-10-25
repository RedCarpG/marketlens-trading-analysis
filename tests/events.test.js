// 经济日历与新闻（server/events.js）：时区换算、各来源解析、与官方日程核对合并、BLS 数值计算、新闻去重，以及缓存、存储与失败回退。
// 上游用假的 fetch 模拟（样例按各来源公开的格式编写），不访问网络。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('../server/events');

const iso = t => new Date(t).toISOString();

test('zoned：美东时间按夏令时换算，含美欧夏令时错开的那几周', () => {
  assert.equal(iso(E.zoned(2026, 10, 2, 8, 30)), '2026-10-02T12:30:00.000Z'); // 夏令时 EDT
  assert.equal(iso(E.zoned(2026, 11, 6, 8, 30)), '2026-11-06T13:30:00.000Z'); // 11/1 起冬令时 EST
  assert.equal(iso(E.zoned(2026, 3, 13, 8, 30)), '2026-03-13T12:30:00.000Z'); // 美国 3/8 已切夏令时、欧洲 3/29 才切：巴黎为 13:30
  assert.equal(iso(E.zoned(2026, 10, 28, 14, 0)), '2026-10-28T18:00:00.000Z');
  assert.equal(E.etDate(Date.parse('2026-11-07T03:00:00Z')), '2026-11-06'); // UTC 已是 7 号，美东仍是 6 号晚上
});

test('zhName：常见事件译名，未收录的返回 null', () => {
  assert.equal(E.zhName('Non-Farm Employment Change'), '非农就业人数');
  assert.equal(E.zhName('Core CPI m/m'), '核心 CPI 月率');
  assert.equal(E.zhName('Average Hourly Earnings m/m'), '平均时薪 月率');
  assert.equal(E.zhName('Advance GDP q/q'), 'GDP 季率（初值）');
  assert.equal(E.zhName('Fed Chair Smith Speaks'), '美联储主席 Smith 讲话');
  assert.equal(E.zhName('Some Unknown Index'), null);
});

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:empsit-2026-11',
  'DTSTART;TZID=US-Eastern:20261106T083000',
  'SUMMARY:Employment Situation for October 2026',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:cpi-2026-11',
  'DTSTART;TZID=America/New_York:20261112T083000',
  'SUMMARY:Consumer Price Index for October ',
  ' 2026',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:jolts-utc',
  'DTSTART:20261103T150000Z',
  'SUMMARY:Job Openings and Labor Turnover Survey for September 2026',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:allday',
  'DTSTART;VALUE=DATE:20261120',
  'SUMMARY:Producer Price Index for October 2026',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:other',
  'DTSTART;TZID=US-Eastern:20261105T100000',
  'SUMMARY:Productivity and Costs for Third Quarter 2026',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parseICS / fromBLS：折行、TZID、UTC、全天事件；只留重要发布并记参考月份', () => {
  const v = E.parseICS(ICS);
  assert.equal(v.length, 5);
  assert.equal(v[1].summary, 'Consumer Price Index for October 2026'); // 折行拼回
  const b = E.fromBLS(ICS);
  assert.deepEqual(
    b.map(e => [e.rel, e.ts && iso(e.ts), e.date, e.ref, e.zh]),
    [
      ['empsit', '2026-11-06T13:30:00.000Z', '2026-11-06', '2026-10', '非农就业报告（10月）'],
      ['cpi', '2026-11-12T13:30:00.000Z', '2026-11-12', '2026-10', 'CPI 报告（10月）'],
      ['jolts', '2026-11-03T15:00:00.000Z', '2026-11-03', '2026-09', 'JOLTS 职位空缺报告（9月）'],
      ['ppi', null, '2026-11-20', '2026-10', 'PPI 报告（10月）'],
    ]
  );
});

const FF = [
  {
    title: 'FOMC Statement',
    country: 'USD',
    date: '2026-10-28T14:00:00-04:00',
    impact: 'High',
    forecast: '',
    previous: '',
  },
  {
    title: 'Federal Funds Rate',
    country: 'USD',
    date: '2026-10-28T14:00:00-04:00',
    impact: 'High',
    forecast: '3.50%',
    previous: '3.75%',
  },
  {
    title: 'Non-Farm Employment Change',
    country: 'USD',
    date: '2026-11-06T08:30:00-05:00',
    impact: 'High',
    forecast: '140K',
    previous: '22K',
  },
  {
    title: 'Unemployment Rate',
    country: 'USD',
    date: '2026-11-06T08:30:00-05:00',
    impact: 'High',
    forecast: '4.3%',
    previous: '4.3%',
  },
  {
    title: 'German Prelim CPI m/m',
    country: 'EUR',
    date: '2026-10-29T08:00:00-04:00',
    impact: 'Medium',
    forecast: '0.2%',
    previous: '0.1%',
  },
  {
    title: 'Bank Holiday',
    country: 'NZD',
    date: '2026-10-26T00:00:00-04:00',
    impact: 'Holiday',
    forecast: '',
    previous: '',
  },
  { title: 'bad date', country: 'USD', date: 'TBD', impact: 'Low' },
];

test('fromFF：影响等级、译名、发布分组；时间无效的丢弃', () => {
  const f = E.fromFF(FF);
  assert.equal(f.length, 6);
  const nfp = f.find(e => e.title == 'Non-Farm Employment Change');
  assert.equal(iso(nfp.ts), '2026-11-06T13:30:00.000Z');
  assert.deepEqual(
    [nfp.imp, nfp.rel, nfp.zh, nfp.forecast, nfp.previous],
    [3, 'empsit', '非农就业人数', '140K', '22K']
  );
  assert.equal(f.find(e => e.ccy == 'EUR').rel, null); // 只给美国事件分组
  assert.equal(f.find(e => e.ccy == 'NZD').imp, 0);
  assert.throws(() => E.fromFF({ error: 'x' }));
});

test('merge：与 BLS / 美联储官方日程同一次发布的只标“已核对”；FF 没有的官方日程单独列出；时间不一致附官方时间', () => {
  const ff = E.fromFF(FF),
    bls = E.fromBLS(ICS),
    fed = E.fromFOMC();
  const m = E.merge([...ff, ...bls, ...fed]);
  const nfp = m.filter(e => e.rel == 'empsit');
  assert.equal(nfp.length, 2); // FF 的非农、失业率两条，BLS 那条并入
  assert.ok(nfp.every(e => e.conf == 'bls' && e.ref == '2026-10' && !e.ofs));
  const oct28 = m.filter(e => e.rel == 'fomc' && E.etDate(e.ts) == '2026-10-28');
  assert.deepEqual(
    oct28.map(e => [e.src, e.conf]),
    [
      ['ff', 'fed'],
      ['ff', 'fed'],
    ]
  );
  assert.ok(m.some(e => e.src == 'bls' && e.rel == 'cpi')); // 下周以后，FF 还没有
  assert.ok(m.some(e => e.src == 'fed' && e.date == '2026-12-09' && /经济预测/.test(e.zh)));
  /* FF 改了时间（官方仍是 8:30）：附上官方时间 */
  const moved = E.merge([...E.fromFF([{ ...FF[2], date: '2026-11-06T10:00:00-05:00' }]), ...bls]);
  assert.equal(iso(moved.find(e => e.src == 'ff').ofs), '2026-11-06T13:30:00.000Z');
  /* 2026 年 FOMC 都在美东 14:00 */
  assert.ok(fed.filter(e => e.date.startsWith('2026')).every(e => new Date(e.ts).getUTCMinutes() == 0));
  assert.equal(fed.filter(e => e.date.startsWith('2026')).length, 8);
});

const pt = (year, m, value, P) => ({
  year: String(year),
  period: 'M' + String(m).padStart(2, '0'),
  value: String(value),
  footnotes: P ? [{ code: 'P', text: 'preliminary' }] : [{}],
});
function blsJSON() {
  const months = [];
  for (let y = 2024; y <= 2026; y++) for (let m = 1; m <= 12; m++) if (y < 2026 || m <= 9) months.push([y, m]);
  const ser = (id, f) => ({
    seriesID: id,
    data: months
      .map(([y, m], i) => pt(y, m, f(i), y == 2026 && m == 9))
      .reverse()
      .concat([{ year: '2025', period: 'M13', value: '1' }]),
  });
  return {
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        ser('CES0000000001', i => 158000 + i * 100 + (i == 32 ? 50 : 0)), // 每月 +100K，2026-09 那个月多 50K
        ser('LNS14000000', i => (i == 32 ? 4.4 : 4.2)),
        ser('CES0500000003', i => 35 * Math.pow(1.003, i)),
        ser('CUUR0000SA0', i => 300 * Math.pow(1.0025, i)),
        ser('CUSR0000SA0', i => 300 * Math.pow(1.0025, i)),
      ],
    },
  };
}

test('blsData：非农为月变化、失业率、时薪与 CPI 的月率/年率；初值标记；缺月不硬算', () => {
  const d = E.blsData(blsJSON()),
    g = k => d.find(x => x.k == k);
  assert.deepEqual([g('nfp').ref, g('nfp').val, g('nfp').prev, g('nfp').prelim], ['2026-09', 150, 100, true]);
  assert.deepEqual([g('unemp').val, g('unemp').prev], [4.4, 4.2]);
  assert.ok(Math.abs(g('ahe').val - 0.3) < 1e-9);
  assert.ok(Math.abs(g('cpi').val - (Math.pow(1.0025, 12) - 1) * 100) < 1e-9);
  assert.equal(g('core'), undefined); // 没有该序列
  /* 2026-08 缺数据：9 月的月变化不计算 */
  const j = blsJSON();
  j.Results.series[0].data = j.Results.series[0].data.filter(x => !(x.year == '2026' && x.period == 'M08'));
  assert.equal(
    E.blsData(j).find(x => x.k == 'nfp'),
    undefined
  );
  assert.throws(() => E.blsData({ status: 'REQUEST_NOT_PROCESSED', message: ['daily threshold'] }), /daily threshold/);
});

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>Gold hits record &amp; silver jumps - Reuters</title><link>https://news.example/a</link><pubDate>Sat, 24 Oct 2026 13:45:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
<item><title><![CDATA[美联储<b>降息</b>预期升温]]></title><link>https://news.example/b</link><pubDate>Sat, 24 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Gold Hits Record &amp; Silver Jumps</title><link>javascript:alert(1)</link><pubDate>Sat, 24 Oct 2026 11:00:00 GMT</pubDate></item>
<item><title>Old story</title><link>https://news.example/old</link><pubDate>Mon, 05 Oct 2026 11:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">&lt;i&gt;FOMC&lt;/i&gt; statement</title><link rel="alternate" href="https://fed.example/x?a=1&amp;b=2"/><updated>2026-10-24T18:00:00Z</updated></entry></feed>`;

test('parseFeed：RSS 与 Atom；去掉 CDATA / 标签 / 来源后缀，非 http 链接置空', () => {
  const r = E.parseFeed(RSS);
  assert.deepEqual(r[0], {
    title: 'Gold hits record & silver jumps',
    link: 'https://news.example/a',
    ts: Date.parse('2026-10-24T13:45:00Z'),
    source: 'Reuters',
  });
  assert.equal(r[1].title, '美联储 降息 预期升温');
  assert.equal(r[2].link, '');
  const a = E.parseFeed(ATOM);
  assert.deepEqual(
    [a[0].title, a[0].link, iso(a[0].ts)],
    ['FOMC statement', 'https://fed.example/x?a=1&b=2', '2026-10-24T18:00:00.000Z']
  );
});

test('parseFeeds：NEWS_FEEDS 名称|地址，只接受 http(s)', () => {
  assert.deepEqual(E.parseFeeds('FXStreet|https://a.example/rss, https://b.example/feed ,bad|ftp://x'), [
    { name: 'FXStreet', url: 'https://a.example/rss' },
    { name: 'https://b.example/feed', url: 'https://b.example/feed' },
  ]);
  assert.deepEqual(E.parseFeeds(''), []);
});

/* 假的上游：按 URL 返回样例，记录调用次数；fail 里的地址返回 503 */
function fakeFetch(map) {
  const calls = [],
    fail = new Set();
  const f = async (url, init) => {
    calls.push(url);
    const k = Object.keys(map).find(p => url.startsWith(p));
    if (!k || fail.has(k)) return { ok: false, status: 503, text: async () => '' };
    const v = typeof map[k] == 'function' ? map[k](init) : map[k];
    return { ok: true, status: 200, text: async () => (typeof v == 'string' ? v : JSON.stringify(v)) };
  };
  return { f, calls, fail };
}
const URLS = {
  ff: 'https://ff.test/week.json',
  ics: 'https://bls.test/bls.ics',
  bls: 'https://api.bls.test/v1/',
  fed: 'https://fed.test/press.xml',
  gnews: (q, lang) => `https://gn.test/${lang}?q=${encodeURIComponent(q)}`,
};

test('calendar：合并各来源、写入本地存储；缓存期内不重复拉取；上游失败时用已存数据并报告错误', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ev-'));
  let t = Date.parse('2026-10-25T08:00:00Z'),
    body = null;
  try {
    const up = fakeFetch({
      [URLS.ff]: FF,
      [URLS.ics]: ICS,
      [URLS.bls]: init => ((body = JSON.parse(init.body)), blsJSON()),
    });
    const ev = E.createEvents({ dir, fetchImpl: up.f, now: () => t, urls: URLS });
    const r = await ev.calendar();
    assert.ok(r.events.some(e => e.title == 'Non-Farm Employment Change' && e.conf == 'bls'));
    assert.ok(r.events.some(e => e.src == 'fed' && e.date == '2026-12-09'));
    assert.equal(r.data.items.find(x => x.k == 'nfp').val, 150);
    assert.deepEqual([body.startyear, body.endyear, body.registrationkey], ['2024', '2026', undefined]);
    assert.ok(
      r.sources.every(s => s.ok),
      JSON.stringify(r.sources)
    );
    assert.equal(up.calls.length, 3);
    assert.ok(fs.existsSync(path.join(dir, 'calendar.json')) && fs.existsSync(path.join(dir, 'bls.json')));

    t += 30 * 60e3; // 半小时后：都还在缓存期内
    await ev.calendar();
    assert.equal(up.calls.length, 3);

    t += 60 * 60e3; // FF 过期，但上游失败：仍返回已存事件，来源标为失败
    up.fail.add(URLS.ff);
    const r2 = await ev.calendar();
    assert.equal(up.calls.length, 4);
    assert.ok(r2.events.some(e => e.title == 'Federal Funds Rate'));
    const s = r2.sources.find(x => /Forex/.test(x.name));
    assert.equal(s.ok, false);
    assert.match(s.err, /503/);
    await ev.calendar(); // 失败后 10 分钟内不再重试
    assert.equal(up.calls.length, 4);

    /* 重启（新实例只能读磁盘）：缓存时间也恢复，不立即重拉 */
    const up2 = fakeFetch({ [URLS.ff]: FF, [URLS.ics]: ICS, [URLS.bls]: blsJSON() });
    const ev2 = E.createEvents({ dir, fetchImpl: up2.f, now: () => t, urls: URLS });
    const r3 = await ev2.calendar();
    assert.ok(r3.events.some(e => e.title == 'Unemployment Rate'));
    assert.deepEqual(up2.calls, [URLS.ff]); // 只有上次失败的 FF 到期重拉；BLS 日程和数据都还在缓存期
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('calendar：FF 本周日程改期时去掉旧条目；非农公布后 BLS 数据在 1 小时内每 10 分钟重查', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ev-'));
  let t = Date.parse('2026-11-06T12:00:00Z'),
    ff = FF;
  try {
    const up = fakeFetch({ [URLS.ff]: () => ff, [URLS.ics]: ICS, [URLS.bls]: blsJSON() });
    const ev = E.createEvents({ dir, fetchImpl: up.f, now: () => t, urls: URLS });
    await ev.calendar();
    ff = FF.map(e => (e.title == 'Unemployment Rate' ? { ...e, date: '2026-11-06T09:00:00-05:00' } : e));
    t += 61 * 60e3; // 13:01Z，FF 过期重拉
    const r = await ev.calendar();
    const un = r.events.filter(e => e.title == 'Unemployment Rate');
    assert.deepEqual(
      un.map(e => iso(e.ts)),
      ['2026-11-06T14:00:00.000Z']
    );
    const n = () => up.calls.filter(u => u == URLS.bls).length;
    assert.equal(n(), 1);
    t = Date.parse('2026-11-06T13:33:00Z'); // 非农 13:30Z 公布后 3 分钟
    await ev.calendar();
    assert.equal(n(), 2);
    t += 5 * 60e3;
    await ev.calendar();
    assert.equal(n(), 2); // 不到 10 分钟
    t += 6 * 60e3;
    await ev.calendar();
    assert.equal(n(), 3);
    t = Date.parse('2026-11-06T15:00:00Z'); // 改到 14:00Z 的失业率公布后，再查一次
    await ev.calendar();
    assert.equal(n(), 4);
    t += 20 * 60e3; // 最后一次公布已过 1 小时：回到 12 小时一次
    await ev.calendar();
    assert.equal(n(), 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('news：主题 × 语言、去重、过滤 7 天前、标签；单个来源失败不影响其他来源', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-ev-'));
  const t = Date.parse('2026-10-25T08:00:00Z');
  try {
    const up = fakeFetch({ 'https://gn.test/zh': RSS, [URLS.fed]: ATOM });
    up.fail.add(URLS.fed);
    const ev = E.createEvents({
      dir,
      fetchImpl: up.f,
      now: () => t,
      urls: URLS,
      feeds: [{ name: '自定义', url: 'https://gn.test/zh-extra' }],
    });
    const r = await ev.news('gold', 'zh');
    assert.equal(up.calls[0], 'https://gn.test/zh?q=' + encodeURIComponent(E.TOPIC.gold.zh));
    assert.deepEqual(
      r.items.map(x => [x.title, x.source, x.tags.join()]),
      [
        ['Gold hits record & silver jumps', 'Reuters', '黄金'],
        ['美联储 降息 预期升温', 'Google 新闻', '美联储'],
      ]
    );
    assert.deepEqual(
      r.sources.map(s => [s.name, s.ok]),
      [
        ['Google 新闻', true],
        ['美联储新闻稿', false],
        ['自定义', true],
      ]
    );
    await assert.rejects(ev.news('evil', 'zh'), /无效/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
