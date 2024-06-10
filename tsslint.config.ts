import { defineConfig, Rule } from '@tsslint/config';
import type * as ts from 'typescript';

export default defineConfig({
	rules: {
		'no-duplicate-case'({ typescript: ts, sourceFile, reportError }) {
			ts.forEachChild(sourceFile, function cb(node: ts.Node): void {
				if (ts.isSwitchStatement(node)) {
					const caseClauses = node.caseBlock.clauses.filter(ts.isCaseClause);
					const seenLabels = new Set<string>();

					for (const clause of caseClauses) {
						const label = clause.expression.getText(sourceFile);

						if (seenLabels.has(label)) {
							reportError('Disallow duplicate case labels', clause.getStart(sourceFile), clause.getEnd());
						} else {
							seenLabels.add(label);
						}
					}
				}

				ts.forEachChild(node, cb);
			});
		},
		'@typescript-eslint/prefer-ts-expect-error'({ typescript: ts, sourceFile, reportError }) {
			const tsIgnoreRegExpSingleLine = /^\/\/\s*\/?\s*@ts-ignore/;
			const tsIgnoreRegExpMultiLine = /^\s*(?:\/|\*)*\s*@ts-ignore/;

			function isLineComment(comment: ts.CommentRange): boolean {
				return ts.SyntaxKind.SingleLineCommentTrivia === comment.kind;
			}

			function getLastCommentLine(comment: ts.CommentRange): string {
				if (isLineComment(comment)) {
					return sourceFile.text.slice(comment.pos, comment.end);
				}

				// For multiline comments - we look at only the last line.
				const commentlines = sourceFile.text.slice(comment.pos, comment.end).split('\n');
				return commentlines[commentlines.length - 1];
			}

			function isValidTsIgnorePresent(comment: ts.CommentRange): boolean {
				const line = getLastCommentLine(comment);
				return isLineComment(comment)
					? tsIgnoreRegExpSingleLine.test(line)
					: tsIgnoreRegExpMultiLine.test(line);
			}

			ts.forEachChild(sourceFile, function cb(node: ts.Node): void {
				const comments = ts.getLeadingCommentRanges(sourceFile.text, node.pos);
				comments.forEach(comment => {
					if (isValidTsIgnorePresent(comment)) {
						reportError('Use "@ts-expect-error" to ensure an error is actually being suppressed.', comment.pos, comment.end);
					}
				});

				ts.forEachChild(node, cb);
			});
		},
		'no-unreachable-code'({ typescript: ts, sourceFile, reportError }) {
			// TODO
		},
		'@typescript-eslint/no-unnecessary-type-assertion': convertTSLintRule((await import('tslint/lib/rules/noUnnecessaryTypeAssertionRule.js')).Rule),
		'@typescript-eslint/prefer-nullish-coalescing'({ typescript: ts, sourceFile, reportError }) {
			// TODO
		},
		'@typescript-eslint/strict-boolean-expressions': convertTSLintRule((await import('tslint/lib/rules/strictBooleanExpressionsRule.js')).Rule),
		'@typescript-eslint/switch-exhaustiveness-check'({ typescript: ts, sourceFile, reportError }) {
			// TODO
		},
		'@typescript-eslint/no-unnecessary-condition'({ typescript: ts, sourceFile, reportError }) {
			// TODO
		},
	},
});

function convertTSLintRule(Rule: /* TSLint.Rules.AbstractRule */ any): Rule {
	const rule = new Rule({
		ruleName: '',
		ruleArguments: [],
		ruleSeverity: 'warning',
		disabledIntervals: [],
	});
	return ({ sourceFile, languageService, reportError, reportWarning }) => {
		const { ruleSeverity } = rule.getOptions();
		if (ruleSeverity === 'off') {
			return;
		}
		const failures = Rule.metadata.requiresTypeInfo
			? rule.applyWithProgram(sourceFile, languageService.getProgram())
			: rule.apply(sourceFile);
		for (const failure of failures) {
			failure.setRuleSeverity(ruleSeverity);
			const report = failure.getRuleSeverity() === 'error' ? reportError : reportWarning;
			const reporter = report(
				failure.getFailure(),
				failure.getStartPosition().getPosition(),
				failure.getEndPosition().getPosition(),
				false,
			);
			for (let i = 0; i < failures.length; i++) {
				const failure = failures[i];
				if (failure.hasFix()) {
					const fix = failure.getFix();
					const replaces = Array.isArray(fix) ? fix : [fix];
					for (const replace of replaces) {
						if (replace) {
							reporter.withFix(
								'Replace with ' + replace.text,
								() => [{
									fileName: sourceFile.fileName,
									textChanges: [{
										newText: replace.text,
										span: {
											start: replace.start,
											length: replace.length,
										},
									}],
								}]
							);
						}
					}
				}
			}
		}
	};
}
