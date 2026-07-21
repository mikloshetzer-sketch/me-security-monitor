// js/strike-history-layer.js
// Isolated Strike History Leaflet layer for data/strike_history.json.
// The module never creates or discovers a map and never changes Leaflet globals.

const DEFAULT_OPTIONS = Object.freeze({
  dataUrl: "data/strike_history.json",
  enabled: false,
  defaultDays: 7,
  defaultActor: "ALL",
  maxVisible: 1000,
  paneName: "strikeHistoryPane",
  paneZIndex: 675
});

export function createStrikeHistoryLayer(map, options = {}) {
  if (!map || typeof map.addLayer !== "function") {
    throw new Error("createStrikeHistoryLayer requires an existing Leaflet map.");
  }

  const config = { ...DEFAULT_OPTIONS, ...options };
  const markerLayer = L.layerGroup();

  const state = {
    enabled: Boolean(config.enabled),
    loaded: false,
    loading: false,
    error: "",
    generatedAt: "",
    latestDate: null,
    allEvents: [],
    visibleEvents: [],
    filters: {
      days: normalizeDays(config.defaultDays),
      actor: normalizeActorFilter(config.defaultActor),
      search: ""
    }
  };

  ensurePane();

  function ensurePane() {
    if (!map.getPane(config.paneName)) {
      const pane = map.createPane(config.paneName);
      pane.style.zIndex = String(config.paneZIndex);
      pane.style.pointerEvents = "auto";
    }
  }

  async function refresh() {
    state.loading = true;
    state.error = "";

    try {
      const separator = config.dataUrl.includes("?") ? "&" : "?";
      const response = await fetch(`${config.dataUrl}${separator}v=${Date.now()}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const rawEvents = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.events)
          ? payload.events
          : [];

      state.allEvents = rawEvents
        .map(normalizeEvent)
        .filter(Boolean)
        .sort((a, b) => a.dateObject - b.dateObject);

      state.generatedAt = String(payload?.generated_at || "");
      state.latestDate = parseDate(payload?.summary?.date_end)
        || state.allEvents.at(-1)?.dateObject
        || null;
      state.loaded = true;
      applyFiltersAndRender();
      return getState();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.loaded = false;
      clearMarkers();
      throw error;
    } finally {
      state.loading = false;
    }
  }

  function setEnabled(value) {
    state.enabled = Boolean(value);

    if (state.enabled) {
      if (!map.hasLayer(markerLayer)) markerLayer.addTo(map);
      applyFiltersAndRender();
    } else if (map.hasLayer(markerLayer)) {
      map.removeLayer(markerLayer);
    }
  }

  function setFilters(next = {}) {
    state.filters = {
      days: next.days === undefined
        ? state.filters.days
        : normalizeDays(next.days),
      actor: next.actor === undefined
        ? state.filters.actor
        : normalizeActorFilter(next.actor),
      search: next.search === undefined
        ? state.filters.search
        : String(next.search || "").trim().toLowerCase()
    };

    applyFiltersAndRender();
  }

  function applyFiltersAndRender() {
    state.visibleEvents = filterEvents().slice(-Number(config.maxVisible));
    renderMarkers();
  }

  function filterEvents() {
    const { days, actor, search } = state.filters;
    let cutoff = null;

    if (days > 0 && state.latestDate) {
      cutoff = new Date(state.latestDate);
      cutoff.setUTCHours(0, 0, 0, 0);
      cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
    }

    return state.allEvents.filter((event) => {
      if (cutoff && event.dateObject < cutoff) return false;
      if (actor !== "ALL" && event.attacker !== actor) return false;

      if (search) {
        const haystack = [
          event.target_location,
          event.target_country,
          event.description,
          event.strike_type,
          event.attacker,
          event.confidence
        ].join(" ").toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }

  function renderMarkers() {
    clearMarkers();
    if (!state.enabled || !map.hasLayer(markerLayer)) return;

    state.visibleEvents.forEach((event) => {
      createMarker(event).addTo(markerLayer);
    });
  }

  function clearMarkers() {
    markerLayer.clearLayers();
  }

  function createMarker(event) {
    const isUsa = event.attacker === "USA";
    const fill = isUsa ? "#16a34a" : "#2563eb";
    const ring = isUsa ? "#14532d" : "#1e3a8a";
    const opacity = event.confidence === "LOW" ? 0.72 : 1;

    const icon = L.divIcon({
      className: "strike-history-marker-shell",
      html: `<span aria-hidden="true" style="display:block;width:16px;height:16px;border-radius:999px;background:${fill};border:2px solid #fff;box-shadow:0 0 0 2px ${ring},0 4px 12px rgba(15,23,42,.32);opacity:${opacity};"></span>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -12]
    });

    const marker = L.marker([event.latitude, event.longitude], {
      icon,
      pane: config.paneName,
      keyboard: true,
      title: `${event.attacker}: ${event.target_location}`
    });

    marker.bindTooltip(
      `<strong>${escapeHtml(event.target_location)}</strong><br>${escapeHtml(event.attacker)} · ${escapeHtml(event.date)}<br>${escapeHtml(event.strike_type)}`,
      { direction: "top", offset: [0, -9], opacity: 0.96 }
    );

    marker.bindPopup(buildPopup(event), { maxWidth: 360 });
    return marker;
  }

  function buildPopup(event) {
    const sourceUrl = safeUrl(event.source_url);
    const sourceLink = sourceUrl
      ? `<div style="margin-top:8px;"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></div>`
      : "";

    return `
      <div class="strike-history-popup" style="line-height:1.45;min-width:230px;">
        <div style="font-weight:800;font-size:14px;margin-bottom:5px;">${escapeHtml(event.target_location)}</div>
        <div><b>Attacker:</b> ${escapeHtml(event.attacker)}</div>
        <div><b>Date:</b> ${escapeHtml(event.date)}</div>
        <div><b>Country:</b> ${escapeHtml(event.target_country)}</div>
        <div><b>Type:</b> ${escapeHtml(event.strike_type)}</div>
        <div><b>Confidence:</b> ${escapeHtml(event.confidence_label_hu || event.confidence)}</div>
        <div style="margin-top:7px;">${escapeHtml(event.description)}</div>
        ${event.coordinate_note ? `<div style="margin-top:7px;font-size:11px;color:#64748b;">${escapeHtml(event.coordinate_note)}</div>` : ""}
        ${sourceLink}
      </div>
    `;
  }

  function fitBounds() {
    if (!state.visibleEvents.length) return false;
    const bounds = L.latLngBounds(
      state.visibleEvents.map((event) => [event.latitude, event.longitude])
    );
    map.fitBounds(bounds.pad(0.14), { maxZoom: 8 });
    return true;
  }

  function getVisibleEvents() {
    return state.visibleEvents.map((event) => ({ ...event }));
  }

  function getState() {
    return {
      enabled: state.enabled,
      loaded: state.loaded,
      loading: state.loading,
      error: state.error,
      generatedAt: state.generatedAt,
      latestDate: state.latestDate ? state.latestDate.toISOString().slice(0, 10) : "",
      loadedCount: state.allEvents.length,
      visibleCount: state.visibleEvents.length,
      filters: { ...state.filters }
    };
  }

  function destroy() {
    clearMarkers();
    if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
    state.allEvents = [];
    state.visibleEvents = [];
  }

  if (state.enabled) markerLayer.addTo(map);

  return {
    refresh,
    setEnabled,
    setFilters,
    fitBounds,
    getVisibleEvents,
    getState,
    destroy,
    layer: markerLayer
  };
}

