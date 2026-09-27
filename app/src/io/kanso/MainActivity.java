package io.kanso.app;

import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Minimal native shell around the ZenPen web app.
 *
 * - Renders assets/www/index.html in a WebView with local storage enabled,
 *   so ZenPen's own persistence keeps working.
 * - Exposes a tiny "ZenPenAndroid" bridge used by js/mobile.js to hand saved
 *   documents to the system file picker (ACTION_CREATE_DOCUMENT) and to open
 *   article links in the user's browser.
 */
public class MainActivity extends Activity {

	private static final int REQUEST_SAVE = 4001;

	private WebView webView;
	private String pendingSaveData;
	private boolean immersiveMode = false;
	private int currentNightMode;

	/**
	 * The notes mirror: one JSON file in files/, included in Android Auto
	 * Backup (backup_rules.xml) and device transfer
	 * (data_extraction_rules.xml). The WebView's localStorage stays the
	 * live store; this file is what survives reinstalls and device moves.
	 */
	private File notesMirrorFile() {
		return new File(getFilesDir(), "zenpen-notes.json");
	}

	/** Atomic write: temp file + rename, so a crash never truncates it. */
	private void writeNotesMirror(String json) {
		File target = notesMirrorFile();
		File temp = new File(getFilesDir(), "zenpen-notes.json.tmp");
		FileOutputStream out = null;
		try {
			out = new FileOutputStream(temp);
			out.write(json.getBytes(StandardCharsets.UTF_8));
			out.flush();
			out.getFD().sync();
			out.close();
			out = null;
			if (!temp.renameTo(target)) {
				// Some filesystems refuse rename-over-existing
				target.delete();
				temp.renameTo(target);
			}
		} catch (IOException e) {
			// Mirror write failing must never take the app down
		} finally {
			if (out != null) {
				try { out.close(); } catch (IOException ignored) {}
			}
		}
	}

	private String readNotesMirror() {
		File file = notesMirrorFile();
		if (!file.exists()) return null;
		FileInputStream in = null;
		try {
			in = new FileInputStream(file);
			byte[] buffer = new byte[(int) file.length()];
			int read = in.read(buffer);
			return read > 0 ? new String(buffer, StandardCharsets.UTF_8) : null;
		} catch (IOException e) {
			return null;
		} finally {
			if (in != null) {
				try { in.close(); } catch (IOException ignored) {}
			}
		}
	}

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		// Follow the system theme for the window background (values-night
		// supplies the ink variant) to avoid flashes while loading
		getWindow().setBackgroundDrawable(
			new ColorDrawable(currentBackgroundColor()));

		webView = new WebView(this);
		setContentView(webView);

		WebSettings settings = webView.getSettings();
		settings.setJavaScriptEnabled(true);
		settings.setDomStorageEnabled(true);
		settings.setDatabaseEnabled(true);
		settings.setAllowFileAccess(false);
		settings.setAllowContentAccess(false);
		settings.setMediaPlaybackRequiresUserGesture(false);
		if (Build.VERSION.SDK_INT >= 29) {
			// ZenPen flips its own light/dark theme; don't let the OS interfere
			settings.setForceDark(WebSettings.FORCE_DARK_OFF);
		}

		webView.setBackgroundColor(currentBackgroundColor());

		webView.setWebViewClient(new WebViewClient() {
			@Override
			public boolean shouldOverrideUrlLoading(WebView view, String url) {
				if (url.startsWith("file://")) {
					return false;
				}
				openExternally(url);
				return true;
			}

			@Override
			public void onPageFinished(WebView view, String url) {
				super.onPageFinished(view, url);
				// Sync the page with the real IME state (e.g. after the
				// back button lands on the notes list)
				if (Build.VERSION.SDK_INT >= 30) {
					WindowInsets insets = view.getRootWindowInsets();
					if (insets != null) {
						notifyKeyboard(insets.getInsets(WindowInsets.Type.ime()).bottom > 0);
					}
				}
			}
		});
		webView.setWebChromeClient(new WebChromeClient());

