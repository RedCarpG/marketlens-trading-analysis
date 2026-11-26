/* 价格预警与弹出提示 */
/* ===== 预警接口（下一步实现）：Alerts.register(fn) 注册通知渠道，新信号出现在最新已收盘K线时触发 ===== */
const Alerts = {
  rules: [],
  notifiers: [],
  register(f) {
    this.notifiers.push(f);
  },
  emit(sig, ctx) {
    this.notifiers.forEach(f => {
      try {
        f(sig, ctx);
      } catch (e) {
        console.error(e);
      }
    });
  },
};
Alerts.register((s, c) => console.log('[signal]', c.symbol, c.tf, s.t));
/* ===== 价格预警：关键价位 / 情景触发与失效 / 接近我的止损止盈（重要经济事件的提醒在 events.js，共用这里的布防与发出） =====
   只监控当前品种和周期，需页面保持打开；开启时自动连接实时行情。每次刷新（实时推送约每 300ms 一次）检查一遍。
   去重：每个提醒有“布防”状态——第一次见到时若已在触发范围内则不提醒（作为基准），触发后要离开足够远才重新布防；
   切换品种/周期时清空状态重新建立基准，避免一打开就被历史状态刷屏 */
/* ck：开仓体检（新开一笔时对照我的守则，见 journal.js 的 checkNewPositions）；ml：我画的线 */
let AL = { on: 0, lv: 1, sc: 1, sl: 1, ev: 1, ck: 1, ml: 1, ...LS.get('alerts', {}) },
  alLog = [],
  alArm = {},
  alSc = null,
  alKey = '';
function alArmCheck(k, near, far, msg, kind, say) {
  if (armStep(alArm, k, near, far)) alFire(msg, kind, say);
}
function evalAlerts(m) {
  if (!AL.on || !m || cur.src == 'csv' || !bars.length) return;
  const now = bars[bars.length - 1].close,
    x = m.t.a.a,
    f = v => v.toFixed(cur.p),
    key = cur.sym + '|' + tf;
  if (alKey !== key) {
    alKey = key;
    alArm = {};
    alSc = null;
  }
  /* 关键价位和情景：判定和句子与代理的常驻预警共用（core/alertrules.js） */
  const st = { arm: alArm, sc: alSc };
  alCheck(m, tf, now, st, { lv: AL.lv, sc: AL.sc, dp: cur.p }).forEach(h => {
    const s = alText(h, { sym: cur.sym, name: ciName(), T: tf, px: now, dp: cur.p });
    alFire(s.text, s.kind, s.say, s.ck);
  });
  alSc = st.sc;
  /* 我画的线：和关键价位同一套布防（进入 ±0.15 ATR 提醒，离开 0.5 ATR 后重新布防），交给 Cirra 时也归到关键价位 */
  if (AL.ml)
    lineCheck(myLines(), now, x, alArm).forEach(l => {
      const s = lineText(l, { sym: cur.sym, name: ciName(), T: tf, px: now, dp: cur.p });
      alFire(s.text, s.kind, s.say, s.ck);
    });
  /* 我的止损/止盈：进入 0.5 ATR 提醒，离开 1 ATR 后重新布防 */
  if (AL.sl && TR && TR.sym === cur.sym)
    TR.open.forEach(p =>
      [
        [p.sl, '止损'],
        [p.tp, '止盈'],
      ].forEach(([v, n]) => {
        if (!(v > 0) || Math.abs(v - now) / now > 0.3) return;
        const d = Math.abs(now - v),
          pl = (v - p.openRate) * (p.isBuy ? 1 : -1) * p.units;
        alArmCheck(
          'sl|' + p.id + '|' + n,
          d <= x * 0.5,
          d >= x,
          `${cur.sym} 价格 ${f(now)} 接近我的${n} ${f(v)}（相距 ${(d / x).toFixed(1)} ATR，触及约 ${money(pl)}）`,
          n == '止损' ? 'dn' : 'up',
          `${ciName()} 离你的${n} ${f(v)} 只差 ${(d / x).toFixed(1)} 个 ATR`
        );
      })
    );
}
/* 发出提醒：页面右下角弹出提示 + 系统通知（已授权时）+ 记入最近预警 + 交给桌宠 Cirra（勾选了这一类时，见 cirra.js）；
   不在预警页时“预警”标签计未读。say 为给 Cirra 念的短句（没有时念 text），ck 为交给她的类型（决定表情，默认同 kind） */
