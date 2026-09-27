// notes.js — behavior for the multi-note home screen.
(function() {
	var listEl = document.querySelector('.note-list');
	var emptyEl = document.querySelector('.notes-empty');
	var newBtn = document.querySelector('.new-note');
	var undoTimer = null;
	var lastDelete = null;

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

	var query = '';
	var noResultsEl = null;

	function buildRow(note) {
		var li = document.createElement('li');
		if (note.pinned) li.className = 'pinned';

		var del = document.createElement('button');
		del.className = 'note-delete';
		del.textContent = 'delete';
		del.addEventListener('click', function(e) {
			e.stopPropagation();
			removeNote(note.id);
		});

		var pin = document.createElement('button');
		pin.className = 'note-pin';
		pin.textContent = note.pinned ? 'unpin' : 'pin';
		pin.title = note.pinned ? 'Unpin note' : 'Pin to top';
		pin.addEventListener('click', function(e) {
			e.stopPropagation();
			window.ZenPenStore.setPinned(note.id, !note.pinned);
			render();
		});

		var title = document.createElement('div');
		title.className = 'note-title';
		renderTitle(title, note.header || 'Untitled');

		var meta = document.createElement('div');
		meta.className = 'note-meta';
		meta.textContent = relTime(note.modified);

		li.appendChild(title);
		li.appendChild(meta);

		if (note.pinned) {
			var label = document.createElement('div');
			label.className = 'note-pinned-label';
			label.textContent = 'pinned';
			li.appendChild(label);
		}

		// Search hit inside the body: show a context snippet
		if (query) {
			var snippet = buildSnippet(note);
			if (snippet) {
				var bodyEl = document.createElement('div');
				bodyEl.className = 'note-snippet';
				renderTitle(bodyEl, snippet);
				li.appendChild(bodyEl);
			}
		}

		li.appendChild(pin);
		li.appendChild(del);
		li.addEventListener('click', function() {
			location.href = 'index.html#' + note.id;
		});

		// Long-press the row to share without opening the note.
		attachLongPress(li, note.id);

		return li;
	}

	// Escape regex specials so queries like "c++" or "(draft)" work
	function escapeRegExp(s) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function renderTitle(el, text) {
		// Fills el with text, wrapping query matches in <mark>
		el.textContent = '';
		if (!query) {
			el.textContent = text;
			return;
		}
		var re = new RegExp('(' + escapeRegExp(query) + ')', 'ig');
		var parts = text.split(re);
		parts.forEach(function(part) {
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
		var prefix = start > 0 ? '…' : '';
		var suffix = end < body.length ? '…' : '';
		return prefix + body.slice(start, end) + suffix;
	}

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
		document.querySelector('.notes-hint').hidden = notes.length === 0;

		filtered.forEach(function(note) {
			listEl.appendChild(buildRow(note));
		});
	}

	// Long-press (hold ~600ms) triggers the share sheet via the native
	// bridge. Cancelled by movement (scroll intent) or early release;
	// the suppressed click won't open the note afterwards.
	var LONG_PRESS_MS = 600;

	function attachLongPress(el, noteId) {
		var timer = null;
		var fired = false;
		var startX = 0;
		var startY = 0;

		function cancel() {
			clearTimeout(timer);
			timer = null;
		}

		function fire() {
			cancel();
			fired = true;
			shareNote(noteId);
		}

		el.addEventListener('touchstart', function(e) {
			fired = false;
			var t = e.touches[0];
			startX = t.clientX;
			startY = t.clientY;
			timer = setTimeout(fire, LONG_PRESS_MS);
		}, { passive: true });

		el.addEventListener('touchmove', function(e) {
			if (!timer) return;
			var t = e.touches[0];
			// Any real movement cancels (user is scrolling, not pressing)
			if (Math.abs(t.clientX - startX) > 10 ||
				Math.abs(t.clientY - startY) > 10) {
				cancel();
			}
		}, { passive: true });

		el.addEventListener('touchend', cancel);
		el.addEventListener('touchcancel', cancel);

		// Right-click parity (desktop/testing) — matches the native
		// Android list long-press behavior
		el.addEventListener('contextmenu', function(e) {
			e.preventDefault();
			shareNote(noteId);
		});

		// A long-press must not ALSO open the note on release
		el.addEventListener('click', function(e) {
			if (fired) {
				e.stopImmediatePropagation();
				e.preventDefault();
				fired = false;
			}
		}, true);
	}

	function shareNote(id) {
		if (typeof window.ZenPenAndroid === 'undefined' ||
			!window.ZenPenAndroid.shareText) {
			console.log('Kanso: sharing needs the Android app.');
			return;
		}
		var text = window.ZenPenStore.notePlainText(id);
		var meta = window.ZenPenStore.listNotes().find(function(n) { return n.id === id; });
		var subject = (meta && meta.header) || 'ZenPen note';
		window.ZenPenAndroid.shareText(subject, text);
	}

	function removeNote(id) {
		lastDelete = window.ZenPenStore.deleteNote(id);
		render();

		var toast = document.querySelector('.undo-toast');
		toast.style.display = 'flex';
		clearTimeout(undoTimer);
		undoTimer = setTimeout(function() {
			toast.style.display = 'none';
			lastDelete = null;
		}, 5000);
	}

	function init() {
		noResultsEl = document.createElement('p');
		noResultsEl.className = 'no-results';
		noResultsEl.hidden = true;
		noResultsEl.textContent = 'No notes match your search.';
		listEl.parentNode.insertBefore(noResultsEl, listEl.nextSibling);

		// Search: live filter on titles and bodies
		var searchWrap = document.querySelector('.note-search');
		var input = document.querySelector('.note-search-input');
		var clearBtn = document.querySelector('.note-search-clear');
		searchWrap.hidden = window.ZenPenStore.listNotes().length === 0;

		input.addEventListener('input', function() {
			query = input.value.trim();
			clearBtn.hidden = query === '';
			render();
		});
		clearBtn.addEventListener('click', function() {
			input.value = '';
			query = '';
			clearBtn.hidden = true;
			render();
			input.focus();
		});

		// Theme: explicit pref wins; otherwise follow the system
		try {
			var pref = window.__realStorage.getItem('darkLayout');
			var dark;
			if (pref === 'true') dark = true;
			else if (pref === 'false') dark = false;
			else dark = !!(window.matchMedia &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
			if (dark) document.body.className = 'yang';
		} catch (e) { /* stay light */ }

		document.querySelector('.new-note').addEventListener('click', function() {
			// The editor reserves its id from the hash; going in without a
			// hash starts a fresh, untitled note.
			location.href = 'index.html';
		});

		var toast = document.createElement('div');
		toast.className = 'undo-toast';
		toast.innerHTML = 'Note deleted <button>Undo</button>';
		document.body.appendChild(toast);
		toast.querySelector('button').addEventListener('click', function() {
			if (lastDelete) {
				window.ZenPenStore.restoreNote(lastDelete);
				lastDelete = null;
			}
			toast.style.display = 'none';
			render();
		});

		render();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
