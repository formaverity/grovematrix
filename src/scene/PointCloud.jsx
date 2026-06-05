import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const POINT_SIZE_BASE = 1.8;
const POINT_SIZE_HOVER = 3.8;
const POINT_SIZE_LERP = 0.18;
const POINT_SIZE_ATTENUATION = false;

export function PointCloud({ isCoarsePointer, onLoaded, placementMode, pointerRef }) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const materialRef = useRef(null);
  const pointsRef = useRef(null);

  const geometry = useMemo(() => {
    const next = sourceGeometry.clone();
    next.computeBoundingSphere();
    if (next.boundingSphere) {
      next.translate(
        -next.boundingSphere.center.x,
        -next.boundingSphere.center.y,
        -next.boundingSphere.center.z,
      );
    }
    next.computeBoundingSphere();
    next.computeBoundingBox();
    return next;
  }, [sourceGeometry]);

  useEffect(() => {
    onLoaded?.();
  }, [geometry, onLoaded]);

  useEffect(() => {
    if (pointsRef.current) {
      pointsRef.current.frustumCulled = false;
      pointsRef.current.raycast = () => null;
    }
  }, [geometry]);

  useFrame(() => {
    if (!materialRef.current) return;
    const pointerActive = pointerRef?.current?.active === true;
    const target =
      !isCoarsePointer && !placementMode && pointerActive ? POINT_SIZE_HOVER : POINT_SIZE_BASE;
    materialRef.current.size += (target - materialRef.current.size) * POINT_SIZE_LERP;
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false} raycast={() => null}>
      <pointsMaterial
        ref={materialRef}
        size={POINT_SIZE_BASE}
        vertexColors
        transparent
        opacity={1}
        depthWrite={false}
        depthTest
        sizeAttenuation={POINT_SIZE_ATTENUATION}
      />
    </points>
  );
}
