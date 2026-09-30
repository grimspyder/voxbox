// First-run setup wizard.
//
// The one thing this must never do is make a nontechnical user learn what a
// model, a token, a temperature or a voice ID is. Every stage therefore offers a
// plain choice, hides the engineering knobs (they stay in Advanced Settings),
// and never blocks: demo mode is always one tap away, and setup can be skipped
// from any stage and resumed later from Settings → SYSTEM SETUP.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { KITTSettings, TTSProviderId } from '@/lib/config/settings';
import { PROVIDER_CARDS, providerCard } from '@/lib/config/providers';
import { discoverModels, discoverVoices, VOICE_TEST_PHRASE, VoiceOption } from '@/lib/setup/discovery';
import { buildSystemCheck, summariseCheck, firstBlockerSentence, SetupFacts } from '@/lib/setup/readiness';
import { startMicMeter, MicMeter } from '@/lib/setup/micCheck';
import { llmClient } from '@/lib/llm/client';
import { TTSClient } from '@/lib/tts/client';
import { AudioPipeline } from '@/lib/audio/pipeline';

type Stage = 'welcome' | 'ai' | 'voice' | 'mic' | 'check';

interface Props {
  initial: KITTSettings;
  /** Apply the finished settings and close the wizard. */
  onFinish: (next: KITTSettings) => void;
}

interface Result {
  ok: boolean;
  text: string;
}

const btn: React.CSSProperties = {
  background: '#151515',
  border: '1px solid #3a3a3a',
  color: '#ccc',
  padding: '14px 18px',
  borderRadius: 6,
  fontFamily: 'monospace',
  letterSpacing: '0.08em',
  fontSize: 14,
  cursor: 'pointer',
  minHeight: 48,
};
const primary: React.CSSProperties = { ...btn, background: '#3a0d0d', borderColor: '#ff1a1a', color: '#ffdede' };
const input: React.CSSProperties = {
  background: '#0d0d0d',
  border: '1px solid #333',
  color: '#ddd',
  padding: '12px 14px',
  borderRadius: 6,
  width: '100%',
  boxSizing: 'border-box',
  fontSize: 16,
};
const h1: React.CSSProperties = {
  fontFamily: 'monospace',
  letterSpacing: '0.24em',
  color: '#ff5050',
  fontSize: 'clamp(18px, 5vw, 26px)',
  marginBottom: 8,
};
const body: React.CSSProperties = { color: '#aaa', fontSize: 14, lineHeight: 1.6 };
const mute: React.CSSProperties = { color: '#777', fontSize: 12, lineHeight: 1.6 };

const STAGES: Stage[] = ['welcome', 'ai', 'voice', 'mic', 'check'];

