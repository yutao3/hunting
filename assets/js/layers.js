/* layers.js — the Layer Manager.
   Turns manifest entries into MapLibre *sources* (where data comes from) and
   *layers* (how it is drawn), and keeps them in sync with the UI state:
   visibility, opacity, selected species, selected date and minimum score. */

import { layerForSpecies, versionFor } from './manifest.js?v=20261028a';

const PMTILES_JS = 'https://unpkg.com/pmtiles@4.4.1/dist/pmtiles.js';
const ANCHOR_RASTERS = 'anchor-rasters';   // raster overlays are inserted below this
const ANCHOR_VECTORS = 'anchor-vectors';   // vector overlays are inserted below this
const HIGHLIGHT = 'selection-highlight';
const RASTER_TYPES = ['raster-image', 'xyz-tiles'];

const isRaster = (l) => RASTER_TYPES.includes(l.type) || (l.type === 'pmtiles' && (l.style?.kind || 'raster') === 'raster');
export const rampExpression = (field, ramp, fallback = '#888') =>
  (Array.isArray(ramp) && ramp.length >= 2)
    ? ['interpolate', ['linear'], ['coalesce', ['to-number', ['get', field]], 0], ...ramp.flat()]
    : fallback;

/** Rough centre of a geometry (mean of its outer-ring vertices); good enough for a map pin. */
function centre(g) {
  const ring = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : g?.type === 'Point' ? [g.coordinates] : null;
  if (!ring?.length) return null;
  const pts = ring.length > 1 ? ring.slice(0, -1) : ring;
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

let pmtilesReady = null;
function ensurePmtiles() {
  if (pmtilesReady) return pmtilesReady;
  pmtilesReady = new Promise((resolve, reject) => {
    if (window.pmtiles) return resolve(window.pmtiles);
    const s = document.createElement('script'); s.src = PMTILES_JS; s.async = true;
    s.onload = () => resolve(window.pmtiles); s.onerror = () => reject(new Error('pmtiles library failed to load'));
    document.head.append(s);
  }).then((lib) => { window.maplibregl.addProtocol('pmtiles', new lib.Protocol().tile); return lib; });
  return pmtilesReady;
}

export class LayerManager {
  constructor(map, manifest, { onChange, onError } = {}) {
    this.map = map; this.manifest = manifest;
    this.onChange = onChange || (() => {}); this.onError = onError || console.error;
    this.species = manifest.species[0]?.id || null;
    this.date = null;                     // null = latest available
    this.minScore = Number(manifest.defaults.minScore ?? 50);
    this.cache = new Map();               // href -> Promise<FeatureCollection>
    this.state = new Map();
    for (const l of manifest.layers) {
      this.state.set(l.id, { visible: l.visibleByDefault, opacity: l.style.opacity ?? (l.type === 'geojson' ? 0.6 : 0.75),
        version: null, data: null, loading: false, error: null, seq: 0 });
    }
    this.#addAnchors();
  }

  /* ---------- queries used by the UI ---------- */
  layersForSpecies() { return this.manifest.layers.filter(l => layerForSpecies(l, this.species)); }
  isActive(l) { return layerForSpecies(l, this.species) && this.state.get(l.id).visible; }
  get(id) { return this.manifest.layers.find(l => l.id === id); }
  status(id) { return this.state.get(id); }
  scored(l) { return l.type === 'geojson' && !!l.style.scoreField; }
  primaryLayer() {
    const ls = this.layersForSpecies();
    return ls.find(l => this.scored(l) && this.isActive(l)) || ls.find(l => l.role === 'primary' && this.isActive(l))
      || ls.find(l => this.isActive(l)) || ls.find(l => l.role === 'primary') || ls[0] || null;
  }
  passesScore(l, f) {
    if (!this.scored(l) || l.style.filterByScore === false) return true;
    return Number(f.properties?.[l.style.scoreField] ?? 0) >= this.minScore;
  }
  /** Features of active GeoJSON layers, optionally only scored layers. */
  features({ scoredOnly = false, applyFilter = false } = {}) {
    const out = [];
    for (const l of this.layersForSpecies()) {
      if (!this.isActive(l) || l.type !== 'geojson' || (scoredOnly && !this.scored(l))) continue;
      const st = this.state.get(l.id);
      for (const f of st.data?.features || []) if (!applyFilter || this.passesScore(l, f)) out.push({ f, layer: l, version: st.version });
    }
    return out;
  }
  queryLayerIds() {
    return this.layersForSpecies().filter(l => this.isActive(l) && l.type === 'geojson')
      .flatMap(l => [`lyr-${l.id}-pin`, `lyr-${l.id}-fill`, `lyr-${l.id}-circle`]).filter(id => this.map.getLayer(id));
  }

  /* ---------- state changes ---------- */
  setSpecies(s) { this.species = s; return this.apply(); }
  setDate(d) { this.date = d || null; return this.apply(); }
  setVisible(id, v) { this.state.get(id).visible = !!v; return this.apply([id]); }
  setOpacity(id, o) { this.state.get(id).opacity = o; const l = this.get(id); if (l) this.#paint(l); }
  setMinScore(v) { this.minScore = Number(v); for (const l of this.manifest.layers) if (this.scored(l)) this.#paint(l); this.onChange('filter'); }

  /** Bring the map in line with the current state. */
  async apply(ids) {
    const targets = ids ? this.manifest.layers.filter(l => ids.includes(l.id)) : this.manifest.layers;
    await Promise.all(targets.map(l => this.#sync(l).catch(e => {
      this.state.get(l.id).error = e.message; this.onError(`${l.title}: ${e.message}`);
    })));
    this.onChange('data');
  }

  highlight(feature) {
    const src = this.map.getSource(HIGHLIGHT);
    src?.setData(feature ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: feature.geometry, properties: {} }] } : { type: 'FeatureCollection', features: [] });
  }

  /* ---------- internals ---------- */
  #addAnchors() {
    const m = this.map; const empty = { type: 'FeatureCollection', features: [] };
    if (!m.getSource('anchors')) m.addSource('anchors', { type: 'geojson', data: empty });
    if (!m.getLayer(ANCHOR_RASTERS)) m.addLayer({ id: ANCHOR_RASTERS, type: 'line', source: 'anchors' });
    if (!m.getLayer(ANCHOR_VECTORS)) m.addLayer({ id: ANCHOR_VECTORS, type: 'line', source: 'anchors' });
    if (!m.getSource(HIGHLIGHT)) m.addSource(HIGHLIGHT, { type: 'geojson', data: empty });
    if (!m.getLayer(HIGHLIGHT)) {
      m.addLayer({ id: `${HIGHLIGHT}-halo`, type: 'line', source: HIGHLIGHT, paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': 0.85 } });
      m.addLayer({ id: HIGHLIGHT, type: 'line', source: HIGHLIGHT, paint: { 'line-color': '#0a66ff', 'line-width': 2.5 } });
    }
  }

  #mapLayerIds(l) { return isRaster(l) ? [`lyr-${l.id}-raster`] : [`lyr-${l.id}-fill`, `lyr-${l.id}-line`, `lyr-${l.id}-circle`, `lyr-${l.id}-pin`]; }

  #setVisibility(l, on) {
    for (const id of this.#mapLayerIds(l)) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  async #sync(l) {
    const st = this.state.get(l.id);
    if (!this.isActive(l)) { this.#setVisibility(l, false); return; }
    const v = versionFor(l, this.date);
    const seq = ++st.seq;
    if (st.version !== v || !this.map.getSource(`src-${l.id}`)) {
      st.loading = true; st.error = null; this.onChange('loading');
      try { await this.#load(l, v, seq); } finally { if (seq === st.seq) st.loading = false; }
      if (seq !== st.seq) return;          // a newer request superseded this one
      st.version = v;
    }
    if (!this.isActive(l)) { this.#setVisibility(l, false); return; }   // switched off while loading
    this.#setVisibility(l, true);
    this.#paint(l);
  }

  async #fetchGeojson(href) {
    if (!this.cache.has(href)) {
      this.cache.set(href, fetch(href, { cache: 'no-cache' }).then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${href.split('/').pop()}`);
        const gj = await r.json();
        if (gj.type !== 'FeatureCollection' || !Array.isArray(gj.features)) throw new Error('GeoJSON must be a FeatureCollection');
        return gj;
      }).catch(e => { this.cache.delete(href); throw e; }));
    }
    return this.cache.get(href);
  }

  async #load(l, v, seq) {
    const m = this.map; const srcId = `src-${l.id}`; const st = this.state.get(l.id);
    if (l.type === 'geojson') {
      const data = await this.#fetchGeojson(v.href);
      if (seq !== st.seq) return;
      st.data = data;
      if (m.getSource(srcId)) m.getSource(srcId).setData(data);
      else { m.addSource(srcId, { type: 'geojson', data, attribution: l.attribution }); this.#addVectorLayers(l, srcId); }
      // Small patches vanish when zoomed out: show one pin per patch below a zoom level.
      if (l.style?.pinsBelowZoom) {
        const pins = { type: 'FeatureCollection', features: data.features.map(f => ({ type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: centre(f.geometry) } })).filter(f => f.geometry.coordinates) };
        if (m.getSource(`${srcId}-pins`)) m.getSource(`${srcId}-pins`).setData(pins);
        else {
          m.addSource(`${srcId}-pins`, { type: 'geojson', data: pins });
          m.addLayer({ id: `lyr-${l.id}-pin`, type: 'circle', source: `${srcId}-pins`, maxzoom: l.style.pinsBelowZoom,
            paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 9, 5, 11, 7], 'circle-stroke-width': 1.2, 'circle-stroke-color': '#ffffff' } }, ANCHOR_VECTORS);
        }
      }
      return;
    }
    if (l.type === 'raster-image') {
      const [w, s, e, n] = v.bounds;
      const coordinates = [[w, n], [e, n], [e, s], [w, s]];
      await new Promise((resolve, reject) => {           // pre-load so failures are reported
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = resolve; img.onerror = () => reject(new Error(`could not load image ${v.href.split('/').pop()}`)); img.src = v.href;
      });
      if (seq !== st.seq) return;
      if (m.getSource(srcId)) m.getSource(srcId).updateImage({ url: v.href, coordinates });
      else { m.addSource(srcId, { type: 'image', url: v.href, coordinates }); this.#addRasterLayer(l, srcId); }
      return;
    }
    // Tiled sources: replace source when the version changes.
    for (const id of this.#mapLayerIds(l)) if (m.getLayer(id)) m.removeLayer(id);
    if (m.getSource(srcId)) m.removeSource(srcId);
    const st2 = l.style || {};
    if (l.type === 'xyz-tiles') {
      m.addSource(srcId, { type: 'raster', tiles: [v.href], tileSize: st2.tileSize || 256, minzoom: st2.minzoom ?? 0, maxzoom: st2.maxzoom ?? 18,
        attribution: l.attribution, ...(v.bounds ? { bounds: v.bounds } : {}) });
      this.#addRasterLayer(l, srcId);
    } else if (l.type === 'pmtiles') {
      await ensurePmtiles();
      if (seq !== st.seq) return;
      const kind = st2.kind || 'raster';
      m.addSource(srcId, { type: kind === 'vector' ? 'vector' : 'raster', url: `pmtiles://${v.href}`, attribution: l.attribution, ...(kind === 'raster' ? { tileSize: st2.tileSize || 256 } : {}) });
      if (kind === 'vector') this.#addVectorLayers(l, srcId, st2.sourceLayer); else this.#addRasterLayer(l, srcId);
    }
  }

  #addRasterLayer(l, srcId) {
    this.map.addLayer({ id: `lyr-${l.id}-raster`, type: 'raster', source: srcId, paint: { 'raster-fade-duration': 0, 'raster-opacity': this.state.get(l.id).opacity } }, ANCHOR_RASTERS);
  }

  #addVectorLayers(l, srcId, sourceLayer) {
    const sl = sourceLayer ? { 'source-layer': sourceLayer } : {};
    const polys = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
    const lines = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'], true, false];
    const points = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
    this.map.addLayer({ id: `lyr-${l.id}-fill`, type: 'fill', source: srcId, ...sl, filter: polys, paint: {} }, ANCHOR_VECTORS);
    this.map.addLayer({ id: `lyr-${l.id}-line`, type: 'line', source: srcId, ...sl, filter: lines, paint: {} }, ANCHOR_VECTORS);
    this.map.addLayer({ id: `lyr-${l.id}-circle`, type: 'circle', source: srcId, ...sl, filter: points, paint: { 'circle-radius': 5, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' } }, ANCHOR_VECTORS);
    this.#baseFilters ||= {};
    this.#baseFilters[l.id] = { polys, lines, points };
  }
  #baseFilters;

  #paint(l) {
    const m = this.map; const st = this.state.get(l.id); const s = l.style || {}; const o = st.opacity;
    if (isRaster(l)) { const id = `lyr-${l.id}-raster`; if (m.getLayer(id)) m.setPaintProperty(id, 'raster-opacity', o); return; }
    const fillId = `lyr-${l.id}-fill`; if (!m.getLayer(fillId)) return;
    const color = s.scoreField ? rampExpression(s.scoreField, s.ramp, s.color || '#3fa37a') : (s.color || '#3fa37a');
    m.setPaintProperty(fillId, 'fill-color', color);
    m.setPaintProperty(fillId, 'fill-opacity', o);
    m.setPaintProperty(`lyr-${l.id}-line`, 'line-color', s.outlineColor || '#1d3b30');
    m.setPaintProperty(`lyr-${l.id}-line`, 'line-width', s.outlineWidth ?? 1.2);
    m.setPaintProperty(`lyr-${l.id}-line`, 'line-opacity', Math.min(1, o + 0.35));
    if (s.dashed) m.setPaintProperty(`lyr-${l.id}-line`, 'line-dasharray', [2, 1.5]);
    m.setPaintProperty(`lyr-${l.id}-circle`, 'circle-color', color);
    if (m.getLayer(`lyr-${l.id}-pin`)) { m.setPaintProperty(`lyr-${l.id}-pin`, 'circle-color', color); m.setPaintProperty(`lyr-${l.id}-pin`, 'circle-opacity', Math.min(1, o + 0.3)); }
    m.setPaintProperty(`lyr-${l.id}-circle`, 'circle-opacity', Math.min(1, o + 0.3));
    const base = this.#baseFilters?.[l.id];
    if (base && this.scored(l) && s.filterByScore !== false) {
      const score = ['>=', ['coalesce', ['to-number', ['get', s.scoreField]], 0], this.minScore];
      m.setFilter(fillId, ['all', base.polys, score]);
      m.setFilter(`lyr-${l.id}-line`, ['all', base.lines, score]);
      m.setFilter(`lyr-${l.id}-circle`, ['all', base.points, score]);
      if (m.getLayer(`lyr-${l.id}-pin`)) m.setFilter(`lyr-${l.id}-pin`, score);
    }
  }
}
