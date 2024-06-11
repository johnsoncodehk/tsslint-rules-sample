import type { Rule } from '@tsslint/types';
import * as tsutils from 'ts-api-utils';
import type * as ts from 'typescript';
import { NullThrowsReasons, getConstrainedTypeAtLocation, nullThrows, requiresQuoting } from './utils';

export type Options = Parameters<typeof create>;

export function create({
  allowDefaultCaseForExhaustiveSwitch = true,
  requireDefaultForNonUnion = false,
}: {
  /**
   * If `true`, allow `default` cases on switch statements with exhaustive
   * cases.
   *
   * @default true
   */
  allowDefaultCaseForExhaustiveSwitch?: boolean;

  /**
   * If `true`, require a `default` clause for switches on non-union types.
   *
   * @default false
   */
  requireDefaultForNonUnion?: boolean;
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

    function getSwitchMetadata(node: ts.SwitchStatement): SwitchMetadata {
      const defaultCase = node.caseBlock.clauses.find(
        switchCase => switchCase.kind === ts.SyntaxKind.DefaultClause,
      ) as ts.DefaultClause | undefined;

      const discriminantType = getConstrainedTypeAtLocation(
        checker,
        node.expression,
      );

      const symbolName = discriminantType.getSymbol()?.escapedName as
        | string
        | undefined;

      const containsNonLiteralType =
        doesTypeContainNonLiteralType(discriminantType);

      const caseTypes = new Set<ts.Type>();
      for (const switchCase of node.caseBlock.clauses) {
        // If the `test` property of the switch case is `null`, then we are on a
        // `default` case.
        if (switchCase.kind === ts.SyntaxKind.DefaultClause) {
          continue;
        }

        const caseType = getConstrainedTypeAtLocation(
          checker,
          switchCase.expression,
        );
        caseTypes.add(caseType);
      }

      const missingLiteralBranchTypes: ts.Type[] = [];

      for (const unionPart of tsutils.unionTypeParts(discriminantType)) {
        for (const intersectionPart of tsutils.intersectionTypeParts(
          unionPart,
        )) {
          if (
            caseTypes.has(intersectionPart) ||
            !isTypeLiteralLikeType(intersectionPart)
          ) {
            continue;
          }

          missingLiteralBranchTypes.push(intersectionPart);
        }
      }

      return {
        symbolName,
        missingLiteralBranchTypes,
        defaultCase,
        containsNonLiteralType,
      };
    }

    function checkSwitchExhaustive(
      node: ts.SwitchStatement,
      switchMetadata: SwitchMetadata,
    ): void {
      const { missingLiteralBranchTypes, symbolName, defaultCase } =
        switchMetadata;

      // We only trigger the rule if a `default` case does not exist, since that
      // would disqualify the switch statement from having cases that exactly
      // match the members of a union.
      if (missingLiteralBranchTypes.length > 0 && defaultCase === undefined) {
        const missingBranches = missingLiteralBranchTypes
          .map(missingType =>
            tsutils.isTypeFlagSet(missingType, ts.TypeFlags.ESSymbolLike)
              ? `typeof ${missingType.getSymbol()?.escapedName as string}`
              : checker.typeToString(missingType),
          )
          .join(' | ');
        report(
          `Switch is not exhaustive. Cases not matched: ${missingBranches}`,
          node.getStart(),
          node.getEnd(),
        ).withFix('Add branches for missing cases.', () => [
          {
            fileName: sourceFile.fileName,
            textChanges: fixSwitch(
              node,
              missingLiteralBranchTypes,
              symbolName?.toString(),
            ),
          },
        ]);
      }
    }

    function fixSwitch(
      node: ts.SwitchStatement,
      missingBranchTypes: (ts.Type | null)[], // null means default branch
      symbolName?: string,
    ): ts.TextChange[] {
      const lastCase =
        node.caseBlock.clauses.length > 0
          ? node.caseBlock.clauses[node.caseBlock.clauses.length - 1]
          : null;
      const caseIndent = lastCase
        ? ' '.repeat(
          sourceFile.getLineAndCharacterOfPosition(
            lastCase.getStart(sourceFile),
          ).character,
        )
        : // If there are no cases, use indentation of the switch statement and
        // leave it to the user to format it correctly.
        ' '.repeat(
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .character,
        );

      const missingCases = [];
      for (const missingBranchType of missingBranchTypes) {
        if (missingBranchType == null) {
          missingCases.push(`default: { throw new Error('default case') }`);
          continue;
        }

        const missingBranchName = missingBranchType.getSymbol()?.escapedName as string | undefined;
        let caseTest = tsutils.isTypeFlagSet(
          missingBranchType,
          ts.TypeFlags.ESSymbolLike,
        )
          ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          missingBranchName!
          : checker.typeToString(missingBranchType);

        if (
          symbolName &&
          (missingBranchName || missingBranchName === '') &&
          requiresQuoting(
            ts,
            missingBranchName.toString(),
            compilerOptions.target,
          )
        ) {
          const escapedBranchName = missingBranchName
            .replaceAll("'", "\\'")
            .replaceAll('\n', '\\n')
            .replaceAll('\r', '\\r');

          caseTest = `${symbolName}['${escapedBranchName}']`;
        }

        missingCases.push(
          `case ${caseTest}: { throw new Error('Not implemented yet: ${caseTest
            .replaceAll('\\', '\\\\')
            .replaceAll("'", "\\'")} case') }`,
        );
      }

      const fixString = missingCases
        .map(code => `${caseIndent}${code}`)
        .join('\n');

      if (lastCase) {
        return [
          {
            newText: `\n${fixString}`,
            span: {
              start: lastCase.getStart(sourceFile),
              length: 0,
            },
          },
        ];
      }

      // There were no existing cases.
      const openingBrace = node.caseBlock.getFirstToken(sourceFile)!;
      nullThrows(
        openingBrace?.kind === ts.SyntaxKind.OpenBraceToken
          ? openingBrace
          : undefined,
        NullThrowsReasons.MissingToken('{', 'discriminant'),
      );
      const closingBrace = node.caseBlock.getLastToken(sourceFile)!;
      nullThrows(
        closingBrace?.kind === ts.SyntaxKind.CloseBraceToken
          ? openingBrace
          : undefined,
        NullThrowsReasons.MissingToken('}', 'discriminant'),
      );

      return [
        {
          newText: ['{', fixString, `${caseIndent}}`].join('\n'),
          span: {
            start: openingBrace.getStart(sourceFile),
            length: closingBrace.getEnd() - openingBrace.getStart(sourceFile),
          },
        },
      ];
    }

    function checkSwitchUnnecessaryDefaultCase(
      switchMetadata: SwitchMetadata,
    ): void {
      if (allowDefaultCaseForExhaustiveSwitch) {
        return;
      }

      const { missingLiteralBranchTypes, defaultCase, containsNonLiteralType } =
        switchMetadata;

      if (
        missingLiteralBranchTypes.length === 0 &&
        defaultCase !== undefined &&
        !containsNonLiteralType
      ) {
        report(
          'The switch statement is exhaustive, so the default case is unnecessary.',
          defaultCase.getStart(sourceFile),
          defaultCase.getEnd(),
        );
      }
    }

    function checkSwitchNoUnionDefaultCase(
      node: ts.SwitchStatement,
      switchMetadata: SwitchMetadata,
    ): void {
      if (!requireDefaultForNonUnion) {
        return;
      }

      const { defaultCase, containsNonLiteralType } = switchMetadata;

      if (containsNonLiteralType && defaultCase === undefined) {
        const missingBranches = 'default';
        report(
          `Switch is not exhaustive. Cases not matched: ${missingBranches}`,
          node.expression.getStart(sourceFile),
          node.getEnd(),
        ).withFix('Add branches for missing cases.', () => [
          {
            fileName: sourceFile.fileName,
            textChanges: fixSwitch(node, [null]),
          },
        ]);
      }
    }

    sourceFile.forEachChild(function cb(node) {
      if (ts.isSwitchStatement(node)) {
        const switchMetadata = getSwitchMetadata(node);

        checkSwitchExhaustive(node, switchMetadata);
        checkSwitchUnnecessaryDefaultCase(switchMetadata);
        checkSwitchNoUnionDefaultCase(node, switchMetadata);
      }

      node.forEachChild(cb);
    });
  };
}

interface SwitchMetadata {
  readonly symbolName: string | undefined;
  readonly defaultCase: ts.DefaultClause | undefined;
  readonly missingLiteralBranchTypes: ts.Type[];
  readonly containsNonLiteralType: boolean;
}

function isTypeLiteralLikeType(type: ts.Type): boolean {
  return tsutils.isTypeFlagSet(
    type,
    (2944 satisfies ts.TypeFlags.Literal) |
    (32768 satisfies ts.TypeFlags.Undefined) |
    (65536 satisfies ts.TypeFlags.Null) |
    (8192 satisfies ts.TypeFlags.UniqueESSymbol),
  );
}

/**
 * For example:
 *
 * - `"foo" | "bar"` is a type with all literal types.
 * - `"foo" | number` is a type that contains non-literal types.
 * - `"foo" & { bar: 1 }` is a type that contains non-literal types.
 *
 * Default cases are never superfluous in switches with non-literal types.
 */
function doesTypeContainNonLiteralType(type: ts.Type): boolean {
  return tsutils
    .unionTypeParts(type)
    .some(type =>
      tsutils
        .intersectionTypeParts(type)
        .every(subType => !isTypeLiteralLikeType(subType)),
    );
}
