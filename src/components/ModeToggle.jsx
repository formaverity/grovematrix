import React from 'react';
import { useGroveStore } from '../store/useGroveStore.js';

const MODES = [
  { key: 'pointcloud', label: 'Point Cloud' },
  { key: 'map2d', label: '2D Map' },
  { key: 'city3d', label: '3D City' },
];

export function ModeToggle() {
  const viewMode = useGroveStore((s) => s.viewMode);
  const setViewMode = useGroveStore((s) => s.setViewMode);

  return (
    <div className="mode-toggle">
      {MODES.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`mode-toggle-btn${viewMode === key ? ' is-active' : ''}`}
          onClick={() => setViewMode(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
