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

slider.max=days365.length-1;
slider.value=days365.length-1;

const catCheckboxes=[...document.querySelectorAll(".cat-filter")];
const srcCheckboxes=[...document.querySelectorAll(".src-filter")];
const windowRadios=[...document.querySelectorAll("input[name='window']")];

// ---------------- DATA ----------------
let eventsData=[];

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
  m.bindPopup(`<b>${ev.title}</b><br>${ev.summary || ""}<br><small>${ev.source?.name || ""}</small>`);
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

function sourceType(ev){
  // normalize: "news" | "isw"
  const t = (ev?.source?.type || "news").toLowerCase();
  return (t === "isw") ? "isw" : "news";
}

function badgeHtml(t){
  return t === "isw"
    ? `<span class="badge badge-isw">ISW</span>`
    : `<span class="badge badge-news">NEWS</span>`;
}

// Build visible list based on current filters
function computeVisibleEvents(){
  const selectedIndex=Number(slider.value);
  const selectedDate=days365[selectedIndex];
  const windowDays=getWindowDays();
  const selectedCats=getSelectedCategories();
  const selectedSrc=getSelectedSources();

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

    out.push(ev);
  }

  return { out, selectedDate };
}

// ---------------- MAIN UPDATE ----------------
function updateMapAndList(){
  clusterGroup.clearLayers();
  listContainer.innerHTML="";

  const { out: visibleEvents, selectedDate } = computeVisibleEvents();
  label.textContent = selectedDate || "—";

  // Markers
  visibleEvents.forEach(ev=>{
    const m = makeMarker(ev);
    if(m) clusterGroup.addLayer(m);
  });

  // List
  if(visibleEvents.length === 0){
    listContainer.innerHTML = `<div class="muted">No events for current filters.</div>`;
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

      row.onclick=()=>{
        const lat = ev?.location?.lat;
        const lng = ev?.location?.lng;
        if(typeof lat === "number" && typeof lng === "number"){
          map.setView([lat,lng], 9);
          // optional: open popup by finding nearby marker is expensive; keep simple for now
        }
      };

      listContainer.appendChild(row);
    });
}

// ---------------- EVENTS ----------------
slider.addEventListener("input", updateMapAndList);
catCheckboxes.forEach(cb=>cb.addEventListener("change", updateMapAndList));
srcCheckboxes.forEach(cb=>cb.addEventListener("change", updateMapAndList));
windowRadios.forEach(r=>r.addEventListener("change", updateMapAndList));

// ---------------- PANEL TOGGLE ----------------
document.querySelectorAll(".panel-header button").forEach(btn=>{
  btn.onclick=()=>{
    btn.parentElement.parentElement.classList.toggle("closed");
  };
});

// initial
updateMapAndList();
