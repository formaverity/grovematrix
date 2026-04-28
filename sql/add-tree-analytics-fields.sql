-- Add analytics fields to tree_markers table for i-Tree-style environmental benefits
-- These are placeholder fields that will be populated with calibrated values later

alter table public.tree_markers
add column if not exists annual_stormwater_gal numeric,
add column if not exists annual_carbon_lb numeric,
add column if not exists carbon_stored_lb numeric,
add column if not exists cooling_score numeric,
add column if not exists shade_sqft numeric,
add column if not exists dbh_in numeric,
add column if not exists height_ft numeric,
add column if not exists planted_year integer,
add column if not exists health_notes text,
add column if not exists data_status text default 'sample';

-- Add helpful comments for future reference
comment on column public.tree_markers.annual_stormwater_gal is
'Placeholder annual stormwater interception estimate. Replace with calibrated i-Tree or field-derived value later.';

comment on column public.tree_markers.annual_carbon_lb is
'Placeholder annual carbon sequestration estimate. Replace with calibrated i-Tree or field-derived value later.';

comment on column public.tree_markers.carbon_stored_lb is
'Placeholder carbon storage estimate. Replace with calibrated i-Tree or field-derived value later.';

comment on column public.tree_markers.cooling_score is
'Prototype relative cooling influence score from 0-100. Not field verified.';

comment on column public.tree_markers.shade_sqft is
'Placeholder shade footprint estimate. Replace with calibrated i-Tree or field-derived value later.';

comment on column public.tree_markers.dbh_in is
'Diameter at breast height in inches. For future i-Tree integration.';

comment on column public.tree_markers.height_ft is
'Tree height in feet. For future i-Tree integration.';

comment on column public.tree_markers.planted_year is
'Year the tree was planted. For growth and carbon calculations.';

comment on column public.tree_markers.health_notes is
'Field observations about tree health and condition.';

comment on column public.tree_markers.data_status is
'Data quality status: sample (placeholder), partial (some field data), verified (complete field verification).';

-- Optional: Create an index on marker_code for better query performance
create index if not exists idx_tree_markers_marker_code on public.tree_markers(marker_code);

-- Optional: Create an index on verified status for filtering
create index if not exists idx_tree_markers_verified on public.tree_markers(verified);