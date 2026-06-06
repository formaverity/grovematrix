import React, {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Canvas, useLoader, useThree } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { useGroveStore, selectSelectedMarker } from '../store/useGroveStore.js';
import { getLayer } from '../lib/cityData.js';
import { latLngToENU, lngLatToEnuCoords } from '../lib/geoTransform.js';
import { CanopyDomes } from './CanopyDomes.jsx';
import { formatBenefit } from '../lib/markerHelpers.js';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// ── Palette ───────────────────────────────────────────────────────────────────

const MAT = {
  // Neutral dark floor — contrast base for everything above it
  ground: new THREE.MeshStandardMaterial({
    color: '#0d1710', roughness: 1,
  }),

  // Buildings (measured height) — lit mid-green with warm emissive edge
  buildings: new THREE.MeshStandardMaterial({
    color: '#3a6e4a', roughness: 0.65, metalness: 0.08,
    emissive: '#0f2a18', emissiveIntensity: 0.35,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }),

  // Buildings (estimated height) — same hue, clearly transparent
  buildingsEst: new THREE.MeshStandardMaterial({
    color: '#3a6e4a', roughness: 0.75,
    transparent: true, opacity: 0.45,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }),

  // Greenspace — clearly visible mid-green, slightly raised
  greenspace: new THREE.MeshStandardMaterial({
    color: '#4e8c42', roughness: 1,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  }),

  // Hardscape surfaces — warm grey-green, distinct from ground
  hardscape: new THREE.MeshStandardMaterial({
    color: '#2e3e2f', roughness: 0.9,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }),

  markerDefault:  new THREE.MeshStandardMaterial({ color: '#6F8F72', roughness: 0.5 }),
  markerSelected: new THREE.MeshStandardMaterial({
    color: '#7CFFB2', emissive: '#3a7a50', emissiveIntensity: 0.6, roughness: 0.3,
  }),
};

// ── Coordinate helpers ────────────────────────────────────────────────────────

function toVec3(lng, lat, anchor, elevM = 0) {
  const { x, z } = lngLatToEnuCoords(lng, lat, anchor);
  return new THREE.Vector3(x, elevM, z);
}

// ── GeoJSON → Shape ───────────────────────────────────────────────────────────
// Shapes use (east, north) = (X, Y) in the shape plane.
// After geometry.rotateX(-Math.PI/2): shape X→Three X, shape Y→Three -Z.

function ringToShape(ring, anchor) {
  const shape = new THREE.Shape();
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    const { east, north } = latLngToENU(lng, lat, anchor);
    if (i === 0) shape.moveTo(east, north);
    else shape.lineTo(east, north);
  }
  return shape;
}

function polygonToShapes(coords, anchor) {
  const [outerRing, ...holeRings] = coords;
  const shape = ringToShape(outerRing, anchor);
  for (const hole of holeRings) {
    shape.holes.push(ringToShape(hole, anchor));
  }
  return shape;
}

// ── Building mesh ─────────────────────────────────────────────────────────────

function BuildingsMesh({ data, anchor, visible }) {
  const [measured, estimated] = useMemo(() => {
    const measGeos = [];
    const estGeos  = [];

    for (const f of data.features) {
      if (!f.geometry) continue;
      const heightM = Number(f.properties?.height_m) || 6;
      const isEst   = f.properties?.height_source !== 'measured';
      const polys   = f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates
        : [f.geometry.coordinates];

      for (const poly of polys) {
        try {
          const shape = polygonToShapes(poly, anchor);
          const geo   = new THREE.ExtrudeGeometry(shape, {
            depth: heightM,
            bevelEnabled: false,
          });
          geo.rotateX(-Math.PI / 2);
          (isEst ? estGeos : measGeos).push(geo);
        } catch {
          // skip malformed rings
        }
      }
    }

    const merge = (geos) => {
      if (!geos.length) return null;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      return merged;
    };

    return [merge(measGeos), merge(estGeos)];
  }, [data, anchor]);

  if (!visible) return null;

  return (
    <group>
      {measured && <mesh geometry={measured} material={MAT.buildings} castShadow receiveShadow />}
      {estimated && <mesh geometry={estimated} material={MAT.buildingsEst} castShadow receiveShadow />}
    </group>
  );
}

