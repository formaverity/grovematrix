import React, { useMemo } from 'react';
import { useGroveStore } from '../../store/useGroveStore.js';
import { computeBenefits, METRIC_LABELS, TIER_LABELS } from '../../lib/ecology.js';

const METRICS = Object.keys(METRIC_LABELS);

function fmt(n, unit) {
  if (!n || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M ${unit}`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)} k ${unit}`;
  return `${Math.round(n).toLocaleString()} ${unit}`;
}

// ── Aggregate helpers ─────────────────────────────────────────────────────────

function aggregate(markers) {
  const totals = { carbonStoredLb: 0, annualCarbonLb: 0, annualStormwaterGal: 0, shadeSqft: 0, coolingScore: 0 };
  const byTier  = { verified: { count: 0, carbonStoredLb: 0 }, partial: { count: 0, carbonStoredLb: 0 }, sample: { count: 0, carbonStoredLb: 0 } };
  const bySpecies = {};

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
  }

  const speciesRanked = Object.entries(bySpecies)
    .sort((a, b) => b[1].carbonStoredLb - a[1].carbonStoredLb)
    .slice(0, 6);

  return { totals, byTier, speciesRanked, total: markers.length };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BenefitsSummary() {
  const markers     = useGroveStore((s) => s.markers);
  const summaryOpen = useGroveStore((s) => s.summaryOpen);
  const toggleSummary = useGroveStore((s) => s.toggleSummary);

  const { totals, byTier, speciesRanked, total } = useMemo(
    () => aggregate(markers),
    [markers],
  );

  if (!summaryOpen) return null;

  const verifiedPct = total ? Math.round((byTier.verified.count / total) * 100) : 0;
  const partialPct  = total ? Math.round((byTier.partial.count  / total) * 100) : 0;

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

      {/* By tier — data completeness story */}
      <div className="benefits-section">
        <div className="benefits-section-title">Data completeness</div>
        <div className="benefits-tier-bars">
          {(['verified', 'partial', 'sample'] ).map((tier) => {
            const pct = total ? Math.round((byTier[tier].count / total) * 100) : 0;
            return (
              <div key={tier} className="benefits-tier-row">
                <span className={`benefits-tier-badge tier-${tier}`}>{tier}</span>
                <div className="benefits-tier-bar-track">
                  <div className={`benefits-tier-bar-fill tier-fill-${tier}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="benefits-tier-count">{byTier[tier].count} ({pct}%)</span>
              </div>
            );
          })}
        </div>
        {verifiedPct < 30 && (
          <p className="benefits-completeness-note">
            {100 - verifiedPct - partialPct}% of totals rest on canopy-only proxies.
            Characterize more trees to improve accuracy.
          </p>
        )}
      </div>

      {/* Per-species */}
      {speciesRanked.length > 0 && (
        <div className="benefits-section">
          <div className="benefits-section-title">Top species (carbon stored)</div>
          <div className="benefits-species-list">
            {speciesRanked.map(([sp, d]) => (
              <div key={sp} className="benefits-species-row">
                <span className="benefits-species-name"><em>{sp}</em></span>
                <span className="benefits-species-count">{d.count} trees</span>
                <span className="benefits-species-val">{fmt(d.carbonStoredLb, 'lb C')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="benefits-disclaimer">
        ~&nbsp;All values are estimates. Sources: Jenkins et al. 2003, UFORE/i-Tree Eco regional averages.
        Edit <code>src/data/species-coefficients.json</code> to refine.
      </p>
    </div>
  );
}
