/* app.js — SAIIL Wildlife Habitat Explorer bootstrap.
   Wires together: manifest (data/layers.json) → LayerManager → MapLibre globe → UI panels.
   Static site: no backend, no tracking, no API keys. */
import { ensureMapLibre, baseStyle, setBasemap, drawStarfield, applyProjection, createSpinner, flyToBounds, GLOBE_VIEW, globeZoomFor } from './js/globe.js?v=20261020a';
import { loadManifest, allDates } from './js/manifest.js?v=20261020a';
import { LayerManager } from './js/layers.js?v=20261020a';
import { $, setText, el, formatDate, buildLayerPanel, refreshLayerPanel, renderHistogram, renderFeature, clearFeature, rampColor } from './js/ui.js?v=20261020a';
import { fetchConditions, renderConditions, compass, arrow } from './js/conditions.js?v=20261020a';

const params = new URLSearchParams(location.search);
const state = { map: null, mgr: null, manifest: null, spinner: null, projection: 'globe', basemap: 'satellite', popup: null, selected: null };

/* ---------- messages & loading ---------- */
let alertTimer;
function warn(message, sticky = false) {
  const n = $('map-alert'); n.textContent = message; n.hidden = false; console.warn(message);
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
  map.on('moveend', () => scheduleConditions());
  // Wait for the style only (not every basemap tile) so panels and layers appear fast on slow links.
  await new Promise((resolve) => (map.isStyleLoaded() ? resolve() : map.once('style.load', () => setTimeout(resolve, 0))));
  state.spinner = createSpinner(map);
  return map;
}

