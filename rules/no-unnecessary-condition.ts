import type { Rule } from '@tsslint/types';
import * as tsutils from 'ts-api-utils';
import type * as ts from 'typescript';

import {
  getConstrainedTypeAtLocation,
  getTypeName,
  getTypeOfPropertyOfName,
  isNullableType,
  isTypeAnyType,
  isTypeFlagSet,
  isTypeUnknownType,
} from '../type-utils';
import { getTokenAfter } from './no-unnecessary-type-assertion';
import { NullThrowsReasons, nullThrows } from './utils';

// Truthiness utilities
// #region
const isTruthyLiteral = (type: ts.Type): boolean =>
  tsutils.isTrueLiteralType(type) ||
  //  || type.
  (type.isLiteral() && !!type.value);

const isPossiblyFalsy = (type: ts.Type): boolean =>
  tsutils
    .unionTypeParts(type)
    // Intersections like `string & {}` can also be possibly falsy,
    // requiring us to look into the intersection.
    .flatMap(type => tsutils.intersectionTypeParts(type))
    // PossiblyFalsy flag includes literal values, so exclude ones that
    // are definitely truthy
    .filter(t => !isTruthyLiteral(t))
    .some(type => isTypeFlagSet(type, 117724 satisfies ts.TypeFlags.PossiblyFalsy));

const isPossiblyTruthy = (type: ts.Type): boolean =>
  tsutils
    .unionTypeParts(type)
    .map(type => tsutils.intersectionTypeParts(type))
    .some(intersectionParts =>
      // It is possible to define intersections that are always falsy,
      // like `"" & { __brand: string }`.
      intersectionParts.every(type => !tsutils.isFalsyType(type)),
    );

// Nullish utilities
const nullishFlag = (32768 satisfies ts.TypeFlags.Undefined) | (65536 satisfies ts.TypeFlags.Null);
const isNullishType = (type: ts.Type): boolean =>
  isTypeFlagSet(type, nullishFlag);

const isPossiblyNullish = (type: ts.Type): boolean =>
  tsutils.unionTypeParts(type).some(isNullishType);

const isAlwaysNullish = (type: ts.Type): boolean =>
  tsutils.unionTypeParts(type).every(isNullishType);

// isLiteralType only covers numbers and strings, this is a more exhaustive check.
const isLiteral = (type: ts.Type): boolean =>
  tsutils.isBooleanLiteralType(type) ||
  type.flags === 32768 satisfies ts.TypeFlags.Undefined ||
  type.flags === 65536 satisfies ts.TypeFlags.Null ||
  type.flags === 16384 satisfies ts.TypeFlags.Void ||
  type.isLiteral();
// #endregion

export type Options = Parameters<typeof create>;

/**
 * Disallow conditionals where the type is always truthy or always falsy
 */
