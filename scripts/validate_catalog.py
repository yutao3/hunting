#!/usr/bin/env python3
"""Validate the public static catalogue and local GeoJSON/raster resources."""
from pathlib import Path
from urllib.parse import urlparse
import json
import re
import sys

BASE=Path(__file__).resolve().parents[1]/'data'

def local_path(url):
    parsed=urlparse(url)
    if parsed.scheme in ('http','https'):return None
    if parsed.scheme:raise ValueError(f'Unsupported URL scheme in {url}')
    dest=(BASE/url).resolve()
    if not dest.is_relative_to(BASE):raise ValueError(f'Path escapes data/: {url}')
    return dest


def validate():
    catalogue=json.loads((BASE/'catalog.json').read_text(encoding='utf8'))
    assert catalogue.get('schema_version')=='1.0'
    species={s['id'] for s in catalogue.get('species',[])}
    seen=set()
    for product in catalogue['datasets']:
        ident=product['id'];assert ident not in seen,f'Duplicate id {ident}';seen.add(ident)
        assert re.fullmatch(r'\d{4}-\d{2}-\d{2}',product['date']),ident
        assert product['species'] in species,ident
        if product.get('extent'):
            w,s,e,n=product['extent'];assert -180<=w<e<=180 and -90<=s<n<=90,ident
        if product.get('geojson'):
            local=local_path(product['geojson'])
            if local:
                assert local.is_file(),str(local)
                geo=json.loads(local.read_text(encoding='utf8'))
                assert geo['type']=='FeatureCollection',ident
                for f in geo['features']:
                    p=f.get('properties',{})
                    assert p.get('kind') in ('habitat','change'),ident
                    if p['kind']=='habitat':assert 0<=p['score']<=100,ident
        if product.get('raster'):
            raster=product['raster']
            if raster['type']=='image':
                w,s,e,n=raster['bounds'];assert -180<=w<e<=180 and -90<=s<n<=90,ident
                local=local_path(raster['url'])
                if local:assert local.is_file(),str(local)
            elif raster['type']=='xyz':assert raster['tiles'],ident
            else:raise ValueError(f'Unknown raster type: {raster["type"]}')
    print(f'PASS: {len(seen)} entries; local vector/raster paths and metadata validated')

if __name__=='__main__':
    try:validate()
    except Exception as exc:print('FAIL:',exc,file=sys.stderr);sys.exit(1)