function onMapClick(e) {
  const { map, mgr } = state; if (!mgr) return;
  const ids = mgr.queryLayerIds(); if (!ids.length) return;
  const hit = map.queryRenderedFeatures(e.point, { layers: ids })[0];
  condPinned = e.lngLat; updateConditions(e.lngLat, 'Clicked spot');
  setTimeout(() => { condPinned = null; }, 30000);   // map centre takes over again after 30 s of panning
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

/* ---------- live conditions (real-time weather / wind / light) ---------- */
let condTimer, condSeq = 0, condPinned = null;
async function updateConditions(lngLat, label) {
  const seq = ++condSeq;
  const { lat, lng } = lngLat;
  setText('cond-where', `${label} · ${lat.toFixed(3)}° N, ${lng.toFixed(3)}° E`);
  try {
    const data = await fetchConditions(lat, lng);
    if (seq !== condSeq) return;
    const w = renderConditions($('conditions'), data, { label });
    setText('metric-patches', `${Math.round(w.speed)} km/h ${w.from}`);
    setText('metric-patches-sub', `Live · ${label.toLowerCase()}`);
    const chip = $('wind-chip'); chip.hidden = false;
    chip.replaceChildren(arrow(w.dir, 14), ` Wind ${Math.round(w.speed)} km/h from ${w.from} · ${Math.round(data.current.temperature_2m)}°C`);
  } catch (e) {
    if (seq !== condSeq) return;
    $('conditions').replaceChildren(el('p', { class: 'control-note' }, `Live weather unavailable (${e.message}). Retrying when you move the map.`));
  }
}
function scheduleConditions(immediate) {
  clearTimeout(condTimer);
  condTimer = setTimeout(() => {
    if (!state.map || condPinned) return;
    const z = state.map.getZoom();
    const c = z < 4 ? { lat: 48.1, lng: 8.2 } : state.map.getCenter();
    updateConditions(c, z < 4 ? 'Pilot region (Black Forest)' : 'Map centre');
  }, immediate === true ? 0 : 900);
}

/* ---------- views ---------- */
const regionBounds = () => state.manifest?.region.bounds || [7.55, 47.67, 8.85, 48.56];
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
/** Space taken by the floating side panels, so the map centres the region in the visible gap. */
function panelPadding() {
  if (isPhone()) return { top: 90, bottom: 90, left: 20, right: 20 };
  const app = $('app');
  const l = app.classList.contains('left-collapsed') ? 0 : $('panel-layers').offsetWidth + 12;
  const r = app.classList.contains('right-collapsed') ? 0 : $('panel-insights').offsetWidth + 12;
  return { top: 70, bottom: 70, left: 30 + l, right: 30 + r };
}
function flyToPilot(duration) {
  if (!state.map) return;
  state.spinner?.stop(); flyToBounds(state.map, regionBounds(), { ...(duration ? { duration } : {}), padding: panelPadding() });
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
function updateBasemap(which, fromUser) {
  state.basemap = which; if (state.map) setBasemap(state.map, which);
  const covering = state.mgr?.layersForSpecies().filter(l => state.mgr.isActive(l) && l.style?.covers) || [];
  if (fromUser && covering.length) warn(`"${covering[0].title}" is switched on and covers the base map. Switch it off in Layers to see the ${which === 'streets' ? 'Map' : 'Satellite'} base map.`);
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
  const allD = allDates(mgr.layersForSpecies());
  refreshLayerPanel($('layer-panel'), mgr, mgr.date === allD[0] ? null : mgr.date);
  const threshold = mgr.minScore;
  setText('threshold-label', threshold);
  const scored = mgr.features({ scoredOnly: true });
  const primary = mgr.primaryLayer();
  const scoredLayer = mgr.layersForSpecies().find(l => mgr.scored(l) && mgr.isActive(l));
  const ps = scoredLayer?.style || {};
  const { shown, total } = renderHistogram($('distribution-bars'), scored, { threshold, ramp: ps.ramp, field: ps.scoreField || 'score', min: ps.min ?? 0, max: ps.max ?? 100 });
  setText('insight-count', scoredLayer ? shown : '—');
  setText('insight-sub', scoredLayer ? 'habitat polygons at or above the minimum score' : 'No habitat score layer yet. It arrives with SAIIL Sentinel-2 analytics. Use "Preview habitat score model" (left) to see how it will work.');
  $('mini-track-fill').style.width = `${total ? Math.round((100 * shown) / total) : 0}%`;
  $('score-section').classList.toggle('inactive', !scoredLayer);
  syncDemoButton();

  // KPIs
  const layers = mgr.layersForSpecies();
  setText('metric-products', layers.length);
  setText('metric-products-sub', `${layers.reduce((s, l) => s + l.versions.length, 0)} dated outputs in archive`);
  const dates = allDates(layers);
  setText('metric-latest', `${formatDate(mgr.date)}${mgr.date === dates[0] ? '' : ' (archive)'}`);
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
  setText('dataset-description', mgr.date === dates[0] ? 'Showing the newest data. Pick an older date to see archived outputs (e.g. Sentinel-2 from earlier years).' : `Archive view: each layer shows its newest output on or before ${formatDate(mgr.date)}.`);
  setText('active-product', `${speciesLabel(mgr.species)} · ${formatDate(mgr.date)}`);
  const anySynthetic = layers.some(l => mgr.isActive(l) && l.status === 'synthetic');
  const badge = $('data-status'); badge.classList.toggle('real', !anySynthetic);
  badge.replaceChildren(el('span', {}, '◆'), anySynthetic ? ' SYNTHETIC LAYER ON — demo habitat scores and geometries are fabricated' : ' REAL OPEN DATA · live conditions');
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

/* ---------- demo habitat model (synthetic placeholder) ---------- */
const demoLayers = () => state.manifest?.layers.filter(l => l.status === 'synthetic' && l.type === 'geojson' && l.style?.scoreField) || [];
function demoOn() { return demoLayers().some(l => state.mgr?.status(l.id).visible); }
function syncDemoButton() {
  const on = demoOn(); const b = $('demo-toggle');
  b.setAttribute('aria-pressed', String(on));
  b.textContent = on ? '■ Hide demo habitat model' : '▶ Preview habitat score model (demo)';
  $('demo-controls').hidden = !on;
}
async function toggleDemo() {
  const { mgr } = state; if (!mgr) return;
  const on = !demoOn();
  for (const l of demoLayers()) mgr.status(l.id).visible = on;
  buildPanel(); if (!on) clearSelection();
  await mgr.apply();
  if (on && state.map.getZoom() < 6) flyToPilot();
  if (on && isPhone()) setTab('map');
}

/* ---------- panels, phone tabs, help ---------- */
function setCollapsed(side, collapsed) {
  $('app').classList.toggle(`${side}-collapsed`, collapsed);
  $(side === 'left' ? 'open-left' : 'open-right').hidden = !collapsed;
}
function setTab(tab) {
  $('app').dataset.tab = tab;
  document.querySelectorAll('.mobile-tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
}

/* ---------- static controls ---------- */
function attachControls() {
  $('demo-toggle').addEventListener('click', toggleDemo);
  document.querySelectorAll('[data-collapse]').forEach(b => b.addEventListener('click', () => setCollapsed(b.dataset.collapse, true)));
  $('open-left').addEventListener('click', () => setCollapsed('left', false));
  $('open-right').addEventListener('click', () => setCollapsed('right', false));
  document.querySelectorAll('.mobile-tabs [data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('help-btn').addEventListener('click', () => { const d = $('help'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); });
  // Phones and small laptops start with the insights panel tucked away so the map has room.
  if (!isPhone() && window.innerWidth < 1100) setCollapsed('right', true);
  $('fly-btn').addEventListener('click', () => flyToPilot());
  $('globe-btn').addEventListener('click', backToGlobe);
  $('reset-btn').addEventListener('click', () => { flyToPilot(2500); });
  $('export-btn').addEventListener('click', downloadVisible);
  document.querySelectorAll('[data-basemap]').forEach(b => b.addEventListener('click', () => updateBasemap(b.dataset.basemap, true)));
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
  scheduleConditions(true);
  if (params.has('autofly')) setTimeout(() => flyToPilot(), 2500);
}
window.__explorer = state;   // handy for debugging in the browser console
start();
