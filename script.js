// Közel-Kelet középpont
const map = L.map('map').setView([33.5, 44.0], 6);

// OpenStreetMap layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