export default function SetupWizard({ initial, onFinish }: Props) {
  const [stage, setStage] = useState<Stage>('welcome');
  const [draft, setDraft] = useState<KITTSettings>(initial);

  // AI step
  const [keyInput, setKeyInput] = useState(initial.llm.apiKey);
  const [showKey, setShowKey] = useState(false);
  const [aiResult, setAiResult] = useState<Result | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [modelNote, setModelNote] = useState('');
  const [reuseOpenAiKey, setReuseOpenAiKey] = useState(true);

  // Voice step
  const [voiceKey, setVoiceKey] = useState(initial.tts.apiKey);
  const [showVoiceKey, setShowVoiceKey] = useState(false);
  const [voiceList, setVoiceList] = useState<VoiceOption[]>([]);
  const [voiceResult, setVoiceResult] = useState<Result | null>(null);
  const [testingVoice, setTestingVoice] = useState(false);

  // Microphone step
  const [micResult, setMicResult] = useState<Result | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [listening, setListening] = useState(false);
  const meterRef = useRef<MicMeter | null>(null);

  useEffect(() => () => meterRef.current?.stop(), []);

  const aiVerified = aiResult?.ok === true;
  const voiceVerified = voiceResult?.ok === true;
  const aiCard = providerCard(draft.llm.provider);

  const stopMeter = useCallback(() => {
    meterRef.current?.stop();
    meterRef.current = null;
    setListening(false);
  }, []);

  const finish = useCallback(
    (next: KITTSettings) => {
      stopMeter();
      onFinish(next);
    },
    [onFinish, stopMeter],
  );

  /** Demo: no keys, no microphone, straight in. */
  const tryDemoNow = useCallback(() => {
    finish({
      ...initial,
      llm: { ...initial.llm, provider: 'demo' },
      tts: { ...initial.tts, provider: 'demo' },
      setup: { complete: true, mode: 'demo' },
    });
  }, [finish, initial]);

  const skipWithCurrent = useCallback(() => {
    finish({ ...draft, setup: { complete: true, mode: draft.llm.provider === 'demo' ? 'demo' : 'full' } });
  }, [draft, finish]);

  const verifyAi = useCallback(async () => {
    setTestingAi(true);
    setAiResult(null);
    setModels([]);
    setModelNote('');
    const provider = draft.llm.provider;
    const candidate = { ...draft.llm, apiKey: keyInput };
    const start = await llmClient.testConnection({ provider, apiKey: keyInput, model: candidate.model });
    if (!start.ok) {
      setTestingAi(false);
      setAiResult({ ok: false, text: start.message });
      return;
    }
    // The key works. Ask the service which models this account may use so we
    // never preselect a model the provider has retired.
    const found = await discoverModels(provider, keyInput);
    const chosen = found.recommended ?? candidate.model;
    setDraft((d) => ({
      ...d,
      llm: { ...d.llm, apiKey: keyInput, model: chosen },
      stt: reuseOpenAiKey && provider === 'openai' ? { ...d.stt, provider: 'openai', apiKey: keyInput } : d.stt,
      tts: reuseOpenAiKey && provider === 'openai' ? { ...d.tts, provider: 'openai', apiKey: keyInput, voiceId: d.tts.voiceId || 'onyx' } : d.tts,
    }));
    setModels(found.models.map((m) => m.id));
    setModelNote(
      found.ok && found.models.length
        ? `You have ${found.models.length} models available. KITT picked ${chosen} for conversation — you can change it later under Advanced Settings.`
        : `KITT will use ${chosen}. You can change the model later under Advanced Settings.`,
    );
    setAiResult({ ok: true, text: 'AI connected.' });
    setTestingAi(false);
  }, [draft.llm, keyInput, reuseOpenAiKey]);

  const verifyVoice = useCallback(async () => {
    setTestingVoice(true);
    setVoiceResult(null);
    const cfg = { ...draft.tts, apiKey: voiceKey };
    const pipe = new AudioPipeline();
    try {
      const tts = new TTSClient(pipe);
      if (cfg.provider === 'elevenlabs') {
        const found = await discoverVoices('elevenlabs', voiceKey);
        if (!found.ok) {
          setVoiceResult({ ok: false, text: found.message ?? 'That voice key could not be checked.' });
          return;
        }
        setVoiceList(found.voices);
        if (!cfg.voiceId && found.voices[0]) {
          cfg.voiceId = found.voices[0].id;
          setDraft((d) => ({ ...d, tts: { ...d.tts, voiceId: found.voices[0].id, apiKey: voiceKey } }));
        }
      }
      const spoken = await tts.testVoice(cfg);
      setVoiceResult({ ok: spoken.ok, text: spoken.ok ? 'Voice connected.' : spoken.message });
      if (spoken.ok) {
        setDraft((d) => ({ ...d, tts: { ...d.tts, apiKey: voiceKey, voiceId: cfg.voiceId } }));
      }
    } finally {
      pipe.close();
      setTestingVoice(false);
    }
  }, [draft.tts, voiceKey]);

  const enableMicrophone = useCallback(async () => {
    setMicResult(null);
    setListening(true);
    try {
      const meter = await startMicMeter((level) => setMicLevel(level), draft.mic.deviceId);
      meterRef.current = meter;
      // Give the user a few seconds of visible level before judging the result.
      const peak = await new Promise<number>((resolve) => {
        let high = 0;
        const started = performance.now();
        const poll = setInterval(() => {
          setMicLevel((l) => {
            high = Math.max(high, l);
            return l;
          });
          if (performance.now() - started > 3000) {
            clearInterval(poll);
            resolve(high);
          }
        }, 100);
      });
      stopMeter();
      setMicResult(
        peak > 0.02
          ? { ok: true, text: 'Microphone working.' }
          : { ok: false, text: 'No voice detected. Try speaking closer to the phone.' },
      );
    } catch (e) {
      stopMeter();
      setMicResult({ ok: false, text: e instanceof Error ? e.message : 'KITT could not open the microphone.' });
    }
  }, [draft.mic.deviceId, stopMeter]);

  const facts: SetupFacts = {
    mode: draft.llm.provider === 'demo' ? 'demo' : 'full',
    llmProvider: draft.llm.provider,
    llmKeyPresent: Boolean(draft.llm.apiKey),
    llmVerified: aiVerified || draft.llm.provider === 'demo',
    ttsProvider: draft.tts.provider,
    voiceId: draft.tts.voiceId,
    ttsVerified: voiceVerified || draft.tts.provider === 'demo' || draft.tts.provider === 'browser',
    micPermission: micResult ? (micResult.ok ? 'granted' : 'denied') : 'unknown',
    audioOutputReady: voiceVerified,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  };
  const checks = buildSystemCheck(facts);
  const summary = summariseCheck(checks);

  const stepIndex = STAGES.indexOf(stage);

  return (
    <div
      role="dialog"
      aria-label="KITT setup"
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 60,
        overflowY: 'auto',
        padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      <div style={{ maxWidth: 560, margin: '0 auto', color: '#ccc' }}>
        {stage !== 'welcome' && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ ...mute, letterSpacing: '0.2em' }}>
              KITT SETUP · STEP {Math.min(stepIndex, 4)} OF 4
            </span>
            <button style={{ ...btn, minHeight: 40, padding: '8px 12px' }} onClick={skipWithCurrent}>
              SKIP FOR NOW
            </button>
          </div>
        )}

        {stage === 'welcome' && (
          <div>
            <h1 style={h1}>WELCOME TO KITT</h1>
            <p style={body}>
              KITT is an entertainment companion: talk to him and he answers out loud while the original voice
              modulator moves with his voice.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
              <button style={{ ...primary, textAlign: 'left' }} onClick={tryDemoNow}>
                ▶ TRY KITT NOW
                <span style={{ display: 'block', ...mute, marginTop: 4 }}>No setup required</span>
              </button>
              <button
                style={{ ...btn, textAlign: 'left' }}
                onClick={() => {
                  // Preselect the most common provider so the key field is
                  // immediately available; the user can still switch cards.
                  setDraft((d) =>
                    d.llm.provider === 'demo'
                      ? { ...d, llm: { ...d.llm, provider: 'openai', model: PROVIDER_CARDS[0].preferredModels[0] } }
                      : d,
                  );
                  setStage('ai');
                }}
              >
                ⚙ SET UP FULL KITT
                <span style={{ display: 'block', ...mute, marginTop: 4 }}>Connect AI and voice services</span>
              </button>
            </div>
            <p style={{ ...mute, marginTop: 20 }}>
              KITT is a fan-made tribute and is not affiliated with any rights holder of the television series that
              inspired him. Demo mode uses KITT&apos;s own synthesised voice.
            </p>
          </div>
        )}

        {stage === 'ai' && (
          <div>
            <h1 style={h1}>CONNECT AI BRAIN</h1>
            <p style={body}>Choose the service that will give KITT his intelligence. You supply your own account key.</p>
            <p style={{ ...mute, marginTop: 8 }}>
              Your provider bills you separately for whatever KITT uses. KITT does not create that account and does not pay
              for your calls. Pricing changes often, so check your provider&apos;s own page.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {PROVIDER_CARDS.map((p) => {
                const active = draft.llm.provider === p.id;
                return (
                  <button
                    key={p.id}
                    style={{
                      ...(active ? primary : btn),
                      textAlign: 'left',
                      opacity: active ? 1 : 0.92,
                    }}
                    aria-pressed={active}
                    onClick={() => {
                      setDraft((d) => ({ ...d, llm: { ...d.llm, provider: p.id, model: p.preferredModels[0] } }));
                      setAiResult(null);
                      setModels([]);
                      setModelNote('');
                      setKeyInput('');
                    }}
                  >
                    {p.name}
                    <span style={{ display: 'block', ...mute, marginTop: 4 }}>{p.blurb}</span>
                  </button>
                );
              })}
            </div>

            {aiCard && (
              <div style={{ marginTop: 20 }}>
                <label style={{ ...body, display: 'block', marginBottom: 6 }} htmlFor="kitt-ai-key">
                  Paste your {aiCard.name} API key
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="kitt-ai-key"
                    type={showKey ? 'text' : 'password'}
                    style={{ ...input, flex: 1 }}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="Paste your key here"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    inputMode="text"
                  />
                  <button style={{ ...btn, minWidth: 76 }} onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Hide key' : 'Show key'}>
                    {showKey ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
                <p style={{ ...mute, marginTop: 6 }}>{aiCard.keyHint}</p>
                <p style={{ marginTop: 8 }}>
                  <a
                    href={aiCard.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#8ab4f8', fontSize: 13 }}
                  >
                    HOW DO I GET A KEY?
                  </a>
                </p>

                {aiCard.reusableForSpeech && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, ...body }}>
                    <input
                      type="checkbox"
                      checked={reuseOpenAiKey}
                      onChange={(e) => setReuseOpenAiKey(e.target.checked)}
                      style={{ marginTop: 4 }}
                    />
                    <span>Use this same key for speech recognition and voice, so you only paste it once.</span>
                  </label>
                )}

                <button
                  style={{ ...primary, marginTop: 14, width: '100%' }}
                  disabled={testingAi || keyInput.trim().length < 8}
                  onClick={() => void verifyAi()}
                >
                  {testingAi ? 'TESTING…' : 'TEST CONNECTION'}
                </button>
                {aiResult && (
                  <p role="status" style={{ color: aiResult.ok ? '#7bd87b' : '#ff6b6b', marginTop: 10 }}>
                    {aiResult.ok ? '✓ ' : '✖ '}
                    {aiResult.text}
                  </p>
                )}
                {aiResult?.ok && modelNote && <p style={{ ...mute, marginTop: 6 }}>{modelNote}</p>}
                {aiResult?.ok && models.length > 0 && (
                  <label style={{ display: 'block', marginTop: 12 }}>
                    <span style={{ ...mute, display: 'block', marginBottom: 4 }}>AI model (optional — KITT already chose one)</span>
                    <select
                      style={input}
                      value={draft.llm.model}
                      onChange={(e) => setDraft((d) => ({ ...d, llm: { ...d.llm, model: e.target.value } }))}
                    >
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => setStage('welcome')}>
                BACK
              </button>
              <button style={{ ...primary, flex: 1, minWidth: 160 }} disabled={!aiVerified} onClick={() => setStage('voice')}>
                CONTINUE
              </button>
            </div>
            {!aiVerified && (
              <p style={{ ...mute, marginTop: 8 }}>
                KITT needs a working connection to continue, or you can TRY KITT NOW in demo mode instead.
              </p>
            )}
          </div>
        )}

        {stage === 'voice' && (
          <div>
            <h1 style={h1}>CHOOSE KITT&apos;S VOICE</h1>
            <p style={body}>How should KITT sound when he answers you?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
              {(
                [
                  { id: 'demo', name: 'KITT Demo Voice', blurb: 'KITT’s own synthesised voice. Free and offline.' },
                  { id: 'browser', name: 'Device Voice', blurb: 'The built-in voice already on this device.' },
                  { id: 'openai', name: 'OpenAI Voice', blurb: 'Natural spoken voice through OpenAI.' },
                  { id: 'elevenlabs', name: 'Custom Voice', blurb: 'Your own voice from an ElevenLabs account.' },
                ] as { id: TTSProviderId; name: string; blurb: string }[]
              ).map((option) => {
                const active = draft.tts.provider === option.id;
                return (
                  <button
                    key={option.id}
                    style={{ ...(active ? primary : btn), textAlign: 'left' }}
                    aria-pressed={active}
                    onClick={() => {
                      setDraft((d) => ({
                        ...d,
                        tts: { ...d.tts, provider: option.id, voiceId: option.id === 'openai' ? d.tts.voiceId || 'onyx' : d.tts.voiceId },
                      }));
                      setVoiceResult(null);
                      setVoiceList([]);
                    }}
                  >
                    {option.name}
                    <span style={{ display: 'block', ...mute, marginTop: 4 }}>{option.blurb}</span>
                  </button>
                );
              })}
            </div>

            {(draft.tts.provider === 'openai' || draft.tts.provider === 'elevenlabs') && (
              <div style={{ marginTop: 20 }}>
                <label style={{ ...body, display: 'block', marginBottom: 6 }} htmlFor="kitt-voice-key">
                  Paste your {draft.tts.provider === 'openai' ? 'OpenAI' : 'ElevenLabs'} API key
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    id="kitt-voice-key"
                    type={showVoiceKey ? 'text' : 'password'}
                    style={{ ...input, flex: 1 }}
                    value={voiceKey}
                    onChange={(e) => setVoiceKey(e.target.value)}
                    placeholder="Paste your key here"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                  />
                  <button style={{ ...btn, minWidth: 76 }} onClick={() => setShowVoiceKey((v) => !v)} aria-label={showVoiceKey ? 'Hide key' : 'Show key'}>
                    {showVoiceKey ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
                <p style={{ ...mute, marginTop: 6 }}>
                  {draft.tts.provider === 'openai'
                    ? 'Starts with “sk-”, from your OpenAI account.'
                    : 'Starts with “sk_”, from the ElevenLabs account held by the voice owner.'}
                </p>
                <button
                  style={{ ...primary, marginTop: 14, width: '100%' }}
                  disabled={testingVoice || voiceKey.trim().length < 8}
                  onClick={() => void verifyVoice()}
                >
                  {testingVoice ? 'TESTING…' : 'TEST VOICE'}
                </button>
                {voiceResult && (
                  <p role="status" style={{ color: voiceResult.ok ? '#7bd87b' : '#ff6b6b', marginTop: 10 }}>
                    {voiceResult.ok ? '✓ ' : '✖ '}
                    {voiceResult.text}
                  </p>
                )}
                {voiceList.length > 0 && (
                  <label style={{ display: 'block', marginTop: 14 }}>
                    <span style={{ ...mute, display: 'block', marginBottom: 4 }}>Select Voice</span>
                    <select
                      style={input}
                      value={draft.tts.voiceId}
                      aria-label="Select voice"
                      onChange={(e) => setDraft((d) => ({ ...d, tts: { ...d.tts, voiceId: e.target.value } }))}
                    >
                      {voiceList.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p style={{ ...mute, marginTop: 12 }}>Test phrase: “{VOICE_TEST_PHRASE}”</p>
              </div>
            )}

            {draft.tts.provider === 'demo' && (
              <p style={{ ...mute, marginTop: 12 }}>
                KITT&apos;s demo voice is generated on this device — no account, no cost, and it works offline.
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => setStage('ai')}>
                BACK
              </button>
              <button style={{ ...primary, flex: 1, minWidth: 160 }} onClick={() => setStage('mic')}>
                CONTINUE
              </button>
            </div>
          </div>
        )}

        {stage === 'mic' && (
          <div>
            <h1 style={h1}>MICROPHONE</h1>
            <p style={body}>
              KITT needs microphone access so he can hear you. The microphone is only open while you are talking with
              him, and it closes the moment you press END.
            </p>
            <button
              style={{ ...primary, marginTop: 16, width: '100%' }}
              disabled={listening}
              onClick={() => void enableMicrophone()}
            >
              {listening ? 'LISTENING…' : 'ENABLE MICROPHONE'}
            </button>

            {listening && (
              <div style={{ marginTop: 12 }} aria-hidden>
                <div style={{ height: 8, background: '#111', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, micLevel * 100)}%`, height: '100%', background: '#ffd400' }} />
                </div>
                <p style={{ ...mute, marginTop: 6 }}>Listening…</p>
              </div>
            )}

            {micResult && (
              <p role="status" style={{ color: micResult.ok ? '#7bd87b' : '#ff9a3c', marginTop: 12 }}>
                {micResult.ok ? '✓ ' : '! '}
                {micResult.text}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
              <button style={btn} onClick={() => setStage('voice')}>
                BACK
              </button>
              <button style={{ ...primary, flex: 1, minWidth: 160 }} onClick={() => setStage('check')}>
                CONTINUE
              </button>
            </div>
            <p style={{ ...mute, marginTop: 8 }}>You can type to KITT instead if you prefer not to use the microphone.</p>
          </div>
        )}

        {stage === 'check' && (
          <div>
            <h1 style={h1}>KITT SYSTEM CHECK</h1>
            <ul style={{ listStyle: 'none', padding: 0, marginTop: 12 }}>
              {checks.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '10px 0',
                    borderBottom: '1px solid #1c1c1c',
                  }}
                >
                  <span style={body}>{c.label}</span>
                  <span
                    style={{
                      color: c.status === 'ok' ? '#7bd87b' : c.status === 'warn' ? '#ff9a3c' : '#ff6b6b',
                      fontSize: 13,
                      textAlign: 'right',
                    }}
                  >
                    {c.status === 'ok' ? '✓ ' : c.status === 'warn' ? '! ' : '✖ '}
                    {c.detail}
                  </span>
                </li>
              ))}
            </ul>

            <p style={{ ...body, marginTop: 16 }}>
              {summary.ready
                ? `${summary.passed} of ${checks.length} checks passed.`
                : (firstBlockerSentence(summary) ?? 'Something still needs attention.')}
            </p>

            {summary.ready ? (
              <>
                <h2 style={{ ...h1, fontSize: 20, marginTop: 20 }}>KITT IS READY</h2>
                <button
                  style={{ ...primary, width: '100%', marginTop: 8 }}
                  onClick={() =>
                    finish({
                      ...draft,
                      llm: { ...draft.llm, apiKey: draft.llm.apiKey || keyInput },
                      tts: { ...draft.tts, apiKey: draft.tts.apiKey || voiceKey },
                      setup: { complete: true, mode: draft.llm.provider === 'demo' ? 'demo' : 'full' },
                    })
                  }
                >
                  ▶ START CONVERSATION
                </button>
              </>
            ) : (
              <button style={{ ...btn, marginTop: 8 }} onClick={() => setStage('ai')}>
                GO BACK AND FIX IT
              </button>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button style={btn} onClick={() => setStage('mic')}>
                BACK
              </button>
              <button style={btn} onClick={skipWithCurrent}>
                SKIP FOR NOW
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
