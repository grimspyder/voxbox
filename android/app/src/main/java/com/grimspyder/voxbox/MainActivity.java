package com.grimspyder.voxbox;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate so the plugin is available to the
        // bridge by the time the web layer loads and asks for its secrets.
        registerPlugin(SecureStorePlugin.class);
        // Also app-local, so it has to be registered explicitly: Capacitor only
        // auto-discovers npm plugins from the generated capacitor.plugins.json.
        // Without this the dashboard's fullscreen call rejects and the button is
        // dead again (BUGS.md B-17).
        registerPlugin(FullscreenPlugin.class);
        // Speed sampling for traffic alerts. App-local, so it must be registered
        // explicitly like the other two; without this the JS bridge call rejects
        // and drive mode cannot start.
        registerPlugin(SpeedMonitorPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        // Keep the display awake only while Voxbox is in the foreground; restore
        // the user's normal screen timeout as soon as the app is no longer visible.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    public void onStop() {
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        super.onStop();
    }
}
