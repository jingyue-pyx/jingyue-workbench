import { packages } from '@babel/standalone';
import type * as T from '@babel/types';
import { replaceNodeClasses, updateNodeTextContent } from './onlook-text';

const { types: t, parser, generator } = packages;
const traverse = packages.traverse.default;

function parse(source: string) {
  return parser.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
}

function attribute(node: T.JSXElement, name: string) {
  return node.openingElement.attributes.find(
    (attr): attr is T.JSXAttribute => t.isJSXAttribute(attr) && attr.name.name === name,
  );
}

/** Runtime editor markers are regenerated on write; never make the model copy their UUIDs. */
export function stripGeneratedVisualMetadata(source: string): string {
  if (!source.includes('data-jingyue-source') && !source.includes('data-oid')) {
    return source;
  }

  const ranges: Array<[number, number]> = [];

  try {
    traverse(parse(source), {
      JSXAttribute(path) {
        const node = path.node;

        if (!t.isJSXIdentifier(node.name) || !t.isStringLiteral(node.value)) {
          return;
        }

        const generated =
          (node.name.name === 'data-oid' && /^jy-[0-9a-f-]{36}$/i.test(node.value.value)) ||
          (node.name.name === 'data-jingyue-source' && node.value.value.startsWith('/home/project/'));

        if (generated && node.start != null && node.end != null) {
          let start = node.start;

          while (start > 0 && /[\t ]/.test(source[start - 1])) {
            start--;
          }
          ranges.push([start, node.end]);
        }
      },
    });
  } catch {
    return source; // Invalid syntax remains intact for the real compiler/repair diagnostics.
  }

  for (const [start, end] of ranges.sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + source.slice(end);
  }

  return source;
}

export function instrumentSource(source: string, file: string): string {
  const ast = parse(source);
  let changed = false;
  const seen = new Set<string>();

  traverse(ast, {
    JSXElement(path) {
      const node = path.node;
      const tag = node.openingElement.name;

      if (!t.isJSXIdentifier(tag) || !/^[a-z]/.test(tag.name)) {
        return;
      }

      const existing = attribute(node, 'data-oid');
      let oid = existing && t.isStringLiteral(existing.value) ? existing.value.value : '';

      if (!oid || seen.has(oid)) {
        oid = `jy-${crypto.randomUUID()}`;

        if (existing) {
          existing.value = t.stringLiteral(oid);
        } else {
          node.openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-oid'), t.stringLiteral(oid)));
        }

        changed = true;
      }

      seen.add(oid);

      const location = attribute(node, 'data-jingyue-source');

      if (!location || !t.isStringLiteral(location.value) || location.value.value !== file) {
        if (location) {
          location.value = t.stringLiteral(file);
        } else {
          node.openingElement.attributes.push(
            t.jsxAttribute(t.jsxIdentifier('data-jingyue-source'), t.stringLiteral(file)),
          );
        }

        changed = true;
      }
    },
  });

  return changed ? generator.default(ast, { retainLines: true }, source).code : source;
}

function findElement(ast: T.File, oid: string): T.JSXElement {
  const nodes: T.JSXElement[] = [];
  traverse(ast, {
    JSXElement(path) {
      const attr = attribute(path.node, 'data-oid');

      if (attr && t.isStringLiteral(attr.value) && attr.value.value === oid) {
        nodes.push(path.node);
      }
    },
  });

  if (nodes.length !== 1) {
    throw new Error('元素已变化，请在预览里重新选择。');
  }

  return nodes[0];
}

export function inspectSource(source: string, oid: string) {
  const node = findElement(parse(source), oid);
  const textEditable = canEditText(node);
  const classes = attribute(node, 'className');

  return {
    textEditable,
    text: textEditable
      ? node.children
          .map((child) => (child as T.JSXText).value)
          .join('')
          .trim()
      : '',
    classesEditable: !classes || t.isStringLiteral(classes.value),
    classes: classes && t.isStringLiteral(classes.value) ? classes.value.value : '',
  };
}

function canEditText(node: T.JSXElement) {
  return !node.openingElement.selfClosing && node.children.every((child) => t.isJSXText(child));
}

export type VisualChange =
  | { kind: 'text'; value: string }
  | { kind: 'classes'; value: string }
  | { kind: 'style'; property: 'color' | 'backgroundColor' | 'fontSize'; value: string };

export function editSource(source: string, oid: string, change: VisualChange): string {
  const ast = parse(source);
  const node = findElement(ast, oid);

  if (change.kind === 'text') {
    if (!canEditText(node)) {
      throw new Error('该元素包含组件或动态表达式，请使用对话或代码编辑。');
    }

    // Onlook's text editor handles line breaks; encode JSX-significant text first.
    const safeText = change.value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/{/g, '&#123;')
      .replace(/}/g, '&#125;');
    updateNodeTextContent(node, safeText);
  } else if (change.kind === 'classes') {
    const classes = attribute(node, 'className');

    if (classes && !t.isStringLiteral(classes.value)) {
      throw new Error('动态 className 请通过代码编辑，避免覆盖现有逻辑。');
    }

    replaceNodeClasses(node, change.value);
  } else {
    let style = attribute(node, 'style');

    if (!style) {
      style = t.jsxAttribute(t.jsxIdentifier('style'), t.jsxExpressionContainer(t.objectExpression([])));
      node.openingElement.attributes.push(style);
    }

    if (!t.isJSXExpressionContainer(style.value) || !t.isObjectExpression(style.value.expression)) {
      throw new Error('动态样式请通过代码编辑。');
    }

    const properties = style.value.expression.properties;
    const existing = properties.findIndex(
      (prop) =>
        t.isObjectProperty(prop) &&
        ((t.isIdentifier(prop.key) && prop.key.name === change.property) ||
          (t.isStringLiteral(prop.key) && prop.key.value === change.property)),
    );
    const replacement = t.objectProperty(t.identifier(change.property), t.stringLiteral(change.value));

    if (existing === -1) {
      properties.push(replacement);
    } else {
      properties.splice(existing, 1, replacement);
    }
  }

  return generator.default(ast, { retainLines: true }, source).code;
}
