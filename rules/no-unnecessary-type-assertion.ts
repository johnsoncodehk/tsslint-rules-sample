import type { Rule } from '@tsslint/types';
import { getConstrainedTypeAtLocation, getContextualType, getDeclaration, isNullableType } from '../type-utils';
import * as tsutils from 'ts-api-utils';
import type * as ts from 'typescript';
import { NullThrowsReasons, nullThrows } from './utils';

export type Options = Parameters<typeof create>;

/**
 * Disallow type assertions that do not change the type of an expression
 */
export function create(
  options: {
    /** A list of type names to ignore. */
    typesToIgnore?: string[];
  } = {},
): Rule {
  return ({
    typescript: ts,
    sourceFile,
    languageService,
    reportWarning: report,
  }) => {
    const program = languageService.getProgram()!;
    const checker = program.getTypeChecker();
    const compilerOptions = program.getCompilerOptions();

    /**
     * Returns true if there's a chance the variable has been used before a value has been assigned to it
     */
    function isPossiblyUsedBeforeAssigned(node: ts.Expression): boolean {
      const declaration = getDeclaration(checker, node);
      if (!declaration) {
        // don't know what the declaration is for some reason, so just assume the worst
        return true;
      }

      if (
        // non-strict mode doesn't care about used before assigned errors
        tsutils.isStrictCompilerOptionEnabled(
          compilerOptions,
          'strictNullChecks',
        ) &&
        // ignore class properties as they are compile time guarded
        // also ignore function arguments as they can't be used before defined
        ts.isVariableDeclaration(declaration) &&
        // is it `const x!: number`
        declaration.initializer === undefined &&
        declaration.exclamationToken === undefined &&
        declaration.type !== undefined
      ) {
        // check if the defined variable type has changed since assignment
        const declarationType = checker.getTypeFromTypeNode(declaration.type);
        const type = getConstrainedTypeAtLocation(checker, node);
        if (
          declarationType === type &&
          // `declare`s are never narrowed, so never skip them
          !(
            ts.isVariableStatement(declaration.parent.parent) &&
            declaration.parent.parent.modifiers?.some(
              mod => mod.kind === ts.SyntaxKind.DeclareKeyword,
            )
          )
        ) {
          // possibly used before assigned, so just skip it
          // better to false negative and skip it, than false positive and fix to compile erroring code
          //
          // no better way to figure this out right now
          // https://github.com/Microsoft/TypeScript/issues/31124
          return true;
        }
      }
      return false;
    }

    function isConstAssertion(node: ts.TypeNode): boolean {
      return (
        ts.isTypeReferenceNode(node) &&
        ts.isIdentifier(node.typeName) &&
        node.typeName.escapedText === 'const'
      );
    }

    function isImplicitlyNarrowedConstDeclaration({
      expression,
      parent,
    }: ts.AsExpression | ts.TypeAssertion): boolean {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const maybeDeclarationNode = parent.parent!;
      const isTemplateLiteralWithExpressions =
        ts.isTemplateExpression(expression) &&
        expression.templateSpans.length !== 0;
      return (
        ts.isVariableDeclarationList(maybeDeclarationNode) &&
        !!(maybeDeclarationNode.flags & ts.NodeFlags.Const) &&
        /**
         * Even on `const` variable declarations, template literals with expressions can sometimes be widened without a type assertion.
         * @see https://github.com/typescript-eslint/typescript-eslint/issues/8737
         */
        !isTemplateLiteralWithExpressions
      );
    }

    function isTypeUnchanged(uncast: ts.Type, cast: ts.Type): boolean {
      if (uncast === cast) {
        return true;
      }

      if (
        tsutils.isTypeFlagSet(uncast, ts.TypeFlags.Undefined) &&
        tsutils.isTypeFlagSet(cast, ts.TypeFlags.Undefined) &&
        tsutils.isCompilerOptionEnabled(
          compilerOptions,
          'exactOptionalPropertyTypes',
        )
      ) {
        const uncastParts = tsutils
          .unionTypeParts(uncast)
          .filter(part => !tsutils.isTypeFlagSet(part, ts.TypeFlags.Undefined));

        const castParts = tsutils
          .unionTypeParts(cast)
          .filter(part => !tsutils.isTypeFlagSet(part, ts.TypeFlags.Undefined));

        if (uncastParts.length !== castParts.length) {
          return false;
        }

        const uncastPartsSet = new Set(uncastParts);
        return castParts.every(part => uncastPartsSet.has(part));
      }

      return false;
    }

    sourceFile.forEachChild(function cb(node) {
      if (ts.isNonNullExpression(node)) {
        if (
          ts.isBinaryExpression(node.parent) &&
          node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ) {
          if (node.parent.left === node) {
            report(
              'This assertion is unnecessary since the receiver accepts the original type of the expression.',
              node.getStart(sourceFile),
              node.getEnd(),
            ).withFix('[No Description]', () => [
              {
                fileName: sourceFile.fileName,
                textChanges: [
                  {
                    newText: '',
                    span: {
                      start: node.expression.getEnd(),
                      length: node.getEnd() - node.expression.getEnd(),
                    },
                  },
                ],
              },
            ]);
          }
          // for all other = assignments we ignore non-null checks
          // this is because non-null assertions can change the type-flow of the code
          // so whilst they might be unnecessary for the assignment - they are necessary
          // for following code
          return;
        }

        const originalNode = node;

        const type = getConstrainedTypeAtLocation(checker, node.expression);

        if (!isNullableType(type) && !tsutils.isTypeFlagSet(type, ts.TypeFlags.Void)) {
          if (
            ts.isIdentifier(node.expression) &&
            isPossiblyUsedBeforeAssigned(node.expression)
          ) {
            return;
          }

          report(
            'This assertion is unnecessary since it does not change the type of the expression.',
            node.getStart(sourceFile),
            node.getEnd(),
          ).withFix('[No Description]', () => [
            {
              fileName: sourceFile.fileName,
              textChanges: [
                {
                  newText: '',
                  span: {
                    start: node.getEnd() - 1,
                    length: 1,
                  },
                },
              ],
            },
          ]);
        } else {
          // we know it's a nullable type
          // so figure out if the variable is used in a place that accepts nullable types

          const contextualType = getContextualType(ts, checker, originalNode);
          if (contextualType) {
            // in strict mode you can't assign null to undefined, so we have to make sure that
            // the two types share a nullable type
            const typeIncludesUndefined = tsutils.isTypeFlagSet(
              type,
              ts.TypeFlags.Undefined,
            );
            const typeIncludesNull = tsutils.isTypeFlagSet(type, ts.TypeFlags.Null);
            const typeIncludesVoid = tsutils.isTypeFlagSet(type, ts.TypeFlags.Void);

            const contextualTypeIncludesUndefined = tsutils.isTypeFlagSet(
              contextualType,
              ts.TypeFlags.Undefined,
            );
            const contextualTypeIncludesNull = tsutils.isTypeFlagSet(
              contextualType,
              ts.TypeFlags.Null,
            );
            const contextualTypeIncludesVoid = tsutils.isTypeFlagSet(
              contextualType,
              ts.TypeFlags.Void,
            );

            // make sure that the parent accepts the same types
            // i.e. assigning `string | null | undefined` to `string | undefined` is invalid
            const isValidUndefined = typeIncludesUndefined
              ? contextualTypeIncludesUndefined
              : true;
            const isValidNull = typeIncludesNull
              ? contextualTypeIncludesNull
              : true;
            const isValidVoid = typeIncludesVoid
              ? contextualTypeIncludesVoid
              : true;

            if (isValidUndefined && isValidNull && isValidVoid) {
              report(
                'This assertion is unnecessary since the receiver accepts the original type of the expression.',
                node.getStart(sourceFile),
                node.getEnd(),
              ).withFix('[No Description]', () => [
                {
                  fileName: sourceFile.fileName,
                  textChanges: [
                    {
                      newText: '',
                      span: {
                        start: node.expression.getEnd(),
                        length: node.getEnd() - node.expression.getEnd(),
                      },
                    },
                  ],
                },
              ]);
            }
          }
        }
      } else if (
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node)
      ) {
        if (
          options.typesToIgnore?.includes(
            checker.typeToString(checker.getTypeFromTypeNode(node.type)),
          )
        ) {
          return;
        }

        const castType = checker.getTypeAtLocation(node);
        const uncastType = checker.getTypeAtLocation(node.expression);
        const typeIsUnchanged = isTypeUnchanged(uncastType, castType);

        const wouldSameTypeBeInferred = castType.isLiteral()
          ? isImplicitlyNarrowedConstDeclaration(node)
          : !isConstAssertion(node.type);

        if (typeIsUnchanged && wouldSameTypeBeInferred) {
          report(
            'This assertion is unnecessary since it does not change the type of the expression.',
            node.getStart(sourceFile),
            node.getEnd(),
          ).withFix('[No Description]', () => {
            if (ts.isTypeAssertionExpression(node)) {
              const openingAngleBracket = nullThrows(
                getTokenBefore(
                  node.type,
                  sourceFile,
                  node => node.kind === ts.SyntaxKind.LessThanToken,
                ),
                NullThrowsReasons.MissingToken('<', 'type annotation'),
              );
              const closingAngleBracket = nullThrows(
                getTokenAfter(
                  node.type,
                  sourceFile,
                  node => node.kind === ts.SyntaxKind.GreaterThanToken,
                ),
                NullThrowsReasons.MissingToken('>', 'type annotation'),
              );

              // < ( number ) > ( 3 + 5 )
              // ^---remove---^
              return [
                {
                  fileName: sourceFile.fileName,
                  textChanges: [
                    {
                      newText: '',
                      span: {
                        start: openingAngleBracket.getStart(sourceFile),
                        length:
                          closingAngleBracket.getEnd() -
                          openingAngleBracket.getStart(sourceFile),
                      },
                    },
                  ],
                },
              ];
            }
            // `as` is always present in TSAsExpression
            const asToken = nullThrows(
              getTokenAfter(
                node.expression,
                sourceFile,
                node => node.kind === ts.SyntaxKind.AsKeyword,
              ),
              NullThrowsReasons.MissingToken('>', 'type annotation'),
            );

            // ( 3 + 5 )  as  number
            //          ^--remove--^
            return [
              {
                fileName: sourceFile.fileName,
                textChanges: [
                  {
                    newText: '',
                    span: {
                      start: asToken.getFullStart(),
                      length: node.getEnd() - asToken.getFullStart(),
                    },
                  },
                ],
              },
            ];
          });
        }

        // TODO - add contextually unnecessary check for this
      }

      node.forEachChild(cb);
    });
  };
}

export function getTokenBefore(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  condition: (node: ts.Node) => boolean,
) {
  const children = node.parent.getChildren(sourceFile);
  for (let i = children.indexOf(node) - 1; i >= 0; i--) {
    if (!condition || condition(node)) {
      return node;
    }
  }
  return undefined;
}

export function getTokenAfter(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  condition: (node: ts.Node) => boolean,
) {
  const children = node.parent.getChildren(sourceFile);
  for (
    let i = children.indexOf(node) + 1;
    i < node.parent.getChildCount();
    i++
  ) {
    if (!condition || condition(node)) {
      return node;
    }
  }
  return undefined;
}
