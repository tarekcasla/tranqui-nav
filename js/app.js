/* Tranqui — navegación por calles tranquilas (PWA)
 * Mapa: MapLibre + OpenFreeMap | Ruteo: GraphHopper (evitar avenidas) + OSRM (fallback)
 * Búsqueda: Nominatim | Voz: Web Speech API
 */
'use strict';

// ----------------------------- Config -----------------------------
const STYLE_URL  = 'https://tiles.openfreemap.org/styles/liberty';
const OSRM       = 'https://router.project-osrm.org';
const NOMINATIM  = 'https://nominatim.openstreetmap.org';
const GH_URL     = 'https://graphhopper.com/api/1/route';
const DEFAULT_CENTER = [-58.486, -34.600];   // Buenos Aires (Villa Devoto aprox)

// Fuerza de evasión de avenidas: multiplicadores de prioridad (menor = más se evita)
const STRENGTH = {
  1: { motorway:.5,  trunk:.5,  primary:.45, secondary:.7  }, // suave
  2: { motorway:.25, trunk:.25, primary:.2,  secondary:.45 }, // medio
  3: { motorway:.1,  trunk:.1,  primary:.08, secondary:.25 }, // fuerte
};
const STRENGTH_LABEL = { 1:'Suave', 2:'Medio', 3:'Fuerte' };

// ----------------------------- Estado -----------------------------
const state = {
  pos: null,            // {lng,lat,heading,speed,accuracy}
  dest: null,           // {lng,lat,label}
  route: null,          // {coords, steps, distance, duration, avenuePct}
  navActive: false,
  following: true,
  wakeLock: null,
  maneuvers: [],        // [{lng,lat,text,icon,announced:Set}]
  nextIdx: 0,
  offRouteTicks: 0,
};

const settings = loadSettings();

// ----------------------------- Utils ------------------------------
const $ = (s) => document.querySelector(s);
const el = {};
function cacheEls() {
  ['search','btn-clear','btn-settings','results','btn-night','btn-recenter',
   'route-card','route-eta','route-meta','avenue-stat','toggle-avoid','no-key-note',
   'open-settings-link','btn-start','btn-close-route','nav-banner','man-icon','man-dist',
   'man-instr','nav-bottom','btn-stop','trip-eta','trip-rem','trip-dist','btn-mute',
   'settings','gh-key','set-avoid-default','set-strength','strength-label','set-voice',
   'set-night','btn-save-settings','btn-close-settings','ios-hint','ios-hint-close','toast'
  ].forEach(id => el[id] = document.getElementById(id));
}

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('tranqui') || '{}'); } catch (_) {}
  return {
    ghKey:    s.ghKey || '',
    avoid:    s.avoid !== undefined ? s.avoid : true,
    strength: s.strength || 2,
    voice:    s.voice !== undefined ? s.voice : true,
    night:    s.night || false,
  };
}
function saveSettings() { localStorage.setItem('tranqui', JSON.stringify(settings)); }

function toRad(d){ return d*Math.PI/180; }
function haversine(a, b){ // metros, a/b = [lng,lat]
  const R=6371000, dLat=toRad(b[1]-a[1]), dLng=toRad(b[0]-a[0]);
  const s=Math.sin(dLat/2)**2 + Math.cos(toRad(a[1]))*Math.cos(toRad(b[1]))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(s));
}
function fmtDist(m){
  if (m < 1000) return Math.round(m/10)*10 + ' m';
  return (m/1000).toFixed(m < 10000 ? 1 : 0) + ' km';
}
function fmtDur(sec){
  const m = Math.round(sec/60);
  if (m < 60) return m + ' min';
  return Math.floor(m/60) + ' h ' + (m%60) + ' min';
}
function fmtETA(sec){
  const d = new Date(Date.now() + sec*1000);
  return d.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', hour12:false });
}
let toastT;
function toast(msg, ms=2600){
  el.toast.textContent = msg; el.toast.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(()=> el.toast.hidden = true, ms);
}

