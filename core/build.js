'use strict';
/* 打包 marketlens-core：把 web/js/core/ 的脚本按 files.js 的顺序拼成一个文件，末尾补上导出。
   出两份内容相同的：dist/index.mjs（import 用）和 dist/index.cjs（require 用）。
   源码不用改，页面照旧直接加载那些脚本、不需要构建；这一步只在要把核心计算交给别的程序（Cirra 插件）时才跑。
     node core/build.js          生成 core/dist/
     npm run pack:core           生成后打成 core/marketlens-core-<版本>.tgz
   模块里是严格模式，和页面的普通脚本略有不同；tests/corepkg.test.js 核对两边算出来的结果一致。 */
const fs = require('fs');
const path = require('path');
const { SRC, FILES, API, VERSION } = require('./files');

function bundle() {
  const body = FILES.map(f => {
    const src = fs.readFileSync(path.join(SRC, f + '.js'), 'utf8');
    return `/* ---- ${f}.js ---- */\n${src.replace(/^﻿/, '').replace(/\r\n/g, '\n').trimEnd()}`;
  }).join('\n\n');
  const head = `/* marketlens-core ${VERSION}：由 core/build.js 从 web/js/core/ 生成，不要手改 */`;
  const tail = `const CORE_VERSION = ${JSON.stringify(VERSION)};`;
  return {
    'index.mjs': `${head}\n${body}\n\n${tail}\nexport { ${API.join(', ')}, CORE_VERSION as VERSION };\n`,
    'index.cjs': `'use strict';\n${head}\n${body}\n\n${tail}\nmodule.exports = { ${API.join(', ')}, VERSION: CORE_VERSION };\n`,
  };
}

function build(out = path.join(__dirname, 'dist')) {
  fs.mkdirSync(out, { recursive: true });
  const files = bundle();
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(out, name), text);
  return Object.keys(files).map(name => path.join(out, name));
}

if (require.main === module) {
  for (const f of build()) console.log(`${path.relative(process.cwd(), f)}  ${(fs.statSync(f).size / 1024).toFixed(1)} KB`);
}

module.exports = { build, bundle };
