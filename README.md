# Kanso

*A quiet place to write.* 簡素 — *kanso* — is one of the Zen aesthetic
principles: simplicity.

Kanso is a minimalist, distraction-free note-taking app for Android:
multi-note, searchable, pinnable, shareable, with automatic backups and a
light/dark theme that follows your system. It began as a fork of the
wonderful [ZenPen](https://zenpen.io) web editor by
[Tim Holman](https://tholman.com) (MIT-licensed) and grew from there into a
full Android app — the editor you see is ZenPen's soul, wrapped in a native
shell and extended with everything below.

## Install

Grab the latest APK from the
[Releases page](https://github.com/rock-devv/kanso-android/releases), copy
it to your phone and open it (enable "install from unknown sources" when
prompted). Requires Android 7.0+.

## What it does

- **One writing screen** — the notes list is a drawer: swipe in from the
  left edge or tap the ⋮ button. Tap a note to open it, swipe it for quick
  actions (delete with confirmation, pin), or hold it for the full menu
  (save, share, pin, delete with undo).
- **Search & pin** — live search over titles *and* note bodies with
  highlighted hits and snippets; pin notes to keep them at the top.
- **Share** — the editor's share button, or a note's hold menu in the
  drawer, hands the note to Android's share sheet.
- **Save** — export any note as Markdown, HTML, or plain text through the
  system file picker.
- **Native-feeling text selection** — Android's copy/cut menu is
  suppressed while Kanso's own format bubble (bold, italic, quote, link)
  opens below your selection, clear of the system handles.
- **Inline math** (optional, per note) — tap the ± button and lines with
  calculations show a faint `= 42` ghost result as you type: `20% of 150`,
  `rent = 1800` then `rent / 3`, `150 + 10%`. Understands your locale's
  number format, shows nothing in prose lines, and stores only what you
  typed — results are overlay text, never part of the note.
- **Auto Backup** — notes mirror to `files/zenpen-notes.json` and ride
  Android Auto Backup / device transfer; a fresh install re-imports them
  automatically (the live store always wins, so restores never clobber
  newer edits).
- **Theming** — follows the system dark theme on first launch (native
  night resources included); the invert button sets an explicit override.
- **Polish** — auto-hiding bottom bar while typing, hidden scrollbars,
  48px touch targets, large-font-safe layout.

## Credits

- [ZenPen](https://github.com/tholman/zenpen) by Tim Holman — the
  foundation of the editor, MIT license.
- Lora typeface by Cyreal, via Google Fonts (OFL).

---

For contributors: the app builds with a Gradle-free pipeline
(`build.sh` + GitHub Actions CI), and all icon generators live in
`tools/`. Details live in the code and workflow files.
