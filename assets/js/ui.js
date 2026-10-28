/* ui.js — DOM rendering: manifest-generated layer panel, legends, histogram,
   feature (click) panel and provenance. No map logic lives here. */

export const $ = (id) => document.getElementById(id);
export const setText = (id, v) => { const n = $(id); if (n) n.textContent = String(v ?? '—'); };

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}

export const formatDate = (d) => {
  if (!d) return '—';
  const dt = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(dt.valueOf()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const TYPE_LABEL = { 'geojson': 'Vector', 'raster-image': 'Raster image', 'xyz-tiles': 'XYZ tiles', 'pmtiles': 'PMTiles', 's2-scene': 'Sentinel-2 scene' };

/* ---------- colour helpers ---------- */
const hex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
export function rampColor(ramp, v) {
  if (!Array.isArray(ramp) || !ramp.length) return '#3fa37a';
  if (v <= ramp[0][0]) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    const [v1, c1] = ramp[i]; const [v0, c0] = ramp[i - 1];
    if (v <= v1) {
      const t = (v - v0) / (v1 - v0 || 1); const a = hex(c0), b = hex(c1);
      return `rgb(${a.map((x, k) => Math.round(x + (b[k] - x) * t)).join(',')})`;
    }
  }
  return ramp[ramp.length - 1][1];
}
const gradient = (ramp) => {
  const lo = ramp[0][0], hi = ramp[ramp.length - 1][0];
  return `linear-gradient(90deg,${ramp.map(([v, c]) => `${c} ${Math.round(100 * (v - lo) / (hi - lo || 1))}%`).join(',')})`;
};
function symbolStyle(layer) {
  const s = layer.style || {};
  if (Array.isArray(s.ramp) && s.ramp.length > 1) return `background:${gradient(s.ramp)}`;
  return `background:${s.color || '#9ab'};border:2px ${s.dashed ? 'dashed' : 'solid'} ${s.outlineColor || s.color || '#567'}`;
}

/* ---------- legend ---------- */
export function legendFor(layer) {
  const s = layer.style || {};
  // Categorical layers served by a map server (WMS) bring their own legend picture.
  if (s.legendImage) {
    return el('details', { class: 'legend legend-image' }, el('summary', {}, `Legend: ${s.legendLabel || layer.title}`),
      el('img', { src: s.legendImage, alt: `Legend for ${layer.title}`, loading: 'lazy' }));
  }
  // Class legend (e.g. Sentinel-2 scene classification): [[colour, label], ...]
  if (Array.isArray(s.legendItems)) {
    return el('div', { class: 'legend legend-classes' }, ...s.legendItems.map(([c, t]) => el('span', {}, el('i', { style: `background:${c}` }), t)));
  }
  if (Array.isArray(s.ramp) && s.ramp.length > 1) {
    const lo = s.min ?? s.ramp[0][0], hi = s.max ?? s.ramp[s.ramp.length - 1][0];
    const mid = Math.round(((lo + hi) / 2) * 100) / 100;
    return el('div', { class: 'legend' },
      el('div', { class: 'legend-bar', style: `background:${gradient(s.ramp)}` }),
      el('div', { class: 'legend-labels' }, el('span', {}, lo), el('span', {}, s.legendLabel || (s.scoreField ? `${s.scoreField} (low → high)` : 'low → high')), el('span', {}, hi)),
      el('span', { class: 'legend-mid', hidden: true }, mid));
  }
  return el('div', { class: 'legend legend-swatch' }, el('span', { class: 'layer-symbol', style: symbolStyle(layer) }), el('span', {}, s.legendLabel || layer.title));
}

/* ---------- layer panel ---------- */
export function buildLayerPanel(container, mgr, { onToggle, onOpacity, onPin }) {
  container.replaceChildren();
  const layers = mgr.layersForSpecies();
  if (!layers.length) { container.append(el('p', { class: 'control-note' }, 'No layers in data/layers.json for this species.')); return; }
  const groups = [...new Set(layers.map(l => l.group))];
  for (const g of groups) {
    const inGroup = layers.filter(x => x.group === g);
    // Groups made only of synthetic layers are tucked into a closed <details> so real data comes first.
    let target = container;
    if (inGroup.every(l => l.status === 'synthetic')) {
      const det = el('details', { class: 'demo-group' }, el('summary', { class: 'layer-group-title' }, g));
      container.append(det); target = det;
    } else container.append(el('div', { class: 'layer-group-title' }, g));
    for (const l of inGroup) {
      const st = mgr.status(l.id);
      const inputId = `toggle-${l.id}`, opId = `opacity-${l.id}`;
      const pct = Math.round(st.opacity * 100);
      const row = el('div', { class: `layer-row${st.visible ? ' on' : ''}`, 'data-layer': l.id },
        el('label', { class: 'layer-toggle', for: inputId },
          el('span', { class: 'toggle-label' },
            el('span', { class: 'layer-symbol', style: symbolStyle(l) }),
            el('span', {}, el('b', {}, l.title, l.status === 'real' ? el('i', { class: 'real-tag' }, 'REAL') : l.status === 'synthetic' ? el('i', { class: 'syn-tag' }, 'DEMO') : null), el('small', { class: 'layer-meta' }, `${TYPE_LABEL[l.type] || l.type} · ${formatDate(l.versions[0].date)}`))),
          el('input', { type: 'checkbox', id: inputId, checked: st.visible, onchange: (e) => onToggle(l.id, e.target.checked) }),
          el('span', { class: 'switch', 'aria-hidden': 'true' })),
        el('div', { class: 'layer-extra' },
          el('div', { class: 'control-label small' }, el('label', { for: opId }, 'Opacity'), el('span', { class: 'op-val' }, `${pct}%`)),
          el('input', { type: 'range', id: opId, min: 5, max: 100, step: 5, value: pct, 'aria-label': `${l.title} opacity`,
            oninput: (e) => { row.querySelector('.op-val').textContent = `${e.target.value}%`; onOpacity(l.id, e.target.value / 100); } }),
          l.versions.length > 1 ? el('div', { class: 'layer-date' }, el('label', { for: `date-${l.id}` }, 'Date'),
            el('select', { id: `date-${l.id}`, class: 'select select-sm', onchange: (e) => onPin?.(l.id, e.target.value) },
              el('option', { value: '', selected: !st.pinned }, 'Follow "Dataset date"'),
              ...l.versions.map(v => el('option', { value: v.date, selected: st.pinned === v.date }, `${formatDate(v.date)}${v.label ? ` · ${v.label}` : ''}`)))) : null,
          legendFor(l),
          l.description ? el('p', { class: 'control-note' }, l.description) : null,
          el('p', { class: 'layer-status', role: 'status' })));
      target.append(row);
    }
  }
}

/** Update the per-layer date / loading / error text without rebuilding. */
export function refreshLayerPanel(container, mgr, selectedDate) {
  for (const row of container.querySelectorAll('.layer-row')) {
    const l = mgr.get(row.dataset.layer); if (!l) continue;
    const st = mgr.status(l.id);
    row.classList.toggle('on', st.visible);
    const pinned = st.pinned && l.versions.find(x => x.date === st.pinned);
    const v = pinned || st.version || l.versions.find(x => !selectedDate || x.date <= selectedDate) || l.versions[l.versions.length - 1];
    const nearest = pinned ? ' (picked)' : selectedDate && v.date !== selectedDate ? ' (nearest)' : '';
    row.querySelector('.layer-meta').textContent = l.realtime
      ? `${TYPE_LABEL[l.type] || l.type} · LIVE · ${formatDate(v.date)}`
      : `${TYPE_LABEL[l.type] || l.type} · ${formatDate(v.date)}${nearest}${l.versions.length > 1 ? ` · ${l.versions.length} dates` : ''}`;
    const status = row.querySelector('.layer-status');
    status.textContent = st.error ? `⚠ ${st.error}` : st.loading ? 'Loading…' : '';
    status.classList.toggle('error', !!st.error);
  }
}

/* ---------- histogram ---------- */
export function renderHistogram(container, items, { threshold, ramp, field = 'score', bins = 10, min = 0, max = 100 }) {
  const width = (max - min) / bins;
  const all = new Array(bins).fill(0), kept = new Array(bins).fill(0);
  let sum = 0, n = 0;
  for (const { f } of items) {
    const v = Number(f.properties?.[field]); if (!Number.isFinite(v)) continue;
    const i = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / width)));
    all[i]++; if (v >= threshold) { kept[i]++; sum += v; n++; }
  }
  const peak = Math.max(1, ...all);
  const bars = all.map((count, i) => {
    const lo = min + i * width, hi = lo + width;
    const c = rampColor(ramp, lo + width / 2);
    return el('div', { class: 'hbar', title: `${lo}–${hi}: ${kept[i]} shown of ${count}` },
      el('span', { class: 'hcount' }, kept[i] || ''),
      el('div', { class: 'hstack', style: `height:${(100 * count) / peak}%` },
        el('div', { class: 'hfill-rest', style: `flex:${count - kept[i]}` }),
        el('div', { class: 'hfill', style: `flex:${kept[i]};background:${c}` })));
  });
  const marker = el('div', { class: 'hthreshold', style: `left:${(100 * (threshold - min)) / (max - min)}%`, title: `Minimum score ${threshold}` });
  container.replaceChildren(
    el('div', { class: 'histogram', role: 'img', 'aria-label': `Histogram: ${n} of ${items.length} polygons at or above score ${threshold}` }, ...bars, marker),
    el('div', { class: 'haxis' }, ...[0, 20, 40, 60, 80, 100].map(t => el('span', {}, t))),
    el('p', { class: 'control-note hsummary' }, items.length
      ? `${n} of ${items.length} polygons ≥ ${threshold}${n ? ` · mean score ${Math.round(sum / n)}` : ''}`
      : 'No scored polygon layer is switched on.'));
  return { shown: n, total: items.length };
}

