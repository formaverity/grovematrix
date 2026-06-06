import React, { useMemo } from 'react';
import { computeBenefits, TIER_LABELS } from '../../lib/ecology.js';
import { formatVerified } from '../../lib/markerHelpers.js';
import { useGroveStore } from '../../store/useGroveStore.js';

const STATUS_CLASS = {
  verified: 'status-verified',
  partial:  'status-partial',
  sample:   'status-sample',
};

// Bar fill color tracks the confidence tier
const TIER_COLOR = {
  verified: 'var(--mycelium-glow)',
  partial:  '#e2ff9a',
  sample:   'var(--muted)',
};

// "Good large urban tree" reference values — bars are relative, not absolute
const BAR_MAX = {
  carbonStoredLb:      5000,
  annualCarbonLb:       200,
  annualStormwaterGal: 8000,
  shadeSqft:           2000,
};

function fmt(n, unit) {
  if (!n) return '—';
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k ${unit}`;
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

function BarRow({ label, value, refMax, unit, color, alpha }) {
  const pct = refMax > 0 ? Math.min(100, (value / refMax) * 100) : 0;
  return (
    <div className="mi-bar-row" style={{ opacity: alpha }}>
      <span className="mi-bar-label">{label}</span>
      <div className="mi-bar-track">
        <div className="mi-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="mi-bar-val">{fmt(value, unit)}</span>
    </div>
  );
}

function EcoChart({ benefits }) {
  const { metrics, tier, assumptions } = benefits;
  const color = TIER_COLOR[tier];
  // Modulate visual weight honestly by confidence — sample data reads faint
  const alpha = tier === 'verified' ? 1.0 : tier === 'partial' ? 0.72 : 0.40;

  return (
    <div className="marker-balloon-section">
      <div className="marker-eco-header">
        <small className="marker-balloon-label">eco services</small>
        <span className={`marker-eco-badge tier-${tier}`}>{TIER_LABELS[tier]}</span>
      </div>
      <div className="mi-chart">
        <BarRow label="C stored"  value={metrics.carbonStoredLb}      refMax={BAR_MAX.carbonStoredLb}      unit="lb"     color={color} alpha={alpha} />
        <BarRow label="C / yr"    value={metrics.annualCarbonLb}       refMax={BAR_MAX.annualCarbonLb}      unit="lb/yr"  color={color} alpha={alpha} />
        <BarRow label="H₂O / yr" value={metrics.annualStormwaterGal}  refMax={BAR_MAX.annualStormwaterGal} unit="gal"    color={color} alpha={alpha} />
        <BarRow label="shade"     value={metrics.shadeSqft}            refMax={BAR_MAX.shadeSqft}           unit="ft²"    color={color} alpha={alpha} />
      </div>
      {assumptions?.[0] && (
        <small className="eco-assumption">{assumptions[0]}</small>
      )}
    </div>
  );
}

/**
 * Shared marker info panel — renders identically in pointcloud Html balloon,
 * City3D Html balloon, and the 2D map popup overlay.
 *
 * @param {object}   marker    Normalized marker from the store
 * @param {function} onClose   Called when the × button is pressed (optional)
 * @param {string}   className Extra class forwarded to the root balloon div
 */
export function MarkerInfo({ marker, onClose, className = '' }) {
  const openCapture = useGroveStore((s) => s.openCapture);
  const markerId    = marker?.marker_code ?? marker?.id;
  const benefits    = useMemo(() => computeBenefits(marker), [marker]);

  if (!marker) return null;

  return (
    <div
      className={`marker-balloon${className ? ` ${className}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
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

      {/* ID + data-status badge */}
      <div className="marker-balloon-id-row">
        <strong>{markerId}</strong>
        {marker.data_status && (
          <span className={`marker-status-badge ${STATUS_CLASS[marker.data_status] ?? ''}`}>
            {marker.data_status}
          </span>
        )}
      </div>

      {/* Common name */}
      <span>{marker.commonName ?? marker.common_name ?? 'Tree marker'}</span>

      {/* Species + AI confidence */}
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

      {/* Per-tree eco service charts */}
      <EcoChart benefits={benefits} />

      {/* Characterize CTA */}
      <div className="marker-balloon-section">
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
