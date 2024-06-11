import type { Rule } from '@tsslint/types';
import type * as ts from 'typescript';

export type Options = Parameters<typeof create>;

/**
 * Enforce using `@ts-expect-error` over `@ts-ignore`
 */
export function create(): Rule {
  return ({ typescript: ts, sourceFile, reportWarning: report }) => {
    const tsIgnoreRegExpSingleLine = /^\s*\/?\s*@ts-ignore/;
    const tsIgnoreRegExpMultiLine = /^\s*(?:\/|\*)*\s*@ts-ignore/;

    function isLineComment(comment: ts.CommentRange): boolean {
      return ts.SyntaxKind.SingleLineCommentTrivia === comment.kind;
    }

    function getLastCommentLine(comment: ts.CommentRange): string {
      if (isLineComment(comment)) {
        return sourceFile.text.slice(comment.pos, comment.end);
      }

      // For multiline comments - we look at only the last line.
      const commentlines = sourceFile.text
        .slice(comment.pos, comment.end)
        .split('\n');
      return commentlines[commentlines.length - 1];
    }

    function isValidTsIgnorePresent(comment: ts.CommentRange): boolean {
      const line = getLastCommentLine(comment);
      return isLineComment(comment)
        ? tsIgnoreRegExpSingleLine.test(line.slice(2))
        : tsIgnoreRegExpMultiLine.test(line);
    }

    ts.forEachChild(sourceFile, function cb(node: ts.Node): void {
      const comments =
        ts.getLeadingCommentRanges(sourceFile.text, node.pos) || [];
      comments.forEach(comment => {
        if (isValidTsIgnorePresent(comment)) {
          report(
            'Use "@ts-expect-error" to ensure an error is actually being suppressed.',
            comment.pos,
            comment.end,
          ).withFix('[No Description]', () => {
            const replacePos =
              comment.pos +
              sourceFile.text
                .slice(comment.pos, comment.end)
                .indexOf('@ts-ignore');
            const replaceLength = '@ts-ignore'.length;
            return [
              {
                fileName: sourceFile.fileName,
                textChanges: [
                  {
                    newText: '@ts-expect-error',
                    span: {
                      start: replacePos,
                      length: replaceLength,
                    },
                  },
                ],
              },
            ];
          });
        }
      });

      ts.forEachChild(node, cb);
    });
  };
}
