/* app.js — SAIIL Wildlife Habitat Explorer bootstrap.
   Wires together: manifest (data/layers.json) → LayerManager → MapLibre globe → UI panels.
   Static site: no backend, no tracking, no API keys. */
import { ensureMapLibre, baseStyle, setBasemap, drawStarfield, applyProjection, createSpinner, flyToBounds, GLOBE_VIEW, globeZoomFor } from './js/globe.js?v=20261016b';
import { loadManifest, allDates } from './js/manifest.js?v=20261016b';
import { LayerManager } from './js/layers.js?v=20261016b';
import { $, setText, el, formatDate, buildLayerPanel, refreshLayerPanel, renderHistogram, renderFeature, clearFeature, rampColor } from './js/ui.js?v=20261016b';

const params = new URLSearchParams(location.search);
const state = { map: null, mgr: null, manifest: null, spinner: null, projection: 'globe', basemap: 'satellite', popup: null, selected: null };

/* ---------- messages & loading ---------- */
let alertTimer;
function warn(message, sticky = false) {
  const n = $('map-alert'); n.textContent = message; n.hidden = false; console.error(message);
  clearTimeout(alertTimer); if (!sticky) alertTimer = setTimeout(() => { n.hidden = true; }, 9000);
}
function loading(on, text) { const n = $('map-loading'); if (!n) return; n.hidden = !on; if (text) setText('map-loading-text', text); }

/* ---------- map ---------- */
async function initialiseMap() {
  drawStarfield($('starfield'));
  await ensureMapLibre();
  const map = new maplibregl.Map({
    container: 'map', style: baseStyle(state.basemap), center: GLOBE_VIEW.center, zoom: globeZoomFor($('map')),
    minZoom: 0.5, maxZoom: 18, attributionControl: false, canvasContextAttributes: { antialias: true },
  });
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('style.load', () => { state.projection = applyProjection(map, params.has('flat') ? 'mercator' : 'globe'); updateProjectionButtons(); });
  map.on('error', (e) => console.warn('Map tile/overlay error:', e?.error?.message || e));
  map.on('mousemove', (e) => {
    setText('coordinates', `${e.lngLat.lat.toFixed(5)}° N  ·  ${e.lngLat.lng.toFixed(5)}° E`);
    const ids = state.mgr?.queryLayerIds() || [];
    map.getCanvas().style.cursor = ids.length && map.queryRenderedFeatures(e.point, { layers: ids }).length ? 'pointer' : '';
  });
  map.on('click', onMapClick);
  // Wait for the style only (not every basemap tile) so panels and layers appear fast on slow links.
  await new Promise((resolve) => (map.isStyleLoaded() ? resolve() : map.once('style.load', () => setTimeout(resolve, 0))));
  state.spinner = createSpinner(map);
  return map;
}

function onMapClick(e) {
  const { map, mgr } = state; if (!mgr) return;
  const ids = mgr.queryLayerIds(); if (!ids.length) return;
  const hit = map.queryRenderedFeatures(e.point, { layers: ids })[0];
  if (!hit) { state.popup?.remove(); mgr.highlight(null); clearFeature(); return; }
  const layerId = hit.layer.id.replace(/^lyr-/, '').replace(/-(fill|circle)$/, '');
  const layer = mgr.get(layerId); const st = mgr.status(layerId);
  // Use the original GeoJSON feature (full-precision geometry) when available.
  const original = st.data?.features?.find(f => hit.properties.id !== undefined && f.properties?.id === hit.properties.id);
  const feature = original || { type: 'Feature', geometry: hit.geometry, properties: hit.properties };
  const props = feature.properties || {};
  const synthetic = props.synthetic === true || props.synthetic === 'true' || (st.version?.status || layer.status) === 'synthetic';
  state.selected = { feature, layer, version: st.version };
  mgr.highlight(feature);
  renderFeature({ props, geometry: feature.geometry, layer, version: st.version, lngLat: e.lngLat, synthetic });
  const s = layer.style || {}; const score = s.scoreField ? props[s.scoreField] : undefined;
  const content = el('div', { class: 'popup' },
    el('b', {}, props.name || props.id || layer.title),
    score !== undefined ? el('div', { class: 'popup-score' }, el('i', { class: 'chip', style: `background:${rampColor(s.ramp, Number(score))}` }), `Score ${score}`) : el('div', {}, props.change_type || props.water_type || layer.title),
    el('div', { class: 'popup-meta' }, `${formatDate(st.version?.date)}${synthetic ? ' · SYNTHETIC' : ''}`));
  state.popup?.remove();
  state.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '240px', offset: 6 }).setLngLat(e.lngLat).setDOMContent(content).addTo(map);
}

