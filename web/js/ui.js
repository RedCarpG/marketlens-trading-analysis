/* 界面通用：局部更新（morph）、滑块指示器 */
/* morph：把 el 的内容更新成 html，只改动有变化的节点。
   实时推送约每 300ms 刷新一次面板，整块重写 innerHTML 会打断过渡动画、丢掉悬停状态，还可能吞掉正在进行的点击；
   这里按位置逐个比对：同类节点就地更新属性和文本，只替换真正不同的部分。
   带 data-key 的节点 key 变了视为不同节点（列表增删时整项替换，不会把一项的内容“挪”到另一项上）。
   details 的 open 不覆盖：开合由用户点击决定，只在首次创建时取 html 里的值 */
function morph(el, html) {
  if (el.__h === html) return;
  el.__h = html;
  const t = document.createElement('template');
  t.innerHTML = html;
  syncKids(el, t.content);
}
function syncKids(a, b) {
  const an = [...a.childNodes],
    bn = [...b.childNodes];
  bn.forEach((n, i) => {
    const o = an[i];
    if (!o) a.appendChild(n);
    else if (o.nodeName !== n.nodeName || (n.nodeType == 1 && o.dataset.key !== n.dataset.key)) a.replaceChild(n, o);
    else if (n.nodeType != 1) {
      if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
    } else {
      for (const { name } of [...o.attributes]) if (name != 'open' && !n.hasAttribute(name)) o.removeAttribute(name);
      for (const { name, value } of n.attributes)
        if (name != 'open' && o.getAttribute(name) !== value) o.setAttribute(name, value);
      if (o.tagName == 'INPUT') o.checked = n.hasAttribute('checked');
      syncKids(o, n);
    }
  });
  for (let i = an.length - 1; i >= bn.length; i--) a.removeChild(an[i]);
}
/* 分段按钮 / 标签页的滑块：把当前项（.on）的位置和宽度写进容器的 --x / --w，由 CSS 过渡滑过去；首次定位不做动画 */
function segInd(el) {
  const b = el && el.querySelector(':scope > .on');
  if (!b || !b.offsetWidth) return;
  const first = !el.style.getPropertyValue('--w');
  if (first) el.classList.add('noanim');
  el.style.setProperty('--x', b.offsetLeft + 'px');
  el.style.setProperty('--w', b.offsetWidth + 'px');
  if (first) requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('noanim')));
}
