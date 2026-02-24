// --- MAP ---
const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution:'&copy; OpenStreetMap'
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);

// --- UTIL: last 365 days ---
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

// --- PANEL TOGGLES ---
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

// --- TIMELINE ---
const slider = document.getElementById("timelineSlider");
const label = document.getElementById("selectedDateLabel");
slider.max = String(days365.length - 1);
slider.value = String(days365.length - 1);

// --- CATEGORY FILTER STATE ---
const catCheckboxes = Array.from(document.querySelectorAll(".cat-filter"));
function getSelectedCategories() {
  const selected = new Set();
  catCheckboxes.forEach((cb) => {
    if (cb.checked) selected.add(cb.value);
  });
  return selected;
}

// --- EVENTS ---
let eventsData = [];

fetch("events.json")
  .then(r => r.json())
  .then(data => {
    eventsData = data;
    updateMap();
  });

function getMarkerStyle(category) {
  if (category === "military") return { color: "red" };
  if (category === "political") return { color: "blue" };
  if (category === "security") return { color: "yellow" };
  return { color: "gray" };
}

function updateMap() {
  markersLayer.clearLayers();

  const selectedDate = days365[Number(slider.value)];
  label.textContent = selectedDate || "—";

  const selectedCats = getSelectedCategories();

  eventsData.forEach(ev => {
    const cat = ev.category || "other";
    if (ev.date !== selectedDate) return;
    if (!selectedCats.has(cat)) return;

    const style = getMarkerStyle(cat);

    const marker = L.circleMarker([ev.lat, ev.lng], {
      radius: 8,
      color: style.color,
      weight: 2,
      fillOpacity: 0.75
    });

    marker.bindPopup(`<b>${ev.title}</b><br>${cat} · ${ev.date}`);
    markersLayer.addLayer(marker);
  });
}

slider.addEventListener("input", updateMap);
catCheckboxes.forEach(cb => cb.addEventListener("change", updateMap));

updateMap();

// --- COUNTRY BORDERS OVERLAY (STRONGER LINES) ---
const bordersCheckbox = document.getElementById("bordersCheckbox");

const BORDERS_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

let bordersLayer = null;
let bordersLoaded = false;

function bordersStyle() {
  return {
    color: "#ffffff",
    weight: 2.2,      // ERŐSEBB VONAL
    opacity: 0.85,    // nagyobb kontraszt
    fillOpacity: 0
  };
}

async function ensureBordersLoaded() {
  if (bordersLoaded) return;

  try {
    const res = await fetch(BORDERS_GEOJSON_URL, { cache: "force-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geojson = await res.json();

    bordersLayer = L.geoJSON(geojson, {
      style: bordersStyle
    });

    bordersLoaded = true;
  } catch (err) {
    console.error("Failed to load borders GeoJSON:", err);
    alert("Nem sikerült betölteni az országhatárokat.");
  }
}

async function setBordersVisible(visible) {
  if (visible) {
    await ensureBordersLoaded();
    if (bordersLayer && !map.hasLayer(bordersLayer)) {
      bordersLayer.addTo(map);
      bordersLayer.bringToBack();
    }
  } else {
    if (bordersLayer && map.hasLayer(bordersLayer)) {
      map.removeLayer(bordersLayer);
    }
  }
}

// default ON
setBordersVisible(!!bordersCheckbox.checked);

bordersCheckbox.addEventListener("change", (e) => {
  setBordersVisible(e.target.checked);
});