// ----------------------------- Mapa -------------------------------
let map;
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: STYLE_URL,
    center: DEFAULT_CENTER,
    zoom: 13,
    attributionControl: { compact: true },
  });
  map.on('load', () => {
    map.addSource('route', { type:'geojson', data: emptyFC() });
    map.addLayer({ id:'route-casing', type:'line', source:'route',
      layout:{ 'line-cap':'round','line-join':'round' },
      paint:{ 'line-color':'#065f46','line-width':11 } });
    map.addLayer({ id:'route-line', type:'line', source:'route',
      layout:{ 'line-cap':'round','line-join':'round' },
      paint:{ 'line-color':'#34d399','line-width':7 } });
    startGeolocation();
  });
  // long-press / clic largo para fijar destino
  let pressT;
  map.on('touchstart', (e)=>{ pressT = setTimeout(()=> setDestFromLngLat(e.lngLat, 'Punto en el mapa'), 600); });
  map.on('touchend',  ()=> clearTimeout(pressT));
  map.on('touchmove', ()=> clearTimeout(pressT));
  map.on('contextmenu', (e)=> setDestFromLngLat(e.lngLat, 'Punto en el mapa'));
  map.on('dragstart', ()=>{ state.following = false; });
}
function emptyFC(){ return { type:'FeatureCollection', features:[] }; }

// --------------------------- Marcadores ---------------------------
let userMarker, destMarker;
function userEl(){
  const d = document.createElement('div');
  d.className = 'user-dot';
  d.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 1 L19 20 L11 16 L3 20 Z" fill="#34d399" stroke="#06281f" stroke-width="1.2"/></svg>';
  return d;
}
function updateUserMarker(){
  if (!state.pos) return;
  const ll = [state.pos.lng, state.pos.lat];
  if (!userMarker){
    userMarker = new maplibregl.Marker({ element: userEl(), rotationAlignment:'map' })
      .setLngLat(ll).addTo(map);
  } else {
    userMarker.setLngLat(ll);
  }
  if (state.pos.heading != null && !isNaN(state.pos.heading)) userMarker.setRotation(state.pos.heading);
}
function setDestMarker(){
  if (!state.dest) return;
  const ll = [state.dest.lng, state.dest.lat];
  if (!destMarker) destMarker = new maplibregl.Marker({ color:'#ef4444' }).setLngLat(ll).addTo(map);
  else destMarker.setLngLat(ll);
}

// -------------------------- Geolocalización -----------------------
function startGeolocation(){
  if (!navigator.geolocation){ toast('Tu navegador no tiene GPS'); return; }
  navigator.geolocation.watchPosition(onPos, onPosErr, {
    enableHighAccuracy:true, maximumAge:1000, timeout:12000,
  });
}
function onPos(p){
  const c = p.coords;
  const first = !state.pos;
  state.pos = {
    lng:c.longitude, lat:c.latitude,
    heading:(c.heading!=null && !isNaN(c.heading) && c.speed>0.5) ? c.heading : (state.pos?.heading ?? null),
    speed:c.speed||0, accuracy:c.accuracy,
  };
  updateUserMarker();
  if (first && !state.dest) map.easeTo({ center:[c.longitude,c.latitude], zoom:15 });
  if (state.navActive) navTick();
  // Fuera de navegación NO recentramos solos: el usuario mueve el mapa libre.
  // El botón ◎ recentra a pedido.
}
function onPosErr(e){
  if (e.code === 1) toast('Activá la ubicación para navegar');
  else toast('No pude obtener tu ubicación');
}

// ----------------------------- Búsqueda ---------------------------
let searchT;

async function doSearch(q){
  if (!q || q.length < 3){ el.results.hidden = true; return; }
  try {
    const near = state.pos ? `&lat=${state.pos.lat}&lon=${state.pos.lng}` : '';
    const url = `${NOMINATIM}/search?format=jsonv2&limit=6&accept-language=es&countrycodes=ar&q=${encodeURIComponent(q)}${near}`;
    const r = await fetch(url, { headers:{ 'Accept':'application/json' } });
    const data = await r.json();
    renderResults(data);
  } catch (_) { toast('No pude buscar (¿sin internet?)'); }
}
function renderResults(items){
  el.results.innerHTML = '';
  if (!items.length){ el.results.hidden = true; return; }
  items.forEach(it => {
    const li = document.createElement('li');
    const parts = it.display_name.split(',');
    li.innerHTML = `${parts[0]}<span class="r-sub">${parts.slice(1,4).join(',').trim()}</span>`;
    li.onclick = () => {
      el.results.hidden = true; el.search.blur();
      el.search.value = parts[0];
      setDestFromLngLat({ lng:+it.lon, lat:+it.lat }, parts[0]);
    };
    el.results.appendChild(li);
  });
  el.results.hidden = false;
}

