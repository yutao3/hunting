# Adding, replacing and removing analytics layers

**No JavaScript changes are needed.** Every map layer comes from one file: `data/layers.json` (the *manifest*).

- **Add:** put the data file in `data/layers/` and add one entry to the manifest.
- **Replace:** overwrite the file (same name). It updates on the next reload.
- **Remove:** delete the entry from the manifest. You can delete the file too.

Commit and push to `dev_v0`. GitHub Pages updates hunting.saiil.co.uk in about 1 minute. Then do a hard refresh (Cmd+Shift+R).

> Before committing, run `python3 scripts/validate_layers.py`. It catches JSON typos, missing files, bad bounds and projected coordinates.

---

## 1. Rules for every file

| Rule | Why |
|---|---|
| **CRS = EPSG:4326 (WGS84 lon/lat)** for GeoJSON coordinates and raster `bounds` | The web map expects lon/lat. Projected metres (e.g. UTM 32N, EPSG:25832) will put data in the wrong place or fail. |
| Coordinates are `[longitude, latitude]` | This is the GeoJSON standard (RFC 7946). It's a common mistake to swap them. |
| Dates are ISO `YYYY-MM-DD` | Used for sorting and for the date archive. |
| Paths are **relative to `data/layers.json`** | e.g. `"layers/my_file.geojson"`. Full `https://` URLs also work if that server allows CORS. |
| Keep files small: GeoJSON < 5 MB, PNG < 2 MB | The site is used over slow or VPN links (e.g. from China). |
| Label synthetic or unvalidated data with `"status": "synthetic"` / `"modelled"` | Shown in the badge, provenance and click panel. |

---

## 2. Polygon layer (GeoJSON)

**File:** a `FeatureCollection` of Polygons/MultiPolygons (Points and Lines also draw). Put a numeric score in `properties` if you want colouring, filtering and the histogram:

```json
{"type":"FeatureCollection","features":[
  {"type":"Feature",
   "geometry":{"type":"Polygon","coordinates":[[[8.10,48.00],[8.12,48.00],[8.12,48.01],[8.10,48.00]]]},
   "properties":{"id":"p001","name":"Patch 1","score":72,"class":"Forest edge","ndvi":0.71,"canopy_cover_pct":64}}
]}
```

Every property shows in the click panel. `id` and `name` are optional but recommended. Area is computed automatically.

**Manifest entry:**

```json
{
  "id": "habitat-polygons-roe-deer",
  "title": "Habitat score polygons",
  "type": "geojson",
  "group": "Habitat suitability",
  "species": "roe_deer",
  "role": "primary",
  "date": "2026-10-11",
  "url": "layers/habitat_score_polygons_roe_deer_2026-10.geojson",
  "description": "Candidate roe deer habitat patches coloured by score.",
  "source": "SAIIL Sentinel-2 pipeline v0.3",
  "status": "modelled",
  "resolution": "10 m",
  "visibleByDefault": true,
  "style": {
    "scoreField": "score", "min": 0, "max": 100,
    "ramp": [[0,"#f7f4b5"],[50,"#a7d38c"],[100,"#0f5a46"]],
    "opacity": 0.6, "outlineColor": "#f2fff6", "outlineWidth": 1.3,
    "filterByScore": true
  }
}
```

For a layer without scores (e.g. water), use `"style": {"color": "#2b8cff", "opacity": 0.55, "outlineColor": "#0b4f9c"}`. Add `"dashed": true` for a dashed outline.

**Make it small:** use https://mapshaper.org (drag in the file → Simplify → ~10% → Export GeoJSON), or GDAL:

```bash
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -simplify 0.0002 -lco COORDINATE_PRECISION=5 out.geojson in.gpkg
```

---

## 3. Raster mask / heatmap (georeferenced PNG + bounds)

The browser can't read GeoTIFF directly, so we publish a **coloured RGBA PNG** (transparent = no data) plus its **bounds** `[west, south, east, north]` in EPSG:4326.

