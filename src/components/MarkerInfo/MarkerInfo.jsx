import React, { useMemo, useCallback } from 'react';
import * as Plot from '@observablehq/plot';
import { computeBenefits, computeGroveStats, TIER_LABELS } from '../../lib/ecology.js';
import { formatVerified } from '../../lib/markerHelpers.js';
import { useGroveStore } from '../../store/useGroveStore.js';
import { PlotFigure } from '../charts/PlotFigure.jsx';
import { C, TIER_FILL, TIER_ALPHA, theme } from '../charts/plotTheme.js';

const STATUS_CLASS = {
  verified: 'status-verified',
  partial:  'status-partial',
  sample:   'status-sample',
};

const FOREST_KEYS = [
  { key: 'carbonStoredLb',      label: 'C stored', unit: 'lb' },
  { key: 'annualCarbonLb',      label: 'C / yr',   unit: 'lb/yr' },
  { key: 'annualStormwaterGal', label: 'H₂O',      unit: 'gal' },
  { key: 'shadeSqft',           label: 'shade',     unit: 'ft²' },
];

// Dot radius per tier — verified gets a larger, crisper dot to read as
// precise rather than empty next to its tight (±10%) uncertainty band.
const TIER_DOT_R = { verified: 5, partial: 3.5, sample: 3 };

// Band stroke width per tier — thicker for tight bands so they remain visible.
const TIER_STROKE_W = { verified: 6, partial: 4, sample: 3 };

