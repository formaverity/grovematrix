import React, {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { DoubleSide, Plane, Vector2, Vector3 } from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { createClient } from '@supabase/supabase-js';

const DEBUG_INTERACTIONS = false;
const DEBUG_MARKER_HITS = false;
const POINT_SIZE_BASE = 1.8;
const POINT_SIZE_HOVER = 3.8;
const POINT_SIZE_MOVING = 1.25;
const POINT_SIZE_LERP = 0.18;
const POINT_SIZE_ATTENUATION = false;
const PLACEMENT_Y = 10;
const PLACEMENT_PLANE_SIZE = 100000;
const MARKER_HIT_RADIUS = 80;
const MOBILE_PLACEMENT_TAP_DISTANCE = 8;
const MOBILE_PLACEMENT_TAP_DURATION = 400;
const CAMERA_FAR = 10000000;
const ORBIT_MIN_DISTANCE = 2;
const ORBIT_MAX_DISTANCE = 10000000;
const PLAN_VIEW_POSITION = [0, 12000, 0.01];
const PLACEMENT_PLANE = new Plane(new Vector3(0, 1, 0), -PLACEMENT_Y);
const DEFAULT_MARKER_FIELDS = {
  commonName: 'Unknown',
  species: 'Unknown',
  canopyRadiusFt: 14,
  condition: 'Unsurveyed',
  verified: false,
  notes: '',
  annualStormwaterGal: 0,
  annualCarbonLb: 0,
  carbonStoredLb: 0,
  coolingScore: 0,
  shadeSqft: 0,
};

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// Initialize Supabase client
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

class PointCloudErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    this.props.onError?.(error);
  }

  render() {
    if (this.state.error) {
      return null;
    }

    return this.props.children;
  }
}

function formatMarkerId(index) {
  return `T-${String(index).padStart(3, '0')}`;
}

function createMarker(index, position) {
  const [x, , z] = position;
  return {
    id: formatMarkerId(index),
    x,
    y: PLACEMENT_Y,
    z,
    position: [x, PLACEMENT_Y, z],
    ...DEFAULT_MARKER_FIELDS,
  };
}

function getMarkerSequence(id) {
  const match = /^T-(\d+)$/.exec(id ?? '');
  return match ? Number(match[1]) : 0;
}

function normalizeMarker(marker) {
  const x = Number(marker?.x ?? marker?.position?.[0]);
  const z = Number(marker?.z ?? marker?.position?.[2]);

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    console.warn('Skipping marker with invalid coordinates:', marker);
    return null;
  }

  return {
    ...DEFAULT_MARKER_FIELDS,
    ...marker,
    id: marker?.id ?? formatMarkerId(0),
    x,
    y: PLACEMENT_Y,
    z,
    position: [x, PLACEMENT_Y, z],
  };
}

// Helper functions for formatting
function formatNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num.toString() : 'pending calibration';
}

function formatBenefit(value, suffix) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? `${num} ${suffix}` : 'pending calibration';
}

function formatVerified(verified) {
  return verified === true ? 'field verified' : 'sample / unverified';
}

// Estimate benefits for placeholder analytics
function estimateBenefits(marker) {
  const radius = Number(marker.canopyRadiusFt ?? marker.canopy_radius_ft ?? 14);
  const shadeSqft = Math.round(Math.PI * radius * radius);
  const annualStormwaterGal = Math.round(shadeSqft * 1.25);
  const annualCarbonLb = Math.round(radius * 2.8);
  const carbonStoredLb = Math.round(radius * radius * 1.7);
  const coolingScore = Math.min(100, Math.round(35 + radius * 2.4));

  return {
    shadeSqft,
    annualStormwaterGal,
    annualCarbonLb,
    carbonStoredLb,
    coolingScore
  };
}

