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
import { DoubleSide, MathUtils, Plane, Vector2, Vector3 } from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const POINT_SIZE_BASE = 2.2;
const POINT_SIZE_HOVER = 3.4;
const POINT_SIZE_PLACEMENT = 2.4;
const POINT_SIZE_LERP = 0.08;
const POINT_OPACITY = 0.9;
const PLACEMENT_Y = 10;
const PLACEMENT_PLANE_SIZE = 100000;
const MARKER_RADIUS_BASE = 18;
const MARKER_RADIUS_SELECTED = 24;
const MARKER_RADIUS_HOVER = 28;
const MARKER_HOVER_RADIUS_PX = 48;
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
};

const safeNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

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

function PointCloud({ isCoarsePointer, onLoaded, placementMode, pointerActive }) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const materialRef = useRef(null);

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
    return next;
  }, [sourceGeometry]);

  useEffect(() => {
    onLoaded?.();
  }, [geometry, onLoaded]);

  useFrame(() => {
    if (!materialRef.current) {
      return;
    }

    // Future mobile optimization: ship a lighter PLY for small/touch devices.
    if (isCoarsePointer) {
      materialRef.current.size += (POINT_SIZE_BASE - materialRef.current.size) * POINT_SIZE_LERP;
      materialRef.current.opacity += (0.78 - materialRef.current.opacity) * POINT_SIZE_LERP;
      return;
    }

    const target = placementMode
      ? POINT_SIZE_PLACEMENT
      : pointerActive
        ? POINT_SIZE_HOVER
        : POINT_SIZE_BASE;

    materialRef.current.size += (target - materialRef.current.size) * POINT_SIZE_LERP;
  });

  return (
    <points geometry={geometry} raycast={() => null}>
      <pointsMaterial
        ref={materialRef}
        size={POINT_SIZE_BASE}
        vertexColors
        transparent
        opacity={isCoarsePointer ? 0.78 : POINT_OPACITY}
        depthWrite={false}
        sizeAttenuation={false}
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
  isCoarsePointer,
  drawerOpen,
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
  onTogglePlacement,
  onTopView,
}) {
  return (
    <div className="hud">
      <div
        className="overlay"
        onPointerEnter={() => onPanelHoverChange(true)}
        onPointerLeave={() => onPanelHoverChange(false)}
      >
        <h1>GROVEMATRIX</h1>
        <p className="panel-copy">canopy scan</p>
        <p className="instruction-line">
          {placementMode
            ? 'Tap to place. Drag nodes to adjust.'
            : isCoarsePointer
              ? 'Explore with one finger. Pinch or two-finger drag to zoom and pan.'
              : 'Orbit the canopy matrix. Select a node to inspect.'}
        </p>

        <div className="control-row">
          <button
            type="button"
            className={placementMode ? 'is-active' : ''}
            onClick={onTogglePlacement}
          >
            Placement Mode: {placementMode ? 'On' : 'Off'}
          </button>
          <button type="button" onClick={onTopView}>
            Plan
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

        <div className="meta-grid">
          <p>
            <span>Markers</span>
            <strong>{markerCount}</strong>
          </p>
          <p>
            <span>Mode</span>
            <strong>{placementMode ? 'Editing' : 'Observing'}</strong>
          </p>
        </div>

        <details className="selection-card" open={!isCoarsePointer}>
          <summary>
            <span>Selected Marker</span>
            <strong>{selectedMarker ? selectedMarker.id : 'None'}</strong>
          </summary>
          {selectedMarker ? (
            <div className="selection-card-body">
              <p>
                x {selectedMarker.position[0].toFixed(2)} | y {selectedMarker.position[1].toFixed(2)} | z{' '}
                {selectedMarker.position[2].toFixed(2)}
              </p>
              <p>Common Name: {selectedMarker.commonName}</p>
              <p>Species: {selectedMarker.species}</p>
              <p>Condition: {selectedMarker.condition}</p>
              <p className="placeholder-line">
                Environmental analytics pending calibration.
              </p>
            </div>
          ) : (
            <p>No marker selected</p>
          )}
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
    </div>
  );
}

