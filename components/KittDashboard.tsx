// Vox main dashboard — authentic 3-bar voice modulator layout per reference.
// Left: AIR, OIL, P1, P2. Right: S1, S2, P3, P4.
// Center-bottom: AUTO CRUISE, NORMAL CRUISE, PURSUIT.
// Deep black background; no cards/gradients/modern UI.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import VoiceModulator from './VoiceModulator';
import { ConversationEngine } from '@/lib/conversation/engine';
import { KITTSettings, DEFAULT_SETTINGS } from '@/lib/config/settings';
import { loadSettings, saveSettings, deleteSecrets } from '@/lib/config/storage';
import { loadHistory, saveHistory as persistHistory, clearHistory } from '@/lib/config/history';
import { MachineSnapshot } from '@/lib/conversation/stateMachine';
import { computeBarLevels, BarLevels, DEFAULT_TUNING, ModulatorTuning } from '@/lib/audio/modulator';
import SettingsPanel from './SettingsPanel';
import SetupWizard from './SetupWizard';
import ReportResponse from './ReportResponse';
import { listMics } from '@/lib/stt/mic';

type Status = 'OFFLINE' | 'LISTENING' | 'THINKING' | 'SPEAKING' | 'ERROR';
const STATUS_LABEL: Record<Status, string> = {
  OFFLINE: 'SYSTEM OFFLINE',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SPEAKING: 'SPEAKING',
  ERROR: 'SYSTEM FAULT',
};

const STATUS_COLOR: Record<Status, string> = {
  OFFLINE: '#777',
  LISTENING: '#ffd400',
  THINKING: '#ff8c00',
  SPEAKING: '#ff1a1a',
  ERROR: '#ff1a1a',
};