/* ---------- geometry ---------- */
const R = 6378137;
function ringArea(c) {           // spherical excess approximation (as used by turf.js), m²
  let a = 0; const rad = Math.PI / 180;
  for (let i = 0; i < c.length - 1; i++) { const [x1, y1] = c[i], [x2, y2] = c[i + 1]; a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad)); }
  return Math.abs((a * R * R) / 2);
}
export function areaHa(geom) {
  if (!geom) return null;
  const poly = (rings) => rings.reduce((s, r, i) => s + (i ? -1 : 1) * ringArea(r), 0);
  if (geom.type === 'Polygon') return poly(geom.coordinates) / 1e4;
  if (geom.type === 'MultiPolygon') return geom.coordinates.reduce((s, p) => s + poly(p), 0) / 1e4;
  return null;
}

/* ---------- feature panel ---------- */
const ACR = { ndvi: 'NDVI', ndmi: 'NDMI', ndwi: 'NDWI', evi: 'EVI' };
const nice = (k) => ACR[k.toLowerCase()] || k.replace(/_/g, ' ').replace(/\bpct\b/, '%').replace(/\bm\b$/, '(m)').replace(/^\w/, c => c.toUpperCase());
export function renderFeature({ props, geometry, layer, version, lngLat, synthetic }) {
  const s = layer.style || {};
  const score = s.scoreField ? props[s.scoreField] : undefined;
  setText('feature-name', props.name || props.id || 'Unnamed feature');
  setText('feature-type', layer.title);
  $('feature-caption').textContent = props.note || layer.description || '';
  const rows = [];
  // "Why this score" (study 7.5): each indicator's value and its weighted contribution.
  if (Array.isArray(s.explain) && score !== undefined) {
    const parts = s.explain.filter(x => props[x.field] !== undefined)
      .map(x => ({ ...x, value: Number(props[x.field]), pts: x.weight * Number(props[x.field]) }))
      .sort((a, b) => b.pts - a.pts);
    rows.push(el('div', { class: 'explain' },
      el('div', { class: 'explain-head' }, el('span', {}, 'Why this score'), el('span', {}, 'value · weight → points')),
      ...parts.map(x => el('div', { class: 'explain-row', title: `${x.label}: ${x.value}/100 × weight ${x.weight} = ${x.pts.toFixed(1)} points` },
        el('span', { class: 'explain-label' }, x.label),
        el('span', { class: 'explain-bar' }, el('i', { style: `width:${x.value}%;background:${rampColor(s.ramp, x.value)}` })),
        el('span', { class: 'explain-num' }, `${x.value} · ${x.weight} → ${x.pts.toFixed(0)}`))),
      el('div', { class: 'explain-total' }, el('span', {}, 'Total'), el('b', {}, `${Math.round(parts.reduce((a, x) => a + x.pts, 0))} / 100`)),
      props.change ? el('p', { class: 'explain-change' }, el('b', {}, 'Observed change: '), props.change) : null,
      el('p', { class: 'control-note' }, 'A relative habitat score, not a probability of seeing an animal.')));
  }
  const add = (k, v, extra) => rows.push(el('div', { class: 'attribute' }, el('span', {}, k), el('b', {}, extra || null, String(v))));
  if (score !== undefined) add('Habitat score', `${score} / ${s.max ?? 100}`, el('i', { class: 'chip', style: `background:${rampColor(s.ramp, Number(score))}` }));
  const ha = areaHa(geometry);
  if (ha) add('Area', ha >= 100 ? `${(ha / 100).toFixed(2)} km²` : `${ha.toFixed(1)} ha`);
  add('Dataset date', formatDate(props.date || props.detected || version?.date));
  const skip = new Set(['name', 'note', 'id', 'synthetic', 'date', 'detected', 'change', s.scoreField, ...(s.explain || []).map(x => x.field)]);
  for (const [k, v] of Object.entries(props)) if (!skip.has(k) && v !== null && v !== undefined && typeof v !== 'object') add(nice(k), v);
  add('Source', version?.source || layer.source || '—');
  add('Data status', synthetic ? 'SYNTHETIC (fabricated)' : (layer.status || 'unspecified'));
  if (lngLat) add('Clicked point', `${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`);
  $('feature-attributes').replaceChildren(...rows);
  $('feature-card').classList.toggle('is-synthetic', !!synthetic);
}
export function clearFeature() {
  setText('feature-name', 'Select a polygon'); setText('feature-type', 'Map detail');
  $('feature-caption').textContent = 'Click any habitat or change polygon on the map to see its score, area, date and indicators.';
  $('feature-attributes').replaceChildren(el('div', { class: 'empty-selection' }, 'No location selected'));
  $('feature-card').classList.remove('is-synthetic');
}
