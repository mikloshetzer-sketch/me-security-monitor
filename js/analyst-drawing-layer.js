(function (global) {
  "use strict";

  const VERSION = "1.0.0";
  const STORAGE_KEY = "me_security_monitor_analyst_drawings_v1";
  const MODES = new Set(["none", "point", "line", "polygon", "circle", "arrow", "text", "freehand", "select"]);

  const DEFAULT_STYLE = Object.freeze({
    color: "#d94238",
    fillColor: "#d94238",
    weight: 3,
    opacity: 0.95,
    fillOpacity: 0.18,
    dashArray: "",
    radius: 8,
    fontSize: 14,
    lineCap: "round",
    lineJoin: "round"
  });

  const state = {
    map: null,
    mode: "none",
    drawings: [],
    layers: new Map(),
    draft: null,
    selectedId: null,
    style: { ...DEFAULT_STYLE },
    initialized: false,
    controls: {},
    history: [],
    future: [],
    freehandActive: false,
    freehandPoints: [],
    handlers: {},
    onStateChange: null
  };

  function uid(prefix) {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return `${prefix}_${global.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeLatLng(latlng) {
    if (!latlng) return null;
    const lat = Number(latlng.lat ?? latlng.latitude);
    const lng = Number(latlng.lng ?? latlng.lon ?? latlng.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  function saveStorage() {
    try {
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state.drawings));
    } catch (error) {
      console.warn("[MEAnalystDrawing] Could not save drawings.", error);
    }
  }

  function loadStorage() {
    try {
      const raw = global.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("[MEAnalystDrawing] Invalid stored drawings.", error);
      return [];
    }
  }

  function snapshot() {
    state.history.push(clone(state.drawings));
    if (state.history.length > 60) state.history.shift();
    state.future = [];
  }

  function restore(items) {
    clearRenderedLayers();
    state.drawings = clone(items || []);
    renderAll();
    saveStorage();
    notify();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(clone(state.drawings));
    restore(state.history.pop());
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(clone(state.drawings));
    restore(state.future.pop());
  }

  function notify() {
    updateStatus();
    updateSelectionPanel();
    if (typeof state.onStateChange === "function") {
      state.onStateChange(getState());
    }
  }

  function getLeaflet() {
    if (!global.L) throw new Error("Leaflet is required for MEAnalystDrawing.");
    return global.L;
  }

  function layerStyle(item) {
    const s = { ...DEFAULT_STYLE, ...(item.style || {}) };
    return {
      color: s.color,
      fillColor: s.fillColor || s.color,
      weight: Number(s.weight) || 3,
      opacity: Number(s.opacity) || 0.95,
      fillOpacity: Number(s.fillOpacity) || 0.18,
      dashArray: s.dashArray || null,
      lineCap: s.lineCap || "round",
      lineJoin: s.lineJoin || "round"
    };
  }

  function textIcon(item) {
    const L = getLeaflet();
    const s = { ...DEFAULT_STYLE, ...(item.style || {}) };
    const text = escapeHtml(item.text || "Annotation");
    return L.divIcon({
      className: "me-analyst-text-icon",
      html: `<div style="color:${escapeHtml(s.color)};font-size:${Number(s.fontSize) || 14}px;font-weight:800;white-space:nowrap;text-shadow:0 1px 2px rgba(255,255,255,.95),0 0 4px rgba(255,255,255,.9);">${text}</div>`,
      iconSize: null,
      iconAnchor: [0, 10]
    });
  }

  function pointIcon(item) {
    const L = getLeaflet();
    const s = { ...DEFAULT_STYLE, ...(item.style || {}) };
    const radius = Math.max(5, Number(s.radius) || 8);
    const size = radius * 2 + 6;
    return L.divIcon({
      className: "me-analyst-point-icon",
      html: `<div style="width:${radius * 2}px;height:${radius * 2}px;border-radius:50%;background:${escapeHtml(s.fillColor || s.color)};border:${Math.max(2, Number(s.weight) || 3)}px solid ${escapeHtml(s.color)};box-shadow:0 2px 8px rgba(0,0,0,.28);"></div>`,
      iconSize: [size, size],
      iconAnchor: [radius, radius]
    });
  }

  function arrowHeadIcon(item) {
    const L = getLeaflet();
    const s = { ...DEFAULT_STYLE, ...(item.style || {}) };
    const pts = item.points || [];
    let angle = 0;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      angle = Math.atan2(b.lat - a.lat, b.lng - a.lng) * 180 / Math.PI;
    }
    return L.divIcon({
      className: "me-analyst-arrowhead-icon",
      html: `<div style="width:0;height:0;border-top:9px solid transparent;border-bottom:9px solid transparent;border-left:18px solid ${escapeHtml(s.color)};transform:rotate(${-angle}deg);transform-origin:50% 50%;filter:drop-shadow(0 1px 2px rgba(0,0,0,.3));"></div>`,
      iconSize: [20, 20],
      iconAnchor: [16, 10]
    });
  }

  function createLayer(item) {
    const L = getLeaflet();
    const style = layerStyle(item);
    let layer = null;

    if (item.type === "point") {
      layer = L.marker(item.point, { icon: pointIcon(item), draggable: state.mode === "select" });
    } else if (item.type === "text") {
      layer = L.marker(item.point, { icon: textIcon(item), draggable: state.mode === "select" });
    } else if (item.type === "circle") {
      layer = L.circle(item.center, { ...style, radius: Number(item.radiusMeters) || 1000 });
    } else if (["line", "arrow", "freehand"].includes(item.type)) {
      const line = L.polyline(item.points || [], style);
      if (item.type === "arrow") {
        const end = (item.points || [])[item.points.length - 1];
        const group = L.layerGroup([line]);
        if (end) group.addLayer(L.marker(end, { icon: arrowHeadIcon(item), interactive: false }));
        layer = group;
        layer._mainLine = line;
      } else {
        layer = line;
      }
    } else if (item.type === "polygon") {
      layer = L.polygon(item.points || [], style);
    }

    if (!layer) return null;
    layer.addTo(state.map);
    bindLayerEvents(item, layer);
    return layer;
  }

  function bindLayerEvents(item, layer) {
    const clickable = layer._mainLine || layer;
    if (clickable?.on) {
      clickable.on("click", function (event) {
        if (state.mode === "select") {
          global.L.DomEvent.stopPropagation(event);
          selectDrawing(item.id);
        }
      });
    }

    if ((item.type === "point" || item.type === "text") && layer.on) {
      layer.on("dragend", function () {
        snapshot();
        const p = normalizeLatLng(layer.getLatLng());
        if (p) item.point = p;
        item.updatedAt = nowIso();
        saveStorage();
        notify();
      });
    }
  }

  function renderItem(item) {
    const existing = state.layers.get(item.id);
    if (existing) state.map.removeLayer(existing);
    const layer = createLayer(item);
    if (layer) state.layers.set(item.id, layer);
  }

  function renderAll() {
    state.drawings.forEach(renderItem);
  }

  function clearRenderedLayers() {
    state.layers.forEach(layer => {
      try { state.map?.removeLayer(layer); } catch (_) {}
    });
    state.layers.clear();
    clearDraft();
  }

  function clearDraft() {
    if (state.draft?.layer && state.map?.hasLayer(state.draft.layer)) {
      state.map.removeLayer(state.draft.layer);
    }
    if (state.draft?.auxLayers) {
      state.draft.auxLayers.forEach(layer => {
        if (state.map?.hasLayer(layer)) state.map.removeLayer(layer);
      });
    }
    state.draft = null;
    state.freehandActive = false;
    state.freehandPoints = [];
  }

  function setMode(mode) {
    if (!MODES.has(mode)) mode = "none";
    clearDraft();
    state.mode = mode;
    state.selectedId = null;
    if (state.map) {
      state.map.getContainer().style.cursor = mode === "none" ? "" : mode === "select" ? "pointer" : "crosshair";
    }
    refreshDraggability();
    updateModeButtons();
    notify();
  }

  function refreshDraggability() {
    state.drawings.forEach(item => {
      const layer = state.layers.get(item.id);
      if (!layer || !layer.dragging) return;
      if (state.mode === "select" && ["point", "text"].includes(item.type)) layer.dragging.enable();
      else layer.dragging.disable();
    });
  }

  function addDrawing(item) {
    snapshot();
    const normalized = {
      id: item.id || uid("drawing"),
      createdAt: item.createdAt || nowIso(),
      updatedAt: nowIso(),
      title: item.title || "",
      note: item.note || "",
      style: { ...state.style, ...(item.style || {}) },
      ...item
    };
    state.drawings.push(normalized);
    renderItem(normalized);
    saveStorage();
    notify();
    return normalized;
  }

  function removeDrawing(id) {
    const index = state.drawings.findIndex(item => item.id === id);
    if (index < 0) return;
    snapshot();
    const layer = state.layers.get(id);
    if (layer) state.map.removeLayer(layer);
    state.layers.delete(id);
    state.drawings.splice(index, 1);
    if (state.selectedId === id) state.selectedId = null;
    saveStorage();
    notify();
  }

  function selectDrawing(id) {
    state.selectedId = id;
    updateSelectionPanel();
    const item = state.drawings.find(d => d.id === id);
    const layer = state.layers.get(id);
    if (item && layer) {
      const target = layer.getBounds ? layer.getBounds() : layer.getLatLng ? layer.getLatLng() : null;
      if (target && state.map) {
        if (typeof target.isValid === "function" && target.isValid()) state.map.fitBounds(target.pad(0.25));
        else if (target.lat != null) state.map.panTo(target);
      }
    }
  }

  function applyStyleToSelected() {
    const item = state.drawings.find(d => d.id === state.selectedId);
    if (!item) return;
    snapshot();
    item.style = { ...item.style, ...state.style };
    item.updatedAt = nowIso();
    renderItem(item);
    saveStorage();
    notify();
  }

  function handleMapClick(event) {
    const p = normalizeLatLng(event.latlng);
    if (!p) return;

    if (state.mode === "point") {
      addDrawing({ type: "point", point: p });
      return;
    }
    if (state.mode === "text") {
      const text = global.prompt("Annotation text:", "");
      if (text && text.trim()) addDrawing({ type: "text", point: p, text: text.trim() });
      return;
    }
    if (state.mode === "line" || state.mode === "polygon" || state.mode === "arrow") {
      handleVertexMode(p);
      return;
    }
    if (state.mode === "circle") {
      handleCircleClick(p);
    }
  }

  function handleVertexMode(p) {
    const L = getLeaflet();
    if (!state.draft) {
      const points = [p];
      const layer = state.mode === "polygon"
        ? L.polygon(points, { ...layerStyle({ style: state.style }), dashArray: "6 5" }).addTo(state.map)
        : L.polyline(points, { ...layerStyle({ style: state.style }), dashArray: "6 5" }).addTo(state.map);
      state.draft = { type: state.mode, points, layer };
    } else {
      state.draft.points.push(p);
      state.draft.layer.setLatLngs(state.draft.points);
    }
    updateStatus();
  }

  function handleCircleClick(p) {
    const L = getLeaflet();
    if (!state.draft) {
      const layer = L.circle(p, { ...layerStyle({ style: state.style }), radius: 1, dashArray: "6 5" }).addTo(state.map);
      state.draft = { type: "circle", center: p, layer };
    } else {
      const radiusMeters = state.map.distance(state.draft.center, p);
      const center = state.draft.center;
      clearDraft();
      addDrawing({ type: "circle", center, radiusMeters });
    }
    updateStatus();
  }

  function handleMouseMove(event) {
    if (state.draft?.type === "circle") {
      const radius = state.map.distance(state.draft.center, event.latlng);
      state.draft.layer.setRadius(radius);
    }
    if (state.freehandActive && state.mode === "freehand") {
      const p = normalizeLatLng(event.latlng);
      if (!p) return;
      const last = state.freehandPoints[state.freehandPoints.length - 1];
      if (!last || state.map.distance(last, p) > 20) {
        state.freehandPoints.push(p);
        state.draft?.layer?.setLatLngs(state.freehandPoints);
      }
    }
  }

  function handleMouseDown(event) {
    if (state.mode !== "freehand") return;
    const L = getLeaflet();
    state.freehandActive = true;
    state.freehandPoints = [normalizeLatLng(event.latlng)];
    state.map.dragging.disable();
    const layer = L.polyline(state.freehandPoints, layerStyle({ style: state.style })).addTo(state.map);
    state.draft = { type: "freehand", points: state.freehandPoints, layer };
  }

  function handleMouseUp() {
    if (!state.freehandActive || state.mode !== "freehand") return;
    state.freehandActive = false;
    state.map.dragging.enable();
    const points = clone(state.freehandPoints);
    clearDraft();
    if (points.length >= 2) addDrawing({ type: "freehand", points });
  }

  function finishDraft() {
    if (!state.draft) return;
    const draft = state.draft;
    if (["line", "arrow"].includes(draft.type) && draft.points.length >= 2) {
      const points = clone(draft.points);
      clearDraft();
      addDrawing({ type: draft.type, points });
    } else if (draft.type === "polygon" && draft.points.length >= 3) {
      const points = clone(draft.points);
      clearDraft();
      addDrawing({ type: "polygon", points });
    }
  }

  function handleDoubleClick(event) {
    if (!["line", "polygon", "arrow"].includes(state.mode)) return;
    global.L.DomEvent.stopPropagation(event);
    finishDraft();
  }

  function handleKeydown(event) {
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if (event.key === "Escape") setMode("none");
    if (event.key === "Enter") finishDraft();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
    }
    if ((event.key === "Delete" || event.key === "Backspace") && state.selectedId && state.mode === "select") {
      removeDrawing(state.selectedId);
    }
  }

  function clearAll() {
    if (!state.drawings.length) return;
    if (!global.confirm("Delete every analyst drawing?")) return;
    snapshot();
    clearRenderedLayers();
    state.drawings = [];
    state.selectedId = null;
    saveStorage();
    notify();
  }

  function toGeoJSON() {
    const features = state.drawings.map(item => {
      const properties = {
        id: item.id,
        drawingType: item.type,
        title: item.title || "",
        note: item.note || "",
        text: item.text || "",
        style: item.style || {},
        radiusMeters: item.radiusMeters || null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };
      if (["point", "text"].includes(item.type)) {
        return { type: "Feature", properties, geometry: { type: "Point", coordinates: [item.point.lng, item.point.lat] } };
      }
      if (item.type === "circle") {
        return { type: "Feature", properties, geometry: { type: "Point", coordinates: [item.center.lng, item.center.lat] } };
      }
      const coords = (item.points || []).map(p => [p.lng, p.lat]);
      if (item.type === "polygon") {
        const ring = coords.length && JSON.stringify(coords[0]) !== JSON.stringify(coords[coords.length - 1]) ? [...coords, coords[0]] : coords;
        return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [ring] } };
      }
      return { type: "Feature", properties, geometry: { type: "LineString", coordinates: coords } };
    });
    return { type: "FeatureCollection", name: "ME Security Monitor Analyst Drawings", generatedAt: nowIso(), features };
  }

  function download(filename, data, mime) {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportGeoJSON() {
    download(`me-analyst-drawings-${new Date().toISOString().slice(0, 10)}.geojson`, JSON.stringify(toGeoJSON(), null, 2), "application/geo+json");
  }

  function exportJSON() {
    download(`me-analyst-drawings-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: VERSION, exportedAt: nowIso(), drawings: state.drawings }, null, 2), "application/json");
  }

  function importData(data) {
    let incoming = [];
    if (Array.isArray(data)) incoming = data;
    else if (Array.isArray(data?.drawings)) incoming = data.drawings;
    else if (data?.type === "FeatureCollection" && Array.isArray(data.features)) {
      incoming = data.features.map(featureToDrawing).filter(Boolean);
    }
    if (!incoming.length) throw new Error("No supported analyst drawings found.");
    snapshot();
    incoming.forEach(item => {
      item.id = item.id || uid("drawing");
      item.createdAt = item.createdAt || nowIso();
      item.updatedAt = nowIso();
    });
    state.drawings.push(...incoming);
    clearRenderedLayers();
    renderAll();
    saveStorage();
    notify();
  }

  function featureToDrawing(feature) {
    const g = feature?.geometry;
    if (!g) return null;
    const p = feature.properties || {};
    const base = { id: p.id, type: p.drawingType, title: p.title || "", note: p.note || "", text: p.text || "", style: p.style || {}, radiusMeters: p.radiusMeters, createdAt: p.createdAt };
    if (g.type === "Point") {
      const point = { lat: Number(g.coordinates[1]), lng: Number(g.coordinates[0]) };
      if (base.type === "circle" || p.radiusMeters) return { ...base, type: "circle", center: point, radiusMeters: Number(p.radiusMeters) || 1000 };
      return { ...base, type: base.type === "text" ? "text" : "point", point };
    }
    if (g.type === "LineString") {
      return { ...base, type: ["arrow", "freehand"].includes(base.type) ? base.type : "line", points: g.coordinates.map(c => ({ lat: Number(c[1]), lng: Number(c[0]) })) };
    }
    if (g.type === "Polygon") {
      const ring = (g.coordinates?.[0] || []).map(c => ({ lat: Number(c[1]), lng: Number(c[0]) }));
      if (ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng) ring.pop();
      return { ...base, type: "polygon", points: ring };
    }
    return null;
  }

  function triggerImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.geojson,application/json,application/geo+json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        importData(JSON.parse(await file.text()));
      } catch (error) {
        global.alert(`Import failed: ${error.message}`);
      }
    });
    input.click();
  }

  function createButton(label, mode, title) {
    return `<button type="button" class="btn-mini me-drawing-mode" data-drawing-mode="${mode}" title="${escapeHtml(title || label)}">${label}</button>`;
  }

  function buildPanel(container) {
    if (!container || container.querySelector("[data-control-block='analyst-drawing']")) return;
    const block = document.createElement("div");
    block.dataset.controlBlock = "analyst-drawing";
    block.className = "analyst-drawing-control-block";
    block.innerHTML = `
      <div style="font-weight:900;margin-bottom:7px;">Analyst Drawing</div>
      <div class="muted" style="margin-bottom:8px;">Térképi elemzői jelölések, annotációk és műveleti vázlatok.</div>
      <div class="me-drawing-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">
        ${createButton("● Pont", "point")}
        ${createButton("━ Vonal", "line")}
        ${createButton("⬠ Poligon", "polygon")}
        ${createButton("○ Kör", "circle")}
        ${createButton("➜ Nyíl", "arrow")}
        ${createButton("T Szöveg", "text")}
        ${createButton("✎ Szabad", "freehand")}
        ${createButton("⌖ Kijelöl", "select")}
        ${createButton("× Kilép", "none")}
      </div>
      <div id="meDrawingStatus" class="muted" style="margin-top:8px;padding:7px 8px;border:1px solid rgba(34,51,68,.10);border-radius:9px;background:#f8fafc;">Mode: none</div>
      <div style="margin-top:9px;padding-top:9px;border-top:1px solid rgba(34,51,68,.10);">
        <div class="muted" style="margin-bottom:6px;">Megjelenés</div>
        <div class="row"><label>Vonal <input id="meDrawingColor" type="color" value="${DEFAULT_STYLE.color}" style="width:42px;height:28px;padding:0;border:0;"></label><label>Kitöltés <input id="meDrawingFillColor" type="color" value="${DEFAULT_STYLE.fillColor}" style="width:42px;height:28px;padding:0;border:0;"></label></div>
        <div class="muted">Vastagság: <span id="meDrawingWeightLabel">3</span></div>
        <input id="meDrawingWeight" type="range" min="1" max="10" step="1" value="3">
        <div class="muted">Kitöltés: <span id="meDrawingFillOpacityLabel">0.18</span></div>
        <input id="meDrawingFillOpacity" type="range" min="0" max="0.8" step="0.02" value="0.18">
        <select id="meDrawingDash" style="margin-top:6px;">
          <option value="">Folytonos vonal</option>
          <option value="8 6">Szaggatott vonal</option>
          <option value="2 7">Pontozott vonal</option>
          <option value="14 7 3 7">Műveleti vonal</option>
        </select>
        <button id="meDrawingApplyStyle" type="button" class="btn-mini" style="width:100%;margin-top:6px;">Stílus alkalmazása a kijelöltre</button>
      </div>
      <div id="meDrawingSelection" style="margin-top:9px;"></div>
      <div class="row" style="margin-top:9px;">
        <button id="meDrawingUndo" type="button" class="btn-mini">↶ Vissza</button>
        <button id="meDrawingRedo" type="button" class="btn-mini">↷ Előre</button>
        <button id="meDrawingClear" type="button" class="btn-mini">Törlés mind</button>
      </div>
      <div class="row">
        <button id="meDrawingExportGeoJSON" type="button" class="btn-mini">GeoJSON</button>
        <button id="meDrawingExportJSON" type="button" class="btn-mini">Biztonsági mentés</button>
        <button id="meDrawingImport" type="button" class="btn-mini">Import</button>
      </div>
      <div class="muted" style="margin-top:7px;">Enter: befejezés · Esc: kilépés · Ctrl+Z/Y: vissza/előre · Delete: kijelölt elem törlése</div>
    `;
    container.appendChild(block);
    state.controls.block = block;
    bindPanelControls(block);
  }

  function bindPanelControls(block) {
    block.querySelectorAll("[data-drawing-mode]").forEach(button => {
      button.addEventListener("click", () => setMode(button.dataset.drawingMode));
    });
    const color = block.querySelector("#meDrawingColor");
    const fillColor = block.querySelector("#meDrawingFillColor");
    const weight = block.querySelector("#meDrawingWeight");
    const fillOpacity = block.querySelector("#meDrawingFillOpacity");
    const dash = block.querySelector("#meDrawingDash");
    color.addEventListener("input", () => state.style.color = color.value);
    fillColor.addEventListener("input", () => state.style.fillColor = fillColor.value);
    weight.addEventListener("input", () => {
      state.style.weight = Number(weight.value);
      block.querySelector("#meDrawingWeightLabel").textContent = weight.value;
    });
    fillOpacity.addEventListener("input", () => {
      state.style.fillOpacity = Number(fillOpacity.value);
      block.querySelector("#meDrawingFillOpacityLabel").textContent = Number(fillOpacity.value).toFixed(2);
    });
    dash.addEventListener("change", () => state.style.dashArray = dash.value);
    block.querySelector("#meDrawingApplyStyle").addEventListener("click", applyStyleToSelected);
    block.querySelector("#meDrawingUndo").addEventListener("click", undo);
    block.querySelector("#meDrawingRedo").addEventListener("click", redo);
    block.querySelector("#meDrawingClear").addEventListener("click", clearAll);
    block.querySelector("#meDrawingExportGeoJSON").addEventListener("click", exportGeoJSON);
    block.querySelector("#meDrawingExportJSON").addEventListener("click", exportJSON);
    block.querySelector("#meDrawingImport").addEventListener("click", triggerImport);
  }

  function updateModeButtons() {
    const block = state.controls.block;
    if (!block) return;
    block.querySelectorAll("[data-drawing-mode]").forEach(button => {
      const active = button.dataset.drawingMode === state.mode;
      button.classList.toggle("active", active);
      button.style.background = active ? "#173b57" : "";
      button.style.color = active ? "#fff" : "";
    });
  }

  function updateStatus() {
    const el = state.controls.block?.querySelector("#meDrawingStatus");
    if (!el) return;
    let extra = "";
    if (state.draft?.points) extra = ` · ${state.draft.points.length} pont · Enter vagy dupla kattintás a befejezéshez`;
    if (state.draft?.type === "circle") extra = " · kattints a sugár végpontjára";
    el.textContent = `Mode: ${state.mode} · Rajzok: ${state.drawings.length}${extra}`;
  }

  function updateSelectionPanel() {
    const host = state.controls.block?.querySelector("#meDrawingSelection");
    if (!host) return;
    const item = state.drawings.find(d => d.id === state.selectedId);
    if (!item) {
      host.innerHTML = `<div class="muted">Kijelölés módban kattints egy rajzra a szerkesztéshez.</div>`;
      return;
    }
    host.innerHTML = `
      <div style="padding:8px;border:1px solid rgba(34,51,68,.12);border-radius:10px;background:#fff;">
        <div style="font-weight:850;font-size:11px;margin-bottom:6px;">Kijelölt: ${escapeHtml(item.type)}</div>
        <input id="meDrawingTitleEdit" type="text" placeholder="Cím" value="${escapeHtml(item.title || "")}">
        ${item.type === "text" ? `<input id="meDrawingTextEdit" type="text" placeholder="Szöveg" value="${escapeHtml(item.text || "")}" style="margin-top:5px;">` : ""}
        <textarea id="meDrawingNoteEdit" placeholder="Elemzői megjegyzés" style="width:100%;min-height:58px;margin-top:5px;padding:8px;border:1px solid #cfd8e1;border-radius:9px;font:inherit;resize:vertical;">${escapeHtml(item.note || "")}</textarea>
        <div class="row">
          <button id="meDrawingSaveEdit" type="button" class="btn-mini">Mentés</button>
          <button id="meDrawingZoomEdit" type="button" class="btn-mini">Mutasd</button>
          <button id="meDrawingDeleteEdit" type="button" class="btn-mini">Törlés</button>
        </div>
      </div>`;
    host.querySelector("#meDrawingSaveEdit").addEventListener("click", () => {
      snapshot();
      item.title = host.querySelector("#meDrawingTitleEdit").value.trim();
      item.note = host.querySelector("#meDrawingNoteEdit").value.trim();
      const textInput = host.querySelector("#meDrawingTextEdit");
      if (textInput) item.text = textInput.value.trim() || "Annotation";
      item.updatedAt = nowIso();
      renderItem(item);
      saveStorage();
      notify();
    });
    host.querySelector("#meDrawingZoomEdit").addEventListener("click", () => selectDrawing(item.id));
    host.querySelector("#meDrawingDeleteEdit").addEventListener("click", () => removeDrawing(item.id));
  }

  function getState() {
    return {
      version: VERSION,
      mode: state.mode,
      selectedId: state.selectedId,
      drawings: clone(state.drawings),
      style: clone(state.style)
    };
  }

  function bindMap() {
    state.handlers.click = handleMapClick;
    state.handlers.dblclick = handleDoubleClick;
    state.handlers.mousemove = handleMouseMove;
    state.handlers.mousedown = handleMouseDown;
    state.handlers.mouseup = handleMouseUp;
    state.handlers.keydown = handleKeydown;
    state.map.on("click", state.handlers.click);
    state.map.on("dblclick", state.handlers.dblclick);
    state.map.on("mousemove", state.handlers.mousemove);
    state.map.on("mousedown", state.handlers.mousedown);
    state.map.on("mouseup", state.handlers.mouseup);
    document.addEventListener("keydown", state.handlers.keydown);
  }

  function init(options) {
    if (state.initialized) return getState();
    if (!options?.map) throw new Error("MEAnalystDrawing.init requires { map }.");
    state.map = options.map;
    state.onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;
    state.style = { ...DEFAULT_STYLE, ...(options.defaultStyle || {}) };
    state.drawings = loadStorage();
    const container = options.container || document.querySelector(options.containerSelector || "#controlPanel");
    if (options.buildPanel !== false) buildPanel(container);
    bindMap();
    renderAll();
    state.initialized = true;
    notify();
    return getState();
  }

  function destroy() {
    if (!state.initialized) return;
    clearRenderedLayers();
    if (state.map) {
      state.map.off("click", state.handlers.click);
      state.map.off("dblclick", state.handlers.dblclick);
      state.map.off("mousemove", state.handlers.mousemove);
      state.map.off("mousedown", state.handlers.mousedown);
      state.map.off("mouseup", state.handlers.mouseup);
    }
    document.removeEventListener("keydown", state.handlers.keydown);
    state.controls.block?.remove();
    state.initialized = false;
    state.map = null;
  }

  global.MEAnalystDrawing = Object.freeze({
    VERSION,
    init,
    destroy,
    setMode,
    finishDraft,
    undo,
    redo,
    clearAll,
    exportGeoJSON,
    exportJSON,
    importData,
    getState,
    selectDrawing,
    removeDrawing
  });
})(window);
