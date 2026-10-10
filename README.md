# SAIIL Wildlife Habitat Explorer

A **static, GitHub Pages-ready** interactive web map for precomputed wildlife habitat and environmental-change products. Designed as a research/data explorer with a dashboard layout: summary statistics, a map, filters, layer toggles, GeoJSON export and a metadata panel.

**The bundled geographic layers are entirely SYNTHETIC and illustrative.** They must not be interpreted as animal occurrences, validated habitat models or hunting recommendations. The UI does not perform Sentinel-2 analytics itself: you process EO data **offline** and publish your new raster/vector products as static assets.

**Live domain after you configure it:** `https://hunting.saiil.co.uk/` (not automatically deployed by this archive).

## Features included

- Interactive map (MapLibre GL JS) with map/satellite basemaps, pan, zoom, coordinates and a pilot extent.
- Species selected from `data/catalog.json` (new species can be added without modifying JavaScript).
- Newest-first observation/dataset selection from the catalogue.
- Transparent, georeferenced PNG raster overlay (`image` source) or externally hosted XYZ PNG tiles (`xyz` source).
- WGS84 polygon GeoJSON, score threshold, landscape-change polygons and feature details.
- Layer visibility and opacity controls; downloadable filtered vector layers for the current map view.
- Map status, provenance metadata, score distribution by polygon count, responsive layout.
- No accounts, cloud processing, tracking, or backend required for this version.

## Repository layout

```
index.html                         # root entry point for GitHub Pages
CNAME                              # hunting.saiil.co.uk
.nojekyll                          # publish assets as-is
assets/app.js                      # map and UI logic
assets/styles.css                  # responsive styling
assets/favicon.svg
data/catalog.json                 # public dataset catalogue / schema examples
data/snapshots/*.geojson          # geographic polygons, WGS84
data/snapshots/*.png              # pre-rendered RGBA heatmaps
scripts/make_synthetic_demo.py    # reproducible synthetic test data, NOT analysis
scripts/publish_snapshot.py       # add your offline GeoJSON/GeoTIFF products
scripts/requirements.txt          # optional Python raster processing dependencies
docs/data-guide.html              # live help/attribution reference
docs/SCHEMA.md                    # data contract & extension guidance
```

## Run locally

Download/unzip the project, then run the following **inside the project root**:

```bash
python3 -m http.server 8000
```

Open <http://localhost:8000>. Opening `index.html` as `file://` will generally fail because the browser cannot fetch JSON/GeoJSON.

The map and basemap tiles need internet access (MapLibre JavaScript/CSS is loaded from `unpkg.com`, and basemap tiles are fetched from their respective providers).

## Publish on GitHub Pages with a SAIIL subdomain

1. Create a **public** repository, for example `yutao3/wildlife-habitat-explorer`.
2. Upload **the contents of this archive to the root**, including the root `index.html` and `CNAME`. Do not add an extra parent folder around them.
3. Push/commit to `main` (no build step needed).
4. Open GitHub repository **Settings → Pages** and select **Deploy from a branch** → `main` → `/ (root)` → **Save**.
5. In your DNS provider for `saiil.co.uk`, create or update a DNS record:

   | Type | Host | Target |
   |---|---|---|
   | CNAME | `hunting` | `yutao3.github.io` |

   There should not be conflicting `A`, `AAAA` or extra CNAME entries for `hunting`.
6. In GitHub **Settings → Pages**, set **Custom domain** to `hunting.saiil.co.uk` and save. This archive already includes a matching root `CNAME` file for branch deployment.
7. After DNS validation/certificate issuance, enable **Enforce HTTPS**.

Do not point the DNS CNAME at `yutao3.github.io/wildlife-habitat-explorer` — it must point to the **hostname only**.

If you choose another hostname, update both DNS and the root `CNAME` file. When accessed via the repository's normal `https://yutao3.github.io/wildlife-habitat-explorer/` path before your custom domain works, relative app/data asset URLs should still work.

