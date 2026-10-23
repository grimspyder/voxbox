package com.grimspyder.voxbox;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * Speed sampling for the traffic-alert feature.
 *
 * Deliberately thin: this plugin reports raw fixes (speed, accuracy, position)
 * at 1 Hz and does nothing else. All alert decisions live in TypeScript, where
 * they are testable without a device.
 *
 * Why a foreground service rather than plain location updates: the phone is in a
 * cradle with the screen off, so the process would otherwise be frozen. The
 * notification is mandatory on Android 8+ and doubles as the visible indicator
 * that location is in use — which is also what Play's foreground-service
 * declaration requires us to be honest about.
 */
@CapacitorPlugin(
        name = "SpeedMonitor",
        permissions = {
                @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION}),
                @Permission(alias = "notifications", strings = {"android.permission.POST_NOTIFICATIONS"})
        }
)
public class SpeedMonitorPlugin extends Plugin {

    public static final String ACTION_START = "com.grimspyder.voxbox.SPEED_MONITOR_START";
    public static final String ACTION_STOP = "com.grimspyder.voxbox.SPEED_MONITOR_STOP";
    public static final String EXTRA_INTERVAL_MS = "intervalMs";

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private boolean running = false;
    private long intervalMs = 1000L;

    @Override
    public void load() {
        fused = LocationServices.getFusedLocationProviderClient(getContext());
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionCallback");
            return;
        }
        Long requested = call.getLong("intervalMs");
        if (requested != null && requested >= 500L && requested <= 10000L) {
            intervalMs = requested;
        }
        startInternal();
        call.resolve();
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED) {
            startInternal();
            call.resolve();
        } else {
            call.reject("Location permission was denied, so speed cannot be monitored.");
        }
    }

    private void startInternal() {
        if (running) return;

        // The service owns the notification and keeps the process alive; the
        // location callbacks below are registered from this process.
        Intent intent = new Intent(getContext(), SpeedMonitorService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_INTERVAL_MS, intervalMs);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }

        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                .setMinUpdateIntervalMillis(Math.max(500L, intervalMs / 2))
                .setWaitForAccurateLocation(false)
                .build();

        callback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                Location location = result.getLastLocation();
                if (location == null) return;
                JSObject payload = new JSObject();
                payload.put("t", System.currentTimeMillis() / 1000.0);
                // hasSpeed() is Doppler-derived and is the accurate source; the
                // fallback of 0 would look like a stopped car, so report null.
                payload.put("speedMps", location.hasSpeed() ? location.getSpeed() : JSObject.NULL);
                payload.put("speedMph", location.hasSpeed() ? location.getSpeed() * 2.2369362920544 : JSObject.NULL);
                payload.put("lat", location.getLatitude());
                payload.put("lon", location.getLongitude());
                payload.put("accuracyM", location.hasAccuracy() ? location.getAccuracy() : JSObject.NULL);
                payload.put("bearing", location.hasBearing() ? location.getBearing() : JSObject.NULL);
                notifyListeners("speed", payload);
            }
        };

        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper());
            running = true;
            broadcastState(true);
        } catch (SecurityException e) {
            running = false;
            broadcastState(false);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInternal();
        call.resolve();
    }

    private void stopInternal() {
        if (callback != null) {
            fused.removeLocationUpdates(callback);
            callback = null;
        }
        Intent intent = new Intent(getContext(), SpeedMonitorService.class);
        getContext().stopService(intent);
        running = false;
        broadcastState(false);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", running);
        call.resolve(result);
    }

    private void broadcastState(boolean isRunning) {
        JSObject payload = new JSObject();
        payload.put("running", isRunning);
        notifyListeners("state", payload);
    }

    @Override
    protected void handleOnDestroy() {
        stopInternal();
        super.handleOnDestroy();
    }
}
