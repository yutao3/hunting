> **Note (v2):** the web UI now reads **`data/layers.json`**, not `catalog.json`. See [ADDING_LAYERS.md](ADDING_LAYERS.md). This file documents the legacy v1 catalogue used by `scripts/publish_snapshot.py`.

# Public dataset schema / extension reference

The user interface automatically reads `data/catalog.json` on startup.

## Example catalogue entry

```json
{
  "id": "roe_deer-2026-10-18",
  "species": "roe_deer",
  "date": "2026-10-18",
  "region": "Black Forest",
  "status": "modelled",
  "resolution": "20 m",
  "description": "Species-specific index from an offline EO pipeline. Validation pending.",
  "extent": [7.55, 47.67, 8.85, 48.56],
  "geojson": "./snapshots/roe_deer-2026-10-18.geojson",
  "raster": {
    "type": "image",
    "url": "./snapshots/roe_deer-2026-10-18.png",
    "bounds": [7.55, 47.67, 8.85, 48.56],
    "units": "normalised index 0–100"
  }
}
```

All relative data paths resolve against **`data/catalog.json`**, not against `index.html`. Full `https://` URLs are also accepted for public datasets, subject to browser access restrictions.

- `id`: stable snapshot ID, unique within the catalogue.
- `species`: arbitrary machine-readable ID, e.g. `roe_deer`, `wild_boar`.
- `date`: ISO date `YYYY-MM-DD` used for chronological sorting.
- `region`: human-readable region.
- `status`: `synthetic`, `modelled`, or `validated` (choose based on real evidence).
- `resolution`: description of input product, e.g. `10 m`, `100 m`, `field-based`.
- `extent`: [west, south, east, north], **longitude/latitude, WGS84**.
- `geojson`: optional relative path or URL to a FeatureCollection.
- `raster`: optional image or XYZ raster source.
- `description`: plain text shown in the UI.

Add species definitions to the top-level `species` list:

```json
"species": [
  { "id": "roe_deer", "label": "Roe deer" },
  { "id": "wild_boar", "label": "Wild boar" },
  { "id": "red_deer", "label": "Red deer" }
]
```

## Polygon FeatureCollection

The interface expects GeoJSON coordinates in EPSG:4326 `[longitude,latitude]`. Projected metre coordinates must first be reprojected. Example:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "habitat-001",
        "kind": "habitat",
        "name": "Habitat area 001",
        "score": 73,
        "class": "Mixed woodland",
        "confidence": "Not calibrated",
        "indicator": "EO-based relative suitability",
        "source": "Your model version",
        "note": "Candidate habitat, not a sighting prediction"
      },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[8.10,48.10],[8.15,48.10],[8.15,48.13],[8.10,48.13],[8.10,48.10]]]
      }
    }
  ]
}
```

Another feature may use `"kind":"change"` to display a separate orange change polygon (score optional). Names, notes and feature attributes are displayed as plain text and cannot inject HTML.

## Pre-rendered raster PNG overlay

A raster image must be pre-rendered as a **north-up RGBA PNG** with 0 alpha outside valid pixels, matching its stated bounds.

```json
"raster": {
  "type": "image",
  "url": "./snapshots/roe_deer-2026-10-18.png",
  "bounds": [7.55,47.67,8.85,48.56]
}
```

The browser anchors the image in WGS84 with the corner order NW, NE, SE, SW. Your original GeoTIFF's affine transform/EPSG code is **not embedded** in the PNG, so the bounds are essential and must match exactly. Use `scripts/publish_snapshot.py` to convert a GeoTIFF and generate suitable metadata automatically. Do not use an image raster with rotations/shear over a large geographic extent without pre-warping it.

## XYZ raster tile alternative

For larger layers (e.g. regional/nationwide data), host XYZ raster tiles on an appropriate service and add:

```json
"raster": {
  "type": "xyz",
  "tiles": ["https://your-tile-provider.example/habitat/2026-10-18/{z}/{x}/{y}.png"],
  "tileSize": 256,
  "minzoom": 0,
  "maxzoom": 15
}
```

These are **Web Mercator XYZ map tiles**, not arbitrary GeoTIFF rasters. MapLibre uses them as ordinary raster tiles. If a tile provider requires CORS, caching, attribution or credentials, arrange these on the host/renderer and avoid publishing secrets.

## Suggested metadata additions

The current app will ignore new fields until the UI is extended, so you can safely add:

- `acquired_start`, `acquired_end`, `processed_at`, `valid_until`
- `source_sensors`, `processing_chain`, `model_version`, `training_dataset`
- `quality_flags`, `cloud_fraction`, `uncertainty_layer`
- `licence`, `attribution`, `doi`, `notes`
- per-feature `habitat_type`, `validation_status`, `confidence`, `sample_size`

For a real wildlife service, distinguish **EO acquisition date**, **model production date**, and **forecast validity time**. An inference updated weekly is not automatically a new animal observation.
