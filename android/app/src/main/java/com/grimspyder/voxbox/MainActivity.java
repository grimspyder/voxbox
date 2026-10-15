package com.grimspyder.voxbox;

import android.os.Bundle;

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
        super.onCreate(savedInstanceState);
    }
}
