#!/usr/bin/env python3
"""Publish an offline EO output as static data for the SAIIL Habitat Explorer.

Accepts GeoJSON WGS84 FeatureCollections (habitat/change polygons) and/or a
single-band georeferenced score GeoTIFF (numeric 0..100 by default). Converts
GeoTIFF to a transparent RGBA PNG in WGS84 + adds the georeferencing bounds to
catalog.json. For large datasets publish XYZ tiles or use a tile backend instead.

Example:
 python scripts/publish_snapshot.py --species roe_deer --date 2026-10-18 \\
   --geojson outputs/habitat.geojson --geotiff outputs/score.tif \\
   --region 'Black Forest' --status modelled --resolution '20 m'
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import re
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
CATALOG=ROOT/'data'/'catalog.json'
SNAPSHOTS=ROOT/'data'/'snapshots'


def geojson_validate(path):
    longitudes=[];latitudes=[]
    obj=json.loads(path.read_text(encoding='utf8'))
    if obj.get('type')!='FeatureCollection' or not isinstance(obj.get('features'),list):
        raise ValueError('GeoJSON must be a FeatureCollection with a features array.')
    for i,f in enumerate(obj['features']):
        if f.get('type')!='Feature' or f.get('geometry') is None:raise ValueError(f'Invalid Feature at index {i}')
        if f.get('properties',{}).get('kind') not in ('habitat','change'):
            raise ValueError(f'Feature {i}: properties.kind must be habitat or change.')
        if f.get('properties',{}).get('kind')=='habitat':
            score=f.get('properties',{}).get('score')
            if not isinstance(score,(float,int)) or not 0<=score<=100:
                raise ValueError(f'Feature {i}: habitat score must be numeric 0..100.')
        def validate_coordinates(node):
            if isinstance(node,list) and len(node)>=2 and all(isinstance(v,(int,float)) for v in node[:2]):
                lon,lat=node[:2]
                longitudes.append(lon);latitudes.append(lat)
                if not -180<=lon<=180 or not -90<=lat<=90:raise ValueError(f'Feature {i}: coordinates must be WGS84 [lon, lat].')
            elif isinstance(node,list):
                for sub in node:validate_coordinates(sub)
        validate_coordinates(f['geometry'].get('coordinates'))
    bounds=[min(longitudes),min(latitudes),max(longitudes),max(latitudes)] if longitudes else None
    return len(obj['features']),bounds


def rgba_from_tif(input_path, output_path, minval, maxval, max_dimension):
    try:
        import rasterio
        from rasterio.warp import calculate_default_transform,reproject,Resampling
    except ImportError as exc:raise SystemExit('Install optional raster dependencies: pip install -r scripts/requirements.txt') from exc
    from PIL import Image
    with rasterio.open(input_path) as ds:
        if ds.crs is None:raise ValueError('GeoTIFF must contain CRS metadata.')
        if ds.count<1:raise ValueError('GeoTIFF has no raster bands.')
        if ds.transform.is_identity:raise ValueError('GeoTIFF has no georeferencing affine transform.')
        tr,w,h=calculate_default_transform(ds.crs,'EPSG:4326',ds.width,ds.height,*ds.bounds)
        scale=min(1,max_dimension/max(w,h));w=max(1,round(w*scale));h=max(1,round(h*scale))
        if scale<1:
            from affine import Affine
            tr=tr*Affine.scale(1/scale)
        out=np.zeros((h,w),dtype=np.float32)
        mask=np.zeros((h,w),dtype=np.uint8)
        reproject(source=rasterio.band(ds,1),destination=out,src_transform=ds.transform,src_crs=ds.crs,
                  src_nodata=ds.nodata,dst_transform=tr,dst_crs='EPSG:4326',dst_nodata=np.nan,resampling=Resampling.bilinear)
        reproject(source=ds.dataset_mask(),destination=mask,src_transform=ds.transform,src_crs=ds.crs,
                  dst_transform=tr,dst_crs='EPSG:4326',resampling=Resampling.nearest)
        valid=(mask>0)&np.isfinite(out)
        scaled=np.clip((np.where(valid,out,minval)-minval)/(maxval-minval)*100,0,100)
        control=np.array([0,25,50,75,100],dtype=float)
        colors=np.array([(244,222,183),(233,191,119),(169,209,142),(93,169,134),(23,93,71)])
        rgba=np.zeros((h,w,4),dtype=np.uint8)
        for ch in range(3):rgba[:,:,ch]=np.interp(scaled,control,colors[:,ch]).astype(np.uint8)
        rgba[:,:,3]=(valid.astype(np.uint8)*190)
        Image.fromarray(rgba,'RGBA').save(output_path,optimize=True)
        west,north=tr*(0,0);east,south=tr*(w,h)
        return [round(float(west),8),round(float(south),8),round(float(east),8),round(float(north),8)]


def main():
    ap=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--species',required=True,help='Species ID e.g. roe_deer / wild_boar')
    ap.add_argument('--date',required=True,help='YYYY-MM-DD')
    ap.add_argument('--geojson',type=Path)
    ap.add_argument('--geotiff',type=Path)
    ap.add_argument('--raster-url',help='Optional remote rendered PNG URL (with --raster-bounds)')
    ap.add_argument('--raster-bounds',type=float,nargs=4,metavar=('WEST','SOUTH','EAST','NORTH'))
    ap.add_argument('--region',default='Custom study area')
    ap.add_argument('--status',default='modelled',choices=['synthetic','modelled','validated'])
    ap.add_argument('--resolution',default='Not specified')
    ap.add_argument('--description',default='EO-derived habitat product. See project metadata for limitations.')
    ap.add_argument('--extent',type=float,nargs=4,metavar=('WEST','SOUTH','EAST','NORTH'))
    ap.add_argument('--input-min',type=float,default=0)
    ap.add_argument('--input-max',type=float,default=100)
    ap.add_argument('--max-raster-size',type=int,default=2000,help='Maximum PNG width or height; large rasters need tiles')
    args=ap.parse_args()
    if not (args.geojson or args.geotiff or args.raster_url):ap.error('Supply at least one of --geojson, --geotiff or --raster-url.')
    if args.raster_url and (args.geotiff or not args.raster_bounds):ap.error('--raster-url requires --raster-bounds and cannot be used with --geotiff')
    if args.input_max<=args.input_min:ap.error('--input-max must exceed --input-min')
    if args.max_raster_size<64:ap.error('--max-raster-size must be >=64')
    if not re.fullmatch(r'[a-z][a-z0-9_]*',args.species):ap.error('Species must be lowercase letters/digits/underscores.')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',args.date):ap.error('Date must be YYYY-MM-DD.')
    from datetime import date as Dat
    Dat.fromisoformat(args.date)
    if args.geojson and not args.geojson.is_file():ap.error(f'GeoJSON not found: {args.geojson}')
    if args.geotiff and not args.geotiff.is_file():ap.error(f'GeoTIFF not found: {args.geotiff}')
    if not CATALOG.is_file():ap.error('data/catalog.json missing')
    catalog=json.loads(CATALOG.read_text(encoding='utf8'))
    identifier=f'{args.species}-{args.date}'
    data={'id':identifier,'species':args.species,'date':args.date,'region':args.region,
          'status':args.status,'description':args.description,'resolution':args.resolution}
    SNAPSHOTS.mkdir(exist_ok=True,parents=True)
    vector_extent=None
    if args.geojson:
        count,vector_extent=geojson_validate(args.geojson)
        dest=SNAPSHOTS/f'{identifier}.geojson'
        shutil.copyfile(args.geojson,dest) if args.geojson.resolve()!=dest.resolve() else None
        data['geojson']=f'./snapshots/{dest.name}'
        print(f'Validated {count} GeoJSON features')
    if args.geotiff:
        dest=SNAPSHOTS/f'{identifier}.png'
        bbox=rgba_from_tif(args.geotiff,dest,args.input_min,args.input_max,args.max_raster_size)
        data['raster']={'type':'image','url':f'./snapshots/{dest.name}','bounds':bbox,'units':'normalised score index (0–100)'}
    elif args.raster_url:
        data['raster']={'type':'image','url':args.raster_url,'bounds':args.raster_bounds,'units':'normalised score index (0–100)'}
    extent=args.extent or data.get('raster',{}).get('bounds') or vector_extent
    if extent:
        if not(-180<=extent[0]<extent[2]<=180 and -90<=extent[1]<extent[3]<=90):ap.error('Invalid WGS84 bounds/extent')
        data['extent']=list(extent)
    catalog['datasets']=[d for d in catalog['datasets'] if d.get('id')!=identifier]+[data]
    if not any(s.get('id')==args.species for s in catalog.get('species',[])):
        catalog.setdefault('species',[]).append({'id':args.species,'label':args.species.replace('_',' ').title()})
    CATALOG.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(f'Published {identifier}; commit data/catalog.json and the new snapshot files.')

if __name__=='__main__':main()
