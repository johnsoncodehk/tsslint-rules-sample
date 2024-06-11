import type * as ts from 'typescript';
/*** Indicates whether identifiers require the use of quotation marks when accessing property definitions and dot notation. */
function requiresQuoting(
  ts: typeof import('typescript'),
  name: string,
  target: ts.ScriptTarget = 99 satisfies ts.ScriptTarget.ESNext,
): boolean {
  if (name.length === 0) {
    return true;
  }

  if (!ts.isIdentifierStart(name.charCodeAt(0), target)) {
    return true;
  }

  for (let i = 1; i < name.length; i += 1) {
    if (!ts.isIdentifierPart(name.charCodeAt(i), target)) {
      return true;
    }
  }

  return false;
}

export { requiresQuoting };
