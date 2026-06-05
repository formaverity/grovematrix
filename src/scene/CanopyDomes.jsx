import React, { useMemo } from 'react';
import * as THREE from 'three';
import { computeBenefits } from '../lib/ecology.js';
import { lngLatToEnuCoords } from '../lib/geoTransform.js';

// Translucent canopy domes for the 3D city service-field layer.
// One dome per characterized tree, colored by the selected metric, opacity by confidence.

const LOW_COLOR  = new THREE.Color('#2d5a40');   // muted forest green
const HIGH_COLOR = new THREE.Color('#7cffb2');   // mycelium-glow

// Half-sphere geometry (reused across all domes)
const DOME_GEO = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);

function DomeMesh({ position, radiusM, heightM, valueNorm, confidence }) {
  const mat = useMemo(() => {
    const col = LOW_COLOR.clone().lerp(HIGH_COLOR, valueNorm);
    return new THREE.MeshStandardMaterial({
      color: col,
      emissive: col,
      emissiveIntensity: 0.2 * valueNorm,
      transparent: true,
      opacity: confidence * 0.55,
      side: THREE.FrontSide,
      depthWrite: false,
    });
  }, [valueNorm, confidence]);

  const scale = useMemo(() => [radiusM, heightM * 0.65, radiusM], [radiusM, heightM]);

  return (
    <mesh
      geometry={DOME_GEO}
      material={mat}
      position={position}
      scale={scale}
    />
  );
}

export function CanopyDomes({ markers, anchor, metric, visible }) {
  // Normalize metric values across the set for color mapping
  const { domeData, minVal, maxVal } = useMemo(() => {
    const withGeo = markers.filter((m) => m.lng != null && m.lat != null);
    if (!withGeo.length) return { domeData: [], minVal: 0, maxVal: 1 };

    const computed = withGeo.map((m) => {
      const b = computeBenefits(m);
      return { m, b, val: b.metrics[metric] ?? 0 };
    });

    const vals = computed.map((d) => d.val);
    const mn   = Math.min(...vals);
    const mx   = Math.max(...vals);

    return {
      domeData: computed,
      minVal: mn,
      maxVal: mx || 1,
    };
  }, [markers, metric]);

  if (!visible) return null;

  return (
    <>
      {domeData.map(({ m, b, val }) => {
        const { x, z }  = lngLatToEnuCoords(m.lng, m.lat, anchor);
        const crownR     = ((m.crown_spread_ft ?? (m.canopyRadiusFt ?? 14) * 2) / 2) * 0.3048; // ft → m
        const crownBase  = (m.crown_base_height_ft ?? (m.height_ft ?? 20) * 0.28) * 0.3048;
        const crownHalf  = ((m.height_ft ?? 25) - (m.crown_base_height_ft ?? (m.height_ft ?? 25) * 0.28)) * 0.3048 / 2;
        const domeY      = crownBase + crownHalf;
        const valueNorm  = maxVal > minVal ? (val - minVal) / (maxVal - minVal) : 0.5;

        return (
          <DomeMesh
            key={m.id}
            position={[x, domeY, z]}
            radiusM={Math.max(0.5, crownR)}
            heightM={Math.max(0.5, crownR)}
            valueNorm={valueNorm}
            confidence={b.confidenceWeight}
          />
        );
      })}
    </>
  );
}