function alFire(text, kind, say, ck = kind) {
  alLog.unshift({ t: Date.now(), text, kind });
  alLog = alLog.slice(0, 20);
  if (TAB != 'al') alNew++;
  toast(text, kind);
  if ('Notification' in window && Notification.permission === 'granted')
    try {
      new Notification('MarketLens 预警', { body: text, tag: text });
    } catch (_) {}
  cirraSay(say || text, ck);
}
function toast(text, kind) {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  /* 滑入；点击或 10 秒后先淡出再移除 */
  const el = document.createElement('div'),
    bye = () => {
      if (el.classList.contains('out')) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    };
  el.className = 'toast t-' + kind;
  el.textContent = text;
  el.onclick = bye;
  box.prepend(el);
  setTimeout(bye, 10000);
}
/* 开关预警：开启时申请通知权限（必须在点击里调用），并自动打开实时行情 */
async function setAlertsOn(v) {
  AL.on = v ? 1 : 0;
  LS.set('alerts', AL);
  alKey = '';
  if (v) {
    if ('Notification' in window && Notification.permission === 'default')
      try {
        await Notification.requestPermission();
      } catch (_) {}
    if (!live && AD[cur.src] && AD[cur.src].subscribe) $('#lv').click();
  }
  refresh();
}

function alRedraw() {
  if (typeof pane == 'function' && pane('al')) morph(pane('al'), alPanel());
}

/* ===== 我画的线 =====
   用户自己定的价位线，按品种存在浏览器本地（marketlens.mylines：{ 品种: [{ id, p, t }] }），换周期也在；图上由 drawMarks 画出来。
   加线：预警页输入价格，或者点“在图上点”以后在K线图上点一下（按住 Alt 点图也行）；删：预警页那一行的 ✕。
   到价的判定和句子在 core/alertlog.js，由上面的 evalAlerts 发出 */
let MLN = LS.get('mylines', {}),
  mlPick = 0;
if (!MLN || typeof MLN != 'object' || Array.isArray(MLN)) MLN = {};
const myLines = () => normLines(MLN[cur.sym]);
function mlSave(lines) {
  if (lines.length) MLN[cur.sym] = lines;
  else delete MLN[cur.sym];
  LS.set('mylines', MLN);
  refresh();
}
function mlAdd(p) {
  const r = addLine(myLines(), p, Date.now(), cur.p);
  if (!r.added) return toast(r.reason, 'ml'), false;
  mlSave(r.lines);
  return true;
}
function mlDel(id) {
  delete alArm['ml|' + id];
  mlSave(myLines().filter(l => l.id != id));
}
/* 输入框里的价格（预警页）：加上了就清空输入框 */
function mlAddInput() {
  const el = $('#mlp');
  if (el && el.value.trim() !== '' && mlAdd(el.value)) el.value = '';
  else if (el) el.focus();
}
/* 进 / 出“在图上点一下”：鼠标变十字，顶上一条提示；窄屏时把K线图滚到眼前 */
function mlPickOn(v) {
  mlPick = v && bars.length && cur.src != 'csv' ? 1 : 0;
  document.body.classList.toggle('mlpick', !!mlPick);
  let h = $('#mlh');
  if (mlPick && !h) {
    h = document.createElement('div');
    h.id = 'mlh';
    h.className = 'glass';
    h.innerHTML = '在K线图上点一下，就在那个价位加一条线<button title="不加了（Esc）">取消</button>';
    h.querySelector('button').onclick = () => mlPickOn(0);
    document.body.appendChild(h);
  }
  if (h) h.hidden = !mlPick;
  if (mlPick && !WIDE()) $('#chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
  alRedraw();
}
/* 图上点一下：在捕获阶段先接住（比 app.js 里“点空白取消选中”早），只认主图范围内、没有拖动的点击 */
document.addEventListener(
  'click',
  e => {
    if (!(mlPick || e.altKey) || !e.target.closest || !e.target.closest('#chart')) return;
    if (!chart || !bars.length || cur.src == 'csv') return;
    if (downXY && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4) return;
    const r = $('#chart').getBoundingClientRect(),
      sz = chart.getSize('candle_pane'),
      y = e.clientY - r.top - sz.top;
    if (y < 0 || y > sz.height) return;
    e.stopPropagation();
    const pt = chart.convertFromPixel([{ x: e.clientX - r.left, y }], { paneId: 'candle_pane' })[0];
    if (pt && pt.value > 0) mlAdd(pt.value);
    mlPickOn(0);
  },
  true
);
document.addEventListener(
  'keydown',
  e => {
    if (e.key != 'Escape' || !mlPick) return;
    e.stopImmediatePropagation();
    mlPickOn(0);
  },
  true
);
