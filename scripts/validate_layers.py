#!/usr/bin/env python3
"""Check data/layers.json before you commit: JSON syntax, required fields,
local files exist, bounds are valid WGS84, GeoJSON is a FeatureCollection in
lon/lat, and score fields are numeric.  Standard library only.

Usage:  python3 scripts/validate_layers.py
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'data' / 'layers.json'
TYPES = {'geojson', 'raster-image', 'xyz-tiles', 'pmtiles'}
errors, warnings = [], []


def ok_bounds(b):
    return (isinstance(b, list) and len(b) == 4 and all(isinstance(x, (int, float)) for x in b)
            and -180 <= b[0] < b[2] <= 180 and -90 <= b[1] < b[3] <= 90)


def check_geojson(path, layer, where):
    try:
        gj = json.loads(path.read_text(encoding='utf-8'))
    except Exception as e:
        errors.append(f'{where}: {path.name} is not valid JSON ({e})'); return
    if gj.get('type') != 'FeatureCollection':
        errors.append(f'{where}: {path.name} must be a FeatureCollection'); return
    crs = json.dumps(gj.get('crs', {}))
    if gj.get('crs') and '4326' not in crs and 'CRS84' not in crs:
        errors.append(f'{where}: {path.name} declares a non-WGS84 CRS {crs} - reproject to EPSG:4326')
    field = (layer.get('style') or {}).get('scoreField')
    for i, f in enumerate(gj.get('features', [])):
        coords = json.dumps((f.get('geometry') or {}).get('coordinates', []))
        nums = [float(x) for x in coords.replace('[', ' ').replace(']', ' ').replace(',', ' ').split()]
        if any(abs(x) > 180 for x in nums[0::2]) or any(abs(y) > 90 for y in nums[1::2]):
            errors.append(f'{where}: feature {i} has coordinates outside lon/lat range (projected CRS?)'); break
        if field and not isinstance((f.get('properties') or {}).get(field), (int, float)):
            warnings.append(f'{where}: feature {i} has no numeric "{field}"'); break
    mb = path.stat().st_size / 1e6
    if mb > 5:
        warnings.append(f'{where}: {path.name} is {mb:.1f} MB - simplify it or convert to PMTiles for faster loading')


def main():
    try:
        m = json.loads(MANIFEST.read_text(encoding='utf-8'))
    except Exception as e:
        print(f'ERROR: data/layers.json is not valid JSON: {e}'); return 1
    ids = set()
    for i, l in enumerate(m.get('layers', [])):
        where = f"layers[{i}] {l.get('id', '?')}"
        if not l.get('id'): errors.append(f'{where}: missing id')
        if l.get('id') in ids: errors.append(f'{where}: duplicate id')
        ids.add(l.get('id'))
        if l.get('type') not in TYPES: errors.append(f"{where}: type must be one of {sorted(TYPES)}")
        versions = l.get('versions') or [{'date': l.get('date'), 'url': l.get('url'), 'bounds': l.get('bounds')}]
        for v in versions:
            url, date = v.get('url'), v.get('date') or l.get('date')
            if not url: errors.append(f'{where}: version without url'); continue
            if not date or len(str(date)) != 10: warnings.append(f'{where}: date should be ISO YYYY-MM-DD (got {date!r})')
            if l.get('type') == 'raster-image' and not ok_bounds(v.get('bounds') or l.get('bounds')):
                errors.append(f'{where}: raster-image needs bounds [west, south, east, north] in EPSG:4326')
            if url.startswith(('http://', 'https://')) or '{z}' in url: continue
            path = (MANIFEST.parent / url).resolve()
            if not path.exists(): errors.append(f'{where}: file not found: data/{url}'); continue
            if l.get('type') == 'geojson': check_geojson(path, l, where)
    for w in warnings: print('WARN ', w)
    for e in errors: print('ERROR', e)
    print(f"{len(m.get('layers', []))} layers checked: {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
