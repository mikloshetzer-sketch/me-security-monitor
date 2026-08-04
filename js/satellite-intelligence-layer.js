(function () {
  "use strict";

  const MODULE_NAME = "ME Satellite Intelligence";
  const MODULE_VERSION = "1.1.1";
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

      .me-satellite-location-controls {
        margin-top: 12px;
        padding: 10px;
        border: 1px solid rgba(30, 64, 175, .16);
        border-radius: 12px;
        background: rgba(248, 250, 252, .82);
      }

      .me-satellite-location-controls__title {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 800;
        color: #16324f;
      }

      .me-satellite-location-controls__list {
        display: grid;
        gap: 6px;
        max-height: 190px;
        overflow-y: auto;
        padding-right: 3px;
      }

      .me-satellite-location-option {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        padding: 5px 7px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        color: #20364d;
        transition: background .15s ease;
      }

      .me-satellite-location-option:hover {
        background: rgba(37, 99, 235, .08);
      }

      .me-satellite-location-option--all {
        margin-bottom: 5px;
        padding-bottom: 9px;
        border-bottom: 1px solid rgba(30, 64, 175, .14);
        border-radius: 0;
        font-weight: 800;
      }

      .me-satellite-location-option input {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: #111827;
        flex: 0 0 auto;
      }

      .me-satellite-location-option__name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .me-satellite-location-option__count {
        margin-left: auto;
        color: #64748b;
        font-size: 11px;
      }

      .me-satellite-marker-wrapper {
        background: transparent;
        border: 0;
      }

      .me-satellite-marker {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 112px;
        transform: translate(-50%, -50%);
        pointer-events: auto;
      }

      .me-satellite-marker__label {
        max-width: 150px;
        margin-bottom: 4px;
        padding: 3px 8px;
        border: 1px solid rgba(15, 23, 42, .35);
        border-radius: 7px;
        background: rgba(255, 255, 255, .96);
        box-shadow: 0 2px 8px rgba(15, 23, 42, .18);
        color: #111827;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.15;
        text-align: center;
        white-space: nowrap;
      }

      .me-satellite-marker__dot {
        width: 14px;
        height: 14px;
        border: 3px solid #ffffff;
        border-radius: 50%;
        background: #050505;
        box-shadow:
          0 0 0 2px rgba(5, 5, 5, .9),
          0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-marker:hover .me-satellite-marker__dot {
        transform: scale(1.18);
      }

      .me-satellite-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 10050;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 22px;
        background: rgba(15, 23, 42, .58);
        backdrop-filter: blur(2px);
      }

      .me-satellite-modal-backdrop.is-open {
        display: flex;
      }

      .me-satellite-modal {
        width: min(1040px, 96vw);
        max-height: 92vh;
        overflow: auto;
        border: 1px solid rgba(148, 163, 184, .45);
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 26px 80px rgba(15, 23, 42, .36);
      }

      .me-satellite-modal__header {
        position: sticky;
        top: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 16px 18px;
        border-bottom: 1px solid #e2e8f0;
        background: rgba(255, 255, 255, .98);
      }

      .me-satellite-modal__title {
        margin: 0;
        color: #102a43;
        font-size: 20px;
        font-weight: 900;
      }

      .me-satellite-modal__close {
        width: 38px;
        height: 38px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #ffffff;
        color: #334155;
        cursor: pointer;
        font-size: 23px;
        line-height: 1;
      }

      .me-satellite-modal__body {
        padding: 18px;
      }

      .me-satellite-compare-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      .me-satellite-compare-card {
        min-width: 0;
        border: 1px solid #dbe4ee;
        border-radius: 14px;
        overflow: hidden;
        background: #f8fafc;
      }

      .me-satellite-compare-card__head {
        padding: 11px 12px;
        border-bottom: 1px solid #dbe4ee;
        background: #ffffff;
      }

      .me-satellite-compare-card__phase {
        display: block;
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
        text-transform: uppercase;
      }

      .me-satellite-compare-card__meta {
        margin-top: 4px;
        color: #475569;
        font-size: 12px;
        line-height: 1.45;
      }

      .me-satellite-compare-card__image-wrap {
        position: relative;
        min-height: 260px;
        background: #0f172a;
      }

      .me-satellite-compare-card__image {
        display: block;
        width: 100%;
        height: auto;
        min-height: 260px;
        max-height: 520px;
        object-fit: contain;
        background: #0f172a;
      }

      .me-satellite-modal__details {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
        margin-top: 16px;
      }

      .me-satellite-detail-box {
        padding: 13px 14px;
        border: 1px solid #dbe4ee;
        border-radius: 12px;
        background: #f8fafc;
        color: #334155;
        font-size: 12px;
        line-height: 1.6;
      }

      .me-satellite-detail-box strong {
        color: #0f172a;
      }

      .me-satellite-modal__actions {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        margin-top: 16px;
      }

      .me-satellite-modal__button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 38px;
        padding: 8px 13px;
        border: 1px solid #cbd5e1;
        border-radius: 9px;
        background: #ffffff;
        color: #174ea6;
        font-size: 12px;
        font-weight: 800;
        text-decoration: none;
        cursor: pointer;
      }

      .me-satellite-modal__button--primary {
        border-color: #1769aa;
        background: #1769aa;
        color: #ffffff;
      }

      @media (max-width: 760px) {
        .me-satellite-modal-backdrop {
          align-items: flex-start;
          padding: 8px;
        }

        .me-satellite-modal {
          width: 100%;
          max-height: calc(100vh - 16px);
          border-radius: 13px;
        }

        .me-satellite-compare-grid,
        .me-satellite-modal__details {
          grid-template-columns: 1fr;
        }

        .me-satellite-compare-card__image-wrap,
        .me-satellite-compare-card__image {
          min-height: 210px;
        }
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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function resolveRecordCenter(record) {
    const lat = toNumber(firstDefined(
      record?.target_area?.lat,
      record?.lat,
      record?.latitude
    ));
    const lon = toNumber(firstDefined(
      record?.target_area?.lon,
      record?.lon,
      record?.lng,
      record?.longitude
    ));

    if (lat !== null && lon !== null) return [lat, lon];

    const bounds = record?.normalized_bounds;
    if (
      Array.isArray(bounds) &&
      bounds.length === 2 &&
      Array.isArray(bounds[0]) &&
      Array.isArray(bounds[1])
    ) {
      return [
        (Number(bounds[0][0]) + Number(bounds[1][0])) / 2,
        (Number(bounds[0][1]) + Number(bounds[1][1])) / 2
      ];
    }

    return null;
  }

  function normalizePhase(record, phaseName) {
    const phase = record?.[phaseName] || {};
    const fallbackImage = phaseName === "after" ? record?.image_url : "";

    return {
      image_url: String(firstDefined(
        phase.image_url,
        phase.url,
        phase.file_url,
        fallbackImage,
        ""
      )),
      requested_date: String(firstDefined(
        phase.requested_date,
        phase.requested,
        record?.requested_date,
        ""
      )),
      acquisition_date: String(firstDefined(
        phase.acquisition_date,
        phase.timestamp,
        phase.date,
        ""
      )),
      cloud_cover_percent: firstDefined(
        phase.cloud_cover_percent,
        phase.cloud_cover,
        phase.cloud,
        null
      ),
      product_id: String(firstDefined(
        phase.product_id,
        phase.scene_id,
        phase.id,
        ""
      ))
    };
  }

  function formatCloud(value) {
    const number = toNumber(value);
    return number === null ? "n/a" : `${number.toFixed(1)}%`;
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
      markerLayer: L.layerGroup(),
      locationMarkers: new Map(),
      visibleLocationSlugs: new Set(),
      markerControlsRoot: null,
      modalRoot: null,
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

    function resolveAssetUrl(value) {
      const raw = String(value || "").trim();
      if (!raw) return "";

      if (/^(?:https?:|blob:|data:)/i.test(raw)) return raw;

      let relative = raw.replace(/^\.\//, "").replace(/^\//, "");
      const archiveUrl = String(state.archiveUrl || "");

      if (
        relative.startsWith("data/") &&
        (archiveUrl.includes("/docs/data/") || archiveUrl.startsWith("./docs/") || archiveUrl.startsWith("docs/"))
      ) {
        relative = `docs/${relative}`;
      }

      try {
        return new URL(relative, document.baseURI).href;
      } catch (_error) {
        return relative;
      }
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

    function getLatestRecordForLocation(slug) {
      return state.records
        .filter((record) => record.location_slug === slug)
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))[0]
        || null;
    }

    function ensureMarkerLayer() {
      if (!map.hasLayer(state.markerLayer)) {
        state.markerLayer.addTo(map);
      }
      return state.markerLayer;
    }

    function removeAllLocationMarkers() {
      state.markerLayer.clearLayers();
      state.locationMarkers.clear();
    }

    function createLocationMarker(record) {
      const center = resolveRecordCenter(record);
      if (!center) return null;

      const safeName = escapeHtml(record.location_name);
      const icon = L.divIcon({
        className: "me-satellite-marker-wrapper",
        html: `
          <div class="me-satellite-marker" title="${safeName}">
            <div class="me-satellite-marker__label">${safeName}</div>
            <div class="me-satellite-marker__dot"></div>
          </div>
        `,
        iconSize: [1, 1],
        iconAnchor: [0, 0]
      });

      const marker = L.marker(center, {
        icon,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: 620
      });

      marker.on("click", () => {
        state.selectedLocationSlug = record.location_slug;
        state.selectedRecordId = record.id;

        if (dom.locationSelect) {
          dom.locationSelect.value = record.location_slug;
        }

        updateImageSelect();

        if (dom.imageSelect) {
          dom.imageSelect.value = record.id;
        }

        state.currentRecord = record;
        showCompareModal(record);
      });

      return marker;
    }

    function syncLocationMarkers() {
      ensureMarkerLayer();
      removeAllLocationMarkers();

      getLocations().forEach((location) => {
        if (!state.visibleLocationSlugs.has(location.slug)) return;

        const record = getLatestRecordForLocation(location.slug);
        if (!record) return;

        const marker = createLocationMarker(record);
        if (!marker) return;

        marker.addTo(state.markerLayer);
        state.locationMarkers.set(location.slug, marker);
      });
    }

    function updateSelectAllCheckbox(root) {
      const allCheckbox = root?.querySelector("[data-me-satellite-select-all]");
      if (!allCheckbox) return;

      const locations = getLocations();
      const checkedCount = locations.filter((location) => (
        state.visibleLocationSlugs.has(location.slug)
      )).length;

      allCheckbox.checked = locations.length > 0 && checkedCount === locations.length;
      allCheckbox.indeterminate = checkedCount > 0 && checkedCount < locations.length;
    }

    function ensureLocationControls() {
      if (state.markerControlsRoot?.isConnected) {
        return state.markerControlsRoot;
      }

      const host = dom.locationSelect?.closest(".toolbox-row")
        || dom.locationSelect?.parentElement
        || dom.summary?.parentElement;

      if (!host?.parentElement) return null;

      const root = document.createElement("div");
      root.className = "me-satellite-location-controls";
      root.innerHTML = `
        <div class="me-satellite-location-controls__title">
          Térképi helyszínek
        </div>
        <label class="me-satellite-location-option me-satellite-location-option--all">
          <input type="checkbox" data-me-satellite-select-all>
          <span class="me-satellite-location-option__name">Összes helyszín</span>
        </label>
        <div class="me-satellite-location-controls__list"></div>
      `;

      host.parentElement.insertBefore(root, host.nextSibling);
      state.markerControlsRoot = root;

      if (window.L?.DomEvent) {
        L.DomEvent.disableClickPropagation(root);
        L.DomEvent.disableScrollPropagation(root);
      }

      root.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;

        if (target.matches("[data-me-satellite-select-all]")) {
          const checked = Boolean(target.checked);

          if (checked) {
            getLocations().forEach((location) => {
              state.visibleLocationSlugs.add(location.slug);
            });
          } else {
            state.visibleLocationSlugs.clear();
          }

          root
            .querySelectorAll("[data-me-satellite-location]")
            .forEach((checkbox) => {
              checkbox.checked = checked;
            });
        } else if (target.matches("[data-me-satellite-location]")) {
          const slug = String(target.dataset.meSatelliteLocation || "");
          if (!slug) return;

          if (target.checked) state.visibleLocationSlugs.add(slug);
          else state.visibleLocationSlugs.delete(slug);
        } else {
          return;
        }

        syncLocationMarkers();
        updateSelectAllCheckbox(root);
      });

      return root;
    }

    function renderLocationControls() {
      const root = ensureLocationControls();
      if (!root) return;

      const list = root.querySelector(".me-satellite-location-controls__list");
      if (!list) return;

      list.replaceChildren();

      getLocations().forEach((location) => {
        const label = document.createElement("label");
        label.className = "me-satellite-location-option";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.visibleLocationSlugs.has(location.slug);
        checkbox.dataset.meSatelliteLocation = location.slug;

        const name = document.createElement("span");
        name.className = "me-satellite-location-option__name";
        name.textContent = location.name;

        const count = document.createElement("span");
        count.className = "me-satellite-location-option__count";
        count.textContent = String(location.count);

        label.append(checkbox, name, count);
        list.appendChild(label);
      });

      updateSelectAllCheckbox(root);
    }

    function ensureCompareModal() {
      if (state.modalRoot?.isConnected) return state.modalRoot;

      const backdrop = document.createElement("div");
      backdrop.className = "me-satellite-modal-backdrop";
      backdrop.setAttribute("role", "dialog");
      backdrop.setAttribute("aria-modal", "true");
      backdrop.innerHTML = `
        <div class="me-satellite-modal">
          <div class="me-satellite-modal__header">
            <h3 class="me-satellite-modal__title">Satellite Intelligence</h3>
            <button
              type="button"
              class="me-satellite-modal__close"
              aria-label="Bezárás"
            >×</button>
          </div>
          <div class="me-satellite-modal__body"></div>
        </div>
      `;

      const close = () => {
        backdrop.classList.remove("is-open");
        document.body.style.removeProperty("overflow");
      };

      backdrop
        .querySelector(".me-satellite-modal__close")
        ?.addEventListener("click", close);

      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) close();
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && backdrop.classList.contains("is-open")) {
          close();
        }
      });

      document.body.appendChild(backdrop);
      state.modalRoot = backdrop;
      return backdrop;
    }

    function phaseCardHtml(label, phase) {
      const image = phase.image_url
        ? `<img
            class="me-satellite-compare-card__image"
            src="${escapeHtml(phase.image_url)}"
            alt="${escapeHtml(label)} Sentinel-2 image"
          >`
        : `<div class="me-satellite-detail-box">Nincs elérhető kép.</div>`;

      return `
        <section class="me-satellite-compare-card">
          <div class="me-satellite-compare-card__head">
            <span class="me-satellite-compare-card__phase">${escapeHtml(label)}</span>
            <div class="me-satellite-compare-card__meta">
              Kért dátum: <strong>${escapeHtml(phase.requested_date || "n/a")}</strong><br>
              Felvétel: <strong>${escapeHtml(phase.acquisition_date || "n/a")}</strong><br>
              Felhőzet: <strong>${escapeHtml(formatCloud(phase.cloud_cover_percent))}</strong>
            </div>
          </div>
          <div class="me-satellite-compare-card__image-wrap">
            ${image}
          </div>
        </section>
      `;
    }

    function showCompareModal(record) {
      const modal = ensureCompareModal();
      const body = modal.querySelector(".me-satellite-modal__body");
      const title = modal.querySelector(".me-satellite-modal__title");

      const before = normalizePhase(record, "before");
      const after = normalizePhase(record, "after");
      before.image_url = resolveAssetUrl(before.image_url);
      after.image_url = resolveAssetUrl(after.image_url);
      const center = resolveRecordCenter(record);
      const bounds = record.normalized_bounds;
      const radius = firstDefined(
        record?.target_area?.radius_km,
        record?.radius_km,
        record?.radius,
        "n/a"
      );

      if (title) {
        title.textContent = `Satellite Intelligence – ${record.location_name}`;
      }

      if (body) {
        body.innerHTML = `
          <div class="me-satellite-compare-grid">
            ${phaseCardHtml("BEFORE", before)}
            ${phaseCardHtml("AFTER", after)}
          </div>

          <div class="me-satellite-modal__details">
            <div class="me-satellite-detail-box">
              <strong>Helyszín adatai</strong><br>
              Név: ${escapeHtml(record.location_name)}<br>
              Koordináta: ${center
                ? `${center[0].toFixed(6)}, ${center[1].toFixed(6)}`
                : "n/a"}<br>
              Sugár: ${escapeHtml(radius)} km<br>
              BBox: ${bounds
                ? escapeHtml(bounds.flat().map((value) => Number(value).toFixed(6)).join(", "))
                : "n/a"}
            </div>

            <div class="me-satellite-detail-box">
              <strong>Adatforrás</strong><br>
              ${escapeHtml(firstDefined(
                record.source,
                record.provider,
                "Sentinel-2 / Copernicus Data Space Ecosystem"
              ))}<br>
              Rekord: ${escapeHtml(record.id)}<br>
              Feldolgozás: ${escapeHtml(firstDefined(
                record.workflow_version,
                record.version,
                "n/a"
              ))}
            </div>
          </div>

          <div class="me-satellite-modal__actions">
            ${after.image_url ? `
              <a
                class="me-satellite-modal__button me-satellite-modal__button--primary"
                href="${escapeHtml(after.image_url)}"
                target="_blank"
                rel="noopener noreferrer"
              >AFTER teljes felbontás</a>
            ` : ""}
            ${before.image_url ? `
              <a
                class="me-satellite-modal__button"
                href="${escapeHtml(before.image_url)}"
                target="_blank"
                rel="noopener noreferrer"
              >BEFORE teljes felbontás</a>
            ` : ""}
            <button
              type="button"
              class="me-satellite-modal__button"
              data-me-satellite-show-after
            >AFTER a térképen</button>
            <button
              type="button"
              class="me-satellite-modal__button"
              data-me-satellite-show-before
            >BEFORE a térképen</button>
          </div>
        `;

        body
          .querySelector("[data-me-satellite-show-after]")
          ?.addEventListener("click", () => {
            const afterRecord = {
              ...record,
              image_url: after.image_url || record.image_url
            };
            showRecord(afterRecord, { fitBounds: true });
          });

        body
          .querySelector("[data-me-satellite-show-before]")
          ?.addEventListener("click", () => {
            if (!before.image_url) return;
            const beforeRecord = {
              ...record,
              image_url: before.image_url
            };
            showRecord(beforeRecord, { fitBounds: true });
          });
      }

      modal.classList.add("is-open");
      document.body.style.overflow = "hidden";
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

      const modeLabel = state.mode === "hybrid"
        ? "Hybrid: Esri + Sentinel-2"
        : "Sentinel-2 archívum";

      return [
        `<strong>${record.location_name}</strong>`,
        `Mód: ${modeLabel}`,
        `Aktuális overlay: ${formatDate(record.timestamp)}`,
        "A részletes BEFORE/AFTER nézet a térképi fekete pontra kattintva nyílik meg."
      ].join("<br>");
    }

    function showRecord(record, { fitBounds = false } = {}) {
      removeOverlay();
      state.currentRecord = record || null;

      if (!record || !state.enabled || state.mode === "off") {
        setSummary(buildSummary(record));
        return null;
      }

      const overlayUrl = resolveAssetUrl(record.image_url);

      state.overlay = L.imageOverlay(overlayUrl, record.normalized_bounds, {
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

        const locations = getLocations();
        const knownSlugs = new Set(locations.map((location) => location.slug));

        [...state.visibleLocationSlugs].forEach((slug) => {
          if (!knownSlugs.has(slug)) state.visibleLocationSlugs.delete(slug);
        });

        if (state.visibleLocationSlugs.size === 0) {
          locations.forEach((location) => {
            state.visibleLocationSlugs.add(location.slug);
          });
        }

        renderLocationControls();
        syncLocationMarkers();

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

    ensureMarkerLayer();
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
      showCompareModal,
      showAllLocations() {
        getLocations().forEach((location) => {
          state.visibleLocationSlugs.add(location.slug);
        });
        renderLocationControls();
        syncLocationMarkers();
      },
      hideAllLocations() {
        state.visibleLocationSlugs.clear();
        renderLocationControls();
        syncLocationMarkers();
      },
      setLocationVisible(slug, visible) {
        if (visible) state.visibleLocationSlugs.add(String(slug));
        else state.visibleLocationSlugs.delete(String(slug));
        renderLocationControls();
        syncLocationMarkers();
      },
      getVisibleLocations() {
        return [...state.visibleLocationSlugs];
      },
      destroy() {
        removeOverlay();
        removeAllLocationMarkers();
        if (map.hasLayer(state.markerLayer)) map.removeLayer(state.markerLayer);
        if (state.baseLayer && map.hasLayer(state.baseLayer)) map.removeLayer(state.baseLayer);
        state.markerControlsRoot?.remove();
        state.modalRoot?.remove();
        state.baseLayer = null;
        state.markerControlsRoot = null;
        state.modalRoot = null;
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
