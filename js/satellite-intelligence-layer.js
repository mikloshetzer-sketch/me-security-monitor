(function () {
  "use strict";

  const MODULE_NAME = "ME Satellite Intelligence";
  const MODULE_VERSION = "1.0.0";
  const DEFAULT_OPACITY = 0.72;
  const DEFAULT_ARCHIVE_URLS = [
    "./data/satellite/archive-index.json",
    "./docs/data/satellite/archive-index.json",
    "./data/satellite/satellite_archive.json",
    "./docs/data/satellite/satellite_archive.json"
  ];

  const BASEMAP_DEFINITIONS = {
    osm: {
      label: "OpenStreetMap",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      options: {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    },
    carto: {
      label: "CARTO Light",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      options: {
        subdomains: "abcd",
        maxZoom: 20,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
      }
    },
    esri: {
      label: "Esri World Imagery",
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      options: {
        maxZoom: 20,
        attribution: "Tiles &copy; Esri"
      }
    }
  };

  function injectStyles() {
    if (document.getElementById("me-satellite-intelligence-styles")) return;

    const style = document.createElement("style");
    style.id = "me-satellite-intelligence-styles";
    style.textContent = `
      .me-satellite-overlay {
        image-rendering: auto;
      }
      .me-satellite-loading {
        opacity: .75;
      }
      .me-satellite-status-error {
        color: #b42318 !important;
      }
      .me-satellite-status-ok {
        color: #175cd3 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function asArray(value) {
    return Array.isArray(value) ? value : value == null ? [] : [value];
  }

  function firstDefined() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return null;
  }

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeBounds(record) {
    const bbox = firstDefined(
      record?.target_area?.bbox,
      record?.bbox,
      record?.bounds,
      record?.image_bounds,
      record?.overlay_bounds
    );

    if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((value) => Number.isFinite(Number(value)))) {
      const [west, south, east, north] = bbox.map(Number);
      return [[south, west], [north, east]];
    }

    if (
      Array.isArray(bbox) &&
      bbox.length === 2 &&
      Array.isArray(bbox[0]) &&
      Array.isArray(bbox[1])
    ) {
      const first = bbox[0].map(Number);
      const second = bbox[1].map(Number);
      if (first.length === 2 && second.length === 2 && [...first, ...second].every(Number.isFinite)) {
        return [first, second];
      }
    }

    const lat = toNumber(firstDefined(record?.target_area?.lat, record?.lat, record?.latitude));
    const lon = toNumber(firstDefined(record?.target_area?.lon, record?.lon, record?.lng, record?.longitude));
    const radiusKm = toNumber(firstDefined(record?.target_area?.radius_km, record?.radius_km, record?.radius));

    if (lat !== null && lon !== null && radiusKm !== null && radiusKm > 0) {
      const latDelta = radiusKm / 111.32;
      const lonDelta = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.15));
      return [
        [lat - latDelta, lon - lonDelta],
        [lat + latDelta, lon + lonDelta]
      ];
    }

    return null;
  }

  function normalizeRecord(record, index) {
    if (!record || typeof record !== "object") return null;

    const imageUrl = firstDefined(
      record.image_url,
      record.url,
      record.overlay_url,
      record.file_url,
      record.imagery?.image_url,
      record.imagery?.url,
      record.assets?.true_color,
      record.assets?.visual,
      record.assets?.image
    );

    const locationName = String(firstDefined(
      record.location_name,
      record.location,
      record.site_name,
      record.name,
      record.target_area?.name,
      `Satellite image ${index + 1}`
    ));

    const slug = String(firstDefined(
      record.location_slug,
      record.slug,
      record.site_slug,
      locationName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
    ));

    const timestamp = String(firstDefined(
      record.timestamp,
      record.generated_at,
      record.date,
      record.acquired_at,
      record.imagery?.acquisition_date,
      record.imagery?.requested_time_range?.to,
      ""
    ));

    return {
      ...record,
      id: String(firstDefined(record.id, record.record_id, record.image_id, `${slug}-${timestamp || index}`)),
      location_name: locationName,
      location_slug: slug,
      timestamp,
      image_url: imageUrl ? String(imageUrl) : "",
      normalized_bounds: normalizeBounds(record)
    };
  }

  function normalizeArchive(payload) {
    let records = [];

    if (Array.isArray(payload)) {
      records = payload;
    } else if (payload && typeof payload === "object") {
      records = firstDefined(
        payload.records,
        payload.images,
        payload.items,
        payload.archive,
        payload.satellite_images,
        payload.data
      ) || [];
    }

    return asArray(records)
      .map(normalizeRecord)
      .filter((record) => record && record.image_url && record.normalized_bounds);
  }

  async function fetchFirstAvailable(urls) {
    const errors = [];

    for (const url of urls) {
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        return { payload, url };
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }

    throw new Error(`Satellite archive could not be loaded. ${errors.join(" | ")}`);
  }

  function formatDate(value) {
    if (!value) return "n/a";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("hu-HU");
  }

  function formatRecordLabel(record) {
    const date = record.timestamp ? formatDate(record.timestamp) : "dátum nélkül";
    const cloud = firstDefined(record.cloud_cover, record.imagery?.cloud_cover, record.cloud_percent);
    return cloud !== null
      ? `${date} · felhőzet ${cloud}%`
      : date;
  }

  function createTileLayer(key) {
    const definition = BASEMAP_DEFINITIONS[key] || BASEMAP_DEFINITIONS.osm;
    return L.tileLayer(definition.url, { ...definition.options });
  }

  function resolveDom(dom = {}) {
    const byId = (id) => document.getElementById(id);
    return {
      toggle: dom.toggle || byId("satelliteIntelligenceToggle"),
      baseMapSelect: dom.baseMapSelect || byId("satelliteBaseMapSelect"),
      sourceSelect: dom.sourceSelect || byId("satelliteSourceSelect"),
      locationSelect: dom.locationSelect || byId("satelliteLocationSelect"),
      imageSelect: dom.imageSelect || byId("satelliteImageSelect"),
      opacityInput: dom.opacityInput || byId("satelliteOpacity"),
      opacityValue: dom.opacityValue || byId("satelliteOpacityValue"),
      fitButton: dom.fitButton || byId("satelliteFitBtn"),
      refreshButton: dom.refreshButton || byId("satelliteRefreshBtn"),
      summary: dom.summary || byId("satelliteSummary")
    };
  }

  function init(options = {}) {
    injectStyles();

    if (!window.L) throw new Error("Leaflet is required for Satellite Intelligence.");
    if (!options.map) throw new Error("A Leaflet map instance is required.");

    const map = options.map;
    const dom = resolveDom(options.dom || {});
    const archiveUrls = asArray(options.archiveUrls?.length ? options.archiveUrls : DEFAULT_ARCHIVE_URLS);
    const zIndex = Number.isFinite(Number(options.zIndex)) ? Number(options.zIndex) : 180;

    const state = {
      enabled: false,
      mode: dom.sourceSelect?.value || "sentinel2",
      baseMap: dom.baseMapSelect?.value || "osm",
      opacity: Math.min(1, Math.max(0, Number(dom.opacityInput?.value || 72) / 100)),
      archiveUrl: null,
      records: [],
      selectedLocationSlug: null,
      selectedRecordId: null,
      currentRecord: null,
      baseLayer: null,
      overlay: null,
      ready: false,
      loading: false,
      lastError: null
    };

    function setSummary(html, kind = "ok") {
      if (!dom.summary) return;
      dom.summary.innerHTML = html;
      dom.summary.classList.toggle("me-satellite-status-error", kind === "error");
      dom.summary.classList.toggle("me-satellite-status-ok", kind === "ok");
    }

    function notify(message) {
      if (typeof options.onStatus === "function") options.onStatus(message, { ...state });
    }

    function setBaseMap(key) {
      const normalizedKey = BASEMAP_DEFINITIONS[key] ? key : "osm";

      if (state.baseLayer && map.hasLayer(state.baseLayer)) {
        map.removeLayer(state.baseLayer);
      }

      state.baseLayer = createTileLayer(normalizedKey);
      state.baseMap = normalizedKey;
      state.baseLayer.addTo(map);

      if (typeof state.baseLayer.bringToBack === "function") state.baseLayer.bringToBack();
      if (dom.baseMapSelect && dom.baseMapSelect.value !== normalizedKey) {
        dom.baseMapSelect.value = normalizedKey;
      }

      applyMode();
      notify(`Háttértérkép: ${BASEMAP_DEFINITIONS[normalizedKey].label}`);
      return state.baseLayer;
    }

    function removeOverlay() {
      if (state.overlay && map.hasLayer(state.overlay)) map.removeLayer(state.overlay);
      state.overlay = null;
    }

    function getLocations() {
      const grouped = new Map();
      state.records.forEach((record) => {
        const current = grouped.get(record.location_slug) || {
          slug: record.location_slug,
          name: record.location_name,
          count: 0
        };
        current.count += 1;
        grouped.set(record.location_slug, current);
      });
      return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "hu"));
    }

    function getRecordsForSelectedLocation() {
      if (!state.selectedLocationSlug) return [...state.records];
      return state.records.filter((record) => record.location_slug === state.selectedLocationSlug);
    }

    function getSelectedRecord() {
      return state.records.find((record) => record.id === state.selectedRecordId)
        || getRecordsForSelectedLocation()[0]
        || state.records[0]
        || null;
    }

    function updateLocationSelect() {
      if (!dom.locationSelect) return;
      dom.locationSelect.replaceChildren();
      const locations = getLocations();

      if (!locations.length) {
        dom.locationSelect.add(new Option("Nincs elérhető helyszín", "", true, true));
        state.selectedLocationSlug = null;
        return;
      }

      locations.forEach((location, index) => {
        dom.locationSelect.add(new Option(`${location.name} (${location.count})`, location.slug, index === 0, index === 0));
      });
      state.selectedLocationSlug = locations[0].slug;
    }

    function updateImageSelect() {
      if (!dom.imageSelect) return;
      dom.imageSelect.replaceChildren();
      const records = getRecordsForSelectedLocation();

      if (!records.length) {
        dom.imageSelect.add(new Option("Nincs elérhető kép", "", true, true));
        state.selectedRecordId = null;
        return;
      }

      records.forEach((record, index) => {
        dom.imageSelect.add(new Option(formatRecordLabel(record), record.id, index === 0, index === 0));
      });
      state.selectedRecordId = records[0].id;
    }

    function buildSummary(record) {
      if (state.mode === "off") {
        return "<strong>Csak háttértérkép mód.</strong><br>A Sentinel-2 overlay ki van kapcsolva.";
      }
      if (!record) return "Nincs kiválasztott műholdkép.";

      const bounds = record.normalized_bounds;
      const modeLabel = state.mode === "hybrid"
        ? "Hybrid: Esri + Sentinel-2"
        : "Sentinel-2 archívum";

      return [
        `<strong>${record.location_name}</strong>`,
        `Mód: ${modeLabel}`,
        `Dátum: ${formatDate(record.timestamp)}`,
        bounds ? `Terület: ${bounds.flat().map((value) => Number(value).toFixed(4)).join(", ")}` : "",
        `Forrás: ${firstDefined(record.source, record.provider, "Sentinel-2 / Copernicus")}`
      ].filter(Boolean).join("<br>");
    }

    function showRecord(record, { fitBounds = false } = {}) {
      removeOverlay();
      state.currentRecord = record || null;

      if (!record || !state.enabled || state.mode === "off") {
        setSummary(buildSummary(record));
        return null;
      }

      state.overlay = L.imageOverlay(record.image_url, record.normalized_bounds, {
        opacity: state.opacity,
        interactive: false,
        className: "me-satellite-overlay",
        zIndex
      });
      state.overlay.addTo(map);

      if (state.mode === "hybrid" && state.baseMap !== "esri") {
        setBaseMap("esri");
      }

      if (fitBounds) map.fitBounds(record.normalized_bounds, { padding: [18, 18] });
      setSummary(buildSummary(record));
      return state.overlay;
    }

    function applySelectedRecord(options = {}) {
      const record = getSelectedRecord();
      state.currentRecord = record;
      return showRecord(record, options);
    }

    function applyMode() {
      state.mode = dom.sourceSelect?.value || state.mode || "sentinel2";

      if (state.mode === "hybrid" && state.baseMap !== "esri") {
        setBaseMap("esri");
        return;
      }

      if (state.mode === "off") {
        removeOverlay();
        setSummary(buildSummary(state.currentRecord));
        return;
      }

      if (state.enabled) applySelectedRecord({ fitBounds: false });
      else setSummary(buildSummary(state.currentRecord));
    }

    async function loadArchive() {
      state.loading = true;
      state.lastError = null;
      dom.refreshButton?.classList.add("me-satellite-loading");
      setSummary("Műholdas archívum betöltése…");

      try {
        const { payload, url } = await fetchFirstAvailable(archiveUrls);
        state.records = normalizeArchive(payload).sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        state.archiveUrl = url;
        state.ready = true;

        updateLocationSelect();
        updateImageSelect();
        state.currentRecord = getSelectedRecord();
        applySelectedRecord({ fitBounds: false });

        setSummary(buildSummary(state.currentRecord));
        notify(`Műholdas archívum betöltve: ${state.records.length} kép`);
        return [...state.records];
      } catch (error) {
        state.ready = false;
        state.lastError = error;
        state.records = [];
        updateLocationSelect();
        updateImageSelect();
        removeOverlay();
        setSummary(`Műholdas archívum nem érhető el.<br><small>${error.message}</small>`, "error");
        notify("Műholdas archívum betöltési hiba");
        return [];
      } finally {
        state.loading = false;
        dom.refreshButton?.classList.remove("me-satellite-loading");
      }
    }

    function setEnabled(enabled) {
      state.enabled = Boolean(enabled);
      if (dom.toggle) dom.toggle.checked = state.enabled;

      if (state.enabled && state.mode !== "off") {
        applySelectedRecord({ fitBounds: false });
      } else {
        removeOverlay();
      }

      notify(state.enabled ? "Műholdas réteg bekapcsolva" : "Műholdas réteg kikapcsolva");
      return state.enabled;
    }

    function setOpacity(value) {
      state.opacity = Math.min(1, Math.max(0, Number(value)));
      if (state.overlay?.setOpacity) state.overlay.setOpacity(state.opacity);
      if (dom.opacityInput) dom.opacityInput.value = String(Math.round(state.opacity * 100));
      if (dom.opacityValue) dom.opacityValue.textContent = `${Math.round(state.opacity * 100)}%`;
      return state.opacity;
    }

    function fitToCurrent() {
      const record = getSelectedRecord();
      if (!record || state.mode === "off") return false;
      map.fitBounds(record.normalized_bounds, { padding: [18, 18] });
      return true;
    }

    dom.toggle?.addEventListener("change", () => setEnabled(dom.toggle.checked));
    dom.baseMapSelect?.addEventListener("change", () => setBaseMap(dom.baseMapSelect.value));
    dom.sourceSelect?.addEventListener("change", () => applyMode());
    dom.locationSelect?.addEventListener("change", () => {
      state.selectedLocationSlug = dom.locationSelect.value || null;
      state.selectedRecordId = null;
      updateImageSelect();
      applySelectedRecord({ fitBounds: true });
    });
    dom.imageSelect?.addEventListener("change", () => {
      state.selectedRecordId = dom.imageSelect.value || null;
      applySelectedRecord({ fitBounds: true });
    });
    dom.opacityInput?.addEventListener("input", () => setOpacity(Number(dom.opacityInput.value) / 100));
    dom.fitButton?.addEventListener("click", fitToCurrent);
    dom.refreshButton?.addEventListener("click", loadArchive);

    setBaseMap(state.baseMap);
    setOpacity(state.opacity || DEFAULT_OPACITY);
    loadArchive();

    const api = {
      name: MODULE_NAME,
      version: MODULE_VERSION,
      state,
      loadArchive,
      setEnabled,
      setBaseMap,
      setOpacity,
      fitToCurrent,
      applyMode,
      applySelectedRecord,
      getSelectedRecord,
      getRecords: () => [...state.records],
      getLocations,
      destroy() {
        removeOverlay();
        if (state.baseLayer && map.hasLayer(state.baseLayer)) map.removeLayer(state.baseLayer);
        state.baseLayer = null;
        state.ready = false;
      }
    };

    return api;
  }

  window.MESatelliteIntelligence = {
    init,
    version: MODULE_VERSION,
    baseMaps: { ...BASEMAP_DEFINITIONS },
    normalizeArchive,
    formatRecordLabel
  };
})();
