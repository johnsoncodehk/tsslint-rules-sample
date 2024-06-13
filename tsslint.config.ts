import { defineConfig } from '@tsslint/config';
import { convertRule } from '@tsslint/eslint';
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
		'prefer-ts-expect-error': convertRule((await import('./node_modules/@typescript-eslint/eslint-plugin/dist/rules/prefer-ts-expect-error.js')).default.default, [], 0),
		'no-unnecessary-type-assertion': convertRule((await import('./node_modules/@typescript-eslint/eslint-plugin/dist/rules/no-unnecessary-type-assertion.js')).default.default, [], 0),
		'prefer-nullish-coalescing': convertRule((await import('./node_modules/@typescript-eslint/eslint-plugin/dist/rules/prefer-nullish-coalescing.js')).default.default, [{
			ignorePrimitives: {
				boolean: true,
			},
		}], 0),
		'strict-boolean-expressions': convertRule((await import('./node_modules/@typescript-eslint/eslint-plugin/dist/rules/strict-boolean-expressions.js')).default.default, [{
			allowNullableBoolean: true,
			allowString: false,
			allowAny: true,
		}], 0),
		'switch-exhaustiveness-check': convertRule((await import('./node_modules/@typescript-eslint/eslint-plugin/dist/rules/switch-exhaustiveness-check.js')).default.default, [{
			allowDefaultCaseForExhaustiveSwitch: true,
			requireDefaultForNonUnion: true,
		}], 0),
		'no-unnecessary-condition': convertRule((await import('./node_modules/@typescript-eslint/eslint-plugin/dist/rules/no-unnecessary-condition.js')).default.default, [{
			allowConstantLoopConditions: true,
		}], 0),
	},
});