// ----------------------------- Destino / Ruta ---------------------
function setDestFromLngLat(lngLat, label){
  state.dest = { lng:lngLat.lng, lat:lngLat.lat, label };
  setDestMarker();
  computeAndShowRoute();
}

async function computeAndShowRoute(){
  if (!state.dest) return;
  const origin = state.pos
    ? [state.pos.lng, state.pos.lat]
    : [map.getCenter().lng, map.getCenter().lat];
  if (!state.pos) toast('Sin GPS: ruteo desde el centro del mapa');

  const avoid = el['toggle-avoid'].checked;
  toast('Calculando ruta…', 1500);
  try {
    const route = (settings.ghKey)
      ? await routeGraphHopper(origin, [state.dest.lng,state.dest.lat], avoid)
      : await routeOSRM(origin, [state.dest.lng,state.dest.lat]);
    state.route = route;
    drawRoute(route);
    showRouteCard(route, avoid);
    if (!state.navActive) fitRoute(route);
  } catch (e) {
    console.error(e);
    toast(e.message || 'No pude calcular la ruta');
  }
}

// ---- GraphHopper (soporta evitar avenidas vía custom_model) ----
async function routeGraphHopper(from, to, avoid){
  const body = {
    profile:'car', locale:'es', points:[from, to],
    points_encoded:false, instructions:true, details:['road_class'],
  };
  if (avoid){
    body['ch.disable'] = true;
    const m = STRENGTH[settings.strength] || STRENGTH[2];
    body.custom_model = { priority:[
      { if:'road_class == MOTORWAY',  multiply_by:m.motorway  },
      { if:'road_class == TRUNK',     multiply_by:m.trunk     },
      { if:'road_class == PRIMARY',   multiply_by:m.primary   },
      { if:'road_class == SECONDARY', multiply_by:m.secondary },
    ]};
  }
  const r = await fetch(`${GH_URL}?key=${encodeURIComponent(settings.ghKey)}`, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body),
  });
  if (!r.ok){
    if (r.status === 401) throw new Error('API key inválida — revisá Ajustes');
    throw new Error('GraphHopper error ' + r.status);
  }
  const data = await r.json();
  const path = data.paths[0];
  const coords = path.points.coordinates;
  const steps = (path.instructions || []).map(ins => ({
    text: ins.text,
    icon: ghSignIcon(ins.sign),
    dist: ins.distance,
    point: coords[ins.interval ? ins.interval[0] : 0],
  }));
  return {
    coords, steps,
    distance: path.distance,
    duration: path.time/1000,
    avenuePct: avenuePctFromDetails(path.details && path.details.road_class, coords),
    engine:'gh',
  };
}
function ghSignIcon(sign){
  // GraphHopper sign codes -> emoji/flecha
  const map = { '-3':'↰','-2':'↰','-1':'↖','0':'↑','1':'↗','2':'↱','3':'↱',
                '4':'🏁','5':'🏁','6':'⟳','-7':'↖','7':'↗','-98':'↻' };
  return map[String(sign)] || '↑';
}
function avenuePctFromDetails(rc, coords){
  if (!rc || !coords) return null;
  let total=0, aven=0;
  for (const [i0,i1,val] of rc){
    let segLen=0;
    for (let i=i0; i<i1 && i+1<coords.length; i++) segLen += haversine(coords[i], coords[i+1]);
    total += segLen;
    if (['motorway','trunk','primary','secondary'].includes(val)) aven += segLen;
  }
  return total > 0 ? Math.round(aven/total*100) : null;
}

