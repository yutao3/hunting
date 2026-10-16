/* manifest.js — load and normalise data/layers.json.
   Each layer becomes { ...entry, versions: [{date, url, bounds, ...}] sorted newest first }.
   Relative URLs resolve against the manifest file, so the site works on any sub-path. */

export const MANIFEST_URL = new URL('../../data/layers.json', import.meta.url);
export const SUPPORTED_TYPES = ['geojson', 'raster-image', 'xyz-tiles', 'pmtiles'];

const isBounds = (b) => Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) &&
  b[0] < b[2] && b[1] < b[3] && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90;

export function resolveUrl(path, base = MANIFEST_URL) {
  if (!path) return null;
  // Keep {z}/{x}/{y} placeholders intact after URL encoding.
  return new URL(path, base).href.replace(/%7B(z|x|y|s|ratio)%7D/gi, (_m, k) => `{${k.toLowerCase()}}`);
}

export async function loadManifest(url = MANIFEST_URL) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load data/layers.json (HTTP ${res.status})`);
  const raw = await res.json();
  return normaliseManifest(raw, url);
}

export function normaliseManifest(raw, base = MANIFEST_URL) {
  const warnings = [];
  const layers = [];
  const seen = new Set();
  for (const [i, entry] of (raw.layers || []).entries()) {
    const where = `layers[${i}]${entry?.id ? ` (${entry.id})` : ''}`;
    if (!entry || !entry.id) { warnings.push(`${where}: missing "id" — skipped`); continue; }
    if (seen.has(entry.id)) { warnings.push(`${where}: duplicate id — skipped`); continue; }
    if (!SUPPORTED_TYPES.includes(entry.type)) { warnings.push(`${where}: unsupported type "${entry.type}" — skipped`); continue; }
    // Either a "versions" archive or a single url/date at the top level.
    const list = Array.isArray(entry.versions) && entry.versions.length ? entry.versions : [{ date: entry.date, url: entry.url, bounds: entry.bounds }];
    const versions = list
      .filter(v => v && v.url)
      .map(v => ({ ...v, date: v.date || entry.date || '', bounds: v.bounds || entry.bounds, href: resolveUrl(v.url, base) }))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!versions.length) { warnings.push(`${where}: no "url" — skipped`); continue; }
    if (entry.type === 'raster-image' && versions.some(v => !isBounds(v.bounds))) {
      warnings.push(`${where}: raster-image needs "bounds": [west, south, east, north] in EPSG:4326 — skipped`); continue;
    }
    seen.add(entry.id);
    layers.push({
      ...entry,
      title: entry.title || entry.id,
      group: entry.group || 'Layers',
      style: entry.style || {},
      visibleByDefault: entry.visibleByDefault !== false,
      versions,
    });
  }
  warnings.forEach(w => console.warn('[layers.json]', w));
  return {
    title: raw.title || 'Layers',
    status: raw.status || '',
    region: { name: raw.region?.name || 'Pilot region', bounds: isBounds(raw.region?.bounds) ? raw.region.bounds : [7.55, 47.67, 8.85, 48.56] },
    defaults: { minScore: 50, basemap: 'satellite', ...(raw.defaults || {}) },
    species: Array.isArray(raw.species) ? raw.species : [],
    layers,
    warnings,
  };
}

/** True when a layer applies to the selected species (layers without "species" always apply). */
export function layerForSpecies(layer, species) {
  if (!layer.species || !species) return true;
  return Array.isArray(layer.species) ? layer.species.includes(species) : layer.species === species;
}

/** Version to show for a selected date: the newest version on/before that date, else the oldest one. */
export function versionFor(layer, date) {
  if (!date) return layer.versions[0];
  return layer.versions.find(v => v.date <= date) || layer.versions[layer.versions.length - 1];
}

/** All distinct dates (newest first) across the given layers. */
export function allDates(layers) {
  return [...new Set(layers.flatMap(l => l.versions.map(v => v.date)).filter(Boolean))].sort().reverse();
}
