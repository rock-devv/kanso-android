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

Copy `ZenPen.apk` to your phone and open it (enable "install from unknown
sources" when prompted). Requires Android 7.0+.

## What it does

- **Multi-note** — a notes list home screen; create, open, delete (5s undo).
- **Search & pin** — live search over titles *and* note bodies with
  highlighted hits and snippets; pin notes to keep them at the top.
- **Share** — the editor's share button, or long-press a note in the list,
  hands the note to Android's share sheet.
- **Save** — export any note as Markdown, HTML, or plain text through the
  system file picker.
- **Auto Backup** — notes mirror to `files/zenpen-notes.json` and ride
  Android Auto Backup / device transfer; a fresh install re-imports them
  automatically (the live store always wins, so restores never clobber
  newer edits).
- **Theming** — follows the system dark theme on first launch (native
  night resources included); the invert button sets an explicit override.
- **Polish** — auto-hiding bottom bar while typing, hidden scrollbars,
  48px touch targets, large-font-safe layout.

## Architecture

- `app/assets/www/` — the web app: ZenPen's editor code plus adaptations:
  - `js/zenpen-storage.js` — multi-note storage shim. Replaces
    `window.localStorage` with a Proxy so the editor code is unchanged
    while notes live under per-note keys (`note:<id>:header/content` plus
    a `noteHeaders` index). Also owns the backup mirror (export/import).
  - `notes.html` / `css/notes.css` / `js/notes.js` — the notes list.
  - `js/mobile.js` — WebView glue: tap-to-focus, IME caret workaround,
    touch-selection bubble, theming bootstrap, keyboard-aware bar,
    and the `ZenPenAndroid` bridge calls.
  - `css/mobile.css` — phones-only layout fixes (below 800px).
  - `css/lora/` — Lora webfont bundled locally (fully offline).
- `app/src/io/kanso/app/MainActivity.java` — the native shell: a WebView
  with DOM storage, and a JS bridge: save (`ACTION_CREATE_DOCUMENT`),
  share (`ACTION_SEND`), fullscreen (immersive mode), external links,
  notes-mirror read/write, keyboard-visibility events.

## Build

No Gradle needed — just the Android SDK build tools:

```bash
./build.sh        # produces ZenPen.apk (expects ./sdk with build-tools 37.0.0)
```

The script compiles resources (aapt2), Java (javac), dexes (d8), packages,
zipaligns, and signs with `zenpen.keystore` (generated on first build,
password: `zenpen`). Keep the keystore if you ever want to ship an update —
Android refuses updates signed with a different key.

Signing can be overridden via environment variables (used by CI):

```bash
KEYSTORE=release.keystore KS_PASS=... KEY_PASS=... ./build.sh
```

## CI

Every push builds and signs the APK via GitHub Actions
(`.github/workflows/build.yml`) and uploads it as the `ZenPen-apk`
artifact. To sign releases with your real key, add two repository
secrets:

- `ZENPEN_KEYSTORE_B64` — base64 of the keystore (`base64 -w0 zenpen.keystore`)
- `ZENPEN_KEYSTORE_PASS` — its password

Without the secrets, CI still produces a signed APK using an ephemeral
generated keystore — fine for testing, but each build then needs a
fresh install (different key every run).

## Regenerate icons

```bash
python3 tools/make_icons.py
```

## Credits

- [ZenPen](https://github.com/tholman/zenpen) by Tim Holman — the
  foundation of the editor, MIT license.
- Lora typeface by Cyreal, via Google Fonts (OFL).
