import type { Rule } from '@tsslint/types';
import * as tsutils from 'ts-api-utils';
import type * as ts from 'typescript';

import { getTokenAfter } from './no-unnecessary-type-assertion';
import { nullThrows, NullThrowsReasons } from '@typescript-eslint/utils/eslint-utils';
import { getTypeFlags } from '../type-utils';
import { isNodeEqual, isUndefinedIdentifier } from './utils';

export type Options = Parameters<typeof create>;

/**
 * Enforce using the nullish coalescing operator instead of logical assignments or chaining
 */
export function create({
  allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing = false,
  ignoreConditionalTests = false,
  ignoreTernaryTests = false,
  ignoreMixedLogicalExpressions = false,
  ignorePrimitives = {
    bigint: false,
    boolean: false,
    number: false,
    string: false,
  },
}: {
  allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing?: boolean;
  ignoreConditionalTests?: boolean;
  ignoreMixedLogicalExpressions?: boolean;
  ignorePrimitives?:
  | {
    bigint?: boolean;
    boolean?: boolean;
    number?: boolean;
    string?: boolean;
  }
  | true;
  ignoreTernaryTests?: boolean;
} = {}): Rule {
  return ({
    typescript: ts,
    sourceFile,
    languageService,
    reportWarning: report,
  }) => {
    const program = languageService.getProgram()!;
    const compilerOptions = program.getCompilerOptions();

    const checker = program.getTypeChecker();
    const isStrictNullChecks = tsutils.isStrictCompilerOptionEnabled(
      compilerOptions,
      'strictNullChecks',
    );

    if (
      !isStrictNullChecks &&
      allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing !== true
    ) {
      report(
        'This rule requires the `strictNullChecks` compiler option to be turned on to function correctly.',
        0,
        0,
      );
    }

    sourceFile.forEachChild(function cb(node) {
      if (ts.isConditionalExpression(node)) {
        if (ignoreTernaryTests) {
          return;
        }

        let operator: ts.SyntaxKind | undefined;
        let nodesInsideTestExpression: ts.Node[] = [];
        if (ts.isBinaryExpression(node.condition)) {
          nodesInsideTestExpression = [
            node.condition.left,
            node.condition.right,
          ];
          if (
            node.condition.operatorToken.kind ===
            ts.SyntaxKind.EqualsEqualsToken ||
            node.condition.operatorToken.kind ===
            ts.SyntaxKind.ExclamationEqualsToken ||
            node.condition.operatorToken.kind ===
            ts.SyntaxKind.EqualsEqualsEqualsToken ||
            node.condition.operatorToken.kind ===
            ts.SyntaxKind.ExclamationEqualsEqualsToken
          ) {
            operator = node.condition.operatorToken.kind;
          } else if (
            isLogicalExpression(node.condition) &&
            ts.isBinaryExpression(node.condition.left) &&
            ts.isBinaryExpression(node.condition.right)
          ) {
            nodesInsideTestExpression = [
              node.condition.left.left,
              node.condition.left.right,
              node.condition.right.left,
              node.condition.right.right,
            ];
            if (
              node.condition.operatorToken.kind === ts.SyntaxKind.BarBarToken
            ) {
              if (
                node.condition.left.operatorToken.kind ===
                ts.SyntaxKind.EqualsEqualsEqualsToken &&
                node.condition.right.operatorToken.kind ===
                ts.SyntaxKind.EqualsEqualsEqualsToken
              ) {
                operator = ts.SyntaxKind.EqualsEqualsEqualsToken;
              } else if (
                ((node.condition.left.operatorToken.kind ===
                  ts.SyntaxKind.EqualsEqualsEqualsToken ||
                  node.condition.right.operatorToken.kind ===
                  ts.SyntaxKind.EqualsEqualsEqualsToken) &&
                  (node.condition.left.operatorToken.kind ===
                    ts.SyntaxKind.EqualsEqualsToken ||
                    node.condition.right.operatorToken.kind ===
                    ts.SyntaxKind.EqualsEqualsToken)) ||
                (node.condition.left.operatorToken.kind ===
                  ts.SyntaxKind.EqualsEqualsToken &&
                  node.condition.right.operatorToken.kind ===
                  ts.SyntaxKind.EqualsEqualsToken)
              ) {
                operator = ts.SyntaxKind.EqualsEqualsToken;
              }
            } else if (
              node.condition.operatorToken.kind ===
              ts.SyntaxKind.AmpersandAmpersandToken
            ) {
              if (
                node.condition.left.operatorToken.kind ===
                ts.SyntaxKind.ExclamationEqualsEqualsToken &&
                node.condition.right.operatorToken.kind ===
                ts.SyntaxKind.ExclamationEqualsEqualsToken
              ) {
                operator = ts.SyntaxKind.ExclamationEqualsEqualsToken;
              } else if (
                ((node.condition.left.operatorToken.kind ===
                  ts.SyntaxKind.ExclamationEqualsEqualsToken ||
                  node.condition.right.operatorToken.kind ===
                  ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
                  (node.condition.left.operatorToken.kind ===
                    ts.SyntaxKind.ExclamationEqualsToken ||
                    node.condition.right.operatorToken.kind ===
                    ts.SyntaxKind.ExclamationEqualsToken)) ||
                (node.condition.left.operatorToken.kind ===
                  ts.SyntaxKind.ExclamationEqualsToken &&
                  node.condition.right.operatorToken.kind ===
                  ts.SyntaxKind.ExclamationEqualsToken)
              ) {
                operator = ts.SyntaxKind.ExclamationEqualsToken;
              }
            }
          }
        }

        if (!operator) {
          return;
        }

        let identifier: ts.Node | undefined;
        let hasUndefinedCheck = false;
        let hasNullCheck = false;

        // we check that the test only contains null, undefined and the identifier
        for (const testNode of nodesInsideTestExpression) {
          if (tsutils.isNullLiteral(testNode)) {
            hasNullCheck = true;
          } else if (isUndefinedIdentifier(testNode)) {
            hasUndefinedCheck = true;
          } else if (
            (operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
              operator === ts.SyntaxKind.ExclamationEqualsToken) &&
            isNodeEqual(testNode, node.whenTrue, sourceFile)
          ) {
            identifier = testNode;
          } else if (
            (operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
              operator === ts.SyntaxKind.EqualsEqualsToken) &&
            isNodeEqual(testNode, node.whenFalse, sourceFile)
          ) {
            identifier = testNode;
          } else {
            return;
          }
        }

        if (!identifier) {
          return;
        }

        const isFixable = ((): boolean => {
          // it is fixable if we check for both null and undefined, or not if neither
          if (hasUndefinedCheck === hasNullCheck) {
            return hasUndefinedCheck;
          }

          // it is fixable if we loosely check for either null or undefined
          if (
            operator === ts.SyntaxKind.EqualsEqualsToken ||
            operator === ts.SyntaxKind.ExclamationEqualsToken
          ) {
            return true;
          }

          const tsNode = identifier;
          const type = checker.getTypeAtLocation(tsNode);
          const flags = getTypeFlags(type);

          if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
            return false;
          }

          const hasNullType = (flags & ts.TypeFlags.Null) !== 0;

          // it is fixable if we check for undefined and the type is not nullable
          if (hasUndefinedCheck && !hasNullType) {
            return true;
          }

          const hasUndefinedType = (flags & ts.TypeFlags.Undefined) !== 0;

          // it is fixable if we check for null and the type can't be undefined
          return hasNullCheck && !hasUndefinedType;
        })();

        if (isFixable) {
          report(
            'Prefer using nullish coalescing operator (`??`) instead of a ternary expression, as it is simpler to read.',
            node.getStart(sourceFile),
            node.getEnd(),
          ).withFix('Fix to nullish coalescing operator (`??`).', () => {
            const [left, right] =
              operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                operator === ts.SyntaxKind.EqualsEqualsToken
                ? [node.whenFalse, node.whenTrue]
                : [node.whenTrue, node.whenFalse];
            return [
              {
                fileName: sourceFile.fileName,
                textChanges: [
                  {
                    newText: `${left.getText(sourceFile)} ?? ${right.getText(sourceFile)}`,
                    span: {
                      start: node.getStart(sourceFile),
                      length: node.getWidth(sourceFile),
                    },
                  },
                ],
              },
            ];
          });
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken
      ) {
        const tsNode = node;
        const type = checker.getTypeAtLocation(tsNode.left);
        if (!tsutils.isTypeFlagSet(type, ts.TypeFlags.Null | ts.TypeFlags.Undefined)) {
          return;
        }

        if (ignoreConditionalTests === true && isConditionalTest(node)) {
          return;
        }

        const isMixedLogical = isMixedLogicalExpression(node);
        if (ignoreMixedLogicalExpressions === true && isMixedLogical) {
          return;
        }

        // https://github.com/typescript-eslint/typescript-eslint/issues/5439
        /* eslint-disable @typescript-eslint/no-non-null-assertion */
        const ignorableFlags = [
          (ignorePrimitives === true || ignorePrimitives!.bigint) &&
          ts.TypeFlags.BigInt,
          (ignorePrimitives === true || ignorePrimitives!.boolean) &&
          ts.TypeFlags.BooleanLiteral,
          (ignorePrimitives === true || ignorePrimitives!.number) &&
          ts.TypeFlags.Number,
          (ignorePrimitives === true || ignorePrimitives!.string) &&
          ts.TypeFlags.String,
        ]
          .filter((flag): flag is number => typeof flag === 'number')
          .reduce((previous, flag) => previous | flag, 0);
        if (
          type.flags !== ts.TypeFlags.Null &&
          type.flags !== ts.TypeFlags.Undefined &&
          (type as ts.UnionOrIntersectionType).types.some(t =>
            tsutils.isTypeFlagSet(t, ignorableFlags),
          )
        ) {
          return;
        }
        /* eslint-enable @typescript-eslint/no-non-null-assertion */

        const barBarOperator = nullThrows(
          getTokenAfter(
            node.left,
            sourceFile,
            child => child.kind === node.operatorToken.kind,
          ),
          NullThrowsReasons.MissingToken('operator', '||'),
        );

        report(
          'Prefer using nullish coalescing operator (`??`) instead of a logical or (`||`), as it is a safer operator.',
          barBarOperator.getStart(sourceFile),
          barBarOperator.getEnd(),
        ).withFix('Fix to nullish coalescing operator (`??`).', () => {
          const textChanges: ts.TextChange[] = [];
          if (isLogicalOrExpression(node.parent)) {
            // ts.SyntaxKind.AmpersandAmpersandToken and '??' operations cannot be mixed without parentheses (e.g. a && b ?? c)
            if (
              isLogicalExpression(node.left) &&
              !isLogicalOrExpression(node.left.left)
            ) {
              textChanges.push({
                newText: '(',
                span: {
                  start: node.left.right.getStart(sourceFile),
                  length: 0,
                },
              });
            } else {
              textChanges.push({
                newText: '(',
                span: {
                  start: node.left.getStart(sourceFile),
                  length: 0,
                },
              });
            }
            textChanges.push({
              newText: ')',
              span: {
                start: node.right.getEnd(),
                length: 0,
              },
            });
          }
          textChanges.push({
            newText: '??',
            span: {
              start: barBarOperator.getStart(sourceFile),
              length: barBarOperator.getWidth(sourceFile),
            },
          });
          return [
            {
              fileName: sourceFile.fileName,
              textChanges,
            },
          ];
        });
      }

      node.forEachChild(cb);
    });
  };
}

function isConditionalTest(node: ts.Node): boolean {
  const parents = new Set<ts.Node | null>([node]);
  let current = node.parent;
  while (current) {
    parents.add(current);

    if (
      (current.kind === (227 satisfies ts.SyntaxKind.ConditionalExpression) ||
        current.kind === (248 satisfies ts.SyntaxKind.ForStatement)) &&
      parents.has(
        (current as ts.ConditionalExpression | ts.ForStatement).condition!,
      )
    ) {
      return true;
    }

    if (
      (current.kind === (246 satisfies ts.SyntaxKind.DoStatement) ||
        current.kind === (245 satisfies ts.SyntaxKind.IfStatement) ||
        current.kind === (247 satisfies ts.SyntaxKind.WhileStatement)) &&
      parents.has(
        (current as ts.DoStatement | ts.IfStatement | ts.WhileStatement)
          .expression,
      )
    ) {
      return true;
    }

    if (
      [
        219 satisfies ts.SyntaxKind.ArrowFunction,
        218 satisfies ts.SyntaxKind.FunctionExpression,
      ].includes(current.kind)
    ) {
      /**
       * This is a weird situation like:
       * `if (() => a || b) {}`
       * `if (function () { return a || b }) {}`
       */
      return false;
    }

    current = current.parent;
  }

  return false;
}

function isMixedLogicalExpression(node: ts.BinaryExpression): boolean {
  const seen = new Set<ts.Node | undefined>();
  const queue = [node.parent, node.left, node.right];
  for (const current of queue) {
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);

    if (isLogicalExpression(current)) {
      if (
        current.operatorToken.kind ===
        (56 satisfies ts.SyntaxKind.AmpersandAmpersandToken)
      ) {
        return true;
      } else if (
        current.operatorToken.kind === (57 satisfies ts.SyntaxKind.BarBarToken)
      ) {
        // check the pieces of the node to catch cases like `a || b || c && d`
        queue.push(current.parent, current.left, current.right);
      }
    }
  }

  return false;
}

function isLogicalExpression(node: ts.Node): node is ts.BinaryExpression {
  return isLogicalOrExpression(node) || isLogicalAndExpression(node);
}

function isLogicalOrExpression(node: ts.Node): node is ts.BinaryExpression {
  if (node.kind === (226 satisfies ts.SyntaxKind.BinaryExpression)) {
    return (
      (node as ts.BinaryExpression).operatorToken.kind ===
      (57 satisfies ts.SyntaxKind.BarBarToken)
    );
  }
  return false;
}

function isLogicalAndExpression(node: ts.Node): node is ts.BinaryExpression {
  if (node.kind === (226 satisfies ts.SyntaxKind.BinaryExpression)) {
    return (
      (node as ts.BinaryExpression).operatorToken.kind ===
      (56 satisfies ts.SyntaxKind.AmpersandAmpersandToken)
    );
  }
  return false;
}
