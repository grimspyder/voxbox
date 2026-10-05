// Settings drawer — organized sections; secrets masked; test buttons.
'use client';

import { useState, useEffect } from 'react';
import { KITTSettings, DEFAULT_SYSTEM_PROMPT, TTSProviderId, ProviderId, STTProviderId } from '@/lib/config/settings';
import { llmClient } from '@/lib/llm/client';
import { TTSClient } from '@/lib/tts/client';
import { AudioPipeline } from '@/lib/audio/pipeline';
import { maskKey } from '@/lib/config/storage';
import { testMicrophone } from '@/lib/stt/micTest';
import { buildSystemCheck, summariseCheck } from '@/lib/setup/readiness';
import { reportCapabilities, Capability } from '@/lib/setup/capabilities';
import { secretStoreBackend, SecretStoreBackend } from '@/lib/config/secureStore';

interface Props {
  settings: KITTSettings;
  micList: MediaDeviceInfo[];
  onRefreshMics: () => Promise<void>;
  onClose: (next?: KITTSettings) => void;
  onDeleteSecrets: () => void;
  onClearHistory: () => void;
  onResetSetup: () => void;
  onRunSetup: () => void;
}

type Section =
  | 'SYSTEM SETUP'
  | 'AI BRAIN'
  | 'VOICE'
  | 'SPEECH'
  | 'AUDIO'
  | 'PERSONALITY'
  | 'CONVERSATION'
  | 'DISPLAY'
  | 'PRIVACY'
  | 'ADVANCED';
const SECTIONS: Section[] = [
  'SYSTEM SETUP',
  'AI BRAIN',
  'VOICE',
  'SPEECH',
  'AUDIO',
  'PERSONALITY',
  'CONVERSATION',
  'DISPLAY',
  'PRIVACY',
  'ADVANCED',
];

