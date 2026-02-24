// ---------------- MAP ----------------
const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:'&copy; OpenStreetMap'
}).addTo(map);

// Cluster group for event markers
const clusterGroup = L.markerClusterGroup({
  showCoverageOnHover: false,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 10
});
map.addLayer(clusterGroup);

// ---------------- DATE UTIL ----------------
function makeLast365Days() {
  const days = [];
  const today = new Date();
  for (let i = 364; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
const days365 = makeLast365Days();
const dateToIndex = new Map(days365.map((d, i) => [d, i]));

// ---------------- PANELS ----------------
function attachPanelToggle(panelId, toggleId, defaultOpen = false) {
  const panel = document.getElementById(panelId);
  const toggle = document.getElementById(toggleId);

  function setOpen(isOpen) {
    panel.classList.toggle("closed", !isOpen);
    panel.classList.toggle("open", isOpen);
    toggle.textContent = isOpen ? "✕" : "☰";
  }

  let isOpen = defaultOpen;
  setOpen(isOpen);

  toggle.addEventListener("click", () => {
    isOpen = !isOpen;
    setOpen(isOpen);
  });
}

attachPanelToggle("controlPanel", "controlToggle", false);
attachPanelToggle("timelinePanel", "timelineToggle", false);
attachPanelToggle("legendPanel", "legendToggle", false);

// ---------------- UI STATE ----------------
const slider = document.getElementById("timelineSlider");
const label = document.getElementById("selectedDateLabel");
slider.max = String(days365.length - 1);
slider.value = String(days365.length - 1);

const catCheckboxes = Array.from(document.querySelectorAll(".cat-filter"));
const windowRadios = Array.from(document.querySelectorAll("input[name='window']"));

function getSelectedCategories() {
  const set = new Set();
  for (const cb of catCheckboxes) if (cb.checked) set.add(cb.value);
  return set;
}

function getWindowDays() {
  const checked = windowRadios.find(r => r.checked);
  return checked ? Number(checked.value) : 1;
}

// ---------------- EVENTS ----------------
let eventsData = [];

fetch("events.json")
  .then(r => r.json())
  .then(data => {
    eventsData = data;
    updateMap();
  })
  .catch(err => {
    console.error("events.json load failed:", err);
    alert("Nem sikerült betölteni az events.json fájlt.");
  });

// Category color mapping for markers
function categoryColor(cat) {
  if (cat === "military") return "#ff5a5a";
  if (cat === "political") return "#4ea1ff";
  if (cat === "security") return "#ffd84e";
  return "#b7b7b7";
}

// Create small colored DivIcon marker
function makeEventMarker(ev) {
  const cat = ev.category || "other";
  const color = categoryColor(cat);

  const icon = L.divIcon({
    className: "",
    html: `<div class="event-dot" style="background:${color}"></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6]
  });

  const m = L.marker([ev.lat, ev.lng], { icon });

  m.bindPopup(
    `<b>${ev.title}</b><br>${cat} · ${ev.date}`
  );

  return m;
}

function updateMap() {
  clusterGroup.clearLayers();

  const selectedIndex = Number(slider.value);
  const selectedDate = days365[selectedIndex] || "—";
  label.textContent = selectedDate;

  const windowDays = getWindowDays();
  const selectedCats = getSelectedCategories();

  for (const ev of eventsData) {
    const cat = ev.category || "other";
    if (!selectedCats.has(cat)) continue;

    const evIdx = dateToIndex.get(ev.date);
    if (evIdx === undefined) continue;

    // within [selectedIndex - (windowDays-1) ... selectedIndex]
    const within = evIdx <= selectedIndex && evIdx >= (selectedIndex - (windowDays - 1));
    if (!within) continue;

    clusterGroup.addLayer(makeEventMarker(ev));
  }
}

slider.addEventListener("input", updateMap);
for (const cb of catCheckboxes) cb.addEventListener("change", updateMap);
for (const r of windowRadios) r.addEventListener("change", updateMap);

// ---------------- COUNTRY BORDERS (stronger lines) ----------------
const bordersCheckbox = document.getElementById("bordersCheckbox");

// Natural Earth 50m admin 0 countries GeoJSON
const BORDERS_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

let bordersLayer = null;
let bordersLoaded = false;

function bordersStyle() {
  return {
    color: "#ffffff",
    weight: 2.2,
    opacity: 0.85,
    fillOpacity: 0
  };
}

async function ensureBordersLoaded() {
  if (bordersLoaded) return;

  const res = await fetch(BORDERS_GEOJSON_URL, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const geojson = await res.json();

  bordersLayer = L.geoJSON(geojson, { style: bordersStyle });
  bordersLoaded = true;
}

async function setBordersVisible(visible) {
  if (visible) {
    try {
      await ensureBordersLoaded();
      if (bordersLayer && !map.hasLayer(bordersLayer)) {
        bordersLayer.addTo(map);
        bordersLayer.bringToBack();
      }
    } catch (err) {
      console.error("Borders load failed:", err);
      alert("Nem sikerült betölteni az országhatárokat.");
    }
  } else {
    if (bordersLayer && map.hasLayer(bordersLayer)) {
      map.removeLayer(bordersLayer);
    }
  }
}

// default ON
setBordersVisible(!!bordersCheckbox.checked);
bordersCheckbox.addEventListener("change", (e) => setBordersVisible(e.target.checked));

// initial render (in case events load later)
updateMap();
