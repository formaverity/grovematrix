import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useGroveStore, selectSelectedMarker } from '../../store/useGroveStore.js';
import { getLayer } from '../../lib/cityData.js';

// ── Blank dark basemap ────────────────────────────────────────────────────────
// No external tile provider — the three Overture GeoJSON sources are the map.

const BLANK_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0E1A14' } }],
};

// ── Palette (matches CSS vars) ────────────────────────────────────────────────

const C = {
  greenFill:      'rgba(111, 143, 114, 0.28)',
  greenOutline:   'rgba(111, 143, 114, 0.5)',
  buildingFill:   'rgba(26,  42,  30,  0.85)',
  buildingOutline:'rgba(214, 210, 196, 0.12)',
  roadColor:      'rgba(214, 210, 196, 0.42)',
  hardscapeFill:  'rgba(42,  58,  46,  0.55)',
  markerDefault:  '#6F8F72',
  markerSelected: '#7CFFB2',
  markerHover:    '#CCFF70',
};

// ── MapLibre layer groups and IDs ─────────────────────────────────────────────

const LAYER_GROUPS = {
  greenspace: ['greenspace-fill', 'greenspace-outline'],
  buildings:  ['buildings-fill', 'buildings-outline'],
  hardscape:  ['hardscape-line', 'hardscape-fill'],
};

// ── GeoJSON helpers ───────────────────────────────────────────────────────────

function buildMarkersGeoJSON(markers, selectedMarkerId) {
  return {
    type: 'FeatureCollection',
    features: markers
      .filter((m) => m.lng != null && m.lat != null)
      .map((m) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: {
          id: m.id,
          label: m.commonName ?? m.id,
          selected: m.id === selectedMarkerId,
        },
      })),
  };
}

// ── Add all map layers (called once after map loads) ──────────────────────────

