import { defineConfig, Rule } from '@tsslint/config';
import type * as ts from 'typescript';

export default defineConfig({
	rules: {
		'no-duplicate-case'({ typescript: ts, sourceFile, reportWarning }) {
			ts.forEachChild(sourceFile, function cb(node: ts.Node): void {
				if (ts.isSwitchStatement(node)) {
					const caseClauses = node.caseBlock.clauses.filter(ts.isCaseClause);
					const seenLabels = new Set<string>();

					for (const clause of caseClauses) {
						const label = clause.expression.getText(sourceFile);

						if (seenLabels.has(label)) {
							reportWarning('Disallow duplicate case labels', clause.getStart(sourceFile), clause.getEnd());
						} else {
							seenLabels.add(label);
						}
					}
				}

				ts.forEachChild(node, cb);
			});
		},
		'@typescript-eslint/prefer-ts-expect-error': (await (import('./rules/prefer-ts-expect-error.ts'))).create(),
		// 'no-unreachable-code'({ typescript: ts, sourceFile, reportError }) {
		// 	// TODO
		// },
		// '@typescript-eslint/no-unnecessary-type-assertion': convertTSLintRule((await import('tslint/lib/rules/noUnnecessaryTypeAssertionRule.js')).Rule),
		'@typescript-eslint/no-unnecessary-type-assertion': (await import('./rules/no-unnecessary-type-assertion.ts')).create(),
		'@typescript-eslint/prefer-nullish-coalescing': (await import('./rules/prefer-nullish-coalescing.ts')).create(),
		'@typescript-eslint/strict-boolean-expressions': convertTSLintRule((await import('tslint/lib/rules/strictBooleanExpressionsRule.js')).Rule),
		'@typescript-eslint/switch-exhaustiveness-check': (await import('./rules/switch-exhaustiveness-check.ts')).create(),
		'@typescript-eslint/no-unnecessary-condition': (await import('./rules/no-unnecessary-condition.ts')).create(),
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
