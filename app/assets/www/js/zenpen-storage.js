// zenpen-storage.js
// Multi-document storage layer.
//
// Upstream ZenPen persists one document under the localStorage keys
// 'header' and 'content' — including via direct index access like
// localStorage['header'] = ... . This shim replaces window.localStorage
// with a Proxy so that every access form (index get/set, getItem/setItem,
// length, key()) keeps working while data is really stored per note:
//
//   noteHeaders          JSON map: id -> { id, header, created, modified }
//   note:<id>:header     note title HTML
//   note:<id>:content    note body HTML
//
// The current note id travels in the URL hash (#n<timestamp>), so notes
// are reopenable and back-navigation between notes works. A pre-existing
// single-document install is migrated into its own note on first run.
// All other keys ('wordCount', 'darkLayout', ...) pass through and remain
// global settings.

(function() {
	// ------------------------------------------------------------------
	// Access to the real backing store
	// ------------------------------------------------------------------
	var realStorage;
	try {
		realStorage = window.localStorage;
		if (!realStorage) throw new Error('no storage');
		var __probe = '__zenpen_probe__';
		realStorage.setItem(__probe, '1');
		realStorage.removeItem(__probe);
	} catch (e) {
		console.log('Kanso: storage unavailable, notes will not persist.');
		window.ZenPenStore = {
			listNotes: function() { return []; },
			touchNote: function() { return null; },
			deleteNote: function() {},
			restoreNote: function() {},
			currentNoteId: function() { return null; }
		};
		return;
	}
	window.__realStorage = realStorage;

	var META_KEY = 'noteHeaders';
	var PREFIX = 'note:';
	var NOTE_FIELDS = ['header', 'content'];

	function readMeta() {
		try {
			return JSON.parse(realStorage.getItem(META_KEY) || '{}');
		} catch (e) {
			return {};
		}
	}

	function writeMeta(meta) {
		realStorage.setItem(META_KEY, JSON.stringify(meta));
		scheduleExport();
	}

	function noteKey(id, field) {
		return PREFIX + id + ':' + field;
	}

	function stripToText(html) {
		var div = document.createElement('div');
		div.innerHTML = html || '';
		return (div.textContent || '').replace(/\s+/g, ' ').trim();
	}

	function isNoteField(name) {
		return NOTE_FIELDS.indexOf(name) !== -1;
	}

	// ------------------------------------------------------------------
	// One-time migration of upstream ZenPen's single-document keys
	// ------------------------------------------------------------------
	function migrateLegacy() {
		var legacyHeader = realStorage.getItem('header');
		var legacyContent = realStorage.getItem('content');
		if (legacyHeader === null && legacyContent === null) return;

		var id = 'n' + Date.now();
		var meta = readMeta();
		meta[id] = {
			id: id,
			header: stripToText(legacyHeader || '') || 'Untitled',
			created: Date.now(),
			modified: Date.now()
		};
		writeMeta(meta);
		if (legacyHeader !== null) {
			realStorage.setItem(noteKey(id, 'header'), legacyHeader);
			realStorage.removeItem('header');
		}
		if (legacyContent !== null) {
			realStorage.setItem(noteKey(id, 'content'), legacyContent);
			realStorage.removeItem('content');
		}
	}

	// ------------------------------------------------------------------
	// Note registry helpers (used by the notes list page and the shim)
	// ------------------------------------------------------------------
	function listNotes() {
		var meta = readMeta();
		var notes = [];
		for (var id in meta) {
			if (Object.prototype.hasOwnProperty.call(meta, id)) notes.push(meta[id]);
		}
		// Pinned first, then most recently modified
		notes.sort(function(a, b) {
			var pa = a.pinned ? 1 : 0;
			var pb = b.pinned ? 1 : 0;
			if (pa !== pb) return pb - pa;
			return b.modified - a.modified;
		});
		return notes;
	}

	function setPinned(id, pinned) {
		var meta = readMeta();
		if (!meta[id]) return;
		meta[id].pinned = !!pinned;
		writeMeta(meta);
	}

	function touchNote(id, headerHtml) {
		var meta = readMeta();
		if (!id) id = 'n' + Date.now();
		var entry = meta[id];
		if (!entry) {
			entry = {
				id: id,
				header: stripToText(headerHtml || '') || 'Untitled',
				created: Date.now(),
				modified: Date.now()
			};
		} else {
			var text = stripToText(headerHtml === undefined ? '' : headerHtml);
			if (text) entry.header = text;
			entry.modified = Date.now();
		}
		meta[id] = entry;
		writeMeta(meta);
		return entry;
	}

	function deleteNote(id) {
		var meta = readMeta();
		var backup = {
			entry: meta[id] || null,
			header: realStorage.getItem(noteKey(id, 'header')),
			content: realStorage.getItem(noteKey(id, 'content'))
		};
		delete meta[id];
		writeMeta(meta);
		realStorage.removeItem(noteKey(id, 'header'));
		realStorage.removeItem(noteKey(id, 'content'));
		return backup;
	}

	function restoreNote(backup) {
		if (!backup || !backup.entry) return;
		var meta = readMeta();
		meta[backup.entry.id] = backup.entry;
		writeMeta(meta);
		if (backup.header !== null) {
			realStorage.setItem(noteKey(backup.entry.id, 'header'), backup.header);
		}
		if (backup.content !== null) {
			realStorage.setItem(noteKey(backup.entry.id, 'content'), backup.content);
		}
	}

	function currentNoteId() {
		var m = location.hash.match(/^#(n\d+)$/);
		return m ? m[1] : null;
	}

	// ------------------------------------------------------------------
	// Backup mirror: notes survive reinstall / device move via Android
	// Auto Backup, which carries files/zenpen-notes.json (see
	// backup_rules.xml / data_extraction_rules.xml). localStorage is the
	// live store; this mirror is written after every change and imported
	// on startup when the live store is missing notes.
	// ------------------------------------------------------------------
	// Resolve the bridge lazily: it is normally present before scripts
	// run, but checking at call time keeps exports working even if it
	// appears late (and makes the layer testable with stubs).
	function getBridge() {
		return (typeof window.ZenPenAndroid !== 'undefined' &&
			window.ZenPenAndroid && window.ZenPenAndroid.exportNotes)
			? window.ZenPenAndroid : null;
	}

	function snapshotJson() {
		var payload = {
			version: 1,
			exported: Date.now(),
			notes: listNotes().map(function(note) {
				return {
					id: note.id,
					header: note.header,
					created: note.created,
					modified: note.modified,
					pinned: !!note.pinned,
					headerHtml: realStorage.getItem(noteKey(note.id, 'header')) || '',
					contentHtml: realStorage.getItem(noteKey(note.id, 'content')) || ''
				};
			}),
			settings: {
				darkLayout: realStorage.getItem('darkLayout'),
				wordCount: realStorage.getItem('wordCount')
			}
		};
		try {
			return JSON.stringify(payload);
		} catch (e) {
			return null;
		}
	}

	var exportTimer = null;

	function scheduleExport() {
		if (!getBridge()) return;
		clearTimeout(exportTimer);
		exportTimer = setTimeout(function() {
			var b = getBridge();
			var json = snapshotJson();
			if (json && b) b.exportNotes(json);
		}, 800);
	}

	function importBackup() {
		var b = getBridge();
		if (!b || !b.getNotesBackup) return false;
		var json;
		try {
			json = b.getNotesBackup();
		} catch (e) {
			return false;
		}
		if (!json) return false;

		var payload;
		try {
			payload = JSON.parse(json);
		} catch (e) {
			return false;
		}
		if (!payload || !payload.notes || !payload.notes.length) return false;

		var meta = readMeta();
		var liveCount = 0;
		for (var anyId in meta) {
			if (Object.prototype.hasOwnProperty.call(meta, anyId)) liveCount++;
		}
		// Only restore when the live store has nothing to lose
		if (liveCount > 0) return false;

		payload.notes.forEach(function(note) {
			meta[note.id] = {
				id: note.id,
				header: note.header || 'Untitled',
				created: note.created || Date.now(),
				modified: note.modified || Date.now(),
				pinned: !!note.pinned
			};
			if (note.headerHtml) {
				realStorage.setItem(noteKey(note.id, 'header'), note.headerHtml);
			}
			if (note.contentHtml) {
				realStorage.setItem(noteKey(note.id, 'content'), note.contentHtml);
			}
		});
		writeMeta(meta);

		// Settings too (harmless when null)
		if (payload.settings) {
			if (payload.settings.darkLayout !== null && payload.settings.darkLayout !== undefined) {
				realStorage.setItem('darkLayout', payload.settings.darkLayout);
			}
			if (payload.settings.wordCount !== null && payload.settings.wordCount !== undefined) {
				realStorage.setItem('wordCount', payload.settings.wordCount);
			}
		}
		return true;
	}

	// Restore BEFORE first paint of either page runs its render logic
	var restored = false;
	try {
		restored = importBackup();
	} catch (e) {
		restored = false;
	}
	// (No re-render needed on restore: this runs synchronously before
	// either page's own render logic reads the store.)

	// Leaving any page: flush pending mirror writes immediately
	window.addEventListener('pagehide', function() {
		var b = getBridge();
		if (!b) return;
		clearTimeout(exportTimer);
		var json = snapshotJson();
		if (json) b.exportNotes(json);
	});

	window.ZenPenStore = {
		listNotes: listNotes,
		touchNote: touchNote,
		deleteNote: deleteNote,
		restoreNote: restoreNote,
		setPinned: setPinned,
		// Runs automatically at load; exposed for a manual "restore"
		// action and for tests.
		importBackup: importBackup,
		currentNoteId: currentNoteId,
		noteContent: function(id) {
			return realStorage.getItem(noteKey(id, 'content')) || '';
		},
		// Body text of a stored note, for search matching
		noteBodyText: function(id) {
			var div = document.createElement('div');
			div.innerHTML = realStorage.getItem(noteKey(id, 'content')) || '';
			return (div.textContent || '').replace(/\s+/g, ' ').trim();
		},
		// Plain-text rendering of a stored note (used by both share paths:
		// the editor's share button and the list's long-press).
		notePlainText: function(id) {
			var meta = readMeta()[id];
			var title = (meta && meta.header) || '';
			var bodyHtml = realStorage.getItem(noteKey(id, 'content')) || '';

			// Render into a detached node so <br> produces real newlines
			var div = document.createElement('div');
			div.innerHTML = bodyHtml;

			var body = (div.innerText || div.textContent || '')
				.replace(/\n{3,}/g, '\n\n')
				.trim();

			// Never clobber a real title with 'Untitled' if the note has body text
			return (title ? title + '\n\n' + body : body).trim();
		}
	};

	// ------------------------------------------------------------------
	// Current-note context
	// ------------------------------------------------------------------
	var _currentId = null;

	function contextId() {
		if (_currentId) return _currentId;
		_currentId = currentNoteId();
		if (!_currentId) {
			// Reserve an id for a brand-new note; it only enters the list
			// once something is actually saved into it.
			_currentId = 'n' + Date.now();
			try {
				history.replaceState(null, '', '#' + _currentId);
			} catch (e) {
				location.hash = _currentId;
			}
		}
		return _currentId;
	}

	// Back/forward navigation between note hashes swaps documents by
	// reloading with the new id (the URL is the single source of truth).
	window.addEventListener('hashchange', function() {
		var id = currentNoteId();
		if (id && id !== _currentId) {
			location.reload();
		}
	});

	// ------------------------------------------------------------------
	// The storage shim itself. A Proxy because the editor writes via
	// localStorage['header'] = ... (plain index assignment), which a
	// plain object would swallow without persisting anything.
	// ------------------------------------------------------------------
	var shimTarget = {};

	function shimGetItem(name) {
		if (isNoteField(name)) {
			return realStorage.getItem(noteKey(contextId(), name));
		}
		return realStorage.getItem(name);
	}

	function shimSetItem(name, value) {
		if (isNoteField(name)) {
			var id = contextId();
			value = String(value);
			if (name === 'header' && stripToText(value) === '') {
				// Never clobber a saved title with a blank one
				return;
			}
			realStorage.setItem(noteKey(id, name), value);
			touchNote(id, name === 'header' ? value : undefined);
			scheduleExport();
			return;
		}
		realStorage.setItem(name, String(value));
	}

	function shimRemoveItem(name) {
		if (isNoteField(name)) {
			realStorage.removeItem(noteKey(contextId(), name));
			return;
		}
		realStorage.removeItem(name);
	}

	function realKeyCount() {
		var count = 0;
		for (var i = 0; i < realStorage.length; i++) {
			var k = realStorage.key(i);
			if (k !== 'header' && k !== 'content') count++;
		}
		return count;
	}

	function realKeyAt(index) {
		var keys = [];
		for (var i = 0; i < realStorage.length; i++) {
			var k = realStorage.key(i);
			if (k !== 'header' && k !== 'content') keys.push(k);
		}
		return keys[index] === undefined ? null : keys[index];
	}

	var methods = {
		getItem: shimGetItem,
		setItem: shimSetItem,
		removeItem: shimRemoveItem,
		key: realKeyAt,
		clear: function() { realStorage.clear(); }
	};

	var shim = new Proxy(shimTarget, {
		get: function(target, prop) {
			if (typeof prop === 'symbol') return undefined;
			if (Object.prototype.hasOwnProperty.call(methods, prop)) {
				return methods[prop];
			}
			if (prop === 'length') return realKeyCount();
			return shimGetItem(prop);
		},
		set: function(target, prop, value) {
			if (typeof prop === 'symbol') return true;
			shimSetItem(prop, value);
			return true;
		},
		deleteProperty: function(target, prop) {
			if (typeof prop === 'symbol') return true;
			shimRemoveItem(prop);
			return true;
		}
	});

	try {
		Object.defineProperty(window, 'localStorage', {
			get: function() { return shim; },
			configurable: true
		});
	} catch (e) {
		// Environment refuses to redefine localStorage; expose the shim so
		// our own pages can use it (upstream scripts would stay single-doc).
		console.log('Kanso: using fallback storage binding.');
		window.__zenpenShim = shim;
	}

	migrateLegacy();
})();
