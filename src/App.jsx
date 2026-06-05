import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PLACEMENT_Y, serializeMarkers } from './lib/markerHelpers.js';
import { useGroveStore, selectSelectedMarker } from './store/useGroveStore.js';
import { useCoarsePointer } from './hooks/useCoarsePointer.js';
import { Scene } from './scene/Scene.jsx';
import { LoadingOverlay } from './components/LoadingOverlay.jsx';
import { ControlPanel } from './components/ControlPanel.jsx';
import { ModeToggle } from './components/ModeToggle.jsx';
import { CalibratorPanel } from './components/Calibrator/CalibratorPanel.jsx';
import { Map2DView } from './components/Map2D/Map2DView.jsx';
import { City3DView } from './scene/City3DView.jsx';
import { CaptureFlow } from './components/Capture/CaptureFlow.jsx';
import { BenefitsSummary } from './components/Benefits/BenefitsSummary.jsx';

const CAMERA_FAR = 10000000;
const PLAN_VIEW_POSITION = [0, 12000, 0.01];

class PointCloudErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

// ── Stub views for upcoming modes ─────────────────────────────────────────────

function StubMode({ label }) {
  return (
    <div className="stub-mode">
      <div className="stub-mode-inner">
        <p className="stub-mode-label">{label}</p>
        <p className="stub-mode-hint">coming in a future pass</p>
      </div>
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const isCalibrate = new URLSearchParams(window.location.search).has('calibrate');

  if (isCalibrate) return <CalibratorPanel />;

  return <GroveApp />;
}

function GroveApp() {
  // Store slices
  const markers = useGroveStore((s) => s.markers);
  const selectedMarker = useGroveStore(selectSelectedMarker);
  const hoveredMarkerId = useGroveStore((s) => s.hoveredMarkerId);
  const draggingId = useGroveStore((s) => s.draggingId);
  const placementMode = useGroveStore((s) => s.placementMode);
  const viewMode = useGroveStore((s) => s.viewMode);
  const planViewRequest = useGroveStore((s) => s.planViewRequest);
  const drawerOpen = useGroveStore((s) => s.drawerOpen);
  const menuOpen = useGroveStore((s) => s.menuOpen);
  const pointCloudLoaded = useGroveStore((s) => s.pointCloudLoaded);
  const pointCloudError = useGroveStore((s) => s.pointCloudError);

  // Store actions
  const fetchMarkers = useGroveStore((s) => s.fetchMarkers);
  const placeMarker = useGroveStore((s) => s.placeMarker);
  const deleteMarker = useGroveStore((s) => s.deleteMarker);
  const selectMarker = useGroveStore((s) => s.selectMarker);
  const clearSelection = useGroveStore((s) => s.clearSelection);
  const setHoveredMarkerId = useGroveStore((s) => s.setHoveredMarkerId);
  const setDraggingId = useGroveStore((s) => s.setDraggingId);
  const setDraggingMarkerPosition = useGroveStore((s) => s.setDraggingMarkerPosition);
  const togglePlacement = useGroveStore((s) => s.togglePlacement);
  const requestPlanView = useGroveStore((s) => s.requestPlanView);
  const toggleDrawer = useGroveStore((s) => s.toggleDrawer);
  const toggleMenu = useGroveStore((s) => s.toggleMenu);
  const setPointCloudLoaded = useGroveStore((s) => s.setPointCloudLoaded);
  const setPointCloudError = useGroveStore((s) => s.setPointCloudError);

  // Local state that doesn't need to be global
  const isCoarsePointer = useCoarsePointer();
  const [debugPointerActive, setDebugPointerActive] = useState(false);
  const [uiHover, setUiHover] = useState(false);
  const [minIntroElapsed, setMinIntroElapsed] = useState(false);

  // Refs that must stay refs (R3F, timing, drag math)
  const controlsRef = useRef(null);
  const isNavigatingRef = useRef(false);
  const navigationEndTimeoutRef = useRef(null);
  const draggingIdRef = useRef(null);
  const suppressPlaneClickRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0, clientX: 0, clientY: 0, active: false });

  // ── Boot ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchMarkers();
  }, [fetchMarkers]);

  useEffect(() => {
    const timer = window.setTimeout(() => setMinIntroElapsed(true), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      if (navigationEndTimeoutRef.current) window.clearTimeout(navigationEndTimeoutRef.current);
    };
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') { clearSelection(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMarker) {
        event.preventDefault();
        deleteMarker(selectedMarker.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMarker, clearSelection, deleteMarker]);

  // ── Pointer tracking (feeds point-size hover animation in PointCloud) ───────

  const handlePointerEnter = (event) => {
    pointerRef.current.x = event.nativeEvent.offsetX ?? pointerRef.current.x;
    pointerRef.current.y = event.nativeEvent.offsetY ?? pointerRef.current.y;
    pointerRef.current.clientX = event.clientX;
    pointerRef.current.clientY = event.clientY;
    pointerRef.current.active = true;
    setDebugPointerActive(true);
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
    setHoveredMarkerId(null);
  };

  // ── Marker actions ──────────────────────────────────────────────────────────

  const handlePlaceMarker = (position) => {
    if (suppressPlaneClickRef.current) { suppressPlaneClickRef.current = false; return; }
    placeMarker(position);
  };

  const handleDeleteSelected = () => {
    if (selectedMarker) deleteMarker(selectedMarker.id);
  };

  // ── Drag ────────────────────────────────────────────────────────────────────

  const handleDragStart = (markerId) => {
    draggingIdRef.current = markerId;
    suppressPlaneClickRef.current = true;
    if (controlsRef.current) controlsRef.current.enabled = false;
    if (navigationEndTimeoutRef.current) {
      window.clearTimeout(navigationEndTimeoutRef.current);
      navigationEndTimeoutRef.current = null;
    }
    isNavigatingRef.current = false;
    setDraggingId(markerId);
  };

  // Called by Scene after it resolves the raycast internally
  const handleDragMove = (x, z, markerId) => {
    if (draggingIdRef.current !== markerId) return;
    setDraggingMarkerPosition(markerId, x, z);
  };

  const handleDragEnd = () => {
    draggingIdRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = true;
    if (navigationEndTimeoutRef.current) {
      window.clearTimeout(navigationEndTimeoutRef.current);
      navigationEndTimeoutRef.current = null;
    }
    isNavigatingRef.current = false;
    setDraggingId(null);
    window.setTimeout(() => { suppressPlaneClickRef.current = false; }, 0);
  };

  // ── JSON export ─────────────────────────────────────────────────────────────

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(serializeMarkers(markers), null, 2));
    } catch (err) {
      console.error('Unable to copy marker JSON.', err);
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

  // ── Cursor ──────────────────────────────────────────────────────────────────

  const cursor = isCoarsePointer
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
        markers={markers}
        placementMode={placementMode}
        selectedMarker={selectedMarker}
        onCopyJson={handleCopyJson}
        onDeleteSelected={handleDeleteSelected}
        onDeleteMarker={deleteMarker}
        onDownloadJson={handleDownloadJson}
        onPanelHoverChange={setUiHover}
        onSelectMarker={selectMarker}
        onToggleDrawer={toggleDrawer}
        onToggleMenu={toggleMenu}
        onTogglePlacement={togglePlacement}
        onTopView={() => requestPlanView(PLAN_VIEW_POSITION)}
      />

      <ModeToggle />

      {viewMode === 'pointcloud' && (
        <Canvas
          camera={{ position: [0, 300, 0.01], fov: 55, near: 0.1, far: CAMERA_FAR }}
          dpr={[1, 1.25]}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onPointerMissed={() => { if (!placementMode) clearSelection(); }}
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
                onClearSelection={clearSelection}
                onDragEnd={handleDragEnd}
                onDragMove={handleDragMove}
                onDragStart={handleDragStart}
                onHoverChange={setHoveredMarkerId}
                onPointCloudLoaded={setPointCloudLoaded}
                onSelectMarker={selectMarker}
                pointerRef={pointerRef}
                placementMode={placementMode}
                selectedMarker={selectedMarker}
                suppressPlacementRef={suppressPlaneClickRef}
                planViewRequest={planViewRequest}
              />
            </Suspense>
          </PointCloudErrorBoundary>
        </Canvas>
      )}

      {viewMode === 'map2d' && <Map2DView />}
      {viewMode === 'city3d' && <City3DView />}

      {/* Capture flow — global overlay, works in any mode */}
      <CaptureFlow />

      {/* Benefits summary panel */}
      <BenefitsSummary />
    </div>
  );
}
