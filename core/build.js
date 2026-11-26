'use strict';
/* 打包 marketlens-core。两个入口：
   1. 计算（marketlens-core）：把 web/js/core/ 的脚本按 files.js 的顺序拼成一个文件，末尾补上导出。
      出两份内容相同的：dist/index.mjs（import 用）和 dist/index.cjs（require 用）。
   2. 取数（marketlens-core/data，0.2.0 起）：本地代理用的 server/yahoo.js、server/events.js 原样复制成
      dist/data/*.cjs，再加一个只导出对外名字的 dist/data/index.cjs。
   源码都不用改，页面照旧直接加载那些脚本、代理照旧 require 那两个模块，都不需要构建；
   这一步只在要把它们交给别的程序（Cirra 插件）时才跑。
     node core/build.js          生成 core/dist/
     npm run pack:core           生成后打成 core/marketlens-core-<版本>.tgz
   模块里是严格模式，和页面的普通脚本略有不同；tests/corepkg.test.js 核对两边算出来的结果一致。 */
const fs = require('fs');
const path = require('path');
const { SRC, FILES, API, VERSION, DATA_SRC, DATA_FILES, DATA_API } = require('./files');

const lf = s => s.replace(/^﻿/, '').replace(/\r\n/g, '\n');
const head = `/* marketlens-core ${VERSION}：由 core/build.js 生成，不要手改 */`;

function bundle() {
  const body = FILES.map(f => `/* ---- ${f}.js ---- */\n${lf(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8')).trimEnd()}`).join('\n\n');
  const tail = `const CORE_VERSION = ${JSON.stringify(VERSION)};`;
  return {
    'index.mjs': `${head}\n${body}\n\n${tail}\nexport { ${API.join(', ')}, CORE_VERSION as VERSION };\n`,
    'index.cjs': `'use strict';\n${head}\n${body}\n\n${tail}\nmodule.exports = { ${API.join(', ')}, VERSION: CORE_VERSION };\n`,
  };
}

/* 取数的那几个文件：模块之间没有互相引用，只引 Node 自带的；有别的 require 就报错，免得打出一个装上跑不起来的包 */
function dataFiles() {
  const out = {};
  for (const f of DATA_FILES) {
    const src = lf(fs.readFileSync(path.join(DATA_SRC, f + '.js'), 'utf8'));
    const odd = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]).filter(m => !['fs', 'path'].includes(m));
    if (odd.length) throw new Error(`server/${f}.js 引用了 ${odd.join('、')}：取数的模块只能用 Node 自带的 fs / path`);
    out[`data/${f}.cjs`] = `${head}\n${src}`;
  }
  const lines = DATA_FILES.map(f => `const { ${DATA_API[f].join(', ')} } = require('./${f}.cjs');`);
  /* 导出写成 { 名字, 名字 } 的样子：Node 用 import 加载 CJS 时靠这个认出有哪些名字 */
  out['data/index.cjs'] = `'use strict';\n${head}\n${lines.join('\n')}\nconst VERSION = ${JSON.stringify(VERSION)};\nmodule.exports = { ${DATA_FILES.flatMap(f => DATA_API[f]).join(', ')}, VERSION };\n`;
  return out;
}

function build(out = path.join(__dirname, 'dist')) {
  const files = { ...bundle(), ...dataFiles() };
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(out, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return Object.keys(files).map(name => path.join(out, name));
}

if (require.main === module) {
  for (const f of build()) console.log(`${path.relative(process.cwd(), f)}  ${(fs.statSync(f).size / 1024).toFixed(1)} KB`);
}

module.exports = { build, bundle, dataFiles };
