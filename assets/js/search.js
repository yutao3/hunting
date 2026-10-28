/* search.js — find a place by name (or type coordinates) and fly there.
   Uses the free OpenStreetMap geocoders Photon (komoot) with Nominatim as fallback.
   Queries run only when the user presses Enter / the search button (fair use, no key). */

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** "48.28, 8.17" or "48.28 8.17" → {lat, lng}; null if not coordinates. */
export function parseCoords(q) {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

async function photon(q, near) {
  const p = new URLSearchParams({ q, limit: '6', lang: 'en' });
  if (near) { p.set('lat', near.lat.toFixed(3)); p.set('lon', near.lng.toFixed(3)); }
  const r = await fetch(`${PHOTON}?${p}`, { signal: AbortSignal.timeout?.(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.features || []).map(f => {
    const pr = f.properties || {}; const [lng, lat] = f.geometry.coordinates;
    const ext = pr.extent; // [west, north, east, south]
    return { name: pr.name || pr.street || 'Unnamed place',
      detail: [pr.city !== pr.name ? pr.city : null, pr.county, pr.state, pr.country].filter(Boolean).join(', '),
      kind: pr.osm_value || pr.type || '', lat, lng,
      bbox: ext ? [ext[0], ext[3], ext[2], ext[1]] : null };
  });
}

async function nominatim(q) {
  const p = new URLSearchParams({ q, format: 'jsonv2', limit: '6', 'accept-language': 'en' });
  const r = await fetch(`${NOMINATIM}?${p}`, { signal: AbortSignal.timeout?.(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).map(x => ({ name: x.name || x.display_name.split(',')[0], detail: x.display_name.split(',').slice(1, 4).join(',').trim(),
    kind: x.type || '', lat: Number(x.lat), lng: Number(x.lon),
    bbox: x.boundingbox ? [Number(x.boundingbox[2]), Number(x.boundingbox[0]), Number(x.boundingbox[3]), Number(x.boundingbox[1])] : null }));
}

export async function geocode(q, near) {
  try { const r = await photon(q, near); if (r.length) return r; } catch (e) { console.warn('Photon search failed, trying Nominatim:', e.message); }
  return nominatim(q);
}

/** Wire the search form. onPick({name, lat, lng, bbox}) is called with the chosen place. */
export function initSearch({ form, input, list, status, getNear, onPick }) {
  let results = [];
  const close = () => { list.hidden = true; list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); };
  const pick = (r) => { close(); input.value = r.name; onPick(r); };
  const show = (items) => {
    results = items; list.replaceChildren();
    if (!items.length) { status.textContent = 'No place found. Try a town, mountain or "lat, lng".'; close(); return; }
    status.textContent = '';
    items.forEach((r, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option'); li.id = `search-opt-${i}`; li.tabIndex = -1;
      const b = document.createElement('b'); b.textContent = r.name;
      const s = document.createElement('span'); s.textContent = [r.kind, r.detail].filter(Boolean).join(' · ');
      li.append(b, s);
      li.addEventListener('click', () => pick(r));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(r); if (e.key === 'ArrowDown') li.nextElementSibling?.focus(); if (e.key === 'ArrowUp') (li.previousElementSibling || input).focus(); if (e.key === 'Escape') { close(); input.focus(); } });
      list.append(li);
    });
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim(); if (!q) return;
    const c = parseCoords(q);
    if (c) { close(); onPick({ name: `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`, ...c, bbox: null }); return; }
    status.textContent = 'Searching…';
    try { show(await geocode(q, getNear?.())); } catch (err) { status.textContent = `Search unavailable (${err.message}).`; close(); }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' && !list.hidden) { e.preventDefault(); list.firstElementChild?.focus(); } if (e.key === 'Escape') close(); });
  document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
  return { close };
}

/** Link to the same place in the Copernicus Browser (Sentinel-2 L2A true colour) for side-by-side checks. */
export function copernicusUrl(lat, lng, zoom) {
  const p = new URLSearchParams({ zoom: String(Math.max(3, Math.min(18, Math.round(zoom)))), lat: lat.toFixed(5), lng: lng.toFixed(5),
    themeId: 'DEFAULT-THEME', datasetId: 'S2_L2A_CDAS', layerId: '1_TRUE_COLOR' });
  return `https://browser.dataspace.copernicus.eu/?${p}`;
}
