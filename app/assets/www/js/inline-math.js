// inline-math.js
// Per-note inline math: evaluates the lines of a note and returns, for
// each line, a formatted result (or null when the line has nothing to
// show). Pure string-in/string-out — no DOM, no storage, no eval.
//
//   ZenPen.inlineMath.evaluate(['rent = 1800', 'rent / 3'], 'pt-BR')
//     -> ['1.800', '600']
//
// Supported: + - * / ^ (and × ÷ x between numbers), parentheses, unary
// minus, normal precedence, percentages (20% of 150, 150 + 10%),
// variables (`rent = 1800`, visible only below their definition) and
// label words that are ignored (`groceries: 120 + 45`).
// Anything that cannot be evaluated — plain prose, dangling operators,
// division by zero, unknown names — yields null. Never NaN/Infinity.

ZenPen = (typeof window !== 'undefined' ? window : global).ZenPen || {};

ZenPen.inlineMath = (function() {

	// ------------------------------------------------------------------
	// Locale: figure out decimal/group separators, and format results.
	// ------------------------------------------------------------------
	var COMMA_DECIMAL_LANGS = ['pt','es','it','fr','de','nl','ru','tr','pl',
		'sv','da','no','fi','cs','hu','ro','el','id','vi','uk','sk','bg'];

	function separatorsFor(locale) {
		// Preferred: ask Intl directly (works for every locale it knows).
		try {
			var parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
			var dec = '.', grp = ',';
			for (var i = 0; i < parts.length; i++) {
				if (parts[i].type === 'decimal') dec = parts[i].value;
				if (parts[i].type === 'group') grp = parts[i].value;
			}
			return { dec: dec, grp: grp };
		} catch (e) { /* formatToParts missing (old WebView) or bad locale */ }
		var lang = String(locale || 'en').slice(0, 2).toLowerCase();
		if (COMMA_DECIMAL_LANGS.indexOf(lang) !== -1) return { dec: ',', grp: '.' };
		return { dec: '.', grp: ',' };
	}

	function formatterFor(locale) {
		try {
			return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
		} catch (e) {
			return null;
		}
	}

	// Interpret a raw number literal (digits with . and/or ,) under the
	// given separators. Returns a number, or null when unparseable.
	//
	//   '1.800,50' pt -> 1800.5      '1,800.50' en -> 1800.5
	//   '1.800'    pt -> 1800        '1.800'    en -> 1.8
	//   '0,5'      pt -> 0.5         '3.5'      en -> 3.5
	function parseNumberLiteral(raw, seps) {
		var dec = seps.dec, grp = seps.grp;
		var lastDec = raw.lastIndexOf(dec), lastGrp = raw.lastIndexOf(grp);
		var intPart, fracPart;

		if (lastDec !== -1 && lastGrp !== -1) {
			// Both present: the last one is the decimal separator, whatever
			// the locale says — this makes '1.800,50' and '1,800.50' both
			// read as 1800.5 in every locale.
			if (lastDec > lastGrp) {
				intPart = raw.slice(0, lastDec);
				fracPart = raw.slice(lastDec + 1);
			} else {
				intPart = raw.slice(0, lastGrp);
				fracPart = raw.slice(lastGrp + 1);
			}
			intPart = stripAll(intPart, dec, grp);
			fracPart = digitsOnly(fracPart);
			if (intPart === '' || !/^\d+$/.test(fracPart)) return null;
		} else if (lastDec !== -1 || lastGrp !== -1) {
			var sep = lastDec !== -1 ? dec : grp;
			var idx = lastDec !== -1 ? lastDec : lastGrp;
			var grouped = /^\d{1,3}([.,]\d{3})+$/.test(raw);
			// Locale-driven: '1.800' groups in pt-BR, '1,800' groups in en.
			// If the separator is this locale's group separator — or the
			// string is strict 3-digit grouping — treat it as grouping.
			if (sep === grp || grouped) {
				if (grouped) return number(stripAll(raw, dec, grp), null);
			}
			intPart = stripAll(raw.slice(0, idx), dec, grp);
			fracPart = digitsOnly(raw.slice(idx + 1));
			if (!/^\d*$/.test(fracPart)) return null;
			if (fracPart === '') {
				// '12.' — trailing separator, treat as a plain integer
				return number(intPart, null);
			}
		} else {
			intPart = digitsOnly(raw);
			fracPart = null;
		}
		return number(intPart, fracPart);

		function number(i, f) {
			if (!/^\d+$/.test(i)) return null;
			return f === null ? parseInt(i, 10) : parseFloat(i + '.' + f);
		}
	}

	function stripAll(s, a, b) {
		return s.split(a).join('').split(b).join('');
	}

	function digitsOnly(s) {
		return s.replace(/\D/g, '');
	}

	// ------------------------------------------------------------------
	// Tokenizer
	// ------------------------------------------------------------------
	// Word characters: letters (ASCII + Latin-1/Latin Extended accents),
	// digits and underscore. Names cannot start with a digit — the
	// tokenizer grabs digits as numbers first, so '3pm' is NUMBER '3'
	// followed by the word 'pm' (which then fails to parse: prose).
	var WORD_RE = /^[A-Za-z_\u00C0-\u024F\u1E00-\u1FFF][A-Za-z0-9_\u00C0-\u024F\u1E00-\u1FFF]*/;

	function tokenize(line) {
		var tokens = [];
		var i = 0;
		while (i < line.length) {
			var ch = line[i];
			if (/\s/.test(ch) || ch === ':' || ch === ';') { i++; continue; }
			if (ch >= '0' && ch <= '9') {
				var m = /^\d[\d.,]*/.exec(line.slice(i));
				tokens.push({ type: 'num', raw: m[0] });
				i += m[0].length;
				continue;
			}
			// Symbols BEFORE words: \u00d7 and \u00f7 fall inside the word
			// range (\u00C0-\u024F) and must not be eaten as letters.
			if ('+-*/^()=%\u00d7\u00f7'.indexOf(ch) !== -1) {
				tokens.push({ type: ch });
				i++;
				continue;
			}
			var w = WORD_RE.exec(line.slice(i));
			if (w) {
				tokens.push({ type: 'word', name: w[0] });
				i += w[0].length;
				continue;
			}
			// Anything else (punctuation, emoji, CJK...) — prose.
			return [];
		}
		return tokens;
	}

	// ------------------------------------------------------------------
	// Recursive-descent parser over the token stream.
	// Values flow as { v: number, pct: bool } where pct means "this is a
	// bare percent literal; its raw value still needs /100".
	// ------------------------------------------------------------------
	function Parser(tokens, env, seps) {
		this.t = tokens;
		this.pos = 0;
		this.env = env;
		this.seps = seps;
		this.ops = 0; // real operations consumed (the show-result gate)
		this.failed = false;
	}

	Parser.prototype.peek = function() { return this.t[this.pos]; };
	Parser.prototype.next = function() { return this.t[this.pos++]; };
	Parser.prototype.fail = function() { this.failed = true; };

	// expression := term (('+'|'-') term)*     with percent semantics
	Parser.prototype.expression = function() {
		var left = this.term();
		if (this.failed) return null;
		while (!this.failed) {
			var tok = this.peek();
			if (!tok || (tok.type !== '+' && tok.type !== '-')) break;
			this.next();
			this.ops++;
			var right = this.term();
			if (this.failed) return null;
			if (left.pct) left = { v: left.v / 100, pct: false };
			var value;
			if (right.pct) {
				// 150 + 10% -> 150 + 150*10/100 ; 150 - 10% -> 135
				value = left.v + left.v * right.v / 100 * (tok.type === '+' ? 1 : -1);
			} else {
				value = tok.type === '+' ? left.v + right.v : left.v - right.v;
			}
			left = { v: value, pct: false };
		}
		return left;
	};

	// term := power (('*'|'/'|'×'|'÷'|'x'|'%of') power)*
	Parser.prototype.term = function() {
		var left = this.power();
		if (this.failed) return null;
		while (!this.failed) {
			var tok = this.peek();
			if (!tok) break;
			var op = null;
			if (tok.type === '*' || tok.type === '\u00d7') op = 'mul';
			else if (tok.type === '/' || tok.type === '\u00f7') op = 'div';
			else if (tok.type === 'word' && tok.name === 'x') op = 'mul';
			else if (tok.type === 'word' &&
				tok.name.toLowerCase() === 'of' && left.pct) op = 'mul';
			if (!op) break;
			this.next();
			this.ops++;
			var right = this.power();
			if (this.failed) return null;
			var rv = right.pct ? right.v / 100 : right.v; // 150 * 10% -> 15
			// 20% of 150 -> 30: a percent on the LEFT is worth /100 too
			var lv = left.pct ? left.v / 100 : left.v;
			if (op === 'div' && rv === 0) { this.fail(); return null; }
			left = { v: op === 'mul' ? lv * rv : lv / rv, pct: false };
		}
		return left;
	};

	// power := unary ('^' unary)*
	Parser.prototype.power = function() {
		var left = this.unary();
		if (this.failed) return null;
		while (!this.failed && this.peek() && this.peek().type === '^') {
			this.next();
			this.ops++;
			var right = this.unary();
			if (this.failed) return null;
			var rv = right.pct ? right.v / 100 : right.v;
			if (left.pct) left = { v: left.v / 100, pct: false };
			left = { v: Math.pow(left.v, rv), pct: false };
		}
		return left;
	};

	// unary := ('-'|'+') unary | percent
	Parser.prototype.unary = function() {
		var tok = this.peek();
		if (tok && tok.type === '-') {
			this.next();
			var v = this.unary();
			if (this.failed) return null;
			return { v: -v.v, pct: v.pct };
		}
		if (tok && tok.type === '+') {
			this.next();
			return this.unary();
		}
		return this.percent();
	};

	// percent := primary '%'
	Parser.prototype.percent = function() {
		var v = this.primary();
		if (this.failed) return null;
		if (this.peek() && this.peek().type === '%') {
			this.next();
			return { v: v.v, pct: true }; // raw: 20 stays 20 until converted
		}
		return v;
	};

	// primary := NUMBER | name | '(' expression ')'
	Parser.prototype.primary = function() {
		var tok = this.next();
		if (!tok) { this.fail(); return null; }
		if (tok.type === 'num') {
			var value = parseNumberLiteral(tok.raw, this.seps);
			if (value === null) { this.fail(); return null; }
			return { v: value, pct: false };
		}
		if (tok.type === 'word') {
			// Only lowercase names are variables; 'Rent' mid-line stays a word.
			if (Object.prototype.hasOwnProperty.call(this.env, tok.name)) {
				return { v: this.env[tok.name], pct: false };
			}
			if (Object.prototype.hasOwnProperty.call(this.env, tok.name.toLowerCase())) {
				return { v: this.env[tok.name.toLowerCase()], pct: false };
			}
			this.fail();
			return null;
		}
		if (tok.type === '(') {
			var v = this.expression();
			if (this.failed) return null;
			var close = this.next();
			if (!close || close.type !== ')') { this.fail(); return null; }
			return v;
		}
		this.fail();
		return null;
	};

	// ------------------------------------------------------------------
	// Line evaluation
	// ------------------------------------------------------------------
	function tryLine(tokens, env, seps, labelSkips) {
		// Skip up to `labelSkips` leading words (labels like "rent" in
		// "rent 1800 / 3" or "groceries" in "groceries: 120 + 45").
		for (var skip = 0; skip <= labelSkips; skip++) {
			if (skip > 0) {
				if (!tokens[skip - 1] || tokens[skip - 1].type !== 'word') break;
			}
			var parser = new Parser(tokens.slice(skip), env, seps);
			var value = parser.expression();
			if (!parser.failed &&
				parser.pos === tokens.length - skip &&
				parser.ops > 0 &&
				value && isFinite(value.v)) {
				return value.v;
			}
		}
		return null;
	}

	function evaluateLine(line, env, seps) {
		var tokens = tokenize(line);
		if (tokens.length === 0) return null;

		// Assignment: `name = expression`. The name must be a single word
		// and the '=' the second token.
		if (tokens.length > 2 &&
			tokens[0].type === 'word' && tokens[1].type === '=') {
			var name = tokens[0].name.toLowerCase();
			var parser = new Parser(tokens.slice(2), env, seps);
			var value = parser.expression();
			if (!parser.failed &&
				parser.pos === tokens.length - 2 &&
				value && isFinite(value.v)) {
				env[name] = value.v;
				return value.v;
			}
			return null; // broken assignment: nothing to show, nothing defined
		}

		// Multi-word label before '=' — `fun money = 1500 - 900`. Not a
		// valid variable name, so nothing is defined, but the arithmetic
		// after the '=' still deserves its ghost result.
		for (var eq = 1; eq < tokens.length - 1; eq++) {
			if (tokens[eq].type !== '=') continue;
			var allWords = true;
			for (var w = 0; w < eq; w++) {
				if (tokens[w].type !== 'word') { allWords = false; break; }
			}
			if (!allWords) break;
			var labeled = new Parser(tokens.slice(eq + 1), env, seps);
			var lvalue = labeled.expression();
			if (!labeled.failed &&
				labeled.pos === tokens.length - eq - 1 &&
				labeled.ops > 0 &&
				lvalue && isFinite(lvalue.v)) {
				return lvalue.v;
			}
			break;
		}

		return tryLine(tokens, env, seps, 2);
	}

	// ------------------------------------------------------------------
	// Public API
	// ------------------------------------------------------------------
	function evaluate(lines, locale) {
		var seps = separatorsFor(locale);
		var fmt = formatterFor(locale);
		var env = {};

		return (lines || []).map(function(line) {
			var value = evaluateLine(String(line), env, seps);
			if (value === null || !isFinite(value)) return null;
			if (value === 0) value = 0; // normalize -0
			if (fmt) {
				try { return fmt.format(value); } catch (e) { /* fall through */ }
			}
			return String(Math.round(value * 1e6) / 1e6);
		});
	}

	return {
		evaluate: evaluate,
		// Exposed for tests/debugging only.
		_separatorsFor: separatorsFor
	};
})();
