// Runs inside generated-project previews. Only element metadata crosses the iframe boundary.
export function visualPreviewScript(parentOrigin: string): string {
  return `(() => {
    const parentOrigin = ${JSON.stringify(parentOrigin)};
    if (window.__jingyueVisualOrigin === parentOrigin) return;
    window.__jingyueVisualOrigin = parentOrigin;
    let enabled = false;
    let hovered = null;
    let oldOutline = '';
    let oldOffset = '';
    function clear() {
      if (hovered) {
        hovered.style.outline = oldOutline;
        hovered.style.outlineOffset = oldOffset;
        hovered = null;
      }
    }
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type !== 'jingyue:visual-mode') return;
      enabled = event.data.enabled === true;
      clear();
    });
    document.addEventListener('pointerover', (event) => {
      if (!enabled || !(event.target instanceof Element)) return;
      const element = event.target.closest('[data-oid][data-jingyue-source]');
      if (element === hovered) return;
      clear();
      if (element instanceof HTMLElement || element instanceof SVGElement) {
        hovered = element;
        oldOutline = element.style.outline;
        oldOffset = element.style.outlineOffset;
        element.style.outline = '2px solid #a78bfa';
        element.style.outlineOffset = '2px';
      }
    }, true);
    document.addEventListener('click', (event) => {
      if (!enabled || !(event.target instanceof Element)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = event.target.closest('[data-oid][data-jingyue-source]');
      if (!element) return;
      window.parent.postMessage({
        type: 'jingyue:element',
        oid: element.getAttribute('data-oid'),
        file: element.getAttribute('data-jingyue-source'),
        tag: element.tagName.toLowerCase()
      }, parentOrigin);
    }, true);
    window.parent.postMessage({type: 'jingyue:preview-ready'}, parentOrigin);
  })();`;
}
