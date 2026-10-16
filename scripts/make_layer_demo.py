#!/usr/bin/env python3
"""Generate FICTIONAL example layers + data/layers.json for the manifest-driven UI.

Everything written by this script is SYNTHETIC: geometries, scores, indices and
dates are invented for interface demonstration only. No EO data is used.

Usage:  python3 scripts/make_layer_demo.py      (needs numpy + Pillow)
"""
from __future__ import annotations
import json, math, random
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'layers'
DEST.mkdir(parents=True, exist_ok=True)
BOUNDS = [7.55, 47.67, 8.85, 48.56]          # west, south, east, north (EPSG:4326)
DATES = ['2026-08-30', '2026-09-27', '2026-10-11']
SPECIES = [('roe_deer', 'Roe deer'), ('wild_boar', 'Wild boar')]
W, H = 520, 356                                # raster size (keeps PNGs small)
NOTE = 'SYNTHETIC: fabricated geometry and values for interface demonstration only.'

HABITAT_RAMP = [[0, '#f7f4b5'], [25, '#f2c46b'], [50, '#a7d38c'], [75, '#3fa37a'], [100, '#0f5a46']]
HEAT_RAMP = [[0, '#08306b'], [40, '#2171b5'], [65, '#6baed6'], [85, '#c6dbef'], [100, '#ffffff']]
VEG_RAMP = [[0, '#a6611a'], [35, '#dfc27d'], [60, '#a6d96a'], [80, '#1a9641'], [100, '#00441b']]
MOIST_RAMP = [[0, '#fff7bc'], [40, '#7fcdbb'], [70, '#2c7fb8'], [100, '#081d58']]


def hex2rgb(h): return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def blob(lon, lat, rx, ry, rng, n=18):
    """Organic closed polygon (smoothed random radii)."""
    raw = [rng.uniform(0.7, 1.25) for _ in range(n)]
    radii = [(raw[i - 1] + 2 * raw[i] + raw[(i + 1) % n]) / 4 for i in range(n)]
    rot = rng.uniform(0, math.pi)
    pts = []
    for k, r in enumerate(radii):
        a = 2 * math.pi * k / n
        x, y = rx * r * math.cos(a), ry * r * math.sin(a)
        pts.append([round(lon + x * math.cos(rot) - y * math.sin(rot), 5), round(lat + x * math.sin(rot) + y * math.cos(rot), 5)])
    pts.append(pts[0])
    return {'type': 'Polygon', 'coordinates': [pts]}


def grid():
    X, Y = np.meshgrid(np.linspace(BOUNDS[0], BOUNDS[2], W, dtype=np.float32),
                       np.linspace(BOUNDS[3], BOUNDS[1], H, dtype=np.float32))
    return X, Y


def field_from(seeds, base=0.0):
    X, Y = grid(); f = np.full((H, W), base, dtype=np.float32)
    for lon, lat, v, sx, sy in seeds:
        f += v * np.exp(-(((X - lon) / sx) ** 2 + ((Y - lat) / sy) ** 2) / 2)
    return f


def save_png(field, ramp, path, alpha):
    f = np.clip(field, 0, 100)
    rgba = np.empty((H, W, 4), dtype=np.uint8)
    xs = [k for k, _ in ramp]
    for c in range(3):
        rgba[:, :, c] = np.interp(f, xs, [hex2rgb(col)[c] for _, col in ramp]).astype(np.uint8)
    rgba[:, :, 3] = alpha(f).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').quantize(colors=128, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)


def noise(rng, octaves=5):
    X, Y = grid(); f = np.zeros((H, W), dtype=np.float32)
    for o in range(octaves):
        fx, fy, ph = rng.uniform(4, 14) * (o + 1), rng.uniform(4, 14) * (o + 1), rng.uniform(0, 6.3)
        f += np.sin(X * fx + ph) * np.cos(Y * fy - ph) / (o + 1)
    return f


def write_geojson(path, feats, name):
    path.write_text(json.dumps({'type': 'FeatureCollection', 'name': name, 'synthetic': True, 'features': feats}, separators=(',', ':')) + '\n')


