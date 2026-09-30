import { RunError, type SourceFiles } from './protocol';

const utility =
  /^(?:(?:p[trblxy]?|m[trblxy]?|w|h|gap(?:-[xy])?|space-[xy]|grid-cols)-\d+(?:\.\d+)?|(?:text|bg|border)-(?:gray|slate|zinc|red|blue|green|indigo|purple)-(?:50|[1-9]00)|(?:text|bg)-(?:white|black|transparent)|(?:inline-)?(?:flex|grid|block)|hidden|flex-(?:row|col|wrap|1)|items-(?:start|end|center|stretch)|justify-(?:start|end|center|between|around)|text-(?:left|center|right|xs|sm|base|lg|xl|[2-9]xl)|font-(?:normal|medium|semibold|bold|extrabold)|(?:min-|max-)?[wh]-(?:full|screen|auto)|overflow-(?:hidden|auto)|rounded(?:-(?:sm|md|lg|xl|2xl|full))?|shadow(?:-(?:sm|md|lg|xl|2xl))?)$/;

/**
 * Catch a high-confidence missing utility engine, not subjective design quality.
 * CSS classes are not typechecked by Vite/TypeScript. A successful bundle alone
 * cannot prove that utility-only dimensions (especially SVG icons) took effect.
 */
export function validateStyles(files: SourceFiles) {
  const pkg = JSON.parse(files['package.json'] || '{}');
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  const css = Object.entries(files)
    .filter(([path]) => /\.(?:css|scss|sass|less)$/.test(path))
    .map(([, content]) => content)
    .join('\n');
  const invalid = new Set<string>();
  const pipelineErrors: string[] = [];
  const tailwindDirectives = /@(?:tailwind|apply)\b|@import\s+["']tailwindcss(?:[\/"'])/.test(
    css.replace(/\/\*[\s\S]*?\*\//g, ''),
  );

  if (tailwindDirectives) {
    const postcss = Object.entries(files)
      .filter(([path]) => /^(?:postcss\.config\.[cm]?[jt]s|\.postcssrc(?:\.json)?)$/.test(path))
      .map(([, content]) => content)
      .join('\n');
    const vite = Object.entries(files)
      .filter(([path]) => /^vite\.config\.[cm]?[jt]s$/.test(path))
      .map(([, content]) => content)
      .join('\n');
    const v4 = /@import\s+["']tailwindcss(?:[\/"'])/.test(css);
    const configured =
      dependencies.tailwindcss &&
      (v4
        ? (dependencies['@tailwindcss/vite'] && vite.includes('@tailwindcss/vite')) ||
          (dependencies['@tailwindcss/postcss'] && postcss.includes('@tailwindcss/postcss'))
        : dependencies.postcss &&
          /\btailwindcss\b/.test(postcss || vite) &&
          Object.keys(files).some((path) => /^tailwind\.config\.[cm]?[jt]s$/.test(path)));

    if (!configured) {
      pipelineErrors.push('CSS 包含 Tailwind 指令，但缺少匹配的依赖或编译配置，浏览器不能直接执行 @tailwind / @apply');
    }
  }

  /*
   * CSS bundlers may emit only a warning and silently drop an invalid layout
   * declaration. Use the target browser's parser for native CSS, not SCSS.
   */
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith('.css')) {
        continue;
      }

      for (const match of content
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .matchAll(/(?:^|[;{])\s*(grid-template-(?:columns|rows)|gap|display|width|height)\s*:\s*([^;{}]+)/g)) {
        const value = match[2].replace(/\s*!important\s*$/, '').trim();

        if (!CSS.supports(match[1], value)) {
          invalid.add(`${path} 的 ${match[1]}: ${value.slice(0, 160)}`);
        }
      }
    }
  }

  const engine = ['tailwindcss', 'unocss', '@unocss/vite', 'windicss'].some((name) => dependencies[name]);
  const missing = new Set<string>();

  for (const [path, content] of Object.entries(files)) {
    if (!/\.[jt]sx$/.test(path)) {
      continue;
    }

    for (const match of content.matchAll(/className\s*=\s*(?:["']([^"']+)["']|\{\s*`([^`]+)`\s*\})/g)) {
      for (const token of (match[1] || match[2]).split(/\s+/)) {
        const base = token.split(':').at(-1)!;

        if (!utility.test(base)) {
          continue;
        }

        const escaped = token.replace(/([^\w-])/g, '\\$1');

        // .p-4 must not be satisfied by .p-40, nor .w-1 by .w-12.
        const selector = ('.' + escaped).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        if (!new RegExp(selector + '(?=[\\s{,:>+~.#\\[])').test(css)) {
          missing.add(token);
        }
      }
    }
  }

  if (
    dependencies.tailwindcss &&
    missing.size >= 4 &&
    !/@tailwind\s+utilities\b|@import\s+["']tailwindcss(?:[\/"'])/.test(css)
  ) {
    pipelineErrors.push(
      'Tailwind 依赖存在，但 CSS 中没有引入工具类入口；保留 @tailwind utilities 或匹配版本的 @import',
    );
  }

  // A single similarly named custom class is not enough to reject a project.
  if ((!engine && missing.size >= 4) || invalid.size || pipelineErrors.length) {
    throw new RunError(
      '样式依赖缺失或声明无效：' +
        (pipelineErrors.length ? `${pipelineErrors.join('；')}。` : '') +
        (invalid.size ? `浏览器无法应用以下声明：${[...invalid].slice(0, 20).join('；')}。` : '') +
        (!engine && missing.size >= 4
          ? `共有 ${missing.size} 个工具类缺少定义：${[...missing].slice(0, 80).join('、')}。未配置样式引擎，也没有对应 CSS。`
          : '') +
        '请检查全部现有组件，一次补齐缺失样式（含图标明确尺寸及响应式），不要只修列表中的前几项。沿用原生 CSS 或完整配置方案允许的工具链；不能只保留类名。',
      true,
      'style',
    );
  }
}
