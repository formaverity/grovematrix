import { create } from 'zustand';
import { supabase } from '../lib/supabase.js';
import {
  normalizeMarker,
  normalizeSupabaseMarker,
  createMarker,
  getMarkerSequence,
  PLACEMENT_Y,
} from '../lib/markerHelpers.js';
import { worldToScene } from '../lib/geoTransform.js';

const GEOREF_STORAGE_KEY = 'grove-georeference';

function loadStoredGeoref() {
  try {
    const raw = localStorage.getItem(GEOREF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const useGroveStore = create((set, get) => ({
  // ── Markers ────────────────────────────────────────────────────────────────
  markers: [],
  selectedMarkerId: null,
  hoveredMarkerId: null,
  draggingId: null,

  // ── Mode ───────────────────────────────────────────────────────────────────
  placementMode: false,
  viewMode: 'pointcloud', // 'pointcloud' | 'city3d' | 'map2d'

  // ── Layer visibility (shared across 2D and 3D city modes) ──────────────────
  layerVisibility: { buildings: true, hardscape: true, greenspace: true },

  // ── Scene ──────────────────────────────────────────────────────────────────
  planViewRequest: null,

  // ── UI ─────────────────────────────────────────────────────────────────────
  drawerOpen: false,
  menuOpen: false,

  // ── Point cloud ────────────────────────────────────────────────────────────
  pointCloudLoaded: false,
  pointCloudError: null,

  // ── Georeference ───────────────────────────────────────────────────────────
  georeference: loadStoredGeoref(),

  // ── City 3D cross-fade (0 = full city, 1 = full scanned cloud) ────────────
  cloudOpacity: 0,

  // ── Marker actions ─────────────────────────────────────────────────────────

  fetchMarkers: async () => {
    const georef = get().georeference;
    try {
      const { data, error } = await supabase
        .from('tree_markers')
        .select('*')
        .order('marker_code', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        const markers = data.map((row) => normalizeSupabaseMarker(row, georef)).filter(Boolean);
        set({ markers });
        return;
      }

      // Fallback to JSON
      const res = await fetch('/data/tree-markers.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const markers = Array.isArray(json)
        ? json.map((m) => normalizeMarker(m)).filter(Boolean)
        : [];
      set({ markers });
    } catch (err) {
      console.warn('Unable to load markers:', err);
      set({ markers: [] });
    }
  },

  placeMarker: (position) => {
    const { markers, georeference } = get();
    const maxSeq = markers.reduce((m, mk) => Math.max(m, getMarkerSequence(mk.id)), 0);
    const marker = createMarker(maxSeq + 1, position, georeference);
    set((state) => ({
      markers: [...state.markers, marker],
      selectedMarkerId: marker.id,
    }));
  },

  updateMarker: (markerId, fields) => {
    set((state) => ({
      markers: state.markers.map((m) => (m.id === markerId ? { ...m, ...fields } : m)),
    }));
  },

  deleteMarker: (markerId) => {
    set((state) => ({
      markers: state.markers.filter((m) => m.id !== markerId),
      selectedMarkerId: state.selectedMarkerId === markerId ? null : state.selectedMarkerId,
      draggingId: state.draggingId === markerId ? null : state.draggingId,
    }));
  },

  setDraggingMarkerPosition: (markerId, x, z) => {
    set((state) => ({
      markers: state.markers.map((m) =>
        m.id === markerId
          ? { ...m, x, y: PLACEMENT_Y, z, position: [x, PLACEMENT_Y, z] }
          : m,
      ),
    }));
  },

  selectMarker: (marker) => set({ selectedMarkerId: marker?.id ?? null }),
  clearSelection: () => set({ selectedMarkerId: null }),
  setHoveredMarkerId: (id) => set({ hoveredMarkerId: id }),
  setDraggingId: (id) => set({ draggingId: id }),

  // ── Mode actions ───────────────────────────────────────────────────────────

  togglePlacement: () =>
    set((state) => ({
      placementMode: !state.placementMode,
      hoveredMarkerId: null,
      draggingId: null,
    })),

  setViewMode: (mode) => set({ viewMode: mode }),

  toggleLayerVisibility: (layer) =>
    set((state) => ({
      layerVisibility: {
        ...state.layerVisibility,
        [layer]: !state.layerVisibility[layer],
      },
    })),

  // Place a marker from world coords (used by Map2DView). Converts to scene
  // coords via worldToScene so the pointcloud mode stays in sync.
  placeMarkerAtWorld: (lng, lat) => {
    const { markers, georeference } = get();
    if (!georeference) return;
    const { x, z } = worldToScene(lng, lat, georeference);
    const maxSeq = markers.reduce((m, mk) => Math.max(m, getMarkerSequence(mk.id)), 0);
    const marker = createMarker(maxSeq + 1, [x, PLACEMENT_Y, z], georeference);
    // Use the exact input coords to avoid double-conversion drift
    marker.lng = lng;
    marker.lat = lat;
    set((state) => ({
      markers: [...state.markers, marker],
      selectedMarkerId: marker.id,
    }));
  },

  // ── Scene actions ──────────────────────────────────────────────────────────

  requestPlanView: (position) =>
    set({ planViewRequest: { id: performance.now(), position } }),

  // ── UI actions ─────────────────────────────────────────────────────────────

  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  toggleMenu: () => set((state) => ({ menuOpen: !state.menuOpen })),

  // ── Point cloud actions ────────────────────────────────────────────────────

  setPointCloudLoaded: () => set({ pointCloudLoaded: true }),
  setPointCloudError: (error) => set({ pointCloudError: error }),

  // ── Georeference actions ───────────────────────────────────────────────────

  setCloudOpacity: (v) => set({ cloudOpacity: Math.max(0, Math.min(1, v)) }),

  setGeoreference: (georef) => {
    try {
      localStorage.setItem(GEOREF_STORAGE_KEY, JSON.stringify(georef));
    } catch {
      // storage may be unavailable
    }
    set({ georeference: georef });
  },
}));

// Derived selectors (use these in components to avoid object churn)
export const selectSelectedMarker = (state) =>
  state.selectedMarkerId
    ? state.markers.find((m) => m.id === state.selectedMarkerId) ?? null
    : null;
