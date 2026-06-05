import React, { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import * as THREE from 'three';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PointCloud } from '../../scene/PointCloud.jsx';
import { ASBURY_PARK_ANCHOR, solveTransform } from '../../lib/geoTransform.js';
import { useGroveStore } from '../../store/useGroveStore.js';

// ── Basemap styles (no API key required) ──────────────────────────────────────
// Esri World Imagery (satellite) — free for dev/non-commercial use.
// OpenStreetMap (streets) — free, CC-BY.

const BASEMAPS = {
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution:
          '© Esri, Maxar, GeoEye, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN',
        maxzoom: 19,
      },
      'esri-ref': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'esri-bg', type: 'raster', source: 'esri' },
      { id: 'esri-labels', type: 'raster', source: 'esri-ref' },
    ],
  },
  streets: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
  },
};

// ── Nominatim address search ──────────────────────────────────────────────────

async function nominatimSearch(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '6');
  url.searchParams.set('addressdetails', '1');
  const res = await fetch(url, { headers: { 'Accept-Language': 'en-US,en' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return res.json();
}

// ── Top-down pointcloud picker ────────────────────────────────────────────────

function CalibratorScene({ onScenePick, picking, resetToken }) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');
  const { camera, raycaster, gl } = useThree();
  const controlsRef = useRef(null);

  const radius = React.useMemo(() => {
    const geo = sourceGeometry.clone();
    geo.computeBoundingSphere();
    return geo.boundingSphere?.radius || 10;
  }, [sourceGeometry]);

  // Initial camera: straight down, north (−Z) at screen top.
  React.useLayoutEffect(() => {
    camera.position.set(0, radius * 2, 0.01);
    camera.near = 0.1;
    camera.far = 100000000;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, radius]);

  // Reset to top-down whenever the parent requests it.
  useEffect(() => {
    if (!controlsRef.current) return;
    camera.position.set(0, radius * 2, 0.01);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    controlsRef.current.target.set(0, 0, 0);
    controlsRef.current.update();
  }, [camera, radius, resetToken]);

  const handleClick = useCallback(
    (event) => {
      if (!picking || !onScenePick) return;
      const element = gl.domElement;
      const rect = element.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -10);
      const hitPoint = new THREE.Vector3();
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(plane, hitPoint)) {
        onScenePick({ x: hitPoint.x, z: hitPoint.z });
      }
    },
    [camera, gl, onScenePick, picking, raycaster],
  );

  useEffect(() => {
    const el = gl.domElement;
    el.addEventListener('click', handleClick);
    return () => el.removeEventListener('click', handleClick);
  }, [gl, handleClick]);

  return (
    <>
      <PointCloud placementMode={false} pointerRef={{ current: { active: false } }} />
      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.28}
        // Rotation disabled — a tilted view breaks GCP north/south orientation.
        enableRotate={false}
        mouseButtons={{
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        }}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </>
  );
}

// ── GCP row ───────────────────────────────────────────────────────────────────

function GcpRow({ index, gcp, residual, onRemove }) {
  return (
    <div className="cal-gcp-row">
      <span className="cal-gcp-idx">#{index + 1}</span>
      <span className="cal-gcp-coords">
        scene ({gcp.scene.x.toFixed(0)}, {gcp.scene.z.toFixed(0)})
        {' → '}
        {gcp.world.lat.toFixed(5)}°N {gcp.world.lng.toFixed(5)}°E
      </span>
      {residual != null && <span className="cal-gcp-res">{residual.toFixed(2)} m</span>}
      <button type="button" className="cal-gcp-remove" onClick={() => onRemove(index)}>
        ×
      </button>
    </div>
  );
}

// ── Map overlay: search + basemap toggle ──────────────────────────────────────

