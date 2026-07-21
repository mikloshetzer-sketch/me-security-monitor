(() => {
  "use strict";

  const CONFIG = {
    dataUrl: "./data/strike_history.json",
    defaultDays: 7,
    defaultActor: "ALL"
  };

  const state = {
    map: null,
    events: [],
    latestDate: null,
    days: CONFIG.defaultDays,
    actor: CONFIG.defaultActor,
    enabled: false,
    labelsEnabled: false,
    layerGroup: null,
    markerById: new Map(),
    cardById: new Map(),
    lineById: new Map(),
    annotationRoot: null,
    svg: null,
    cardsRoot: null
  };

  wrapLeafletMapFactory();
  document.addEventListener("DOMContentLoaded", () => {
    bindControls();
    loadData();
    discoverExistingMap();
  });

  function wrapLeafletMapFactory() {
    if (!window.L || !L.map || L.map.__strikeHistoryWrapped) return;
    const original = L.map;
    function wrapped(...args) {
      const map = original.apply(this, args);
      setTimeout(() => attachMap(map), 0);
      return map;
    }
    Object.assign(wrapped, original);
    wrapped.__strikeHistoryWrapped = true;
    L.map = wrapped;
  }

  function discoverExistingMap() {
    const mapElement = document.getElementById("map");
    if (!mapElement) return;
    const interval = setInterval(() => {
      if (state.map) return clearInterval(interval);
      if (mapElement._leaflet_id && window.L) {
        // The wrapper normally captures it. This fallback waits for a globally exposed map.
        const candidates = [window.map, window.meMap, window.mainMap].filter(Boolean);
        if (candidates.length) attachMap(candidates[0]);
      }
    }, 400);
    setTimeout(() => clearInterval(interval), 12000);
  }

  function attachMap(map) {
    if (!map || state.map === map) return;
    state.map = map;
    state.layerGroup = L.layerGroup();
    ensureAnnotationRoot();
    map.on("move zoom resize", updateAllGeometry);
    render();
  }

  function ensureAnnotationRoot() {
    if (!state.map || state.annotationRoot) return;
    const container = state.map.getContainer();
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const root = document.createElement("div");
    root.className = "strike-history-annotation-layer";
    root.innerHTML = '<svg class="strike-history-lines" aria-hidden="true"></svg><div class="strike-history-cards"></div>';
    container.appendChild(root);
    state.annotationRoot = root;
    state.svg = root.querySelector("svg");
    state.cardsRoot = root.querySelector(".strike-history-cards");
  }

  async function loadData() {
    try {
      const response = await fetch(`${CONFIG.dataUrl}?v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.events = Array.isArray(payload.events) ? payload.events : [];
      state.latestDate =
        payload.summary?.date_end ||
        payload.latest_event_date ||
        state.events.map(e => e.date).filter(Boolean).sort().at(-1) ||
        null;
      setNote(`${state.events.length} esemény betöltve. Legfrissebb dátum: ${state.latestDate || "—"}.`);
      render();
    } catch (error) {
      console.error("[StrikeHistory]", error);
      setNote(`Adatbetöltési hiba: ${error.message}`);
    }
  }

  function selectedEvents() {
    if (!state.latestDate) return [];
    const end = new Date(`${state.latestDate}T23:59:59Z`);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (state.days - 1));
    return state.events.filter(event => {
      const date = new Date(`${event.date}T12:00:00Z`);
      const actor = normalizeActor(event.attacker);
      return Number.isFinite(Number(event.latitude)) &&
        Number.isFinite(Number(event.longitude)) &&
        date >= start && date <= end &&
        (state.actor === "ALL" || actor === state.actor);
    });
  }

  function render() {
    updateStats();
    if (!state.map || !state.layerGroup) return;
    state.layerGroup.clearLayers();
    state.markerById.clear();
    clearAnnotations();

    if (!state.enabled) {
      if (state.map.hasLayer(state.layerGroup)) state.map.removeLayer(state.layerGroup);
      return;
    }
    if (!state.map.hasLayer(state.layerGroup)) state.layerGroup.addTo(state.map);

    selectedEvents().forEach(event => {
      const actor = normalizeActor(event.attacker);
      const confidence = String(event.confidence || "MEDIUM").toLowerCase();
      const marker = L.marker([Number(event.latitude), Number(event.longitude)], {
        icon: L.divIcon({
          className: "",
          html: `<div class="strike-history-marker ${actor.toLowerCase()} ${confidence}"></div>`,
          iconSize: [18,18],
          iconAnchor: [9,9]
        }),
        keyboard: true,
        title: `${actor}: ${event.target_location || ""}`
      });
      marker.bindTooltip(
        `<b>${escapeHtml(event.target_location || "Ismeretlen helyszín")}</b><br>${escapeHtml(actor)} · ${escapeHtml(event.date || "")}`,
        { direction: "top", offset: [0,-8] }
      );
      marker.on("click", () => {
        if (!state.labelsEnabled) {
          state.labelsEnabled = true;
          const checkbox = document.getElementById("strikeHistoryLabelsCheckbox");
          if (checkbox) checkbox.checked = true;
          renderAnnotations();
        }
        focusCard(event.event_id);
      });
      marker.addTo(state.layerGroup);
      state.markerById.set(event.event_id, marker);
    });

    if (state.labelsEnabled) renderAnnotations();
  }

  function renderAnnotations() {
    clearAnnotations();
    if (!state.enabled || !state.labelsEnabled || !state.map) return;
    ensureAnnotationRoot();
    const events = selectedEvents();

    events.forEach((event, index) => {
      const marker = state.markerById.get(event.event_id);
      if (!marker) return;

      const actor = normalizeActor(event.attacker);
      const card = document.createElement("article");
      card.className = `strike-history-card ${actor.toLowerCase()}`;
      card.dataset.eventId = event.event_id;
      card.innerHTML = cardHtml(event, actor);

      const point = state.map.latLngToContainerPoint(marker.getLatLng());
      const mapSize = state.map.getSize();
      const left = clamp(point.x + 25 + (index % 3) * 18, 8, mapSize.x - 270);
      const top = clamp(point.y - 30 + (Math.floor(index / 3) % 5) * 25, 8, mapSize.y - 145);
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      state.cardsRoot.appendChild(card);
      state.cardById.set(event.event_id, card);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("strike-history-line");
      state.svg.appendChild(line);
      state.lineById.set(event.event_id, line);

      const toggle = card.querySelector(".strike-history-card-toggle");
      toggle.addEventListener("click", ev => {
        ev.stopPropagation();
        card.classList.toggle("expanded");
        toggle.textContent = card.classList.contains("expanded") ? "−" : "+";
        updateGeometry(event.event_id);
      });

      enableDragging(card, event.event_id);
      updateGeometry(event.event_id);
    });
  }

  function cardHtml(event, actor) {
    const summary = shortText(event.description || "", 150);
    const confidence = event.confidence_label_hu || event.confidence || "—";
    const source = safeUrl(event.source_url);
    return `
      <div class="strike-history-card-head">
        <div>
          <div class="strike-history-card-title">${escapeHtml(event.target_location || "Ismeretlen helyszín")}</div>
          <div class="strike-history-card-meta">${escapeHtml(actor)} · ${escapeHtml(event.date || "")}</div>
        </div>
        <button class="strike-history-card-toggle" type="button" aria-label="Részletek">+</button>
      </div>
      <div class="strike-history-card-summary">${escapeHtml(summary)}</div>
      <div class="strike-history-card-details">
        <div class="detail-row"><span class="detail-label">Részletes esemény:</span> ${escapeHtml(event.description || "Nincs adat.")}</div>
        <div class="detail-row"><span class="detail-label">Támadás típusa:</span> ${escapeHtml(event.strike_type || "—")}</div>
        <div class="detail-row"><span class="detail-label">Célország:</span> ${escapeHtml(event.target_country || "—")}</div>
        <div class="detail-row"><span class="detail-label">Bizonyosság:</span> ${escapeHtml(confidence)}</div>
        <div class="detail-row"><span class="detail-label">Koordináta:</span> ${escapeHtml(String(event.latitude))}, ${escapeHtml(String(event.longitude))}</div>
        <div class="detail-row"><span class="detail-label">Egyéb információ:</span> ${escapeHtml(event.coordinate_note || "—")}</div>
        ${source ? `<div class="detail-row"><a href="${source}" target="_blank" rel="noopener noreferrer">Forrás megnyitása ↗</a></div>` : ""}
      </div>`;
  }

  function enableDragging(card, eventId) {
    const handle = card.querySelector(".strike-history-card-head");
    let active = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    handle.addEventListener("pointerdown", event => {
      if (event.target.closest("button,a")) return;
      active = true;
      startX = event.clientX; startY = event.clientY;
      startLeft = parseFloat(card.style.left) || 0;
      startTop = parseFloat(card.style.top) || 0;
      card.classList.add("dragging");
      handle.setPointerCapture(event.pointerId);
      const line = state.lineById.get(eventId);
      if (line) line.style.display = "none";
      state.map?.dragging?.disable();
      event.preventDefault();
    });

    handle.addEventListener("pointermove", event => {
      if (!active) return;
      const size = state.map.getSize();
      card.style.left = `${clamp(startLeft + event.clientX - startX, 4, size.x - card.offsetWidth - 4)}px`;
      card.style.top = `${clamp(startTop + event.clientY - startY, 4, size.y - card.offsetHeight - 4)}px`;
    });

    const finish = event => {
      if (!active) return;
      active = false;
      card.classList.remove("dragging");
      try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
      const line = state.lineById.get(eventId);
      if (line) line.style.display = "";
      state.map?.dragging?.enable();
      updateGeometry(eventId);
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function updateAllGeometry() {
    if (!state.labelsEnabled) return;
    state.cardById.forEach((_, eventId) => updateGeometry(eventId));
  }

  function updateGeometry(eventId) {
    const marker = state.markerById.get(eventId);
    const card = state.cardById.get(eventId);
    const line = state.lineById.get(eventId);
    if (!marker || !card || !line || !state.map) return;
    const p = state.map.latLngToContainerPoint(marker.getLatLng());
    const left = parseFloat(card.style.left) || 0;
    const top = parseFloat(card.style.top) || 0;
    const x2 = clamp(p.x, left, left + card.offsetWidth);
    const y2 = clamp(p.y, top, top + card.offsetHeight);
    line.setAttribute("x1", p.x); line.setAttribute("y1", p.y);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
  }

  function clearAnnotations() {
    if (state.cardsRoot) state.cardsRoot.innerHTML = "";
    if (state.svg) state.svg.innerHTML = "";
    state.cardById.clear(); state.lineById.clear();
  }

  function bindControls() {
    const layer = document.getElementById("strikeHistoryLayerCheckbox");
    const labels = document.getElementById("strikeHistoryLabelsCheckbox");
    if (!layer) return;

    layer.addEventListener("change", () => {
      state.enabled = layer.checked;
      if (!state.enabled) {
        state.labelsEnabled = false;
        if (labels) labels.checked = false;
      }
      render();
    });

    labels?.addEventListener("change", () => {
      state.labelsEnabled = labels.checked;
      if (state.labelsEnabled && !state.enabled) {
        state.enabled = true;
        layer.checked = true;
      }
      render();
    });

    document.querySelectorAll("#strikeHistoryWindowButtons button").forEach(button => {
      button.addEventListener("click", () => {
        state.days = Number(button.dataset.days);
        setActiveButton("#strikeHistoryWindowButtons button", button);
        render();
      });
    });

    document.querySelectorAll("#strikeHistoryActorButtons button").forEach(button => {
      button.addEventListener("click", () => {
        state.actor = button.dataset.actor || "ALL";
        setActiveButton("#strikeHistoryActorButtons button", button);
        render();
      });
    });
  }

  function updateStats() {
    const events = selectedEvents();
    setText("strikeHistoryTotal", events.length);
    setText("strikeHistoryUsa", events.filter(e => normalizeActor(e.attacker) === "USA").length);
    setText("strikeHistoryIran", events.filter(e => normalizeActor(e.attacker) === "IRAN").length);
  }

  function setActiveButton(selector, active) {
    document.querySelectorAll(selector).forEach(button => button.classList.toggle("active", button === active));
  }
  function focusCard(id) {
    const card = state.cardById.get(id);
    if (!card) return;
    card.style.zIndex = String(1000 + Math.floor(Math.random() * 9000));
    card.animate([{transform:"scale(1)"},{transform:"scale(1.035)"},{transform:"scale(1)"}],{duration:340});
  }
  function normalizeActor(value) {
    const v = String(value || "").trim().toUpperCase();
    return v.includes("USA") || v.includes("UNITED STATES") ? "USA" : "IRAN";
  }
  function setText(id, value) { const el = document.getElementById(id); if (el) el.textContent = String(value); }
  function setNote(text) { const el = document.getElementById("strikeHistoryNote"); if (el) el.textContent = text; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function shortText(text, max) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
  }
  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch (_) { return ""; }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[char]));
  }
})();
