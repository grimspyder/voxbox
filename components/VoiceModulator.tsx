// Vox dashboard voice modulator — three red segmented LED columns.
// Layout per reference: center column 9 rows; side columns 7 rows, aligned
// toward the vertical center of the center column. Segments expand outward
// from center. Labels: AIR/OIL/P1/P2 left; S1/S2/P3/P4 right;
// AUTO CRUISE, NORMAL CRUISE, PURSUIT center-bottom.

'use client';

import { useEffect, useRef } from 'react';
import { BarLevels } from '@/lib/audio/modulator';

export const CENTER_ROWS = 16; // total LED segments per bar (research: 16-segment bargraph)
export const SIDE_ROWS = 16;

interface Props {
  getLevels: () => BarLevels | null; // null => idle
  brightness?: number; // 0..1 display dimming
}

/** One LED segment. Active: bright red. Inactive: dark maroon. */
function Seg({ on, bright, dark }: { on: boolean; bright: string; dark: string }) {
  return (
    <div
      data-led={on ? 'on' : 'off'}
      style={{
        width: '100%',
        flex: 1,
        minHeight: 2,
        borderRadius: 1,
        background: on ? bright : dark,
        boxShadow: on ? `0 0 6px 1px ${bright}` : 'none',
        margin: '2px 0',
      }}
    />
  );
}

/**
 * Three-bar voice modulator. Rows are rendered per-column from center outward:
 * pairs [0] is nearest the horizontal center line of each column.
 */
export default function VoiceModulator({ getLevels, brightness = 1 }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = rootRef.current;
      if (!root) return;
      const levels = getLevels();
      const set = (bar: HTMLElement | null, level: number, rows: number) => {
        if (!bar) return;
        // rows are stored top->bottom; center-out expansion:
        // row i is lit if its distance from the middle (in pair units) < level*halfRows
        const children = bar.children;
        const half = rows / 2;
        for (let i = 0; i < children.length; i++) {
          const rowIdx = i; // 0..rows-1 top to bottom
          // Normalized distance: 0 at the center pair, 1 at the outer edge.
          // Comparing directly with level makes the lit height genuinely
          // proportional; the previous level*half comparison lit nearly every
          // segment even at quiet levels.
          const dist = Math.abs(rowIdx - (rows - 1) / 2) / half;
          const on = level > 0.025 && dist <= level + 0.001;
          const el = children[i] as HTMLElement;
          const wasOn = el.dataset.led === 'on';
          if (wasOn !== on) {
            el.dataset.led = on ? 'on' : 'off';
            el.style.background = on ? 'var(--kitt-led-on)' : 'var(--kitt-led-off)';
            el.style.boxShadow = on ? '0 0 6px 1px var(--kitt-led-on)' : 'none';
          }
        }
      };
      const bars = root.querySelectorAll<HTMLElement>('[data-bar]');
      const l = levels ?? { left: 0, center: 0, right: 0 };
      set(bars[0], l.left, SIDE_ROWS);
      set(bars[1], l.center, CENTER_ROWS);
      set(bars[2], l.right, SIDE_ROWS);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevels]);

  const bright = `rgba(255,26,26,${0.35 + 0.65 * brightness})`;
  const dark = `rgba(96,8,8,${0.4 + 0.6 * brightness})`;

  const col = (rows: number, barKey: string, padTop = 0, padBottom = 0) => (
    <div data-bar={barKey} style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', paddingTop: padTop, paddingBottom: padBottom }}>
      {Array.from({ length: rows }, (_, i) => (
        <Seg key={i} on={false} bright={bright} dark={dark} />
      ))}
    </div>
  );

  // side columns vertically centered relative to center column
  return (
    <div ref={rootRef} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: '100%', width: '100%' }} aria-label="Vox voice modulator" role="img">
      <div style={{ height: '100%', width: '14%', position: 'relative' }}>{col(SIDE_ROWS, 'left')}</div>
      <div style={{ height: '100%', width: '18%', position: 'relative' }}>{col(CENTER_ROWS, 'center')}</div>
      <div style={{ height: '100%', width: '14%', position: 'relative' }}>{col(SIDE_ROWS, 'right')}</div>
    </div>
  );
}