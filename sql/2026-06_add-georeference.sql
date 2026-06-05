-- ============================================================
-- Migration: add georeferencing columns to tree_markers
--            and create grove_georeference config table
--
-- Run manually via Supabase SQL editor or psql.
-- Do NOT run automatically — review before applying.
-- ============================================================

-- 1. Add WGS84 coordinate columns to tree_markers
alter table public.tree_markers
  add column if not exists lng numeric,
  add column if not exists lat numeric,
  add column if not exists geo_source text default 'derived';

comment on column public.tree_markers.lng is
  'WGS84 longitude. Canonical world position derived from scene {x,z} via the active grove_georeference transform.';

comment on column public.tree_markers.lat is
  'WGS84 latitude. Canonical world position derived from scene {x,z} via the active grove_georeference transform.';

comment on column public.tree_markers.geo_source is
  'Provenance of the lng/lat value: derived (computed from scene coords), gcp (snapped to a GCP), field (GPS-measured).';

-- Index for spatial queries once Phase 3 Overture layers land
create index if not exists idx_tree_markers_lng_lat
  on public.tree_markers (lng, lat)
  where lng is not null and lat is not null;

-- 2. Georeference config table (single active row per project)
create table if not exists public.grove_georeference (
  id           uuid primary key default gen_random_uuid(),
  is_active    boolean not null default true,

  -- Similarity transform params (complex-number form: east+i*north = (ar+i*ai)*(x+i*z) + (tx+i*ty))
  ar           double precision not null,  -- real part of complex scale+rotation
  ai           double precision not null,  -- imaginary part
  tx           double precision not null,  -- ENU east translation (metres)
  ty           double precision not null,  -- ENU north translation (metres)

  -- Derived for readability
  scale        double precision,
  angle_rad    double precision,

  -- ENU anchor (equirectangular origin)
  anchor_lng   double precision not null,
  anchor_lat   double precision not null,

  -- Calibration quality
  rms_m        double precision,
  gcp_json     jsonb,  -- array of {scene:{x,z}, world:{lng,lat}} pairs

  created_at   timestamptz not null default now(),
  solved_at    timestamptz
);

comment on table public.grove_georeference is
  'Stores the active 2D similarity transform between scene space and WGS84. '
  'Solved by the Calibrator panel from N≥2 ground-control-point pairs. '
  'Single active row; deactivate old rows before inserting a new solve.';

-- Only one active row allowed (partial unique index)
create unique index if not exists idx_grove_georeference_active
  on public.grove_georeference (is_active)
  where is_active = true;
