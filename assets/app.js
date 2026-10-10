/* SAIIL Wildlife Habitat Explorer — static frontend, no user tracking or backend. */
const DATA_URL = new URL('../data/catalog.json', import.meta.url);
const DEFAULT_EXTENT = [7.55, 47.67, 8.85, 48.56];
const SCORE_STOPS = [[0, '#f4deb7'], [25, '#e9bf77'], [50, '#a9d18e'], [75, '#5da986'], [100, '#175d47']];
const layerIds = ['heatmap-image', 'heatmap-tiles', 'habitat-outline', 'habitat-fill', 'change-outline', 'change-fill'];
const sourceIds = ['source-image', 'source-tiles', 'source-geojson'];
const $ = (id) => document.getElementById(id);
const state = { species: 'roe_deer', snapshot: null, catalog: null, data: null, map: null, basemap: 'streets', sequence: 0, currentStatus: 'initialising' };
const formatDate = (d) => { const dt = new Date(`${d}T12:00:00Z`); return Number.isNaN(dt.valueOf()) ? d : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone:'UTC' }); };
const cleanText = (val) => String(val ?? '—');
const resolveURL = (path) => new URL(path, DATA_URL).href.replace(/%7B(z|x|y|s|ratio)%7D/gi, (_match, key) => `{${key.toLowerCase()}}`);
const setText = (id, val) => { $(id).textContent = cleanText(val); };
const habitat = (f) => f?.properties?.kind === 'habitat';
const change = (f) => f?.properties?.kind === 'change';
const score = (f) => Number(f?.properties?.score ?? 0);
const eligible = (f) => habitat(f) && score(f) >= Number($('score-threshold').value);
const features = () => state.data?.features || [];
const selectedSnapshot = () => state.catalog?.datasets?.find(d => d.id === state.snapshot) ?? null;

