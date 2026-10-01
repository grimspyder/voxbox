package com.grimspyder.voxbox;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Keystore-backed secret storage for the Android build.
 *
 * The point of this plugin is the one property the browser store cannot offer:
 * the AES key lives in the Android Keystore, is non-exportable, and on most
 * devices is held in secure hardware. The ciphertext sits in app-private
 * preferences, so reading that file — with root, or from a backup — yields
 * nothing usable without the Keystore.
 *
 * Consequences that are deliberate, not oversights:
 *  - Keystore entries are destroyed when the app is uninstalled, so stored
 *    ciphertext becomes undecryptable. A reinstalled app therefore cannot
 *    silently restore credentials; get() reports them as absent and the user is
 *    asked to re-enter (production requirements §40).
 *  - The key is settable-updated by the user's lock screen changes on some
 *    devices, which can invalidate it. That surfaces the same way: absent, then
 *    re-entry, never a crash or a silent failure.
 *  - No user-authentication requirement is set, so opening the app does not
 *    demand a biometric prompt. Storing keys behind a lock screen is a possible
 *    future hardening step, not a shipping requirement.
 *
 * No native libraries are involved, so the "no native code" finding in the
 * release ledger (ANDROID-09) stays true.
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "voxbox.secrets.v1";
    private static final String PREFS = "voxbox_secure_store";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The Keystore key, created on first use. */
    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(ALIAS)) {
            return (SecretKey) keyStore.getKey(ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    /** Whether the key is held in secure hardware rather than software. */
    private boolean isHardwareBacked() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
            keyStore.load(null);
            SecretKey key = (SecretKey) keyStore.getKey(ALIAS, null);
            if (key == null) return false;
            SecretKeyFactory factory = SecretKeyFactory.getInstance(key.getAlgorithm(), KEYSTORE);
            KeyInfo info = (KeyInfo) factory.getKeySpec(key, KeyInfo.class);
            return info.isInsideSecureHardware();
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        try {
            getOrCreateKey();
            result.put("available", true);
            result.put("hardwareBacked", isHardwareBacked());
        } catch (Exception e) {
            // Report unavailability rather than failing: the caller falls back to
            // the browser store instead of losing the user's keys.
            result.put("available", false);
            result.put("hardwareBacked", false);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || value == null) {
            call.reject("key and value are required");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] cipherText = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] iv = cipher.getIV();
            byte[] packed = new byte[iv.length + cipherText.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(cipherText, 0, packed, iv.length, cipherText.length);
            prefs().edit().putString(key, Base64.encodeToString(packed, Base64.NO_WRAP)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("could not store secret", e);
        }
    }

    /**
     * Returns the secret, or an empty string when there is none or it cannot be
     * read. An empty value is the signal to ask the user to re-enter; it is never
     * an error the user has to interpret.
     */
    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");
        JSObject result = new JSObject();
        String stored = prefs().getString(key, null);
        if (stored == null) {
            result.put("value", "");
            call.resolve(result);
            return;
        }
        try {
            byte[] packed = Base64.decode(stored, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(TAG_LENGTH_BITS, packed, 0, IV_LENGTH_BYTES));
            byte[] plain = cipher.doFinal(packed, IV_LENGTH_BYTES, packed.length - IV_LENGTH_BYTES);
            result.put("value", new String(plain, StandardCharsets.UTF_8));
        } catch (Exception e) {
            // Key invalidated, or the record was tampered with. Treat as absent.
            result.put("value", "");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");
        if (key != null) {
            prefs().edit().remove(key).apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        prefs().edit().clear().apply();
        call.resolve();
    }
}
