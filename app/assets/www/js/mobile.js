// mobile.js
// Adaptation layer for running ZenPen inside an Android WebView.
// Everything ZenPen does stays untouched; this file only:
//   1. keeps the editor focusable/tappable on touch devices,
//   2. works around a Chromium IME caret bug in very long text nodes,
//   3. shows the format bubble on touch-based text selection,
//   4. autosaves on mobile IME input (keyup alone misses composition),
//   5. routes "save" and link taps to the host app (ZenPenAndroid bridge).
(function() {
	var isAndroidBridge = typeof window.ZenPenAndroid !== 'undefined';

	// ----------------------------------------------------------------
	// Theme: follow the system on first launch.
	//
	// 'darkLayout' is absent  -> follow the OS (prefers-color-scheme)
	// 'darkLayout' is set     -> explicit in-app choice, always wins
	//
	// Runs before ZenPen.ui.init() (which only applies an explicit
	// pref), so a system-dark first launch opens dark.
	// ----------------------------------------------------------------
	function systemWantsDark() {
		return window.matchMedia &&
			window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	function explicitThemePref() {
		try {
			var v = window.__realStorage.getItem('darkLayout');
			if (v === 'true') return true;
			if (v === 'false') return false;
		} catch (e) { /* treat as system */ }
		return null;
	}

	function applyTheme(dark) {
		// classList, not className: the body also carries state classes
		// like 'drawer-open', which must survive theme flips.
		document.body.classList.toggle('yang', dark);
		document.body.classList.toggle('yin', !dark);
	}

	(function bootstrapTheme() {
		// Absent pref = follow system right now
		if (explicitThemePref() === null) {
			applyTheme(systemWantsDark());
		}
		// Live flips while no explicit choice has been made
		if (window.matchMedia) {
			window.matchMedia('(prefers-color-scheme: dark)')
				.addEventListener('change', function(e) {
					if (explicitThemePref() === null) {
						applyTheme(e.matches);
					}
				});
		}
	})();

	// Native side reports Android's day/night change (e.g. "Follow
	// system" schedule, battery saver)
	window.onZenPenSystemThemeChanged = function(systemIsDark) {
		if (explicitThemePref() === null) {
			applyTheme(!!systemIsDark);
		}
		// The drawer picks up ink/paper variables from the body class
		if (window.refreshKansoDrawer) window.refreshKansoDrawer();
	};

	// ----------------------------------------------------------------
	// Auto-hide the bottom bar while the keyboard is open.
	// Primary signal: the native side watches WindowInsets and calls
	// onZenPenKeyboardChanged. Fallback (plain browser): the editor is
	// considered "typing" while its fields hold focus — focus events
	// track the soft keyboard closely enough there.
	// ----------------------------------------------------------------
	window.onZenPenKeyboardChanged = function(keyboardVisible) {
		var ui = document.querySelector('.ui');
		if (ui) ui.classList.toggle('bar-hidden', !!keyboardVisible);
	};

	// Keep --zen-bar-h in sync with the real bar height so the page's
	// bottom padding tracks the bar even when large system fonts grow it.
	document.addEventListener('DOMContentLoaded', function() {
		var ui = document.querySelector('.ui');
		if (!ui) return;
		function syncBarHeight() {
			document.documentElement.style.setProperty(
				'--zen-bar-h', ui.offsetHeight + 'px');
		}
		syncBarHeight();
		if (window.ResizeObserver) {
			new ResizeObserver(syncBarHeight).observe(ui);
		} else {
			window.addEventListener('resize', syncBarHeight);
		}
	});

	document.addEventListener('DOMContentLoaded', function() {
		if (isAndroidBridge) return; // native insets drive it

		var editableFocus = function(e) {
			var t = e.target;
			if (t && t.classList &&
				(t.classList.contains('content') || t.classList.contains('header'))) {
				document.querySelector('.ui').classList.add('bar-hidden');
			}
		};
		var editableBlur = function(e) {
			var t = e.target;
			if (t && t.classList &&
				(t.classList.contains('content') || t.classList.contains('header'))) {
				// Ignore blur-to-bubble interactions (format buttons etc.)
				setTimeout(function() {
					var sel = window.getSelection();
					var focused = document.activeElement;
					var stillEditing = (focused && focused.classList &&
						(focused.classList.contains('content') ||
						 focused.classList.contains('header')));
					if (!stillEditing && (!sel || sel.isCollapsed || sel.rangeCount === 0)) {
						document.querySelector('.ui').classList.remove('bar-hidden');
					}
				}, 250);
			}
		};
		document.addEventListener('focusin', editableFocus);
		document.addEventListener('focusout', editableBlur);
	});

	// Own the color-flip click entirely. ZenPen's own handler toggles
	// from an internal flag that desyncs from the DOM when the theme
	// follows the system (first press would visibly do nothing), so it's
	// stopped in the capture phase and replaced with a deterministic
	// toggle that persists the outcome as an explicit choice.
	document.addEventListener('click', function(e) {
		var btn = e.target;
		while (btn && btn !== document) {
			if (btn.classList && btn.classList.contains('color-flip')) break;
			btn = btn.parentNode;
		}
		if (!btn || btn === document) return;

		e.stopPropagation();
		e.preventDefault();

		var dark = document.body.classList.contains('yang');
		dark = !dark;
		applyTheme(dark);
		try {
			window.__realStorage.setItem('darkLayout', dark ? 'true' : 'false');
		} catch (e2) { /* non-persistent is fine */ }
	}, true);

	// Neutralize screenfull inside the WebView: the Fullscreen API isn't
	// available on file:// pages, so ZenPen's fullscreen button would
	// silently do nothing. Fullscreen is handled natively (immersive
	// mode) via the ZenPenAndroid bridge instead.
	if (isAndroidBridge && window.screenfull) {
		window.screenfull = {
			enabled: false,
			isFullscreen: false,
			toggle: function() {},
			raw: { fullscreenchange: 'zenpen-noop' }
		};
	}

	// ------------------------------------------------------------------
	// 1. Make the contenteditable fields reliably tappable on touch
	//    (WebView needs tabindex for .focus() and a nudge on taps that
	//    land in the padding area of the fields)
	// ------------------------------------------------------------------
	document.addEventListener('DOMContentLoaded', function() {
		var header = document.querySelector('.header');
		var content = document.querySelector('.content');
		if (!header || !content) return;

		header.setAttribute('tabindex', '0');
		content.setAttribute('tabindex', '0');

		function tapToFocus(field) {
			field.addEventListener('touchend', function(e) {
				// Only when the tap didn't land on an existing inline element
				if (e.target === field) {
					setTimeout(function() { field.focus(); }, 10);
				}
			});
		}
		tapToFocus(header);
		tapToFocus(content);
	});

	// ------------------------------------------------------------------
	// 2. Chromium IME caret bug: composition (autocorrect/GBoard swipe)
	//    misplaces the caret when the caret sits inside a single text
	//    node longer than ~482 characters. Split long nodes so that
	//    never happens. Runs after every input as a safety net.
	// ------------------------------------------------------------------
	var SPLIT_LIMIT = 400;

	function splitLongTextNodes() {
		var root = document.querySelector('.content');
		if (!root) return;

		var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
		var nodes = [];
		while (walker.nextNode()) {
			if (walker.currentNode.nodeValue.length > SPLIT_LIMIT) {
				nodes.push(walker.currentNode);
			}
		}

		for (var i = 0; i < nodes.length; i++) {
			var node = nodes[i];
			var parent = node.parentNode;
			if (!parent) continue;
			var value = node.nodeValue;
			var offset = 0;
			while (offset < value.length) {
				var chunk = value.slice(offset, offset + SPLIT_LIMIT);
				var textNode = document.createTextNode(chunk);
				parent.insertBefore(textNode, node);
				offset += SPLIT_LIMIT;
			}
			parent.removeChild(node);
		}
	}

	// ------------------------------------------------------------------
	// 3. Touch selection bubble + 4. autosave, driven by 'input'
	//    (covers IME composition, which keyup misses on mobile)
	// ------------------------------------------------------------------
	var saveDebounce = null;

	document.addEventListener('input', function(e) {
		var t = e.target;
		if (!t || !(t.classList && (t.classList.contains('content') || t.classList.contains('header')))) {
			return;
		}

		// Debounced autosave (ZenPen's saveState on keyup still runs too)
		clearTimeout(saveDebounce);
		saveDebounce = setTimeout(function() {
			ZenPen.editor.saveState();
			splitLongTextNodes();
			refreshListNotes();
		}, 300);
	});

	// Show the format bubble on selection handles dragged on touch
	document.addEventListener('selectionchange', function() {
		// small delay so the selection settles after handle drags
		clearTimeout(window.__selTimer);
		window.__selTimer = setTimeout(function() {
			var sel = window.getSelection();
			if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;

		// Match desktop ZenPen: the bubble only appears for selections
		// inside the article body, not the title
		var anchor = sel.anchorNode;
		var focus = sel.focusNode;
		var inEditor = false;
		var content = document.querySelector('.content');
		while (anchor) { if (anchor === content) { inEditor = true; break; } anchor = anchor.parentNode; }
		while (focus) { if (focus === content) { inEditor = true; break; } focus = focus.parentNode; }
		if (!inEditor) return;

			var textOptions = document.querySelector('.text-options');
			if (!textOptions) return;

			// Position via the editor's own placer (bubble now sits BELOW
			// the selection, arrow up — the desktop mouse path uses the
			// same logic). Fallback keeps the math inline for safety.
			if (window.ZenPen && ZenPen.editor &&
				ZenPen.editor.updateBubblePosition) {
				ZenPen.editor.updateBubblePosition();
			} else {
				textOptions.style.top = rect.bottom + 12 + window.pageYOffset + 'px';
				textOptions.style.left = (rect.left + rect.right) / 2 + 'px';
			}
			textOptions.className = 'text-options active';
		}, 250);
	});

	// ------------------------------------------------------------------
	// 5. Native bridge: saving files + opening links outside the app
	// ------------------------------------------------------------------
	function flushEditorState() {
		try {
			if (window.ZenPen && ZenPen.editor &&
				document.querySelector('.content')) {
				ZenPen.editor.saveState();
			}
		} catch (e) { /* leaving anyway */ }
	}

	// ----------------------------------------------------------------
	// Inline math mode: per-note flag, ghost results overlay.
	// ----------------------------------------------------------------
	function mathButton() {
		return document.querySelector('.ui button.math');
	}

	function currentMathOn() {
		try {
			return window.ZenPenStore &&
				ZenPenStore.mathEnabled(ZenPenStore.currentNoteId());
		} catch (e) {
			return false;
		}
	}

	function syncMathButton() {
		var btn = mathButton();
		if (btn) btn.classList.toggle('active', currentMathOn());
	}

	function toggleMathMode() {
		var id = window.ZenPenStore && ZenPenStore.currentNoteId();
		if (!id) return;
		flushEditorState();
		var next = !currentMathOn();
		ZenPenStore.setMath(id, next);
		syncMathButton();
		updateMathOverlay();
	}

	// ----------------------------------------------------------------
	// Ghost results overlay. One absolutely-positioned layer above the
	// article (a sibling, never a child — nothing ever enters the saved
	// HTML), pointer-events: none. Results are keyed by line index and
	// value so steady-state typing doesn't re-trigger the fade; new
	// results fade in, vanished results fade out.
	// ----------------------------------------------------------------
	var mathOverlayEl = null;
	var mathRafPending = false;
	var mathFadeTimers = {};

	function mathOverlay() {
		if (!mathOverlayEl) mathOverlayEl = document.querySelector('.math-overlay');
		return mathOverlayEl;
	}

	function isBlockEl(el) {
		return /^(P|DIV|LI|UL|OL|BLOCKQUOTE|H[1-6]|PRE)$/.test(el.nodeName);
	}

	// Split the article into the lines the user sees: block children are
	// lines, <br> starts a new line, nested blocks (blockquote > p) too.
	// Each line records its text and a Range position just past its last
	// character, for later client-rect measurement.
	function collectMathLines(root) {
		var lines = [];
		var seg = [];

		function flush() {
			if (seg.length === 0) {
				lines.push(null); // empty visual line
				return;
			}
			var text = '';
			for (var i = 0; i < seg.length; i++) text += seg[i].nodeValue;
			var last = seg[seg.length - 1];
			lines.push({ text: text, endNode: last, endOffset: last.nodeValue.length });
			seg = [];
		}

		function walk(node) {
			for (var c = node.firstChild; c; c = c.nextSibling) {
				if (c.nodeType === 3) {
					seg.push(c);
				} else if (c.nodeType === 1) {
					if (c.nodeName === 'BR') {
						flush();
					} else if (isBlockEl(c)) {
						flush();
						walk(c);
						flush();
					} else {
						walk(c); // inline: b, i, a, span...
					}
				}
			}
		}

		walk(root);
		flush();
		return lines;
	}

	function updateMathOverlay() {
		var overlay = mathOverlay();
		if (!overlay || !document.querySelector('.content')) return;
		if (!currentMathOn()) {
			// Off: clear once and do no work at all.
			overlay.innerHTML = '';
			return;
		}
		if (mathRafPending) return;
		mathRafPending = true;
		requestAnimationFrame(function() {
			mathRafPending = false;
			renderMathOverlay();
		});
	}

	function renderMathOverlay() {
		var overlay = mathOverlay();
		var article = document.querySelector('.content');
		if (!overlay || !article) return;

		// Track the article's box so results align with the text column.
		overlay.style.left = article.offsetLeft + 'px';
		overlay.style.width = article.offsetWidth + 'px';

		var lines = collectMathLines(article);
		var texts = [];
		for (var i = 0; i < lines.length; i++) {
			texts.push(lines[i] ? lines[i].text : '');
		}

		var results;
		try {
			results = ZenPen.inlineMath.evaluate(texts, navigator.language);
		} catch (e) {
			return;
		}

		// Desired set: key -> { top, left, text }
		var wanted = {};
		var wrapRect = overlay.getBoundingClientRect();
		for (var j = 0; j < results.length; j++) {
			if (results[j] === null || !lines[j]) continue;
			var pos = lineEndRect(lines[j], overlay);
			if (!pos) continue;
			var key = j + ':' + results[j];
			wanted[key] = {
				top: pos.top,
				left: pos.left,
				rightAlign: pos.left === null,
				text: '= ' + results[j]
			};
		}

		// Fade out results that disappeared.
		var existing = overlay.querySelectorAll('.math-result');
		for (var k = 0; k < existing.length; k++) {
			var el = existing[k];
			var key2 = el.getAttribute('data-key');
			if (wanted[key2]) {
				// Kept: reposition silently, cancel any fade-out.
				el.style.top = wanted[key2].top + 'px';
				if (wanted[key2].rightAlign) {
					el.classList.add('wrapped');
					el.style.left = '';
				} else {
					el.classList.remove('wrapped');
					el.style.left = wanted[key2].left + 'px';
				}
				el.classList.remove('fading');
				clearTimeout(mathFadeTimers[key2]);
				delete wanted[key2];
			} else if (!el.classList.contains('fading')) {
				el.classList.add('fading');
				(function(node, k3) {
					mathFadeTimers[k3] = setTimeout(function() {
						if (node.parentNode) node.parentNode.removeChild(node);
						delete mathFadeTimers[k3];
					}, 180);
				})(el, key2);
			}
		}

		// Fade in new results.
		for (var key3 in wanted) {
			if (!Object.prototype.hasOwnProperty.call(wanted, key3)) continue;
			clearTimeout(mathFadeTimers[key3]);
			delete mathFadeTimers[key3];
			var spec = wanted[key3];
			var ghost = document.createElement('span');
			ghost.className = spec.rightAlign ?
				'math-result wrapped' : 'math-result';
			ghost.setAttribute('data-key', key3);
			ghost.textContent = spec.text;
			ghost.style.top = spec.top + 'px';
			if (!spec.rightAlign) ghost.style.left = spec.left + 'px';
			overlay.appendChild(ghost);
			requestAnimationFrame(function(node) {
				return function() { node.classList.add('shown'); };
			}(ghost));
		}
	}

	// Measure where a line's last character ends, in overlay coordinates.
	// The last client rect of a collapsed range at the line end is the
	// final visual row of wrapped lines.
	function lineEndRect(line, overlay) {
		var range = document.createRange();
		try {
			range.setStart(line.endNode, line.endOffset);
			range.collapse(true);
		} catch (e) {
			return null;
		}
		var rects = range.getClientRects();
		var rect = null;
		for (var i = 0; i < rects.length; i++) {
			if (rects[i].width > 0 || rects[i].height > 0) rect = rects[i];
		}
		if (!rect && line.endNode.parentNode) {
			rect = line.endNode.parentNode.getBoundingClientRect();
		}
		if (!rect) return null;

		var wrapRect = overlay.getBoundingClientRect();
		var left = rect.right - wrapRect.left + 8;
		var top = rect.top - wrapRect.top;

		// Past the right edge of the text column: own row underneath,
		// right-aligned with the column.
		var width = 40; // refined after insert
		if (left + width > overlay.clientWidth) {
			return { top: top + rect.height + 2, left: null }; // right-align pass
		}
		return { top: top, left: left };
	}

	// Recompute triggers. Input/composition cover typing; resize covers
	// rotation; theme changes re-render too (cheap while it lasts).
	document.addEventListener('input', function(e) {
		if (e.target && e.target.classList &&
			(e.target.classList.contains('content') ||
			 e.target.classList.contains('header'))) {
			updateMathOverlay();
		}
	});

	document.addEventListener('compositionend', updateMathOverlay);

	document.addEventListener('DOMContentLoaded', function() {
		var btn = mathButton();
		if (btn) btn.addEventListener('click', toggleMathMode);
		syncMathButton();
		updateMathOverlay();
		// Late font load shifts metrics; re-measure once it settles.
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready.then(updateMathOverlay);
		}
	});

	window.addEventListener('resize', updateMathOverlay);

	// New notes: ZenPen's welcome template is right for a user's very
	// first note (it teaches the editor), but every later "New note"
	// should start empty. defaultTitle/defaultContent are consumed by
	// ZenPen.editor.init() below, so adjust them right before that runs.
	(function () {
		try {
			var freshNote = window.ZenPenStore &&
				ZenPenStore.currentNoteId() === null;
			var hasOtherNotes = window.ZenPenStore &&
				ZenPenStore.listNotes().length > 0;
			if (freshNote && hasOtherNotes) {
				window.defaultTitle = '';
				window.defaultContent = '<p><br></p>';
			}
		} catch (e) { /* keep the template */ }
	})();

	// Empty/new notes: upstream init places the cursor with
	// range.setStart(headerField, 1), which throws on an empty header.
	// Wrap init so a fresh note opens with the cursor safely in the body
	// instead. mobile.js runs before index.html's inline init() call, so
	// this must happen now (not on DOMContentLoaded) to take effect.
	if (window.ZenPen && ZenPen.editor) {
		var origEditorInit = ZenPen.editor.init;
		ZenPen.editor.init = function() {
			try {
				origEditorInit();
			} catch (e) {
				try {
					var content = document.querySelector('.content');
					var range = document.createRange();
					range.setStart(content, 0);
					range.collapse(true);
					var sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
				} catch (e2) { /* keyboard will handle focus */ }
			}
		};
	}

	// Keep the notes drawer current: call after every autosave, and on
	// demand (theme flips, etc.). Rewriting the list is cheap and keeps
	// timestamps/edits from other notes accurate without navigation.
	function refreshListNotes() {
		if (window.refreshKansoDrawer) window.refreshKansoDrawer();
	}

	// Hardware back (and any other navigation): persist the editor
	// before the page goes away.
	document.addEventListener('pagehide', flushEditorState);

	// Upstream's scroll handler calls getRangeAt(0) without checking that
	// a selection exists (throws on fresh/empty notes).
	document.addEventListener('scroll', function(e) {
		if (window.getSelection().rangeCount === 0) {
			// Nothing selected; nothing to reposition. Stop other listeners
			// from seeing this event round-trip through ZenPen's handler.
			e.stopImmediatePropagation();
		}
	}, true);

	if (isAndroidBridge) {

		// Route ZenPen's "save" through the host app: FileSaver's
		// hidden-anchor trick does nothing inside a WebView, so intercept
		// saveAs() and hand the bytes to the native side instead.
		window.saveAs = function(blob, filename) {
			var reader = new FileReader();
			reader.onload = function() {
				window.ZenPenAndroid.saveText(String(filename), String(reader.result));
			};
			reader.readAsText(blob);
		};

		// The hidden copy box steals focus (and pops the keyboard) when a
		// save format is picked; give focus straight back to the page.
		var hidden = document.querySelector('.hiddentextbox');
		if (hidden) {
			hidden.setAttribute('readonly', 'readonly');
			hidden.addEventListener('focus', function() {
				setTimeout(function() { hidden.blur(); }, 0);
			});
		}

		// Fullscreen: forward taps to the native immersive-mode toggle.
		// (ZenPen's own onclick still runs, but the screenfull stub above
		// makes it a harmless no-op.)
		document.addEventListener('DOMContentLoaded', function() {
			var fsButton = document.querySelector('.fullscreen');
			if (fsButton) {
				fsButton.addEventListener('click', function() {
					window.ZenPenAndroid.toggleFullscreen();
				});
			}
		});

		// Open links (author links, saved <a> tags) in the browser instead
		// of navigating the editor away
		document.addEventListener('click', function(e) {
			var a = e.target;
			while (a && a.nodeName !== 'A') a = a.parentNode;
			if (a && a.href && !a.classList.contains('about')) {
				// only catch links inside the article
				var insideContent = false;
				var node = a;
				while (node) {
					if (node.classList && node.classList.contains('content')) { insideContent = true; break; }
					node = node.parentNode;
				}
				if (insideContent) {
					e.preventDefault();
					window.ZenPenAndroid.openExternal(a.href);
				}
			}
		});
	}

	// Called from the Android side when a save was completed (toast)
	window.onNativeSaveComplete = function(ok, message) {
		if (typeof console !== 'undefined') {
			console.log('save complete: ' + ok + ' ' + message);
		}
	};

	// Called from the Android side after immersive mode toggles, so the
	// button icon matches the real state (expand <-> contract)
	window.onZenPenFullscreenChange = function(fullscreen) {
		var btn = document.querySelector('.fullscreen');
		if (btn) {
			btn.innerHTML = fullscreen ? '&#xe004;' : '&#xe000;';
		}
	};
})();