```json
{
  "id": "ndvi-2026-10",
  "title": "Vegetation vigour (NDVI)",
  "type": "raster-image",
  "group": "Landscape indicators",
  "date": "2026-10-11",
  "url": "layers/ndvi_2026-10.png",
  "bounds": [7.55, 47.67, 8.85, 48.56],
  "description": "Sentinel-2 L2A NDVI, cloud-masked median.",
  "source": "Copernicus Sentinel-2 / SAIIL",
  "status": "modelled",
  "visibleByDefault": false,
  "style": {"opacity": 0.7, "min": 0, "max": 1,
            "ramp": [[0,"#a6611a"],[0.5,"#a6d96a"],[1,"#00441b"]], "legendLabel": "NDVI"}
}
```

The colours are baked into the PNG. `style.ramp` only draws the legend, so keep the two in sync.

### GeoTIFF → PNG + bounds with GDAL

```bash
# 1. Reproject to Web Mercator. MapLibre stretches images in Web Mercator, so this
#    keeps large regions geometrically exact. Cap the size at ~2000 px.
gdalwarp -t_srs EPSG:3857 -r bilinear -ts 2000 0 -dstnodata 0 ndvi.tif ndvi_3857.tif

# 2. Colour it. ramp.txt maps value -> R G B A ("nv" = nodata -> transparent):
#      nv    0   0   0   0
#      0.0 166  97  26 200
#      0.5 166 217 106 200
#      1.0   0  68  27 220
gdaldem color-relief -alpha ndvi_3857.tif ramp.txt ndvi_rgba.tif

# 3. PNG
gdal_translate -of PNG ndvi_rgba.tif data/layers/ndvi_2026-10.png

# 4. Bounds in EPSG:4326 for the manifest -> copy [west, south, east, north]
gdalinfo -json ndvi_3857.tif | python3 -c "import json,sys;c=json.load(sys.stdin)['wgs84Extent']['coordinates'][0];xs=[p[0] for p in c];ys=[p[1] for p in c];print([round(min(xs),6),round(min(ys),6),round(max(xs),6),round(max(ys),6)])"
```

Alternatively, `scripts/publish_snapshot.py --geotiff` (in this repo) already converts a single-band 0–100 GeoTIFF into a transparent PNG. Copy the PNG and the bounds it prints into a manifest entry.

---

## 4. Date archive (several dates of one layer)

