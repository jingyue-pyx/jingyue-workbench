import { posix } from 'node:path';

// Reachability check for the supported React/Vite entry graph. This catches
// written-but-never-imported CSS, not visual quality or general JS semantics.
export function missingStyleImports(files) {
  const styles = Object.keys(files).filter((path) => /\.(css|scss|sass|less)$/.test(path) && files[path].trim());
  if (!styles.length) return '';
  const seen = new Set();
  const resolve = (from, reference) => {
    const specifier = reference.split(/[?#]/)[0];
    if (!specifier || /^(?:https?:|data:)/.test(specifier)) return;
    const path = specifier.startsWith('/')
      ? specifier.slice(1)
      : specifier.startsWith('@/')
        ? `src/${specifier.slice(2)}`
        : specifier.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(from), specifier))
          : specifier;
    return [
      path,
      ...['.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'].map((ext) => path + ext),
    ].find((candidate) => Object.hasOwn(files, candidate));
  };
  const visit = (path) => {
    if (!path || seen.has(path)) return;
    seen.add(path);
    const text = files[path].replace(/\/\*[\s\S]*?\*\//g, '');
    const references = [];
    if (path.endsWith('.html')) {
      for (const match of text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/g))
        references.push(match[1]);
    } else if (/\.(?:css|scss|sass|less)$/.test(path)) {
      for (const match of text.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)) references.push(match[1]);
    } else {
      for (const match of text.matchAll(/\b(?:import|export)\s*(?:[\w\s{},*$]+?\s+from\s*)?["']([^"']+)["']/g))
        references.push(match[1]);
      for (const match of text.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g)) references.push(match[1]);
    }
    for (const reference of references) visit(resolve(path, reference));
  };
  if (files['index.html']) visit('index.html');
  else
    for (const path of ['src/main.tsx', 'src/main.jsx', 'src/index.tsx', 'src/index.jsx']) if (files[path]) visit(path);
  const missing = styles.filter((path) => !seen.has(path));
  return missing.length
    ? `样式文件未被页面入口引用：${missing.join('、')}。请保留样式内容，并在实际入口或组件中正确导入；只创建 CSS 文件不会让页面样式生效。`
    : '';
}
