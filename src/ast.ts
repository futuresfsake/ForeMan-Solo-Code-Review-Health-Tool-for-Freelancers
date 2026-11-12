import ts from "typescript";

function childrenOf(node: ts.Node): ts.Node[] {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
  });
  return children;
}

/**
 * Visits a node and everything below it, parents before children, in source
 * order. It keeps its own stack instead of calling itself: a file with one
 * very long expression (`1+1+1+...` ten thousand times) is a tree ten thousand
 * levels deep, and a walk that calls itself runs out of stack on it.
 */
export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  const stack: ts.Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    visit(current);
    const children = childrenOf(current);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
}

/** How deep the tree goes, counted without recursion. */
export function depthOf(root: ts.Node): number {
  let deepest = 0;
  const stack: { node: ts.Node; depth: number }[] = [{ node: root, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > deepest) deepest = depth;
    for (const child of childrenOf(node)) stack.push({ node: child, depth: depth + 1 });
  }
  return deepest;
}

export function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** The value of a plain string or a template with no substitutions. */
export function stringValue(node: ts.Node | undefined): string | undefined {
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) return node.text;
  return undefined;
}

export function isFunctionLike(node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

export function unwrap(node: ts.Expression): ts.Expression {
  let cur = node;
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur)) {
    cur = cur.expression;
  }
  return cur;
}
