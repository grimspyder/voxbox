// Drive panel — shadow mode controls.
//
// This is the first UI for traffic alerts, and deliberately the least exciting
// one: start, stop, current speed/limit, and the log of what Vox *would* have
// said. No speech is produced here. The point of this screen is to collect
// evidence on a real road before any warning is trusted out loud.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DriveSession, formatShadowLog, type ShadowEvent } from '@/lib/traffic/driveSession';
import { SpeedLimitProvider } from '@/lib/traffic/speedLimitProvider';
import { speedMonitor, speedMonitorAvailable, type SpeedFix } from '@/lib/native/speedMonitor';

interface Latest {
  speedMph: number | null;
  limitMph: number | null;
  road: string | null;
  state: string | null;
}

const EMPTY: Latest = { speedMph: null, limitMph: null, road: null, state: null };

export default function DrivePanel() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<Latest>(EMPTY);
  const [events, setEvents] = useState<ShadowEvent[]>([]);
  const [copied, setCopied] = useState(false);

  const sessionRef = useRef<DriveSession | null>(null);
  const providerRef = useRef<SpeedLimitProvider | null>(null);
  const removeRef = useRef<(() => Promise<void>) | null>(null);
  const startedAtRef = useRef(0);

  const stop = useCallback(async () => {
    sessionRef.current?.stop();
    try {
      await speedMonitor.stop();
    } catch {
      /* stopping an already-stopped service is not an error worth showing */
    }
    await removeRef.current?.();
    removeRef.current = null;
    sessionRef.current = null;
    providerRef.current = null;
    setRunning(false);
  }, []);

  // Never leave a foreground location service running because the component
  // unmounted — that would show a notification the user cannot explain.
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  const start = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!speedMonitorAvailable()) {
        setError('Drive monitoring needs the installed Android app, not the web preview.');
        return;
      }
      const provider = new SpeedLimitProvider();
      const session = new DriveSession({
        provider,
        onEvent: (event) => setEvents((prev) => [...prev.slice(-299), event]),
      });
      providerRef.current = provider;
      sessionRef.current = session;
      startedAtRef.current = Date.now() / 1000;

      const handle = await speedMonitor.addListener('speed', (fix: SpeedFix) => {
        if (fix.speedMph === null || !Number.isFinite(fix.speedMph)) return;
        const t = Math.max(0, fix.t - startedAtRef.current);
        void session
          .onFix({
            t,
            lon: fix.lon,
            lat: fix.lat,
            speedMph: fix.speedMph,
            accuracyM: fix.accuracyM ?? undefined,
          })
          .then(() => {
            const current = provider.current;
            setLatest({
              speedMph: fix.speedMph,
              limitMph: current.limit,
              road: current.road,
              state: current.state,
            });
          });
      });
      removeRef.current = async () => {
        await handle.remove();
      };

      await speedMonitor.start({ intervalMs: 1000 });
      session.start();
      setRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drive monitoring could not start.');
      await stop();
    } finally {
      setBusy(false);
    }
  }, [stop]);

  const copyLog = useCallback(async () => {
    const text = formatShadowLog(events);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy the log. Select the text instead.');
    }
  }, [events]);

  const over =
    latest.speedMph !== null && latest.limitMph !== null ? latest.speedMph - latest.limitMph : null;
  const logText = formatShadowLog(events);

  return (
    <section
      aria-label="Drive monitoring"
      style={{
        width: '100%',
        maxWidth: 640,
        border: '1px solid #2a2a2a',
        borderRadius: 6,
        background: '#080808',
        padding: '10px 12px',
        fontFamily: 'monospace',
        color: '#bbb',
        marginTop: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: '#ffd400', letterSpacing: '0.12em', fontSize: 12 }}>
          DRIVE — SHADOW MODE
        </span>
        <button
          className="kitt-btn"
          onClick={() => void (running ? stop() : start())}
          disabled={busy}
          style={{ minHeight: 44, padding: '8px 14px', fontSize: 12 }}
        >
          {busy ? 'WAIT…' : running ? '■ STOP' : '▶ START DRIVE'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 18, marginTop: 8, alignItems: 'baseline' }}>
        <div>
          <div style={{ color: '#666', fontSize: 10, letterSpacing: '0.1em' }}>SPEED</div>
          <div style={{ fontSize: 26, color: '#eee', lineHeight: 1 }}>
            {latest.speedMph === null ? '—' : Math.round(latest.speedMph)}
            <span style={{ fontSize: 11, color: '#666' }}> mph</span>
          </div>
        </div>
        <div>
          <div style={{ color: '#666', fontSize: 10, letterSpacing: '0.1em' }}>LIMIT</div>
          <div style={{ fontSize: 26, color: latest.limitMph === null ? '#666' : '#ffd400', lineHeight: 1 }}>
            {latest.limitMph === null ? '—' : latest.limitMph}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#666', fontSize: 10, letterSpacing: '0.1em' }}>ROAD</div>
          <div style={{ fontSize: 12, color: '#999', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[latest.road, latest.state].filter(Boolean).join(', ') || '—'}
          </div>
        </div>
        {over !== null && over > 0 && (
          <div style={{ color: over >= 15 ? '#ff5050' : '#ffb877', fontSize: 13 }}>
            +{Math.round(over)}
          </div>
        )}
      </div>

      <div style={{ marginTop: 6, fontSize: 10.5, color: '#777' }}>
        {running
          ? 'Logging only — Vox will not speak. Drive normally, then send me this log.'
          : 'Runs the real pipeline with speech switched off. No warnings are spoken in this build.'}
      </div>

      {error && (
        <div role="alert" style={{ marginTop: 8, color: '#ff9d8f', fontSize: 11.5 }}>
          {error}
        </div>
      )}

      {events.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, alignItems: 'center' }}>
            <span style={{ color: '#666', fontSize: 10, letterSpacing: '0.1em' }}>
              SHADOW LOG ({events.length})
            </span>
            <button
              className="kitt-btn"
              onClick={() => void copyLog()}
              style={{ minHeight: 36, padding: '6px 10px', fontSize: 10.5 }}
            >
              {copied ? 'COPIED' : 'COPY LOG'}
            </button>
          </div>
          <pre
            style={{
              margin: '6px 0 0',
              maxHeight: 150,
              overflow: 'auto',
              background: '#000',
              border: '1px solid #222',
              borderRadius: 4,
              padding: 8,
              fontSize: 10.5,
              lineHeight: 1.5,
              color: '#9a9a9a',
              whiteSpace: 'pre-wrap',
            }}
          >
            {logText}
          </pre>
        </>
      )}
    </section>
  );
}
