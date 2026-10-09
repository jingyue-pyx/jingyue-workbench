import { packages } from '@babel/standalone';
import { RunError, type SourceFiles } from './protocol';

/** New-project UI modules must be reachable from the real entry, not replaced by inline mock copies. */
export function validateNewModuleIntegration(files: SourceFiles) {
  const entries = [...(files['index.html'] || '').matchAll(/<script\b[^>]*>/gi)]
    .map(([tag]) => (/\btype=["']module["']/i.test(tag) ? /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1] : undefined))
    .filter((value): value is string => !!value)
    .map((value) => value.replace(/^\.?\//, ''))
    .filter((path) => Object.hasOwn(files, path));

  if (!entries.length) {
    return;
  } // Unknown entry conventions remain the compiler's responsibility.

  const graph = new Map<string, string[]>();
  let unknownAlias = false;

  for (const [path, content] of Object.entries(files)) {
    if (!/\.[cm]?[jt]sx?$/.test(path)) {
      continue;
    }

    let ast;

    try {
      ast = packages.parser.parse(content, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] });
    } catch {
      continue;
    } // The syntax preflight reports the precise failure.

    const edges: string[] = [];
    const inspect = (specifier: string) => {
      if (/^(?:@\/|~\/|#)/.test(specifier)) {
        unknownAlias = true;
        return;
      }

      if (!specifier.startsWith('.')) {
        return;
      }

      const parts = path.split('/').slice(0, -1);

      for (const part of specifier.split(/[?#]/)[0].split('/')) {
        if (part === '..') {
          parts.pop();
        } else if (part !== '.') {
          parts.push(part);
        }
      }

      const base = parts.join('/');
      const resolved = [
        base,
        base.replace(/\.jsx?$/, '.tsx'),
        base.replace(/\.js$/, '.ts'),
        ...['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts'].flatMap((ext) => [base + ext, base + '/index' + ext]),
      ].find((candidate) => Object.hasOwn(files, candidate));

      if (resolved) {
        edges.push(resolved);
      }
    };
    packages.traverse.default(ast, {
      ImportDeclaration(node) {
        if (node.node.importKind !== 'type') {
          inspect(node.node.source.value);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.node.source && node.node.exportKind !== 'type') {
          inspect(node.node.source.value);
        }
      },
      ExportAllDeclaration(node) {
        inspect(node.node.source.value);
      },
      CallExpression(node) {
        const arg = node.node.arguments[0];

        if (
          (node.node.callee.type === 'Import' ||
            (node.node.callee.type === 'Identifier' && node.node.callee.name === 'require')) &&
          arg?.type === 'StringLiteral'
        ) {
          inspect(arg.value);
        }
      },
    });
    graph.set(path, edges);
  }

  if (unknownAlias) {
    return;
  } // Do not invent resolution for user-defined aliases.

  const reachable = new Set<string>();
  const visit = (path: string) => {
    if (reachable.has(path)) {
      return;
    }

    reachable.add(path);

    for (const child of graph.get(path) || []) {
      visit(child);
    }
  };
  entries.forEach(visit);

  const orphaned = Object.keys(files).filter(
    (path) =>
      /^src\/(?:pages|components)\/.*\.[jt]sx$/.test(path) &&
      !/\.(?:test|spec)\.[jt]sx$/.test(path) &&
      !reachable.has(path),
  );

  if (orphaned.length) {
    throw new RunError(
      `新项目模块未接入实际入口：${orphaned.slice(0, 16).join('、')}。请在入口或路由中导入并使用这些已生成的模块；单文件响应只限制本次输出，不要求入口自包含。不能用内联占位副本、空壳或 alert 替代真实页面，不要重写已经完成的模块。`,
      true,
      'dependency',
    );
  }
}
