// drawer.js — the notes list as an in-editor drawer.
//
// The writing screen is the only screen. This drawer slides over it:
//   - open with a swipe from the left edge or the top-right 3-dots button
//   - tap a row to open that note
//   - swipe a row sideways for quick actions (left = delete, right = pin)
//   - hold a row for the full menu: save, share, pin, delete
// Closing and open-state travel through History, so Android's back
// button closes the drawer instead of leaving the note.

(function() {
	// Safety cap on rendered rows; nobody scrolls a phone list past this.
	var MAX_ROWS = 400;

	// Edge-swipe gate: only gestures starting this close to the left
	// edge open the drawer (otherwise scrolling the page would too).
	var EDGE_ZONE = 28;

	// ------------------------------------------------------------------
	// Element handles
	// ------------------------------------------------------------------
	var drawer, scrim, fab, listEl, emptyEl, noResultsEl;
	var searchWrap, searchInput, searchClear, actionsBackdrop, confirmBackdrop;

	var query = '';

	// ------------------------------------------------------------------
	// Undo toast for deletions (kept from the old notes screen)
	// ------------------------------------------------------------------
	var undoTimer = null;
	var lastDelete = null;

	function ensureToast() {
		if (document.querySelector('.undo-toast')) return;
		var toast = document.createElement('div');
		toast.className = 'undo-toast';
		toast.innerHTML = 'Note deleted <button>Undo</button>';
		document.body.appendChild(toast);
		toast.querySelector('button').addEventListener('click', function() {
			if (lastDelete) {
				window.ZenPenStore.restoreNote(lastDelete);
				lastDelete = null;
			}
			hideToast();
			render();
		});
	}

	function hideToast() {
		var toast = document.querySelector('.undo-toast');
		if (toast) toast.style.display = 'none';
		clearTimeout(undoTimer);
	}

	function showToast() {
		ensureToast();
		var toast = document.querySelector('.undo-toast');
		toast.style.display = 'flex';
		clearTimeout(undoTimer);
		undoTimer = setTimeout(hideToast, 5000);
	}

	// ------------------------------------------------------------------
	// Search helpers (same matching as the old notes page)
	// ------------------------------------------------------------------
	function escapeRegExp(s) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function renderTitle(el, text) {
		el.textContent = '';
		if (!query) {
			el.textContent = text;
			return;
		}
		var re = new RegExp('(' + escapeRegExp(query) + ')', 'ig');
		text.split(re).forEach(function(part) {
			if (!part) return;
			if (part.toLowerCase() === query.toLowerCase()) {
				var mark = document.createElement('mark');
				mark.textContent = part;
				el.appendChild(mark);
			} else {
				el.appendChild(document.createTextNode(part));
			}
		});
	}

	function buildSnippet(note) {
		var body = window.ZenPenStore.noteBodyText(note.id);
		if (!body) return '';
		var idx = body.toLowerCase().indexOf(query.toLowerCase());
		if (idx === -1) return '';
		var start = Math.max(0, idx - 30);
		var end = Math.min(body.length, idx + query.length + 40);
		return (start > 0 ? '…' : '') + body.slice(start, end) +
			(end < body.length ? '…' : '');
	}

	function relTime(ts) {
		var diff = Date.now() - ts;
		var mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return mins + ' min ago';
		var hours = Math.floor(mins / 60);
		if (hours < 24) return hours + 'h ago';
		var days = Math.floor(hours / 24);
		if (days === 1) return 'yesterday';
		if (days < 30) return days + ' days ago';
		return new Date(ts).toLocaleDateString();
	}

	// ------------------------------------------------------------------
	// Row building
	// ------------------------------------------------------------------
	function buildRow(note) {
		var li = document.createElement('li');
		if (note.pinned) li.className = 'pinned';

		var title = document.createElement('div');
		title.className = 'note-title';
		renderTitle(title, note.header || 'Untitled');
		li.appendChild(title);

		var meta = document.createElement('div');
		meta.className = 'note-meta';
		meta.textContent = relTime(note.modified);
		li.appendChild(meta);

		if (note.pinned) {
			var label = document.createElement('div');
			label.className = 'note-pinned-label';
			label.textContent = 'pinned';
			li.appendChild(label);
		}

		if (query) {
			var snippet = buildSnippet(note);
			if (snippet) {
				var bodyEl = document.createElement('div');
				bodyEl.className = 'note-snippet';
				renderTitle(bodyEl, snippet);
				li.appendChild(bodyEl);
			}
		}

		// The two hint arrows shown while a row is being dragged.
		li.appendChild(makeMarker('left'));
		li.appendChild(makeMarker('right'));

		li.addEventListener('click', function() {
			openNote(note.id);
		});

		attachRowGestures(li, note);
		return li;
	}

	function makeMarker(side) {
		var m = document.createElement('span');
		m.className = 'note-marker ' + side;
		m.textContent = side === 'left' ? '•' : '•';
		return m;
	}

	function openNote(id) {
		closeDrawer(true);
		// Same id → same page; only swap the document when it differs.
		if (window.ZenPenStore.currentNoteId() === id) return;
		flushEditorState();
		location.href = 'index.html#' + id;
	}

	function flushEditorState() {
		try {
			if (window.ZenPen && ZenPen.editor) ZenPen.editor.saveState();
		} catch (e) { /* leaving anyway */ }
	}

	// ------------------------------------------------------------------
	// Row gestures: tap / horizontal swipe / long-press, disambiguated.
	// Movement beyond SLOP cancels tap and hold; horizontal intent
	// converts the touch into a row swipe.
	// ------------------------------------------------------------------
	var SLOP = 12;
	var HOLD_MS = 550;

	function attachRowGestures(li, note) {
		var startX = 0, startY = 0, startTime = 0;
		var mode = 'pending'; // pending | hold-fired | horizontal | vertical | done
		var holdTimer = null;
		var deleteZone = false;

		function clearHold() {
			clearTimeout(holdTimer);
			holdTimer = null;
		}

		function width() { return li.offsetWidth || 300; }

		function setDrag(dx) {
			li.classList.add('dragging');
			li.style.transform = 'translateX(' + dx + 'px)';
			// Left drag past 40% of the row arms delete; right past 40%
			// arms pin-toggle. The arrows preview the armed action.
			var armed = Math.abs(dx) > width() * 0.4;
			if (armed && dx < 0 && !deleteZone) {
				deleteZone = true;
				if (navigator.vibrate) navigator.vibrate(10);
			} else if (!armed && deleteZone) {
				deleteZone = false;
			}
			var left = li.querySelector('.note-marker.left');
			var right = li.querySelector('.note-marker.right');
			if (left) left.style.opacity = armed && dx < 0 ? 0.9 : 0;
			if (right) right.style.opacity = armed && dx > 0 ? 0.9 : 0;
		}

		function settle() {
			li.classList.remove('dragging');
			li.style.transform = '';
			li.querySelectorAll('.note-marker').forEach(function(m) {
				m.style.opacity = 0;
			});
		}

		li.addEventListener('touchstart', function(e) {
			if (e.touches.length !== 1) { mode = 'done'; return; }
			mode = 'pending';
			deleteZone = false;
			var t = e.touches[0];
			startX = t.clientX;
			startY = t.clientY;
			startTime = Date.now();
			clearHold();
			holdTimer = setTimeout(function() {
				if (mode !== 'pending') return;
				mode = 'hold-fired';
				if (navigator.vibrate) navigator.vibrate(15);
				openActions(note);
			}, HOLD_MS);
		}, { passive: true });

		li.addEventListener('touchmove', function(e) {
			if (mode === 'done' || mode === 'hold-fired') return;
			var t = e.touches[0];
			var dx = t.clientX - startX;
			var dy = t.clientY - startY;

			if (mode === 'pending') {
				if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
					mode = 'vertical'; // scrolling the list
					clearHold();
					return;
				}
				if (Math.abs(dx) > SLOP) {
					mode = 'horizontal';
					clearHold();
				}
			}
			if (mode === 'horizontal') {
				e.preventDefault(); // keep the page from scrolling mid-swipe
				setDrag(dx);
			}
		});

		li.addEventListener('touchend', function(e) {
			clearHold();
			if (mode === 'horizontal') {
				var t = e.changedTouches[0];
				var dx = t.clientX - startX;
				var w = width();
				if (dx < 0 && -dx > w * 0.4) {
					settle();
					confirmDelete(note);
				} else if (dx > 0 && dx > w * 0.4) {
					settle();
					window.ZenPenStore.setPinned(note.id, !note.pinned);
					render();
				} else {
					// Not far enough: snap back
					li.classList.add('dragging');
					li.style.transform = '';
					setTimeout(settle, 200);
				}
				mode = 'done';
				suppressClick(li);
				return;
			}
			if (mode === 'hold-fired') {
				mode = 'done';
				suppressClick(li);
				return;
			}
			mode = 'done';
		});

		li.addEventListener('touchcancel', function() {
			clearHold();
			settle();
			mode = 'done';
		});

		// Desktop/testing parity: right-click opens the action menu.
		li.addEventListener('contextmenu', function(e) {
			e.preventDefault();
			openActions(note);
		});

		// A fired gesture must not ALSO act as a tap.
		li.addEventListener('click', function(e) {
			if (li.__suppressClick) {
				e.stopImmediatePropagation();
				e.preventDefault();
				li.__suppressClick = false;
			}
		}, true);

		function suppressClick(el) {
			el.__suppressClick = true;
			setTimeout(function() { el.__suppressClick = false; }, 350);
		}
	}

	// ------------------------------------------------------------------
	// Hold action sheet: save, share, pin, delete
	// ------------------------------------------------------------------
	function openActions(note) {
		actionsBackdrop.hidden = false;
		actionsBackdrop.querySelector('.note-actions-title').textContent =
			note.header || 'Untitled';

		var pinBtn = actionsBackdrop.querySelector('[data-action="pin"]');
		pinBtn.textContent = note.pinned ? 'Unpin' : 'Pin';

		actionsBackdrop.__noteId = note.id;
	}

	function closeActions() {
		actionsBackdrop.hidden = true;
		actionsBackdrop.__noteId = null;
	}

	function handleAction(action) {
		var id = actionsBackdrop.__noteId;
		closeActions();
		if (!id) return;

		var meta = window.ZenPenStore.listNotes().find(function(n) { return n.id === id; });

		if (action === 'pin') {
			window.ZenPenStore.setPinned(id, !(meta && meta.pinned));
			render();
		} else if (action === 'delete') {
			confirmDelete(meta);
		} else if (action === 'share') {
			shareNote(id);
		} else if (action === 'save') {
			saveNoteAsFile(meta);
		}
	}

	// ------------------------------------------------------------------
	// Actions on a note
	// ------------------------------------------------------------------
	function shareNote(id) {
		if (typeof window.ZenPenAndroid === 'undefined' ||
			!window.ZenPenAndroid.shareText) {
			console.log('Kanso: sharing needs the Android app.');
			return;
		}
		var meta = window.ZenPenStore.listNotes().find(function(n) { return n.id === id; });
		window.ZenPenAndroid.shareText(
			(meta && meta.header) || 'Kanso note',
			window.ZenPenStore.notePlainText(id));
	}

	// "Save as file": open the note, then trigger ZenPen's save modal on
	// the next frame. The native saveText bridge does the actual export.
	function saveNoteAsFile(meta) {
		if (!meta) return;
		var isCurrent = window.ZenPenStore.currentNoteId() === meta.id;
		if (isCurrent) {
			openSaveModal();
		} else {
			flushEditorState();
			sessionStorage.setItem('kanso-save-on-load', '1');
			location.href = 'index.html#' + meta.id;
		}
	}

	function openSaveModal() {
		var saveBtn = document.querySelector('.save');
		if (saveBtn) saveBtn.click();
	}

	function confirmDelete(note) {
		if (!note) return;
		confirmBackdrop.hidden = false;
		confirmBackdrop.querySelector('.confirm-text').textContent =
			'Delete “' + (note.header || 'Untitled') + '”?';
		confirmBackdrop.__noteId = note.id;
	}

	function closeConfirm() {
		confirmBackdrop.hidden = true;
		confirmBackdrop.__noteId = null;
	}

	function doDelete() {
		var id = confirmBackdrop.__noteId;
		closeConfirm();
		if (!id) return;
		if (id === window.ZenPenStore.currentNoteId()) {
			// Deleting the open note: clear the editor's view of it. The
			// storage shim keys writes by hash, so swap to a fresh hash.
			var next = window.ZenPenStore.listNotes().find(function(n) { return n.id !== id; });
			flushEditorState();
			if (window.__realStorage) {
				window.__realStorage.removeItem('note:' + id + ':header');
				window.__realStorage.removeItem('note:' + id + ':content');
			}
			window.ZenPenStore.deleteNote(id);
			if (next) {
				location.href = 'index.html#' + next.id;
			} else {
				location.hash = 'n' + Date.now();
				location.reload();
			}
			return;
		}
		lastDelete = window.ZenPenStore.deleteNote(id);
		render();
		showToast();
	}

	// ------------------------------------------------------------------
	// Render
	// ------------------------------------------------------------------
	function render() {
		var notes = window.ZenPenStore.listNotes();
		var filtered = notes;
		if (query) {
			var q = query.toLowerCase();
			filtered = notes.filter(function(note) {
				if ((note.header || '').toLowerCase().indexOf(q) !== -1) return true;
				return window.ZenPenStore.noteBodyText(note.id)
					.toLowerCase().indexOf(q) !== -1;
			});
		}

		listEl.innerHTML = '';
		emptyEl.hidden = notes.length > 0;
		noResultsEl.hidden = !(notes.length > 0 && filtered.length === 0);
		searchWrap.hidden = notes.length === 0;

		// Cap the DOM size; very large collections paginate silently.
		var shown = filtered.slice(0, MAX_ROWS);
		shown.forEach(function(note) {
			listEl.appendChild(buildRow(note));
		});
	}

	// ------------------------------------------------------------------
	// Open / close (with History so Android back closes it)
	// ------------------------------------------------------------------
	function isOpen() {
		return document.body.classList.contains('drawer-open');
	}

	function openDrawer(pushState) {
		if (isOpen()) return;
		document.body.classList.add('drawer-open');
		drawer.setAttribute('aria-hidden', 'false');
		scrim.hidden = false;
		requestAnimationFrame(function() {
			scrim.classList.add('visible');
		});
		render();
		if (pushState !== false && !history.state || !(history.state && history.state.drawer)) {
			try {
				history.pushState({ drawer: true }, '');
			} catch (e) { /* private mode quirks */ }
		}
	}

	function closeDrawer(skipPop) {
		if (!isOpen()) return;
		document.body.classList.remove('drawer-open');
		drawer.setAttribute('aria-hidden', 'true');
		scrim.classList.remove('visible');
		setTimeout(function() {
			if (!isOpen()) scrim.hidden = true;
		}, 320);
		if (skipPop !== true) {
			// Drop the drawer entry we pushed; popstate fires and calls us
			// again, which is then a no-op.
			if (history.state && history.state.drawer) history.back();
		}
	}

	window.addEventListener('popstate', function(e) {
		if (isOpen() && !(e.state && e.state.drawer)) {
			closeDrawer(true);
		}
	});

	// ------------------------------------------------------------------
	// Edge swipe: start near the left edge, drag right to open.
	// ------------------------------------------------------------------
	function attachEdgeSwipe() {
		var startX = 0, startY = 0, active = false;

		document.addEventListener('touchstart', function(e) {
			if (isOpen()) return;
			if (e.touches.length !== 1) return;
			var t = e.touches[0];
			if (t.clientX > EDGE_ZONE) return;
			// Don't hijack touches that start on interactive controls
			// near the edge (bubble buttons etc.)
			if (e.target.closest && e.target.closest('button, input, a')) return;
			startX = t.clientX;
			startY = t.clientY;
			active = true;
		}, { passive: true });

		document.addEventListener('touchmove', function(e) {
			if (!active) return;
			var t = e.touches[0];
			var dx = t.clientX - startX;
			var dy = t.clientY - startY;
			if (Math.abs(dy) > SLOP && Math.abs(dy) > Math.abs(dx)) {
				active = false; // vertical scroll wins
				return;
			}
			if (dx > SLOP) {
				active = false;
				openDrawer();
			}
		}, { passive: true });

		document.addEventListener('touchend', function() {
			active = false;
		}, { passive: true });
	}

	// ------------------------------------------------------------------
	// Init
	// ------------------------------------------------------------------
	function init() {
		drawer = document.querySelector('.drawer');
		scrim = document.querySelector('.drawer-scrim');
		fab = document.querySelector('.drawer-fab');
		listEl = document.querySelector('.note-list');
		emptyEl = document.querySelector('.notes-empty');
		noResultsEl = document.querySelector('.no-results');
		searchWrap = document.querySelector('.note-search');
		searchInput = document.querySelector('.note-search-input');
		searchClear = document.querySelector('.note-search-clear');
		actionsBackdrop = document.querySelector('.note-actions-backdrop');
		confirmBackdrop = document.querySelector('.confirm-backdrop');

		fab.addEventListener('click', function() {
			if (isOpen()) closeDrawer(); else openDrawer();
		});

		scrim.addEventListener('click', function() { closeDrawer(); });

		document.querySelector('.new-note').addEventListener('click', function() {
			closeDrawer(true);
			if (window.ZenPenStore.currentNoteId() === null) {
				render();
				return; // already a fresh note
			}
			flushEditorState();
			location.href = 'index.html';
		});

		searchInput.addEventListener('input', function() {
			query = searchInput.value.trim();
			searchClear.hidden = query === '';
			render();
		});

		searchClear.addEventListener('click', function() {
			searchInput.value = '';
			query = '';
			searchClear.hidden = true;
			render();
			searchInput.focus();
		});

		actionsBackdrop.addEventListener('click', function(e) {
			if (e.target === actionsBackdrop) { closeActions(); return; }
			var btn = e.target.closest('button[data-action]');
			if (btn) handleAction(btn.getAttribute('data-action'));
		});

		confirmBackdrop.addEventListener('click', function(e) {
			if (e.target === confirmBackdrop) { closeConfirm(); return; }
			if (e.target.closest('.confirm-cancel')) closeConfirm();
			if (e.target.closest('.confirm-ok')) doDelete();
		});

		attachEdgeSwipe();

		// The old back-button handler in mobile.js navigated to
		// notes.html, which no longer exists; .notes-back is gone too.

		// A queued "save this note" (from the drawer's hold menu) fires
		// once the note is loaded.
		try {
			if (sessionStorage.getItem('kanso-save-on-load') === '1') {
				sessionStorage.removeItem('kanso-save-on-load');
				setTimeout(openSaveModal, 250);
			}
		} catch (e) { /* no sessionStorage */ }

		render();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	// mobile.js nudges this after autosaves and theme flips so the list
	// always shows current titles/timestamps.
	window.refreshKansoDrawer = function() {
		if (listEl && window.ZenPenStore) render();
	};
})();