// Normalize Supabase row to marker format
function normalizeSupabaseMarker(row) {
  const x = Number(row.x);
  const z = Number(row.z);

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    console.warn('Skipping Supabase marker with invalid coordinates:', row);
    return null;
  }

  const marker = {
    id: row.marker_code,
    marker_code: row.marker_code,
    x,
    y: Number(row.y ?? PLACEMENT_Y),
    z,
    position: [x, Number(row.y ?? PLACEMENT_Y), z],
    commonName: row.common_name ?? "Unknown",
    common_name: row.common_name ?? "Unknown",
    species: row.species ?? "Unknown",
    condition: row.condition ?? "Unsurveyed",
    canopyRadiusFt: Number(row.canopy_radius_ft ?? 14),
    canopy_radius_ft: Number(row.canopy_radius_ft ?? 14),
    verified: Boolean(row.verified),
    notes: row.notes ?? "",
    annualStormwaterGal: Number(row.annual_stormwater_gal ?? 0),
    annualCarbonLb: Number(row.annual_carbon_lb ?? 0),
    carbonStoredLb: Number(row.carbon_stored_lb ?? 0),
    coolingScore: Number(row.cooling_score ?? 0),
    shadeSqft: Number(row.shade_sqft ?? 0)
  };

  // If analytics values are missing, estimate them
  if (!marker.shadeSqft || !marker.annualStormwaterGal || !marker.annualCarbonLb || !marker.carbonStoredLb || !marker.coolingScore) {
    const estimates = estimateBenefits(marker);
    marker.shadeSqft = marker.shadeSqft || estimates.shadeSqft;
    marker.annualStormwaterGal = marker.annualStormwaterGal || estimates.annualStormwaterGal;
    marker.annualCarbonLb = marker.annualCarbonLb || estimates.annualCarbonLb;
    marker.carbonStoredLb = marker.carbonStoredLb || estimates.carbonStoredLb;
    marker.coolingScore = marker.coolingScore || estimates.coolingScore;
  }

  return marker;
}

function serializeMarkers(markers) {
  return markers.map((marker) => ({
    id: marker.id,
    x: Number(marker.position[0].toFixed(3)),
    y: Number(marker.position[1].toFixed(3)),
    z: Number(marker.position[2].toFixed(3)),
    commonName: marker.commonName,
    species: marker.species,
    canopyRadiusFt: marker.canopyRadiusFt,
    condition: marker.condition,
  }));
}

function PointCloud({
  isCoarsePointer,
  isNavigatingRef,
  onLoaded,
  placementMode,
  pointerRef,
}) {
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
    if (!materialRef.current) {
      return;
    }

    const pointerActive =
      pointerRef?.current?.active === true;

    let target = POINT_SIZE_BASE;

    if (!isCoarsePointer && !placementMode && pointerActive) {
      target = POINT_SIZE_HOVER;
    }

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

function MarkerList({ markers, selectedMarkerId, onDeleteMarker, onSelectMarker }) {
  return (
    <div className="marker-list">
      {markers.length ? (
        markers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            className={marker.id === selectedMarkerId ? 'marker-row is-selected' : 'marker-row'}
            onClick={() => onSelectMarker(marker)}
          >
            <span className="marker-row-main">
              <span className="marker-dot" />
              <span>{marker.id}</span>
            </span>
            <span
              className="marker-delete"
              role="button"
              tabIndex={0}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteMarker(marker.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onDeleteMarker(marker.id);
                }
              }}
            >
              x
            </span>
          </button>
        ))
      ) : (
        <p className="marker-list-empty">No markers placed yet.</p>
      )}
    </div>
  );
}

