// tests/inline-math.test.js
// Plain-node tests for ZenPen.inlineMath — no dependencies, no framework.
// Run: node tests/inline-math.test.js
//
// The parser is DOM-free and targets `window` when present, `global`
// otherwise, so it loads directly here.

global.ZenPen = {};
require('../app/assets/www/js/inline-math.js');

var ev = global.ZenPen.inlineMath.evaluate;

var failures = 0;
var checks = 0;

function check(name, actual, expected) {
	checks++;
	var a = JSON.stringify(actual);
	var e = JSON.stringify(expected);
	if (a !== e) {
		failures++;
		console.log('FAIL: ' + name +
			'\n  expected: ' + e + '\n  got:      ' + a);
	}
}

// Single-line evaluate helper
function one(line, locale) {
	return ev([line], locale || 'en')[0];
}

// Every calc example, run through both locales
function calc(line, ptOut, enOut) {
	check('pt-BR: ' + line, one(line, 'pt-BR'), ptOut);
	check('en: ' + line, one(line, 'en'), enOut);
}

// Every must-be-null example, in both locales
function nulled(line) {
	check('pt-BR null: ' + line, one(line, 'pt-BR'), null);
	check('en null: ' + line, one(line, 'en'), null);
}

// ------------------------------------------------------------------
// Basic arithmetic, precedence, parentheses, unary minus
// ------------------------------------------------------------------
calc('2 + 3 * 4', '14', '14');
calc('(2 + 3) * 4', '20', '20');
calc('10 / 4', '2,5', '2.5');
calc('2 ^ 3', '8', '8');
calc('-5 + 10', '5', '5');
calc('3 * -2', '-6', '-6');
calc('6 \u00d7 7', '42', '42');   // ×
calc('8 \u00f7 2', '4', '4');    // ÷
calc('6 x 7', '42', '42');       // x between numbers
calc('10 - 2 - 3', '5', '5');    // left associativity
calc('100 / 10 / 5', '2', '2');

// ------------------------------------------------------------------
// Percentages
// ------------------------------------------------------------------
calc('20% of 150', '30', '30');
calc('150 + 10%', '165', '165');
calc('150 - 10%', '135', '135');
calc('150 * 10%', '15', '15');

// ------------------------------------------------------------------
// Labels: undefined words are ignored
// ------------------------------------------------------------------
calc('rent 1800 / 3', '600', '600');
calc('groceries: 120 + 45', '165', '165');
calc('total 2 + 3', '5', '5');

// ------------------------------------------------------------------
// Numbers follow the locale
// ------------------------------------------------------------------
calc('1.800,50 * 2', '3.601', '3,601'); // both separators: unambiguous everywhere
calc('1,800.50 * 2', '3.601', '3,601');
// Input is read leniently in both locales (an unambiguous string like
// '0,5' or strict grouping like '1.800' means the same thing either way);
// OUTPUT formatting is what strictly follows the locale.
calc('1.800 + 1', '1.801', '1,801');   // both read as grouping -> 1800 + 1
calc('1,800 + 1', '1.801', '1,801');
calc('0,5 + 0,5', '1', '1');           // lenient input: comma read as decimal
calc('2 * 3,5', '7', '7');
calc('2.5 + 2.5', '5', '5');
calc('1000000 * 2', '2.000.000', '2,000,000');

// Bare numbers are quiet everywhere — a lone number is not an operation
calc('1.800', null, null);
calc('1,800', null, null);

// Fractional digits: at most 6, no trailing zeros
calc('1 / 3', '0,333333', '0.333333');

// ------------------------------------------------------------------
// Variables: defined on a line, usable below, shown on their line
// ------------------------------------------------------------------
check('pt rent chain', ev(['rent = 1800', 'rent / 3'], 'pt-BR'),
	['1.800', '600']);
check('en rent chain', ev(['rent = 1800', 'rent / 3'], 'en'),
	['1,800', '600']);

// Expression assignments
check('assignment with expression',
	ev(['total = 12 + 8', 'total / 2'], 'en'), ['20', '10']);

// Accented names
check('accented variable', ev(['caf\u00e9 = 12', 'caf\u00e9 * 2'], 'en'),
	['12', '24']);

// Visible only below the definition
check('not visible above', ev(['rent / 3', 'rent = 1800', 'rent / 3'], 'en'),
	[null, '1,800', '600']);

// Redefinition applies from that line down
check('redefinition', ev(['x = 2', 'x * 10', 'x = 5', 'x * 10'], 'en'),
	['2', '20', '5', '50']);

// ------------------------------------------------------------------
// Must return null (never NaN/Infinity/errors)
// ------------------------------------------------------------------
nulled('buy 3 apples');
nulled('page 12');
nulled('call at 3pm');
nulled('version 2');
nulled('');
nulled('1800 /');
nulled('5 / 0');
nulled('10 / (5 - 5)');
nulled('randomword');       // undefined name alone
nulled('12 = 5');           // not an assignment (name must be a word)
nulled('(2 + 3');           // unbalanced paren
nulled('2 +');              // dangling operator
nulled('* 5');              // leading operator

// Undefined variable name alone — even AFTER it is defined a bare
// name shows nothing (a lone number is not "a real operation")
check('defined name alone is quiet',
	ev(['rent = 1800', 'rent'], 'en'), ['1,800', null]);

// ------------------------------------------------------------------
// Multi-line realism: a small expense note
// ------------------------------------------------------------------
check('expense note pt-BR', ev([
	'Monthly budget',
	'',
	'rent = 1800',
	'groceries = 620,50',
	'transport = 89,90',
	'rent + groceries + transport',
	'rent / 3',
	'fun money = 1500 - 1200,40',
	'buy 3 apples'
], 'pt-BR'), [
	null, null,
	'1.800',
	'620,5',
	'89,9',
	'2.510,4',
	'600',
	'299,6',
	null
]);

// Plain amounts with labels but no operation stay quiet
check('no-op amounts stay quiet', ev([
	'groceries: 620,50',
	'transport 89,90'
], 'pt-BR'), [null, null]);

// ------------------------------------------------------------------
// Result
// ------------------------------------------------------------------
console.log(checks + ' checks, ' + failures + ' failures');
if (failures > 0) {
	process.exit(1);
}
console.log('All inline-math tests passed.');