Replace `date` + `url` with a `versions` list. The **Dataset date** dropdown lists every date across all layers. Each layer then shows its newest version **on or before** the selected date (marked "nearest" if the date isn't an exact match).

```json
"versions": [
  {"date": "2026-10-11", "url": "layers/habitat_score_polygons_roe_deer_2026-10.geojson"},
  {"date": "2026-09-27", "url": "layers/habitat_score_polygons_roe_deer_2026-09.geojson"},
  {"date": "2026-08-30", "url": "layers/habitat_score_polygons_roe_deer_2026-08.geojson",
   "source": "older pipeline v0.2", "bounds": [7.5, 47.6, 8.9, 48.6]}
]
```

A version can override `bounds`, `source`, `status`, `resolution` and `description`. To add a new month, add one line at the top and commit the file.

---

## 5. All manifest fields

| Field | Required | Meaning |
|---|---|---|
| `id` | ✔ | Unique, URL-safe (`a-z0-9-`). |
| `title` | ✔ | Name in the layer panel. |
| `type` | ✔ | `geojson` · `raster-image` · `xyz-tiles` · `pmtiles` |
| `url` + `date` **or** `versions[]` | ✔ | The data. Relative to `data/layers.json`. |
| `bounds` | raster-image | `[west, south, east, north]`, EPSG:4326. |
| `group` | | Panel heading (default "Layers"). |
| `species` | | `"roe_deer"` or `["roe_deer","wild_boar"]`. Leave it out for all species. Species buttons come from top-level `species`. |
| `role` | | `"primary"` = the layer whose date/source feed the provenance panel. |
| `visibleByDefault` | | `true` / `false` (default true). |
| `description`, `source`, `status`, `resolution`, `attribution` | | Shown in the panel and provenance. `attribution` also appears in the map credits. |
| `style.scoreField`, `min`, `max`, `ramp` | | Score colouring, legend, histogram and min-score filter. `ramp` = `[[value, "#hex"], …]` ascending. |
| `style.filterByScore` | | `false` = ignore the min-score slider for this layer. |
| `style.color`, `outlineColor`, `outlineWidth`, `dashed`, `opacity` | | Plain styling. |
| `style.legendLabel` | | Legend caption. |
| `style.tileSize`, `minzoom`, `maxzoom` | tiles | For `xyz-tiles` / `pmtiles`. |
| `style.kind`, `style.sourceLayer` | pmtiles | `"raster"` (default) or `"vector"` + the vector tile layer name. |

Top level: `region` (`name`, `bounds` used by "Fly to"/"Reset"), `defaults` (`minScore`, `basemap`: `satellite`|`streets`), `species` (`[{id,label}]`), `status`.

---

## 6. Scaling up later (Germany / Europe at 10 m)

A single PNG works for a pilot region (up to ~2000 px). For bigger areas, use **tiles**: the image is cut into a pyramid of 256 px tiles per zoom level, and the browser only fetches what's on screen.

**PMTiles** is a single file holding the whole pyramid. It can be hosted on any static host or object storage that supports HTTP range requests (GitHub Pages works for small files; use Cloudflare R2 / S3 with CORS for large ones; GitHub has a 100 MB file limit).

```bash
# Raster: GeoTIFF -> coloured MBTiles -> PMTiles
gdaldem color-relief -alpha ndvi_3857.tif ramp.txt ndvi_rgba.tif
gdal_translate -of MBTiles ndvi_rgba.tif ndvi.mbtiles && gdaladdo -r average ndvi.mbtiles 2 4 8 16 32
pmtiles convert ndvi.mbtiles ndvi.pmtiles          # https://github.com/protomaps/go-pmtiles
# Vector: GeoJSON -> PMTiles
tippecanoe -o habitat.pmtiles -l habitat -zg --drop-densest-as-needed habitat.geojson
```

```json
{"id":"ndvi-de","title":"NDVI Germany","type":"pmtiles","url":"https://<bucket>/ndvi.pmtiles","date":"2026-10-11",
 "style":{"kind":"raster","opacity":0.7}}
{"id":"habitat-de","title":"Habitat DE","type":"pmtiles","url":"https://<bucket>/habitat.pmtiles","date":"2026-10-11",
 "style":{"kind":"vector","sourceLayer":"habitat","scoreField":"score","ramp":[[0,"#f7f4b5"],[100,"#0f5a46"]]}}
```

> Note: vector PMTiles draw and colour by score, but the histogram, click details and download use full-feature GeoJSON layers only.

**COG (Cloud-Optimised GeoTIFF)** keeps the original values. Serve it through a tile server (e.g. TiTiler) and add it as `xyz-tiles`:

```json
{"id":"ndvi-cog","title":"NDVI (COG)","type":"xyz-tiles","date":"2026-10-11",
 "url":"https://<titiler>/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=https://<bucket>/ndvi_cog.tif&rescale=0,1&colormap_name=greens",
 "attribution":"Contains modified Copernicus Sentinel data 2026"}
```

---

## 7. Troubleshooting

- **The layer doesn't appear in the panel.** Open the browser console (F12). Lines starting `[layers.json]` say why the entry was skipped. Also run `scripts/validate_layers.py`.
- **"Layer failed: … HTTP 404".** The path is wrong. It's relative to `data/`, and the file name is case-sensitive on GitHub Pages.
- **Polygons appear near Africa (0°, 0°) or nowhere.** The coordinates aren't lon/lat. Reproject with `ogr2ogr -t_srs EPSG:4326`.
- **Raster is shifted or stretched.** Check the bounds order `[W, S, E, N]`, and warp to EPSG:3857 before making the PNG (step 1 above).
- **Old data still shows.** Do a hard refresh. GitHub Pages caches for up to 10 minutes.