def main():
    layers = []
    for sp, label in SPECIES:
        poly_versions, heat_versions = [], []
        base = random.Random(7 if sp == 'roe_deer' else 99)
        centres = [(base.uniform(7.68, 8.72), base.uniform(47.76, 48.48)) for _ in range(26)]
        for step, date in enumerate(DATES):
            rng = random.Random(1000 * step + (1 if sp == 'roe_deer' else 2))
            feats, seeds = [], []
            for j, (lon, lat) in enumerate(centres):
                s = 55 + 25 * math.sin(j * 1.7 + step * 0.9 + (0.6 if sp == 'wild_boar' else 0)) + rng.uniform(-10, 10)
                s = int(max(12, min(98, s)))
                uid = f'{sp}-{date}-{j:02d}'
                cls = ['Woodland mosaic', 'Forest edge', 'Clearing / meadow', 'Wet woodland'][j % 4]
                feats.append({'type': 'Feature', 'geometry': blob(lon, lat, 0.022 + base.random() * 0.02, 0.014 + base.random() * 0.014, random.Random(j)),
                              'properties': {'id': uid, 'name': f'Sample habitat area {j + 1:02d}', 'score': s, 'class': cls,
                                             'ndvi': round(0.45 + 0.4 * rng.random(), 2), 'ndmi': round(0.05 + 0.35 * rng.random(), 2),
                                             'canopy_cover_pct': int(30 + 65 * rng.random()), 'dist_to_water_m': int(80 + 1900 * rng.random()),
                                             'synthetic': True, 'note': NOTE}})
                seeds.append((lon, lat, float(s), 0.05, 0.035))
            month = date[:7]
            gj = f'habitat_score_polygons_{sp}_{month}.geojson'
            write_geojson(DEST / gj, feats, f'Habitat score polygons ({label}, {date}) - SYNTHETIC')
            png = f'habitat_heatmap_{sp}_{month}.png'
            save_png(field_from(seeds) * 0.9, HEAT_RAMP, DEST / png, lambda f: np.where(f < 14, 0, np.clip(60 + (f - 14) * 2.2, 0, 235)))
            poly_versions.append({'date': date, 'url': f'layers/{gj}'})
            heat_versions.append({'date': date, 'url': f'layers/{png}'})
        poly_versions.reverse(); heat_versions.reverse()
        layers.append({
            'id': f'habitat-polygons-{sp.replace("_", "-")}', 'title': 'Habitat score polygons', 'type': 'geojson',
            'group': 'Habitat suitability', 'species': sp, 'role': 'primary', 'visibleByDefault': True,
            'description': f'Candidate {label.lower()} habitat patches coloured by habitat score (0-100). SYNTHETIC.',
            'source': 'SAIIL synthetic demo fixture (no EO input)', 'status': 'synthetic', 'resolution': 'Demonstration only',
            'style': {'scoreField': 'score', 'min': 0, 'max': 100, 'ramp': HABITAT_RAMP, 'opacity': 0.6, 'outlineColor': '#f2fff6', 'outlineWidth': 1.3, 'filterByScore': True},
            'versions': poly_versions})
        layers.append({
            'id': f'habitat-heatmap-{sp.replace("_", "-")}', 'title': 'Habitat heatmap', 'type': 'raster-image',
            'group': 'Habitat suitability', 'species': sp, 'visibleByDefault': False, 'bounds': BOUNDS,
            'description': 'Smoothed habitat score surface (blue = low, white = high). Georeferenced PNG. SYNTHETIC.',
            'source': 'SAIIL synthetic demo fixture (no EO input)', 'status': 'synthetic', 'resolution': 'Demonstration only',
            'style': {'opacity': 0.75, 'min': 0, 'max': 100, 'ramp': HEAT_RAMP, 'legendLabel': 'Habitat score'},
            'versions': heat_versions})

    # Species-independent landscape indicators
    veg_versions, chg_versions = [], []
    for step, date in enumerate(DATES[1:]):
        rng = np.random.default_rng(5 + step)
        f = 60 + 18 * noise(random.Random(11)) + 8 * noise(random.Random(20 + step), 3)
        png = f'vegetation_vigour_{date[:7]}.png'
        save_png(f, VEG_RAMP, DEST / png, lambda f: np.full(f.shape, 175))
        veg_versions.append({'date': date, 'url': f'layers/{png}'})
        r = random.Random(300 + step); feats = []
        for j in range(9 + 3 * step):
            lon, lat = r.uniform(7.7, 8.7), r.uniform(47.75, 48.5)
            feats.append({'type': 'Feature', 'geometry': blob(lon, lat, 0.012 + r.random() * 0.01, 0.008 + r.random() * 0.006, r, 12),
                          'properties': {'id': f'chg-{date}-{j:02d}', 'name': f'Example change zone {j + 1:02d}',
                                         'change_type': r.choice(['Possible clearing', 'Windthrow', 'Harvest', 'Crop change']),
                                         'detected': date, 'synthetic': True, 'note': NOTE}})
        gj = f'landscape_change_{date[:7]}.geojson'
        write_geojson(DEST / gj, feats, f'Landscape change ({date}) - SYNTHETIC')
        chg_versions.append({'date': date, 'url': f'layers/{gj}'})
    veg_versions.reverse(); chg_versions.reverse()
    f = 45 + 25 * noise(random.Random(77)) + 10 * noise(random.Random(78), 2)
    save_png(f, MOIST_RAMP, DEST / 'moisture_index_2026-10.png', lambda f: np.full(f.shape, 165))
    r = random.Random(500); water = []
    for j in range(7):
        lon, lat = r.uniform(7.75, 8.6), r.uniform(47.8, 48.45)
        water.append({'type': 'Feature', 'geometry': blob(lon, lat, 0.012 + r.random() * 0.012, 0.005 + r.random() * 0.004, r, 14),
                      'properties': {'id': f'water-{j:02d}', 'name': f'Sample water body {j + 1:02d}', 'water_type': r.choice(['Lake', 'Reservoir', 'Pond']),
                                     'synthetic': True, 'note': NOTE}})
    write_geojson(DEST / 'water_bodies_2026-10.geojson', water, 'Water bodies - SYNTHETIC')

    layers += [
        {'id': 'landscape-change', 'title': 'Forest clearings & change', 'type': 'geojson', 'group': 'Landscape indicators',
         'visibleByDefault': True, 'description': 'Example change polygons (clearing, windthrow, harvest). SYNTHETIC.',
         'source': 'SAIIL synthetic demo fixture (no EO input)', 'status': 'synthetic',
         'style': {'color': '#f39c34', 'opacity': 0.35, 'outlineColor': '#b8641a', 'outlineWidth': 1.6, 'dashed': True},
         'versions': chg_versions},
        {'id': 'vegetation-vigour', 'title': 'Vegetation vigour (NDVI-like)', 'type': 'raster-image', 'group': 'Landscape indicators',
         'visibleByDefault': False, 'bounds': BOUNDS, 'description': 'Illustrative vegetation index surface. SYNTHETIC.',
         'source': 'SAIIL synthetic demo fixture (no EO input)', 'status': 'synthetic',
         'style': {'opacity': 0.7, 'min': 0, 'max': 1, 'ramp': [[k / 100, c] for k, c in VEG_RAMP], 'legendLabel': 'Index'},
         'versions': veg_versions},
        {'id': 'moisture-index', 'title': 'Moisture index (NDMI-like)', 'type': 'raster-image', 'group': 'Landscape indicators',
         'visibleByDefault': False, 'bounds': BOUNDS, 'date': '2026-10-11', 'url': 'layers/moisture_index_2026-10.png',
         'description': 'Illustrative canopy/soil moisture surface. SYNTHETIC.', 'source': 'SAIIL synthetic demo fixture (no EO input)',
         'status': 'synthetic', 'style': {'opacity': 0.7, 'min': -1, 'max': 1, 'ramp': [[-1 + 2 * k / 100, c] for k, c in MOIST_RAMP], 'legendLabel': 'Index'}},
        {'id': 'water-bodies', 'title': 'Water bodies', 'type': 'geojson', 'group': 'Landscape indicators', 'visibleByDefault': False,
         'date': '2026-10-11', 'url': 'layers/water_bodies_2026-10.geojson', 'description': 'Example open-water polygons. SYNTHETIC.',
         'source': 'SAIIL synthetic demo fixture (no EO input)', 'status': 'synthetic',
         'style': {'color': '#2b8cff', 'opacity': 0.55, 'outlineColor': '#0b4f9c', 'outlineWidth': 1}},
    ]
    manifest = {
        '$comment': 'Layer manifest for the Wildlife Habitat Explorer. Add / replace / remove entries in "layers" - no JS changes needed. Paths are relative to this file. See docs/ADDING_LAYERS.md.',
        'schema_version': '2.0',
        'title': 'SAIIL Wildlife Habitat Explorer',
        'status': 'synthetic',
        'region': {'name': 'Black Forest (DE)', 'bounds': BOUNDS},
        'defaults': {'minScore': 50, 'basemap': 'satellite'},
        'species': [{'id': s, 'label': l} for s, l in SPECIES],
        'layers': layers,
    }
    (ROOT / 'data' / 'layers.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {len(layers)} layers to data/layers.json and files to {DEST}')


if __name__ == '__main__':
    main()