function warn(message) {
  const target = $('map-alert');
  target.textContent = message;
  target.hidden = false;
  console.error(message);
}
function clearWarn() { $('map-alert').hidden = true; }
function baseStyle() {
  return {
    version: 8,
    sources: {
      streets: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'},
      satellite: { type:'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize:256, attribution:'Tiles © Esri and imagery providers' }
    },
    layers: [
      {id:'base-streets',type:'raster',source:'streets',layout:{visibility:'visible'}},
      {id:'base-satellite',type:'raster',source:'satellite',layout:{visibility:'none'}}
    ]
  };
}
function initialiseMap() {
  if (!window.maplibregl) { warn('MapLibre did not load from the CDN. Check your internet access or the CDN script in index.html.'); return; }
  const map = new maplibregl.Map({ container: 'map', style:baseStyle(), center:[8.19,48.09], zoom:8.4, minZoom:3, maxZoom:18, attributionControl:false });
  state.map = map;
  map.addControl(new maplibregl.NavigationControl({visualizePitch:true}), 'top-right');
  map.addControl(new maplibregl.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
  map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
  map.on('load', () => { if (state.catalog) loadSnapshot(); });
  map.on('mousemove',(e)=>{
    setText('coordinates',`${e.lngLat.lat.toFixed(5)}° N  ·  ${e.lngLat.lng.toFixed(5)}° E`);
    const layers = ['habitat-fill','change-fill'].filter(id => map.getLayer(id) && map.getLayoutProperty(id,'visibility') !== 'none');
    map.getCanvas().style.cursor = layers.length && map.queryRenderedFeatures(e.point,{layers}).length ? 'pointer' : '';
  });
  map.on('click',(e)=>{
    const ids=['habitat-fill','change-fill'].filter(id => map.getLayer(id) && map.getLayoutProperty(id,'visibility') !== 'none');
    if (!ids.length) return;
    const hit=map.queryRenderedFeatures(e.point,{layers:ids})[0];
    if (hit) showFeature(hit.properties, e.lngLat);
  });
  map.on('error',(error)=>{ console.warn('Map tile or overlay error:', error?.error?.message || error); });
}

function datasetsForSpecies() {
  return [...(state.catalog?.datasets || [])].filter(x=>x.species===state.species).sort((a,b)=>b.date.localeCompare(a.date));
}
function speciesLabel(speciesId) { return state.catalog?.species?.find(s=>s.id===speciesId)?.label || speciesId.replaceAll('_',' '); }
function renderSpecies() {
  const items=state.catalog.species?.length ? state.catalog.species : [...new Set(state.catalog.datasets.map(s=>s.species))].map(id=>({id,label:id.replaceAll('_',' ')}));
  const target=$('species-list');target.replaceChildren();
  for(const item of items){
    const button=document.createElement('button');button.type='button';button.className='seg';button.textContent=item.label;button.dataset.species=item.id;
    button.addEventListener('click',()=>{state.species=item.id;updateSpecies();});
    target.append(button);
  }
  if(!items.some(item=>item.id===state.species))state.species=items[0]?.id;
  updateSpecies();
}
function updateSpecies() {
  document.querySelectorAll('[data-species]').forEach(button=>{const active=button.dataset.species===state.species;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  const items=datasetsForSpecies();
  $('snapshot-select').replaceChildren(...items.map(item=>new Option(`${formatDate(item.date)} · ${item.region || 'Dataset'}`,item.id)));
  if (!items.some(x=>x.id===state.snapshot)) state.snapshot=items[0]?.id ?? null;
  $('snapshot-select').value=state.snapshot ?? '';
  loadSnapshot();
}
function safeBounds(b){return Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3]&&b[0]>=-180&&b[2]<=180&&b[1]>=-90&&b[3]<=90;}
function resetView() { const s=selectedSnapshot(); const b=safeBounds(s?.extent)?s.extent:DEFAULT_EXTENT; state.map?.fitBounds([[b[0],b[1]],[b[2],b[3]]],{padding:38,duration:650,maxZoom:12}); }
function removeLayersAndSources(){
  if (!state.map) return;
  for(const id of layerIds) if(state.map.getLayer(id)) state.map.removeLayer(id);
  for(const id of sourceIds) if(state.map.getSource(id)) state.map.removeSource(id);
}
function addMapLayers(snapshot, geojson){
  const m=state.map;
  if (!m?.isStyleLoaded()) return;
  removeLayersAndSources();
  if(snapshot.raster){
    const r=snapshot.raster;
    if(r.type==='image'){
      if(!safeBounds(r.bounds)) throw new Error(`Raster ${snapshot.id} needs bounds [west,south,east,north] in WGS84.`);
      const [w,s,e,n]=r.bounds;
      m.addSource('source-image',{type:'image',url:resolveURL(r.url),coordinates:[[w,n],[e,n],[e,s],[w,s]]});
      m.addLayer({id:'heatmap-image',type:'raster',source:'source-image',paint:{'raster-opacity':Number($('raster-opacity').value)/100,'raster-fade-duration':0}});
    }else if(r.type==='xyz'){
      m.addSource('source-tiles',{type:'raster',tiles:r.tiles.map(resolveURL),tileSize:r.tileSize||256,minzoom:r.minzoom??0,maxzoom:r.maxzoom??18});
      m.addLayer({id:'heatmap-tiles',type:'raster',source:'source-tiles',paint:{'raster-opacity':Number($('raster-opacity').value)/100,'raster-fade-duration':0}});
    }
  }
  const featureCollection = geojson ?? {type:'FeatureCollection',features:[]};
  m.addSource('source-geojson',{type:'geojson',data:featureCollection});
  m.addLayer({id:'habitat-fill',type:'fill',source:'source-geojson',filter:['==',['get','kind'],'habitat'],paint:{'fill-color':['interpolate',['linear'],['coalesce',['to-number',['get','score']],0],...SCORE_STOPS.flat()], 'fill-opacity':0.34}});
  m.addLayer({id:'habitat-outline',type:'line',source:'source-geojson',filter:['==',['get','kind'],'habitat'],paint:{'line-color':'#215c49','line-width':1.8,'line-opacity':0.85}});
  m.addLayer({id:'change-fill',type:'fill',source:'source-geojson',filter:['==',['get','kind'],'change'],paint:{'fill-color':'#f3a648','fill-opacity':0.34}});
  m.addLayer({id:'change-outline',type:'line',source:'source-geojson',filter:['==',['get','kind'],'change'],paint:{'line-color':'#be7b26','line-width':2,'line-dasharray':[2,1.2]}});
  updateLayerFilters(); updateVisibility();
}
function updateLayerFilters() {
  if (!state.map) return;
  const threshold=Number($('score-threshold').value);
  setText('threshold-label',threshold);
  for(const id of ['habitat-fill','habitat-outline']){
    if(state.map.getLayer(id)) state.map.setFilter(id,['all',['==',['get','kind'],'habitat'],['>=',['coalesce',['to-number',['get','score']],0],threshold]]);
  }
  updateSummaries();
}
function updateVisibility(){
  if(!state.map)return;
  const toggles={
    'heatmap-image':$('layer-heatmap').checked,'heatmap-tiles':$('layer-heatmap').checked,
    'habitat-fill':$('layer-polygons').checked,'habitat-outline':$('layer-polygons').checked,
    'change-fill':$('layer-changes').checked,'change-outline':$('layer-changes').checked
  };
  for (const [id,visible] of Object.entries(toggles)) if(state.map.getLayer(id))state.map.setLayoutProperty(id,'visibility',visible?'visible':'none');
  const opacity=Number($('raster-opacity').value)/100;
  for(const id of ['heatmap-image','heatmap-tiles']) if(state.map.getLayer(id))state.map.setPaintProperty(id,'raster-opacity',opacity);
  setText('opacity-label',`${Math.round(opacity*100)}%`);
}
function showFeature(properties, lngLat){
  setText('feature-name',properties.name||properties.id||'Unnamed area');
  setText('feature-type',properties.kind === 'change' ? 'Change zone' : 'Habitat patch');
  setText('feature-caption',properties.note || 'User-provided geospatial feature.');
  const permitted=['score','class','indicator','confidence','model','source','id'];
  const attrs=permitted.filter(k=>properties[k]!==undefined&&properties[k]!==null)
    .map(k=>{const wrapper=document.createElement('div');wrapper.className='attribute';const key=document.createElement('span');key.textContent=k.replaceAll('_',' ');const value=document.createElement('b');value.textContent=String(properties[k]);wrapper.append(key,value);return wrapper;});
  if(lngLat){const wrapper=document.createElement('div');wrapper.className='attribute';const key=document.createElement('span');key.textContent='Clicked point';const value=document.createElement('b');value.textContent=`${lngLat.lat.toFixed(4)}, ${lngLat.lng.toFixed(4)}`;wrapper.append(key,value);attrs.push(wrapper);}
  $('feature-attributes').replaceChildren(...attrs);
}
function updateSummaries(){
  const all=features().filter(habitat);
  const visible=all.filter(eligible);
  setText('metric-patches',all.length);
  setText('insight-count',visible.length);
  $('mini-track-fill').style.width=`${all.length?Math.round(100*visible.length/all.length):0}%`;
  const bins=[[0,25],[25,50],[50,75],[75,101]];
  const values=bins.map(([lo,hi])=>all.filter(f=>score(f)>=lo&&score(f)<hi).length);
  const max=Math.max(...values,1);
  const node=$('distribution-bars');node.replaceChildren();
  bins.forEach(([lo,hi],i)=>{
    const row=document.createElement('div');row.className='dist-row';
    const label=document.createElement('span');label.textContent=`${lo}–${hi===101?100:hi}`;
    const track=document.createElement('div');track.className='bar-track';
    const fill=document.createElement('div');fill.className='bar-fill';fill.style.width=`${Math.round(100*values[i]/max)}%`;
    fill.style.backgroundColor=['#eccb92','#d6bd77','#a1c889','#3b9472'][i];track.append(fill);
    const count=document.createElement('strong');count.textContent=String(values[i]);row.append(label,track,count);node.append(row);
  });
}
async function loadSnapshot(){
  const snapshot=selectedSnapshot();if(!snapshot||!state.map?.isStyleLoaded())return;
  const seq=++state.sequence;clearWarn();
  try{
    setText('map-status',`Loading ${snapshot.id}…`);
    let geojson={type:'FeatureCollection',features:[]};
    if(snapshot.geojson){const res=await fetch(resolveURL(snapshot.geojson),{cache:'no-cache'});if(!res.ok)throw new Error(`Could not load ${snapshot.geojson} (HTTP ${res.status}).`);geojson=await res.json();if(geojson.type!=='FeatureCollection'||!Array.isArray(geojson.features))throw new Error('GeoJSON must be a FeatureCollection.');}
    if(seq!==state.sequence)return;
    state.data=geojson;
    addMapLayers(snapshot,geojson);
    const speciesName=speciesLabel(state.species);
    setText('active-product',`${speciesName} · ${formatDate(snapshot.date)}`);
    setText('dataset-description',snapshot.description||'No dataset notes supplied.');
    setText('meta-species',speciesName);setText('meta-date',formatDate(snapshot.date));
    setText('meta-status',snapshot.status||'Unspecified');setText('meta-resolution',snapshot.resolution||'Not specified');setText('meta-coverage',snapshot.region||'Not specified');
    setText('map-status',`${features().length} loaded features · ${snapshot.status||'data'} · ${snapshot.id}`);
    $('data-status').textContent=snapshot.status==='synthetic'?'◆  SYNTHETIC DEMONSTRATION':`◆  ${String(snapshot.status||'DATASET').toUpperCase()}`;
    setText('metric-latest',formatDate(snapshot.date));setText('metric-region',snapshot.region||'Pilot');
    setText('metric-products',state.catalog.datasets.length);
    setText('feature-name','Select a polygon');setText('feature-caption','Click a map polygon to inspect attributes.');setText('feature-type','Map detail');
    $('feature-attributes').innerHTML='<div class="empty-selection">No location selected</div>';
    updateSummaries();
  }catch(err){if(seq!==state.sequence)return;warn(`Dataset load failed: ${err.message}`);setText('map-status','Could not load dataset. See message above.');}
}
function updateBasemap(which){state.basemap=which;if(!state.map)return;for(const key of ['streets','satellite']){const id=`base-${key}`;if(state.map.getLayer(id))state.map.setLayoutProperty(id,'visibility',which===key?'visible':'none');}
  document.querySelectorAll('[data-basemap]').forEach(button=>{const active=button.dataset.basemap===which;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
}
function downloadVisible(){
  const snapshot=selectedSnapshot();if(!snapshot||!state.data)return;
  const bounds=state.map?.getBounds();
  // Geographic bbox overlap is deliberately approximate (vertex bounds), not a full clipping operation.
  const overlaps = (feature) => {
    if (!bounds) return true;
    const coords=[];const walk=(v)=>{if(Array.isArray(v)&&typeof v[0]==='number'&&typeof v[1]==='number')coords.push(v);else if(Array.isArray(v))v.forEach(walk);};
    walk(feature.geometry?.coordinates);
    return coords.some(([lon,lat])=>bounds.contains([lon,lat])) || (!coords.length ? false : (()=>{const lon=coords.map(p=>p[0]),lat=coords.map(p=>p[1]);return Math.min(...lon)<=bounds.getEast()&&Math.max(...lon)>=bounds.getWest()&&Math.min(...lat)<=bounds.getNorth()&&Math.max(...lat)>=bounds.getSouth();})());
  };
  const filter=state.data.features.filter(f=>((habitat(f)&&$('layer-polygons').checked&&eligible(f))||(change(f)&&$('layer-changes').checked))&&overlaps(f));
  const output={type:'FeatureCollection',name:`${snapshot.id}-filtered-view`,features:filter,metadata:{dataset:snapshot.id,date:snapshot.date,species:snapshot.species,threshold:Number($('score-threshold').value),notice:'Filtered source geometries, not clipped geometries. Raster heatmap is not included.',status:snapshot.status}};
  const objectURL=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/geo+json'}));
  const a=document.createElement('a');a.href=objectURL;a.download=`${snapshot.id}-visible.geojson`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);
}
function attachControls(){
  $('snapshot-select').addEventListener('change',(event)=>{state.snapshot=event.target.value;loadSnapshot();});
  $('score-threshold').addEventListener('input',updateLayerFilters);
  for(const name of ['layer-heatmap','layer-polygons','layer-changes'])$(name).addEventListener('change',updateVisibility);
  $('raster-opacity').addEventListener('input',updateVisibility);
  $('reset-btn').addEventListener('click',resetView);
  $('export-btn').addEventListener('click',downloadVisible);
  document.querySelectorAll('[data-basemap]').forEach(button=>button.addEventListener('click',()=>updateBasemap(button.dataset.basemap)));
  $('copy-view').addEventListener('click',async()=>{
    if(!state.map)return;
    const c=state.map.getCenter();const text=`${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} (zoom ${state.map.getZoom().toFixed(1)})`;
    try{await navigator.clipboard.writeText(text);setText('map-status',`Copied map center: ${text}`);}catch{setText('map-status',`Map center: ${text}`);}
  });
}
async function start(){
  attachControls();initialiseMap();
  try{
    const res=await fetch(DATA_URL,{cache:'no-cache'});if(!res.ok)throw new Error(`HTTP ${res.status}`);
    const catalog=await res.json();if(!Array.isArray(catalog.datasets)||!catalog.datasets.length)throw new Error('No datasets found in catalog.json');
    state.catalog=catalog;renderSpecies();
  }catch(error){warn(`Cannot load data/catalog.json: ${error.message}. Serve the directory via an HTTP server, not file://.`);setText('map-status','Catalogue not available.');}
}
start();
