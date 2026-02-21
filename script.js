// --- MAP ---
const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// --- UTIL: last 365 days array (YYYY-MM-DD) ---
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

// --- GENERIC TOGGLER HELPER ---
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

  return { get isOpen() { return isOpen; } };
}

// --- PANELS (all default CLOSED) ---
attachPanelToggle("controlPanel", "controlToggle", false);
attachPanelToggle("timelinePanel", "timelineToggle", false);
attachPanelToggle("legendPanel", "legendToggle", false);

// --- TIMELINE SLIDER (365 days) ---
const slider = document.getElementById("timelineSlider");
const label = document.getElementById("selectedDateLabel");

// default to today (last index)
slider.min = "0";
slider.max = String(days365.length - 1);
slider.value = String(days365.length - 1);

function updateSelectedDate() {
  const idx = Number(slider.value);
  const d = days365[idx] || "—";
  label.textContent = d;

  // HOOK (később ide jön az események szűrése)
  // console.log("Selected date:", d);
}

slider.addEventListener("input", updateSelectedDate);
updateSelectedDate();

// --- COUNTRY BORDERS OVERLAY (Leaflet GeoJSON) ---
const bordersCheckbox = document.getElementById("bordersCheckbox");

// Natural Earth (nvkelso) GeoJSON raw URL (50m admin 0 countries)
const BORDERS_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

let bordersLayer = null;
let bordersLoaded = false;

function bordersStyle() {
  return {
    color: "#ffffff",
    weight: 1,
    opacity: 0.55,
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
    bordersLoaded = false;
    bordersLayer = null;
    alert("Nem sikerült betölteni az országhatárokat (GeoJSON).");
  }
}

async function setBordersVisible(visible) {
  if (visible) {
    await ensureBordersLoaded();
    if (bordersLayer && !map.hasLayer(bordersLayer)) {
      bordersLayer.addTo(map);
      // alul maradjon (tile fölött, marker alatt oké)
      bordersLayer.bringToBack();
    }
  } else {
    if (bordersLayer && map.hasLayer(bordersLayer)) {
      map.removeLayer(bordersLayer);
    }
  }
}

// default ON (checkbox checked in HTML)
setBordersVisible(!!bordersCheckbox.checked);

bordersCheckbox.addEventListener("change", (e) => {
  setBordersVisible(e.target.checked);
});
