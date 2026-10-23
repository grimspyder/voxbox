// Bridge to the native SpeedMonitor plugin.
//
// The native side only reports raw fixes; every decision about whether an alert
// should be spoken lives in lib/traffic. This file exists so the rest of the app
// depends on an interface rather than Capacitor, which also makes the shadow
// mode testable with a fake on any machine.
import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export interface SpeedFix {
  /** Unix seconds (native clock). */
  t: number;
  speedMph: number | null;
  speedMps: number | null;
  lat: number;
  lon: number;
  accuracyM: number | null;
  bearing: number | null;
}

export interface SpeedMonitorState {
  running: boolean;
}

export interface SpeedMonitorApi {
  start(options?: { intervalMs?: number }): Promise<void>;
  stop(): Promise<void>;
  isRunning(): Promise<SpeedMonitorState>;
  addListener(
    eventName: 'speed',
    cb: (fix: SpeedFix) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'state',
    cb: (state: SpeedMonitorState) => void,
  ): Promise<PluginListenerHandle>;
}

interface NativeSpeedMonitor extends SpeedMonitorApi {
  requestPermissions?(): Promise<{ location?: string }>;
}

const NativeSpeedMonitor = registerPlugin<NativeSpeedMonitor>('SpeedMonitor');

/** True on a real device build; false in the browser/dev server. */
export function speedMonitorAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SpeedMonitor');
}

/**
 * The app-facing instance. On the web it is a stub that reports zero fixes, so
 * importing this never breaks the web build or the test suite.
 */
export const speedMonitor: SpeedMonitorApi = speedMonitorAvailable()
  ? NativeSpeedMonitor
  : {
      async start() {
        /* no-op outside the native shell */
      },
      async stop() {
        /* no-op */
      },
      async isRunning() {
        return { running: false };
      },
      async addListener() {
        return { remove: async () => undefined };
      },
    };
