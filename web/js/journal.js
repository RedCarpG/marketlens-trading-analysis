/* 交易日记、我的守则、开仓体检（页面部分）。判定在 core/rules.js，复盘在 core/review.js。
   存在哪：经本地代理打开时存在本机 var/journal.json（/api/journal）；公开演示页没有代理，存在浏览器本地。
   守则和日记都是你自己写的东西：不发给任何上游。体检结果里只有“新开仓时那一句”会交给 Cirra，而且要你在预警页勾上（默认关）。 */
const MOODS = { calm: '平静', confident: '有把握', excited: '兴奋', rushed: '着急', afraid: '害怕', hesitant: '犹豫', bored: '无聊', revenge: '想扳回来' };
const JN_TAGS = ['计划内', '追单', '试仓', '加仓', '新闻驱动', '凭感觉', '止损后再进'];
/* JN：rules 我的守则；notes 日记 { "品种|交易号": { why, tags, mood, at } }；err 上一次存、取出的问题 */
let JN = { rules: normRules(LOCAL ? null : LS.get('rules', null)), notes: LOCAL ? {} : LS.get('notes', {}), err: null },
  /* CHK：体检结果的缓存（重算一笔要重跑各周期的分析，实时刷新时不能每次都算） */
  CHK = {},
  /* JD：打开着的对话框 { view: 'rules' | 'note', t 交易, key } */
  JD = null;
const jnKey = t => cur.sym + '|' + t.id;
const jnNote = t => JN.notes[jnKey(t)] || null;
const jnHasRules = () => activeRules(JN.rules).length + JN.rules.custom.length > 0;