// ---- OSRM (fallback sin key, sin evitar avenidas) ----
async function routeOSRM(from, to){
  const url = `${OSRM}/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}`
            + `?overview=full&geometries=geojson&steps=true`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('OSRM error ' + r.status);
  const data = await r.json();
  if (!data.routes || !data.routes.length) throw new Error('Sin ruta posible');
  const rt = data.routes[0];
  const coords = rt.geometry.coordinates;
  const steps = [];
  (rt.legs[0].steps || []).forEach(s => {
    steps.push({
      text: osrmText(s.maneuver, s.name),
      icon: osrmIcon(s.maneuver),
      dist: s.distance,
      point: s.maneuver.location,
    });
  });
  return { coords, steps, distance:rt.distance, duration:rt.duration, avenuePct:null, engine:'osrm' };
}
function osrmText(man, name){
  const street = name ? ` por ${name}` : '';
  const mod = man.modifier || '';
  const dir = { 'left':'a la izquierda','right':'a la derecha','slight left':'leve a la izquierda',
    'slight right':'leve a la derecha','sharp left':'cerrado a la izquierda',
    'sharp right':'cerrado a la derecha','straight':'derecho','uturn':'en U' }[mod] || '';
  switch (man.type){
    case 'depart':   return 'Arrancá' + street;
    case 'arrive':   return 'Llegaste a destino';
    case 'roundabout':
    case 'rotary':   return 'Tomá la rotonda' + street;
    case 'merge':    return 'Incorporate' + street;
    case 'fork':     return 'Mantenete ' + dir + street;
    case 'end of road': return 'Al final, girá ' + dir + street;
    default:         return (dir ? 'Girá ' + dir : 'Seguí') + street;
  }
}
function osrmIcon(man){
  const mod = man.modifier || '';
  if (man.type === 'arrive') return '🏁';
  if (man.type === 'roundabout' || man.type === 'rotary') return '⟳';
  if (mod.includes('left')) return mod.includes('slight') ? '↖' : '↰';
  if (mod.includes('right')) return mod.includes('slight') ? '↗' : '↱';
  if (mod === 'uturn') return '↻';
  return '↑';
}

// ----------------------------- Dibujo -----------------------------
function drawRoute(route){
  const src = map.getSource('route');
  if (src) src.setData({ type:'FeatureCollection', features:[
    { type:'Feature', geometry:{ type:'LineString', coordinates:route.coords }, properties:{} }
  ]});
}
function fitRoute(route){
  const b = new maplibregl.LngLatBounds();
  route.coords.forEach(c => b.extend(c));
  map.fitBounds(b, { padding:{ top:130, bottom:260, left:50, right:50 }, duration:600 });
}

// --------------------------- Tarjeta ruta -------------------------
function showRouteCard(route, avoid){
  el['route-eta'].textContent = fmtDur(route.duration) + ' · ' + fmtDist(route.distance);
  el['route-meta'].textContent = 'Llegás ' + fmtETA(route.duration) + (state.dest.label ? ' · ' + state.dest.label : '');
  // estadística de avenidas
  if (route.avenuePct != null){
    el['avenue-stat'].hidden = false;
    el['avenue-stat'].classList.toggle('warn', route.avenuePct > 25);
    el['avenue-stat'].textContent = route.avenuePct <= 5
      ? `✓ Ruta tranquila: ${route.avenuePct}% por avenidas`
      : `Esta ruta usa ${route.avenuePct}% de avenidas`;
  } else {
    el['avenue-stat'].hidden = true;
  }
  el['no-key-note'].hidden = !!settings.ghKey;
  el['route-card'].hidden = false;
  el['nav-banner'].classList.add('hidden');
  el['nav-bottom'].classList.add('hidden');
}

// ---------------------------- Navegación --------------------------
async function startNav(){
  if (!state.route) return;
  state.navActive = true; state.following = true; state.nextIdx = 0; state.offRouteTicks = 0;
  state.maneuvers = state.route.steps.map(s => ({ ...s, announced:new Set() }));
  el['route-card'].hidden = true;
  el['nav-banner'].classList.remove('hidden');
  el['nav-bottom'].classList.remove('hidden');
  el.topbar && (document.getElementById('topbar').style.display = 'none');
  document.getElementById('fabs').style.bottom = 'calc(var(--safe-bottom) + 150px)';
  await requestWakeLock();
  map.easeTo({ pitch:55, zoom:17, duration:700 });
  // poblar el banner ya, antes del primer tick de GPS
  const m0 = state.maneuvers[0];
  if (m0){
    el['man-icon'].textContent = m0.icon;
    el['man-instr'].textContent = m0.text;
    el['man-dist'].textContent = state.pos ? fmtDist(haversine([state.pos.lng,state.pos.lat], m0.point)) : '';
    speak(m0.text);
  }
  updateTrip();
}
function stopNav(){
  state.navActive = false;
  releaseWakeLock();
  el['nav-banner'].classList.add('hidden');
  el['nav-bottom'].classList.add('hidden');
  el['route-card'].hidden = true;
  document.getElementById('topbar').style.display = '';
  document.getElementById('fabs').style.bottom = '';
  map.easeTo({ pitch:0, zoom:15, duration:600 });
  if (state.pos) map.easeTo({ center:[state.pos.lng,state.pos.lat] });
  speechSynthesis.cancel();
}

