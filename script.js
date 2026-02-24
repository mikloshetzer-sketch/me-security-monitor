// MAP
const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:'&copy; OpenStreetMap'
}).addTo(map);

// CLUSTER
const clusterGroup = L.markerClusterGroup({
  showCoverageOnHover:false,
  spiderfyOnMaxZoom:true,
  disableClusteringAtZoom:10
});
map.addLayer(clusterGroup);

// DATE
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

// UI
const slider=document.getElementById("timelineSlider");
const label=document.getElementById("selectedDateLabel");
const listContainer=document.getElementById("eventsList");

slider.max=days365.length-1;
slider.value=days365.length-1;

const catCheckboxes=document.querySelectorAll(".cat-filter");
const windowRadios=document.querySelectorAll("input[name='window']");

let eventsData=[];

// LOAD DATA
fetch("events.json")
  .then(r=>r.json())
  .then(data=>{
    eventsData=data;
    updateMap();
  });

// CATEGORY COLOR
function categoryColor(cat){
  if(cat==="military") return "#ff5a5a";
  if(cat==="political") return "#4ea1ff";
  if(cat==="security") return "#ffd84e";
  return "#b7b7b7";
}

// MARKER
function makeMarker(ev){
  const icon=L.divIcon({
    html:`<div class="event-dot" style="background:${categoryColor(ev.category)}"></div>`,
    iconSize:[12,12]
  });

  const m=L.marker([ev.location.lat,ev.location.lng],{icon});
  m.bindPopup(`<b>${ev.title}</b><br>${ev.summary}`);
  return m;
}

// FILTER
function getSelectedCategories(){
  const set=new Set();
  catCheckboxes.forEach(cb=>{if(cb.checked)set.add(cb.value);});
  return set;
}

function getWindowDays(){
  const r=[...windowRadios].find(x=>x.checked);
  return Number(r.value);
}

// MAIN UPDATE
function updateMap(){
  clusterGroup.clearLayers();
  listContainer.innerHTML="";

  const selectedIndex=Number(slider.value);
  const selectedDate=days365[selectedIndex];
  label.textContent=selectedDate;

  const windowDays=getWindowDays();
  const selectedCats=getSelectedCategories();

  const visibleEvents=[];

  eventsData.forEach(ev=>{
    const idx=dateToIndex.get(ev.date);
    if(idx===undefined) return;

    const within=idx<=selectedIndex && idx>=selectedIndex-(windowDays-1);
    if(!within) return;
    if(!selectedCats.has(ev.category)) return;

    visibleEvents.push(ev);

    const m=makeMarker(ev);
    clusterGroup.addLayer(m);
  });

  // LIST BUILD
  visibleEvents
    .sort((a,b)=>b.date.localeCompare(a.date))
    .forEach(ev=>{
      const row=document.createElement("div");
      row.className="event-row";

      row.innerHTML=`
        <div class="event-row-title">${ev.title}</div>
        <div class="event-row-meta">${ev.category} · ${ev.date}</div>
      `;

      row.onclick=()=>{
        map.setView([ev.location.lat,ev.location.lng],9);
      };

      listContainer.appendChild(row);
    });
}

// EVENTS
slider.addEventListener("input",updateMap);
catCheckboxes.forEach(cb=>cb.addEventListener("change",updateMap));
windowRadios.forEach(r=>r.addEventListener("change",updateMap));

// PANEL TOGGLE
document.querySelectorAll(".panel-header button").forEach(btn=>{
  btn.onclick=()=>{
    btn.parentElement.parentElement.classList.toggle("closed");
  };
});
