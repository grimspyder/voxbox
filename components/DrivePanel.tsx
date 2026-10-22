// Drive panel — live traffic alerts, with the user's AI cloud voice.
//
// Start performs a spoken cloud-voice check before GPS monitoring starts.
// Speed warnings use the selected ElevenLabs/OpenAI voice only; there is no
// browser or demo fallback that could make sound while pretending to be AI.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DriveSession, formatShadowLog, type ShadowEvent } from '@/lib/traffic/driveSession';
import { SpeedLimitProvider } from '@/lib/traffic/speedLimitProvider';
import { TrafficSpeaker } from '@/lib/traffic/trafficSpeaker';
import { interruptAllSpeech } from '@/lib/audio/speechBus';
import { AudioPipeline } from '@/lib/audio/pipeline';
import { TTSClient } from '@/lib/tts/client';
import { loadSettings } from '@/lib/config/storage';
import { requireCloudVoice } from '@/lib/traffic/cloudVoice';
import { speedMonitor, speedMonitorAvailable, type SpeedFix } from '@/lib/native/speedMonitor';

interface Latest {
  speedMph: number | null;
  limitMph: number | null;
  road: string | null;
  state: string | null;
}

const EMPTY: Latest = { speedMph: null, limitMph: null, road: null, state: null };

/** A short, non-technical explanation of why the voice went quiet. */
function describeVoiceError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/401|403|rejected|unauthori[sz]ed|api key/i.test(raw)) {
    return `AI cloud voice failed: ${raw.slice(0, 220)}. No browser or demo voice was substituted.`;
  }
  if (/429|quota|credit|billing/i.test(raw)) {
    return `AI cloud voice quota/billing issue: ${raw.slice(0, 220)}. No browser or demo voice was substituted.`;
  }
  return `AI cloud voice failed: ${raw.slice(0, 220) || 'unknown error'}. No browser or demo voice was substituted.`;
}

export default function DrivePanel() {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<Latest>(EMPTY);
  const [events, setEvents] = useState<ShadowEvent[]>([]);
  const [copied, setCopied] = useState(false);
  // Speech is on by default: this build exists to be heard. The checkbox is the
  // escape hatch for a quiet test drive.
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceOnRef = useRef(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const sessionRef = useRef<DriveSession | null>(null);
  const providerRef = useRef<SpeedLimitProvider | null>(null);
  const removeRef = useRef<(() => Promise<void>) | null>(null);
  const startedAtRef = useRef(0);
  const speakerRef = useRef<TrafficSpeaker | null>(null);
  const pipelineRef = useRef<AudioPipeline | null>(null);

  useEffect(() => {
    voiceOnRef.current = voiceOn;
  }, [voiceOn]);

  const stop = useCallback(async () => {
    speakerRef.current?.dispose();
    speakerRef.current = null;
    pipelineRef.current?.close();
    pipelineRef.current = null;
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
    setVoiceError(null);
    setBusy(true);
    try {
      if (!speedMonitorAvailable()) {
        setError('Drive monitoring needs the installed Android app, not the web preview.');
        return;
      }
      const provider = new SpeedLimitProvider();

      // Driving alerts use the configured AI cloud voice only. Demo/browser
      // substitution sounded like a tone rather than the user's ElevenLabs voice;
      // if cloud voice is not configured or fails, stop and say so explicitly.
      const settings = await loadSettings();
      const ttsCfg = requireCloudVoice(settings.tts);
      const pipeline = new AudioPipeline();
      const tts = new TTSClient(pipeline);
      pipelineRef.current = pipeline;

      speakerRef.current = new TrafficSpeaker(
        {
          speak: (text: string) => tts.speak(text, ttsCfg),
          // Stop both browser synthesis and the assistant's cloud media stream.
          interrupt: () => {
            interruptAllSpeech();
            pipeline.stop();
          },
        },
        { onError: (e: unknown) => setVoiceError(describeVoiceError(e)) },
      );

      // Verify the exact cloud voice and playback path before starting GPS.
      // This is deliberately a spoken preflight, not a local/browser fallback.
      interruptAllSpeech();
      try {
        await tts.speak('AI voice check. Drive monitoring will use this voice.', ttsCfg);
      } catch (e) {
        setVoiceError(describeVoiceError(e));
        throw e;
      }

      const session = new DriveSession({
        provider,
        onEvent: (event) => {
          setEvents((prev) => [...prev.slice(-299), event]);
          if (voiceOnRef.current && event.alert) {
            speakerRef.current?.announce(event.alert, event.text);
          }
        },
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
      const message = err instanceof Error ? err.message : 'Drive monitoring could not start.';
      setError(message);
      if (/cloud voice|ElevenLabs|OpenAI|API key/i.test(message)) {
        setVoiceError(describeVoiceError(err));
      }
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
          DRIVE — AI CLOUD ALERTS {voiceOn ? 'ON' : 'MUTED'}
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
          ? voiceOn
            ? 'Alerts use your configured AI cloud voice and interrupt Vox mid-sentence. No browser or demo voice is used.'
            : 'Muted — logging only. Turn SPEAK ALERTS on to use your configured AI cloud voice.'
          : 'Uses your ElevenLabs or OpenAI cloud voice. Press START to hear a voice check before GPS monitoring begins.'}
      </div>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 8,
          fontSize: 11,
          color: '#999',
          cursor: 'pointer',
        }}
      >
        <input
          type="checkbox"
          checked={voiceOn}
          onChange={(e) => setVoiceOn(e.target.checked)}
          style={{ width: 16, height: 16 }}
        />
        SPEAK ALERTS (overrides Vox&apos;s voice)
      </label>

      {voiceError && (
        <div role="status" style={{ marginTop: 8, color: '#ffcf7a', fontSize: 11.5 }}>
          {voiceError}
        </div>
      )}

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
