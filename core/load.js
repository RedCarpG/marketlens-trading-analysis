'use strict';
/* 不用构建、直接从源码加载核心计算：在 Node 的 vm 里按浏览器同样的顺序跑 web/js/core/ 下的脚本
   （普通 <script>，共享全局作用域），返回 get(name) 用来取出其中定义的函数和常量。
   本地代理、命令行工具、测试都用它；发给别的程序用的是 build.js 打出来的包。
   now：把 Date.now 固定在某一刻（closed() 等依赖当前时间），测试用。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { SRC, FILES } = require('./files');

function loadCore(now) {
  const ctx = vm.createContext({ console, Math, JSON });
  if (now != null) vm.runInContext(`Date.now = () => ${now};`, ctx);
  for (const f of FILES) {
    const file = path.join(SRC, f + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  }
  return name => vm.runInContext(name, ctx);
}

module.exports = { loadCore };
