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

let eventsData=[];

fetch("events.json")
  .then(r=>r.json())
  .then(data=>{
    eventsData=data;
    updateMap();
  });

function getMarkerColor(category){
  if(category==="military") return "red";
  if(category==="political") return "blue";
  if(category==="security") return "yellow";
  return "gray";
}

function updateMap(){
  markersLayer.clearLayers();

  const selectedDate=days365[slider.value];
  label.textContent=selectedDate;

  eventsData.forEach(ev=>{
    if(ev.date===selectedDate){
      const marker=L.circleMarker([ev.lat,ev.lng],{
        radius:8,
        color:getMarkerColor(ev.category),
        fillOpacity:0.8
      });

      marker.bindPopup(`<b>${ev.title}</b><br>${ev.category}`);
      markersLayer.addLayer(marker);
    }
  });
}

slider.addEventListener("input",updateMap);

document.querySelectorAll(".panel-header button").forEach(btn=>{
  btn.onclick=()=>{
    btn.parentElement.parentElement.classList.toggle("closed");
  }
});