async function jnApi(body) {
  const r = await fetch('/api/journal', body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
async function loadJournal() {
  if (!LOCAL) return;
  try {
    const j = await jnApi();
    JN = { rules: normRules(j.rules), notes: j.notes || {}, err: null };
  } catch (e) {
    JN.err = '日记和守则没取到：' + e.message;
  }
  CHK = {};
  if (bars.length) refresh();
}
async function saveRules(rules) {
  JN.rules = normRules(rules);
  CHK = {};
  try {
    if (LOCAL) JN.rules = normRules((await jnApi({ rules: JN.rules })).rules);
    else LS.set('rules', JN.rules);
    JN.err = null;
  } catch (e) {
    JN.err = '守则没存上：' + e.message;
  }
  if (bars.length) refresh();
}
async function saveNote(t, note) {
  const key = jnKey(t),
    has = note && (note.why.trim() || note.tags.length || note.mood);
  try {
    if (LOCAL) {
      const saved = (await jnApi({ key, note: has ? note : null })).note;
      if (saved) JN.notes[key] = saved;
      else delete JN.notes[key];
    } else {
      if (has) JN.notes[key] = { ...note, at: Date.now() };
      else delete JN.notes[key];
      LS.set('notes', JN.notes);
    }
    JN.err = null;
  } catch (e) {
    JN.err = '日记没存上：' + e.message;
  }
  if (bars.length) refresh();
}

/* 一笔交易的体检：{ rv, res }。K线、守则、止损、交易记录、日历变了才重算 */
function tradeCheck(t) {
  if (!TR || TR.sym !== cur.sym) return null;
  const k = jnKey(t),
    sig = [t.sl, t.closeTs || '', TR.at, EV && EV.at, ...TFS.map(f => (ALL[f] ? ALL[f].length : 0))].join('|');
  if (!CHK[k] || CHK[k].sig !== sig) {
    const rv = reviewTrade(t, ALL);
    CHK[k] = { sig, rv, res: checkRules(rv, JN.rules, { events: EV && EV.events, ccy: ccyOf(), trades: [...TR.closed, ...TR.open] }) };
  }
  return CHK[k];
}
/* 持仓那一行下面的体检一行；点它打开这笔的日记（里面有逐条结果） */
function chkLine(t) {
  if (!jnHasRules()) return `<div class="ckl mu sm" data-jn-rules title="定几条自己的规矩，开仓时逐条对照">体检：还没有守则，点这里定几条</div>`;
  const c = tradeCheck(t);
  if (!c) return '';
  const { res } = c,
    bad = res.items.filter(i => i.ok === false),
    tip = 'title="点开看逐条结果，顺手写日记"';
  if (bad.length) return `<div class="ckl bad sm" ${tip}>体检：${bad.length} 条没守 · ${bad.map(i => esc(i.text.replace(/（.*?）/g, ''))).join('；')}</div>`;
  if (res.kept) return `<div class="ckl good sm" ${tip}>体检：${res.kept} 条都守住了${res.unknown ? `，${res.unknown} 条判断不了` : ''}</div>`;
  if (res.unknown) return `<div class="ckl mu sm" ${tip}>体检：${res.unknown} 条判断不了（${esc(res.items[0].note)}）</div>`;
  return `<div class="ckl mu sm" ${tip}>体检：只有自己写的 ${res.custom.length} 条，要你自己核对</div>`;
}
/* 交易行右侧的日记按钮和标签 */
function jnMark(t) {
  const n = jnNote(t);
  return `<div class="jnr">${n ? n.tags.map(g => `<span class="jtag">${esc(g)}</span>`).join('') + (n.mood ? `<span class="jtag m">${MOODS[n.mood]}</span>` : '') : ''}<button class="jnb${n ? ' on' : ''}" data-jn title="${n && n.why ? esc(n.why) : '写这笔的日记：为什么开、当时的心情'}">✎</button></div>`;
}

/* ===== 新开仓：体检结果当场说一声 =====
   代理每分钟看一次当前持仓（页面在后台标签页也看）。第一次见到这个品种时只记下已有的持仓；之后多出来的、6 小时内开的才说。
   只在预警总开关和“开仓体检”都开着时弹出（和别的预警一样走 alFire，再按 Cirra 的勾选决定交不交给她） */
let ckSeen = LS.get('ckseen', {});
function checkNewPositions() {
  if (!TR || TR.sym !== cur.sym || TR.err || TR.demo) return;
  const ids = TR.open.map(p => String(p.id)),
    seen = ckSeen[cur.sym];
  if (seen && ids.every(i => seen.includes(i))) return;
  const fresh = seen ? TR.open.filter(p => !seen.includes(String(p.id))) : [];
  ckSeen[cur.sym] = [...new Set([...(seen || []), ...ids])].slice(-100);
  LS.set('ckseen', ckSeen);
  for (const p of fresh) {
    if (Date.now() - p.openTs > 6 * 36e5 || !AL.on || !AL.ck) continue;
    const c = tradeCheck(p),
      s = c && checkSay(ciName(), p.isBuy, c.res);
    if (s) alFire(s.text, s.kind, s.say, s.ck);
  }
}
async function pollPositions() {
  if (!LOCAL || TRL || !TR || TR.demo || TR.err || TR.sym !== cur.sym || !(cur.srcs && cur.srcs.etoro)) return;
  const sym = cur.sym;
  try {
    const r = await fetch(`/api/etoro/positions?symbol=${cur.srcs.etoro}`);
    if (!r.ok) return;
    const open = await r.json();
    if (cur.sym !== sym || !TR || TR.sym !== sym) return;
    const changed = JSON.stringify(open.map(p => [p.id, p.sl, p.tp])) != JSON.stringify(TR.open.map(p => [p.id, p.sl, p.tp]));
    TR.open = open;
    if (changed) TR.at = Date.now();
    if (bars.length) refresh();
    checkNewPositions();
  } catch (_) {}
}
if (LOCAL) setInterval(pollPositions, 60e3);

/* ===== 对话框：我的守则 / 一笔交易的日记（独立于右侧面板，面板刷新时不会打断输入） ===== */
function jnOpen(view, t) {
  let el = $('#jnm');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jnm';
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const q = s => e.target.closest(s);
      if (e.target === el || q('[data-jn-close]')) return jnClose();
      if (q('[data-jn-save]')) return jnSave();
      if (q('[data-jn-del]')) return saveNote(JD.t, null).then(jnClose);
      if (q('[data-jn-torules]')) return jnOpen('rules');
      const g = q('[data-jtag]');
      if (g) g.classList.toggle('on');
    });
    document.addEventListener('keydown', e => e.key === 'Escape' && jnClose());
  }
  JD = { view, t };
  el.innerHTML = view == 'rules' ? jnRulesHtml() : jnNoteHtml(t);
  void el.offsetWidth;
  el.classList.add('open');
  const first = el.querySelector(view == 'rules' ? 'input' : 'textarea');
  if (first) first.focus({ preventScroll: true });
}
function jnClose() {
  const el = $('#jnm');
  if (el) el.classList.remove('open');
  JD = null;
}
function jnRulesHtml() {
  const R = JN.rules,
    row = d => {
      const txt = esc(d.text).replace(
        '{n}',
        d.n == null ? '' : `<input type="number" class="jnn" data-rn="${d.id}" value="${R.n[d.id]}" min="${d.min}" max="${d.max}" step="${d.step}">`
      );
      /* 带数字框的那几条不用 label 包：label 会把点击交给里面第一个输入框（数字框），勾选框反而点不到 */
      const tag = d.n == null ? 'label' : 'div';
      return `<${tag} class="opt"><span class="ot">${txt}</span><input type="checkbox" class="sw" data-ron="${d.id}"${R.on[d.id] ? ' checked' : ''} aria-label="${esc(ruleText(d, R.n[d.id]))}"></${tag}>`;
    };
  return `<div class="rvp jnp"><div class="rvh"><b>我的守则</b><button data-jn-close>✕</button></div>
<div class="mu sm">你自己定的规矩。勾上的几条，每次开仓会逐条对照（交易页“当前持仓”下面的“体检”），复盘里统计每条没守时的结果。这里不替你定规矩：这些只是常见的写法，勾不勾、数填多少都由你。</div>
<div class="opts jno">${RULE_DEFS.map(row).join('')}</div>
<div class="lbl">自己写的（一行一条，最多 ${RULE_LIMIT.custom} 条；没法自动判断，体检时列出来让你自己核对）</div>
<textarea class="jnt" data-rcustom rows="4" maxlength="800" placeholder="比如：睡前不开新仓">${esc(R.custom.join('\n'))}</textarea>
<div class="mu sm">${LOCAL ? '存在本机的 var/journal.json，不上传。' : '演示页没有本地代理，存在这个浏览器里。'}“大周期”“关键价位”“ATR”都按开仓那一刻之前已收盘的K线重算，和复盘用的是同一套。</div>
<div class="jnf"><span class="sp"></span><button class="chip" data-jn-close>取消</button><button class="chip on" data-jn-save>保存</button></div></div>`;
}
function jnNoteHtml(t) {
  const n = jnNote(t) || { why: '', tags: [], mood: '' },
    f = v => v.toFixed(cur.p),
    c = tradeCheck(t),
    tags = [...new Set([...JN_TAGS, ...n.tags])],
    item = i =>
      `<div class="cki ${i.ok === false ? 'bad' : i.ok ? 'good' : 'na'}"><span>${i.ok === false ? '✕' : i.ok ? '✓' : '?'}</span><div>${esc(i.text)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</div></div>`,
    chk = !jnHasRules()
      ? `<div class="mu sm">还没有守则。<a data-jn-torules>定几条</a>以后，这里逐条对照。</div>`
      : c
        ? c.res.items.map(item).join('') + c.res.custom.map(s => `<div class="cki na"><span>·</span><div>${esc(s)}<small>自己写的，自己核对</small></div></div>`).join('')
        : '';
  return `<div class="rvp jnp"><div class="rvh"><b>交易日记 · ${esc(cur.sym)}</b><button data-jn-close>✕</button></div>
<div class="sm"><span style="color:var(${t.isBuy ? '--tb' : '--ts'})">${t.isBuy ? '▲ 买' : '▼ 卖'}</span> ${f(t.openRate)}${t.closeRate != null ? ' → ' + f(t.closeRate) : '（持仓中）'} · ${fmt('1h', t.openTs)}${TR && TR.demo ? ' · <span class="mu">模拟交易</span>' : ''}</div>
<div class="lbl">开仓体检</div><div class="ckb">${chk}</div>
<div class="lbl">为什么开这一笔</div>
<textarea class="jnt" data-nwhy rows="4" maxlength="500" placeholder="当时看到了什么、打算在哪里认错">${esc(n.why)}</textarea>
<div class="lbl">标签</div><div class="jtags">${tags.map(g => `<button class="jtag${n.tags.includes(g) ? ' on' : ''}" data-jtag="${esc(g)}">${esc(g)}</button>`).join('')}
<input class="jni" data-nmore maxlength="60" placeholder="别的标签，空格隔开"></div>
<div class="lbl">当时的心情</div><div class="jtags">${Object.entries(MOODS)
    .map(([k, v]) => `<label class="jmood"><input type="radio" name="jmood" value="${k}"${n.mood == k ? ' checked' : ''}>${v}</label>`)
    .join('')}<label class="jmood"><input type="radio" name="jmood" value=""${n.mood ? '' : ' checked'}>不填</label></div>
<div class="jnf">${jnNote(t) ? '<button class="chip" data-jn-del>删掉这条</button>' : ''}<span class="sp"></span><button class="chip" data-jn-close>取消</button><button class="chip on" data-jn-save>保存</button></div></div>`;
}
function jnSave() {
  const el = $('#jnm');
  if (!JD || !el) return;
  if (JD.view == 'rules') {
    const r = { on: {}, n: {}, custom: el.querySelector('[data-rcustom]').value.split('\n') };
    el.querySelectorAll('[data-ron]').forEach(c => (r.on[c.dataset.ron] = c.checked ? 1 : 0));
    el.querySelectorAll('[data-rn]').forEach(c => (r.n[c.dataset.rn] = +c.value));
    saveRules(r).then(jnClose);
    return;
  }
  const more = el.querySelector('[data-nmore]').value.split(/\s+/).filter(Boolean),
    mood = el.querySelector('input[name="jmood"]:checked');
  saveNote(JD.t, {
    why: el.querySelector('[data-nwhy]').value,
    tags: [...new Set([...[...el.querySelectorAll('[data-jtag].on')].map(b => b.dataset.jtag), ...more])],
    mood: mood ? mood.value : '',
  }).then(jnClose);
}
