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
import { applyBenefits } from '../lib/ecology.js';

const GEOREF_STORAGE_KEY = 'grove-georeference';

function loadStoredGeoref() {
  try {
    const raw = localStorage.getItem(GEOREF_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isValidGeoref(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return ['ar', 'ai', 'tx', 'ty', 'anchorLng', 'anchorLat'].every(
    (k) => typeof obj[k] === 'number' && isFinite(obj[k]),
  );
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
  georeference: null,
  georeferenceStatus: 'loading', // 'loading' | 'ready' | 'absent'

  // ── City 3D cross-fade (0 = full city, 1 = full scanned cloud) ────────────
  cloudOpacity: 0,

  // ── Capture flow ────────────────────────────────────────────────────────────
  captureMarkerId: null,

  // ── Service field (Phase 5 ecological viz) ─────────────────────────────────
  serviceField: { visible: false, metric: 'carbonStoredLb' },
  summaryOpen: false,

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

  // ── Service field actions ──────────────────────────────────────────────────
  toggleServiceField: () =>
    set((s) => ({ serviceField: { ...s.serviceField, visible: !s.serviceField.visible } })),
  setServiceMetric: (metric) =>
    set((s) => ({ serviceField: { ...s.serviceField, metric } })),
  toggleSummary: () => set((s) => ({ summaryOpen: !s.summaryOpen })),

  // ── Capture actions ────────────────────────────────────────────────────────

  openCapture:  (markerId) => set({ captureMarkerId: markerId }),
  closeCapture: ()         => set({ captureMarkerId: null }),

  /**
   * Persist a completed characterization to store + Supabase.
   * Gracefully degrades if Supabase or Storage are unavailable.
   *
   * @param {string} markerId  The marker's local id (e.g. 'T-003')
   * @param {object} fields
   *   species, commonName, speciesConfidence, speciesSource,
   *   dbhIn, heightFt, crownSpreadFt, crownBaseFt, structureSource,
   *   captureJson, primaryImageFile (optional File object)
   */
  characterizeMarker: async (markerId, fields) => {
    const {
      species, commonName, speciesConfidence, speciesSource,
      dbhIn, heightFt, crownSpreadFt, crownBaseFt, structureSource,
      captureJson, primaryImageFile,
    } = fields;

    const dataStatus = (species && species !== 'Unknown' && dbhIn)
      ? 'verified'
      : (species && species !== 'Unknown') ? 'partial' : 'sample';

    // ── Optional photo upload to Supabase Storage ───────────────────────────
    let photoUrl = null;
    if (primaryImageFile) {
      try {
        const ext  = primaryImageFile.type === 'image/png' ? 'png' : 'jpg';
        const path = `${markerId}/${Date.now()}.${ext}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('tree-captures')
          .upload(path, primaryImageFile, { contentType: primaryImageFile.type, upsert: false });
        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage.from('tree-captures').getPublicUrl(uploadData.path);
          photoUrl = urlData?.publicUrl ?? null;
        }
      } catch {
        // Bucket not configured — continue without photo_url
      }
    }

    const captureWithPhoto = { ...captureJson, photoUrl };

    const supabaseFields = {
      common_name:          commonName,
      species,
      species_confidence:   speciesConfidence ?? null,
      species_source:       speciesSource ?? 'manual',
      dbh_in:               dbhIn   != null ? Number(dbhIn)   : null,
      height_ft:            heightFt != null ? Number(heightFt) : null,
      crown_spread_ft:      crownSpreadFt != null ? Number(crownSpreadFt) : null,
      crown_base_height_ft: crownBaseFt  != null ? Number(crownBaseFt)  : null,
      structure_source:     structureSource ?? 'manual',
      capture:              captureWithPhoto,
      photo_url:            photoUrl,
      data_status:          dataStatus,
      updated_at:           new Date().toISOString(),
    };

    const existingMarker = get().markers.find((m) => m.id === markerId);
    const supabaseId     = existingMarker?.marker_code ?? markerId;

    // Build updated marker and recompute benefits BEFORE the Supabase write
    const baseUpdate = {
      commonName,
      common_name: commonName,
      species,
      species_confidence:   speciesConfidence ?? null,
      species_source:       speciesSource ?? 'manual',
      dbh_in:               dbhIn   != null ? Number(dbhIn)   : null,
      height_ft:            heightFt != null ? Number(heightFt) : null,
      crown_spread_ft:      crownSpreadFt != null ? Number(crownSpreadFt) : null,
      crown_base_height_ft: crownBaseFt  != null ? Number(crownBaseFt)  : null,
      structure_source:     structureSource ?? 'manual',
      capture:              captureWithPhoto,
      photo_url:            photoUrl,
      data_status:          dataStatus,
      verified:             dataStatus === 'verified',
    };

    // Recompute ecological benefits with the new characterization data
    const updatedMarker = { ...(existingMarker ?? {}), ...baseUpdate };
    const withBenefits  = applyBenefits(updatedMarker);
    const storeUpdate   = { ...baseUpdate, ...withBenefits };

    // Single Supabase write — includes both characterization + recomputed benefit columns
    Object.assign(supabaseFields, {
      shade_sqft:            withBenefits.shadeSqft,
      annual_stormwater_gal: withBenefits.annualStormwaterGal,
      annual_carbon_lb:      withBenefits.annualCarbonLb,
      carbon_stored_lb:      withBenefits.carbonStoredLb,
      cooling_score:         withBenefits.coolingScore,
    });

    try {
      await supabase.from('tree_markers').update(supabaseFields).eq('marker_code', supabaseId);
    } catch (err) {
      console.warn('characterizeMarker: Supabase update failed', err);
    }

    set((state) => ({
      markers:         state.markers.map((m) => m.id === markerId ? storeUpdate : m),
      captureMarkerId: null,
    }));
  },

  loadGeoreference: async () => {
    // Dev: prefer localStorage so Solve & Save takes effect immediately
    if (import.meta.env.DEV) {
      const stored = loadStoredGeoref();
      if (isValidGeoref(stored)) {
        set({ georeference: stored, georeferenceStatus: 'ready' });
        return;
      }
    }
    // All envs: fetch the committed static asset
    try {
      const res = await fetch('/data/grove-georeference.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!isValidGeoref(json)) throw new Error('invalid shape');
      // Mirror into localStorage in dev so the calibrator picks it up
      if (import.meta.env.DEV) {
        try { localStorage.setItem(GEOREF_STORAGE_KEY, JSON.stringify(json)); } catch {}
      }
      set({ georeference: json, georeferenceStatus: 'ready' });
    } catch {
      set({ georeferenceStatus: 'absent' });
    }
  },

  setGeoreference: (georef) => {
    try {
      localStorage.setItem(GEOREF_STORAGE_KEY, JSON.stringify(georef));
    } catch {
      // storage may be unavailable
    }
    set({ georeference: georef, georeferenceStatus: 'ready' });
  },
}));

// Derived selectors (use these in components to avoid object churn)
export const selectSelectedMarker = (state) =>
  state.selectedMarkerId
    ? state.markers.find((m) => m.id === state.selectedMarkerId) ?? null
    : null;
