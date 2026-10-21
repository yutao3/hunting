#!/usr/bin/env python3
"""Generate SYNTHETIC, explainable habitat patches for the demo habitat model.

Why: Yu's feedback was that one big mask over the whole forest is useless to a
hunter. Real products will be small patches (~100-250 m cells, study section 7.4)
with a score that can be explained indicator by indicator (study section 7.5).

This script writes small demo patches whose score is the weighted sum of
per-indicator values (0-100), using the first-guess species weights from the
learning guide. Everything is FABRICATED for interface demonstration.

It overwrites data/layers/habitat_score_polygons_<species>_<month>.geojson and
updates the matching entries in data/layers.json (style.explain + description).
Standard library only:  python3 scripts/make_demo_patches.py
"""
import json, math, random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'layers'
BOUNDS = [7.55, 47.67, 8.85, 48.56]
DATES = ['2026-08-30', '2026-09-27', '2026-10-11']
NOTE = 'SYNTHETIC demo patch: fabricated values to show how an explainable habitat score will look.'

# First-guess weights (to be agreed with Yu) - see learning guide section 6.
WEIGHTS = {
    'roe_deer': [('s_mosaic', 'Forest-field edge (mosaic)', 0.25), ('s_clearing', 'Recent clearing with regrowth', 0.20),
                 ('s_greenness', 'Greenness vs normal', 0.15), ('s_cover', 'Canopy cover (shelter, shade)', 0.15),
                 ('s_quiet', 'Quietness (far from roads, paths)', 0.10), ('s_moisture', 'Vegetation moisture', 0.10),
                 ('s_water', 'Water nearby', 0.05)],
    'wild_boar': [('s_crop', 'Crop-forest interface (maize not harvested)', 0.30), ('s_cover', 'Canopy cover (resting cover)', 0.20),
                  ('s_wet', 'Wet ground and water (wallowing)', 0.15), ('s_quiet', 'Quietness (far from roads, paths)', 0.15),
                  ('s_broadleaf', 'Broadleaf forest (acorns, beech nuts)', 0.10), ('s_greenness', 'Greenness vs normal', 0.10)],
}
CHANGES = {
    'roe_deer': ['New regrowth detected in a clearing next to this patch.', 'Greenness is above normal for this time of year.',
                 'Adjacent meadow was mown since the last image.', 'No meaningful change since the last image.'],
    'wild_boar': ['Adjacent maize field still standing (not yet harvested).', 'Adjacent maize was harvested since the last image.',
                  'Soil moisture higher after recent rain.', 'No meaningful change since the last image.'],
}


def patch(lon, lat, r_m, rng, n=7):
    """Small irregular polygon, radius r_m metres."""
    dlon = r_m / (111320 * math.cos(math.radians(lat))); dlat = r_m / 110540
    rot = rng.uniform(0, math.pi); pts = []
    for k in range(n):
        a = rot + 2 * math.pi * k / n; f = rng.uniform(0.75, 1.15)
        pts.append([round(lon + dlon * f * math.cos(a), 6), round(lat + dlat * f * math.sin(a), 6)])
    pts.append(pts[0])
    return {'type': 'Polygon', 'coordinates': [pts]}


def heatmap(feats, path):
    """Blue-to-white smoothed score surface from the patch centres (needs numpy + Pillow; skipped otherwise)."""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        print('numpy/Pillow missing - heatmap PNG not regenerated'); return
    W, H = 520, 356
    X, Y = np.meshgrid(np.linspace(BOUNDS[0], BOUNDS[2], W), np.linspace(BOUNDS[3], BOUNDS[1], H))
    num = np.zeros((H, W)); den = np.zeros((H, W))
    for f in feats:
        ring = f['geometry']['coordinates'][0]
        cx = sum(p[0] for p in ring[:-1]) / (len(ring) - 1); cy = sum(p[1] for p in ring[:-1]) / (len(ring) - 1)
        k = np.exp(-(((X - cx) / 0.012) ** 2 + ((Y - cy) / 0.008) ** 2) / 2)
        num += k * f['properties']['score']; den += k
    field = np.where(den > 0.05, num / np.maximum(den, 1e-9), 0)
    ramp = [(0, (8, 48, 107)), (40, (33, 113, 181)), (65, (107, 174, 214)), (85, (198, 219, 239)), (100, (255, 255, 255))]
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    for c in range(3): rgba[:, :, c] = np.interp(field, [r[0] for r in ramp], [r[1][c] for r in ramp])
    rgba[:, :, 3] = (np.clip(den, 0, 1) * np.clip((field - 20) * 4, 0, 220)).astype(np.uint8)
    Image.fromarray(rgba, 'RGBA').quantize(colors=128, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)


def main():
    manifest_path = ROOT / 'data' / 'layers.json'
    m = json.loads(manifest_path.read_text())
    for sp, weights in WEIGHTS.items():
        base = random.Random(42 if sp == 'roe_deer' else 77)
        clusters = [(base.uniform(7.70, 8.70), base.uniform(47.78, 48.46), base.random()) for _ in range(18)]
        for step, date in enumerate(DATES):
            rng = random.Random(1000 * step + (11 if sp == 'roe_deer' else 22))
            feats = []
            for ci, (clon, clat, quality) in enumerate(clusters):
                for j in range(3 + int(quality * 4)):
                    pr = random.Random(ci * 100 + j + (0 if sp == 'roe_deer' else 5000))
                    lon = clon + pr.uniform(-0.018, 0.018); lat = clat + pr.uniform(-0.012, 0.012)
                    vals = {}
                    for field, _label, _w in weights:
                        v = 100 * (0.35 + 0.55 * quality) + pr.uniform(-28, 28) + rng.uniform(-8, 8) + 6 * math.sin(step + ci)
                        vals[field] = int(max(0, min(100, v)))
                    score = round(sum(w * vals[f] for f, _l, w in weights))
                    spread = max(vals.values()) - min(vals.values())
                    unc = 'low' if spread < 35 else 'medium' if spread < 60 else 'high'
                    uid = f'{sp[:3]}-{date}-{ci:02d}{j}'
                    feats.append({'type': 'Feature', 'geometry': patch(lon, lat, pr.uniform(110, 210), pr),
                                  'properties': {'id': uid, 'name': f'Demo patch {ci + 1:02d}-{j + 1}', 'score': score, **vals,
                                                 'uncertainty': unc, 'change': pr.choice(CHANGES[sp]),
                                                 'synthetic': True, 'note': NOTE}})
            out = DEST / f'habitat_score_polygons_{sp}_{date[:7]}.geojson'
            out.write_text(json.dumps({'type': 'FeatureCollection', 'name': f'Demo habitat patches {sp} {date} - SYNTHETIC',
                                       'synthetic': True, 'features': feats}, separators=(',', ':')) + '\n')
            print(out.name, len(feats), 'patches')
            heatmap(feats, DEST / f'habitat_heatmap_{sp}_{date[:7]}.png')
        for l in m['layers']:
            if l['id'] == f'habitat-polygons-{sp.replace("_", "-")}':
                l['title'] = 'Habitat score patches · synthetic'
                l['description'] = ('Small habitat patches (about 200-400 m) scored 0-100 from weighted indicators. '
                                    'Click one to see why it scored as it did. SYNTHETIC demo until SAIIL Sentinel-2 analytics.')
                l['style']['explain'] = [{'field': f, 'label': lab, 'weight': w} for f, lab, w in weights]
                l['style']['pinsBelowZoom'] = 11.5
    manifest_path.write_text(json.dumps(m, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
