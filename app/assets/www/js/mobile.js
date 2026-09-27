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
		document.body.className = dark ? 'yang' : 'yin';
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

		var dark = document.body.className === 'yang';
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

			var range = sel.getRangeAt(0);
			var rect = range.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return;

			textOptions.style.top = rect.top - 5 + window.pageYOffset + 'px';
			textOptions.style.left = (rect.left + rect.right) / 2 + 'px';
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

	// Plain-text rendering of the current note: title as subject, body
	// paragraphs as lines. Mirrors ZenPen's "Plain Text" save format.
	function shareSubject() {
		try {
			var header = document.querySelector('.header');
			var text = header ? header.textContent.replace(/(\t|\n|\r)/gm, '').trim() : '';
			return text || 'ZenPen note';
		} catch (e) {
			return 'ZenPen note';
		}
	}

	function shareBodyText() {
		// Preferred: read from the store (same code path as the notes-list
		// long-press share; works even if the DOM is in a weird state).
		try {
			if (window.ZenPenStore && ZenPenStore.currentNoteId()) {
				var fromStore = ZenPenStore.notePlainText(ZenPenStore.currentNoteId());
				if (fromStore) return fromStore;
			}
		} catch (e) { /* fall through to the DOM */ }

		// Fallback: read straight from the page (e.g. before first save)
		try {
			var content = document.querySelector('.content');
			var body = content ? content.innerText.replace(/\n{3,}/g, '\n\n').trim() : '';
			return (shareSubject() + '\n\n' + body).trim();
		} catch (e) {
			return '';
		}
	}

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

	// Back-to-notes-list button + pending-edit flush. Pure web behavior,
	// so it's wired regardless of the native bridge.
	document.addEventListener('DOMContentLoaded', function() {
		var back = document.querySelector('.notes-back');
		if (back) {
			back.addEventListener('click', function() {
				flushEditorState();
				location.href = 'notes.html';
			});
		}

		// Share: hand the current note (plain text) to Android's share
		// sheet. Pending edits are flushed first so the latest text goes out.
		// The bridge is checked at click time, not bind time, so the button
		// also works when the bridge appears late (or in test harnesses).
		var shareButton = document.querySelector('.share');
		if (shareButton) {
			shareButton.addEventListener('click', function() {
				if (typeof window.ZenPenAndroid === 'undefined' ||
					!window.ZenPenAndroid.shareText) {
					console.log('Kanso: sharing needs the Android app.');
					return;
				}
				flushEditorState();
				window.ZenPenAndroid.shareText(shareSubject(), shareBodyText());
			});
		}
	});

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
