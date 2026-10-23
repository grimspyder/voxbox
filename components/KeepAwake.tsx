'use client';

import { useEffect } from 'react';

interface ScreenWakeLockSentinel extends EventTarget {
  release(): Promise<void>;
  readonly released: boolean;
}

interface ScreenWakeLockApi {
  request(type: 'screen'): Promise<ScreenWakeLockSentinel>;
}

type NavigatorWithWakeLock = Navigator & { wakeLock?: ScreenWakeLockApi };

/** Keep Voxbox visible and readable without changing the user's system timeout. */
export default function KeepAwake() {
  useEffect(() => {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock) return;

    let sentinel: ScreenWakeLockSentinel | null = null;
    let requesting = false;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== 'visible' || sentinel || requesting) return;
      requesting = true;
      try {
        const next = await wakeLock.request('screen');
        if (disposed || document.visibilityState !== 'visible') {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
        sentinel.addEventListener('release', onRelease, { once: true });
      } catch {
        // Unsupported/denied browser wake lock: Android's native window flag
        // remains the primary mechanism in the installed app.
      } finally {
        requesting = false;
      }
    };

    const release = () => {
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) void current.release().catch(() => undefined);
    };

    function onRelease() {
      sentinel = null;
      if (!disposed && document.visibilityState === 'visible') void acquire();
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire();
      else release();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    void acquire();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      release();
    };
  }, []);

  return null;
}
