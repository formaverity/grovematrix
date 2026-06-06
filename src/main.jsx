import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';
import maplibregl from 'maplibre-gl';
import MaplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-csp-worker?url';

// Vite's Rollup bundler breaks MapLibre's inline blob-URL worker in production.
// Explicitly point MapLibre at the separate CSP worker file so Vite bundles it
// as a standalone asset with a correct URL.
maplibregl.setWorkerUrl(MaplibreWorkerUrl);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