// ── Flat surface mesh (greenspace + hardscape) ────────────────────────────────

function SurfaceMesh({ data, anchor, elevY, material, visible }) {
  const geometry = useMemo(() => {
    const geos = [];
    for (const f of data.features) {
      if (!f.geometry) continue;
      const polys = f.geometry.type === 'MultiPolygon'
        ? f.geometry.coordinates
        : f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : null;
      if (!polys) continue;

      for (const poly of polys) {
        try {
          const shape = polygonToShapes(poly, anchor);
          const geo   = new THREE.ShapeGeometry(shape);
          geo.rotateX(-Math.PI / 2);
          geo.translate(0, elevY, 0);
          geos.push(geo);
        } catch {
          // skip
        }
      }
    }
    if (!geos.length) return null;
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return merged;
  }, [data, anchor, elevY]);

  if (!visible || !geometry) return null;
  return <mesh geometry={geometry} material={material} receiveShadow />;
}

// ── Markers ───────────────────────────────────────────────────────────────────

function CityMarkerPin({ marker, anchor, selected, placementMode, onSelect, onHover }) {
  const markerId = marker.marker_code ?? marker.id;
  const pos = useMemo(
    () => marker.lng != null ? toVec3(marker.lng, marker.lat, anchor, 0.5) : null,
    [marker.lng, marker.lat, anchor],
  );
  if (!pos) return null;

  return (
    <group position={pos} renderOrder={9999}>
      <mesh
        onPointerOver={(e) => { e.stopPropagation(); onHover(markerId); }}
        onPointerOut={(e)  => { e.stopPropagation(); onHover(null); }}
        onClick={(e)       => { e.stopPropagation(); onSelect(marker); }}
      >
        <cylinderGeometry args={[0.3, 0.3, 1.2, 8]} />
        <primitive object={selected ? MAT.markerSelected : MAT.markerDefault} attach="material" />
      </mesh>

      <Html center occlude={false} transform={false} zIndexRange={[1000, 0]}
        pointerEvents={placementMode ? 'none' : 'auto'}
      >
        <button
          type="button"
          className="marker-tree-button"
          onClick={(e) => { e.stopPropagation(); onSelect(marker); }}
        >
          <div className={`marker-tree-mask${selected ? ' is-selected' : ''}`} />
        </button>
      </Html>

      {selected && (
        <Html center={false} occlude={false} transform={false} zIndexRange={[2000, 0]}
          pointerEvents="auto"
        >
          <div className="marker-balloon city-marker-balloon"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <strong>{markerId}</strong>
            <span>{marker.commonName ?? marker.common_name ?? 'Tree'}</span>
            <small>{marker.species ?? 'species pending'}</small>
            <div className="marker-balloon-section">
              <small>Condition: {marker.condition ?? 'Unsurveyed'}</small>
            </div>
            <div className="marker-balloon-section">
              <small className="marker-balloon-label">canopy work</small>
              <small>Shade: {formatBenefit(marker.shadeSqft, 'sq ft')}</small>
              <small>Stormwater: {formatBenefit(marker.annualStormwaterGal, 'gal / yr')}</small>
            </div>
            {marker.lat != null && (
              <div className="marker-balloon-section">
                <small className="marker-balloon-label">georef</small>
                <small>{marker.lat.toFixed(5)}° N, {marker.lng.toFixed(5)}°</small>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

// ── Pointcloud overlay ────────────────────────────────────────────────────────
//
// The PLY is centered (same as PointCloud.jsx). The similarity transform is
// decomposed into R3F position / rotation / scale props so R3F handles the
// matrix update every frame — avoiding the matrixAutoUpdate timing issues.
//
// Math: matrix block [[ar, ai],[-ai, ar]] = scale * Ry(θ) in Three.js, where
//   θ = atan2(ai, ar), position = [tx, 0, -ty].
// Verified: R3F TRS order gives X=ar·x+ai·z+tx, Z=−ai·x+ar·z−ty ✓

function PointCloudOverlay({ georeference, opacity }) {
  const sourceGeometry = useLoader(PLYLoader, '/models/grove_pointcloud.ply');

  const geometry = useMemo(() => {
    const g = sourceGeometry.clone();
    g.computeBoundingSphere();
    if (g.boundingSphere) {
      g.translate(
        -g.boundingSphere.center.x,
        -g.boundingSphere.center.y,
        -g.boundingSphere.center.z,
      );
    }
    return g;
  }, [sourceGeometry]);

  // Decompose the similarity matrix into Three.js position/rotation/scale
  const [pos, rot, scl] = useMemo(() => {
    const { ar, ai, scale: s, tx, ty } = georeference;
    const theta = Math.atan2(ai, ar); // rotation around Y (Three.js convention)
    return [
      [tx, 0, -ty],   // translation: ENU (tx, 0, -ty)
      [0, theta, 0],  // Y-axis rotation
      [s, s, s],      // uniform scale
    ];
  }, [georeference]);

  if (opacity <= 0) return null;

  return (
    <points
      geometry={geometry}
      frustumCulled={false}
      position={pos}
      rotation={rot}
      scale={scl}
    >
      <pointsMaterial
        size={1.8}
        vertexColors
        transparent
        opacity={opacity}
        depthWrite={false}
        sizeAttenuation={false}
      />
    </points>
  );
}

// ── Ground plane + placement raycaster ───────────────────────────────────────

const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function GroundInteraction({ placementMode, anchor, georeference, onPlace, onMiss }) {
  const { camera, gl, raycaster } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const handler = (e) => {
      if (e.button !== 0) return;
      const rect = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width)  * 2 - 1,
        -((e.clientY - rect.top)  / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(GROUND_PLANE, hit)) return;

      // ENU hit: x=east, z=−north (Three.js convention).  Invert to lng/lat.
      const east  =  hit.x;
      const north = -hit.z;
      const lng_hit = anchor.lng + east  / (Math.cos(anchor.lat * Math.PI / 180) * 111320);
      const lat_hit = anchor.lat + north / 110540;

      if (placementMode) {
        onPlace(lng_hit, lat_hit);
      } else {
        onMiss();
      }
    };
    el.addEventListener('click', handler);
    return () => el.removeEventListener('click', handler);
  }, [camera, gl, raycaster, placementMode, anchor, onPlace, onMiss]);

  return null;
}

// ── City scene (inside Canvas) ────────────────────────────────────────────────

function CityScene({
  anchor,
  buildings, greenspace, hardscape,
  georeference,
  markers,
  selectedMarkerId,
  layerVisibility,
  placementMode,
  cloudOpacity,
}) {
  const selectMarker       = useGroveStore((s) => s.selectMarker);
  const clearSelection     = useGroveStore((s) => s.clearSelection);
  const placeMarkerAtWorld = useGroveStore((s) => s.placeMarkerAtWorld);
  const setHoveredMarkerId = useGroveStore((s) => s.setHoveredMarkerId);
  const serviceField       = useGroveStore((s) => s.serviceField);

  // Frame to city extent on first load
  const { camera } = useThree();
  useLayoutEffect(() => {
    camera.position.set(80, 120, 180);
    camera.near = 0.5;
    camera.far  = 20000;
    camera.updateProjectionMatrix();
  }, [camera]);

  const cityOpacity = 1 - cloudOpacity;

  return (
    <>
      <color attach="background" args={['#0E1A14']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[200, 400, -150]} intensity={0.9} castShadow />

      <OrbitControls
        enableDamping
        dampingFactor={0.22}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={10}
        maxDistance={8000}
        target={[0, 0, 0]}
        panSpeed={0.6}
        rotateSpeed={0.32}
        zoomSpeed={0.8}
      />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4000, 4000]} />
        <primitive object={MAT.ground} attach="material" />
      </mesh>

      {/* City layers */}
      <group visible={cityOpacity > 0.01}>
        <SurfaceMesh
          data={greenspace}
          anchor={anchor}
          elevY={0.05}
          material={MAT.greenspace}
          visible={layerVisibility.greenspace}
        />
        <SurfaceMesh
          data={hardscape}
          anchor={anchor}
          elevY={0.02}
          material={MAT.hardscape}
          visible={layerVisibility.hardscape}
        />
        <BuildingsMesh
          data={buildings}
          anchor={anchor}
          visible={layerVisibility.buildings}
        />
      </group>

      {/* Markers */}
      {markers.filter((m) => m.lng != null && m.lat != null).map((marker) => (
        <CityMarkerPin
          key={marker.id}
          marker={marker}
          anchor={anchor}
          selected={marker.id === selectedMarkerId}
          placementMode={placementMode}
          onSelect={selectMarker}
          onHover={setHoveredMarkerId}
        />
      ))}

      {/* Canopy domes (service field layer) */}
      <CanopyDomes
        markers={markers}
        anchor={anchor}
        metric={serviceField.metric}
        visible={serviceField.visible}
      />

      {/* Scanned cloud overlay */}
      <Suspense fallback={null}>
        <PointCloudOverlay georeference={georeference} opacity={cloudOpacity} />
      </Suspense>

      {/* Placement + deselect */}
      <GroundInteraction
        placementMode={placementMode}
        anchor={anchor}
        georeference={georeference}
        onPlace={placeMarkerAtWorld}
        onMiss={clearSelection}
      />
    </>
  );
}

// ── Top-level view ────────────────────────────────────────────────────────────

export function City3DView() {
  const georeference       = useGroveStore((s) => s.georeference);
  const georeferenceStatus = useGroveStore((s) => s.georeferenceStatus);
  const markers         = useGroveStore((s) => s.markers);
  const selectedMarkerId= useGroveStore((s) => s.selectedMarkerId);
  const layerVisibility = useGroveStore((s) => s.layerVisibility);
  const placementMode   = useGroveStore((s) => s.placementMode);
  const cloudOpacity    = useGroveStore((s) => s.cloudOpacity);
  const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;

  const [buildings,  setBuildings]  = useState(EMPTY_FC);
  const [greenspace, setGreenspace] = useState(EMPTY_FC);
  const [hardscape,  setHardscape]  = useState(EMPTY_FC);
  const [dataReady,  setDataReady]  = useState(false);

  useEffect(() => {
    Promise.all([
      getLayer('buildings'),
      getLayer('greenspace'),
      getLayer('hardscape_surfaces'),
    ]).then(([b, g, h]) => {
      setBuildings(b);
      setGreenspace(g);
      setHardscape(h);
      setDataReady(true);
    });
  }, []);

  if (georeferenceStatus === 'loading') return null;

  if (georeferenceStatus === 'absent') {
    return (
      <div className="stub-mode">
        <div className="stub-mode-inner">
          <p className="stub-mode-label">No georeference</p>
          <p className="stub-mode-hint">
            Open <a href="/?calibrate">/?calibrate</a>, add GCPs, solve and save.
          </p>
        </div>
      </div>
    );
  }

  const anchor = { lng: georeference.anchorLng, lat: georeference.anchorLat };

  return (
    <div className="city3d-container">
      <Canvas
        camera={{ position: [80, 120, 180], fov: 55, near: 0.5, far: 20000 }}
        dpr={[1, isCoarsePointer ? 1 : 1.25]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        shadows
      >
        <Suspense fallback={null}>
          <CityScene
            anchor={anchor}
            buildings={buildings}
            greenspace={greenspace}
            hardscape={hardscape}
            georeference={georeference}
            markers={markers}
            selectedMarkerId={selectedMarkerId}
            layerVisibility={layerVisibility}
            placementMode={placementMode}
            cloudOpacity={cloudOpacity}
          />
        </Suspense>
      </Canvas>

      {!dataReady && (
        <div className="city3d-loading">loading city layers…</div>
      )}

      <div className="city3d-attribution">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a> · Overture Maps Foundation
      </div>
    </div>
  );
}