function TreeMarkerSphere({
  hovered,
  isCoarsePointer,
  markerScaleMultiplier,
  marker,
  placementMode,
  selected,
  onDragEnd,
  onDragMove,
  onDragStart,
  onSelect,
}) {
  const x = safeNumber(marker.x, 0);
  const z = safeNumber(marker.z, 0);
  const groupRef = useRef(null);
  const worldPositionRef = useRef(new Vector3());
  const { camera } = useThree();

  useFrame(({ clock }) => {
    if (!groupRef.current) {
      return;
    }

    const pulse = 1 + Math.sin(clock.elapsedTime * 0.85 + x * 0.02 + z * 0.02) * 0.035;
    worldPositionRef.current.set(x, PLACEMENT_Y + 2, z);
    const distance = camera.position.distanceTo(worldPositionRef.current);
    const adaptiveScale = MathUtils.clamp(distance / 180, 1, 4);
    const interactionScale = selected
      ? adaptiveScale * 1.25
      : !isCoarsePointer && !placementMode && hovered
        ? adaptiveScale * 1.35
        : adaptiveScale;
    const scale = pulse * interactionScale * markerScaleMultiplier;
    groupRef.current.scale.setScalar(scale);
  });

  const canHover = !isCoarsePointer && !placementMode && hovered;
  const baseColor = selected ? '#f3a0c8' : canHover ? '#8fcfbd' : '#d6d166';
  const radius = selected
    ? MARKER_RADIUS_SELECTED
    : canHover
      ? MARKER_RADIUS_HOVER
      : MARKER_RADIUS_BASE;

  const handlePointerDown = (event) => {
    event.stopPropagation();
    event.target.setPointerCapture(event.pointerId);
    onSelect(marker);

    if (placementMode) {
      onDragStart(marker.id);
    }
  };

  const handlePointerMove = (event) => {
    if (!placementMode || !event.buttons) {
      return;
    }

    event.stopPropagation();
    onDragMove(event, marker.id);
  };

  const handlePointerUp = (event) => {
    event.stopPropagation();

    if (event.target.hasPointerCapture?.(event.pointerId)) {
      event.target.releasePointerCapture(event.pointerId);
    }

    onDragEnd();
  };

  const handleClick = (event) => {
    event.stopPropagation();
    onSelect(marker);
  };

  return (
    <group ref={groupRef} position={[x, PLACEMENT_Y + 2, z]}>
      <mesh
        renderOrder={1000}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      >
        <sphereGeometry args={[radius, 24, 24]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <Html center position={[0, 0, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className={
            selected
              ? 'marker-orb is-selected'
              : canHover
                ? 'marker-orb is-hovered'
                : 'marker-orb'
          }
        >
          <div
            className={`marker-tree-mask ${selected ? 'is-selected' : ''} ${
              canHover ? 'is-hovered' : ''
            }`}
          />
        </div>
      </Html>
    </group>
  );
}

function LoadingOverlay({ error, ready }) {
  return (
    <div className={ready ? 'loading-overlay is-hidden' : 'loading-overlay'}>
      <div className="loading-panel">
        <p className="loading-eyebrow">listening instrument</p>
        <h1>GROVEMATRIX</h1>
        <p className="loading-subtitle">assembling canopy scan</p>
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
  markerScaleMultiplier,
  markers,
  onPointCloudLoaded,
  onCanvasPlacement,
  onDragEnd,
  onDragMove,
  onDragStart,
  onMarkerHover,
  onSelectMarker,
  pointer,
  placementMode,
  selectedMarker,
  suppressPlacementRef,
  planViewRequest,
}) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const { camera, gl, raycaster, size } = useThree();
  const projectedRef = useRef(new Vector3());
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

    if (isCoarsePointer || placementMode || !pointer.active || !markers.length) {
      if (hoveredMarkerId !== null) {
        onMarkerHover(null);
      }
      return;
    }

    let nearestId = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const marker of markers) {
      projectedRef.current.set(
        safeNumber(marker.x, 0),
        PLACEMENT_Y + 2,
        safeNumber(marker.z, 0),
      );
      projectedRef.current.project(camera);

      const sx = ((projectedRef.current.x + 1) * 0.5) * size.width;
      const sy = ((1 - projectedRef.current.y) * 0.5) * size.height;
      const distance = Math.hypot(pointer.x - sx, pointer.y - sy);

      if (distance < MARKER_HOVER_RADIUS_PX && distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = marker.id;
      }
    }

    if (nearestId !== hoveredMarkerId) {
      onMarkerHover(nearestId);
    }
  });

  return (
    <>
      <mesh
        position={[0, PLACEMENT_Y, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={1}
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

      <PointCloud
        isCoarsePointer={isCoarsePointer}
        onLoaded={onPointCloudLoaded}
        placementMode={placementMode}
        pointerActive={!isCoarsePointer && pointer.active}
      />

      {markers.map((marker) => (
        <TreeMarkerSphere
          hovered={hoveredMarkerId === marker.id}
          isCoarsePointer={isCoarsePointer}
          key={marker.id}
          marker={marker}
          markerScaleMultiplier={markerScaleMultiplier}
          placementMode={placementMode}
          selected={selectedMarker?.id === marker.id}
          onDragEnd={onDragEnd}
          onDragMove={onDragMove}
          onDragStart={onDragStart}
          onSelect={onSelectMarker}
        />
      ))}

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.08}
        enablePan
        enableRotate
        enableZoom
        enabled={!draggingId}
        mouseButtons={{
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        panSpeed={0.55}
        rotateSpeed={0.45}
        screenSpacePanning
        target={[0, 0, 0]}
        touches={{
          ONE: THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        }}
        minDistance={ORBIT_MIN_DISTANCE}
        maxDistance={ORBIT_MAX_DISTANCE}
        maxPolarAngle={Math.PI / 2.03}
        zoomSpeed={0.65}
      />
    </>
  );
}

export default function App() {
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
  const [pointer, setPointer] = useState({ x: 0, y: 0, active: false });
  const [uiHover, setUiHover] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const markerCountRef = useRef(1);
  const draggingIdRef = useRef(null);
  const suppressPlaneClickRef = useRef(false);
  const dragPointRef = useRef(new Vector3());
  const pointerNdcRef = useRef(new Vector2());
  const markerPlaneRef = useRef(PLACEMENT_PLANE);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setMinIntroElapsed(true);
    }, 5000);

    return () => window.clearTimeout(timer);
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

        if (!active) {
          return;
        }

        markerCountRef.current = highestId + 1;
        setMarkers(nextMarkers);
        console.log('Loaded markers for scene:', nextMarkers);
        console.log(
          'Renderable marker count:',
          nextMarkers.length,
          nextMarkers.slice(0, 3),
        );
      } catch (error) {
        if (!active) {
          return;
        }

        markerCountRef.current = 1;
        setMarkers([]);
        console.warn('Unable to load saved markers from /data/tree-markers.json', error);
      }
    };

    loadMarkers();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
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
    if (!placementMode) {
      setHoveredMarkerId(markerId);
    }
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
        ? pointer.active
          ? 'crosshair'
          : 'default'
        : hoveredMarkerId
          ? 'pointer'
          : 'default';

  const loadingReady = pointCloudLoaded && minIntroElapsed && !pointCloudError;
  const markerScaleMultiplier = isCoarsePointer ? 1.35 : 1;

  return (
    <div className="app-shell" style={{ cursor }}>
      <LoadingOverlay error={pointCloudError} ready={loadingReady} />
      {!isCoarsePointer && pointer.active && !placementMode && !uiHover ? (
        <div
          className="cursor-focus"
          style={{ left: `${pointer.x}px`, top: `${pointer.y}px` }}
        />
      ) : null}
      <ControlPanel
        isCoarsePointer={isCoarsePointer}
        drawerOpen={drawerOpen}
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
        onTogglePlacement={handleTogglePlacement}
        onTopView={handleTopView}
      />

      <Canvas
        camera={{ position: [0, 300, 0.01], fov: 55, near: 0.1, far: CAMERA_FAR }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => {
          cameraRef.current = camera;
          camera.near = 0.1;
          camera.far = CAMERA_FAR;
          camera.updateProjectionMatrix();
        }}
        onPointerEnter={(event) => {
          setPointer({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY, active: true });
        }}
        onPointerMove={(event) => {
          setPointer({ x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY, active: true });
        }}
        onPointerLeave={() => {
          setPointer((current) => ({ ...current, active: false }));
          setHoveredMarkerId(null);
        }}
      >
        <color attach="background" args={['#050816']} />
        <ambientLight intensity={0.75} />
        <PointCloudErrorBoundary onError={setPointCloudError}>
          <Suspense fallback={null}>
            <Scene
              controlsRef={controlsRef}
              draggingId={draggingId}
              hoveredMarkerId={hoveredMarkerId}
              isCoarsePointer={isCoarsePointer}
              markerScaleMultiplier={markerScaleMultiplier}
              markers={markers}
              onCanvasPlacement={handlePlaceMarker}
              onDragEnd={handleDragEnd}
              onDragMove={handleDragMove}
              onDragStart={handleDragStart}
              onMarkerHover={handleMarkerHover}
              onPointCloudLoaded={() => setPointCloudLoaded(true)}
              onSelectMarker={handleSelectMarker}
              pointer={pointer}
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
