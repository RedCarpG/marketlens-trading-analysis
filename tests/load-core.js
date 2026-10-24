// 在 Node 的 vm 里按浏览器同样的顺序加载 web/js/core/ 下的纯计算脚本（普通 <script>，共享全局作用域），
// 返回 get(name) 用来取出其中定义的函数和常量。now 用于固定 Date.now（closed() 等依赖当前时间）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = ['time', 'indicators', 'levels', 'mtf', 'scenarios', 'review', 'demo'].map(f =>
  path.join(__dirname, '..', 'web', 'js', 'core', f + '.js')
);

function loadCore(now) {
  const ctx = vm.createContext({ console, Math, JSON });
  if (now != null) vm.runInContext(`Date.now = () => ${now};`, ctx);
  for (const f of CORE) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: f });
  return name => vm.runInContext(name, ctx);
}

module.exports = { loadCore };
