import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { DoubleSide, Plane, Vector2, Vector3 } from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { PointCloud } from './PointCloud.jsx';
import { TreeMarker } from './TreeMarker.jsx';
import { PLACEMENT_Y } from '../lib/markerHelpers.js';

const CAMERA_FAR = 10000000;
const ORBIT_MIN_DISTANCE = 2;
const ORBIT_MAX_DISTANCE = 10000000;
const PLACEMENT_PLANE_SIZE = 100000;
const PLACEMENT_PLANE = new Plane(new Vector3(0, 1, 0), -PLACEMENT_Y);
const MOBILE_PLACEMENT_TAP_DISTANCE = 8;
const MOBILE_PLACEMENT_TAP_DURATION = 400;

export function Scene({
  controlsRef,
  draggingId,
  hoveredMarkerId,
  isCoarsePointer,
  isNavigatingRef,
  navigationEndTimeoutRef,
  markers,
  onPointCloudLoaded,
  onCanvasPlacement,
  onClearSelection,
  onDragEnd,
  onDragMove,
  onDragStart,
  onHoverChange,
  onSelectMarker,
  pointerRef,
  placementMode,
  selectedMarker,
  suppressPlacementRef,
  planViewRequest,
}) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const { camera, gl, raycaster } = useThree();
  const placementTapRef = useRef(null);
  const dragPointRef = useRef(new Vector3());
  const pointerNdcRef = useRef(new Vector2());
  const markerPlaneRef = useRef(PLACEMENT_PLANE);

  const radius = useMemo(() => {
    const geo = sourceGeometry.clone();
    geo.computeBoundingSphere();
    return geo.boundingSphere?.radius || 10;
  }, [sourceGeometry]);

  useLayoutEffect(() => {
    camera.position.set(radius * 0.8, radius * 0.3, radius * 1.8);
    camera.near = 0.1;
    camera.far = CAMERA_FAR;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, radius]);

  useEffect(() => {
    if (!planViewRequest || !controlsRef.current) return;
    camera.near = 0.1;
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
    camera.position.set(...planViewRequest.position);
    camera.lookAt(0, 0, 0);
    controlsRef.current.minDistance = ORBIT_MIN_DISTANCE;
    controlsRef.current.maxDistance = ORBIT_MAX_DISTANCE;
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [camera, controlsRef, planViewRequest]);

  useEffect(() => {
    const element = gl.domElement;
    const preventWheel = (e) => e.preventDefault();
    const preventContext = (e) => e.preventDefault();
    element.addEventListener('wheel', preventWheel, { passive: false });
    element.addEventListener('contextmenu', preventContext);
    return () => {
      element.removeEventListener('wheel', preventWheel);
      element.removeEventListener('contextmenu', preventContext);
    };
  }, [gl]);

  useEffect(() => {
    const element = gl.domElement;

    const handlePointerDown = (event) => {
      if (!placementMode || draggingId || suppressPlacementRef.current) return;
      if (event.button !== undefined && event.button !== 0) return;
      placementTapRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
        moved: false,
      };
    };

    const handlePointerMove = (event) => {
      const tap = placementTapRef.current;
      if (!tap || tap.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > MOBILE_PLACEMENT_TAP_DISTANCE) {
        tap.moved = true;
      }
    };

    const handlePointerUp = (event) => {
      const tap = placementTapRef.current;
      if (!tap || tap.pointerId !== event.pointerId) return;
      placementTapRef.current = null;
      if (!placementMode || draggingId || suppressPlacementRef.current || tap.moved) return;
      const duration = performance.now() - tap.time;
      const distance = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);
      if (distance > MOBILE_PLACEMENT_TAP_DISTANCE || duration > MOBILE_PLACEMENT_TAP_DURATION) return;

      const rect = element.getBoundingClientRect();
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const hitPoint = new Vector3();
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(PLACEMENT_PLANE, hitPoint)) return;
      onCanvasPlacement([hitPoint.x, PLACEMENT_Y, hitPoint.z]);
    };

    const handlePointerCancel = (event) => {
      if (placementTapRef.current?.pointerId === event.pointerId) {
        placementTapRef.current = null;
      }
    };

    element.addEventListener('pointerdown', handlePointerDown);
    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerup', handlePointerUp);
    element.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      element.removeEventListener('pointerdown', handlePointerDown);
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerup', handlePointerUp);
      element.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [camera, draggingId, gl, onCanvasPlacement, placementMode, raycaster, suppressPlacementRef]);

  // Drag move — raycasting done here; result forwarded to onDragMove(x, z, markerId).
  // Guard against non-drag calls only by placementMode; the App's draggingIdRef handles
  // the per-marker guard synchronously (avoids a one-frame lag from state).
  const handleDragMove = (event, markerId) => {
    if (!placementMode) return;
    const { camera: cam, gl: renderer, raycaster: rc } = event;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdcRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdcRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    rc.setFromCamera(pointerNdcRef.current, cam);
    if (!rc.ray.intersectPlane(markerPlaneRef.current, dragPointRef.current)) return;
    onDragMove(dragPointRef.current.x, dragPointRef.current.z, markerId);
  };

  useFrame(() => {
    if (controlsRef.current) {
      if (
        controlsRef.current.minDistance !== ORBIT_MIN_DISTANCE ||
        controlsRef.current.maxDistance !== ORBIT_MAX_DISTANCE
      ) {
        controlsRef.current.minDistance = ORBIT_MIN_DISTANCE;
        controlsRef.current.maxDistance = ORBIT_MAX_DISTANCE;
      }
    }
  });

  return (
    <>
      <PointCloud
        isCoarsePointer={isCoarsePointer}
        isNavigatingRef={isNavigatingRef}
        onLoaded={onPointCloudLoaded}
        placementMode={placementMode}
        pointerRef={pointerRef}
      />

      <mesh
        position={[0, PLACEMENT_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
        raycast={() => null}
      >
        <planeGeometry args={[PLACEMENT_PLANE_SIZE, PLACEMENT_PLANE_SIZE]} />
        <meshBasicMaterial
          color="#7CFF6B"
          transparent
          opacity={0}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {markers.map((marker) => {
        const markerId = marker?.marker_code || marker?.id;
        const selectedId = selectedMarker?.marker_code || selectedMarker?.id;
        return (
          <TreeMarker
            hovered={hoveredMarkerId === markerId}
            isCoarsePointer={isCoarsePointer}
            key={markerId}
            marker={marker}
            placementMode={placementMode}
            selected={selectedId === markerId}
            onClearSelection={onClearSelection}
            onDragEnd={onDragEnd}
            onDragMove={handleDragMove}
            onDragStart={onDragStart}
            onHoverChange={onHoverChange}
            onSelect={onSelectMarker}
          />
        );
      })}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.28}
        enablePan
        enableRotate
        enableZoom
        enabled={!draggingId}
        onStart={() => {
          if (navigationEndTimeoutRef.current) {
            window.clearTimeout(navigationEndTimeoutRef.current);
            navigationEndTimeoutRef.current = null;
          }
          isNavigatingRef.current = true;
        }}
        onEnd={() => {
          if (navigationEndTimeoutRef.current) window.clearTimeout(navigationEndTimeoutRef.current);
          navigationEndTimeoutRef.current = window.setTimeout(() => {
            isNavigatingRef.current = false;
            navigationEndTimeoutRef.current = null;
          }, 80);
        }}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        panSpeed={0.55}
        rotateSpeed={0.28}
        screenSpacePanning
        target={[0, 0, 0]}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        minDistance={ORBIT_MIN_DISTANCE}
        maxDistance={ORBIT_MAX_DISTANCE}
        maxPolarAngle={Math.PI / 2.03}
        zoomSpeed={0.72}
      />
    </>
  );
}
