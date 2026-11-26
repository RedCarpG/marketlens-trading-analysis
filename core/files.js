'use strict';
/* marketlens-core 的清单：源码在哪、按什么顺序加载、包对外给出哪些名字。
   源码就是页面用的 web/js/core/（普通脚本，共用全局作用域，没有 import / export），这里不复制一份。 */
const path = require('path');

const SRC = path.join(__dirname, '..', 'web', 'js', 'core');
/* 加载顺序（后面的用到前面的）。页面 web/index.html 用到的 core 脚本都要在这份清单里，tests/corepkg.test.js 会核对；
   summary.js 只给页面以外的调用方用，页面没有加载它 */
const FILES = [
  'time',
  'indicators',
  'levels',
  'mtf',
  'scenarios',
  'alertrules',
  'context',
  'review',
  'rules',
  'money',
  'demo',
  'backtest',
  'aipack',
  'aiscore',
  'summary',
];
/* 包对外的接口（core/index.d.ts 里有类型和说明）。加名字升小版本；改、删已有的升大版本 */
const API = [
  // 周期与时间
  'TFS',
  'TFN',
  'nxt',
  'closed',
  // 分析
  'ctx',
  'analyzeMTF',
  'analyzeCandles',
  'prevHL',
  'isKey',
  'mainLv',
  // 给 AI 和语音的文字
  'describeState',
  'buildPack',
  'packPrompt',
  // 预警的判定与句子
  'alCheck',
  'alText',
  // AI 分析记录的打分
  'scoreAi',
  'aiStats',
];
const VERSION = require('./package.json').version;

/* 第二个入口 marketlens-core/data：取数（0.2.0 起）。就是本地代理用的那两个模块，原样放进包里：
   Yahoo 的K线和最新价、经济日历与新闻（Forex Factory、BLS、美联储、Google 新闻）。它们只依赖 Node 自带的 fs / path 和 fetch，
   请求函数可以换掉，日历的缓存目录由调用方给。对外的名字和类型在 core/data.d.ts。 */
const DATA_SRC = path.join(__dirname, '..', 'server');
const DATA_FILES = ['yahoo', 'events'];
const DATA_API = { yahoo: ['createYahoo'], events: ['createEvents', 'parseFeeds', 'TOPIC', 'LANGS'] };

module.exports = { SRC, FILES, API, VERSION, DATA_SRC, DATA_FILES, DATA_API };