export default function KittDashboard() {
  const [settings, setSettings] = useState<KITTSettings>(DEFAULT_SETTINGS);
  const [machine, setMachine] = useState<MachineSnapshot>({ state: 'DISCONNECTED', history: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  // The response the user is reporting, or null when the sheet is closed (§53).
  const [reportTarget, setReportTarget] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [interim, setInterim] = useState('');
  const [latency, setLatency] = useState<string>('');
  const [inputLevel, setInputLevel] = useState(0);
  const [micList, setMicList] = useState<MediaDeviceInfo[]>([]);

  // The most recent reply, which is what "report last response" refers to. Derived
  // after the transcript state it reads, or it would be in its temporal dead zone.
  const lastResponse = useMemo(
    () => [...transcript].reverse().find((t) => t.role === 'assistant')?.text ?? '',
    [transcript],
  );

  const engineRef = useRef<ConversationEngine | null>(null);
  const settingsLoadedRef = useRef(false);
  const levelsRef = useRef<BarLevels>({ left: 0, center: 0, right: 0 });
  const lastTickRef = useRef<number>(0);
  const tuningRef = useRef<ModulatorTuning>({ ...DEFAULT_TUNING });
  const synthEnvRef = useRef<{ active: boolean; value: number; t0: number }>({ active: false, value: 0, t0: 0 });

  // load settings
  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      settingsLoadedRef.current = true;
      setSettingsReady(true);
      // Restore a saved transcript only when the user has opted into storage.
      setTranscript(s.saveHistory ? loadHistory() : []);
    });
    void listMics().then(setMicList);
  }, []);

  // Persist the transcript on device only while the user keeps the option on.
  // Guarded on the settings load so the defaults cannot wipe a saved transcript
  // before the stored preference has been read.
  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    if (settings.saveHistory) persistHistory(transcript);
    else clearHistory();
  }, [transcript, settings.saveHistory]);

  const refreshMics = useCallback(async () => {
    // enumerateDevices exposes useful labels after getUserMedia permission.
    setMicList(await listMics());
  }, []);

  useEffect(() => {
    tuningRef.current.smoothing = settings.display.smoothing;
    tuningRef.current.releaseMs = 70 + settings.display.smoothing * 90;
    tuningRef.current.attackMs = 15 + (1 - settings.display.smoothing) * 25;
  }, [settings.display.smoothing]);

  const getLevels = useCallback((): BarLevels | null => {
    // Synthetic LED test overrides audio analysis
    if (ledTestRef.current) return levelsRef.current;
    const engine = engineRef.current;
    if (!engine || !engine.isActive()) return null;
    const now = performance.now();
    const dt = Math.min(100, now - (lastTickRef.current || now));
    lastTickRef.current = now;

    // Only Vox's OUTPUT audio drives the bars.
    let bands = { low: 0, mid: 0, high: 0 };
    let rms = 0;
    if (engine.pipeline.hasOutput) {
      rms = engine.pipeline.rms();
      bands = engine.pipeline.bands();
    } else if (synthEnvRef.current.active) {
      // browser speechSynthesis fallback: synthetic envelope driven by state
      const t = (now - synthEnvRef.current.t0) / 1000;
      rms = (0.18 + 0.1 * Math.sin(t * 9) + 0.06 * Math.sin(t * 23.7)) * (0.7 + 0.3 * Math.sin(t * 1.7));
      bands = { low: rms * 0.9, mid: rms * 1.1, high: rms * 0.7 };
    }
    levelsRef.current = computeBarLevels(bands, rms, tuningRef.current, levelsRef.current, dt);
    return levelsRef.current;
  }, []);

  const handleTranscript = useCallback((role: 'user' | 'assistant', text: string, isInterim?: boolean) => {
    if (isInterim) {
      setInterim(text);
      return;
    }
    setInterim('');
    setTranscript((t) => [...t.slice(-50), { role, text }]);
  }, []);

  const startConversation = useCallback(async () => {
    setError(null);
    let engine = engineRef.current;
    if (!engine) {
      engine = new ConversationEngine(settings);
      engineRef.current = engine;
    } else {
      engine.updateSettings(settings);
    }
    engine.setMicLevelCallback((l) => setInputLevel(l));
    await engine.start({
      onState: (m) => setMachine(m),
      onTranscript: handleTranscript,
      onLatency: (t) => {
        if (t.firstPlayback && t.utteranceEnd) {
          setLatency(`${Math.round(t.firstPlayback - t.utteranceEnd)} ms`);
        }
      },
      onError: (msg) => setError(msg),
      onNotice: (msg) => setNotice(msg),
      onMicrophoneReady: () => { void refreshMics(); },
      });
  }, [settings, handleTranscript, refreshMics]);

  const stopConversation = useCallback(() => {
    engineRef.current?.stop();
    engineRef.current = null;
    setMachine({ state: 'DISCONNECTED', history: [] });
    synthEnvRef.current.active = false;
  }, []);

  const interrupt = useCallback(() => {
    engineRef.current?.interrupt();
  }, []);

  /** Clear the conversation context Vox is using (keeps the session running). */
  const newConversation = useCallback(() => {
    engineRef.current?.newConversation();
    setInterim('');
    setTranscript([]);
    clearHistory();
  }, []);

  /** Delete the saved transcript from this device (§97). */
  const handleClearHistory = useCallback(() => {
    clearHistory();
    setTranscript([]);
    setInterim('');
  }, []);

  /** Apply the wizard's outcome and mark setup finished. */
  const applySetup = useCallback(async (next: KITTSettings) => {
    setSettings(next);
    engineRef.current?.updateSettings(next);
    await saveSettings(next);
    setShowSetup(false);
    setSettingsReady(true);
    setError(null);
  }, []);

  /** Return every setting to its default and drop stored credentials (§96). */
  const handleResetSetup = useCallback(async () => {
    engineRef.current?.stop();
    engineRef.current = null;
    await deleteSecrets();
    clearHistory();
    const fresh: KITTSettings = { ...DEFAULT_SETTINGS };
    setSettings(fresh);
    await saveSettings(fresh);
    setTranscript([]);
    setInterim('');
    setError(null);
    setMachine({ state: 'DISCONNECTED', history: [] });
  }, []);

  // Synthetic LED test mode: drives the modulator without any audio (spec §14).
  const ledTestRef = useRef<{ raf: number; until: number } | null>(null);
  const toggleLedTest = useCallback(() => {
    if (ledTestRef.current) {
      cancelAnimationFrame(ledTestRef.current.raf);
      ledTestRef.current = null;
      levelsRef.current = { left: 0, center: 0, right: 0 };
      return;
    }
    const start = performance.now();
    const tick = () => {
      const ref = ledTestRef.current;
      if (!ref) return;
      const t = (performance.now() - start) / 1000;
      const until = ref.until;
      // envelope: ramp up, wobble, ramp down, repeat — speech-like
      const phase = (t % 2) / 2;
      const env = Math.max(0, Math.sin(Math.PI * phase) * (0.55 + 0.45 * Math.sin(t * 7)));
      levelsRef.current = {
        left: env * 0.8,
        center: Math.min(1, env * 1.1),
        right: env * 0.6,
      };
      if (performance.now() < until) ref.raf = requestAnimationFrame(tick);
      else {
        levelsRef.current = { left: 0, center: 0, right: 0 };
        ledTestRef.current = null;
      }
    };
    ledTestRef.current = { raf: 0, until: start + 8000 };
    ledTestRef.current.raf = requestAnimationFrame(tick);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const sendText = useCallback(async (text: string) => {
    const engine = engineRef.current;
    if (engine) {
      synthEnvRef.current.active = true;
      synthEnvRef.current.t0 = performance.now();
      await engine.sendText(text);
      synthEnvRef.current.active = false;
    } else {
      // auto-start conversation on first text input
      await startConversation();
      setTimeout(() => void engineRef.current?.sendText(text), 400);
    }
  }, [startConversation]);

  // Derive status
  const status: Status = (() => {
    switch (machine.state) {
      case 'LISTENING': return 'LISTENING';
      case 'PROCESSING': return 'THINKING';
      case 'SPEAKING': return 'SPEAKING';
      case 'ERROR': return 'ERROR';
      case 'INTERRUPTED': return 'LISTENING';
      default: return 'OFFLINE';
    }
  })();

  useEffect(() => {
    if (status === 'SPEAKING' && settings.tts.provider === 'browser') {
      synthEnvRef.current.active = true;
      synthEnvRef.current.t0 = performance.now();
    } else if (status !== 'SPEAKING') {
      synthEnvRef.current.active = false;
    }
  }, [status, settings.tts.provider]);

  // wake lock during active conversation
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (machine.state !== 'DISCONNECTED' && machine.state !== 'ERROR' && nav.wakeLock) {
      nav.wakeLock.request('screen').then((s) => { sentinel = s; }).catch(() => undefined);
    }
    return () => { void sentinel?.release().catch(() => undefined); };
  }, [machine.state]);

  const pill = (label: string, bg: string, color: string, extra?: React.CSSProperties): React.CSSProperties => ({
    background: bg,
    color,
    borderRadius: 999,
    padding: '4px 12px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    fontFamily: 'var(--kitt-font, Arial, sans-serif)',
    fontSize: 'clamp(9px, 1.6vw, 14px)',
    textAlign: 'center',
    whiteSpace: 'pre-line',
    boxShadow: 'none',
    ...extra,
  });

  const yellow = '#ffd400';
  const orange = '#ff7a00';
  const red = '#e01414';

  return (
    <div
      className="kitt-root"
      style={{
        background: '#000',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ddd',
        overflowX: 'hidden',
        // Nothing important may sit under a notch, camera cutout, rounded
        // corner or the gesture bar (brief §30).
        paddingTop: 'max(8px, env(safe-area-inset-top))',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(8px, env(safe-area-inset-left))',
        paddingRight: 'max(8px, env(safe-area-inset-right))',
      }}
    >
      <div className="kitt-stage">
      <div
        className="kitt-display"
        style={{
          background: '#000',
          padding: '4%',
          boxSizing: 'border-box',
          filter: `brightness(${settings.display.brightness})`,
        }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr 1fr', gridTemplateRows: 'auto 1fr auto', height: '100%', gap: '2%' }}>
          {/* LEFT: AIR / OIL / P1 / P2 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '6% 0' }}>
            <div style={pill('AIR', yellow, '#000')}>AIR</div>
            <div style={pill('OIL', yellow, '#000')}>OIL</div>
            <div style={pill('P1', orange, '#000')}>P1</div>
            <div style={pill('P2', orange, '#000')}>P2</div>
          </div>

          {/* CENTER: modulator over cruise buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3%' }}>
            <div style={{ flex: 3, width: '62%', minHeight: 0 }}>
              <VoiceModulator getLevels={getLevels} brightness={settings.display.brightness} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5%', width: '100%' }}>
              <div style={pill('AUTO\nCRUISE', yellow, '#000', { minWidth: '84%' })}>{'AUTO\nCRUISE'}</div>
              <div style={pill('NORMAL\nCRUISE', yellow, '#000', { minWidth: '84%' })}>{'NORMAL\nCRUISE'}</div>
              <div style={pill('PURSUIT', red, '#200', { minWidth: '84%' })}>PURSUIT</div>
            </div>
          </div>

          {/* RIGHT: S1 / S2 / P3 / P4 */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '6% 0' }}>
            <div style={pill('S1', yellow, '#000')}>S1</div>
            <div style={pill('S2', yellow, '#000')}>S2</div>
            <div style={pill('P3', orange, '#000')}>P3</div>
            <div style={pill('P4', orange, '#000')}>P4</div>
          </div>
        </div>
      </div>

      {/* Status + controls sit beside the display in landscape and below it in
          portrait, so the replica panel is never stretched out of proportion. */}
      <div className="kitt-side">
      {/* Status row (subtle, not part of the replica) */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '12px 0 4px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ color: STATUS_COLOR[status], fontFamily: 'monospace', letterSpacing: '0.15em', fontSize: 13 }}>
          ● {STATUS_LABEL[status]}
        </span>
        {settings.llm.provider === 'demo' && (
          <span style={{ color: '#888', fontSize: 11, border: '1px solid #444', padding: '2px 8px', borderRadius: 4 }}>
            DEMO MODE — no cloud AI connected
          </span>
        )}
        {latency && <span style={{ color: '#666', fontSize: 11 }}>first-audio: {latency}</span>}
      </div>

      <div className="kitt-buttons" style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
        {machine.state === 'DISCONNECTED' ? (
          <button onClick={() => void startConversation()} className="kitt-btn">▶ START CONVERSATION</button>
        ) : (
          <button onClick={stopConversation} className="kitt-btn">■ END</button>
        )}
        {machine.state !== 'DISCONNECTED' && (
          <button onClick={newConversation} className="kitt-btn" aria-label="Start a new conversation and clear context">✳ NEW CONVERSATION</button>
        )}
        {lastResponse && (
          <button
            onClick={() => setReportTarget(lastResponse)}
            className="kitt-btn"
            aria-label="Report the last response from Vox"
          >
            ⚑ REPORT
          </button>
        )}
        {machine.state === 'SPEAKING' && (
          <button onClick={interrupt} className="kitt-btn" aria-label="Interrupt Vox">✖ INTERRUPT</button>
        )}
        <button onClick={toggleLedTest} className="kitt-btn" aria-label="Test the LED modulator">◉ TEST LEDS</button>
        <button onClick={toggleFullscreen} className="kitt-btn" aria-label="Toggle full screen">⛶ FULLSCREEN</button>
        <button onClick={() => setShowSettings(true)} className="kitt-btn" aria-label="Open settings">⚙ SETTINGS</button>
      </div>

      {/* Optional text input (secondary interface) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = (e.currentTarget.elements.namedItem('msg') as HTMLInputElement);
          if (input.value.trim()) {
            void sendText(input.value);
            input.value = '';
          }
        }}
        style={{ display: 'flex', gap: 6, width: '100%', maxWidth: 480 }}
      >
        <input name="msg" placeholder="Type instead (optional)…" aria-label="Message Vox by text" className="kitt-input" />
        <button type="submit" className="kitt-btn">SEND</button>
      </form>

      {error && (
        <div role="alert" style={{ color: '#ff5b5b', fontSize: 13, margin: 8, maxWidth: '90vw', textAlign: 'center' }}>
          {error}{' '}
          <button className="kitt-btn" onClick={() => { setError(null); void startConversation(); }}>RETRY</button>
          <button className="kitt-btn" onClick={() => setError(null)}>DISMISS</button>
        </div>
      )}

      {notice && (
        <div role="status" style={{ color: '#e0b64a', fontSize: 12, margin: 8, maxWidth: '90vw', textAlign: 'center' }}>
          {notice}{' '}
          <button className="kitt-btn" onClick={() => setNotice(null)}>OK</button>
        </div>
      )}

      {/* Input level meter (mic diagnostics; not part of the replica) */}
      {machine.state === 'LISTENING' && (
        <div aria-hidden style={{ width: 'min(92vw, 320px)', height: 4, background: '#111', borderRadius: 2, marginTop: 4 }}>
          <div style={{ width: `${Math.min(100, inputLevel * 100)}%`, height: '100%', background: '#ffd400', borderRadius: 2 }} />
        </div>
      )}
      </div>
      </div>

      {settings.display.showTranscript && (
        <div style={{ width: 'min(92vw, 640px)', maxHeight: 180, overflowY: 'auto', fontSize: 13, color: '#aaa', margin: '8px 0' }}>
          {transcript.map((t, i) => (
            <div key={i} style={{ color: t.role === 'user' ? '#8ab4f8' : '#ff6b6b' }}>
              <b>{t.role === 'user' ? 'You' : 'Vox'}:</b> {t.text}
              {t.role === 'assistant' && (
                <button
                  className="kitt-btn"
                  style={{ marginLeft: 8, padding: '8px 10px', minHeight: 44, fontSize: 11 }}
                  aria-label="Report this response"
                  onClick={() => setReportTarget(t.text)}
                >
                  ⚑ REPORT
                </button>
              )}
            </div>
          ))}
          {interim && <div style={{ color: '#666' }}><b>Vox:</b> {interim}</div>}
        </div>
      )}

      {reportTarget && (
        <ReportResponse
          response={reportTarget}
          provider={settings.llm.provider}
          onClose={() => setReportTarget(null)}
        />
      )}

      {(showSetup || (settingsReady && !settings.setup.complete)) && (
        <SetupWizard initial={settings} onFinish={(next) => void applySetup(next)} />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          micList={micList}
          onRefreshMics={refreshMics}
          onRunSetup={() => {
            setShowSettings(false);
            setShowSetup(true);
          }}
          onClose={async (next?: KITTSettings) => {
            if (next) {
              setSettings(next);
              engineRef.current?.updateSettings(next);
              await saveSettings(next);
            }
            setShowSettings(false);
          }}
          onDeleteSecrets={async () => {
            await deleteSecrets();
            setSettings((s) => ({ ...s, persistSecrets: false }));
          }}
          onClearHistory={handleClearHistory}
          onResetSetup={() => void handleResetSetup()}
        />
      )}

      <style jsx global>{`
        .kitt-btn {
          background: #151515;
          border: 1px solid #3a3a3a;
          color: #bbb;
          padding: 12px 16px;
          border-radius: 6px;
          font-family: monospace;
          letter-spacing: 0.08em;
          cursor: pointer;
          font-size: 14px;
          /* Comfortable finger target on a phone (brief §31). */
          min-height: 48px;
          touch-action: manipulation;
        }
        .kitt-btn:hover { border-color: #ff1a1a; color: #ff5050; }
        .kitt-btn:focus-visible { outline: 2px solid #ffd400; outline-offset: 2px; }
        .kitt-btn:disabled { opacity: 0.45; cursor: not-allowed; }

        .kitt-display {
          position: relative;
          width: min(92vw, 640px);
          /* The replica panel keeps its 4:3 proportions in every orientation. */
          aspect-ratio: 4 / 3;
        }

        .kitt-stage {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
        }
        .kitt-side {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          width: 100%;
        }

        .kitt-input {
          flex: 1;
          min-height: 48px;
          background: #0a0a0a;
          border: 1px solid #333;
          color: #ccc;
          padding: 12px 14px;
          border-radius: 6px;
          /* 16px stops mobile browsers zooming the page when it is focused. */
          font-size: 16px;
        }

        @media (orientation: landscape) and (max-height: 600px) {
          /* Landscape should feel natural for this dashboard: the panel takes
             the height and the controls move into a column beside it, rather
             than the 4:3 panel being stretched until labels distort (§29).
             The column gets a definite width so its rows can wrap inside it
             instead of being clipped at the screen edge. */
          .kitt-stage { flex-direction: row; align-items: center; gap: 18px; }
          .kitt-display { width: auto; height: min(78dvh, 62vw); }
          .kitt-side { width: min(46vw, 440px); }
          .kitt-side form { max-width: 100%; }
        }

        @media (max-width: 400px) {
          .kitt-btn { padding: 12px 11px; font-size: 13px; }
        }
      `}</style>
    </div>
  );
}