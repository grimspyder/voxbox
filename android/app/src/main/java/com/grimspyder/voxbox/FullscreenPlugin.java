package com.grimspyder.voxbox;

import android.view.View;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Fullscreen for the Android build.
 *
 * Why this exists at all: the dashboard offers a FULLSCREEN button, and on the
 * web that is one call to the browser's Fullscreen API. Inside the Android
 * WebView the same call does nothing. Capacitor's own WebChromeClient answers
 * {@code onShowCustomView} by immediately calling {@code callback.onCustomViewHidden()}
 * (see node_modules/@capacitor/android …/BridgeWebChromeClient.java), i.e. it
 * refuses the fullscreen view outright, and the dashboard discards the rejected
 * promise — which is why the button looked dead rather than reporting an error.
 *
 * So the shell does not ask the WebView for fullscreen at all. It hides the
 * system bars itself, which is both reliable and the behaviour a phone user
 * expects: the panel fills the screen, and the bars come back on a swipe.
 *
 * Deliberate choices:
 *  - {@code BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE} on the compat controller, so
 *    gesture navigation still reaches the status and navigation bars. Without
 *    it the user can be trapped in fullscreen with no way out but a force-quit.
 *  - The decor view still fits the system windows, so this only ever changes
 *    bar visibility. The page already pads by {@code env(safe-area-inset-*)}
 *    with {@code viewport-fit=cover}, so when the bars are hidden those insets
 *    collapse to zero and the panel simply gets the whole screen.
 *  - Immersive mode is dropped by the framework whenever the window regains
 *    focus (a dialog, the app switcher, a permission prompt), so it is re-applied
 *    in {@code handleOnResume} while the user is still in fullscreen.
 *  - No native libraries, so the release ledger's "no native code" finding
 *    (ANDROID-09) stays true, exactly as for SecureStorePlugin.
 */
@CapacitorPlugin(name = "Fullscreen")
public class FullscreenPlugin extends Plugin {

    /** Whether this plugin is currently hiding the system bars. */
    private boolean active = false;

    private WindowInsetsControllerCompat insetsController() {
        Window window = getActivity().getWindow();
        View decorView = window.getDecorView();
        return WindowCompat.getInsetsController(window, decorView);
    }

    /** Show or hide the system bars, and remember which it now is. */
    private void apply(boolean hide) {
        WindowInsetsControllerCompat controller = insetsController();
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (hide) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars());
        }
        active = hide;
    }

    private JSObject state() {
        JSObject result = new JSObject();
        result.put("active", active);
        return result;
    }

    /**
     * Always true on this platform — the SDK level is irrelevant because the
     * compat controller covers the legacy system-UI flags too. It is reported
     * rather than assumed so the web layer can pick a backend instead of
     * guessing, and so an older API level degrades to the web path rather than
     * to silence.
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        call.resolve(result);
    }

    @PluginMethod
    public void enter(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            apply(true);
            call.resolve(state());
        });
    }

    @PluginMethod
    public void exit(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            apply(false);
            call.resolve(state());
        });
    }

    @PluginMethod
    public void isActive(PluginCall call) {
        call.resolve(state());
    }

    @Override
    protected void handleOnResume() {
        // Immersive mode does not survive the window losing focus, and silently
        // reverting out of fullscreen is exactly the "it did nothing" bug this
        // plugin was written to remove.
        if (active) apply(true);
    }
}
