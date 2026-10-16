/* globe.js — MapLibre 3D globe: CDN loading with fallback, basemaps, starfield,
   auto-rotation, fly-to and 2D (mercator) fallback. No API keys. */

export const MAPLIBRE_VERSION = '5.24.0';
const CDNS = [
  `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist`,
  `https://cdn.jsdelivr.net/npm/maplibre-gl@${MAPLIBRE_VERSION}/dist`,
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(s);
  });
}

/** Resolve once window.maplibregl exists; retry from a second CDN if the first failed. */
export async function ensureMapLibre() {
  if (window.maplibregl) return window.maplibregl;
  // The deferred <script> in index.html may still be in flight; wait briefly.
  for (let i = 0; i < 20 && !window.maplibregl; i++) await new Promise(r => setTimeout(r, 100));
  if (window.maplibregl) return window.maplibregl;
  for (const base of CDNS.slice(1)) {
    try {
      const css = document.getElementById('maplibre-css');
      if (css) css.href = `${base}/maplibre-gl.css`;
      await loadScript(`${base}/maplibre-gl.js`);
      if (window.maplibregl) return window.maplibregl;
    } catch (e) { console.warn(e.message); }
  }
  throw new Error('MapLibre GL JS could not be loaded from any CDN.');
}

/** Free, key-less raster basemaps. Attribution is shown in the map's attribution control. */
export const BASEMAPS = {
  streets: {
    label: 'Map',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    maxzoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
  },
  satellite: {
    label: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 18,
    attribution: 'Imagery © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics &amp; the GIS User Community',
  },
};

export function baseStyle(active = 'satellite') {
  const sources = {}; const layers = [
    { id: 'space-bg', type: 'background', paint: { 'background-color': '#0b1a2b' } },
  ];
  for (const [key, b] of Object.entries(BASEMAPS)) {
    sources[`base-${key}`] = { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution };
    layers.push({ id: `base-${key}`, type: 'raster', source: `base-${key}`, layout: { visibility: key === active ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 150 } });
  }
  return { version: 8, sources, layers };
}

export function setBasemap(map, which) {
  for (const key of Object.keys(BASEMAPS)) {
    const id = `base-${key}`;
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', key === which ? 'visible' : 'none');
  }
}

/** Draw a static starfield on a canvas that sits behind the (transparent) map canvas. */
export function drawStarfield(canvas) {
  if (!canvas) return;
  const draw = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const g = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g.addColorStop(0, '#0b1830'); g.addColorStop(1, '#02040a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = Math.round((w * h) / 1400);
    for (let i = 0; i < n; i++) {
      const r = rnd() < 0.92 ? rnd() * 0.9 + 0.2 : rnd() * 1.3 + 0.9;
      ctx.globalAlpha = 0.35 + rnd() * 0.65;
      ctx.fillStyle = rnd() < 0.15 ? '#cfe3ff' : '#ffffff';
      ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  draw();
  let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
}

/** Apply projection; fall back to mercator if globe is unsupported. Returns the projection in use. */
export function applyProjection(map, type) {
  try {
    map.setProjection({ type });
    if (type === 'globe' && map.setSky) {
      map.setSky({
        'sky-color': '#0b1a2b', 'horizon-color': '#3d7bd6', 'fog-color': '#a9c9ff',
        'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.9,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
      });
    }
    document.body.dataset.projection = type;
    return type;
  } catch (e) {
    console.warn('Globe projection unavailable, using flat map:', e);
    try { map.setProjection({ type: 'mercator' }); } catch { /* old versions are mercator anyway */ }
    document.body.dataset.projection = 'mercator';
    return 'mercator';
  }
}

/** Slow auto-rotation that stops permanently on the first user interaction. */
export function createSpinner(map, { secondsPerRevolution = 90, maxSpinZoom = 5 } = {}) {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const ctl = { enabled: !reduced, onStop: null };
  const step = () => {
    if (!ctl.enabled || map.getZoom() >= maxSpinZoom) return;
    const c = map.getCenter(); c.lng -= 360 / secondsPerRevolution;
    map.easeTo({ center: c, duration: 1000, easing: (n) => n, essential: false });
  };
  ctl.start = () => { ctl.enabled = true; step(); };
  ctl.stop = () => { if (!ctl.enabled) return; ctl.enabled = false; map.stop(); ctl.onStop?.(); };
  map.on('moveend', step);
  const el = map.getCanvasContainer();
  for (const ev of ['mousedown', 'touchstart', 'wheel', 'keydown']) el.addEventListener(ev, () => ctl.stop(), { passive: true });
  map.once('idle', step);
  return ctl;
}

export const PILOT_VIEW = { center: [8.19, 48.1], zoom: 8.6, pitch: 30, bearing: -12 };
export const GLOBE_VIEW = { center: [12, 32], zoom: 1.6, pitch: 0, bearing: 0 };
/** Zoom at which the whole globe fits the container (smaller on phones). */
export function globeZoomFor(el) {
  const w = el?.clientWidth || 800, h = el?.clientHeight || 600;
  return Math.max(0.6, Math.min(1.8, Math.log2((Math.min(w, h) * 0.85 * Math.PI) / 512)));
}

export function flyToBounds(map, bounds, opts = {}) {
  const [w, s, e, n] = bounds;
  const cam = map.cameraForBounds([[w, s], [e, n]], { padding: 40, maxZoom: 12 }) || {};
  map.flyTo({ center: cam.center ?? PILOT_VIEW.center, zoom: cam.zoom ?? PILOT_VIEW.zoom,
    pitch: opts.pitch ?? 30, bearing: opts.bearing ?? -12, duration: opts.duration ?? 6000, curve: 1.6, essential: true });
}
