const ts = require('typescript');
const sourceFile = ts.createSourceFile('', `const foo = <number>(3 + 5);`, ts.ScriptTarget.ESNext, undefined, ts.ScriptKind.TS);

sourceFile.forEachChild(function cb(node) {
    if (ts.isTypeAssertionExpression(node)) {
        console.log(node.getFirstToken(sourceFile));
        console.log(node.getLastToken(sourceFile));
        console.log(node.type);
        console.log(getTokenBefore(node.type, node, sourceFile).getText(sourceFile));
        console.log(getTokenAfter(node.type, node, sourceFile).getText(sourceFile));
    }
    node.forEachChild(cb);

    function getTokenBefore(node, parent) {
        const children = parent.getChildren(sourceFile);
        return children[children.indexOf(node) - 1];
    }

    function getTokenAfter(node, parent) {
        const children = parent.getChildren(sourceFile);
        return children[children.indexOf(node) + 1];
    }
});
