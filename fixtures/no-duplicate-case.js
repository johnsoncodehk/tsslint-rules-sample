// @ts-nocheck
/*eslint no-duplicate-case: "error"*/

var a = 1,
    one = 1;

switch (a) {
    case 1:
        break;
    case 2:
        break;
    case 1:         // duplicate test expression
        break;
    default:
        break;
}

switch (a) {
    case one:
        break;
    case 2:
        break;
    case one:         // duplicate test expression
        break;
    default:
        break;
}

switch (a) {
    case "1":
        break;
    case "2":
        break;
    case "1":         // duplicate test expression
        break;
    default:
        break;
}
