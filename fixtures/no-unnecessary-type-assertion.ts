// @ts-nocheck
{
    const foo = 3;
    const bar = foo!;
}
{
    const foo = <number>(3 + 5);
}
{
    type Foo = number;
    const foo = <Foo>(3 + 5);
}
{
    type Foo = number;
    const foo = (3 + 5) as Foo;
}
{
    const foo = 'foo' as const;
}
{
    function foo(x: number): number {
        return x!; // unnecessary non-null
    }
}
export { }

const nonNullStringLiteral: 'test';
const nonNullString: string;
const nullableString: string|undefined;
let anyType: any;
type AnyDuringMigration = any;
let tuple: [number, number] = [1, 2];

// non-null
let a = nonNullStringLiteral;
let b = nonNullString;
let c = nullableString!;
tuple;

// as
let d = nonNullStringLiteral as string;
let e = nonNullString;
let f = nullableString as string;

// type assertion
let g = <string>nonNullStringLiteral;
let h = nonNullString;
let i = <string>nullableString;

// complex inner expression
let j = (nonNullString + nonNullStringLiteral);
let k = (nonNullString + nonNullStringLiteral);
let l = (nonNullString + nonNullStringLiteral);
let m = nonNullString.trim();
let n = nonNullString.trim();
let o = nonNullString.trim();
let p = nonNullString.trim();

// custom types
interface Iface1 {
    prop: string;
}
interface Iface2 {
    prop: string;
}

const value1: Iface1 = {prop: 'test'};
const value2: Iface2 = {prop: 'test'};

let q = value1;
let r = <Iface2>value1;
let s = value2;
let t = value2 as Iface1;
let aa = anyType as AnyDuringMigration;

interface TypeA {
    kind: 'a';
}
interface TypeB {
    kind: 'b';
}

function isB(x: TypeA|TypeB): x is TypeB {
    return true;
}

function func(aOrB: TypeA|TypeB) {
    let u = aOrB as TypeA;
    let v = <TypeB>aOrB;

    if (aOrB.kind === 'a') {
        let w = aOrB;
    } else {
        let x = aOrB;
    }

    if (isB(aOrB)) {
        let y = aOrB;
    } else {
        let z = aOrB;
    }
}

// Expecting no warning for these assertions as they are not unnecessary.

type Bar = 'bar';
const data = {
    x: 'foo' as 'foo',
    y: 'bar' as Bar,
}

[1, 2, 3, 4, 5].map(x => [x, 'A' + x] as [number, string]);
let x: Array<[number, string]> = [1, 2, 3, 4, 5].map(x => [x, 'A' + x] as [number, string]);

interface NotATuple {
    0: number,
    0.5: number,
    2: number,
}

declare const notATuple: NotATuple;
notATuple;

function foo() {
    let xx: 1 | 2 = 1;
    const f = () => xx = 2;
    f();
    xx as 1 | 2 === 2; // xx is inferred as 1, assertion is necessary to avoid compile error
}
