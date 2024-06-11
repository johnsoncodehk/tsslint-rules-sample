import type * as ts from 'typescript';

/**
 * Resolves the given node's type. Will resolve to the type's generic constraint, if it has one.
 */
export function getConstrainedTypeAtLocation(
    checker: ts.TypeChecker,
    node: ts.Node,
): ts.Type {
    const nodeType = checker.getTypeAtLocation(node);
    const constrained = checker.getBaseConstraintOfType(nodeType);

    return constrained ?? nodeType;
}

/*** Indicates whether identifiers require the use of quotation marks when accessing property definitions and dot notation. */
export function requiresQuoting(
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

/**
 * A set of common reasons for calling nullThrows
 */
export const NullThrowsReasons = {
    MissingParent: 'Expected node to have a parent.',
    MissingToken: (token: string, thing: string) =>
        `Expected to find a ${token} for the ${thing}.`,
} as const;

/**
 * Assert that a value must not be null or undefined.
 * This is a nice explicit alternative to the non-null assertion operator.
 */
export function nullThrows<T>(value: T, message: string): NonNullable<T> {
    if (value == null) {
        throw new Error(`Non-null Assertion Failed: ${message}`);
    }

    return value;
}

export function isUndefinedIdentifier(i: ts.Node) {
    return i.kind === 157 satisfies ts.SyntaxKind.UndefinedKeyword;
}

export function isNodeEqual(
    a: ts.Node,
    b: ts.Node,
    sourceFile: ts.SourceFile,
): boolean {
    if (a.kind !== b.kind) {
        return false;
    }
    if (
        a.kind === (110 satisfies ts.SyntaxKind.ThisKeyword) &&
        b.kind === (110 satisfies ts.SyntaxKind.ThisKeyword)
    ) {
        return true;
    }
    if (
        a.kind === (11 satisfies ts.SyntaxKind.StringLiteral) &&
        b.kind === (11 satisfies ts.SyntaxKind.StringLiteral)
    ) {
        return a.getText(sourceFile) === b.getText(sourceFile);
    }
    if (
        a.kind === (80 satisfies ts.SyntaxKind.Identifier) &&
        b.kind === (80 satisfies ts.SyntaxKind.Identifier)
    ) {
        return a.getText(sourceFile) === b.getText(sourceFile);
    }
    if (
        a.kind === (211 satisfies ts.SyntaxKind.PropertyAccessExpression) &&
        b.kind === (211 satisfies ts.SyntaxKind.PropertyAccessExpression)
    ) {
        return (
            isNodeEqual(
                (a as ts.PropertyAccessExpression).name,
                (b as ts.PropertyAccessExpression).name,
                sourceFile,
            ) &&
            isNodeEqual(
                (a as ts.PropertyAccessExpression).expression,
                (b as ts.PropertyAccessExpression).expression,
                sourceFile,
            )
        );
    }
    return false;
}