function MapControls({ basemap, onBasemapChange, mapRef }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);

  const handleSearch = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setShowResults(false);
    try {
      const hits = await nominatimSearch(q);
      setResults(hits);
      setShowResults(true);
    } catch (err) {
      setSearchError('Search unavailable');
    } finally {
      setSearching(false);
    }
  };

  const handleResultClick = (hit) => {
    const lng = parseFloat(hit.lon);
    const lat = parseFloat(hit.lat);
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 17, duration: 900 });
    setShowResults(false);
    setQuery(hit.display_name.split(',')[0]);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const close = (e) => {
      if (!searchRef.current?.contains(e.target)) setShowResults(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="cal-map-controls">
      {/* Address search */}
      <form className="cal-search-form" onSubmit={handleSearch} ref={searchRef}>
        <input
          className="cal-search-input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search address or place…"
          aria-label="Search address"
        />
        <button
          type="submit"
          className="cal-search-btn"
          disabled={searching || !query.trim()}
          aria-label="Search"
        >
          {searching ? '…' : '↵'}
        </button>

        {showResults && results.length > 0 && (
          <ul className="cal-search-results">
            {results.map((hit) => (
              <li key={hit.place_id}>
                <button
                  type="button"
                  className="cal-search-result-btn"
                  onClick={() => handleResultClick(hit)}
                >
                  <span className="cal-result-name">
                    {hit.display_name.split(',').slice(0, 2).join(', ')}
                  </span>
                  <span className="cal-result-detail">
                    {hit.display_name.split(',').slice(2, 4).join(', ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showResults && results.length === 0 && !searching && (
          <div className="cal-search-empty">No results</div>
        )}

        {searchError && <div className="cal-search-empty">{searchError}</div>}
      </form>

      {/* Basemap toggle */}
      <div className="cal-basemap-toggle">
        <button
          type="button"
          className={`cal-basemap-btn${basemap === 'satellite' ? ' is-active' : ''}`}
          onClick={() => onBasemapChange('satellite')}
        >
          Satellite
        </button>
        <button
          type="button"
          className={`cal-basemap-btn${basemap === 'streets' ? ' is-active' : ''}`}
          onClick={() => onBasemapChange('streets')}
        >
          Streets
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CalibratorPanel() {
  const setGeoreference = useGroveStore((s) => s.setGeoreference);
  const currentGeoref = useGroveStore((s) => s.georeference);

  const [gcps, setGcps] = useState(() => currentGeoref?.gcps ?? []);
  const [pickStep, setPickStep] = useState('idle'); // 'scene' | 'map' | 'idle'
  const [pendingScene, setPendingScene] = useState(null);
  const [solved, setSolved] = useState(null);
  const [solveError, setSolveError] = useState(null);
  const [basemap, setBasemap] = useState('satellite');
  const [resetToken, setResetToken] = useState(0);

  // Manual entry state
  const [manualLng, setManualLng] = useState('');
  const [manualLat, setManualLat] = useState('');
  const [manualSceneX, setManualSceneX] = useState('');
  const [manualSceneZ, setManualSceneZ] = useState('');

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  // ── Initialise MapLibre ───────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAPS.satellite,
      center: [ASBURY_PARK_ANCHOR.lng, ASBURY_PARK_ANCHOR.lat],
      zoom: 16,
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Basemap switching ─────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Preserve center/zoom across style swap
    const center = map.getCenter();
    const zoom = map.getZoom();
    map.setStyle(BASEMAPS[basemap]);
    map.once('style.load', () => {
      map.setCenter(center);
      map.setZoom(zoom);
    });
  }, [basemap]);

  // ── Map click (GCP picking) ───────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e) => {
      if (pickStep !== 'map' || !pendingScene) return;
      const { lng, lat } = e.lngLat;
      setGcps((prev) => [...prev, { scene: pendingScene, world: { lng, lat } }]);
      setPendingScene(null);
      setPickStep('idle');
      setSolved(null);
    };
    map.on('click', handler);
    return () => map.off('click', handler);
  }, [pickStep, pendingScene]);

  // ── Map cursor ────────────────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = pickStep === 'map' ? 'crosshair' : '';
  }, [pickStep]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleScenePick = useCallback(
    (scenePoint) => {
      if (pickStep !== 'scene') return;
      setPendingScene(scenePoint);
      setPickStep('map');
    },
    [pickStep],
  );

  const handleAddGcpClick = () => { if (pickStep === 'idle') setPickStep('scene'); };
  const handleCancel = () => { setPickStep('idle'); setPendingScene(null); };
  const handleRemoveGcp = (index) => { setGcps((p) => p.filter((_, i) => i !== index)); setSolved(null); };

  const handleManualAdd = () => {
    const lng = parseFloat(manualLng);
    const lat = parseFloat(manualLat);
    const x = parseFloat(manualSceneX);
    const z = parseFloat(manualSceneZ);
    if (!isFinite(lng) || !isFinite(lat) || !isFinite(x) || !isFinite(z)) return;
    setGcps((prev) => [...prev, { scene: { x, z }, world: { lng, lat } }]);
    setManualLng(''); setManualLat(''); setManualSceneX(''); setManualSceneZ('');
    setSolved(null);
  };

  const handleSolve = () => {
    setSolveError(null);
    try {
      const result = solveTransform(gcps);
      setSolved(result);
      setGeoreference(result);
    } catch (err) {
      setSolveError(err.message);
    }
  };

  const instructionText = {
    idle: gcps.length < 2
      ? 'Add ≥2 GCPs: click a point in the cloud, then the same spot on the map.'
      : 'GCPs ready — hit Solve & Save, or add more.',
    scene: 'Click a recognisable point in the 3D view (pan with left-click, zoom scroll).',
    map: 'Now click the exact same location on the map.',
  }[pickStep];

  const residuals = solved?.perPointResiduals ?? [];

  return (
    <div className="cal-shell">
      <div className="cal-header">
        <span className="cal-title">GCP Calibrator</span>
        <span className="cal-subtitle">georef · Asbury Park NJ</span>
        {solved && (
          <span className="cal-rms">
            RMS {solved.rmsM.toFixed(2)} m · scale {solved.scale.toFixed(5)} · saved
          </span>
        )}
        <a className="cal-exit" href="/" aria-label="Exit calibrator">← back to app</a>
      </div>

      <div className="cal-body">
        {/* Left — 3D plan view */}
        <div className="cal-pane cal-pane-scene">
          <div className="cal-pane-label">3D / Plan View</div>
          {pickStep === 'scene' && <div className="cal-pick-overlay">click a point</div>}

          {/* North indicator — rotation is disabled so this is always correct */}
          <div className="cal-north-indicator" title="North is always at the top. Pan with left-click, zoom with scroll.">
            <span className="cal-north-arrow">↑</span>
            <span className="cal-north-label">N</span>
          </div>
          <button
            type="button"
            className="cal-reset-view"
            title="Reset to top-down north-up view"
            onClick={() => setResetToken((t) => t + 1)}
          >
            ↩ top-down
          </button>

          <Canvas
            camera={{ position: [0, 300, 0.01], fov: 55, near: 0.1, far: 10000000 }}
            dpr={[1, 1.25]}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={['#0E1A14']} />
            <ambientLight intensity={0.75} />
            <Suspense fallback={null}>
              <CalibratorScene
                onScenePick={handleScenePick}
                picking={pickStep === 'scene'}
                resetToken={resetToken}
              />
            </Suspense>
          </Canvas>
        </div>

        {/* Right — MapLibre + controls overlay */}
        <div className="cal-pane cal-pane-map">
          <div className="cal-pane-label">Map</div>
          {pickStep === 'map' && <div className="cal-pick-overlay">click matching point</div>}
          <MapControls basemap={basemap} onBasemapChange={setBasemap} mapRef={mapRef} />
          <div ref={mapContainerRef} className="cal-map" />
        </div>
      </div>

      {/* Bottom panel */}
      <div className="cal-controls">
        <p className="cal-instruction">{instructionText}</p>

        <div className="cal-action-row">
          {pickStep === 'idle' ? (
            <button type="button" className="cal-btn" onClick={handleAddGcpClick}>
              + Add GCP
            </button>
          ) : (
            <button type="button" className="cal-btn cal-btn-cancel" onClick={handleCancel}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="cal-btn cal-btn-solve"
            onClick={handleSolve}
            disabled={gcps.length < 2}
          >
            Solve &amp; Save
          </button>
        </div>

        {solveError && <p className="cal-error">{solveError}</p>}

        {gcps.length > 0 && (
          <div className="cal-gcp-list">
            {gcps.map((gcp, i) => (
              <GcpRow
                key={i}
                index={i}
                gcp={gcp}
                residual={residuals[i]}
                onRemove={handleRemoveGcp}
              />
            ))}
          </div>
        )}

        {/* Manual entry */}
        <details className="cal-manual">
          <summary>Manual GCP entry (known survey origin)</summary>
          <div className="cal-manual-grid">
            <label>Scene X <input type="number" value={manualSceneX} onChange={e => setManualSceneX(e.target.value)} placeholder="e.g. -1204" /></label>
            <label>Scene Z <input type="number" value={manualSceneZ} onChange={e => setManualSceneZ(e.target.value)} placeholder="e.g. 3847" /></label>
            <label>Longitude <input type="number" value={manualLng} onChange={e => setManualLng(e.target.value)} placeholder="-74.0121" step="0.000001" /></label>
            <label>Latitude <input type="number" value={manualLat} onChange={e => setManualLat(e.target.value)} placeholder="40.2204" step="0.000001" /></label>
            <button type="button" className="cal-btn" onClick={handleManualAdd}>Add</button>
          </div>
        </details>
      </div>
    </div>
  );
}
