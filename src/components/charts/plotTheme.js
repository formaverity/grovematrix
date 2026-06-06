// Shared theme helpers for Observable Plot.
// CSS variables are not readable in SVG context, so palette values are hardcoded.

export const C = {
  glow:     '#7CFFB2',   // --mycelium-glow
  flesh:    '#D6D2C4',   // --fungal-flesh
  lichen:   '#6F8F72',   // --lichen-field
  muted:    'rgba(214,210,196,0.55)',
  bgDeep:   '#0E1A14',
  peat:     '#1A2A1E',
  spore:    '#8A5CFF',   // --spore-signal
  partial:  '#e2ff9a',
  gridLine: 'rgba(214,210,196,0.09)',
  rule:     'rgba(214,210,196,0.20)',
};

export const TIER_FILL = {
  verified: '#7CFFB2',
  partial:  '#e2ff9a',
  sample:   '#6F8F72',
};

export const TIER_ALPHA = {
  verified: 1.0,
  partial:  0.72,
  sample:   0.45,
};

const MONO = '"Courier Prime", "Courier New", monospace';

/**
 * Base Plot.plot() options for the app's dark theme.
 * Spread into every chart: { ...theme(), width, height, marks: [...] }
 */
export function theme(overrides = {}) {
  return {
    style: {
      background:  'transparent',
      overflow:    'visible',
      fontFamily:  MONO,
      fontSize:    '9px',
      color:       '#D6D2C4',
    },
    ...overrides,
  };
}