		// Report keyboard visibility to the page (auto-hides the bottom
		// bar while typing). API 30+ reads the real IME insets; older
		// devices get nothing (the page's focus heuristic covers it).
		if (Build.VERSION.SDK_INT >= 30) {
			webView.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
				private Boolean lastVisible = null;

				@Override
				public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
					boolean visible = insets.getInsets(WindowInsets.Type.ime()).bottom > 0;
					if (lastVisible == null || lastVisible != visible) {
						lastVisible = visible;
						notifyKeyboard(visible);
					}
					return insets;
				}
			});
		}

		currentNightMode = getResources().getConfiguration().uiMode
			& android.content.res.Configuration.UI_MODE_NIGHT_MASK;

		webView.addJavascriptInterface(new Bridge(), "ZenPenAndroid");

		// The notes list is the home screen; individual notes live on
		// index.html#n<id> and Android's back button walks this history.
		webView.loadUrl("file:///android_asset/www/notes.html");
	}

	/** Tells the page whether the soft keyboard is up. */
	private void notifyKeyboard(boolean visible) {
		if (webView == null) return;
		webView.post(new Runnable() {
			@Override
			public void run() {
				webView.evaluateJavascript(
					"window.onZenPenKeyboardChanged && window.onZenPenKeyboardChanged("
						+ visible + ")", null);
			}
		});
	}

	/** ZenPen's paper/ink color for the current UI mode. */
	private int currentBackgroundColor() {
		int nightMode = getResources().getConfiguration().uiMode
			& android.content.res.Configuration.UI_MODE_NIGHT_MASK;
		boolean dark = nightMode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
		return Color.parseColor(dark ? "#111111" : "#FDFDFD");
	}

	private void openExternally(String url) {
		try {
			startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
		} catch (Exception ignored) {
			// No browser available; stay put
		}
	}

	private void toast(String message) {
		Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
	}

	/** Hides/shows the system bars and reports the real state to the page. */
	private void applyImmersive() {
		View decor = getWindow().getDecorView();
		if (Build.VERSION.SDK_INT >= 30) {
			WindowInsetsController controller = decor.getWindowInsetsController();
			if (controller != null) {
				if (immersiveMode) {
					controller.hide(WindowInsets.Type.systemBars());
					controller.setSystemBarsBehavior(
						WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
				} else {
					controller.show(WindowInsets.Type.systemBars());
				}
			}
		} else {
			int flags = View.SYSTEM_UI_FLAG_FULLSCREEN
				| View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
				| View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
			if (immersiveMode) {
				decor.setSystemUiVisibility(flags);
			} else {
				decor.setSystemUiVisibility(0);
			}
		}
		webView.evaluateJavascript(
			"window.onZenPenFullscreenChange && window.onZenPenFullscreenChange("
				+ immersiveMode + ")", null);
	}

	/**
	 * Bridge called from js/mobile.js
	 */
	private class Bridge {

		/** Page hands its full notes snapshot; written to the mirror. */
		@JavascriptInterface
		public void exportNotes(final String json) {
			writeNotesMirror(json);
		}

		/** Page asks for the mirror contents (null when absent). */
		@JavascriptInterface
		public String getNotesBackup() {
			return readNotesMirror();
		}

		@JavascriptInterface
		public void openExternal(final String url) {
			runOnUiThread(new Runnable() {
				@Override
				public void run() {
					openExternally(url);
				}
			});
		}

		@JavascriptInterface
		public void toggleFullscreen() {
			runOnUiThread(new Runnable() {
				@Override
				public void run() {
					immersiveMode = !immersiveMode;
					applyImmersive();
				}
			});
		}

		@JavascriptInterface
		public void shareText(final String subject, final String text) {
			runOnUiThread(new Runnable() {
				@Override
				public void run() {
					Intent send = new Intent(Intent.ACTION_SEND);
					send.setType("text/plain");
					send.putExtra(Intent.EXTRA_SUBJECT, subject);
					send.putExtra(Intent.EXTRA_TEXT, text);
					Intent chooser = Intent.createChooser(send, "Share note");
					try {
						startActivity(chooser);
					} catch (Exception e) {
						toast("Nothing can share right now");
					}
				}
			});
		}

		@JavascriptInterface
		public void saveText(final String filename, final String data) {
			runOnUiThread(new Runnable() {
				@Override
				public void run() {
					pendingSaveData = data;
					Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
					intent.addCategory(Intent.CATEGORY_OPENABLE);
					intent.setType("text/plain");
					intent.putExtra(Intent.EXTRA_TITLE, filename);
					try {
						startActivityForResult(intent, REQUEST_SAVE);
					} catch (Exception e) {
						toast("Saving is not available on this device");
					}
				}
			});
		}
	}

	@Override
	protected void onActivityResult(int requestCode, int resultCode, Intent data) {
		super.onActivityResult(requestCode, resultCode, data);

		if (requestCode != REQUEST_SAVE || resultCode != RESULT_OK
				|| data == null || data.getData() == null) {
			pendingSaveData = null;
			return;
		}

		Uri uri = data.getData();
		OutputStream out = null;
		try {
			out = getContentResolver().openOutputStream(uri);
			if (out == null) {
				throw new IllegalStateException("No output stream for " + uri);
			}
			out.write(pendingSaveData.getBytes(StandardCharsets.UTF_8));
			out.flush();
			toast("Saved ✓");
			notifySaveComplete(true);
		} catch (Exception e) {
			toast("Couldn't save the file");
			notifySaveComplete(false);
		} finally {
			if (out != null) {
				try { out.close(); } catch (Exception ignored) {}
			}
			pendingSaveData = null;
		}
	}

	private void notifySaveComplete(final boolean ok) {
		webView.post(new Runnable() {
			@Override
			public void run() {
				webView.evaluateJavascript(
					"window.onNativeSaveComplete && window.onNativeSaveComplete(" + ok + ",'')",
					null);
			}
		});
	}

	@Override
	public void onConfigurationChanged(Configuration newConfig) {
		super.onConfigurationChanged(newConfig);

		// Day/night flipped (system schedule, battery saver): re-tint the
		// chrome and let the page follow, unless the user picked a theme
		int newMode = newConfig.uiMode & Configuration.UI_MODE_NIGHT_MASK;
		int oldMode = currentNightMode;
		currentNightMode = newMode;

		if (newMode != oldMode && webView != null) {
			int color = currentBackgroundColor();
			getWindow().setBackgroundDrawable(new ColorDrawable(color));
			webView.setBackgroundColor(color);
			boolean systemIsDark = newMode == Configuration.UI_MODE_NIGHT_YES;
			webView.evaluateJavascript(
				"window.onZenPenSystemThemeChanged && window.onZenPenSystemThemeChanged("
					+ systemIsDark + ")", null);
		}
	}

	@Override
	public void onBackPressed() {
		// Walk the in-app history (notes list <-> notes) before exiting
		if (webView != null && webView.canGoBack()) {
			webView.goBack();
		} else {
			super.onBackPressed();
		}
	}

	@Override
	protected void onPause() {
		super.onPause();
		if (webView != null) webView.onPause();
	}

	@Override
	protected void onResume() {
		super.onResume();
		if (webView != null) webView.onResume();
	}

	@Override
	protected void onDestroy() {
		if (webView != null) webView.destroy();
		super.onDestroy();
	}
}
