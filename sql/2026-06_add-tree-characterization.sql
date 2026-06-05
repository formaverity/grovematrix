-- ============================================================
-- Migration: add Phase 4 tagging / characterization columns
--            to tree_markers so no second migration is needed
--            when AI-assisted tagging lands.
--
-- Run manually via Supabase SQL editor or psql.
-- Do NOT run automatically — review before applying.
-- These columns are intentionally empty until Phase 4.
-- ============================================================

alter table public.tree_markers
  -- Structural inputs for env-services math (Phase 5)
  add column if not exists crown_base_height_ft  numeric,
  add column if not exists crown_spread_ft        numeric,

  -- Species provenance + editable-AI pattern
  add column if not exists species_confidence     numeric,   -- 0-1, confidence of species field
  add column if not exists species_source         text default 'manual',
  --   values: 'manual' | 'ai' | 'g2tree'

  -- Structural-field provenance
  add column if not exists structure_source       text default 'manual',
  --   values: 'manual' | 'ai' | 'g2tree'

  -- G2Tree capture package (imported g2tree/v1 JSON blob)
  add column if not exists capture                jsonb,

  -- Photo reference
  add column if not exists photo_url              text;

comment on column public.tree_markers.crown_base_height_ft is
  'Height to base of live crown in feet. Primary structural input for i-Tree-style env-services math.';

comment on column public.tree_markers.crown_spread_ft is
  'Crown width (diameter, not radius) in feet. Used as i-Tree crown spread input.';

comment on column public.tree_markers.species_confidence is
  'Confidence score (0-1) for the species field. 1.0 = field-verified, <0.9 = AI-estimated.';

comment on column public.tree_markers.species_source is
  'How the species field was populated: manual (human entry), ai (model inference), g2tree (imported G2Tree package).';

comment on column public.tree_markers.structure_source is
  'How structural fields (dbh_in, height_ft, crown_spread_ft, etc.) were populated.';

comment on column public.tree_markers.capture is
  'Imported G2Tree g2tree/v1 capture package. Contains species candidates, structural skeleton, '
  'photo refs, and confidence scores. Editable — any field may be overridden by the user.';

comment on column public.tree_markers.photo_url is
  'Primary photo URL for this tree point. May be a Supabase Storage URL or external reference.';

-- Update data_status check to clarify usage with characterization:
--   sample    = placeholder coords only, no field data
--   partial   = some field data (species, condition) but not fully characterized
--   verified  = complete field + structural characterization; feeds env-services with real inputs
comment on column public.tree_markers.data_status is
  'Data quality status: '
  'sample (placeholder point, requires field verification), '
  'partial (some field data collected), '
  'verified (fully characterized — species, structural params, field-confirmed).';
