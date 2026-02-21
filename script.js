// --- MAP ---
const map = L.map('map').setView([33.5, 44.0], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// --- CONTROL PANEL TOGGLE (default: CLOSED) ---
const controlPanel = document.getElementById("controlPanel");
const controlToggle = document.getElementById("controlToggle");

function setControlOpen(isOpen) {
  controlPanel.classList.toggle("closed", !isOpen);
  controlPanel.classList.toggle("open", isOpen);
  controlToggle.textContent = isOpen ? "✕" : "☰";
}

// default closed
let controlOpen = false;
setControlOpen(controlOpen);

controlToggle.addEventListener("click", () => {
  controlOpen = !controlOpen;
  setControlOpen(controlOpen);
});
