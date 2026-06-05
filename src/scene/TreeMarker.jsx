import React from 'react';
import { Html } from '@react-three/drei';
import { PLACEMENT_Y } from '../lib/markerHelpers.js';
import { formatVerified } from '../lib/markerHelpers.js';
import { useGroveStore } from '../store/useGroveStore.js';
import { TIER_LABELS, METRIC_LABELS } from '../lib/ecology.js';

const STATUS_CLASS = { verified: 'status-verified', partial: 'status-partial', sample: 'status-sample' };

function fmt(n, unit) {
  if (!n) return '—';
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k ${unit}`;
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

const DEBUG_MARKER_HITS = false;
const MARKER_HIT_RADIUS = 80;

export function TreeMarker({
  hovered,
  isCoarsePointer,
  marker,
  placementMode,
  selected,
  onClearSelection,
  onDragEnd,
  onDragMove,
  onDragStart,
  onHoverChange,
  onSelect,
}) {
  const openCapture = useGroveStore((s) => s.openCapture);
  const x = Number(marker?.x);
  const z = Number(marker?.z);
  const markerId = marker?.marker_code || marker?.id;

  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;

  const canHover = !isCoarsePointer && !placementMode && hovered;

  const handlePointerDown = (event) => {
    event.stopPropagation();
    event.target.setPointerCapture(event.pointerId);
    onSelect(marker);
    if (placementMode) onDragStart(markerId);
  };

  const handlePointerMove = (event) => {
    if (!placementMode || !event.buttons) return;
    event.stopPropagation();
    onDragMove(event, markerId);
  };

  const handlePointerUp = (event) => {
    event.stopPropagation();
    if (event.target.hasPointerCapture?.(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId);
    }
    onDragEnd();
  };

  const handlePointerOver = (event) => {
    event.stopPropagation();
    onHoverChange?.(markerId);
    document.body.style.cursor = placementMode ? 'grab' : 'pointer';
  };

  const handlePointerOut = (event) => {
    event.stopPropagation();
    onHoverChange?.(null);
    document.body.style.cursor = '';
  };

  return (
    <group frustumCulled={false} position={[x, PLACEMENT_Y, z]} renderOrder={9999}>
      <mesh
        name={`marker-hit-${markerId}`}
        frustumCulled={false}
        renderOrder={9999}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => { e.stopPropagation(); onSelect(marker); }}
      >
        <sphereGeometry args={[MARKER_HIT_RADIUS, 24, 24]} />
        <meshBasicMaterial
          transparent
          opacity={DEBUG_MARKER_HITS ? 0.22 : 0.001}
          color="#ff00ff"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <Html
        center
        occlude={false}
        transform={false}
        pointerEvents={placementMode ? 'none' : 'auto'}
        zIndexRange={[1000, 0]}
      >
        <button
          type="button"
          className="marker-tree-button"
          onMouseEnter={(e) => { e.stopPropagation(); onHoverChange?.(markerId); document.body.style.cursor = 'pointer'; }}
          onMouseLeave={(e) => { e.stopPropagation(); onHoverChange?.(null); document.body.style.cursor = ''; }}
          onClick={(e) => { e.stopPropagation(); onSelect(marker); }}
        >
          <div
            className={[
              'marker-tree-mask',
              canHover ? 'is-hovered' : '',
              selected ? 'is-selected' : '',
              placementMode ? 'is-placement' : '',
            ].join(' ')}
          />
        </button>
      </Html>

      {selected ? (
        <Html
          center={false}
          occlude={false}
          transform={false}
          pointerEvents="auto"
          zIndexRange={[2000, 0]}
        >
          <div
            className="marker-balloon"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="marker-balloon-close"
              onClick={(e) => { e.stopPropagation(); onClearSelection(); }}
            >
              x
            </button>

            {/* Header row: ID + data_status badge */}
            <div className="marker-balloon-id-row">
              <strong>{markerId}</strong>
              {marker.data_status && (
                <span className={`marker-status-badge ${STATUS_CLASS[marker.data_status] ?? ''}`}>
                  {marker.data_status}
                </span>
              )}
            </div>

            <span>{marker.commonName || marker.common_name || 'Tree marker'}</span>
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

            <div className="marker-balloon-section">
              <small>Condition: {marker.condition || 'Unsurveyed'}</small>
              <small>Status: {formatVerified(marker.verified)}</small>
            </div>

            {/* Structural fields (when characterized) */}
            {marker.dbh_in != null && (
              <div className="marker-balloon-section">
                <small className="marker-balloon-label">structure</small>
                <small>DBH: {marker.dbh_in}&Prime;</small>
                {marker.height_ft != null && <small>Height ~{marker.height_ft} ft</small>}
                {marker.crown_spread_ft != null && <small>Crown ~{marker.crown_spread_ft} ft spread</small>}
                {marker.structure_source && marker.structure_source !== 'manual' && (
                  <small className="marker-source-note">{marker.structure_source}</small>
                )}
              </div>
            )}

            {/* Ecological benefits with confidence badge */}
            <div className="marker-balloon-section">
              <div className="marker-eco-header">
                <small className="marker-balloon-label">eco services ~</small>
                {marker.benefits_tier && (
                  <span className={`marker-eco-badge tier-${marker.benefits_tier}`}>
                    {TIER_LABELS[marker.benefits_tier]}
                  </span>
                )}
              </div>
              <div className="marker-eco-grid">
                <div><span className="eco-val">{fmt(marker.carbonStoredLb, 'lb')}</span><span className="eco-lbl">C stored</span></div>
                <div><span className="eco-val">{fmt(marker.annualCarbonLb, 'lb/yr')}</span><span className="eco-lbl">C/yr</span></div>
                <div><span className="eco-val">{fmt(marker.annualStormwaterGal, 'gal')}</span><span className="eco-lbl">H₂O/yr</span></div>
                <div><span className="eco-val">{fmt(marker.shadeSqft, 'ft²')}</span><span className="eco-lbl">shade</span></div>
              </div>
              {marker.benefits_assumptions && (
                <small className="eco-assumption">{marker.benefits_assumptions[0]}</small>
              )}
            </div>

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
        </Html>
      ) : null}
    </group>
  );
}
