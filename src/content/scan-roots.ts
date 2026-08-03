const MAX_SCAN_ROOTS = 1_000;
const MAX_SCAN_ELEMENTS = 20_000;

export function discoverScanRoots(): ParentNode[] {
  const firstRoot: ParentNode = document.documentElement ?? document;
  const roots: ParentNode[] = [firstRoot];
  const seen = new Set<ParentNode>(roots);
  let visitedElements = 0;
  for (let index = 0; index < roots.length && roots.length < MAX_SCAN_ROOTS; index += 1) {
    const root = roots[index];
    if (!root) break;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node && visitedElements < MAX_SCAN_ELEMENTS) {
      visitedElements += 1;
      const element = node as Element;
      const nestedRoots = [
        element instanceof HTMLTemplateElement ? element.content : undefined,
        element.shadowRoot ?? undefined
      ];
      for (const nested of nestedRoots) {
        if (!nested || seen.has(nested) || roots.length >= MAX_SCAN_ROOTS) continue;
        seen.add(nested);
        roots.push(nested);
      }
      node = walker.nextNode();
    }
    if (visitedElements >= MAX_SCAN_ELEMENTS) break;
  }
  return roots;
}
