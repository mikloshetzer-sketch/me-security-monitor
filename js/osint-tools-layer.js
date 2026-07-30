(function (global) {
  "use strict";

  const VERSION = "1.0.0";
  const STORAGE_KEYS = {
    coordinates: "me_security_monitor_osint_coordinates_v1",
    objects: "me_security_monitor_osint_objects_v1",
    measurements: "me_security_monitor_osint_measurements_v1"
  };

  const MODES = new Set(["none", "coordinate", "measure", "object"]);

  const OBJECT_TYPES = {
    Military: [
      "Air base", "Military airport", "Helicopter base", "Military base", "Naval base",
      "Missile site", "Rocket launch site", "Air-defense site", "Radar site", "Command center",
      "Military communications", "Weapons depot", "Ammunition depot", "Military industry",
      "Training area", "Military border post", "Strike location", "Crater or damage point"
    ],
    Nuclear: [
      "Nuclear facility", "Uranium enrichment plant", "Nuclear research center", "Reactor",
      "Nuclear power plant", "Nuclear material storage", "Heavy-water facility"
    ],
    Energy: [
      "Oil field", "Gas field", "Oil refinery", "Petrochemical complex", "Oil terminal",
      "LNG terminal", "Fuel storage", "Pipeline facility", "Pumping station", "Power plant",
      "Electrical substation", "Desalination plant", "Offshore platform"
    ],
    Maritime: [
      "Commercial port", "Container terminal", "Ferry terminal", "Anchorage", "Naval facility",
      "Shipyard", "Maritime chokepoint", "Coastal radar", "Suspected mine area", "Vessel incident"
    ],
    Transport: [
      "Civil airport", "Bridge", "Tunnel", "Railway station", "Railway junction", "Highway junction",
      "Border crossing", "Checkpoint", "Roadblock"
    ],
    Infrastructure: [
      "Industrial facility", "Communications site", "Broadcasting site", "Government building",
      "Security facility", "Police facility", "Emergency services", "Dam", "Water facility",
      "Cable landing station"
    ],
    Logistics: [
      "Warehouse", "Logistics hub", "Supply depot", "Truck park", "Humanitarian hub"
    ],
    Civilian: [
      "Hospital", "School", "University", "Refugee or IDP camp", "Religious site", "Urban area",
      "Residential area", "Market", "Civil-defense shelter"
    ],
    Other: ["Point of interest", "Unknown object", "Suspected target", "Custom"]
  };

  const ACTORS = [
    "Unknown", "Iran", "Israel", "United States", "Hezbollah", "Houthis / Ansar Allah", "Hamas",
    "Palestinian Islamic Jihad", "Iraqi armed groups", "Syrian government", "Syrian armed groups",
    "Lebanese Armed Forces", "Jordan", "Saudi Arabia", "United Arab Emirates", "Qatar", "Bahrain",
    "Kuwait", "Oman", "Türkiye", "Egypt", "Iraq", "Syria", "Lebanon", "Yemen", "Other"
  ];

  const SOURCE_TYPES = ["OSINT", "Official", "Media", "Satellite imagery", "Social media", "Field report", "Other"];
  const RELIABILITY_LEVELS = ["High", "Medium", "Low", "Unverified"];

  const state = {
    map: null,
    controls: {},
    mode: "none",
    coordinates: [],
    objects: [],
    measurements: [],
    coordinateLayers: new Map(),
    objectLayers: new Map(),
    measurementLayers: new Map(),
    pendingMeasurementStart: null,
    pendingMeasurementLayer: null,
    initialized: false,
    onStateChange: null,
    mapClickHandler: null,
    keydownHandler: null,
    modal: null
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function uid(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return `${prefix}_${global.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeLatLng(latlng) {
    if (!latlng) return null;
    const latitude = finiteNumber(latlng.lat ?? latlng.latitude);
    const longitude = finiteNumber(latlng.lng ?? latlng.lon ?? latlng.longitude);
    if (latitude === null || longitude === null) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return { latitude, longitude };
  }

  function safeParseStorage(key) {
    try {
      const raw = global.localStorage ? global.localStorage.getItem(key) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn(`[MEOSINTTools] Invalid localStorage data for ${key}.`, error);
      return [];
    }
  }

  function safeWriteStorage(key, value) {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      console.warn(`[MEOSINTTools] Could not save ${key}.`, error);
    }
  }

  function sanitizeCoordinate(item) {
    const normalized = normalizeLatLng(item);
    if (!normalized) return null;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : nowIso();
    return {
      id: typeof item.id === "string" && item.id ? item.id : uid("coord"),
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      createdAt,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt
    };
  }

  function sanitizeObject(item) {
    const normalized = normalizeLatLng(item);
    if (!normalized) return null;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : nowIso();
    return {
      id: typeof item.id === "string" && item.id ? item.id : uid("object"),
      name: String(item.name || "Unnamed object").trim() || "Unnamed object",
      type: String(item.type || "Unknown object").trim() || "Unknown object",
      category: String(item.category || "Other").trim() || "Other",
      country: String(item.country || "").trim(),
      actor: String(item.actor || "Unknown").trim() || "Unknown",
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      note: String(item.note || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      sourceType: String(item.sourceType || "OSINT").trim() || "OSINT",
      reliability: String(item.reliability || "Unverified").trim() || "Unverified",
      createdAt,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt
    };
  }

  function sanitizeMeasurement(item) {
    if (!item || !item.start || !item.end) return null;
    const start = normalizeLatLng(item.start);
    const end = normalizeLatLng(item.end);
    if (!start || !end) return null;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : nowIso();
    const distanceMeters = finiteNumber(item.distanceMeters);
    return {
      id: typeof item.id === "string" && item.id ? item.id : uid("measure"),
      start,
      end,
      distanceMeters: distanceMeters !== null ? distanceMeters : calculateDistanceMeters(start, end),
      createdAt,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt
    };
  }

  function loadState() {
    state.coordinates = safeParseStorage(STORAGE_KEYS.coordinates).map(sanitizeCoordinate).filter(Boolean);
    state.objects = safeParseStorage(STORAGE_KEYS.objects).map(sanitizeObject).filter(Boolean);
    state.measurements = safeParseStorage(STORAGE_KEYS.measurements).map(sanitizeMeasurement).filter(Boolean);
  }

  function saveCoordinates() {
    safeWriteStorage(STORAGE_KEYS.coordinates, state.coordinates);
  }

  function saveObjects() {
    safeWriteStorage(STORAGE_KEYS.objects, state.objects);
  }

  function saveMeasurements() {
    safeWriteStorage(STORAGE_KEYS.measurements, state.measurements);
  }

  function emitStateChange() {
    refreshSummary();
    if (typeof state.onStateChange === "function") {
      try {
        state.onStateChange(getState());
      } catch (error) {
        console.warn("[MEOSINTTools] onStateChange callback failed.", error);
      }
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function injectStyles() {
    if (document.getElementById("me-osint-tools-layer-styles-v1")) return;
    const style = document.createElement("style");
    style.id = "me-osint-tools-layer-styles-v1";
    style.textContent = `
      .me-osint-coordinate-icon{width:18px;height:18px;border-radius:50%;background:#0ea5e9;border:3px solid #fff;box-shadow:0 1px 8px rgba(0,0,0,.45)}
      .me-osint-object-icon{width:20px;height:20px;border-radius:4px;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 8px rgba(0,0,0,.45);transform:rotate(45deg)}
      .me-osint-distance-label{background:rgba(17,24,39,.92);color:#fff;border:0;border-radius:6px;padding:4px 7px;font-size:12px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,.3)}
      .me-osint-distance-label:before{display:none}
      .me-osint-popup{min-width:220px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}
      .me-osint-popup__title{font-weight:800;margin:0 0 8px;font-size:14px}
      .me-osint-popup__row{font-size:12px;line-height:1.45;margin:3px 0;word-break:break-word}
      .me-osint-popup__actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      .me-osint-popup__button{appearance:none;border:1px solid #cbd5e1;background:#fff;color:#111827;padding:5px 8px;border-radius:5px;font-size:12px;font-weight:700;cursor:pointer}
      .me-osint-popup__button:hover{background:#f1f5f9}
      .me-osint-popup__button--danger{border-color:#fecaca;color:#b91c1c}
      .me-osint-modal-backdrop{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.68);display:flex;align-items:center;justify-content:center;padding:18px}
      .me-osint-modal{width:min(680px,100%);max-height:90vh;overflow:auto;background:#fff;color:#111827;border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.38);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .me-osint-modal__header{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid #e5e7eb}
      .me-osint-modal__title{margin:0;font-size:18px;font-weight:800}
      .me-osint-modal__close{appearance:none;border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#475569}
      .me-osint-modal__body{padding:18px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
      .me-osint-modal__field{display:flex;flex-direction:column;gap:6px}
      .me-osint-modal__field--full{grid-column:1/-1}
      .me-osint-modal__label{font-size:12px;font-weight:800;color:#334155}
      .me-osint-modal__input,.me-osint-modal__select,.me-osint-modal__textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:7px;padding:9px 10px;background:#fff;color:#111827;font:inherit}
      .me-osint-modal__textarea{min-height:88px;resize:vertical}
      .me-osint-modal__footer{display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid #e5e7eb}
      .me-osint-modal__button{appearance:none;border:1px solid #cbd5e1;background:#fff;color:#111827;padding:9px 14px;border-radius:7px;font-weight:800;cursor:pointer}
      .me-osint-modal__button--primary{background:#2563eb;border-color:#2563eb;color:#fff}
      .me-osint-map-crosshair,.me-osint-map-crosshair .leaflet-interactive{cursor:crosshair!important}
      @media (max-width:640px){.me-osint-modal__body{grid-template-columns:1fr}.me-osint-modal__field--full{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function requireLeaflet() {
    if (!global.L) {
      throw new Error("[MEOSINTTools] Leaflet is not available. Load Leaflet before osint-tools-layer.js.");
    }
  }

  function calculateDistanceMeters(a, b) {
    const R = 6371008.8;
    const toRad = value => value * Math.PI / 180;
    const lat1 = toRad(a.latitude);
    const lat2 = toRad(b.latitude);
    const dLat = lat2 - lat1;
    const dLon = toRad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(meters < 10000 ? 2 : 1)} km`;
  }

  function coordinateIcon() {
    return global.L.divIcon({
      className: "",
      html: '<div class="me-osint-coordinate-icon" aria-hidden="true"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  function objectIcon() {
    return global.L.divIcon({
      className: "",
      html: '<div class="me-osint-object-icon" aria-hidden="true"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  }

  function coordinatePopup(item) {
    return `
      <div class="me-osint-popup">
        <div class="me-osint-popup__title">Coordinate marker</div>
        <div class="me-osint-popup__row"><strong>Latitude:</strong> ${item.latitude.toFixed(6)}</div>
        <div class="me-osint-popup__row"><strong>Longitude:</strong> ${item.longitude.toFixed(6)}</div>
        <div class="me-osint-popup__row"><strong>Updated:</strong> ${escapeHtml(item.updatedAt)}</div>
        <div class="me-osint-popup__actions">
          <button type="button" class="me-osint-popup__button" data-me-osint-action="copy-coordinate" data-me-osint-id="${escapeHtml(item.id)}">Copy</button>
          <button type="button" class="me-osint-popup__button me-osint-popup__button--danger" data-me-osint-action="delete-coordinate" data-me-osint-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>`;
  }

  function objectPopup(item) {
    const source = item.sourceUrl
      ? `<a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source</a>`
      : "—";
    return `
      <div class="me-osint-popup">
        <div class="me-osint-popup__title">${escapeHtml(item.name)}</div>
        <div class="me-osint-popup__row"><strong>Category:</strong> ${escapeHtml(item.category)}</div>
        <div class="me-osint-popup__row"><strong>Type:</strong> ${escapeHtml(item.type)}</div>
        <div class="me-osint-popup__row"><strong>Actor:</strong> ${escapeHtml(item.actor)}</div>
        <div class="me-osint-popup__row"><strong>Country:</strong> ${escapeHtml(item.country || "—")}</div>
        <div class="me-osint-popup__row"><strong>Coordinates:</strong> ${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}</div>
        <div class="me-osint-popup__row"><strong>Reliability:</strong> ${escapeHtml(item.reliability)}</div>
        <div class="me-osint-popup__row"><strong>Source:</strong> ${source}</div>
        ${item.note ? `<div class="me-osint-popup__row"><strong>Note:</strong> ${escapeHtml(item.note)}</div>` : ""}
        <div class="me-osint-popup__actions">
          <button type="button" class="me-osint-popup__button" data-me-osint-action="edit-object" data-me-osint-id="${escapeHtml(item.id)}">Edit</button>
          <button type="button" class="me-osint-popup__button" data-me-osint-action="copy-object-coordinate" data-me-osint-id="${escapeHtml(item.id)}">Copy coordinates</button>
          <button type="button" class="me-osint-popup__button me-osint-popup__button--danger" data-me-osint-action="delete-object" data-me-osint-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>`;
  }

  function measurementPopup(item) {
    return `
      <div class="me-osint-popup">
        <div class="me-osint-popup__title">Distance measurement</div>
        <div class="me-osint-popup__row"><strong>Distance:</strong> ${formatDistance(item.distanceMeters)}</div>
        <div class="me-osint-popup__row"><strong>Start:</strong> ${item.start.latitude.toFixed(6)}, ${item.start.longitude.toFixed(6)}</div>
        <div class="me-osint-popup__row"><strong>End:</strong> ${item.end.latitude.toFixed(6)}, ${item.end.longitude.toFixed(6)}</div>
        <div class="me-osint-popup__actions">
          <button type="button" class="me-osint-popup__button me-osint-popup__button--danger" data-me-osint-action="delete-measurement" data-me-osint-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>`;
  }

  function renderCoordinate(item) {
    const marker = global.L.marker([item.latitude, item.longitude], {
      draggable: true,
      icon: coordinateIcon(),
      keyboard: true,
      title: "OSINT coordinate marker"
    }).addTo(state.map);

    marker.bindPopup(coordinatePopup(item));
    marker.on("dragend", () => {
      const latlng = marker.getLatLng();
      item.latitude = latlng.lat;
      item.longitude = latlng.lng;
      item.updatedAt = nowIso();
      marker.setPopupContent(coordinatePopup(item));
      saveCoordinates();
      emitStateChange();
    });
    state.coordinateLayers.set(item.id, marker);
  }

  function renderObject(item) {
    const marker = global.L.marker([item.latitude, item.longitude], {
      draggable: true,
      icon: objectIcon(),
      keyboard: true,
      title: item.name
    }).addTo(state.map);

    marker.bindPopup(objectPopup(item));
    marker.on("dragend", () => {
      const latlng = marker.getLatLng();
      item.latitude = latlng.lat;
      item.longitude = latlng.lng;
      item.updatedAt = nowIso();
      marker.setPopupContent(objectPopup(item));
      saveObjects();
      emitStateChange();
    });
    state.objectLayers.set(item.id, marker);
  }

  function renderMeasurement(item) {
    const latlngs = [
      [item.start.latitude, item.start.longitude],
      [item.end.latitude, item.end.longitude]
    ];
    const line = global.L.polyline(latlngs, { weight: 3, opacity: 0.9 }).addTo(state.map);
    line.bindPopup(measurementPopup(item));
    const midpoint = global.L.latLng(
      (item.start.latitude + item.end.latitude) / 2,
      (item.start.longitude + item.end.longitude) / 2
    );
    const label = global.L.tooltip({
      permanent: true,
      direction: "center",
      className: "me-osint-distance-label",
      interactive: false
    })
      .setLatLng(midpoint)
      .setContent(formatDistance(item.distanceMeters))
      .addTo(state.map);
    state.measurementLayers.set(item.id, { line, label });
  }

  function renderAll() {
    state.coordinates.forEach(renderCoordinate);
    state.objects.forEach(renderObject);
    state.measurements.forEach(renderMeasurement);
  }

  function removeLayer(layer) {
    if (!layer || !state.map) return;
    try {
      state.map.removeLayer(layer);
    } catch (error) {
      console.warn("[MEOSINTTools] Could not remove layer.", error);
    }
  }

  function addCoordinate(latlng) {
    ensureInitialized();
    const normalized = normalizeLatLng(latlng);
    if (!normalized) throw new Error("[MEOSINTTools] Invalid coordinate.");
    const item = sanitizeCoordinate({ ...normalized, createdAt: nowIso(), updatedAt: nowIso() });
    state.coordinates.push(item);
    renderCoordinate(item);
    saveCoordinates();
    emitStateChange();
    return { ...item };
  }

  function addObject(latlng, data) {
    ensureInitialized();
    const normalized = normalizeLatLng(latlng);
    if (!normalized) throw new Error("[MEOSINTTools] Invalid object coordinate.");
    const item = sanitizeObject({ ...(data || {}), ...normalized, createdAt: nowIso(), updatedAt: nowIso() });
    state.objects.push(item);
    renderObject(item);
    saveObjects();
    emitStateChange();
    return { ...item };
  }

  function addMeasurement(start, end) {
    ensureInitialized();
    const normalizedStart = normalizeLatLng(start);
    const normalizedEnd = normalizeLatLng(end);
    if (!normalizedStart || !normalizedEnd) throw new Error("[MEOSINTTools] Invalid measurement points.");
    const item = sanitizeMeasurement({
      start: normalizedStart,
      end: normalizedEnd,
      distanceMeters: calculateDistanceMeters(normalizedStart, normalizedEnd),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    state.measurements.push(item);
    renderMeasurement(item);
    saveMeasurements();
    emitStateChange();
    return JSON.parse(JSON.stringify(item));
  }

  function deleteCoordinate(id) {
    const index = state.coordinates.findIndex(item => item.id === id);
    if (index < 0) return false;
    state.coordinates.splice(index, 1);
    removeLayer(state.coordinateLayers.get(id));
    state.coordinateLayers.delete(id);
    saveCoordinates();
    emitStateChange();
    return true;
  }

  function deleteObject(id) {
    const index = state.objects.findIndex(item => item.id === id);
    if (index < 0) return false;
    state.objects.splice(index, 1);
    removeLayer(state.objectLayers.get(id));
    state.objectLayers.delete(id);
    saveObjects();
    emitStateChange();
    return true;
  }

  function deleteMeasurement(id) {
    const index = state.measurements.findIndex(item => item.id === id);
    if (index < 0) return false;
    state.measurements.splice(index, 1);
    const layers = state.measurementLayers.get(id);
    if (layers) {
      removeLayer(layers.line);
      removeLayer(layers.label);
    }
    state.measurementLayers.delete(id);
    saveMeasurements();
    emitStateChange();
    return true;
  }

  function clearCoordinates() {
    Array.from(state.coordinateLayers.values()).forEach(removeLayer);
    state.coordinateLayers.clear();
    state.coordinates = [];
    saveCoordinates();
    emitStateChange();
  }

  function clearObjects() {
    Array.from(state.objectLayers.values()).forEach(removeLayer);
    state.objectLayers.clear();
    state.objects = [];
    saveObjects();
    emitStateChange();
  }

  function clearMeasurements() {
    Array.from(state.measurementLayers.values()).forEach(layers => {
      removeLayer(layers.line);
      removeLayer(layers.label);
    });
    state.measurementLayers.clear();
    state.measurements = [];
    cancelPendingMeasurement();
    saveMeasurements();
    emitStateChange();
  }

  function clearAll() {
    clearCoordinates();
    clearObjects();
    clearMeasurements();
  }

  function cancelPendingMeasurement() {
    state.pendingMeasurementStart = null;
    if (state.pendingMeasurementLayer) {
      removeLayer(state.pendingMeasurementLayer);
      state.pendingMeasurementLayer = null;
    }
  }

  function copyText(text) {
    if (global.navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let result = false;
    try {
      result = document.execCommand("copy");
    } catch (_) {
      result = false;
    }
    area.remove();
    return result;
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPayload() {
    return {
      metadata: {
        application: "ME Security Monitor",
        module: "OSINT Tools",
        version: VERSION,
        exportedAt: nowIso()
      },
      coordinates: state.coordinates.map(item => ({ ...item })),
      objects: state.objects.map(item => ({ ...item })),
      measurements: state.measurements.map(item => JSON.parse(JSON.stringify(item)))
    };
  }

  function exportJSON(options) {
    const payload = exportPayload();
    if (!options || options.download !== false) {
      downloadJson(`me-osint-tools-${new Date().toISOString().slice(0, 10)}.json`, payload);
    }
    return payload;
  }

  function exportGeoJSON(options) {
    const features = [];
    state.coordinates.forEach(item => {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [item.longitude, item.latitude] },
        properties: { featureType: "coordinate", id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt }
      });
    });
    state.objects.forEach(item => {
      const properties = { ...item, featureType: "object" };
      delete properties.latitude;
      delete properties.longitude;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [item.longitude, item.latitude] },
        properties
      });
    });
    state.measurements.forEach(item => {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [item.start.longitude, item.start.latitude],
            [item.end.longitude, item.end.latitude]
          ]
        },
        properties: {
          featureType: "measurement",
          id: item.id,
          distanceMeters: item.distanceMeters,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        }
      });
    });
    const collection = {
      type: "FeatureCollection",
      name: "ME Security Monitor OSINT Tools",
      generatedAt: nowIso(),
      features
    };
    if (!options || options.download !== false) {
      downloadJson(`me-osint-tools-${new Date().toISOString().slice(0, 10)}.geojson`, collection);
    }
    return collection;
  }

  function getControl(name) {
    return state.controls && state.controls[name] ? state.controls[name] : null;
  }

  function setElementText(element, value) {
    if (!element) return;
    if ("value" in element && /^(INPUT|TEXTAREA)$/i.test(element.tagName)) {
      element.value = value;
    } else {
      element.textContent = value;
    }
  }

  function refreshSummary() {
    setElementText(getControl("coordinatesCount"), String(state.coordinates.length));
    setElementText(getControl("objectsCount"), String(state.objects.length));
    setElementText(getControl("measurementsCount"), String(state.measurements.length));
    setElementText(getControl("activeMode"), state.mode);

    const modeButtons = getControl("modeButtons");
    if (modeButtons && typeof modeButtons === "object") {
      Object.entries(modeButtons).forEach(([mode, button]) => {
        if (!button || !button.classList) return;
        const active = mode === state.mode;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    return {
      coordinates: state.coordinates.length,
      objects: state.objects.length,
      measurements: state.measurements.length,
      activeMode: state.mode
    };
  }

  function updateMapCursor() {
    if (!state.map || !state.map.getContainer) return;
    const container = state.map.getContainer();
    container.classList.toggle("me-osint-map-crosshair", state.mode !== "none");
  }

  function setMode(mode) {
    const normalized = String(mode || "none").toLowerCase();
    if (!MODES.has(normalized)) throw new Error(`[MEOSINTTools] Unsupported mode: ${mode}`);
    if (state.mode === "measure" && normalized !== "measure") cancelPendingMeasurement();
    state.mode = normalized;
    updateMapCursor();
    refreshSummary();
    emitStateChange();
    return state.mode;
  }

  function getMode() {
    return state.mode;
  }

  function selectedObjectDefaults() {
    const categoryControl = getControl("objectCategory");
    const typeControl = getControl("objectType");
    return {
      category: categoryControl && categoryControl.value ? categoryControl.value : "Other",
      type: typeControl && typeControl.value ? typeControl.value : "Unknown object"
    };
  }

  function handleMapClick(event) {
    if (!event || !event.latlng || state.mode === "none") return;
    if (state.mode === "coordinate") {
      addCoordinate(event.latlng);
      return;
    }
    if (state.mode === "object") {
      openObjectModal(event.latlng, selectedObjectDefaults());
      return;
    }
    if (state.mode === "measure") {
      const point = normalizeLatLng(event.latlng);
      if (!point) return;
      if (!state.pendingMeasurementStart) {
        state.pendingMeasurementStart = point;
        state.pendingMeasurementLayer = global.L.circleMarker([point.latitude, point.longitude], {
          radius: 5,
          weight: 2,
          fillOpacity: 0.9
        }).addTo(state.map);
      } else {
        addMeasurement(state.pendingMeasurementStart, point);
        cancelPendingMeasurement();
      }
    }
  }

  function optionMarkup(items, selected) {
    return items.map(item => `<option value="${escapeHtml(item)}"${item === selected ? " selected" : ""}>${escapeHtml(item)}</option>`).join("");
  }

  function closeModal() {
    if (state.modal) {
      state.modal.remove();
      state.modal = null;
    }
  }

  function openObjectModal(latlng, defaults, existingId) {
    closeModal();
    const normalized = normalizeLatLng(latlng);
    if (!normalized) return;
    const existing = existingId ? state.objects.find(item => item.id === existingId) : null;
    const category = existing?.category || defaults?.category || "Other";
    const types = OBJECT_TYPES[category] || OBJECT_TYPES.Other;
    const currentType = existing?.type || defaults?.type || types[0];
    const backdrop = document.createElement("div");
    backdrop.className = "me-osint-modal-backdrop";
    backdrop.innerHTML = `
      <div class="me-osint-modal" role="dialog" aria-modal="true" aria-labelledby="me-osint-modal-title">
        <div class="me-osint-modal__header">
          <h2 class="me-osint-modal__title" id="me-osint-modal-title">${existing ? "Edit object" : "Add OSINT object"}</h2>
          <button type="button" class="me-osint-modal__close" data-me-osint-modal-close aria-label="Close">×</button>
        </div>
        <form data-me-osint-object-form>
          <div class="me-osint-modal__body">
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Name</span><input class="me-osint-modal__input" name="name" required value="${escapeHtml(existing?.name || "")}"></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Country</span><input class="me-osint-modal__input" name="country" value="${escapeHtml(existing?.country || "")}"></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Category</span><select class="me-osint-modal__select" name="category">${optionMarkup(Object.keys(OBJECT_TYPES), category)}</select></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Type</span><select class="me-osint-modal__select" name="type">${optionMarkup(types, currentType)}</select></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Actor</span><select class="me-osint-modal__select" name="actor">${optionMarkup(ACTORS, existing?.actor || "Unknown")}</select></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Reliability</span><select class="me-osint-modal__select" name="reliability">${optionMarkup(RELIABILITY_LEVELS, existing?.reliability || "Unverified")}</select></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Source type</span><select class="me-osint-modal__select" name="sourceType">${optionMarkup(SOURCE_TYPES, existing?.sourceType || "OSINT")}</select></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Source URL</span><input class="me-osint-modal__input" name="sourceUrl" type="url" value="${escapeHtml(existing?.sourceUrl || "")}"></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Latitude</span><input class="me-osint-modal__input" name="latitude" type="number" step="0.000001" min="-90" max="90" required value="${(existing?.latitude ?? normalized.latitude).toFixed(6)}"></label>
            <label class="me-osint-modal__field"><span class="me-osint-modal__label">Longitude</span><input class="me-osint-modal__input" name="longitude" type="number" step="0.000001" min="-180" max="180" required value="${(existing?.longitude ?? normalized.longitude).toFixed(6)}"></label>
            <label class="me-osint-modal__field me-osint-modal__field--full"><span class="me-osint-modal__label">Note</span><textarea class="me-osint-modal__textarea" name="note">${escapeHtml(existing?.note || "")}</textarea></label>
          </div>
          <div class="me-osint-modal__footer">
            <button type="button" class="me-osint-modal__button" data-me-osint-modal-close>Cancel</button>
            <button type="submit" class="me-osint-modal__button me-osint-modal__button--primary">Save object</button>
          </div>
        </form>
      </div>`;

    const form = backdrop.querySelector("[data-me-osint-object-form]");
    const categorySelect = form.elements.category;
    const typeSelect = form.elements.type;
    categorySelect.addEventListener("change", () => {
      typeSelect.innerHTML = optionMarkup(OBJECT_TYPES[categorySelect.value] || OBJECT_TYPES.Other, "");
    });
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop || event.target.closest("[data-me-osint-modal-close]")) closeModal();
    });
    form.addEventListener("submit", event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const updatedLatLng = normalizeLatLng({ latitude: data.latitude, longitude: data.longitude });
      if (!updatedLatLng) {
        global.alert("Invalid latitude or longitude.");
        return;
      }
      if (existing) {
        Object.assign(existing, sanitizeObject({
          ...existing,
          ...data,
          ...updatedLatLng,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: nowIso()
        }));
        const marker = state.objectLayers.get(existing.id);
        if (marker) {
          marker.setLatLng([existing.latitude, existing.longitude]);
          marker.setPopupContent(objectPopup(existing));
          marker.options.title = existing.name;
        }
        saveObjects();
        emitStateChange();
      } else {
        addObject(updatedLatLng, data);
      }
      closeModal();
    });

    document.body.appendChild(backdrop);
    state.modal = backdrop;
    const firstInput = backdrop.querySelector("input[name='name']");
    if (firstInput) firstInput.focus();
  }

  function handleDocumentClick(event) {
    const button = event.target.closest("[data-me-osint-action]");
    if (!button) return;
    const action = button.getAttribute("data-me-osint-action");
    const id = button.getAttribute("data-me-osint-id");
    if (!action || !id) return;

    if (action === "copy-coordinate") {
      const item = state.coordinates.find(entry => entry.id === id);
      if (item) copyText(`${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`);
    } else if (action === "delete-coordinate") {
      deleteCoordinate(id);
    } else if (action === "edit-object") {
      const item = state.objects.find(entry => entry.id === id);
      if (item) openObjectModal(item, item, id);
    } else if (action === "copy-object-coordinate") {
      const item = state.objects.find(entry => entry.id === id);
      if (item) copyText(`${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`);
    } else if (action === "delete-object") {
      deleteObject(id);
    } else if (action === "delete-measurement") {
      deleteMeasurement(id);
    }
    if (state.map) state.map.closePopup();
  }

  function bindControl(control, eventName, handler) {
    if (!control || typeof control.addEventListener !== "function") return;
    control.addEventListener(eventName, handler);
  }

  function bindControls() {
    const modeButtons = getControl("modeButtons") || {};
    Object.entries(modeButtons).forEach(([mode, button]) => {
      bindControl(button, "click", () => setMode(mode));
    });
    bindControl(getControl("stopButton"), "click", () => setMode("none"));
    bindControl(getControl("exportJsonButton"), "click", () => exportJSON());
    bindControl(getControl("exportGeoJsonButton"), "click", () => exportGeoJSON());
    bindControl(getControl("clearCoordinatesButton"), "click", clearCoordinates);
    bindControl(getControl("clearMeasurementsButton"), "click", clearMeasurements);
    bindControl(getControl("clearObjectsButton"), "click", clearObjects);
    bindControl(getControl("clearAllButton"), "click", clearAll);

    const category = getControl("objectCategory");
    const type = getControl("objectType");
    if (category && type) {
      const fillTypes = () => {
        const values = OBJECT_TYPES[category.value] || OBJECT_TYPES.Other;
        const previous = type.value;
        type.innerHTML = "";
        values.forEach(value => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          type.appendChild(option);
        });
        if (values.includes(previous)) type.value = previous;
      };
      if (!category.options.length) {
        Object.keys(OBJECT_TYPES).forEach(value => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = value;
          category.appendChild(option);
        });
      }
      bindControl(category, "change", fillTypes);
      fillTypes();
    }
  }

  function ensureInitialized() {
    if (!state.initialized || !state.map) {
      throw new Error("[MEOSINTTools] Module is not initialized. Call MEOSINTTools.init({ map, controls }).");
    }
  }

  function init(options) {
    if (state.initialized) destroy();
    requireLeaflet();
    if (!options || !options.map || typeof options.map.on !== "function") {
      throw new Error("[MEOSINTTools] init() requires a valid Leaflet map in options.map.");
    }
    injectStyles();
    state.map = options.map;
    state.controls = options.controls || {};
    state.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;
    state.mode = "none";
    loadState();
    renderAll();
    state.mapClickHandler = handleMapClick;
    state.map.on("click", state.mapClickHandler);
    document.addEventListener("click", handleDocumentClick);
    state.keydownHandler = event => {
      if (event.key === "Escape") {
        closeModal();
        setMode("none");
      }
    };
    document.addEventListener("keydown", state.keydownHandler);
    bindControls();
    state.initialized = true;
    refreshSummary();
    emitStateChange();
    return api;
  }

  function destroy() {
    closeModal();
    cancelPendingMeasurement();
    if (state.map && state.mapClickHandler) state.map.off("click", state.mapClickHandler);
    document.removeEventListener("click", handleDocumentClick);
    if (state.keydownHandler) document.removeEventListener("keydown", state.keydownHandler);
    Array.from(state.coordinateLayers.values()).forEach(removeLayer);
    Array.from(state.objectLayers.values()).forEach(removeLayer);
    Array.from(state.measurementLayers.values()).forEach(layers => {
      removeLayer(layers.line);
      removeLayer(layers.label);
    });
    state.coordinateLayers.clear();
    state.objectLayers.clear();
    state.measurementLayers.clear();
    if (state.map && state.map.getContainer) state.map.getContainer().classList.remove("me-osint-map-crosshair");
    state.map = null;
    state.controls = {};
    state.mode = "none";
    state.initialized = false;
    state.onStateChange = null;
    state.mapClickHandler = null;
    state.keydownHandler = null;
  }

  function getState() {
    return {
      version: VERSION,
      initialized: state.initialized,
      mode: state.mode,
      coordinates: state.coordinates.map(item => ({ ...item })),
      objects: state.objects.map(item => ({ ...item })),
      measurements: state.measurements.map(item => JSON.parse(JSON.stringify(item))),
      summary: {
        coordinates: state.coordinates.length,
        objects: state.objects.length,
        measurements: state.measurements.length
      }
    };
  }

  const api = Object.freeze({
    VERSION,
    STORAGE_KEYS: Object.freeze({ ...STORAGE_KEYS }),
    OBJECT_TYPES: Object.freeze(JSON.parse(JSON.stringify(OBJECT_TYPES))),
    ACTORS: Object.freeze([...ACTORS]),
    SOURCE_TYPES: Object.freeze([...SOURCE_TYPES]),
    RELIABILITY_LEVELS: Object.freeze([...RELIABILITY_LEVELS]),
    init,
    destroy,
    setMode,
    getMode,
    addCoordinate,
    addObject,
    addMeasurement,
    deleteCoordinate,
    deleteObject,
    deleteMeasurement,
    clearCoordinates,
    clearObjects,
    clearMeasurements,
    clearAll,
    exportJSON,
    exportGeoJSON,
    getState,
    refreshSummary
  });

  global.MEOSINTTools = api;
})(window);