function navTick(){
  if (!state.pos || !state.maneuvers.length) return;
  const here = [state.pos.lng, state.pos.lat];

  // seguir al usuario con rumbo
  if (state.following){
    map.easeTo({
      center: here,
      bearing: (state.pos.heading != null ? state.pos.heading : map.getBearing()),
      duration: 700, easing: t => t,
    });
  }

  // maniobra actual
  let m = state.maneuvers[state.nextIdx];
  if (!m){ checkArrival(here); return; }
  const dToMan = haversine(here, m.point);

  // avanzar de maniobra al pasarla
  if (dToMan < 25 && state.nextIdx < state.maneuvers.length - 1){
    state.nextIdx++;
    m = state.maneuvers[state.nextIdx];
  }

  // banner
  const dShow = haversine(here, m.point);
  el['man-dist'].textContent = fmtDist(dShow);
  el['man-instr'].textContent = m.text;
  el['man-icon'].textContent = m.icon;

  // anuncios por voz (a 350m, 120m y "ahora")
  if (dShow <= 360 && !m.announced.has('far')){ m.announced.add('far'); speak('En ' + fmtDist(dShow) + ', ' + m.text); }
  if (dShow <= 120 && !m.announced.has('near')){ m.announced.add('near'); speak(m.text); }

  // off-route -> recalcular
  const offset = distanceToRoute(here);
  if (offset > 55){ if (++state.offRouteTicks >= 3){ state.offRouteTicks = 0; reroute(); } }
  else state.offRouteTicks = 0;

  checkArrival(here);
  updateTrip();
}
function checkArrival(here){
  const end = state.route.coords[state.route.coords.length-1];
  if (haversine(here, end) < 30){
    speak('Llegaste a destino');
    toast('🏁 Llegaste a destino');
    stopNav();
  }
}
function distanceToRoute(p){
  let min = Infinity;
  const c = state.route.coords;
  // muestreo: comparar contra vértices cercanos
  for (let i=Math.max(0,state.nextIdx-2); i<c.length; i++){
    const d = haversine(p, c[i]); if (d < min) min = d;
    if (d < 25) break;
  }
  return min;
}
async function reroute(){
  toast('Recalculando…', 1500); speak('Recalculando');
  try {
    const avoid = settings.avoid;
    const route = settings.ghKey
      ? await routeGraphHopper([state.pos.lng,state.pos.lat], [state.dest.lng,state.dest.lat], avoid)
      : await routeOSRM([state.pos.lng,state.pos.lat], [state.dest.lng,state.dest.lat]);
    state.route = route; drawRoute(route);
    state.maneuvers = route.steps.map(s => ({ ...s, announced:new Set() }));
    state.nextIdx = 0;
  } catch(_) { /* seguimos con la ruta vieja */ }
}
function updateTrip(){
  if (!state.route) return;
  // distancia restante: desde la posición a fin, aprox sumando vértices desde nextIdx
  let rem = 0;
  const c = state.route.coords;
  // encontrar vértice más cercano
  let nearest = 0, nd = Infinity;
  for (let i=0;i<c.length;i++){ const d = haversine([state.pos.lng,state.pos.lat], c[i]); if (d<nd){ nd=d; nearest=i; } }
  for (let i=nearest; i+1<c.length; i++) rem += haversine(c[i], c[i+1]);
  const frac = state.route.distance>0 ? rem/state.route.distance : 1;
  const remDur = state.route.duration * frac;
  el['trip-eta'].textContent = fmtETA(remDur);
  el['trip-rem'].textContent = fmtDur(remDur);
  el['trip-dist'].textContent = fmtDist(rem);
}

// ----------------------------- Wake Lock --------------------------
async function requestWakeLock(){
  try { if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); } catch(_){}
}
function releaseWakeLock(){ try { state.wakeLock && state.wakeLock.release(); state.wakeLock=null; } catch(_){} }
document.addEventListener('visibilitychange', async () => {
  if (state.navActive && document.visibilityState === 'visible' && !state.wakeLock) requestWakeLock();
});

