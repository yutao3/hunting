#!/usr/bin/env python3
"""Generate FICTIONAL georeferenced example raster/vector layers for UI testing only.

No wildlife observations, environmental measurements or real predictions are used.
"""
from __future__ import annotations
import json
from pathlib import Path
import math
import random
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'snapshots'
DEST.mkdir(parents=True, exist_ok=True)
BOUNDS = [7.55,47.67,8.85,48.56]  # west south east north; Black Forest test extent
DATES = ['2026-09-27','2026-10-04','2026-10-11']
SPECIES = [('roe_deer','Roe deer'),('wild_boar','Wild boar')]


def polygon(lon,lat,rx,ry,rng,points=9):
    angles=[2*math.pi*k/points for k in range(points)]
    radii=[rng.uniform(.78,1.14) for _ in angles]
    coords=[[round(lon+rx*r*math.cos(a),6),round(lat+ry*r*math.sin(a),6)] for a,r in zip(angles,radii)]
    coords.append(coords[0]);return {'type':'Polygon','coordinates':[coords]}


def raster(seeds,filename):
    h,w=560,790
    X,Y=np.meshgrid(np.linspace(BOUNDS[0],BOUNDS[2],w,dtype=np.float32),np.linspace(BOUNDS[3],BOUNDS[1],h,dtype=np.float32))
    field=np.zeros((h,w),dtype=np.float32)
    for lon,lat,value,sx,sy in seeds:
        field+=value*np.exp(-(((X-lon)/sx)**2+((Y-lat)/sy)**2)/2)
    field=np.clip(field,0,100)
    knots=[(0,(244,222,183)),(25,(233,191,119)),(50,(169,209,142)),(75,(93,169,134)),(100,(23,93,71))]
    rgba=np.empty((h,w,4),dtype=np.uint8)
    for c in range(3): rgba[:,:,c]=np.interp(field,[k[0] for k in knots],[k[1][c] for k in knots]).astype(np.uint8)
    # Unmodelled background stays transparent; do not imply precise coverage.
    rgba[:,:,3]=np.where(field<19,0,np.clip((field-18)*6,0,185)).astype(np.uint8)
    Image.fromarray(rgba,'RGBA').save(filename,optimize=True)


def main():
    catalog={'schema_version':'1.0','title':'SAIIL Wildlife Habitat Explorer',
        'description':'Synthetic demo only. Replace datasets with your own verified EO products.',
        'species': [{'id':s,'label':label} for s,label in SPECIES],
        'datasets':[]}
    for species,label in SPECIES:
        for step,date in enumerate(DATES):
            seed=181+step*199+(1000 if species=='wild_boar' else 0)
            rng=random.Random(seed)
            offset=.01 if species=='wild_boar' else 0
            records=[];seeds=[]
            for j in range(17):
                lon=7.65+(j%5)*.242+rng.uniform(-.045,.045)
                lat=47.79+(j//5)*.206+rng.uniform(-.035,.035)+offset
                if lon>8.79 or lat>48.49:continue
                value=min(97,max(31,math.floor(56+23*math.sin(j*1.89+step*.7)+(rng.random()-.5)*18)))
                category=('Woodland mosaic' if j%3==0 else 'Vegetation pattern' if j%3==1 else 'Field interface')
                uid=f'{species[:3]}-{date}-{j:02}'
                records.append({'type':'Feature','id':uid,'geometry':polygon(lon,lat,.035+rng.random()*.015,.021+rng.random()*.018,rng),
                    'properties':{'id':uid,'kind':'habitat','name':f'Sample habitat area {j+1:02d}','score':value,'class':category,
                    'indicator':'Illustrative combined index','confidence':'Not estimated','source':'Synthetic demo fixture',
                    'note':'Fictional geometry and score for interface development only. Not a validated habitat estimate.'}})
                seeds.append((lon,lat,float(value),.07,.056))
            for j in range(6):
                lon=7.8+j*.16+rng.uniform(-.035,.035)
                lat=47.77+(j%3)*.29+rng.uniform(-.02,.02)
                if lon>8.79:continue
                uid=f'chg-{species[:3]}-{date}-{j:02d}'
                records.append({'type':'Feature','id':uid,'geometry':polygon(lon,lat,.025,.014,rng),
                    'properties':{'id':uid,'kind':'change','name':f'Example change zone {j+1:02d}',
                    'indicator':'Possible clearing' if j%2 else 'Crop change',
                    'source':'Synthetic demo fixture','note':'Fictional change polygon. No satellite change analysis has been performed.'}})
            identifier=f'{species}-{date}'
            raster(seeds,DEST/f'{identifier}.png')
            (DEST/f'{identifier}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':records},indent=2)+'\n',encoding='utf-8')
            catalog['datasets'].append({
                'id':identifier,'species':species,'date':date,'region':'Black Forest (DE)',
                'extent':BOUNDS,'status':'synthetic','resolution':'Demonstration only',
                'description':'Illustrative data only. Nothing on this map indicates real animal presence, sightings or scientifically derived habitat suitability.',
                'geojson':f'./snapshots/{identifier}.geojson',
                'raster':{'type':'image','url':f'./snapshots/{identifier}.png','bounds':BOUNDS,'units':'illustrative index 0–100'}
            })
    (ROOT/'data'/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n',encoding='utf-8')
    print(f'Generated {len(catalog["datasets"])} DEMO datasets in {DEST}')

if __name__=='__main__':main()
