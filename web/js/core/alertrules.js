/* 价位和情景预警的判定与句子（纯计算）：页面 alerts.js 和代理 server/watch.js 共用，规则只有这一份 */
/* 周期念出来的说法 */
const TFN = { '15m': '15 分钟', '1h': '1 小时', '4h': '4 小时', '1d': '日线', '1w': '周线', '1M': '月线' };
/* 去重：每个提醒有“布防”状态——第一次见到时若已在触发范围内则不提醒（作为基准），触发后要离开足够远才重新布防。返回这次是否该提醒 */
function armStep(arm, k, near, far) {
  if (!(k in arm)) {
    arm[k] = !near;
    return false;
  }
  if (arm[k] && near) {
    arm[k] = false;
    return true;
  }
  if (!arm[k] && far) arm[k] = true;
  return false;
}
/* m：analyzeMTF 的结果；px：最新价；st：{ arm, sc } 上次的状态（原地更新，sc 为 null 时这次只建立基准）；
   opt：lv / sc 开关，dp 价格小数位。返回这次该发的提醒 */
function alCheck(m, T, px, st, { lv = 1, sc = 1, dp = 2 } = {}) {
  const x = m.t.a.a,
    out = [];
  /* 关键价位：所有关键价位（isKey，不只图上画的每侧 3 条——价格移动后显示的那几条会变，只看它们会漏掉“重新布防”）
     进入 ±0.15 ATR 提醒，离开 0.5 ATR 后重新布防 */
  if (lv)
    m.L.filter(l => isKey(l, T)).forEach(l => {
      const d = Math.abs(px - l.p);
      if (armStep(st.arm, 'lv|' + l.p.toFixed(dp), d <= x * 0.15, d >= x * 0.5)) out.push({ type: 'lv', l });
    });
  /* 情景：新出现的“已触发”，以及已触发 → 失效/已到目标/被反向触发取代 */
  if (sc) {
    const now = {};
    m.sc
      .flatMap(c => c.trigs)
      .forEach(g => {
        const k = g.kind + '|' + g.dir + '|' + g.ts;
        now[k] = g.state;
        if (!st.sc) return;
        const p = st.sc[k];
        if (!p && g.state == '已触发') out.push({ type: 'sc', g });
        else if (p == '已触发' && g.state != '已触发') out.push({ type: 'scx', g });
      });
    st.sc = now;
  }
  return out;
}
/* 一条提醒的文字：text 弹窗用，say 给 Cirra 念；kind 弹窗样式，ck 交给 Cirra 的类型。name 为念出来的品种名 */
function alText(h, { sym, name, T, px, dp = 2 }) {
  const f = v => v.toFixed(dp);
  if (h.type == 'lv') {
    const l = h.l,
      side = l.p < px ? '支撑' : '阻力';
    return {
      text: `${sym} ${T} 价格 ${f(px)} 到达${side} ${f(l.p)}（${l.tfs.join('·')}${l.touch >= 3 ? ` · 挡回${l.touch}次` : ''}）`,
      say: `${name} 到了${side} ${f(l.p)} 附近`,
      kind: 'lv',
      ck: 'lv',
    };
  }
  const g = h.g,
    dn = g.kind + (g.dir > 0 ? '做多' : '做空');
  if (h.type == 'sc')
    return {
      text: `${sym} ${T} 情景触发：${dn}，入场 ${f(g.entry)} / 止损 ${f(g.stop)} / 目标 ${f(g.tgt)}（1:${g.rr.toFixed(1)}）`,
      say: `${name} ${TFN[T]}出现${dn}，入场 ${f(g.entry)}，止损 ${f(g.stop)}`,
      kind: 'sc',
      ck: 'sc',
    };
  return {
    text: `${sym} ${T} 情景${g.state}：${dn}（入场 ${f(g.entry)}）`,
    say: `${name} ${TFN[T]}那个${dn}${g.state.replace(/（.*?）/g, '')}了`,
    kind: 'sc',
    ck: 'scx',
  };
}
