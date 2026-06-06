import React, { useMemo } from 'react';
import * as Plot from '@observablehq/plot';
import { useGroveStore } from '../../store/useGroveStore.js';
import { computeBenefits, METRIC_LABELS, TIER_LABELS } from '../../lib/ecology.js';
import { PlotFigure } from '../charts/PlotFigure.jsx';
import { C, TIER_FILL, theme } from '../charts/plotTheme.js';

const METRICS = Object.keys(METRIC_LABELS);

function fmt(n, unit) {
  if (!n || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M ${unit}`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} k ${unit}`;
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

function fmtK(n) {
  if (n == null || n === 0) return '';
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// ── Aggregate helpers ─────────────────────────────────────────────────────────

function aggregate(markers) {
  const totals    = { carbonStoredLb: 0, annualCarbonLb: 0, annualStormwaterGal: 0, shadeSqft: 0, coolingScore: 0 };
  const byTier    = {
    verified: { count: 0, carbonStoredLb: 0 },
    partial:  { count: 0, carbonStoredLb: 0 },
    sample:   { count: 0, carbonStoredLb: 0 },
  };
  const bySpecies = {};
  const dbhData    = [];
  const scatterData = [];

  for (const m of markers) {
    const b = computeBenefits(m);
    for (const k of METRICS) {
      if (k !== 'coolingScore') totals[k] += b.metrics[k] ?? 0;
    }
    totals.coolingScore = Math.max(totals.coolingScore, b.metrics.coolingScore ?? 0);

    byTier[b.tier].count++;
    byTier[b.tier].carbonStoredLb += b.metrics.carbonStoredLb ?? 0;

    const sp = (m.species && m.species !== 'Unknown') ? m.species : '(unidentified)';
    if (!bySpecies[sp]) bySpecies[sp] = { count: 0, carbonStoredLb: 0 };
    bySpecies[sp].count++;
    bySpecies[sp].carbonStoredLb += b.metrics.carbonStoredLb ?? 0;

    const dbh = m.dbhIn ?? m.dbh_in;
    if (dbh != null && dbh > 0) {
      dbhData.push({ dbh: Number(dbh) });
      scatterData.push({ dbh: Number(dbh), carbon: b.metrics.carbonStoredLb, tier: b.tier });
    }
  }

  const speciesRanked = Object.entries(bySpecies)
    .sort((a, b) => b[1].carbonStoredLb - a[1].carbonStoredLb)
    .slice(0, 8);

  return { totals, byTier, speciesRanked, total: markers.length, dbhData, scatterData };
}

// ── Chart spec builders ───────────────────────────────────────────────────────

function makeTierSpec(byTier, total) {
  return (width) => {
    const rows = ['verified', 'partial', 'sample']
      .map((t) => ({ tier: t, carbon: byTier[t].carbonStoredLb, count: byTier[t].count }))
      .filter((d) => d.carbon > 0);

    if (!rows.length) return { ...theme(), width, height: 20, marks: [] };

    return {
      ...theme(),
      width,
      height: 42,
      marginLeft: 4, marginRight: 4, marginTop: 6, marginBottom: 6,
      x: { label: null, axis: null },
      y: { label: null, axis: null },
      color: {
        domain: ['verified', 'partial', 'sample'],
        range: [TIER_FILL.verified, TIER_FILL.partial, TIER_FILL.sample],
      },
      marks: [
        Plot.barX(rows, Plot.stackX({ x: 'carbon', y: () => '', fill: 'tier', fillOpacity: 0.85 })),
      ],
    };
  };
}

function makeDbhSpec(dbhData) {
  return (width) => ({
    ...theme(),
    width,
    height: 80,
    marginLeft: 28, marginRight: 8, marginTop: 4, marginBottom: 22,
    x: { label: 'DBH (in)', labelOffset: 30, ticks: 5 },
    y: { label: null, ticks: 2 },
    marks: [
      Plot.rectY(dbhData, Plot.binX({ y: 'count' }, {
        x: 'dbh',
        fill: C.lichen,
        fillOpacity: 0.75,
        thresholds: 10,
      })),
      Plot.ruleY([0], { stroke: C.rule }),
    ],
  });
}

function makeSpeciesSpec(speciesRanked) {
  return (width) => {
    const rows = speciesRanked
      .map(([sp, d]) => ({
        species: sp.length > 22 ? `${sp.slice(0, 21)}…` : sp,
        carbon: d.carbonStoredLb,
        count: d.count,
      }));

    if (!rows.length) return { ...theme(), width, height: 20, marks: [] };

    return {
      ...theme(),
      width,
      height: rows.length * 18 + 24,
      marginLeft: 100, marginRight: 44, marginTop: 4, marginBottom: 6,
      x: { label: null, ticks: 2, tickFormat: fmtK, axis: 'top' },
      y: { label: null, tickSize: 0 },
      marks: [
        Plot.barX(rows, {
          y: 'species',
          x: 'carbon',
          fill: C.lichen,
          fillOpacity: 0.72,
          sort: { y: 'x' },
        }),
        Plot.text(rows, {
          y: 'species',
          x: 'carbon',
          text: (d) => `${fmtK(d.carbon)} lb`,
          dx: 4,
          textAnchor: 'start',
          fontSize: 8,
          fill: C.flesh,
          fillOpacity: 0.65,
        }),
        Plot.ruleX([0], { stroke: C.rule }),
      ],
    };
  };
}

function makeScatterSpec(scatterData) {
  return (width) => ({
    ...theme(),
    width,
    height: 120,
    marginLeft: 38, marginRight: 10, marginTop: 6, marginBottom: 24,
    x: { label: 'DBH (in)', labelOffset: 30, ticks: 4 },
    y: { label: 'C stored (lb)', labelOffset: 34, ticks: 3 },
    color: {
      domain: ['verified', 'partial', 'sample'],
      range: [TIER_FILL.verified, TIER_FILL.partial, TIER_FILL.sample],
    },
    marks: [
      Plot.dot(scatterData, {
        x: 'dbh',
        y: 'carbon',
        fill: 'tier',
        r: 2.5,
        fillOpacity: 0.65,
      }),
      ...(scatterData.length >= 5 ? [
        Plot.linearRegressionY(scatterData, {
          x: 'dbh',
          y: 'carbon',
          stroke: C.glow,
          strokeWidth: 1.5,
          strokeOpacity: 0.7,
        }),
      ] : []),
    ],
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BenefitsSummary() {
  const markers       = useGroveStore((s) => s.markers);
  const summaryOpen   = useGroveStore((s) => s.summaryOpen);
  const toggleSummary = useGroveStore((s) => s.toggleSummary);

  const agg = useMemo(() => aggregate(markers), [markers]);
  const { totals, byTier, speciesRanked, total, dbhData, scatterData } = agg;

  const verifiedPct = total ? Math.round((byTier.verified.count / total) * 100) : 0;
  const partialPct  = total ? Math.round((byTier.partial.count  / total) * 100) : 0;

  const makeTier    = useMemo(() => makeTierSpec(byTier, total),    [byTier, total]);
  const makeDbh     = useMemo(() => makeDbhSpec(dbhData),            [dbhData]);
  const makeSpecies = useMemo(() => makeSpeciesSpec(speciesRanked),  [speciesRanked]);
  const makeScatter = useMemo(() => makeScatterSpec(scatterData),    [scatterData]);

  if (!summaryOpen) return null;

  return (
    <div className="benefits-panel" role="dialog" aria-label="Benefits Summary">
      <div className="benefits-header">
        <span className="benefits-title">Matrix Benefits</span>
        <span className="benefits-subtitle">{total} trees · estimates</span>
        <button type="button" className="benefits-close" onClick={toggleSummary} aria-label="Close">×</button>
      </div>

      {/* Matrix totals */}
      <div className="benefits-section">
        <div className="benefits-grid">
          {[
            { k: 'carbonStoredLb',      ...METRIC_LABELS.carbonStoredLb },
            { k: 'annualCarbonLb',      ...METRIC_LABELS.annualCarbonLb },
            { k: 'annualStormwaterGal', ...METRIC_LABELS.annualStormwaterGal },
            { k: 'shadeSqft',           ...METRIC_LABELS.shadeSqft },
          ].map(({ k, label, unit }) => (
            <div key={k} className="benefits-metric">
              <span className="benefits-value">{fmt(totals[k], unit)}</span>
              <span className="benefits-label">~{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data completeness — tier-stacked carbon chart */}
      <div className="benefits-section">
        <div className="benefits-section-title">Data completeness</div>
        <PlotFigure makeSpec={makeTier} className="benefits-chart" />
        <div className="benefits-tier-legend">
          {(['verified', 'partial', 'sample']).map((t) => (
            <span key={t} className="benefits-tier-chip" data-tier={t}>
              <span className="benefits-tier-dot" style={{ background: TIER_FILL[t] }} />
              {t} · {byTier[t].count}
            </span>
          ))}
        </div>
        {verifiedPct < 30 && (
          <p className="benefits-completeness-note">
            {100 - verifiedPct - partialPct}% of totals rest on canopy-only proxies.
            Characterize more trees to improve accuracy.
          </p>
        )}
      </div>

      {/* Species composition */}
      {speciesRanked.length > 0 && (
        <div className="benefits-section">
          <div className="benefits-section-title">Top species (carbon stored)</div>
          <PlotFigure makeSpec={makeSpecies} className="benefits-chart" />
        </div>
      )}

      {/* DBH distribution */}
      {dbhData.length >= 3 && (
        <div className="benefits-section">
          <div className="benefits-section-title">DBH distribution</div>
          <PlotFigure makeSpec={makeDbh} className="benefits-chart" />
        </div>
      )}

      {/* DBH ↔ carbon scatter */}
      {scatterData.length >= 5 && (
        <div className="benefits-section">
          <div className="benefits-section-title">DBH ↔ carbon (allometric)</div>
          <PlotFigure makeSpec={makeScatter} className="benefits-chart" />
        </div>
      )}

      <p className="benefits-disclaimer">
        ~&nbsp;All values are estimates. Sources: Jenkins et al. 2003, UFORE/i-Tree Eco regional averages.
        Edit <code>src/data/species-coefficients.json</code> to refine.
      </p>
    </div>
  );
}