/* ---------- views ---------- */
const regionBounds = () => state.manifest?.region.bounds || [7.55, 47.67, 8.85, 48.56];
function flyToPilot(duration) {
  if (!state.map) return;
  state.spinner?.stop(); flyToBounds(state.map, regionBounds(), duration ? { duration } : {});
  $('fly-btn').hidden = true; $('globe-btn').hidden = false;
}
function backToGlobe() {
  if (!state.map) return;
  if (state.projection !== 'globe') setProjection('globe');
  state.popup?.remove();
  state.map.flyTo({ ...GLOBE_VIEW, zoom: globeZoomFor($('map')), duration: 3500, essential: true });
  state.map.once('moveend', () => state.spinner?.start());
  $('fly-btn').hidden = false; $('globe-btn').hidden = true;
}
function setProjection(type) { if (!state.map) return; state.projection = applyProjection(state.map, type); updateProjectionButtons(); }
function updateProjectionButtons() {
  document.querySelectorAll('[data-projection]').forEach(b => { const a = b.dataset.projection === state.projection; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
}
function updateBasemap(which) {
  state.basemap = which; if (state.map) setBasemap(state.map, which);
  document.querySelectorAll('[data-basemap]').forEach(b => { const a = b.dataset.basemap === which; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
}

/* ---------- manifest-driven controls ---------- */
function speciesLabel(id) { return state.manifest.species.find(s => s.id === id)?.label || (id ? id.replace(/_/g, ' ') : 'All species'); }

function renderSpecies() {
  const target = $('species-list'); const items = state.manifest.species;
  target.replaceChildren();
  if (!items.length) { target.closest('.control-group').hidden = true; return; }
  for (const item of items) {
    target.append(el('button', { type: 'button', class: 'seg', 'data-species': item.id, onclick: () => selectSpecies(item.id) }, item.label));
  }
  markSpecies();
}
function markSpecies() {
  document.querySelectorAll('[data-species]').forEach(b => { const a = b.dataset.species === state.mgr.species; b.classList.toggle('active', a); b.setAttribute('aria-pressed', String(a)); });
}
async function selectSpecies(id) {
  const { mgr } = state; mgr.species = id; markSpecies();
  renderDates(); buildPanel(); clearSelection();
  await mgr.apply();
}

function renderDates() {
  const { mgr } = state; const dates = allDates(mgr.layersForSpecies());
  const sel = $('snapshot-select');
  sel.replaceChildren(...dates.map((d, i) => new Option(`${formatDate(d)}${i === 0 ? ' · latest' : ' · archive'}`, d)));
  if (!dates.includes(mgr.date)) mgr.date = dates[0] || null;
  sel.value = mgr.date || '';
  setText('archive-tag', `${dates.length} date${dates.length === 1 ? '' : 's'} archived`);
}

function buildPanel() {
  buildLayerPanel($('layer-panel'), state.mgr, {
    onToggle: (id, on) => { state.mgr.setVisible(id, on); if (!on && state.selected?.layer.id === id) clearSelection(); },
    onOpacity: (id, o) => state.mgr.setOpacity(id, o),
  });
}

function clearSelection() { state.popup?.remove(); state.mgr?.highlight(null); state.selected = null; clearFeature(); }

/* ---------- analytics / KPIs / provenance ---------- */
function updateAnalytics() {
  const { mgr, manifest } = state; if (!mgr) return;
  refreshLayerPanel($('layer-panel'), mgr, mgr.date);
  const threshold = mgr.minScore;
  setText('threshold-label', threshold);
  const scored = mgr.features({ scoredOnly: true });
  const primary = mgr.primaryLayer();
  const ps = primary?.style || {};
  const { shown, total } = renderHistogram($('distribution-bars'), scored, { threshold, ramp: ps.ramp, field: ps.scoreField || 'score', min: ps.min ?? 0, max: ps.max ?? 100 });
  setText('insight-count', shown);
  $('mini-track-fill').style.width = `${total ? Math.round((100 * shown) / total) : 0}%`;

  // KPIs
  const layers = mgr.layersForSpecies();
  setText('metric-products', layers.length);
  setText('metric-products-sub', `${layers.reduce((s, l) => s + l.versions.length, 0)} dated outputs in archive`);
  setText('metric-patches', total);
  const dates = allDates(layers);
  setText('metric-latest', formatDate(mgr.date));
  setText('metric-latest-sub', mgr.date === dates[0] ? 'Latest available output' : `Archive view · latest ${formatDate(dates[0])}`);
  setText('metric-region', manifest.region.name);

  // Provenance from the primary layer's active version
  const v = primary ? (mgr.status(primary.id).version || primary.versions[0]) : null;
  setText('meta-layer', primary?.title || '—');
  setText('meta-species', primary?.species ? speciesLabel(primary.species) : speciesLabel(mgr.species));
  setText('meta-date', formatDate(v?.date));
  setText('meta-status', v?.status || primary?.status || manifest.status || 'Unspecified');
  setText('meta-resolution', v?.resolution || primary?.resolution || 'Not specified');
  setText('meta-coverage', manifest.region.name);
  setText('meta-source', v?.source || primary?.source || '—');
  setText('meta-description', v?.description || primary?.description || '');
  setText('dataset-description', `${speciesLabel(mgr.species)} · layers show the newest output on or before ${formatDate(mgr.date)}.`);
  setText('active-product', `${speciesLabel(mgr.species)} · ${formatDate(mgr.date)}`);
  const anySynthetic = manifest.status === 'synthetic' || layers.some(l => mgr.isActive(l) && l.status === 'synthetic');
  $('data-status').replaceChildren(el('span', {}, '◆'), anySynthetic ? ' SYNTHETIC DEMONSTRATION — scores and geometries are fabricated' : ` ${String(primary?.status || 'DATASET').toUpperCase()}`);
  const loadingAny = layers.some(l => mgr.status(l.id).loading);
  const n = mgr.features().length;
  setText('map-status', loadingAny ? 'Loading layers…' : `${layers.filter(l => mgr.isActive(l)).length} layers on · ${n} features loaded · ${formatDate(mgr.date)}`);
}

/* ---------- export ---------- */
function downloadVisible() {
  const { mgr, map } = state; if (!mgr) return;
  const b = map?.getBounds();
  const overlaps = (f) => {
    if (!b) return true;
    const xs = [], ys = [];
    const walk = (c) => { if (typeof c?.[0] === 'number') { xs.push(c[0]); ys.push(c[1]); } else if (Array.isArray(c)) c.forEach(walk); };
    walk(f.geometry?.coordinates); if (!xs.length) return false;
    return Math.min(...xs) <= b.getEast() && Math.max(...xs) >= b.getWest() && Math.min(...ys) <= b.getNorth() && Math.max(...ys) >= b.getSouth();
  };
  const features = mgr.features({ applyFilter: true }).filter(({ f }) => overlaps(f))
    .map(({ f, layer, version }) => ({ ...f, properties: { ...f.properties, layer_id: layer.id, layer_date: version?.date } }));
  const out = { type: 'FeatureCollection', name: `saiil-visible-${mgr.date}`, features,
    metadata: { exported: new Date().toISOString(), date: mgr.date, species: mgr.species, min_score: mgr.minScore,
      status: state.manifest.status, notice: 'Filtered source geometries (not clipped to the view). Raster layers not included. SYNTHETIC demo data.' } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/geo+json' }));
  const a = el('a', { href: url, download: `saiil-visible-${mgr.species || 'all'}-${mgr.date}.geojson` });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  setText('map-status', `Downloaded ${features.length} features in view`);
}

/* ---------- static controls ---------- */
function attachControls() {
  $('fly-btn').addEventListener('click', () => flyToPilot());
  $('globe-btn').addEventListener('click', backToGlobe);
  $('reset-btn').addEventListener('click', () => { flyToPilot(2500); });
  $('export-btn').addEventListener('click', downloadVisible);
  document.querySelectorAll('[data-basemap]').forEach(b => b.addEventListener('click', () => updateBasemap(b.dataset.basemap)));
  document.querySelectorAll('[data-projection]').forEach(b => b.addEventListener('click', () => setProjection(b.dataset.projection)));
  $('snapshot-select').addEventListener('change', (e) => { clearSelection(); state.mgr?.setDate(e.target.value); });
  $('score-threshold').addEventListener('input', (e) => { setText('threshold-label', e.target.value); state.mgr?.setMinScore(e.target.value); });
  $('copy-view').addEventListener('click', async () => {
    if (!state.map) return;
    const c = state.map.getCenter();
    const text = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} (zoom ${state.map.getZoom().toFixed(1)})`;
    try { await navigator.clipboard.writeText(text); setText('map-status', `Copied map centre: ${text}`); } catch { setText('map-status', `Map centre: ${text}`); }
  });
}

/* ---------- start ---------- */
async function start() {
  attachControls();
  updateBasemap(state.basemap);
  const manifestP = loadManifest().catch((e) => { warn(`Cannot load data/layers.json: ${e.message}. Serve the folder over HTTP (not file://).`, true); return null; });
  let map;
  try { map = await initialiseMap(); }
  catch (e) {
    loading(true, 'Map unavailable');
    warn(`The map could not start (${e.message}). Check your connection, or try a browser with WebGL enabled.`, true);
    return;
  }
  loading(true, 'Loading layers…');
  const manifest = await manifestP;
  if (!manifest) { loading(false); return; }
  state.manifest = manifest;
  if (manifest.defaults.basemap && manifest.defaults.basemap !== state.basemap) updateBasemap(manifest.defaults.basemap);
  if (manifest.warnings.length) warn(`layers.json: ${manifest.warnings.length} entr${manifest.warnings.length === 1 ? 'y' : 'ies'} skipped — see browser console.`);
  $('score-threshold').value = manifest.defaults.minScore; setText('threshold-label', manifest.defaults.minScore);
  state.mgr = new LayerManager(map, manifest, { onChange: updateAnalytics, onError: (m) => warn(`Layer failed: ${m}`) });
  renderSpecies(); renderDates(); buildPanel(); clearFeature();
  await state.mgr.apply();
  loading(false);
  if (params.has('autofly')) setTimeout(() => flyToPilot(), 2500);
}
window.__explorer = state;   // handy for debugging in the browser console
start();
