import type { CSSProperties } from 'react';

export interface MonthWorkStyle extends CSSProperties {
  '--month-work-color': string;
  '--month-work-background': string;
}

/** Display identity only. Dates, status, filters and page order never recolor an entry. */
export function monthWorkAppearance(entryId: string, selectedColor?: unknown): MonthWorkStyle {
  if (typeof selectedColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(selectedColor)) {
    const channels = [1, 3, 5].map((start) =>
      Number.parseInt(selectedColor.slice(start, start + 2), 16),
    );
    const rgb = (values: number[]) => `rgb(${values.map(Math.round).join(' ')})`;
    const luminance = (values: number[]) =>
      values.reduce((sum, value, index) => {
        const channel = value / 255;
        return (
          sum +
          (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]!
        );
      }, 0);
    let accent = channels;
    while (luminance(accent) > 0.2) accent = accent.map((value) => Math.floor(value * 0.94));
    return {
      '--month-work-color': rgb(accent),
      '--month-work-background': rgb(channels.map((value) => 235 + (value * 20) / 255)),
    };
  }
  let hash = 2166136261;
  for (const character of entryId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // Mix the full identifier so nearby UUID suffixes do not produce near-identical hues.
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  hash ^= hash >>> 16;
  const hue = (hash >>> 0) % 360;
  return {
    '--month-work-color': `hsl(${hue} 65% 30%)`,
    '--month-work-background': `hsl(${hue} 70% 92%)`,
  };
}
