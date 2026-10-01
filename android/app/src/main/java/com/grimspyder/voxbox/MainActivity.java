package com.grimspyder.voxbox;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate so the plugin is available to the
        // bridge by the time the web layer loads and asks for its secrets.
        registerPlugin(SecureStorePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
