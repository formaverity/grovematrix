import React from 'react';
import { Html } from '@react-three/drei';
import { PLACEMENT_Y } from '../lib/markerHelpers.js';
import { MarkerInfo } from '../components/MarkerInfo/MarkerInfo.jsx';

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

      {selected && (
        <Html
          center={false}
          occlude={false}
          transform={false}
          pointerEvents="auto"
          zIndexRange={[2000, 0]}
        >
          <MarkerInfo marker={marker} onClose={onClearSelection} />
        </Html>
      )}
    </group>
  );
}
