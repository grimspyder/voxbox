// Maps live audio analysis to the three-bar Vox voice modulator levels.
// Left bar: low band. Center: mid (strongest vocal energy). Right: high band.
// Bars expand symmetrically FROM CENTER — discrete segments light outward.

export interface BarLevels {
  left: number; // 0..1
  center: number;
  right: number;
}

export interface ModulatorTuning {
  attackMs: number; // rise speed
  releaseMs: number; // fall speed
  noiseFloor: number; // below this RMS, treat as silence
  minActivation: number; // minimum segment level when audio present
  gain: number; // input gain applied to band energies
  smoothing: number; // 0..1 extra exponential smoothing on top
}

export const DEFAULT_TUNING: ModulatorTuning = {
  // Tuned for the short, discrete bursts of the physical Vox display.
  attackMs: 18,
  releaseMs: 88,
  noiseFloor: 0.018,
  minActivation: 0.045,
  gain: 3.4,
  smoothing: 0.12,
};

export const SEGMENTS = 16; // LED segments per bar (research: 16-segment bargraph)

/**
 * Compute per-bar display levels from band energies.
 * Pure function — unit-testable. `prev` allows attack/release smoothing.
 */
export function computeBarLevels(
  bands: { low: number; mid: number; high: number },
  rms: number,
  tuning: ModulatorTuning,
  prev: BarLevels | null,
  dtMs: number,
): BarLevels {
  const floor = tuning.noiseFloor;
  const silent = rms < floor && bands.low < floor && bands.mid < floor && bands.high < floor;
  const g = tuning.gain;
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

  // Vox's two outer columns are mirrored: both show the same level.
  // The center column follows the same speech envelope with a modest boost.
  // Frequency analysis is intentionally used only to stabilize the shared
  // voice envelope; it must never make left and right diverge.
  const bandEnergy = (bands.low + bands.mid + bands.high) / 3;
  const rawEnergy = Math.max(rms, bandEnergy * 0.65);
  // This is a speech-presence display, not a volume meter. Compress loud
  // input and reserve the outermost segments for exceptional peaks so normal
  // speech produces readable, animated mid-height bursts.
  const compressed = Math.tanh(Math.max(0, rawEnergy * g - floor) * 1.4);
  const envelope = clamp01(compressed * 0.62);
  const outer = clamp01(envelope * 0.68);
  const targets = {
    left: outer,
    center: clamp01(envelope * 0.9),
    right: outer,
  };
  if (silent) {
    targets.left = 0;
    targets.center = 0;
    targets.right = 0;
  } else {
    targets.center = Math.max(targets.center, tuning.minActivation);
    targets.left = Math.max(targets.left, tuning.minActivation * 0.7);
    targets.right = Math.max(targets.right, tuning.minActivation * 0.6);
  }

  const attack = tuning.attackMs / 1000;
  const release = tuning.releaseMs / 1000;

  const smooth = (cur: number, target: number): number => {
    const tau = target > cur ? attack : release;
    const k = 1 - Math.exp(-dtMs / (tau * 1000 * 0.35));
    let v = cur + (target - cur) * k;
    if (tuning.smoothing > 0) {
      const s = 1 - tuning.smoothing * 0.7;
      v = v * s + target * (1 - s);
    }
    // Quantize only the rendered level, not the analyser input. This creates
    // crisp hardware-like segment changes while preserving envelope timing.
    const quantized = v < 1 / SEGMENTS ? v : Math.round(v * SEGMENTS) / SEGMENTS;
    return clamp01(quantized);
  };

  const prevL = prev ?? { left: 0, center: 0, right: 0 };
  return {
    left: smooth(prevL.left, targets.left),
    center: smooth(prevL.center, targets.center),
    right: smooth(prevL.right, targets.right),
  };
}

/**
 * Convert a bar level (0..1) into a segment pattern expanding from center.
 * Returns array of length SEGMENTS: index 0 = center pair, higher = outward.
 * Values are segment intensities 0..1 (>=0.5 means lit).
 */
export function levelToSegments(level: number): boolean[] {
  const out: boolean[] = new Array(SEGMENTS).fill(false);
  const n = Math.round(level * SEGMENTS);
  for (let i = 0; i < n && i < SEGMENTS; i++) out[i] = true;
  // half-lit next segment for smoother perception
  return out;
}

/** How many segment-pairs should be lit for a level. */
export function litPairs(level: number): number {
  return Math.max(0, Math.min(SEGMENTS, Math.round(level * SEGMENTS)));
}