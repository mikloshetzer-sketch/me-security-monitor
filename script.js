const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:'&copy; OpenStreetMap'
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);

function makeLast365Days() {
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

const slider=document.getElementById("timelineSlider");
const label=document.getElementById("selectedDateLabel");
slider.max=days365.length-1;
slider.value=days365.length-1;

const catCheckboxes=document.querySelectorAll(".cat-filter");
const windowRadios=document.querySelectorAll("input[name='window']");

let eventsData=[];
let currentWindow=1;

fetch("events.json")
  .then(r=>r.json())
  .then(data=>{
    eventsData=data;
    updateMap();
  });

function getSelectedCategories(){
  const set=new Set();
  catCheckboxes.forEach(cb=>{
    if(cb.checked) set.add(cb.value);
  });
  return set;
}

function getMarkerColor(cat){
  if(cat==="military") return "red";
  if(cat==="political") return "blue";
  if(cat==="security") return "yellow";
  return "gray";
}

function updateMap(){
  markersLayer.clearLayers();

  const selectedIndex=Number(slider.value);
  const selectedDate=days365[selectedIndex];
  label.textContent=selectedDate;

  const selectedCats=getSelectedCategories();

  eventsData.forEach(ev=>{
    const eventIndex=days365.indexOf(ev.date);
    if(eventIndex===-1) return;

    const withinWindow=eventIndex<=selectedIndex &&
                       eventIndex>selectedIndex-currentWindow;

    if(!withinWindow) return;
    if(!selectedCats.has(ev.category)) return;

    const marker=L.circleMarker([ev.lat,ev.lng],{
      radius:8,
      color:getMarkerColor(ev.category),
      weight:2,
      fillOpacity:0.8
    });

    marker.bindPopup(`<b>${ev.title}</b><br>${ev.category} · ${ev.date}`);
    markersLayer.addLayer(marker);
  });
}

slider.addEventListener("input",updateMap);
catCheckboxes.forEach(cb=>cb.addEventListener("change",updateMap));

windowRadios.forEach(r=>{
  r.addEventListener("change",()=>{
    currentWindow=Number(r.value);
    updateMap();
  });
});

// panel toggle
document.querySelectorAll(".panel-header button").forEach(btn=>{
  btn.onclick=()=>{
    btn.parentElement.parentElement.classList.toggle("closed");
  }
});
