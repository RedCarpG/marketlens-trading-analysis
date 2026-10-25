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
let AL = { on: 0, lv: 1, sc: 1, sl: 1, ev: 1, ...LS.get('alerts', {}) },
  alLog = [],
  alArm = {},
  alSc = null,
  alKey = '';
function alArmCheck(k, near, far, msg, kind) {
  if (!(k in alArm)) {
    alArm[k] = !near;
    return;
  }
  if (alArm[k] && near) {
    alArm[k] = false;
    alFire(msg, kind);
  } else if (!alArm[k] && far) alArm[k] = true;
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
  /* 关键价位：所有关键价位（isKey，不只图上画的每侧 3 条——价格移动后显示的那几条会变，只看它们会漏掉“重新布防”）
   进入 ±0.15 ATR 提醒，离开 0.5 ATR 后重新布防 */
  if (AL.lv) {
    m.L.filter(l => isKey(l, tf)).forEach(l => {
      const d = Math.abs(now - l.p);
      alArmCheck(
        'lv|' + l.p.toFixed(cur.p),
        d <= x * 0.15,
        d >= x * 0.5,
        `${cur.sym} ${tf} 价格 ${f(now)} 到达${l.p < now ? '支撑' : '阻力'} ${f(l.p)}（${l.tfs.join('·')}${l.touch >= 3 ? ` · 挡回${l.touch}次` : ''}）`,
        'lv'
      );
    });
  }
  /* 情景：新出现的“已触发”，以及已触发 → 失效/已到目标/被反向触发取代 */
  if (AL.sc) {
    const cur2 = {};
    m.sc
      .flatMap(c => c.trigs)
      .forEach(g => {
        const k = g.kind + '|' + g.dir + '|' + g.ts;
        cur2[k] = g.state;
        if (!alSc) return;
        const p = alSc[k],
          dn = g.kind + (g.dir > 0 ? '做多' : '做空');
        if (!p && g.state == '已触发')
          alFire(
            `${cur.sym} ${tf} 情景触发：${dn}，入场 ${f(g.entry)} / 止损 ${f(g.stop)} / 目标 ${f(g.tgt)}（1:${g.rr.toFixed(1)}）`,
            'sc'
          );
        else if (p == '已触发' && g.state != '已触发')
          alFire(`${cur.sym} ${tf} 情景${g.state}：${dn}（入场 ${f(g.entry)}）`, 'sc');
      });
    alSc = cur2;
  }
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
          n == '止损' ? 'dn' : 'up'
        );
      })
    );
}
/* 发出提醒：页面右下角弹出提示 + 系统通知（已授权时）+ 记入最近预警；不在预警页时“预警”标签计未读 */
function alFire(text, kind) {
  alLog.unshift({ t: Date.now(), text, kind });
  alLog = alLog.slice(0, 20);
  if (TAB != 'al') alNew++;
  toast(text, kind);
  if ('Notification' in window && Notification.permission === 'granted')
    try {
      new Notification('MarketLens 预警', { body: text, tag: text });
    } catch (_) {}
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