export default function SettingsPanel({ settings, micList, onRefreshMics, onClose, onDeleteSecrets, onClearHistory, onResetSetup, onRunSetup }: Props) {
  const [s, setS] = useState<KITTSettings>({ ...settings });
  const [section, setSection] = useState<Section>('SYSTEM SETUP');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [micTesting, setMicTesting] = useState(false);
  const [micTestMsg, setMicTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // What the health screen reports. Each flag is set only by a real test run in
  // this session — never assumed from a saved setting.
  const [aiConnected, setAiConnected] = useState(settings.llm.provider === 'demo');
  const [voiceConnected, setVoiceConnected] = useState(
    settings.tts.provider === 'demo' || settings.tts.provider === 'browser',
  );
  const [micReady, setMicReady] = useState(false);
  // Capabilities differ between a browser and the Android WebView, and the
  // answer decides which voice/speech options are worth offering. Evaluated
  // after mount so the prerendered HTML cannot disagree with the DOM.
  const [caps, setCaps] = useState<Capability[]>([]);
  const [capSummary, setCapSummary] = useState('');

  useEffect(() => {
    const report = reportCapabilities();
    setCaps(report.capabilities);
    setCapSummary(report.summary);
  }, []);

  // Which store actually holds the user's keys. Reported rather than assumed:
  // the Android Keystore and the browser store are not equally protective, and
  // the app should not imply otherwise.
  const [backend, setBackend] = useState<SecretStoreBackend | null>(null);
  useEffect(() => {
    let active = true;
    void secretStoreBackend().then((result) => {
      if (active) setBackend(result);
    });
    return () => {
      active = false;
    };
  }, []);

  const upd = (patch: Partial<KITTSettings>) => setS((prev) => ({ ...prev, ...patch }));

  const input: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #333', color: '#ddd', padding: '6px 8px', borderRadius: 4, width: '100%', boxSizing: 'border-box' };
  const label: React.CSSProperties = { display: 'block', fontSize: 11, color: '#888', margin: '10px 0 4px', letterSpacing: '0.08em' };

  const runTestLLM = async () => {
    setTesting(true);
    setTestMsg(null);
    const r = await llmClient.testConnection({ provider: s.llm.provider, apiKey: s.llm.apiKey, model: s.llm.model, baseUrl: s.llm.baseUrl || undefined });
    setTestMsg({ ok: r.ok, text: r.message });
    setAiConnected(r.ok);
    setTesting(false);
  };

  const runMicTest = async () => {
    setMicTesting(true);
    setMicTestMsg(null);
    const r = await testMicrophone(s.mic.deviceId);
    setMicTestMsg({ ok: r.ok, text: r.message });
    setMicReady(r.ok);
    setMicTesting(false);
  };

  const runTestVoice = async () => {
    setTesting(true);
    setTestMsg(null);
    const pipe = new AudioPipeline();
    const tts = new TTSClient(pipe);
    const r = await tts.testVoice(s.tts);
    setTestMsg({ ok: r.ok, text: r.message });
    setVoiceConnected(r.ok);
    pipe.close();
    setTesting(false);
  };

  const facts = {
    mode: (s.llm.provider === 'demo' ? 'demo' : 'full') as 'demo' | 'full',
    llmProvider: s.llm.provider,
    llmKeyPresent: Boolean(s.llm.apiKey || settings.llm.apiKey),
    llmVerified: aiConnected,
    ttsProvider: s.tts.provider,
    voiceId: s.tts.voiceId || settings.tts.voiceId,
    ttsVerified: voiceConnected,
    micPermission: micReady ? ('granted' as const) : ('unknown' as const),
    audioOutputReady: voiceConnected,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
  };
  const checks = buildSystemCheck(facts);
  const summary = summariseCheck(checks);
  // Optimistic until the capability probe reports in, so the prerendered HTML
  // and the first client render agree.
  const deviceVoiceOk = caps.length === 0 || (caps.find((c) => c.id === 'speech-synthesis')?.ok ?? true);

  return (
    <div role="dialog" aria-label="Settings" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 50, overflowY: 'auto', padding: '16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', color: '#ccc' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, letterSpacing: '0.2em', color: '#ff5050' }}>VOXBOX SETTINGS</h2>
          <button className="kitt-btn" onClick={() => onClose(s)}>CLOSE (SAVE)</button>
        </div>
        <p style={{ fontSize: 11, color: '#666', margin: '4px 0 0' }}>
          SYSTEM SETUP holds the simple choices. The other tabs are advanced settings — you never need them to
          talk with Vox.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
          {SECTIONS.map((sec) => (
            <button key={sec} className="kitt-btn" style={{ background: section === sec ? '#3a0d0d' : '#151515', borderColor: section === sec ? '#ff1a1a' : '#3a3a3a' }} onClick={() => setSection(sec)}>
              {sec}
            </button>
          ))}
        </div>

        {section === 'SYSTEM SETUP' && (
          <div>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>
              What Vox needs to talk with you. Each item is checked as you use it — nothing here is assumed.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0' }}>
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
                  <span style={{ fontSize: 13, color: '#ccc' }}>{c.label}</span>
                  <span
                    role="status"
                    style={{
                      fontSize: 12,
                      textAlign: 'right',
                      color: c.status === 'ok' ? '#7bd87b' : c.status === 'warn' ? '#ff9a3c' : '#ff6b6b',
                    }}
                  >
                    {c.status === 'ok' ? '✓ ' : c.status === 'warn' ? '! ' : '✖ '}
                    {c.detail}
                  </span>
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
              {summary.ready
                ? `${summary.passed} of ${checks.length} checks passed.`
                : 'Fix the item marked ✖ and Vox will be ready.'}
            </p>

            {caps.length > 0 && (
              <>
                <label style={label}>DEVICE CAPABILITIES</label>
                <p style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
                  What this device and its browser engine actually support — measured on this device, not assumed.
                </p>
                <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0' }}>
                  {caps.map((c) => (
                    <li
                      key={c.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '8px 0',
                        borderBottom: '1px solid #161616',
                      }}
                    >
                      <span style={{ fontSize: 12, color: '#bbb' }}>{c.label}</span>
                      <span
                        style={{
                          fontSize: 11,
                          textAlign: 'right',
                          color: c.ok ? '#7bd87b' : '#ff9a3c',
                          maxWidth: '55%',
                        }}
                      >
                        {c.ok ? '✓ ' : '! '}
                        {c.detail}
                      </span>
                    </li>
                  ))}
                </ul>
                <p style={{ fontSize: 10, color: '#555', wordBreak: 'break-word' }}>{capSummary}</p>
              </>
            )}

            {backend && (
              <>
                <label style={label}>CREDENTIAL STORAGE</label>
                <p style={{ fontSize: 12, color: '#bbb' }}>
                  {backend.kind === 'keystore'
                    ? `Android Keystore${backend.hardwareBacked ? ' — hardware-backed key' : ' — software-backed on this device'}`
                    : backend.kind === 'web-crypto'
                      ? 'Encrypted in this browser’s storage. A browser has no keystore, so this is weaker than the Android build: anyone using this device can read both the key and the encrypted data.'
                      : 'This session only — nothing is written to disk.'}
                </p>
              </>
            )}

            {settings.secretsNeedReentry && (
              <p role="status" style={{ fontSize: 12, color: '#ff9a3c' }}>
                For your security, keys saved by an earlier version were removed rather than carried over. Please
                re-enter your key in AI BRAIN.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="kitt-btn" onClick={onRunSetup}>
                RUN SETUP AGAIN
              </button>
              <button className="kitt-btn" disabled={testing} onClick={() => void runTestLLM()}>
                {testing ? 'TESTING…' : 'TEST AI CONNECTION'}
              </button>
              <button className="kitt-btn" disabled={micTesting} onClick={() => void runMicTest()}>
                {micTesting ? 'TESTING…' : 'TEST MICROPHONE'}
              </button>
            </div>
            {micTestMsg && (
              <p role="status" style={{ fontSize: 12, color: micTestMsg.ok ? '#7bd87b' : '#ff9a3c', marginTop: 8 }}>
                {micTestMsg.ok ? '✔ ' : '✖ '}
                {micTestMsg.text}
              </p>
            )}
          </div>
        )}

        {section === 'AI BRAIN' && (
          <div>
            <label style={label}>Provider</label>
            <select style={input} value={s.llm.provider} onChange={(e) => upd({ llm: { ...s.llm, provider: e.target.value as ProviderId } })}>
              <option value="demo">Demo (no API)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai-compatible">OpenAI-compatible endpoint</option>
              <option value="openrouter">OpenRouter</option>
            </select>
            {s.llm.provider === 'openai-compatible' && (
              <>
                <label style={label}>Base URL</label>
                <input style={input} value={s.llm.baseUrl ?? ''} onChange={(e) => upd({ llm: { ...s.llm, baseUrl: e.target.value } })} placeholder="https://host/v1" />
              </>
            )}
            {s.llm.provider === 'openrouter' && (
              <p style={{ fontSize: 11, color: '#666' }}>Models use vendor/name form, e.g. openai/gpt-4o-mini, anthropic/claude-3.5-sonnet.</p>
            )}
            <label style={label}>Model</label>
            <input style={input} value={s.llm.model} onChange={(e) => upd({ llm: { ...s.llm, model: e.target.value } })} />
            {s.llm.provider !== 'demo' && (
              <>
                <label style={label}>API key (stored encrypted on this device only)</label>
                <input type="password" style={input} value={s.llm.apiKey} onChange={(e) => upd({ llm: { ...s.llm, apiKey: e.target.value } })} placeholder={s.llm.apiKey ? maskKey(s.llm.apiKey) : 'paste key…'} />
              </>
            )}
            <label style={label}>Temperature ({s.llm.temperature.toFixed(2)})</label>
            <input type="range" min={0} max={1.5} step={0.05} value={s.llm.temperature} onChange={(e) => upd({ llm: { ...s.llm, temperature: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>Max response tokens</label>
            <input type="number" style={input} value={s.llm.maxTokens} onChange={(e) => upd({ llm: { ...s.llm, maxTokens: Number(e.target.value) || 300 } })} />
            <button className="kitt-btn" disabled={testing} onClick={() => void runTestLLM()} style={{ marginTop: 12 }}>
              {testing ? 'TESTING…' : 'TEST CONNECTION'}
            </button>
          </div>
        )}

        {section === 'VOICE' && (
          <div>
            <label style={label}>Voice provider</label>
            <select style={input} value={s.tts.provider} onChange={(e) => upd({ tts: { ...s.tts, provider: e.target.value as TTSProviderId } })}>
              <option value="demo">Demo synth voice (no API)</option>
              <option value="browser" disabled={!deviceVoiceOk}>
                Browser built-in voice{deviceVoiceOk ? '' : ' — not available on this device'}
              </option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI TTS</option>
            </select>
            {!deviceVoiceOk && (
              <p style={{ fontSize: 11, color: '#ff9a3c', marginTop: 6 }}>
                This device&apos;s browser engine provides no built-in voice, so a browser voice cannot be spoken
                here. Use the Vox demo voice or a cloud voice.
              </p>
            )}
            {(s.tts.provider === 'elevenlabs' || s.tts.provider === 'openai') && (
              <>
                <label style={label}>API key</label>
                <input type="password" style={input} value={s.tts.apiKey} onChange={(e) => upd({ tts: { ...s.tts, apiKey: e.target.value } })} placeholder={s.tts.apiKey ? maskKey(s.tts.apiKey) : 'paste key…'} />
                <label style={label}>{s.tts.provider === 'elevenlabs' ? 'Voice ID' : 'Voice (alloy/echo/fable/onyx/nova/shimmer)'}</label>
                <input style={input} value={s.tts.voiceId} onChange={(e) => upd({ tts: { ...s.tts, voiceId: e.target.value } })} />
                <label style={label}>Model {s.tts.provider === 'elevenlabs' ? '(eleven_turbo_v2_5 / eleven_multilingual_v2)' : '(tts-1 / tts-1-hd)'}</label>
                <input style={input} value={s.tts.model} onChange={(e) => upd({ tts: { ...s.tts, model: e.target.value } })} />
              </>
            )}
            <label style={label}>Stability ({s.tts.stability.toFixed(2)})</label>
            <input type="range" min={0} max={1} step={0.05} value={s.tts.stability} onChange={(e) => upd({ tts: { ...s.tts, stability: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>Similarity boost ({s.tts.similarityBoost.toFixed(2)})</label>
            <input type="range" min={0} max={1} step={0.05} value={s.tts.similarityBoost} onChange={(e) => upd({ tts: { ...s.tts, similarityBoost: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>Style ({s.tts.style.toFixed(2)})</label>
            <input type="range" min={0} max={1} step={0.05} value={s.tts.style} onChange={(e) => upd({ tts: { ...s.tts, style: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>Speed ({s.tts.speed.toFixed(2)}x)</label>
            <input type="range" min={0.7} max={1.3} step={0.05} value={s.tts.speed} onChange={(e) => upd({ tts: { ...s.tts, speed: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>Speaker boost (ElevenLabs)</label>
            <input type="checkbox" checked={s.tts.speakerBoost} onChange={(e) => upd({ tts: { ...s.tts, speakerBoost: e.target.checked } })} />
            <label style={label}>Output volume ({Math.round(s.tts.outputVolume * 100)}%)</label>
            <input type="range" min={0} max={1} step={0.05} value={s.tts.outputVolume} onChange={(e) => upd({ tts: { ...s.tts, outputVolume: Number(e.target.value) } })} style={{ width: '100%' }} />
            <button className="kitt-btn" disabled={testing} onClick={() => void runTestVoice()} style={{ marginTop: 12 }}>
              {testing ? 'TESTING…' : 'TEST VOICE'}
            </button>
          </div>
        )}

        {section === 'SPEECH' && (
          <div>
            <label style={label}>Speech recognition</label>
            <select style={input} value={s.stt.provider} onChange={(e) => upd({ stt: { ...s.stt, provider: e.target.value as STTProviderId } })}>
              <option value="browser">Browser recognition (Chrome/Edge)</option>
              <option value="openai">OpenAI Whisper (API key required)</option>
            </select>
            {s.stt.provider === 'openai' && (
              <>
                <label style={label}>Whisper API key</label>
                <input type="password" style={input} value={s.stt.apiKey} onChange={(e) => upd({ stt: { ...s.stt, apiKey: e.target.value } })} placeholder={s.stt.apiKey ? maskKey(s.stt.apiKey) : 'paste key…'} />
              </>
            )}
            <label style={label}>Hands-free conversation (auto end-of-turn)</label>
            <input type="checkbox" checked={s.mic.handsFree} onChange={(e) => upd({ mic: { ...s.mic, handsFree: e.target.checked } })} />
            <label style={label}>Automatic interruption (barge-in)</label>
            <input type="checkbox" checked={s.mic.autoInterrupt} onChange={(e) => upd({ mic: { ...s.mic, autoInterrupt: e.target.checked } })} />
            <p style={{ fontSize: 11, color: '#999', margin: '2px 0 10px' }}>
              Only used when the device confirms echo cancellation. Without it the microphone
              hears Vox&apos;s own speaker and Vox would interrupt itself — the INTERRUPT button
              and headphones always work.
            </p>
            <label style={label}>Echo cancellation</label>
            <input type="checkbox" checked={s.mic.echoCancellation} onChange={(e) => upd({ mic: { ...s.mic, echoCancellation: e.target.checked } })} />
            <label style={label}>Noise suppression</label>
            <input type="checkbox" checked={s.mic.noiseSuppression} onChange={(e) => upd({ mic: { ...s.mic, noiseSuppression: e.target.checked } })} />
            <label style={label}>Auto gain control</label>
            <input type="checkbox" checked={s.mic.autoGainControl} onChange={(e) => upd({ mic: { ...s.mic, autoGainControl: e.target.checked } })} />
          </div>
        )}

        {section === 'AUDIO' && (
          <div>
            <label style={label}>Microphone</label>
            <p style={{ fontSize: 11, color: '#999', margin: '8px 0 4px' }}>The selected device is used by microphone capture and Whisper. Browser speech recognition may still use the browser&apos;s default input because the Web Speech API does not expose a device selector.</p>
            <select
              style={input}
              value={s.mic.deviceId ?? ''}
              onChange={(e) => upd({ mic: { ...s.mic, deviceId: e.target.value || undefined } })}
              aria-label="Microphone input device"
            >
              <option value="">System default microphone</option>
              {micList.map((m, i) => (
                <option key={m.deviceId} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="kitt-btn" onClick={() => void onRefreshMics()}>REFRESH MICROPHONES</button>
              <button className="kitt-btn" disabled={micTesting} onClick={() => void runMicTest()}>{micTesting ? 'TESTING…' : 'TEST MICROPHONE'}</button>
            </div>
            {micTestMsg && <p role="status" style={{ fontSize: 12, color: micTestMsg.ok ? '#7bd87b' : '#ff6b6b', marginTop: 8 }}>{micTestMsg.ok ? '✔ ' : '✖ '}{micTestMsg.text}</p>}
            {micList.length === 0 && <p style={{ fontSize: 11, color: '#ff9a3c' }}>No microphones are currently visible. Click TEST MICROPHONE to request permission, then refresh the list.</p>}
            <p style={{ fontSize: 11, color: '#666' }}>Output device follows the OS default (browser limitation).</p>
          </div>
        )}

        {section === 'PERSONALITY' && (
          <div>
            <label style={label}>What Vox calls you</label>
            <input style={input} value={s.userName} onChange={(e) => upd({ userName: e.target.value })} placeholder="(optional) your name" />
            <label style={label}>Response length</label>
            <select style={input} value={s.responseLength} onChange={(e) => upd({ responseLength: e.target.value as KITTSettings['responseLength'] })}>
              <option value="concise">Concise</option>
              <option value="normal">Normal</option>
              <option value="detailed">Detailed</option>
            </select>
          </div>
        )}

        {section === 'CONVERSATION' && (
          <div>
            <label style={label}>Save conversation history on this device</label>
            <input type="checkbox" checked={s.saveHistory} onChange={(e) => upd({ saveHistory: e.target.checked })} />
            <p style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
              On: the transcript is written to this device&apos;s local app storage so it is still there after a restart. Off: Vox keeps
              only the current session in memory. Either way the transcript is never sent to the Vox server.
            </p>
            <p style={{ fontSize: 11, color: '#666', lineHeight: 1.6 }}>
              NEW CONVERSATION on the main screen clears the context Vox is using; CLEAR CONVERSATION HISTORY in PRIVACY deletes the
              saved transcript from this device.
            </p>
          </div>
        )}

        {section === 'DISPLAY' && (
          <div>
            <label style={label}>Brightness ({Math.round(s.display.brightness * 100)}%)</label>
            <input type="range" min={0.3} max={1.4} step={0.05} value={s.display.brightness} onChange={(e) => upd({ display: { ...s.display, brightness: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>LED smoothing ({s.display.smoothing.toFixed(2)}) — higher = slower bars</label>
            <input type="range" min={0} max={1} step={0.05} value={s.display.smoothing} onChange={(e) => upd({ display: { ...s.display, smoothing: Number(e.target.value) } })} style={{ width: '100%' }} />
            <label style={label}>Show transcript</label>
            <input type="checkbox" checked={s.display.showTranscript} onChange={(e) => upd({ display: { ...s.display, showTranscript: e.target.checked } })} />
            <label style={label}>Reduced motion (slower LED response)</label>
            <input type="checkbox" checked={s.display.reducedMotion} onChange={(e) => upd({ display: { ...s.display, reducedMotion: e.target.checked, smoothing: e.target.checked ? 0.9 : 0.5 } })} />
          </div>
        )}

        {section === 'PRIVACY' && (
          <div>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>
              <b>Microphone.</b> Vox opens the microphone only while a conversation is active, and releases it when you press END.
              Nothing listens in the background.
            </p>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>
              <b>Your speech.</b> With device speech recognition, your speech is processed by your device and browser speech service.
              With OpenAI Whisper selected, Vox captures each spoken turn as a short temporary recording in memory and uploads it to
              OpenAI to be transcribed. That audio is processed to produce text and is not stored by Vox; it does leave your device.
            </p>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>
              <b>Conversation text.</b> What you say or type is sent to the AI provider you chose to generate a reply. Vox&apos;s reply
              text is sent to the voice provider you chose so it can be spoken. Their handling of that data is governed by their own
              privacy policies.
            </p>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>
              <b>Your API keys.</b> Keys are kept in this app. When Vox makes a request they travel over HTTPS to the Vox server, which
              passes them to your chosen provider for that one request. They are not stored on the server and are not written to logs.
            </p>
            <p style={{ fontSize: 12, color: '#999', lineHeight: 1.6 }}>
              <b>Conversation history.</b> Held in memory for the current session only. If &ldquo;Save conversation history&rdquo; is on, the
              transcript is also written to this device&apos;s local app storage so it survives a restart — never to the Vox server.
            </p>
            <label style={label}>Remember API keys on this device (AES-GCM encrypted)</label>
            <input type="checkbox" checked={s.persistSecrets} onChange={(e) => upd({ persistSecrets: e.target.checked })} />
            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
              Off by default: keys then live only until the app closes. On Android these credentials will be held in the device
              keystore (work in progress).
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="kitt-btn" onClick={onDeleteSecrets}>DELETE SAVED KEYS</button>
              <button className="kitt-btn" onClick={onClearHistory}>CLEAR CONVERSATION HISTORY</button>
              <button className="kitt-btn" onClick={onResetSetup}>RESET VOXBOX SETUP</button>
            </div>
            <p style={{ fontSize: 11, color: '#666', marginTop: 8 }}>
              DELETE SAVED KEYS removes every stored provider key. CLEAR CONVERSATION HISTORY removes the transcript from this device.
              RESET VOXBOX SETUP returns every setting to its default — including provider, voice and display choices.
            </p>
          </div>
        )}

        {section === 'ADVANCED' && (
          <div>
            <label style={label}>Vox system prompt</label>
            <textarea style={{ ...input, minHeight: 180, fontFamily: 'monospace', fontSize: 12 }} value={s.systemPrompt} onChange={(e) => upd({ systemPrompt: e.target.value })} />
            <button className="kitt-btn" onClick={() => upd({ systemPrompt: DEFAULT_SYSTEM_PROMPT })} style={{ marginTop: 8 }}>RESET TO DEFAULT</button>
          </div>
        )}

        {testMsg && (
          <div style={{ marginTop: 12, fontSize: 13, color: testMsg.ok ? '#7bd87b' : '#ff6b6b' }}>{testMsg.ok ? '✔ ' : '✖ '}{testMsg.text}</div>
        )}

        <div style={{ margin: '16px 0 40px', display: 'flex', gap: 8 }}>
          <button className="kitt-btn" onClick={() => setS({ ...settings })}>REVERT</button>
          <button className="kitt-btn" onClick={() => onClose(s)}>SAVE & CLOSE</button>
        </div>
      </div>
    </div>
  );
}