function normalizeEvent(event, index) {
  if (!event || typeof event !== "object") return null;

  const latitude = Number(event.latitude ?? event.lat);
  const longitude = Number(event.longitude ?? event.lng ?? event.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const dateObject = parseDate(event.date ?? event.timestamp ?? event.datetime);
  if (!dateObject) return null;

  const attacker = normalizeActor(event.attacker ?? event.actor);
  if (!attacker) return null;

  return {
    ...event,
    event_id: String(event.event_id || event.id || `strike-history-${index}`),
    id: String(event.event_id || event.id || `strike-history-${index}`),
    source: "strikehistory",
    source_name: "Strike History",
    attacker,
    actor: attacker === "USA" ? "United States" : "Iran",
    latitude,
    longitude,
    lat: latitude,
    lng: longitude,
    dateObject,
    date: dateObject.toISOString().slice(0, 10),
    target_location: firstText(event.target_location, event.location, "Unknown location"),
    location: firstText(event.target_location, event.location, "Unknown location"),
    target_country: firstText(event.target_country, event.country, "—"),
    country: firstText(event.target_country, event.country, "—"),
    title: `${attacker} strike – ${firstText(event.target_location, event.location, "Unknown location")}`,
    summary: firstText(event.description, event.summary, "No description available."),
    description: firstText(event.description, event.summary, "No description available."),
    strike_type: firstText(event.strike_type, event.attack_type, event.type, "—"),
    category: "military",
    confidence: String(event.confidence || "MEDIUM").toUpperCase(),
    confidence_label_hu: firstText(event.confidence_label_hu, event.confidence, "—"),
    coordinate_note: firstText(event.coordinate_note, ""),
    source_url: firstText(event.source_url, event.url, ""),
    url: firstText(event.source_url, event.url, ""),
    map_visualizable: true
  };
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00Z`)
    : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeActor(value) {
  const text = String(value || "").trim().toUpperCase();
  if (["USA", "US", "U.S.", "UNITED STATES"].includes(text)) return "USA";
  if (["IRAN", "IR", "IRN", "IRÁN"].includes(text)) return "IRAN";
  return "";
}

function normalizeActorFilter(value) {
  const actor = normalizeActor(value);
  return actor || "ALL";
}

function normalizeDays(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function firstText(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

