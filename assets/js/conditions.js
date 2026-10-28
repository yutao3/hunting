/* conditions.js — LIVE hunting conditions for a location (real data, no API key):
   • Weather now + next 12 h from Open-Meteo (https://open-meteo.com, CC BY 4.0)
   • Sunrise / sunset and the legal daylight window for hoofed game (DE)
   • Moon phase & illumination (computed locally)
   • Scent drift advice from the wind direction */

import { el } from './ui.js?v=20261028a';

const CACHE = new Map();               // "lat,lon" -> {t, data}
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => COMPASS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
const WMO = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail' };

export async function fetchConditions(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.data;
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: 'auto', forecast_days: '2', wind_speed_unit: 'kmh',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly: 'temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,weather_code',
    daily: 'sunrise,sunset',
  });
  const res = await fetch(url, { signal: AbortSignal.timeout?.(12000) });
  if (!res.ok) throw new Error(`weather service HTTP ${res.status}`);
  const data = await res.json();
  CACHE.set(key, { t: Date.now(), data });
  return data;
}

/** Moon phase 0..1 (0 = new, 0.5 = full) and illuminated fraction. */
export function moon(date = new Date()) {
  const synodic = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  const age = (((date - ref) / 86400000) % synodic + synodic) % synodic;
  const phase = age / synodic;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  const i = Math.round(phase * 8) % 8;
  return { phase, illum, name: names[i], icon: icons[i], age };
}

// Open-Meteo returns local wall-clock strings ("2026-10-16T07:52"); keep them as such.
const hm = (s) => (s ? s.slice(11, 16) : '—');
const addMin = (s, m) => { const [h, mi] = s.slice(11, 16).split(':').map(Number); const t = (h * 60 + mi + m + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export function arrow(deg, size = 16) {
  // Arrow points the way the wind BLOWS TO (meteorological direction is where it comes FROM).
  return el('span', { class: 'wind-arrow', style: `transform:rotate(${(deg + 180) % 360}deg);width:${size}px;height:${size}px`, 'aria-hidden': 'true' }, '↑');
}

export function renderConditions(container, data, { label } = {}) {
  const c = data.current; const d = data.daily;
  const from = compass(c.wind_direction_10m); const to = compass(c.wind_direction_10m + 180);
  const m = moon();
  const sunrise = d.sunrise?.[0], sunset = d.sunset?.[0];
  // hourly from the current hour onwards
  const nowIdx = Math.max(0, data.hourly.time.findIndex(t => t >= c.time.slice(0, 13)));
  const hours = data.hourly.time.slice(nowIdx, nowIdx + 12).map((t, k) => ({
    t: hm(t), temp: data.hourly.temperature_2m[nowIdx + k], pp: data.hourly.precipitation_probability[nowIdx + k],
    ws: data.hourly.wind_speed_10m[nowIdx + k], wd: data.hourly.wind_direction_10m[nowIdx + k],
  }));
  container.replaceChildren(
    el('div', { class: 'cond-head' },
      el('div', {}, el('strong', { class: 'cond-temp' }, `${Math.round(c.temperature_2m)}°C`), el('span', { class: 'cond-sky' }, WMO[c.weather_code] || '—')),
      el('div', { class: 'cond-wind' }, arrow(c.wind_direction_10m, 26),
        el('div', {}, el('b', {}, `${Math.round(c.wind_speed_10m)} km/h from ${from}`), el('small', {}, `gusts ${Math.round(c.wind_gusts_10m)} km/h`)))),
    el('p', { class: 'cond-advice' }, `Scent drifts towards ${to}: position yourself ${to} (downwind) of where you expect game.`),
    el('dl', { class: 'cond-grid' },
      el('dt', {}, 'Sunrise / sunset'), el('dd', {}, `${hm(sunrise)} / ${hm(sunset)}`),
      el('dt', {}, 'Daylight window*'), el('dd', {}, sunrise && sunset ? `${addMin(sunrise, -90)} – ${addMin(sunset, 90)}` : '—'),
      el('dt', {}, 'Moon'), el('dd', {}, `${m.icon} ${m.name} · ${Math.round(m.illum * 100)}%`),
      el('dt', {}, 'Feels like / humidity'), el('dd', {}, `${Math.round(c.apparent_temperature)}°C / ${c.relative_humidity_2m}%`),
      el('dt', {}, 'Cloud / pressure'), el('dd', {}, `${c.cloud_cover}% / ${Math.round(c.pressure_msl)} hPa`),
      el('dt', {}, 'Precipitation now'), el('dd', {}, `${c.precipitation} mm`)),
    el('div', { class: 'cond-hours', role: 'list', 'aria-label': 'Next 12 hours' },
      ...hours.map(h => el('div', { class: 'cond-hour', role: 'listitem', title: `${h.t}: ${h.temp}°C, rain ${h.pp}%, wind ${h.ws} km/h from ${compass(h.wd)}` },
        el('span', {}, h.t), el('b', {}, `${Math.round(h.temp)}°`), arrow(h.wd, 12), el('small', {}, `${Math.round(h.ws)}`), el('i', { style: `height:${Math.max(2, h.pp * 0.22)}px` })))),
    el('p', { class: 'control-note' }, `${label || ''} · updated ${hm(c.time)} local · Open-Meteo. *Hoofed game may only be shot from 1.5 h before sunrise to 1.5 h after sunset in Germany (BJagdG §19; wild boar excepted). Always check local rules.`));
  return { from, speed: c.wind_speed_10m, dir: c.wind_direction_10m };
}
