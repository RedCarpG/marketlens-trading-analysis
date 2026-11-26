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

module.exports = { SRC, FILES, API, VERSION };
