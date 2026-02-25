// ---------------- MAP ----------------
const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:'&copy; OpenStreetMap'
}).addTo(map);

const clusterGroup = L.markerClusterGroup({
  showCoverageOnHover:false,
  spiderfyOnMaxZoom:true,
  disableClusteringAtZoom:10
});
map.addLayer(clusterGroup);

// ---------------- COUNTRY BORDERS ----------------
const BORDERS_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

const bordersCheckbox = document.getElementById("bordersCheckbox");
let bordersLayer = null;
let bordersLoaded = false;

function bordersStyle(){
  return { color:"#ffffff", weight:2.2, opacity:0.85, fillOpacity:0 };
}

async function ensureBordersLoaded(){
  if (bordersLoaded) return;
  const res = await fetch(BORDERS_GEOJSON_URL, { cache:"force-cache" });
  if (!res.ok) throw new Error(`Borders HTTP ${res.status}`);
  const geojson = await res.json();
  bordersLayer = L.geoJSON(geojson, { style: bordersStyle });
  bordersLoaded = true;
}

async function setBordersVisible(visible){
  if (visible) {
    try{
      await ensureBordersLoaded();
      if (bordersLayer && !map.hasLayer(bordersLayer)){
        bordersLayer.addTo(map);
        bordersLayer.bringToBack();
      }
    }catch(err){
      console.error("Borders load failed:", err);
      alert("Nem sikerült betölteni az országhatárokat.");
      bordersCheckbox.checked = false;
    }
  } else {
    if (bordersLayer && map.hasLayer(bordersLayer)) map.removeLayer(bordersLayer);
  }
}

setBordersVisible(!!bordersCheckbox.checked);
bordersCheckbox.addEventListener("change", (e)=>setBordersVisible(e.target.checked));

// ---------------- DATE ----------------
function makeLast365Days(){
  const days=[];
  const today=new Date();
  for(let i=364;i>=0;i--){
    const d=new Date(today);
    d.setDate(d.getDate()-i);
    days.push(d.toISOString().slice(0,10));
  }
  return days;
}
const days365=makeLast365Days();
const dateToIndex=new Map(days365.map((d,i)=>[d,i]));

// ---------------- UI ----------------
const slider=document.getElementById("timelineSlider");
const label=document.getElementById("selectedDateLabel");
const listContainer=document.getElementById("eventsList");
const searchInput=document.getElementById("eventSearch");

const statsTotalEl = document.getElementById("statsTotal");
const statsMilEl   = document.getElementById("statsMil");
const statsSecEl   = document.getElementById("statsSec");
const statsPolEl   = document.getElementById("statsPol");
const statsOthEl   = document.getElementById("statsOth");
const statsNewsEl  = document.getElementById("statsNews");
const statsIswEl   = document.getElementById("statsIsw");

slider.max=days365.length-1;
slider.value=days365.length-1;

const catCheckboxes=[...document.querySelectorAll(".cat-filter")];
const srcCheckboxes=[...document.querySelectorAll(".src-filter")];
const windowRadios=[...document.querySelectorAll("input[name='window']")];

// ---------------- DATA ----------------
let eventsData=[];
const markerByEventId = new Map();

fetch("events.json")
  .then(r=>r.json())
  .then(data=>{
    eventsData=data;
    updateMapAndList();
  })
  .catch(err=>{
    console.error(err);
    listContainer.innerHTML = `<div class="muted">events.json load error</div>`;
  });

// ---------------- HELPERS ----------------
function categoryColor(cat){
  if(cat==="military") return "#ff5a5a";
  if(cat==="political") return "#4ea1ff";
  if(cat==="security") return "#ffd84e";
  return "#b7b7b7";
}

function sourceType(ev){
  const t = (ev?.source?.type || "news").toLowerCase();
  return (t === "isw") ? "isw" : "news";
}

function badgeHtml(t){
  return t === "isw"
    ? `<span class="badge badge-isw">ISW</span>`
    : `<span class="badge badge-news">NEWS</span>`;
}

function makeMarker(ev){
  const icon=L.divIcon({
    className:"",
    html:`<div class="event-dot" style="background:${categoryColor(ev.category)}"></div>`,
    iconSize:[12,12],
    iconAnchor:[6,6]
  });

  const lat = ev?.location?.lat;
  const lng = ev?.location?.lng;
  if(typeof lat !== "number" || typeof lng !== "number") return null;

  const m=L.marker([lat,lng],{icon});

  const srcName = ev?.source?.name || "";
  const srcUrl = ev?.source?.url || "";
  const srcLine = srcUrl
    ? `<a href="${srcUrl}" target="_blank" rel="noreferrer">${srcName || "source"}</a>`
    : `${srcName}`;

  m.bindPopup(
    `<b>${ev.title || "Untitled"}</b><br>` +
    `${ev.summary || ""}<br>` +
    `<small>${srcLine}</small>`
  );

  return m;
}

function getSelectedCategories(){
  const set=new Set();
  catCheckboxes.forEach(cb=>{ if(cb.checked) set.add(cb.value); });
  return set;
}