## Replace example data with your actual EO products

**Option 1: Publish WGS84 polygons only**

```bash
python3 scripts/publish_snapshot.py \
  --species roe_deer \
  --date 2026-10-18 \
  --geojson /path/to/roe_habitat.geojson \
  --extent 7.55 47.67 8.85 48.56 \
  --region 'Black Forest' \
  --status modelled \
  --resolution '20 m'
```

**Option 2: Publish polygon GeoJSON + a single-band score GeoTIFF**

Install one-time:

```bash
python3 -m pip install -r scripts/requirements.txt
```

Then publish:

```bash
python3 scripts/publish_snapshot.py \
  --species wild_boar \
  --date 2026-10-18 \
  --geojson /path/to/habitat_polygons.geojson \
  --geotiff /path/to/habitat_score_0_100.tif \
  --region 'Black Forest' \
  --status modelled \
  --resolution '20 m'
```

This command:

- Checks vector input as a WGS84 GeoJSON FeatureCollection.
- Validates habitat polygon properties, including `kind="habitat"` and numeric `score` within 0–100.
- Reprojects a georeferenced raster to WGS84 and converts its first band to a transparent RGBA PNG. Default image dimension is limited to 2,000 pixels. Set `--input-min` and `--input-max` to map your real values onto 0–100.
- Writes new files to `data/snapshots/` and adds/replaces a corresponding entry in `data/catalog.json`.
- Doesn't run any habitat estimation itself; it only converts and publishes **your** scores.

**Option 3: Reference a separately hosted rendered PNG**

```bash
python3 scripts/publish_snapshot.py \
  --species roe_deer --date 2026-10-25 \
  --raster-url https://example.com/eo/roe_20261025.png \
  --raster-bounds 7.55 47.67 8.85 48.56 \
  --status modelled --region 'Black Forest'
```

Use only public HTTPS URLs with suitable cross-origin access; don't use private signed URLs in a public GitHub Pages catalogue.

After changing data, commit `data/catalog.json` and new files. Refreshing the page fetches the new products (no code change required).

## Operational scaling

This MVP uses a **single image overlay for each regional raster**. For Germany-wide 10–20 m data, do **not** upload one immense PNG or many raw GeoTIFFs into the GitHub repository. Instead publish properly tiled `XYZ`/PMTiles/COGs behind an efficient tile service or on suitable public object storage/CDN. The current JavaScript supports XYZ raster tiles via a catalogue entry, described in `docs/SCHEMA.md`. A full direct COG viewer would need additional browser code or a COG tile service; it is **not** implemented here.

Large/private datasets, login, access controls, camera uploads, and private Revier boundaries require backend infrastructure, authentication and an appropriate permissions model. GitHub Pages is a **public static host** and must not store confidential records.

## Quality checks

Run `python3 scripts/validate_catalog.py` to check the catalogue and local data references. The sample data was generated with `python3 scripts/make_synthetic_demo.py`. This repository does not contain wildlife model training pipelines; those remain your future offline R&D.

## Limitations & licences

- Synthetic data only, including the raster image and polygons. No real scores or detections.
- The normalised `score` is not a calibrated sighting probability.
- Heatmap opacity does not alter numeric score values; the slider threshold filters polygons only.
- Vector export includes features intersecting the viewport approximately; polygons are **not clipped** to the viewport. Raster exports are not included.
- Browser basemap services depend on third parties and their availability/terms. Check imagery licensing before commercial launch. The demo's satellite view uses Esri World Imagery and has provider attribution; other map uses CARTO/OSM attribution.
- MapLibre GL JS is open source, loaded via a version-pinned CDN. No build or bundler required.
- You must not publicly publish camera/sighting locations or private hunting boundaries without appropriate rights and privacy protections.

This example project is original code authored for SAIIL. It draws layout inspiration from the publicly visible [PV facility dataset explorer](https://pvfacilitymap.uk/) but does not copy its source code/assets or datasets.