function addLayers(map, layerVisibility) {
  // Greenspace
  map.addLayer({
    id: 'greenspace-fill',
    type: 'fill',
    source: 'greenspace',
    paint: { 'fill-color': C.greenFill },
    layout: { visibility: layerVisibility.greenspace ? 'visible' : 'none' },
  });
  map.addLayer({
    id: 'greenspace-outline',
    type: 'line',
    source: 'greenspace',
    paint: { 'line-color': C.greenOutline, 'line-width': 0.6 },
    layout: { visibility: layerVisibility.greenspace ? 'visible' : 'none' },
  });

  // Buildings
  map.addLayer({
    id: 'buildings-fill',
    type: 'fill',
    source: 'buildings',
    paint: { 'fill-color': C.buildingFill },
    layout: { visibility: layerVisibility.buildings ? 'visible' : 'none' },
  });
  map.addLayer({
    id: 'buildings-outline',
    type: 'line',
    source: 'buildings',
    paint: { 'line-color': C.buildingOutline, 'line-width': 0.8 },
    layout: { visibility: layerVisibility.buildings ? 'visible' : 'none' },
  });

  // Hardscape polygon fills (parking, pedestrian plazas)
  map.addLayer({
    id: 'hardscape-fill',
    type: 'fill',
    source: 'hardscape',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': C.hardscapeFill },
    layout: { visibility: layerVisibility.hardscape ? 'visible' : 'none' },
  });

  // Hardscape road lines — width ramped by class and zoom
  map.addLayer({
    id: 'hardscape-line',
    type: 'line',
    source: 'hardscape',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': C.roadColor,
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        12, ['match', ['get', 'class'],
          ['motorway', 'trunk'],                   4,
          ['primary', 'secondary', 'tertiary'],    2.5,
          ['residential', 'unclassified', 'service', 'living_street'], 1.5,
          0.6,
        ],
        17, ['match', ['get', 'class'],
          ['motorway', 'trunk'],                   14,
          ['primary', 'secondary', 'tertiary'],    9,
          ['residential', 'unclassified', 'service', 'living_street'],  5,
          2,
        ],
      ],
      'line-cap': 'round',
      'line-join': 'round',
    },
    layout: { visibility: layerVisibility.hardscape ? 'visible' : 'none' },
  });

  // Markers — unselected
  map.addLayer({
    id: 'markers-circle',
    type: 'circle',
    source: 'markers',
    filter: ['==', ['get', 'selected'], false],
    paint: {
      'circle-color': C.markerDefault,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 9],
      'circle-stroke-color': '#0E1A14',
      'circle-stroke-width': 1,
      'circle-opacity': 0.88,
    },
  });

  // Markers — selected (rendered on top)
  map.addLayer({
    id: 'markers-selected',
    type: 'circle',
    source: 'markers',
    filter: ['==', ['get', 'selected'], true],
    paint: {
      'circle-color': C.markerSelected,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 6, 17, 13],
      'circle-stroke-color': '#0E1A14',
      'circle-stroke-width': 1.5,
      'circle-opacity': 1,
    },
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Map2DView() {
  const georeference     = useGroveStore((s) => s.georeference);
  const markers          = useGroveStore((s) => s.markers);
  const selectedMarkerId = useGroveStore((s) => s.selectedMarkerId);
  const placementMode    = useGroveStore((s) => s.placementMode);
  const layerVisibility  = useGroveStore((s) => s.layerVisibility);

  const selectMarker       = useGroveStore((s) => s.selectMarker);
  const clearSelection     = useGroveStore((s) => s.clearSelection);
  const placeMarkerAtWorld = useGroveStore((s) => s.placeMarkerAtWorld);

  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const [mapReady, setMapReady]     = useState(false);
  const [etlMissing, setEtlMissing] = useState(false);

  // ── Init MapLibre ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BLANK_STYLE,
      center: [georeference?.anchorLng ?? -74.0121, georeference?.anchorLat ?? 40.2204],
      zoom: 15,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', async () => {
      // Load all three layers (graceful empty if ETL not yet run)
      const [buildings, greenspace, hardscape] = await Promise.all([
        getLayer('buildings'),
        getLayer('greenspace'),
        getLayer('hardscape'),
      ]);

      const hasData =
        buildings.features.length > 0 ||
        greenspace.features.length > 0 ||
        hardscape.features.length > 0;

      setEtlMissing(!hasData);

      map.addSource('buildings',  { type: 'geojson', data: buildings });
      map.addSource('greenspace', { type: 'geojson', data: greenspace });
      map.addSource('hardscape',  { type: 'geojson', data: hardscape });
      map.addSource('markers', {
        type: 'geojson',
        data: buildMarkersGeoJSON(
          useGroveStore.getState().markers,
          useGroveStore.getState().selectedMarkerId,
        ),
      });

      const { layerVisibility: lv } = useGroveStore.getState();
      addLayers(map, lv);

      // Fit to marker extent on first load
      const geoMarkers = useGroveStore.getState().markers.filter(
        (m) => m.lng != null && m.lat != null,
      );
      if (geoMarkers.length > 0) {
        const lngs = geoMarkers.map((m) => m.lng);
        const lats  = geoMarkers.map((m) => m.lat);
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, duration: 800 },
        );
      }

      setMapReady(true);
    });

    // ── Click: marker selection or placement ────────────────────────────────

    map.on('click', 'markers-circle', (e) => {
      e.preventDefault();
      const id = e.features?.[0]?.properties?.id;
      if (!id) return;
      const mk = useGroveStore.getState().markers.find((m) => m.id === id);
      if (mk) selectMarker(mk);
    });

    map.on('click', 'markers-selected', (e) => {
      e.preventDefault();
      const id = e.features?.[0]?.properties?.id;
      if (!id) return;
      const mk = useGroveStore.getState().markers.find((m) => m.id === id);
      if (mk) selectMarker(mk);
    });

    map.on('click', (e) => {
      // Only fire if the click wasn't consumed by a marker layer
      if (e.defaultPrevented) return;
      const { placementMode: pm, placeMarkerAtWorld: place, clearSelection: clear } =
        useGroveStore.getState();
      if (pm) {
        place(e.lngLat.lng, e.lngLat.lat);
      } else {
        clear();
      }
    });

    // ── Cursor ──────────────────────────────────────────────────────────────

    map.on('mouseenter', 'markers-circle',   () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseenter', 'markers-selected', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'markers-circle',   () => {
      const { placementMode: pm } = useGroveStore.getState();
      map.getCanvas().style.cursor = pm ? 'crosshair' : '';
    });
    map.on('mouseleave', 'markers-selected', () => {
      const { placementMode: pm } = useGroveStore.getState();
      map.getCanvas().style.cursor = pm ? 'crosshair' : '';
    });

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync placement cursor ───────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.getCanvas().style.cursor = placementMode ? 'crosshair' : '';
  }, [placementMode, mapReady]);

  // ── Sync layer visibility ───────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    Object.entries(LAYER_GROUPS).forEach(([group, ids]) => {
      const vis = layerVisibility[group] ? 'visible' : 'none';
      ids.forEach((id) => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      });
    });
  }, [layerVisibility, mapReady]);

  // ── Sync markers source ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const source = mapRef.current.getSource('markers');
    source?.setData(buildMarkersGeoJSON(markers, selectedMarkerId));
  }, [markers, selectedMarkerId, mapReady]);

  // ── No georeference guard ───────────────────────────────────────────────────

  if (!georeference) {
    return (
      <div className="map2d-container map2d-no-georef">
        <div className="map2d-notice">
          <p className="map2d-notice-title">No georeference</p>
          <p className="map2d-notice-body">
            Open <a href="/?calibrate">/?calibrate</a> to add GCPs, solve, and save
            a transform before using the 2D map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="map2d-container">
      <div ref={mapContainerRef} className="map2d-map" />

      {etlMissing && (
        <div className="map2d-etl-banner">
          No city layers yet — run the Overture ETL to add buildings, roads &amp; greenspace:
          <code> node scripts/derive-bbox.js </code>→
          <code> node scripts/fetch-overture.js </code>→
          <code> node scripts/classify-overture.js</code>
        </div>
      )}

      <div className="map2d-attribution">
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap contributors
        </a>{' '}
        · Overture Maps Foundation
      </div>
    </div>
  );
}