function getSelectedSources(){
  const set=new Set();
  srcCheckboxes.forEach(cb=>{ if(cb.checked) set.add(cb.value); });
  return set;
}

function getWindowDays(){
  const r=windowRadios.find(x=>x.checked);
  return Number(r?.value || 1);
}

function normalize(s){
  return String(s||"").toLowerCase();
}

function matchesSearch(ev, q){
  if(!q) return true;
  const t = normalize(ev.title);
  const s = normalize(ev.summary);
  const tags = Array.isArray(ev.tags) ? ev.tags.map(x=>normalize(x)).join(" ") : "";
  const loc = normalize(ev?.location?.name);
  return (t.includes(q) || s.includes(q) || tags.includes(q) || loc.includes(q));
}

// Visible events based on current filters + search
function computeVisibleEvents(){
  const selectedIndex=Number(slider.value);
  const selectedDate=days365[selectedIndex];
  const windowDays=getWindowDays();
  const selectedCats=getSelectedCategories();
  const selectedSrc=getSelectedSources();
  const q = normalize(searchInput.value).trim();

  const out=[];
  for(const ev of eventsData){
    const idx=dateToIndex.get(ev.date);
    if(idx === undefined) continue;

    const within = idx<=selectedIndex && idx>=selectedIndex-(windowDays-1);
    if(!within) continue;

    const cat = ev.category || "other";
    if(!selectedCats.has(cat)) continue;

    const st = sourceType(ev);
    if(!selectedSrc.has(st)) continue;

    if(!matchesSearch(ev, q)) continue;

    out.push(ev);
  }

  return { out, selectedDate };
}

function openEventOnMap(ev){
  const id = ev?.id;
  const marker = id ? markerByEventId.get(id) : null;

  const lat = ev?.location?.lat;
  const lng = ev?.location?.lng;

  if(typeof lat === "number" && typeof lng === "number"){
    map.setView([lat, lng], Math.max(map.getZoom(), 9));
  }

  if(marker){
    const parent = clusterGroup.getVisibleParent(marker);
    if(parent && parent !== marker && parent.spiderfy){
      parent.spiderfy();
      setTimeout(() => marker.openPopup(), 150);
    } else {
      marker.openPopup();
    }
  }
}

function updateStats(visibleEvents){
  let mil=0, sec=0, pol=0, oth=0, news=0, isw=0;
  for(const ev of visibleEvents){
    const c = (ev.category || "other").toLowerCase();
    if(c==="military") mil++;
    else if(c==="security") sec++;
    else if(c==="political") pol++;
    else oth++;

    const st = sourceType(ev);
    if(st==="isw") isw++; else news++;
  }

  statsTotalEl.textContent = String(visibleEvents.length);
  statsMilEl.textContent   = String(mil);
  statsSecEl.textContent   = String(sec);
  statsPolEl.textContent   = String(pol);
  statsOthEl.textContent   = String(oth);
  statsNewsEl.textContent  = String(news);
  statsIswEl.textContent   = String(isw);
}

// ---------------- MAIN UPDATE ----------------
function updateMapAndList(){
  clusterGroup.clearLayers();
  markerByEventId.clear();
  listContainer.innerHTML="";

  const { out: visibleEvents, selectedDate } = computeVisibleEvents();
  label.textContent = selectedDate || "—";

  updateStats(visibleEvents);

  visibleEvents.forEach(ev=>{
    const m = makeMarker(ev);
    if(!m) return;
    clusterGroup.addLayer(m);
    if(ev.id) markerByEventId.set(ev.id, m);
  });

  if(visibleEvents.length === 0){
    listContainer.innerHTML = `<div class="muted">No events for current filters/search.</div>`;
    return;
  }

  visibleEvents
    .slice()
    .sort((a,b)=> (b.date + (b.title||"")).localeCompare(a.date + (a.title||"")))
    .forEach(ev=>{
      const row=document.createElement("div");
      row.className="event-row";

      const st = sourceType(ev);
      const locName = ev?.location?.name ? ` · ${ev.location.name}` : "";

      row.innerHTML=`
        <div class="event-row-title">${ev.title || "Untitled"}</div>
        <div class="event-row-meta">
          ${badgeHtml(st)}
          <span>${ev.category || "other"} · ${ev.date}${locName}</span>
        </div>
      `;

      row.onclick=()=> openEventOnMap(ev);
      listContainer.appendChild(row);
    });
}

// ---------------- EVENTS ----------------
slider.addEventListener("input", updateMapAndList);
catCheckboxes.forEach(cb=>cb.addEventListener("change", updateMapAndList));
srcCheckboxes.forEach(cb=>cb.addEventListener("change", updateMapAndList));
windowRadios.forEach(r=>r.addEventListener("change", updateMapAndList));
searchInput.addEventListener("input", updateMapAndList);

// ---------------- PANEL TOGGLE ----------------
document.querySelectorAll(".panel-header button").forEach(btn=>{
  btn.onclick=()=>{
    btn.parentElement.parentElement.classList.toggle("closed");
  };
});

// initial
updateMapAndList();
