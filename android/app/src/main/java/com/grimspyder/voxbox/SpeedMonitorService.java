package com.grimspyder.voxbox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the process alive while speed monitoring runs, and shows the required
 * persistent notification.
 *
 * This service deliberately does no location work itself — the fused client in
 * SpeedMonitorPlugin delivers the fixes. Splitting them keeps one owner of the
 * location callback and makes it impossible to have two competing requesters.
 */
public class SpeedMonitorService extends Service {

    public static final String CHANNEL_ID = "voxbox_speed_monitor";
    private static final int NOTIFICATION_ID = 4711;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && SpeedMonitorPlugin.ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Voxbox drive monitoring")
                .setContentText("Watching speed limits while you drive")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setOngoing(true)
                .setSilent(true)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        return START_STICKY;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Drive monitoring",
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while Voxbox is monitoring speed limits during a drive.");
        manager.createNotificationChannel(channel);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
