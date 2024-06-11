import type * as ts from 'typescript';

/**
 * Gets the source file for a given node
 */
export function getSourceFileOfNode(node: ts.Node): ts.SourceFile {
  while (node.kind !== (312 satisfies ts.SyntaxKind.SourceFile)) {
    node = node.parent;
  }
  return node as ts.SourceFile;
}
