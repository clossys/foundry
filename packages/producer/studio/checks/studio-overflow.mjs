/** Browser-side L13 probe. Deliberate scroll containers may scroll; clipped content may not. */
export function overflowFindings(document) {
  const window = document.defaultView;
  const findings = [];
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 2) findings.push({ rule: 'viewport-overflow', hidden: root.scrollWidth - root.clientWidth });
  const box = element => element.getBoundingClientRect();
  const visible = element => {
    const r = box(element);
    const style = window.getComputedStyle(element);
    return r.width > 1 && r.height > 1 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = element => ({ slot: element.getAttribute('data-slot') ?? element.tagName.toLowerCase(), text: element.textContent.trim().slice(0, 60) });
  for (const element of document.body.querySelectorAll('*')) {
    if (!visible(element)) continue;
    const style = window.getComputedStyle(element);
    // Explicit auto/scroll containers (tables, code, page body) own their overflow.
    if (!['auto', 'scroll'].includes(style.overflowX) && element.scrollWidth > element.clientWidth + 2) {
      findings.push({ rule: 'content-overflow-x', ...label(element), hidden: element.scrollWidth - element.clientWidth });
    }
    if (['hidden', 'clip'].includes(style.overflowY) && element.scrollHeight > element.clientHeight + 2) {
      findings.push({ rule: 'content-clipped-y', ...label(element), hidden: element.scrollHeight - element.clientHeight });
    }
    const bounds = box(element);
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      const clipping = window.getComputedStyle(ancestor);
      const r = box(ancestor);
      const x = ['hidden', 'clip'].includes(clipping.overflowX) && (bounds.left < r.left - 2 || bounds.right > r.right + 2);
      const y = ['hidden', 'clip'].includes(clipping.overflowY) && (bounds.top < r.top - 2 || bounds.bottom > r.bottom + 2);
      if (x || y) {
        findings.push({ rule: 'descendant-clipped', ...label(element), ancestor: ancestor.getAttribute('data-slot') ?? ancestor.tagName.toLowerCase(), axis: x && y ? 'xy' : x ? 'x' : 'y' });
        break;
      }
    }
  }
  return findings;
}