// ----------------------------- Voz --------------------------------
function speak(text){
  if (!settings.voice || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-AR'; u.rate = 1.05; u.volume = 1;
  speechSynthesis.speak(u);
}

// ----------------------------- Noche ------------------------------
function applyNight(){ document.body.classList.toggle('night', settings.night); el['btn-night'].textContent = settings.night ? '☀️' : '🌙'; }

// ----------------------------- UI bind ----------------------------
function bindUI(){
  // búsqueda
  el.search.addEventListener('input', () => {
    el['btn-clear'].hidden = !el.search.value;
    clearTimeout(searchT); searchT = setTimeout(() => doSearch(el.search.value.trim()), 350);
  });
  el.search.addEventListener('keydown', e => { if (e.key === 'Enter'){ clearTimeout(searchT); doSearch(el.search.value.trim()); } });
  el['btn-clear'].onclick = () => { el.search.value=''; el['btn-clear'].hidden=true; el.results.hidden=true; clearRoute(); };

  // toggle evitar avenidas (en tarjeta)
  el['toggle-avoid'].checked = settings.avoid;
  el['toggle-avoid'].onchange = () => { settings.avoid = el['toggle-avoid'].checked; saveSettings(); computeAndShowRoute(); };

  // botones tarjeta
  el['btn-start'].onclick = startNav;
  el['btn-close-route'].onclick = () => { el['route-card'].hidden = true; clearRoute(); };
  el['open-settings-link'].onclick = () => openSettings();

  // nav
  el['btn-stop'].onclick = stopNav;
  el['btn-mute'].onclick = () => { settings.voice = !settings.voice; saveSettings(); el['btn-mute'].textContent = settings.voice ? '🔊' : '🔇'; if(!settings.voice) speechSynthesis.cancel(); };

  // fabs
  el['btn-recenter'].onclick = () => {
    state.following = true;
    if (state.pos) map.easeTo({ center:[state.pos.lng,state.pos.lat], zoom: state.navActive?17:15, duration:500 });
  };
  el['btn-night'].onclick = () => { settings.night = !settings.night; saveSettings(); applyNight(); };

  // settings
  el['btn-settings'].onclick = openSettings;
  el['btn-close-settings'].onclick = () => el.settings.hidden = true;
  el['set-strength'].oninput = () => el['strength-label'].textContent = STRENGTH_LABEL[el['set-strength'].value];
  el['btn-save-settings'].onclick = () => {
    settings.ghKey = el['gh-key'].value.trim();
    settings.avoid = el['set-avoid-default'].checked;
    settings.strength = +el['set-strength'].value;
    settings.voice = el['set-voice'].checked;
    settings.night = el['set-night'].checked;
    saveSettings(); applyNight();
    el['toggle-avoid'].checked = settings.avoid;
    el['btn-mute'].textContent = settings.voice ? '🔊' : '🔇';
    el.settings.hidden = true;
    toast(settings.ghKey ? 'Listo — evitar avenidas activado' : 'Ajustes guardados');
    if (state.dest) computeAndShowRoute();
  };

  // ios hint
  el['ios-hint-close'].onclick = () => el['ios-hint'].hidden = true;
}
function openSettings(){
  el['gh-key'].value = settings.ghKey;
  el['set-avoid-default'].checked = settings.avoid;
  el['set-strength'].value = settings.strength;
  el['strength-label'].textContent = STRENGTH_LABEL[settings.strength];
  el['set-voice'].checked = settings.voice;
  el['set-night'].checked = settings.night;
  el.settings.hidden = false;
  el['route-card'].hidden = true;
}
function clearRoute(){
  state.dest = null; state.route = null;
  if (destMarker){ destMarker.remove(); destMarker = null; }
  const src = map.getSource('route'); if (src) src.setData(emptyFC());
  el['route-card'].hidden = true;
}

// ----------------------------- PWA / boot -------------------------
function maybeIosHint(){
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  if (isIos && !standalone && !localStorage.getItem('iosHintSeen')){
    setTimeout(() => { el['ios-hint'].hidden = false; localStorage.setItem('iosHintSeen','1'); }, 3500);
  }
}
function registerSW(){
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
}

function boot(){
  cacheEls();
  bindUI();
  applyNight();
  el['btn-mute'].textContent = settings.voice ? '🔊' : '🔇';
  initMap();
  registerSW();
  maybeIosHint();
}
document.addEventListener('DOMContentLoaded', boot);
