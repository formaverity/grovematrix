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
const TOP_VIEW_POSITION = [0, 300, 0.01];
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

function PointCloud({ onLoaded, placementMode, pointerActive }) {
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
        opacity={POINT_OPACITY}
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
  drawerOpen,
  loadedMarkerCount,
  markerCount,
  markerStyle,
  markers,
  placementMode,
  selectedMarker,
  onCopyJson,
  onDeleteSelected,
  onDeleteMarker,
  onDownloadJson,
  onMarkerStyleChange,
  onPanelHoverChange,
  onSelectMarker,
  onToggleDrawer,
  onToggleMarkerDebug,
  onTogglePlacement,
  onTopView,
  showMarkerDebug,
}) {
  return (
    <div className="hud">
      <div
        className="overlay"
        onPointerEnter={() => onPanelHoverChange(true)}
        onPointerLeave={() => onPanelHoverChange(false)}
      >
        <p className="eyebrow">BIO-INSTRUMENT CONSOLE</p>
        <h1>GROVEMATRIX</h1>
        <p className="panel-copy">A living scan of canopy infrastructure.</p>
        <p className="instruction-line">
          {placementMode
            ? 'Place, drag, and edit canopy nodes.'
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
            Plan View
          </button>
          <button type="button" onClick={onMarkerStyleChange}>
            Marker Style: {markerStyle === 'glyph' ? 'Glyph' : 'Sphere'}
          </button>
          <button type="button" onClick={onToggleMarkerDebug}>
            {showMarkerDebug ? 'Hide Marker Debug' : 'Show Marker Debug'}
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

        <p className="status-line">
          {loadedMarkerCount
            ? `Loaded ${loadedMarkerCount} saved markers`
            : 'No saved marker file loaded'}
        </p>
        <p className="status-line">Scene markers rendered: {markerCount}</p>
        <p className="status-line">Point effect: global hover swell</p>

        <div className="selection-card">
          <span>Selected Marker</span>
          {selectedMarker ? (
            <>
              <strong>{selectedMarker.id}</strong>
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
            </>
          ) : (
            <p>No marker selected</p>
          )}
        </div>

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
  marker,
  markerStyle,
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
      : !placementMode && hovered
        ? adaptiveScale * 1.35
        : adaptiveScale;
    const scale = pulse * interactionScale;
    groupRef.current.scale.setScalar(scale);
  });

  const baseColor = selected ? '#f3a0c8' : hovered && !placementMode ? '#d5d15c' : '#9bbf52';
  const glowColor = selected ? '#f3a0c8' : hovered && !placementMode ? '#c9863d' : '#8fcfbd';
  const radius = selected
    ? MARKER_RADIUS_SELECTED
    : !placementMode && hovered
      ? MARKER_RADIUS_HOVER
      : MARKER_RADIUS_BASE;
  const coreOpacity = selected ? 0.92 : !placementMode && hovered ? 0.9 : 0.72;
  const glowOpacity = selected ? 0.28 : !placementMode && hovered ? 0.24 : 0.18;

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
        <sphereGeometry args={[markerStyle === 'glyph' ? radius * 1.1 : radius, 24, 24]} />
        <meshBasicMaterial
          color={baseColor}
          transparent
          opacity={markerStyle === 'glyph' ? 0 : coreOpacity}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {markerStyle === 'glyph' ? (
        <Html center position={[0, 0, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className={
              selected
                ? 'marker-glyph is-selected'
                : hovered && !placementMode
                  ? 'marker-glyph is-hovered'
                  : 'marker-glyph'
            }
          >
            {'\u2667'}
          </div>
        </Html>
      ) : (
        <>
          <mesh scale={1.25} renderOrder={999}>
            <sphereGeometry args={[radius, 16, 16]} />
            <meshBasicMaterial
              color={glowColor}
              transparent
              opacity={glowOpacity}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <mesh renderOrder={1001}>
            <sphereGeometry
              args={[
                radius * 1.35,
                16,
                16,
              ]}
            />
            <meshBasicMaterial
              color={glowColor}
              transparent
              opacity={0.25}
              wireframe
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

function LoadingOverlay({ error, ready }) {
  return (
    <div className={ready ? 'loading-overlay is-hidden' : 'loading-overlay'}>
      <div className="loading-panel">
        <p className="loading-eyebrow">BIOLOGICAL SYNTHESIS</p>
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
  markerStyle,
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
  showMarkerDebug,
  suppressPlacementRef,
  topViewRequest,
}) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const { camera, gl, raycaster, size } = useThree();
  const projectedRef = useRef(new Vector3());

  const radius = useMemo(() => {
    const geometry = sourceGeometry.clone();
    geometry.computeBoundingSphere();
    return geometry.boundingSphere?.radius || 10;
  }, [sourceGeometry]);

  useLayoutEffect(() => {
    camera.position.set(radius * 0.8, radius * 0.3, radius * 1.8);
    camera.near = Math.max(0.1, radius / 500);
    camera.far = Math.max(1000, radius * 20);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, radius]);

  useEffect(() => {
    if (!topViewRequest || !controlsRef.current) {
      return;
    }

    camera.position.set(...TOP_VIEW_POSITION);
    camera.lookAt(0, 0, 0);
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [camera, controlsRef, topViewRequest]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!placementMode || draggingId || suppressPlacementRef.current) {
        return;
      }

      const target = event.target;
      if (target instanceof Element && target.closest('.overlay')) {
        return;
      }

      const rect = gl.domElement.getBoundingClientRect();
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

    gl.domElement.addEventListener('pointerdown', handlePointerDown);
    return () => gl.domElement.removeEventListener('pointerdown', handlePointerDown);
  }, [camera, draggingId, gl, onCanvasPlacement, placementMode, raycaster, suppressPlacementRef]);

  useFrame(() => {
    if (placementMode || !pointer.active || !markers.length) {
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
          opacity={showMarkerDebug ? 0.08 : 0}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      <PointCloud
        onLoaded={onPointCloudLoaded}
        placementMode={placementMode}
        pointerActive={pointer.active}
      />

      {markers.map((marker) => (
        <TreeMarkerSphere
          hovered={hoveredMarkerId === marker.id}
          key={marker.id}
          marker={marker}
          markerStyle={markerStyle}
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
        enablePan
        enableRotate
        enableZoom
        enabled={!draggingId}
        target={[0, 0, 0]}
        minDistance={Math.max(2, radius * 0.15)}
        maxDistance={Math.max(20, radius * 6)}
        maxPolarAngle={Math.PI * 0.6}
      />
    </>
  );
}

export default function App() {
  const [hoveredMarkerId, setHoveredMarkerId] = useState(null);
  const [markerStyle, setMarkerStyle] = useState('sphere');
  const [markers, setMarkers] = useState([]);
  const [pointCloudLoaded, setPointCloudLoaded] = useState(false);
  const [pointCloudError, setPointCloudError] = useState(null);
  const [minIntroElapsed, setMinIntroElapsed] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState(null);
  const [placementMode, setPlacementMode] = useState(false);
  const [showMarkerDebug, setShowMarkerDebug] = useState(false);
  const [topViewRequest, setTopViewRequest] = useState(0);
  const [draggingId, setDraggingId] = useState(null);
  const [loadedMarkerCount, setLoadedMarkerCount] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pointer, setPointer] = useState({ x: 0, y: 0, active: false });
  const [uiHover, setUiHover] = useState(false);
  const controlsRef = useRef(null);
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
        setLoadedMarkerCount(nextMarkers.length);
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
        setLoadedMarkerCount(0);
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

  const handleTopView = () => {
    setTopViewRequest((current) => current + 1);
  };

  const handleTogglePlaneDebug = () => {
    setShowMarkerDebug((current) => !current);
  };

  const handleToggleDrawer = () => {
    setDrawerOpen((current) => !current);
  };

  const handleToggleMarkerStyle = () => {
    setMarkerStyle((current) => (current === 'sphere' ? 'glyph' : 'sphere'));
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
    setDraggingId(null);

    window.setTimeout(() => {
      suppressPlaneClickRef.current = false;
    }, 0);
  };

  const cursor =
    draggingId
      ? 'grabbing'
      : placementMode
        ? pointer.active
          ? 'crosshair'
          : 'default'
        : hoveredMarkerId
          ? 'pointer'
          : 'default';

  const loadingReady = pointCloudLoaded && minIntroElapsed && !pointCloudError;

  return (
    <div className="app-shell" style={{ cursor }}>
      <LoadingOverlay error={pointCloudError} ready={loadingReady} />
      {pointer.active && !placementMode && !uiHover ? (
        <div
          className="cursor-focus"
          style={{ left: `${pointer.x}px`, top: `${pointer.y}px` }}
        />
      ) : null}
      <ControlPanel
        drawerOpen={drawerOpen}
        loadedMarkerCount={loadedMarkerCount}
        markerCount={markers.length}
        markerStyle={markerStyle}
        markers={markers}
        placementMode={placementMode}
        selectedMarker={selectedMarker}
        onCopyJson={handleCopyJson}
        onDeleteSelected={handleDeleteSelected}
        onDeleteMarker={handleDeleteMarker}
        onDownloadJson={handleDownloadJson}
        onMarkerStyleChange={handleToggleMarkerStyle}
        onPanelHoverChange={setUiHover}
        onSelectMarker={handleSelectMarker}
        onToggleDrawer={handleToggleDrawer}
        onToggleMarkerDebug={handleTogglePlaneDebug}
        onTogglePlacement={handleTogglePlacement}
        onTopView={handleTopView}
        showMarkerDebug={showMarkerDebug}
      />

      <Canvas
        camera={{ fov: 50, position: [0, 0, 12] }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
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
              markerStyle={markerStyle}
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
              showMarkerDebug={showMarkerDebug}
              suppressPlacementRef={suppressPlaneClickRef}
              topViewRequest={topViewRequest}
            />
          </Suspense>
        </PointCloudErrorBoundary>
      </Canvas>
    </div>
  );
}