function ControlPanel({
  debugPointerActive,
  drawerOpen,
  menuOpen,
  markerCount,
  markers,
  placementMode,
  selectedMarker,
  onCopyJson,
  onDeleteSelected,
  onDeleteMarker,
  onDownloadJson,
  onPanelHoverChange,
  onSelectMarker,
  onToggleDrawer,
  onToggleMenu,
  onTogglePlacement,
  onTopView,
}) {
  const logoRef = useRef(null);

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!logoRef.current) return;
      
      const rect = logoRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      const deltaX = (event.clientX - centerX) / window.innerWidth;
      const deltaY = (event.clientY - centerY) / window.innerHeight;
      
      const moveX = deltaX * 8; // subtle movement
      const moveY = deltaY * 8;
      
      logoRef.current.style.transform = `translate(${moveX}px, ${moveY}px)`;
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return (
    <div className="hud">
      <div
        ref={logoRef}
        className={`gm-logo ${menuOpen ? "is-open" : ""}`}
        onClick={onToggleMenu}
        role="button"
        aria-label="Toggle menu"
      ></div>
      <div
        className={menuOpen ? 'overlay is-open' : 'overlay'}
        onPointerEnter={() => onPanelHoverChange(true)}
        onPointerLeave={() => onPanelHoverChange(false)}
        onFocusCapture={() => onPanelHoverChange(true)}
        onBlurCapture={() => onPanelHoverChange(false)}
      >
        {menuOpen ? (
          <div className="menu-panel">
            {placementMode ? (
              <p className="instruction-line">Tap to place. Drag markers to adjust.</p>
            ) : null}
            {DEBUG_INTERACTIONS ? (
              <p className="debug-line">Point hover: {debugPointerActive ? 'active' : 'inactive'}</p>
            ) : null}

            <div className="control-row">
              <button
                type="button"
                className={placementMode ? 'is-active' : ''}
                onClick={onTogglePlacement}
              >
                Placement {placementMode ? 'On' : 'Off'}
              </button>
              <button type="button" onClick={onTopView}>
                Plan View
              </button>
              <button type="button" onClick={onCopyJson} disabled={!markerCount}>
                Copy JSON
              </button>
              <button type="button" onClick={onDownloadJson} disabled={!markerCount}>
                Download JSON
              </button>
              <button type="button" onClick={onDeleteSelected} disabled={!selectedMarker}>
                Delete Selected
              </button>
            </div>

            <details className="selection-card">
              <summary>
                <span>Selected</span>
                <strong>{selectedMarker ? selectedMarker.id : 'None'}</strong>
              </summary>
              <p>{selectedMarker ? 'Details in scene balloon' : 'No marker selected'}</p>
            </details>

            <div className={drawerOpen ? 'list-card is-open' : 'list-card'}>
              <button type="button" className="drawer-toggle" onClick={onToggleDrawer}>
                Markers ({markerCount})
              </button>
              {drawerOpen ? (
                <MarkerList
                  markers={markers}
                  selectedMarkerId={selectedMarker?.id ?? null}
                  onDeleteMarker={onDeleteMarker}
                  onSelectMarker={onSelectMarker}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TreeMarker({
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

  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }

  const canHover = !isCoarsePointer && !placementMode && hovered;

  const handlePointerDown = (event) => {
    event.stopPropagation();
    event.target.setPointerCapture(event.pointerId);
    onSelect(marker);

    if (placementMode) {
      onDragStart(markerId);
    }
  };

  const handlePointerMove = (event) => {
    if (!placementMode || !event.buttons) {
      return;
    }

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
    onHoverChange(markerId);
    document.body.style.cursor = placementMode ? 'grab' : 'pointer';
    if (DEBUG_INTERACTIONS) {
      console.log('marker over', markerId);
    }
  };

  const handlePointerOut = (event) => {
    event.stopPropagation();
    onHoverChange(null);
    document.body.style.cursor = '';
    if (DEBUG_INTERACTIONS) {
      console.log('marker out', markerId);
    }
  };

  const handleClick = (event) => {
    event.stopPropagation();
    onSelect(marker);
    if (DEBUG_INTERACTIONS) {
      console.log('marker click', markerId);
    }
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
        onClick={handleClick}
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
          onMouseEnter={(event) => {
            event.stopPropagation();
            onHoverChange(markerId);
            document.body.style.cursor = 'pointer';
          }}
          onMouseLeave={(event) => {
            event.stopPropagation();
            onHoverChange(null);
            document.body.style.cursor = '';
          }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect(marker);
          }}
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
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="marker-balloon-close"
              onClick={(event) => {
                event.stopPropagation();
                onClearSelection();
              }}
            >
              x
            </button>
            <strong>{markerId}</strong>
            <span>{marker.commonName || marker.common_name || 'Tree marker'}</span>
            <small>{marker.species || 'species pending'}</small>
            <div className="marker-balloon-section">
              <small>Condition: {marker.condition || 'Unsurveyed'}</small>
              <small>Status: {formatVerified(marker.verified)}</small>
            </div>
            <div className="marker-balloon-section">
              <small className="marker-balloon-label">canopy work</small>
              <small>Shade: {formatBenefit(marker.shadeSqft, 'sq ft')}</small>
              <small>Stormwater: {formatBenefit(marker.annualStormwaterGal, 'gal / yr')}</small>
              <small>Carbon stored: {formatBenefit(marker.carbonStoredLb, 'lb')}</small>
              <small>Cooling: {formatBenefit(marker.coolingScore, '/ 100')}</small>
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

function LoadingOverlay({ error, ready }) {
  return (
    <div className={ready ? 'loading-overlay is-hidden' : 'loading-overlay'}>
      <div className="loading-panel">
        <p className="loading-subtitle">loading grovematrix</p>
        <div className="loading-logo"></div>
        {error ? (
          <p className="loading-error">Point cloud failed to initialize. Check the model asset and refresh.</p>
        ) : (
          <>
            <div className="loading-glyph" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <p className="loading-status">point cloud initializing</p>
          </>
        )}
      </div>
    </div>
  );
}

function Scene({
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
  onMarkerHover,
  onSelectMarker,
  pointerRef,
  placementMode,
  selectedMarker,
  suppressPlacementRef,
  planViewRequest,
  onHoverChange,
}) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const { camera, gl, raycaster } = useThree();
  const placementTapRef = useRef(null);

  const radius = useMemo(() => {
    const geometry = sourceGeometry.clone();
    geometry.computeBoundingSphere();
    return geometry.boundingSphere?.radius || 10;
  }, [sourceGeometry]);

  useLayoutEffect(() => {
    camera.position.set(radius * 0.8, radius * 0.3, radius * 1.8);
    camera.near = 0.1;
    camera.far = CAMERA_FAR;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, radius]);

  useEffect(() => {
    if (!planViewRequest || !controlsRef.current) {
      return;
    }

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

    const preventCanvasWheel = (event) => {
      event.preventDefault();
    };
    const preventContextMenu = (event) => {
      event.preventDefault();
    };

    element.addEventListener('wheel', preventCanvasWheel, { passive: false });
    element.addEventListener('contextmenu', preventContextMenu);

    return () => {
      element.removeEventListener('wheel', preventCanvasWheel);
      element.removeEventListener('contextmenu', preventContextMenu);
    };
  }, [gl]);

  useEffect(() => {
    const element = gl.domElement;

    const handlePointerDown = (event) => {
      if (!placementMode || draggingId || suppressPlacementRef.current) {
        return;
      }

      if (event.button !== undefined && event.button !== 0) {
        return;
      }

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

      if (!tap || tap.pointerId !== event.pointerId) {
        return;
      }

      const distance = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);

      if (distance > MOBILE_PLACEMENT_TAP_DISTANCE) {
        tap.moved = true;
      }
    };

    const handlePointerUp = (event) => {
      const tap = placementTapRef.current;

      if (!tap || tap.pointerId !== event.pointerId) {
        return;
      }

      placementTapRef.current = null;

      if (!placementMode || draggingId || suppressPlacementRef.current || tap.moved) {
        return;
      }

      const duration = performance.now() - tap.time;
      const distance = Math.hypot(event.clientX - tap.x, event.clientY - tap.y);

      if (distance > MOBILE_PLACEMENT_TAP_DISTANCE || duration > MOBILE_PLACEMENT_TAP_DURATION) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const hitPoint = new Vector3();

      raycaster.setFromCamera(pointer, camera);

      if (!raycaster.ray.intersectPlane(PLACEMENT_PLANE, hitPoint)) {
        return;
      }

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
            onDragMove={onDragMove}
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
          if (navigationEndTimeoutRef.current) {
            window.clearTimeout(navigationEndTimeoutRef.current);
          }
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
        touches={{
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
        minDistance={ORBIT_MIN_DISTANCE}
        maxDistance={ORBIT_MAX_DISTANCE}
        maxPolarAngle={Math.PI / 2.03}
        zoomSpeed={0.72}
      />
    </>
  );
}

export default function App() {
  const [debugPointerActive, setDebugPointerActive] = useState(false);
  const [hoveredMarkerId, setHoveredMarkerId] = useState(null);
  const [markers, setMarkers] = useState([]);
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false);
  const [pointCloudError, setPointCloudError] = useState(null);
  const [minIntroElapsed, setMinIntroElapsed] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [planViewRequest, setPlanViewRequest] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uiHover, setUiHover] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const controlsRef = useRef(null);
  const isNavigatingRef = useRef(false);
  const navigationEndTimeoutRef = useRef(null);
  const markerCountRef = useRef(1);
  const draggingIdRef = useRef(null);
  const suppressPlaneClickRef = useRef(false);
  const dragPointRef = useRef(new Vector3());
  const pointerNdcRef = useRef(new Vector2());
  const pointerRef = useRef({ x: 0, y: 0, clientX: 0, clientY: 0, active: false });
  const markerPlaneRef = useRef(PLACEMENT_PLANE);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMinIntroElapsed(true);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (navigationEndTimeoutRef.current) {
        window.clearTimeout(navigationEndTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setIsCoarsePointer(query.matches || window.innerWidth < 768);

    update();
    query.addEventListener?.('change', update);
    window.addEventListener('resize', update);

    return () => {
      query.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadMarkers = async () => {
      try {
        // Try Supabase first
        console.log('Loading markers from Supabase...');
        const { data, error } = await supabase
          .from("tree_markers")
          .select("*")
          .order("marker_code", { ascending: true });

        if (error) {
          console.warn('Supabase query failed:', error.message);
          throw error;
        }

        if (data && data.length > 0) {
          console.log(`Loaded ${data.length} markers from Supabase`);
          const nextMarkers = data.map(normalizeSupabaseMarker).filter(Boolean);
          const highestId = nextMarkers.reduce(
            (max, marker) => Math.max(max, getMarkerSequence(marker.id)),
            0,
          );

          if (!active) return;

          markerCountRef.current = highestId + 1;
          setMarkers(nextMarkers);
          return;
        }

        // Fallback to JSON if Supabase is empty or fails
        console.log('No markers in Supabase, falling back to JSON...');
        const response = await fetch('/data/tree-markers.json');

        if (!response.ok) {
          throw new Error(`Marker file request failed with ${response.status}`);
        }

        const json = await response.json();
        const nextMarkers = Array.isArray(json)
          ? json.map(normalizeMarker).filter(Boolean)
          : [];
        const highestId = nextMarkers.reduce(
          (max, marker) => Math.max(max, getMarkerSequence(marker.id)),
          0,
        );

        if (!active) return;

        markerCountRef.current = highestId + 1;
        setMarkers(nextMarkers);
      } catch (error) {
        if (!active) return;

        console.warn('Unable to load markers from Supabase or JSON:', error);
        markerCountRef.current = 1;
        setMarkers([]);
      }
    };

    loadMarkers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSelectedMarker(null);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMarker) {
        event.preventDefault();
        setMarkers((current) =>
          current.filter((marker) => marker.id !== selectedMarker.id),
        );
        setSelectedMarker(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMarker]);

  const handlePlaceMarker = (position) => {
    if (suppressPlaneClickRef.current) {
      suppressPlaneClickRef.current = false;
      return;
    }

    const marker = createMarker(markerCountRef.current, position);
    markerCountRef.current += 1;
    setMarkers((current) => [...current, marker]);
    setSelectedMarker(marker);
  };

  const handleSelectMarker = (marker) => {
    setSelectedMarker(marker);
  };

  const handleMarkerHover = (markerId) => {
    setHoveredMarkerId(markerId);
  };

  const handleClearSelection = () => {
    setSelectedMarker(null);
  };

  const handleDeleteMarker = (markerId) => {
    setMarkers((current) => current.filter((marker) => marker.id !== markerId));
    setSelectedMarker((current) => (current?.id === markerId ? null : current));

    if (draggingIdRef.current === markerId) {
      draggingIdRef.current = null;
      setDraggingId(null);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedMarker) {
      handleDeleteMarker(selectedMarker.id);
    }
  };

  const handlePointerEnter = (event) => {
    pointerRef.current.x = event.nativeEvent.offsetX ?? pointerRef.current.x;
    pointerRef.current.y = event.nativeEvent.offsetY ?? pointerRef.current.y;
    pointerRef.current.clientX = event.clientX;
    pointerRef.current.clientY = event.clientY;
    pointerRef.current.active = true;
    setDebugPointerActive(true);
    if (DEBUG_INTERACTIONS) {
      console.log('pointer active', pointerRef.current.active);
    }
  };

  const handlePointerMove = (event) => {
    pointerRef.current.x = event.nativeEvent.offsetX ?? pointerRef.current.x;
    pointerRef.current.y = event.nativeEvent.offsetY ?? pointerRef.current.y;
    pointerRef.current.clientX = event.clientX;
    pointerRef.current.clientY = event.clientY;
    pointerRef.current.active = true;
  };

  const handlePointerLeave = () => {
    pointerRef.current.active = false;
    document.body.style.cursor = '';
    setDebugPointerActive(false);
    if (DEBUG_INTERACTIONS) {
      console.log('pointer active', pointerRef.current.active);
    }
    setHoveredMarkerId(null);
  };

  const handleTogglePlacement = () => {
    setPlacementMode((current) => !current);
    setHoveredMarkerId(null);
    draggingIdRef.current = null;
    suppressPlaneClickRef.current = false;
    setDraggingId(null);
  };

  const requestPlanView = (position) => {
    setPlanViewRequest({
      id: performance.now(),
      position,
    });
  };

  const handleTopView = () => {
    requestPlanView(PLAN_VIEW_POSITION);
  };

  const handleToggleDrawer = () => {
    setDrawerOpen((current) => !current);
  };

  const handleToggleMenu = () => {
    setMenuOpen((current) => !current);
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(serializeMarkers(markers), null, 2),
      );
    } catch (error) {
      console.error('Unable to copy marker JSON.', error);
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([JSON.stringify(serializeMarkers(markers), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tree-markers.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDragStart = (markerId) => {
    draggingIdRef.current = markerId;
    suppressPlaneClickRef.current = true;
    if (controlsRef.current) {
      controlsRef.current.enabled = false;
    }
    if (navigationEndTimeoutRef.current) {
      window.clearTimeout(navigationEndTimeoutRef.current);
      navigationEndTimeoutRef.current = null;
    }
    isNavigatingRef.current = false;
    setDraggingId(markerId);
  };

  const handleDragMove = (event, markerId) => {
    if (!placementMode || draggingIdRef.current !== markerId) {
      return;
    }

    const { camera, gl, raycaster } = event;
    const rect = gl.domElement.getBoundingClientRect();

    pointerNdcRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdcRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointerNdcRef.current, camera);

    if (!raycaster.ray.intersectPlane(markerPlaneRef.current, dragPointRef.current)) {
      return;
    }

    const nextPosition = [dragPointRef.current.x, PLACEMENT_Y, dragPointRef.current.z];

    setMarkers((current) =>
      current.map((marker) =>
        marker.id === markerId
          ? {
              ...marker,
              x: nextPosition[0],
              y: PLACEMENT_Y,
              z: nextPosition[2],
              position: nextPosition,
            }
          : marker,
      ),
    );

    setSelectedMarker((current) =>
      current?.id === markerId
        ? {
            ...current,
            x: nextPosition[0],
            y: PLACEMENT_Y,
            z: nextPosition[2],
            position: nextPosition,
          }
        : current,
    );
  };

  const handleDragEnd = () => {
    draggingIdRef.current = null;
    if (controlsRef.current) {
      controlsRef.current.enabled = true;
    }
    if (navigationEndTimeoutRef.current) {
      window.clearTimeout(navigationEndTimeoutRef.current);
      navigationEndTimeoutRef.current = null;
    }
    isNavigatingRef.current = false;
    setDraggingId(null);

    window.setTimeout(() => {
      suppressPlaneClickRef.current = false;
    }, 0);
  };

  const cursor =
    isCoarsePointer
      ? 'default'
      : draggingId
      ? 'grabbing'
      : placementMode
        ? 'crosshair'
        : hoveredMarkerId
          ? 'pointer'
          : 'default';

  const loadingReady = pointCloudLoaded && minIntroElapsed && !pointCloudError;
  return (
    <div
      className="app-shell app"
      style={{ cursor }}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <LoadingOverlay error={pointCloudError} ready={loadingReady} />
      <ControlPanel
        debugPointerActive={debugPointerActive}
        drawerOpen={drawerOpen}
        menuOpen={menuOpen}
        markerCount={markers.length}
        markers={markers}
        placementMode={placementMode}
        selectedMarker={selectedMarker}
        onCopyJson={handleCopyJson}
        onDeleteSelected={handleDeleteSelected}
        onDeleteMarker={handleDeleteMarker}
        onDownloadJson={handleDownloadJson}
        onPanelHoverChange={setUiHover}
        onSelectMarker={handleSelectMarker}
        onToggleDrawer={handleToggleDrawer}
        onToggleMenu={handleToggleMenu}
        onTogglePlacement={handleTogglePlacement}
        onTopView={handleTopView}
      />

      <Canvas
        camera={{ position: [0, 300, 0.01], fov: 55, near: 0.1, far: CAMERA_FAR }}
        dpr={[1, 1.25]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => {
          if (!placementMode) {
            setSelectedMarker(null);
          }
        }}
        onCreated={({ camera }) => {
          camera.near = 0.1;
          camera.far = CAMERA_FAR;
          camera.updateProjectionMatrix();
        }}
      >
        <color attach="background" args={['#0E1A14']} />
        <ambientLight intensity={0.75} />
        <PointCloudErrorBoundary onError={setPointCloudError}>
          <Suspense fallback={null}>
            <Scene
              controlsRef={controlsRef}
              draggingId={draggingId}
              hoveredMarkerId={hoveredMarkerId}
              isCoarsePointer={isCoarsePointer}
              isNavigatingRef={isNavigatingRef}
              navigationEndTimeoutRef={navigationEndTimeoutRef}
              markers={markers}
              onCanvasPlacement={handlePlaceMarker}
              onClearSelection={handleClearSelection}
              onDragEnd={handleDragEnd}
              onDragMove={handleDragMove}
              onDragStart={handleDragStart}
              onMarkerHover={handleMarkerHover}
              onPointCloudLoaded={() => setPointCloudLoaded(true)}
              onSelectMarker={handleSelectMarker}
              pointerRef={pointerRef}
              placementMode={placementMode}
              selectedMarker={selectedMarker}
              suppressPlacementRef={suppressPlaneClickRef}
              planViewRequest={planViewRequest}
            />
          </Suspense>
        </PointCloudErrorBoundary>
      </Canvas>
    </div>
  );
}
