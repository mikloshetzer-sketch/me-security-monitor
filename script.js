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

slider.max=days365.length-1;
slider.value=days365.length-1;

const catCheckboxes=[...document.querySelectorAll(".cat-filter")];
const srcCheckboxes=[...document.querySelectorAll(".src-filter")];
const windowRadios=[...document.querySelectorAll("input[name='window']")];

// ---------------- DATA ----------------
let eventsData=[];
const markerByEventId = new Map();

// Load events
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

// Build visible events based on current filters + search
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

// ---------------- MAIN UPDATE ----------------
function updateMapAndList(){
  clusterGroup.clearLayers();
  markerByEventId.clear();
  listContainer.innerHTML="";

  const { out: visibleEvents, selectedDate } = computeVisibleEvents();
  label.textContent = selectedDate || "—";

  // markers
  visibleEvents.forEach(ev=>{
    const m = makeMarker(ev);
    if(!m) return;
    clusterGroup.addLayer(m);
    if(ev.id) markerByEventId.set(ev.id, m);
  });

  // list
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

searchInput.addEventListener("input", () => {
  // no debounce needed yet; events.json size is small
  updateMapAndList();
});

// ---------------- PANEL TOGGLE ----------------
document.querySelectorAll(".panel-header button").forEach(btn=>{
  btn.onclick=()=>{
    btn.parentElement.parentElement.classList.toggle("closed");
  };
});

// initial
updateMapAndList();
