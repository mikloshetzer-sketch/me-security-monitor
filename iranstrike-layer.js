(() => {
  "use strict";

  const CONFIG = Object.freeze({
    dataUrl: "./data/strike_history.json",
    defaultDays: 7,
    defaultActor: "ALL",
    paneName: "strikeHistoryPane",
    paneZIndex: 675,
    mapDiscoveryTimeoutMs: 15000
  });

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
    cardPositions: new Map(),
    annotationRoot: null,
    svg: null,
    cardsRoot: null,
    initialized: false,
    dataLoaded: false,
    error: ""
  };

  captureLeafletMapCreation();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    bindControls();
    loadData();
    discoverExistingMap();
  }

  function captureLeafletMapCreation() {
    if (!window.L || typeof window.L.map !== "function") return;
    if (window.L.map.__strikeHistoryWrapped) return;

    const originalMapFactory = window.L.map;

    function wrappedMapFactory(...args) {
      const map = originalMapFactory.apply(this, args);
      window.setTimeout(() => attachMap(map), 0);
      return map;
    }

    Object.assign(wrappedMapFactory, originalMapFactory);
    wrappedMapFactory.__strikeHistoryWrapped = true;
    window.L.map = wrappedMapFactory;
  }

  function discoverExistingMap() {
    const startedAt = Date.now();

    const timer = window.setInterval(() => {
      if (state.map) {
        window.clearInterval(timer);
        return;
      }

      const candidates = [
        window.map,
        window.meMap,
        window.mainMap,
        window.securityMap
      ].filter(candidate => candidate && typeof candidate.getContainer === "function");

      if (candidates.length) {
        attachMap(candidates[0]);
        window.clearInterval(timer);
        return;
      }

      if (Date.now() - startedAt >= CONFIG.mapDiscoveryTimeoutMs) {
        window.clearInterval(timer);
      }
    }, 300);
  }

  function attachMap(map) {
    if (!map || typeof map.addLayer !== "function") return;
    if (state.map === map) return;

    state.map = map;
    ensurePane();
    state.layerGroup = window.L.layerGroup();
    ensureAnnotationRoot();

    map.on("move zoom resize", updateAllGeometry);
    render();
  }

  function ensurePane() {
    if (!state.map) return;

    if (!state.map.getPane(CONFIG.paneName)) {
      const pane = state.map.createPane(CONFIG.paneName);
      pane.style.zIndex = String(CONFIG.paneZIndex);
      pane.style.pointerEvents = "auto";
    }
  }

  function ensureAnnotationRoot() {
    if (!state.map || state.annotationRoot) return;

    const container = state.map.getContainer();
    if (window.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }

    const root = document.createElement("div");
    root.className = "strike-history-annotation-layer";
    root.innerHTML = [
      '<svg class="strike-history-lines" aria-hidden="true"></svg>',
      '<div class="strike-history-cards"></div>'
    ].join("");

    container.appendChild(root);

    state.annotationRoot = root;
    state.svg = root.querySelector(".strike-history-lines");
    state.cardsRoot = root.querySelector(".strike-history-cards");
  }

  async function loadData() {
    setStateBadge("Loading", "");

    try {
      const response = await fetch(
        `${CONFIG.dataUrl}?v=${Date.now()}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const rawEvents = extractEvents(payload);

      state.events = rawEvents
        .map(normalizeEvent)
        .filter(Boolean)
        .sort((a, b) => a.dateObject - b.dateObject);

      state.latestDate =
        parseDateValue(payload?.summary?.date_end) ||
        parseDateValue(payload?.latest_event_date) ||
        state.events.at(-1)?.dateObject ||
        null;

      state.dataLoaded = true;
      state.error = "";

      setNote(
        `${state.events.length} events loaded. Latest event: ${
          state.latestDate ? formatDate(state.latestDate) : "—"
        }.`
      );

      setStateBadge(
        state.enabled ? "Visible" : "Loaded",
        state.enabled ? "active" : ""
      );

      render();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.dataLoaded = false;
      console.error("[StrikeHistory]", error);
      setNote(`Data loading error: ${state.error}`);
      setStateBadge("Error", "error");
      render();
    }
  }

  function extractEvents(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.events)) return payload.events;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.strikes)) return payload.strikes;
    return [];
  }

  function normalizeEvent(event, index) {
    if (!event || typeof event !== "object") return null;

    const latitude = toNumber(
      event.latitude ??
      event.lat ??
      event.location?.latitude ??
      event.location?.lat
    );

    const longitude = toNumber(
      event.longitude ??
      event.lng ??
      event.lon ??
      event.location?.longitude ??
      event.location?.lng ??
      event.location?.lon
    );

    if (!validCoordinate(latitude, longitude)) return null;

    const dateObject = parseDateValue(
      event.date ??
      event.datetime ??
      event.timestamp ??
      event.event_date ??
      event.occurred_at
    );

    if (!dateObject) return null;

    const attacker = normalizeActor(
      event.attacker ??
      event.actor ??
      event.originator ??
      event.source_country
    );

    if (!attacker) return null;

    const id = String(
      event.event_id ??
      event.id ??
      `strike-${index}-${dateObject.toISOString()}-${latitude}-${longitude}`
    );

    return {
      ...event,
      event_id: id,
      attacker,
      latitude,
      longitude,
      dateObject,
      date: dateObject.toISOString().slice(0, 10),
      target_location: firstText(
        event.target_location,
        event.location_name,
        event.target,
        typeof event.location === "string" ? event.location : "",
        event.city,
        "Unknown location"
      ),
      target_country: firstText(
        event.target_country,
        event.country,
        event.location?.country,
        "—"
      ),
      description: firstText(
        event.description,
        event.summary,
        event.event_description,
        event.details,
        "No description available."
      ),
      strike_type: firstText(
        event.strike_type,
        event.attack_type,
        event.type,
        event.weapon_type,
        "—"
      ),
      confidence: firstText(
        event.confidence,
        event.confidence_level,
        "MEDIUM"
      ),
      source_url: firstText(
        event.source_url,
        event.url,
        event.link,
        event.source?.url,
        ""
      ),
      coordinate_note: firstText(
        event.coordinate_note,
        event.location_note,
        event.geolocation_note,
        "—"
      )
    };
  }

  function selectedEvents() {
    if (!state.latestDate) return [];

    const end = endOfUtcDay(state.latestDate);
    const allTime = state.days === "ALL";
    const start = new Date(end);

    if (!allTime) {
      start.setUTCDate(start.getUTCDate() - (Number(state.days) - 1));
      start.setUTCHours(0, 0, 0, 0);
    }

    return state.events.filter(event => {
      const dateMatches =
        allTime ||
        (event.dateObject >= start && event.dateObject <= end);

      const actorMatches =
        state.actor === "ALL" ||
        event.attacker === state.actor;

      return dateMatches && actorMatches;
    });
  }

  function render() {
    updateStats();

    if (!state.map || !state.layerGroup) return;

    state.layerGroup.clearLayers();
    state.markerById.clear();
    clearAnnotations();

    if (!state.enabled) {
      if (state.map.hasLayer(state.layerGroup)) {
        state.map.removeLayer(state.layerGroup);
      }

      setStateBadge(
        state.error ? "Error" : state.dataLoaded ? "Loaded" : "Ready",
        state.error ? "error" : ""
      );
      return;
    }

    if (!state.map.hasLayer(state.layerGroup)) {
      state.layerGroup.addTo(state.map);
    }

    selectedEvents().forEach(event => {
      const marker = createMarker(event);
      marker.addTo(state.layerGroup);
      state.markerById.set(event.event_id, marker);
    });

    if (state.labelsEnabled) {
      renderAnnotations();
    }

    setStateBadge("Visible", "active");
  }

  function createMarker(event) {
    const actorClass = event.attacker.toLowerCase();
    const confidenceClass = normalizeConfidence(event.confidence);

    const icon = window.L.divIcon({
      className: "strike-history-marker-shell",
      html: `<div class="strike-history-marker ${actorClass} ${confidenceClass}"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });

    const marker = window.L.marker(
      [event.latitude, event.longitude],
      {
        icon,
        pane: CONFIG.paneName,
        keyboard: true,
        title: `${event.attacker}: ${event.target_location}`
      }
    );

    marker.bindTooltip(
      [
        `<strong>${escapeHtml(event.target_location)}</strong>`,
        `${escapeHtml(event.attacker)} · ${escapeHtml(event.date)}`,
        escapeHtml(event.strike_type)
      ].join("<br>"),
      {
        direction: "top",
        offset: [0, -8],
        opacity: 0.96
      }
    );

    marker.bindPopup(buildPopupHtml(event), {
      maxWidth: 330
    });

    marker.on("click", () => {
      if (!state.labelsEnabled) return;
      focusCard(event.event_id);
    });

    return marker;
  }

  function buildPopupHtml(event) {
    const source = safeUrl(event.source_url);

    return `
      <div class="strike-history-popup">
        <strong>${escapeHtml(event.target_location)}</strong><br>
        ${escapeHtml(event.attacker)} · ${escapeHtml(event.date)}<br>
        <b>Type:</b> ${escapeHtml(event.strike_type)}<br>
        <b>Country:</b> ${escapeHtml(event.target_country)}<br>
        <b>Description:</b> ${escapeHtml(event.description)}
        ${
          source
            ? `<br><a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`
            : ""
        }
      </div>
    `;
  }

  function renderAnnotations() {
    clearAnnotations();

    if (!state.enabled || !state.labelsEnabled || !state.map) return;

    ensureAnnotationRoot();

    const events = selectedEvents();
    const mapSize = state.map.getSize();

    events.forEach((event, index) => {
      const marker = state.markerById.get(event.event_id);
      if (!marker) return;

      const card = document.createElement("article");
      card.className = `strike-history-card ${event.attacker.toLowerCase()}`;
      card.dataset.eventId = event.event_id;
      card.innerHTML = cardHtml(event);

      const savedPosition = state.cardPositions.get(event.event_id);
      const initialPosition =
        savedPosition ||
        calculateInitialCardPosition(marker, index, mapSize);

      card.style.left = `${initialPosition.left}px`;
      card.style.top = `${initialPosition.top}px`;
      card.style.zIndex = String(720 + index);

      state.cardsRoot.appendChild(card);
      state.cardById.set(event.event_id, card);

      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line"
      );

      line.classList.add("strike-history-line");
      state.svg.appendChild(line);
      state.lineById.set(event.event_id, line);

      const toggle = card.querySelector(".strike-history-card-toggle");
      toggle?.addEventListener("click", eventObject => {
        eventObject.stopPropagation();
        const expanded = card.classList.toggle("expanded");
        toggle.textContent = expanded ? "−" : "+";
        toggle.setAttribute("aria-expanded", String(expanded));
        updateGeometry(event.event_id);
      });

      card.addEventListener("pointerdown", () => {
        bringCardToFront(card);
      });

      enableDragging(card, event.event_id);
      updateGeometry(event.event_id);
    });
  }

  function calculateInitialCardPosition(marker, index, mapSize) {
    const point = state.map.latLngToContainerPoint(marker.getLatLng());
    const cardWidth = 260;
    const cardHeight = 126;

    const horizontalDirection = index % 2 === 0 ? 1 : -1;
    const column = index % 3;
    const row = Math.floor(index / 3) % 6;

    const left = clamp(
      point.x + horizontalDirection * (28 + column * 18) -
        (horizontalDirection < 0 ? cardWidth : 0),
      8,
      Math.max(8, mapSize.x - cardWidth - 8)
    );

    const top = clamp(
      point.y - 36 + row * 24,
      8,
      Math.max(8, mapSize.y - cardHeight - 8)
    );

    return { left, top };
  }

  function cardHtml(event) {
    const source = safeUrl(event.source_url);
    const confidence =
      firstText(event.confidence_label_hu, event.confidence, "—");

    return `
      <div class="strike-history-card-head">
        <div style="min-width:0;">
          <div class="strike-history-card-title">${escapeHtml(event.target_location)}</div>
          <div class="strike-history-card-meta">${escapeHtml(event.attacker)} · ${escapeHtml(event.date)}</div>
        </div>
        <button
          class="strike-history-card-toggle"
          type="button"
          aria-label="Show details"
          aria-expanded="false"
        >+</button>
      </div>
      <div class="strike-history-card-summary">${escapeHtml(shortText(event.description, 150))}</div>
      <div class="strike-history-card-details">
        <div class="detail-row"><span class="detail-label">Event:</span> ${escapeHtml(event.description)}</div>
        <div class="detail-row"><span class="detail-label">Strike type:</span> ${escapeHtml(event.strike_type)}</div>
        <div class="detail-row"><span class="detail-label">Target country:</span> ${escapeHtml(event.target_country)}</div>
        <div class="detail-row"><span class="detail-label">Confidence:</span> ${escapeHtml(confidence)}</div>
        <div class="detail-row"><span class="detail-label">Coordinates:</span> ${escapeHtml(String(event.latitude))}, ${escapeHtml(String(event.longitude))}</div>
        <div class="detail-row"><span class="detail-label">Location note:</span> ${escapeHtml(event.coordinate_note)}</div>
        ${
          source
            ? `<div class="detail-row"><a href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></div>`
            : ""
        }
      </div>
    `;
  }

  function enableDragging(card, eventId) {
    const handle = card.querySelector(".strike-history-card-head");
    if (!handle) return;

    let active = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener("pointerdown", event => {
      if (event.target.closest("button, a")) return;

      active = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = parseFloat(card.style.left) || 0;
      startTop = parseFloat(card.style.top) || 0;

      card.classList.add("dragging");
      bringCardToFront(card);

      try {
        handle.setPointerCapture(pointerId);
      } catch (_) {
        // Pointer capture is optional.
      }

      state.map?.dragging?.disable();
      event.preventDefault();
    });

    handle.addEventListener("pointermove", event => {
      if (!active || event.pointerId !== pointerId || !state.map) return;

      const mapSize = state.map.getSize();

      const left = clamp(
        startLeft + event.clientX - startX,
        4,
        Math.max(4, mapSize.x - card.offsetWidth - 4)
      );

      const top = clamp(
        startTop + event.clientY - startY,
        4,
        Math.max(4, mapSize.y - card.offsetHeight - 4)
      );

      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      state.cardPositions.set(eventId, { left, top });
      updateGeometry(eventId);
    });

    const finish = event => {
      if (!active || event.pointerId !== pointerId) return;

      active = false;
      card.classList.remove("dragging");

      try {
        handle.releasePointerCapture(pointerId);
      } catch (_) {
        // Pointer capture may already be released.
      }

      pointerId = null;
      state.map?.dragging?.enable();
      updateGeometry(eventId);
    };

    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  }

  function updateAllGeometry() {
    if (!state.labelsEnabled) return;

    state.cardById.forEach((card, eventId) => {
      keepCardInsideMap(card, eventId);
      updateGeometry(eventId);
    });
  }

  function keepCardInsideMap(card, eventId) {
    if (!state.map || !card) return;

    const mapSize = state.map.getSize();

    const left = clamp(
      parseFloat(card.style.left) || 0,
      4,
      Math.max(4, mapSize.x - card.offsetWidth - 4)
    );

    const top = clamp(
      parseFloat(card.style.top) || 0,
      4,
      Math.max(4, mapSize.y - card.offsetHeight - 4)
    );

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    state.cardPositions.set(eventId, { left, top });
  }

  function updateGeometry(eventId) {
    const marker = state.markerById.get(eventId);
    const card = state.cardById.get(eventId);
    const line = state.lineById.get(eventId);

    if (!marker || !card || !line || !state.map) return;

    const markerPoint =
      state.map.latLngToContainerPoint(marker.getLatLng());

    const left = parseFloat(card.style.left) || 0;
    const top = parseFloat(card.style.top) || 0;
    const right = left + card.offsetWidth;
    const bottom = top + card.offsetHeight;

    const cardX = clamp(markerPoint.x, left, right);
    const cardY = clamp(markerPoint.y, top, bottom);

    line.setAttribute("x1", String(markerPoint.x));
    line.setAttribute("y1", String(markerPoint.y));
    line.setAttribute("x2", String(cardX));
    line.setAttribute("y2", String(cardY));
  }

  function clearAnnotations() {
    if (state.cardsRoot) state.cardsRoot.replaceChildren();
    if (state.svg) state.svg.replaceChildren();
    state.cardById.clear();
    state.lineById.clear();
  }

  function bindControls() {
    const layerCheckbox =
      document.getElementById("strikeHistoryLayerCheckbox");

    const labelsCheckbox =
      document.getElementById("strikeHistoryLabelsCheckbox");

    const fitButton =
      document.getElementById("strikeHistoryFitButton");

    const resetCardsButton =
      document.getElementById("strikeHistoryResetCardsButton");

    if (!layerCheckbox) {
      console.warn("[StrikeHistory] Control block not found.");
      return;
    }

    state.enabled = layerCheckbox.checked;
    state.labelsEnabled = Boolean(labelsCheckbox?.checked);

    layerCheckbox.addEventListener("change", () => {
      state.enabled = layerCheckbox.checked;

      if (!state.enabled) {
        state.labelsEnabled = false;
        if (labelsCheckbox) labelsCheckbox.checked = false;
      }

      render();
    });

    labelsCheckbox?.addEventListener("change", () => {
      state.labelsEnabled = labelsCheckbox.checked;

      if (state.labelsEnabled && !state.enabled) {
        state.enabled = true;
        layerCheckbox.checked = true;
      }

      render();
    });

    document
      .querySelectorAll("#strikeHistoryWindowButtons button")
      .forEach(button => {
        button.addEventListener("click", () => {
          state.days =
            button.dataset.days === "ALL"
              ? "ALL"
              : Number(button.dataset.days);

          setActiveButton(
            "#strikeHistoryWindowButtons button",
            button
          );

          state.cardPositions.clear();
          render();
        });
      });

    document
      .querySelectorAll("#strikeHistoryActorButtons button")
      .forEach(button => {
        button.addEventListener("click", () => {
          state.actor =
            normalizeActor(button.dataset.actor) || "ALL";

          setActiveButton(
            "#strikeHistoryActorButtons button",
            button
          );

          state.cardPositions.clear();
          render();
        });
      });

    fitButton?.addEventListener("click", fitVisibleEvents);

    resetCardsButton?.addEventListener("click", () => {
      state.cardPositions.clear();
      if (state.labelsEnabled) renderAnnotations();
    });
  }

  function fitVisibleEvents() {
    if (!state.map) return;

    const events = selectedEvents();

    if (!events.length) {
      setNote("No visible events match the selected filters.");
      return;
    }

    const bounds = window.L.latLngBounds(
      events.map(event => [event.latitude, event.longitude])
    );

    if (bounds.isValid()) {
      state.map.fitBounds(bounds.pad(0.18), {
        maxZoom: 8
      });
    }
  }

  function updateStats() {
    const events = selectedEvents();

    setText("strikeHistoryTotal", events.length);
    setText(
      "strikeHistoryUsa",
      events.filter(event => event.attacker === "USA").length
    );
    setText(
      "strikeHistoryIran",
      events.filter(event => event.attacker === "IRAN").length
    );
  }

  function setActiveButton(selector, activeButton) {
    document.querySelectorAll(selector).forEach(button => {
      const active = button === activeButton;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function focusCard(id) {
    const card = state.cardById.get(id);
    if (!card) return;

    bringCardToFront(card);

    if (typeof card.animate === "function") {
      card.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1.035)" },
          { transform: "scale(1)" }
        ],
        { duration: 320 }
      );
    }
  }

  function bringCardToFront(card) {
    const highest = Math.max(
      720,
      ...Array.from(state.cardById.values()).map(
        item => Number(item.style.zIndex) || 720
      )
    );

    card.style.zIndex = String(highest + 1);
  }

  function normalizeActor(value) {
    const text = String(value || "").trim().toUpperCase();

    if (!text) return "";
    if (text === "ALL") return "ALL";

    if (
      text.includes("USA") ||
      text.includes("UNITED STATES") ||
      text.includes("U.S.")
    ) {
      return "USA";
    }

    if (
      text.includes("IRAN") ||
      text.includes("IRANIAN")
    ) {
      return "IRAN";
    }

    return "";
  }

  function normalizeConfidence(value) {
    const text = String(value || "").trim().toLowerCase();

    if (text.includes("high")) return "high";
    if (text.includes("low")) return "low";
    return "medium";
  }

  function parseDateValue(value) {
    if (!value) return null;

    const text = String(value).trim();
    const normalized =
      /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? `${text}T12:00:00Z`
        : text;

    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function endOfUtcDay(value) {
    const date = new Date(value);
    date.setUTCHours(23, 59, 59, 999);
    return date;
  }

  function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat(
      "en-GB",
      {
        year: "numeric",
        month: "short",
        day: "2-digit",
        timeZone: "UTC"
      }
    ).format(date);
  }

  function firstText(...values) {
    for (const value of values) {
      const text = String(value ?? "").trim();
      if (text) return text;
    }
    return "";
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function validCoordinate(latitude, longitude) {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      !(Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001)
    );
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value);
  }

  function setNote(text) {
    const element = document.getElementById("strikeHistoryNote");
    if (element) element.textContent = text;
  }

  function setStateBadge(text, className) {
    const element = document.getElementById("strikeHistoryState");
    if (!element) return;

    element.textContent = text;
    element.classList.remove("active", "error");

    if (className) {
      element.classList.add(className);
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function shortText(value, maxLength) {
    const text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();

    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength - 1).trim()}…`;
  }

  function safeUrl(value) {
    try {
      const url = new URL(String(value || ""), window.location.href);
      return ["http:", "https:"].includes(url.protocol)
        ? url.href
        : "";
    } catch (_) {
      return "";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]
    );
  }

  window.MEStrikeHistory = Object.freeze({
    refresh: loadData,
    fitVisibleEvents,
    getState() {
      return {
        enabled: state.enabled,
        labelsEnabled: state.labelsEnabled,
        days: state.days,
        actor: state.actor,
        totalEvents: state.events.length,
        visibleEvents: selectedEvents().length,
        latestDate:
          state.latestDate?.toISOString?.() || null,
        dataLoaded: state.dataLoaded,
        error: state.error
      };
    }
  });
})();
