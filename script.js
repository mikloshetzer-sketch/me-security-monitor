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