function fmtCompact(n, unit) {
  if (!n) return '—';
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ${unit}`;
  return `${Math.round(n)} ${unit}`;
}

function buildForestSpec(width, benefits, groveStats) {
  const { tier, bands } = benefits;
  const fill      = TIER_FILL[tier];
  const alpha     = TIER_ALPHA[tier];
  const dotR      = TIER_DOT_R[tier];
  const strokeW   = TIER_STROKE_W[tier];

  const rows = FOREST_KEYS.map(({ key, label, unit }) => {
    const band = bands[key];
    const gs   = groveStats?.[key] ?? { min: 0, max: Math.max(band.value * 2, 1), median: band.value * 0.5 };
    const rng  = Math.max(gs.max - gs.min, 1);
    const norm = (v) => Math.max(0, Math.min(1, (v - gs.min) / rng));
    return {
      label,
      unit,
      value:  band.value,
      xNorm:  norm(band.value),
      xLow:   norm(band.low),
      xHigh:  norm(band.high),
      xRef:   norm(gs.median),
    };
  });

  return {
    ...theme(),
    width,
    height: FOREST_KEYS.length * 22 + 28,
    marginLeft:  46,
    marginRight: 54,
    marginTop:    6,
    marginBottom: 14,
    x: { domain: [0, 1], label: null, ticks: 0, axis: null },
    y: { domain: FOREST_KEYS.map((f) => f.label), label: null, tickSize: 0 },
    marks: [
      Plot.gridX({ stroke: C.gridLine, ticks: 4 }),
      // Grove median reference tick
      Plot.tickX(rows, { x: 'xRef', y: 'label', stroke: C.rule, strokeWidth: 1 }),
      // Completeness band — thicker stroke for verified so the tight band is legible
      Plot.ruleY(rows, {
        x1: 'xLow', x2: 'xHigh', y: 'label',
        stroke: fill, strokeWidth: strokeW, strokeLinecap: 'round',
        strokeOpacity: alpha * 0.55,
      }),
      // Point estimate — larger dot for verified communicates precision, not emptiness
      Plot.dot(rows, { x: 'xNorm', y: 'label', fill, r: dotR, fillOpacity: alpha }),
      // Raw value text
      Plot.text(rows, {
        x: () => 1,
        y: 'label',
        text: (d) => fmtCompact(d.value, d.unit),
        textAnchor: 'start',
        dx: 5,
        fontSize: 8,
        fill: C.flesh,
        fillOpacity: alpha * 0.9,
      }),
    ],
  };
}

/**
 * Shared marker info panel — renders identically in pointcloud Html balloon,
 * City3D Html balloon, and the 2D map popup overlay.
 *
 * Layout: sticky header → scrollable body → sticky footer (characterize button).
 * Height is capped at 70vh so the card never overflows any viewport.
 *
 * @param {object}   marker    Normalized marker from the store
 * @param {function} onClose   Called when the × button is pressed (optional)
 * @param {string}   className Extra class forwarded to the root balloon div
 */
export function MarkerInfo({ marker, onClose, className = '' }) {
  const openCapture = useGroveStore((s) => s.openCapture);
  const allMarkers  = useGroveStore((s) => s.markers);
  const markerId    = marker?.marker_code ?? marker?.id;

  const benefits       = useMemo(() => computeBenefits(marker), [marker]);
  const groveStats     = useMemo(() => computeGroveStats(allMarkers), [allMarkers]);
  const makeForestSpec = useCallback(
    (w) => buildForestSpec(w, benefits, groveStats),
    [benefits, groveStats],
  );

  if (!marker) return null;

  const bandNote = benefits.tier === 'verified' ? '±10%' : benefits.tier === 'partial' ? '±30%' : '±55%';

  return (
    <div
      className={`marker-balloon${className ? ` ${className}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* ── Sticky header ─────────────────────────────────────────────────────── */}
      <div className="marker-balloon-header">
        <div className="marker-balloon-id-row">
          <strong>{markerId}</strong>
          {marker.data_status && (
            <span className={`marker-status-badge ${STATUS_CLASS[marker.data_status] ?? ''}`}>
              {marker.data_status}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              className="marker-balloon-close"
              aria-label="Close"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
            >
              ×
            </button>
          )}
        </div>

        <span>{marker.commonName ?? marker.common_name ?? 'Tree marker'}</span>

        <small className="marker-species-line">
          {marker.species && marker.species !== 'Unknown'
            ? <em>{marker.species}</em>
            : 'species pending'}
          {marker.species_confidence != null && (
            <span className="marker-confidence">
              {' '}{Math.round(marker.species_confidence * 100)}%
              {marker.species_source && marker.species_source !== 'manual'
                ? ` · ${marker.species_source}` : ''}
            </span>
          )}
        </small>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────────── */}
      <div className="marker-balloon-scroll-body">
        {/* Condition + verified status */}
        <div className="marker-balloon-section">
          <small>Condition: {marker.condition ?? 'Unsurveyed'}</small>
          <small>Status: {formatVerified(marker.verified)}</small>
        </div>

        {/* Structural measurements (when characterized) */}
        {marker.dbh_in != null && (
          <div className="marker-balloon-section">
            <small className="marker-balloon-label">structure</small>
            <small>DBH: {marker.dbh_in}&Prime;</small>
            {marker.height_ft    != null && <small>Height ~{marker.height_ft} ft</small>}
            {marker.crown_spread_ft != null && <small>Crown ~{marker.crown_spread_ft} ft spread</small>}
            {marker.structure_source && marker.structure_source !== 'manual' && (
              <small className="marker-source-note">{marker.structure_source}</small>
            )}
          </div>
        )}

        {/* Per-tree eco service forest plot */}
        <div className="marker-balloon-section">
          <div className="marker-eco-header">
            <small className="marker-balloon-label">eco services</small>
            <span className={`marker-eco-badge tier-${benefits.tier}`}>{TIER_LABELS[benefits.tier]}</span>
          </div>
          <PlotFigure makeSpec={makeForestSpec} className="mi-forest-plot" />
          <small className="eco-assumption">
            Band = completeness range ({bandNote}). Tick = grove median.
          </small>
          {benefits.assumptions?.[0] && (
            <small className="eco-assumption">{benefits.assumptions[0]}</small>
          )}
        </div>
      </div>

      {/* ── Sticky footer — always reachable ─────────────────────────────────── */}
      <div className="marker-balloon-footer">
        <button
          type="button"
          className="marker-characterize-btn"
          onClick={(e) => { e.stopPropagation(); openCapture(markerId); }}
        >
          {marker.data_status === 'verified' ? '✦ Re-characterize' : '✦ Characterize'}
        </button>
      </div>
    </div>
  );
}
