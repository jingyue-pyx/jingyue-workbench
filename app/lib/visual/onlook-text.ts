// Adapted from onlook-dev/onlook packages/parser/src/code-edit/text.ts.
// Copyright Onlook contributors. Apache-2.0; see third-party/onlook/LICENSE.md.
// Change: imports use Babel standalone directly; reject nonliteral text at the caller.
import { packages } from '@babel/standalone';
import type * as T from '@babel/types';

const t = packages.types;

export function updateNodeTextContent(node: T.JSXElement, textContent: string): void {
  const parts = textContent.split('\n');

  if (parts.length === 1) {
    const textNode = node.children.find((child) => t.isJSXText(child));

    if (textNode) {
      textNode.value = textContent;
    } else {
      node.children.unshift(t.jsxText(textContent));
    }

    return;
  }

  node.children = [];
  parts.forEach((part, index) => {
    if (part) {
      node.children.push(t.jsxText(part));
    }

    if (index < parts.length - 1) {
      node.children.push(t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('br'), [], true), null, [], true));
    }
  });
}

// Adapted from packages/parser/src/code-edit/style.ts (replaceNodeClasses).
export function replaceNodeClasses(node: T.JSXElement, className: string): void {
  const openingElement = node.openingElement;
  const existing = openingElement.attributes.find(
    (attr): attr is T.JSXAttribute => t.isJSXAttribute(attr) && attr.name.name === 'className',
  );

  if (existing) {
    existing.value = t.stringLiteral(className);
  } else {
    openingElement.attributes.push(t.jsxAttribute(t.jsxIdentifier('className'), t.stringLiteral(className)));
  }
}
