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

// --- CONTROL PANEL TOGGLE (default: CLOSED) ---
const controlPanel = document.getElementById("controlPanel");
const controlToggle = document.getElementById("controlToggle");

function setControlOpen(isOpen) {
  controlPanel.classList.toggle("closed", !isOpen);
  controlPanel.classList.toggle("open", isOpen);
  controlToggle.textContent = isOpen ? "✕" : "☰";
}

let controlOpen = false;
setControlOpen(controlOpen);

controlToggle.addEventListener("click", () => {
  controlOpen = !controlOpen;
  setControlOpen(controlOpen);
});

// --- TIMELINE PANEL TOGGLE (default: CLOSED) ---
const timelinePanel = document.getElementById("timelinePanel");
const timelineToggle = document.getElementById("timelineToggle");

function setTimelineOpen(isOpen) {
  timelinePanel.classList.toggle("closed", !isOpen);
  timelinePanel.classList.toggle("open", isOpen);
  timelineToggle.textContent = isOpen ? "✕" : "☰";
}

let timelineOpen = false;
setTimelineOpen(timelineOpen);

timelineToggle.addEventListener("click", () => {
  timelineOpen = !timelineOpen;
  setTimelineOpen(timelineOpen);
});

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
