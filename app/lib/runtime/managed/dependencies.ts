import { packages } from '@babel/standalone';
import { RunError, type SourceFiles } from './protocol';

/**
 * Catch undeclared packages before install instead of asking the model to
 * repair downstream TS2307/implicit-any errors without a dependency diagnosis.
 */
export function validateImports(files: SourceFiles) {
  const pkg = JSON.parse(files['package.json']);
  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const missing = new Set<string>();
  const missingLocal = new Set<string>();

  for (const [path, content] of Object.entries(files)) {
    if (!/^src\/.*\.[cm]?[jt]sx?$/.test(path)) {
      continue;
    }

    let ast;

    try {
      ast = packages.parser.parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    } catch {
      continue;
    } // The actual compiler diagnoses syntax; never mask it.

    const inspect = (specifier: string) => {
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        /*
         * Check code modules only. Binary assets and custom Vite aliases are
         * outside the text snapshot and must be left to the real compiler.
         */
        const clean = specifier.split(/[?#]/)[0];
        const extension = /\.[^/.]+$/.exec(clean)?.[0];

        if (extension && !/^\.[cm]?[jt]sx?$/.test(extension)) {
          return;
        }

        const parts = path.split('/').slice(0, -1);

        for (const part of clean.split('/')) {
          if (part === '..') {
            parts.pop();
          } else if (part !== '.') {
            parts.push(part);
          }
        }

        const resolved = parts.join('/');
        const candidates = extension
          ? [
              resolved,
              ...(/\.[cm]?jsx?$/.test(extension)
                ? [resolved.replace(/\.([cm]?)js$/, '.$1ts'), resolved.replace(/\.jsx?$/, '.tsx')]
                : []),
            ]
          : [
              resolved,
              ...['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.mts', '.cjs', '.cts'].flatMap((ext) => [
                resolved + ext,
                resolved + '/index' + ext,
              ]),
            ];

        if (!candidates.some((candidate) => Object.hasOwn(files, candidate))) {
          missingLocal.add(`${path} → ${specifier}`);
        }

        return;
      }

      if (/^(?:[./#]|[a-z]+:)/i.test(specifier)) {
        return;
      }

      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

      if (!declared[name]) {
        missing.add(name);
      }
    };
    packages.traverse.default(ast, {
      ImportDeclaration(node) {
        inspect(node.node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.node.source) {
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
  }

  if (missingLocal.size || missing.size) {
    throw new RunError(
      [
        missingLocal.size
          ? `源码引用了未生成的本地模块：${[...missingLocal].sort().slice(0, 20).join('；')}。请补齐真实模块及导出，或修正到现有文件的导入路径；共享类型、组件 props 和调用方必须一致，不能添加空壳或删除功能来通过检查。`
          : '',
        missing.size
          ? `源码导入了未声明的依赖：${[...missing].sort().join(', ')}。请在同一补丁的 package.json 中添加兼容的明确版本并核对导出名称，不要仅修改组件类型或禁用检查。`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      true,
      'dependency',
    );
  }
}
