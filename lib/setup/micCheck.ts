// Live microphone level for the setup wizard's microphone step.
// Opens the microphone, reports a 0..1 level, and closes it again on stop().
// Mirrors the diagnostics view: nothing is recorded and nothing is uploaded.

export interface MicMeter {
  stop: () => void;
}

export async function startMicMeter(onLevel: (level: number) => void, deviceId?: string): Promise<MicMeter> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This device does not support microphone capture. You can still type to Vox.');
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new Error('Microphone permission was blocked. You can still type to Vox.');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      throw new Error('No microphone was found on this device. You can still type to Vox.');
    }
    throw new Error('Vox could not open the microphone. You can still type to Vox.');
  }

  const Ctor: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const buf = new Float32Array(analyser.fftSize);
  ctx.createMediaStreamSource(stream).connect(analyser);

  let raf = 0;
  let stopped = false;
  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    analyser.getFloatTimeDomainData(buf as unknown as Float32Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
  };
  raf = requestAnimationFrame(loop);

  return {
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}