export function create({
  allowConstantLoopConditions = false,
  allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing = false,
}: {
  /** Whether to ignore constant loop conditions, such as `while (true)`. */
  allowConstantLoopConditions?: boolean;
  /** Whether to not error when running with a tsconfig that has strictNullChecks turned. */
  allowRuleToRunWithoutStrictNullChecksIKnowWhatIAmDoing?: boolean;
} = {}): Rule {
  return ({
    typescript: ts,
    sourceFile,
    languageService,
    reportWarning: report,
  }) => {
    const program = languageService.getProgram()!;
    const checker = program.getTypeChecker();

    const compilerOptions = program.getCompilerOptions();
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

    function nodeIsArrayType(node: ts.Expression): boolean {
      const nodeType = getConstrainedTypeAtLocation(checker, node);
      return tsutils
        .unionTypeParts(nodeType)
        .some(part => checker.isArrayType(part));
    }

    function nodeIsTupleType(node: ts.Expression): boolean {
      const nodeType = getConstrainedTypeAtLocation(checker, node);
      return tsutils
        .unionTypeParts(nodeType)
        .some(part => checker.isTupleType(part));
    }

    function isArrayIndexExpression(node: ts.Expression): boolean {
      return (
        // Is an index signature
        ts.isElementAccessExpression(node) &&
        // ...into an array type
        (nodeIsArrayType(node.argumentExpression) ||
          // ... or a tuple type
          (nodeIsTupleType(node.argumentExpression) &&
            // Exception: literal index into a tuple - will have a sound type
            ts.isStringLiteral(node.argumentExpression)))
      );
    }

    function isNullableMemberExpression(
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    ): boolean {
      const objectType = checker.getTypeAtLocation(node.expression);
      if (ts.isElementAccessExpression(node)) {
        const propertyType = checker.getTypeAtLocation(node.argumentExpression);
        return isNullablePropertyType(objectType, propertyType);
      }
      const property = node.name;

      if (ts.isIdentifier(property)) {
        const propertyType = objectType.getProperty(
          property.escapedText as string,
        );
        if (
          propertyType &&
          tsutils.isSymbolFlagSet(propertyType, ts.SymbolFlags.Optional)
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * Checks if a conditional node is necessary:
     * if the type of the node is always true or always false, it's not necessary.
     */
    function checkNode(node: ts.Expression, isUnaryNotArgument = false): void {
      // Check if the node is Unary Negation expression and handle it
      if (
        ts.isPrefixUnaryExpression(node) &&
        node.operator === ts.SyntaxKind.ExclamationToken
      ) {
        return checkNode(node.operand, true);
      }

      // Since typescript array index signature types don't represent the
      //  possibility of out-of-bounds access, if we're indexing into an array
      //  just skip the check, to avoid false positives
      if (isArrayIndexExpression(node)) {
        return;
      }

      // When checking logical expressions, only check the right side
      //  as the left side has been checked by checkLogicalExpressionForUnnecessaryConditionals
      //
      // Unless the node is nullish coalescing, as it's common to use patterns like `nullBool ?? true` to to strict
      //  boolean checks if we inspect the right here, it'll usually be a constant condition on purpose.
      // In this case it's better to inspect the type of the expression as a whole.
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
      ) {
        return checkNode(node.right);
      }

      const type = getConstrainedTypeAtLocation(checker, node);

      // Conditional is always necessary if it involves:
      //    `any` or `unknown` or a naked type variable
      if (
        tsutils
          .unionTypeParts(type)
          .some(
            part =>
              isTypeAnyType(part) ||
              isTypeUnknownType(part) ||
              isTypeFlagSet(part, ts.TypeFlags.TypeVariable),
          )
      ) {
        return;
      }
      let message: string | null = null;

      if (isTypeFlagSet(type, ts.TypeFlags.Never)) {
        message = 'Unnecessary conditional, value is `never`.';
      } else if (!isPossiblyTruthy(type)) {
        message = !isUnaryNotArgument
          ? 'Unnecessary conditional, value is always falsy.'
          : 'Unnecessary conditional, value is always truthy.';
      } else if (!isPossiblyFalsy(type)) {
        message = !isUnaryNotArgument
          ? 'Unnecessary conditional, value is always truthy.'
          : 'Unnecessary conditional, value is always falsy.';
      }

      if (message) {
        report(message, node.getStart(sourceFile), node.getEnd());
      }
    }

    function checkNodeForNullish(node: ts.Expression): void {
      const type = getConstrainedTypeAtLocation(checker, node);

      // Conditional is always necessary if it involves `any`, `unknown` or a naked type parameter
      if (
        isTypeFlagSet(
          type,
          ts.TypeFlags.Any |
          ts.TypeFlags.Unknown |
          ts.TypeFlags.TypeParameter |
          ts.TypeFlags.TypeVariable,
        )
      ) {
        return;
      }

      let message: string | null = null;
      if (isTypeFlagSet(type, ts.TypeFlags.Never)) {
        message = 'Unnecessary conditional, value is `never`.';
      } else if (
        !isPossiblyNullish(type) &&
        !(
          (ts.isPropertyAccessExpression(node) ||
            ts.isElementAccessExpression(node)) &&
          isNullableMemberExpression(node)
        )
      ) {
        // Since typescript array index signature types don't represent the
        //  possibility of out-of-bounds access, if we're indexing into an array
        //  just skip the check, to avoid false positives
        if (
          !isArrayIndexExpression(node) &&
          !(
            (ts.isPropertyAccessChain(node) || ts.isElementAccessChain(node)) &&
            !ts.isNonNullExpression(node) &&
            optionChainContainsOptionArrayIndex(node)
          )
        ) {
          message =
            'Unnecessary conditional, expected left-hand side of `??` operator to be possibly null or undefined.';
        }
      } else if (isAlwaysNullish(type)) {
        message =
          'Unnecessary conditional, left-hand side of `??` operator is always `null` or `undefined`.';
      }

      if (message) {
        report(message, node.getStart(sourceFile), node.getEnd());
      }
    }

    /**
     * Checks that a binary expression is necessarily conditional, reports otherwise.
     * If both sides of the binary expression are literal values, it's not a necessary condition.
     *
     * NOTE: It's also unnecessary if the types that don't overlap at all
     *    but that case is handled by the Typescript compiler itself.
     *    Known exceptions:
     *      - https://github.com/microsoft/TypeScript/issues/32627
     *      - https://github.com/microsoft/TypeScript/issues/37160 (handled)
     */
    const BOOL_OPERATORS = new Set([
      ts.SyntaxKind.LessThanToken, // <
      ts.SyntaxKind.GreaterThanToken, // >
      ts.SyntaxKind.LessThanEqualsToken, // <=
      ts.SyntaxKind.GreaterThanEqualsToken, // >=
      ts.SyntaxKind.EqualsEqualsToken, // ==
      ts.SyntaxKind.EqualsEqualsEqualsToken, // ===
      ts.SyntaxKind.ExclamationEqualsToken, // !=
      ts.SyntaxKind.ExclamationEqualsEqualsToken, // !==
    ]);
    function checkIfBinaryExpressionIsNecessaryConditional(
      node: ts.BinaryExpression,
    ): void {
      if (!BOOL_OPERATORS.has(node.operatorToken.kind)) {
        return;
      }
      const leftType = getConstrainedTypeAtLocation(checker, node.left);
      const rightType = getConstrainedTypeAtLocation(checker, node.right);
      if (isLiteral(leftType) && isLiteral(rightType)) {
        report(
          'Unnecessary conditional, both sides of the expression are literal values.',
          node.getStart(sourceFile),
          node.getEnd(),
        );
        return;
      }
      // Workaround for https://github.com/microsoft/TypeScript/issues/37160
      if (isStrictNullChecks) {
        const UNDEFINED = ts.TypeFlags.Undefined;
        const NULL = ts.TypeFlags.Null;
        const VOID = ts.TypeFlags.Void;
        const isComparable = (type: ts.Type, flag: ts.TypeFlags): boolean => {
          // Allow comparison to `any`, `unknown` or a naked type parameter.
          flag |=
            ts.TypeFlags.Any |
            ts.TypeFlags.Unknown |
            ts.TypeFlags.TypeParameter |
            ts.TypeFlags.TypeVariable;

          // Allow loose comparison to nullish values.
          if (
            node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
            node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
          ) {
            flag |= NULL | UNDEFINED | VOID;
          }

          return isTypeFlagSet(type, flag);
        };

        if (
          (leftType.flags === UNDEFINED &&
            !isComparable(rightType, UNDEFINED | VOID)) ||
          (rightType.flags === UNDEFINED &&
            !isComparable(leftType, UNDEFINED | VOID)) ||
          (leftType.flags === NULL && !isComparable(rightType, NULL)) ||
          (rightType.flags === NULL && !isComparable(leftType, NULL))
        ) {
          report(
            'Unnecessary conditional, the types have no overlap.',
            node.getStart(sourceFile),
            node.getEnd(),
          );
          return;
        }
      }
    }

    /**
     * Checks that a logical expression contains a boolean, reports otherwise.
     */
    function checkLogicalExpressionForUnnecessaryConditionals(
      node: ts.BinaryExpression,
    ): void {
      if (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        checkNodeForNullish(node.left);
        return;
      }
      // Only checks the left side, since the right side might not be "conditional" at all.
      // The right side will be checked if the LogicalExpression is used in a conditional context
      checkNode(node.left);
    }

    /**
     * Checks that a testable expression of a loop is necessarily conditional, reports otherwise.
     */
    function checkIfLoopIsNecessaryConditional(
      node: ts.DoStatement | ts.ForStatement | ts.WhileStatement,
    ): void {
      const test = ts.isForStatement(node) ? node.condition : node.expression;
      if (test == null) {
        // e.g. `for(;;)`
        return;
      }

      /**
       * Allow:
       *   while (true) {}
       *   for (;true;) {}
       *   do {} while (true)
       */
      if (
        allowConstantLoopConditions &&
        tsutils.isTrueLiteralType(getConstrainedTypeAtLocation(checker, test))
      ) {
        return;
      }

      checkNode(test);
    }

    const ARRAY_PREDICATE_FUNCTIONS = new Set([
      'filter',
      'find',
      'some',
      'every',
    ]);
    function isArrayPredicateFunction(node: ts.CallExpression): boolean {
      const { expression } = node;
      return (
        // looks like `something.filter` or `something.find`
        ts.isPropertyAccessExpression(expression) &&
        ts.isIdentifier(expression.name) &&
        ARRAY_PREDICATE_FUNCTIONS.has(expression.name.escapedText as string) &&
        // and the left-hand side is an array, according to the types
        (nodeIsArrayType(expression.expression) ||
          nodeIsTupleType(expression.expression))
      );
    }
    function checkCallExpression(node: ts.CallExpression): void {
      // If this is something like arr.filter(x => /*condition*/), check `condition`
      if (isArrayPredicateFunction(node) && node.arguments.length) {
        const callback = node.arguments[0];
        // Inline defined functions
        if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
          // Two special cases, where we can directly check the node that's returned:
          // () => something
          if (!ts.isBlock(callback.body)) {
            return checkNode(callback.body);
          }
          // () => { return something; }
          const callbackBody = callback.body.statements;
          if (
            callbackBody.length === 1 &&
            ts.isReturnStatement(callbackBody[0]) &&
            callbackBody[0].expression
          ) {
            return checkNode(callbackBody[0].expression);
          }
          // Potential enhancement: could use code-path analysis to check
          //   any function with a single return statement
          // (Value to complexity ratio is dubious however)
        }
        // Otherwise just do type analysis on the function as a whole.
        const returnTypes = tsutils
          .getCallSignaturesOfType(
            getConstrainedTypeAtLocation(checker, callback),
          )
          .map(sig => sig.getReturnType());
        /* istanbul ignore if */ if (returnTypes.length === 0) {
          // Not a callable function
          return;
        }
        // Predicate is always necessary if it involves `any` or `unknown`
        if (returnTypes.some(t => isTypeAnyType(t) || isTypeUnknownType(t))) {
          return;
        }
        if (!returnTypes.some(isPossiblyFalsy)) {
          report(
            'This callback should return a conditional, but return is always truthy.',
            callback.getStart(sourceFile),
            callback.getEnd(),
          );
        }
        if (!returnTypes.some(isPossiblyTruthy)) {
          report(
            'This callback should return a conditional, but return is always falsy.',
            callback.getStart(sourceFile),
            callback.getEnd(),
          );
        }
      }
    }

    // Recursively searches an optional chain for an array index expression
    //  Has to search the entire chain, because an array index will "infect" the rest of the types
    //  Example:
    //  ```
    //  [{x: {y: "z"} }][n] // type is {x: {y: "z"}}
    //    ?.x // type is {y: "z"}
    //    ?.y // This access is considered "unnecessary" according to the types
    //  ```
    function optionChainContainsOptionArrayIndex(
      node:
        | ts.CallExpression
        | ts.PropertyAccessExpression
        | ts.ElementAccessExpression,
    ): boolean {
      const lhsNode = node.expression;
      if (node.questionDotToken && isArrayIndexExpression(lhsNode)) {
        return true;
      }
      if (
        ts.isPropertyAccessExpression(lhsNode) ||
        ts.isElementAccessExpression(lhsNode) ||
        ts.isCallExpression(lhsNode)
      ) {
        return optionChainContainsOptionArrayIndex(lhsNode);
      }
      return false;
    }

    function isNullablePropertyType(
      objType: ts.Type,
      propertyType: ts.Type,
    ): boolean {
      if (propertyType.isUnion()) {
        return propertyType.types.some(type =>
          isNullablePropertyType(objType, type),
        );
      }
      if (propertyType.isNumberLiteral() || propertyType.isStringLiteral()) {
        const propType = getTypeOfPropertyOfName(
          checker,
          objType,
          propertyType.value.toString(),
        );
        if (propType) {
          return isNullableType(propType);
        }
      }
      const typeName = getTypeName(checker, propertyType);
      return !!checker
        .getIndexInfosOfType(objType)
        .find(info => getTypeName(checker, info.keyType) === typeName);
    }

    // Checks whether a member expression is nullable or not regardless of it's previous node.
    //  Example:
    //  ```
    //  // 'bar' is nullable if 'foo' is null.
    //  // but this function checks regardless of 'foo' type, so returns 'true'.
    //  declare const foo: { bar : { baz: string } } | null
    //  foo?.bar;
    //  ```
    function isMemberExpressionNullableOriginFromObject(
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    ): boolean {
      const prevType = getConstrainedTypeAtLocation(checker, node.expression);
      const property = ts.isPropertyAccessExpression(node)
        ? node.name
        : node.argumentExpression;
      if (prevType.isUnion() && ts.isIdentifier(property)) {
        const isOwnNullable = prevType.types.some(type => {
          if (ts.isElementAccessExpression(node)) {
            const propertyType = getConstrainedTypeAtLocation(
              checker,
              node.argumentExpression,
            );
            return isNullablePropertyType(type, propertyType);
          }
          const propType = getTypeOfPropertyOfName(
            checker,
            type,
            property.escapedText as string,
          );

          if (propType) {
            return isNullableType(propType);
          }

          return !!checker.getIndexInfoOfType(type, ts.IndexKind.String);
        });
        return !isOwnNullable && isNullableType(prevType);
      }
      return false;
    }

    function isCallExpressionNullableOriginFromCallee(
      node: ts.CallExpression,
    ): boolean {
      const prevType = getConstrainedTypeAtLocation(checker, node.expression);

      if (prevType.isUnion()) {
        const isOwnNullable = prevType.types.some(type => {
          const signatures = type.getCallSignatures();
          return signatures.some(sig =>
            isNullableType(sig.getReturnType(), { allowUndefined: true }),
          );
        });
        return (
          !isOwnNullable && isNullableType(prevType, { allowUndefined: true })
        );
      }

      return false;
    }

    function isOptionableExpression(node: ts.Expression): boolean {
      const type = getConstrainedTypeAtLocation(checker, node);
      const isOwnNullable =
        ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)
          ? !isMemberExpressionNullableOriginFromObject(node)
          : ts.isCallExpression(node)
            ? !isCallExpressionNullableOriginFromCallee(node)
            : true;

      const possiblyVoid = isTypeFlagSet(type, ts.TypeFlags.Void);
      return (
        isTypeFlagSet(type, ts.TypeFlags.Any | ts.TypeFlags.Unknown) ||
        (isOwnNullable && (isNullableType(type) || possiblyVoid))
      );
    }

    function checkOptionalChain(
      node:
        | ts.CallExpression
        | ts.PropertyAccessExpression
        | ts.ElementAccessExpression,
      beforeOperator: ts.Node,
      fix: '.' | '',
    ): void {
      // We only care if this step in the chain is optional. If just descend
      // from an optional chain, then that's fine.
      if (!node.questionDotToken) {
        return;
      }

      // Since typescript array index signature types don't represent the
      //  possibility of out-of-bounds access, if we're indexing into an array
      //  just skip the check, to avoid false positives
      if (optionChainContainsOptionArrayIndex(node)) {
        return;
      }

      const nodeToCheck = node.expression;

      if (isOptionableExpression(nodeToCheck)) {
        return;
      }

      const questionDotOperator = nullThrows(
        getTokenAfter(
          beforeOperator,
          sourceFile,
          token => token.kind === ts.SyntaxKind.QuestionDotToken,
        ),
        NullThrowsReasons.MissingToken('operator', '?.'),
      );

      report(
        'Unnecessary optional chain on a non-nullish value.',
        questionDotOperator.getStart(sourceFile),
        questionDotOperator.getEnd(),
      ).withFix('[No Description]', () => [
        {
          fileName: sourceFile.fileName,
          textChanges: [
            {
              newText: fix,
              span: {
                start: questionDotOperator.getStart(sourceFile),
                length: questionDotOperator.getWidth(sourceFile),
              },
            },
          ],
        },
      ]);
    }

    function checkOptionalMemberExpression(
      node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    ): void {
      checkOptionalChain(
        node,
        node.expression,
        ts.isElementAccessExpression(node) ? '' : '.',
      );
    }

    function checkOptionalCallExpression(node: ts.CallExpression): void {
      checkOptionalChain(node, node.expression, '');
    }

    sourceFile.forEachChild(function cb(node) {
      if (ts.isBinaryExpression(node)) {
        // Similar to checkLogicalExpressionForUnnecessaryConditionals, since
        // a ||= b is equivalent to a || (a = b)
        if (
          [
            ts.SyntaxKind.BarBarEqualsToken, // ||=
            ts.SyntaxKind.AmpersandAmpersandEqualsToken, // &&=
          ].includes(node.operatorToken.kind)
        ) {
          try { checkNode(node.left); } catch { }
        } else if (
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken
        ) {
          try { checkNodeForNullish(node.left); } catch { }
        } else if (
          node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ) {
          try { checkLogicalExpressionForUnnecessaryConditionals(node); } catch { }
        } else {
          try { checkIfBinaryExpressionIsNecessaryConditional(node); } catch { }
        }
      } else if (ts.isCallExpression(node)) {
        try { checkCallExpression(node); } catch { }
      } else if (ts.isConditionalExpression(node)) {
        try { checkNode(node.condition); } catch { }
      } else if (ts.isDoStatement(node)) {
        try { checkIfLoopIsNecessaryConditional(node); } catch { }
      } else if (ts.isForStatement(node)) {
        try { checkIfLoopIsNecessaryConditional(node); } catch { }
      } else if (ts.isIfStatement(node)) {
        try { checkNode(node.expression); } catch { }
      } else if (ts.isWhileStatement(node)) {
        try { checkIfLoopIsNecessaryConditional(node); } catch { }
      } else if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        node.questionDotToken
      ) {
        try { checkOptionalMemberExpression(node); } catch { }
      } else if (ts.isCallExpression(node) && node.questionDotToken) {
        try { checkOptionalCallExpression(node); } catch { }
      }

      node.forEachChild(cb);
    });
  };
}
