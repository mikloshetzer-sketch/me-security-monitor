(function () {
  "use strict";

  const MODULE_NAME = "ME Satellite Intelligence";
  const MODULE_VERSION = "1.5.0";
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

      .me-satellite-change-details {
        margin-top: 16px;
        border: 1px solid #cbd5e1;
        border-radius: 14px;
        overflow: hidden;
        background: #ffffff;
      }

      .me-satellite-change-details summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 15px;
        background: #f1f5f9;
        color: #0f2942;
        cursor: pointer;
        font-size: 13px;
        font-weight: 900;
        list-style: none;
      }

      .me-satellite-change-details summary::-webkit-details-marker {
        display: none;
      }

      .me-satellite-change-details summary::after {
        content: "▾";
        font-size: 16px;
        transition: transform .18s ease;
      }

      .me-satellite-change-details[open] summary::after {
        transform: rotate(180deg);
      }

      .me-satellite-change-body {
        padding: 15px;
      }

      .me-satellite-change-metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .me-satellite-change-metric {
        padding: 11px 12px;
        border: 1px solid #dbe4ee;
        border-radius: 11px;
        background: #f8fafc;
      }

      .me-satellite-change-metric__label {
        display: block;
        margin-bottom: 5px;
        color: #64748b;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      .me-satellite-change-metric__value {
        color: #0f172a;
        font-size: 16px;
        font-weight: 900;
      }

      .me-satellite-change-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 900;
      }

      .me-satellite-change-badge--low { background: #dcfce7; color: #166534; }
      .me-satellite-change-badge--medium { background: #fef3c7; color: #92400e; }
      .me-satellite-change-badge--high { background: #fed7aa; color: #9a3412; }
      .me-satellite-change-badge--very-high { background: #fee2e2; color: #991b1b; }
      .me-satellite-change-badge--unknown { background: #e2e8f0; color: #475569; }

      .me-satellite-change-assessment {
        margin-top: 12px;
        padding: 12px 13px;
        border-left: 4px solid #2563eb;
        border-radius: 8px;
        background: #eff6ff;
        color: #1e3a5f;
        font-size: 12px;
        line-height: 1.6;
      }

      .me-satellite-change-warnings {
        margin: 10px 0 0;
        padding: 10px 12px 10px 30px;
        border-radius: 8px;
        background: #fff7ed;
        color: #9a3412;
        font-size: 12px;
        line-height: 1.55;
      }

      .me-satellite-change-map {
        display: block;
        width: 100%;
        max-height: 560px;
        margin-top: 13px;
        border: 1px solid #dbe4ee;
        border-radius: 11px;
        object-fit: contain;
        background: #0f172a;
      }


      .me-satellite-region-section {
        margin-top: 14px;
        border: 1px solid #dbe4ee;
        border-radius: 12px;
        overflow: hidden;
        background: #ffffff;
      }

      .me-satellite-region-section__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 11px 12px;
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;
      }

      .me-satellite-region-section__title {
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
      }

      .me-satellite-region-section__hint {
        color: #64748b;
        font-size: 11px;
        text-align: right;
      }

      .me-satellite-region-list {
        display: grid;
        gap: 7px;
        max-height: 360px;
        overflow-y: auto;
        padding: 9px;
      }

      .me-satellite-region-item {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 9px 10px;
        border: 1px solid #dbe4ee;
        border-radius: 10px;
        background: #ffffff;
        color: #334155;
        cursor: pointer;
        text-align: left;
        transition:
          border-color .15s ease,
          box-shadow .15s ease,
          transform .15s ease;
      }

      .me-satellite-region-item:hover,
      .me-satellite-region-item:focus-visible {
        border-color: #2563eb;
        box-shadow: 0 4px 14px rgba(37, 99, 235, .14);
        outline: none;
        transform: translateY(-1px);
      }

      .me-satellite-region-item.is-active {
        border-color: #dc2626;
        background: #fff7f7;
        box-shadow: 0 0 0 2px rgba(220, 38, 38, .12);
      }

      .me-satellite-region-item__id {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 32px;
        border-radius: 8px;
        background: #0f172a;
        color: #ffffff;
        font-size: 12px;
        font-weight: 900;
      }

      .me-satellite-region-item__main {
        min-width: 0;
      }

      .me-satellite-region-item__title {
        display: block;
        color: #0f172a;
        font-size: 12px;
        font-weight: 850;
      }

      .me-satellite-region-item__meta {
        display: block;
        margin-top: 3px;
        color: #64748b;
        font-size: 11px;
        line-height: 1.45;
      }

      .me-satellite-region-item__size {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 70px;
        padding: 5px 7px;
        border-radius: 999px;
        background: #eef2ff;
        color: #3730a3;
        font-size: 10px;
        font-weight: 900;
      }

      .me-satellite-region-highlight-label {
        padding: 3px 7px;
        border: 1px solid rgba(15, 23, 42, .35);
        border-radius: 6px;
        background: rgba(255, 255, 255, .96);
        color: #991b1b;
        font-size: 11px;
        font-weight: 900;
        box-shadow: 0 2px 8px rgba(15, 23, 42, .18);
      }


      .me-satellite-firms-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 66px;
        padding: 4px 7px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .02em;
      }

      .me-satellite-firms-badge--inside {
        background: #fee2e2;
        color: #991b1b;
      }

      .me-satellite-firms-badge--nearby {
        background: #fef3c7;
        color: #92400e;
      }

      .me-satellite-firms-badge--none {
        background: #e2e8f0;
        color: #475569;
      }

      .me-satellite-firms-badge--unavailable {
        background: #e0e7ff;
        color: #3730a3;
      }


      .me-satellite-firms-marker-wrapper {
        background: transparent;
        border: 0;
      }

      .me-satellite-firms-marker {
        position: relative;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        box-shadow: 0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-firms-marker--inside {
        border: 3px solid #ffffff;
        background: #dc2626;
        box-shadow:
          0 0 0 3px rgba(220, 38, 38, .92),
          0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-firms-marker--nearby {
        border: 4px solid #f59e0b;
        background: rgba(245, 158, 11, .22);
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, .92),
          0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-firms-marker::after {
        position: absolute;
        left: 50%;
        top: 50%;
        content: "🔥";
        transform: translate(-50%, -52%);
        font-size: 11px;
        line-height: 1;
      }

      .me-satellite-firms-map-control {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 10px;
        padding: 9px 10px;
        border: 1px solid #dbe4ee;
        border-radius: 9px;
        background: #ffffff;
        color: #334155;
        font-size: 11px;
        font-weight: 800;
        cursor: pointer;
      }

      .me-satellite-firms-map-control input {
        width: 16px;
        height: 16px;
        margin: 0;
        accent-color: #dc2626;
      }

      .me-satellite-firms-popup {
        min-width: 220px;
        color: #334155;
        font-size: 12px;
        line-height: 1.55;
      }

      .me-satellite-firms-popup strong {
        color: #0f172a;
      }

      .me-satellite-firms-popup__status {
        display: inline-flex;
        margin-bottom: 6px;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
      }

      .me-satellite-firms-popup__status--inside {
        background: #fee2e2;
        color: #991b1b;
      }

      .me-satellite-firms-popup__status--nearby {
        background: #fef3c7;
        color: #92400e;
      }

      .me-satellite-firms-summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        margin-top: 12px;
      }

      .me-satellite-firms-summary__item {
        padding: 9px 10px;
        border: 1px solid #dbe4ee;
        border-radius: 9px;
        background: #f8fafc;
      }

      .me-satellite-firms-summary__label {
        display: block;
        color: #64748b;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .me-satellite-firms-summary__value {
        display: block;
        margin-top: 3px;
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
      }

      .me-satellite-firms-details {
        margin-top: 7px;
        padding: 8px 9px;
        border-left: 3px solid #f59e0b;
        background: #fffbeb;
        color: #78350f;
        font-size: 11px;
        line-height: 1.55;
      }

      .me-satellite-firms-hotspot-list {
        display: grid;
        gap: 6px;
        margin-top: 8px;
      }

      .me-satellite-firms-hotspot {
        padding: 7px 8px;
        border: 1px solid #fde68a;
        border-radius: 8px;
        background: #ffffff;
        color: #713f12;
        font-size: 10px;
        line-height: 1.45;
      }

      @media (max-width: 760px) {
        .me-satellite-firms-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 640px) {
        .me-satellite-region-item {
          grid-template-columns: 40px minmax(0, 1fr);
        }

        .me-satellite-region-item__size {
          grid-column: 2;
          justify-self: start;
        }

        .me-satellite-region-section__header {
          align-items: flex-start;
          flex-direction: column;
        }

        .me-satellite-region-section__hint {
          text-align: left;
        }
      }

      .me-satellite-change-note {
        margin-top: 11px;
        color: #64748b;
        font-size: 11px;
        line-height: 1.5;
      }

      @media (max-width: 900px) {
        .me-satellite-change-metrics {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
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

  function normalizeChangeDetection(record) {
    const source = record?.change_detection;
    if (!source || typeof source !== "object") return null;

    const warnings = Array.isArray(source.warnings)
      ? source.warnings.filter(Boolean).map(String)
      : source.warnings
        ? [String(source.warnings)]
        : [];

    return {
      status: String(firstDefined(source.status, "unknown")),
      score: toNumber(source.score),
      level: String(firstDefined(source.level, "UNKNOWN")).toUpperCase(),
      comparability: String(firstDefined(source.comparability, "UNKNOWN")).toUpperCase(),
      comparability_score: toNumber(source.comparability_score),
      ssim: toNumber(source.ssim),
      changed_pixel_percent: toNumber(source.changed_pixel_percent),
      significant_regions: toNumber(source.significant_regions),
      largest_region_percent: toNumber(firstDefined(
        source.largest_region_percent,
        source.largest_region_area_percent,
        source.largest_region
      )),
      largest_region_km2: toNumber(source.largest_region_km2),
      processing_time_seconds: toNumber(firstDefined(
        source.processing_time_seconds,
        source.processing_time
      )),
      assessment: String(firstDefined(
        source.assessment,
        "Nincs elérhető automatikus értékelés."
      )),
      warnings,
      change_map_url: String(firstDefined(
        source.change_map_url,
        source.map_url,
        source.image_url,
        ""
      )),
      regions: Array.isArray(source.regions)
        ? source.regions
            .filter((region) => region && typeof region === "object")
            .map((region, index) => ({
              id: String(firstDefined(region.id, `R${String(index + 1).padStart(2, "0")}`)),
              rank: toNumber(firstDefined(region.rank, index + 1)),
              area_pixels: toNumber(region.area_pixels),
              area_percent: toNumber(region.area_percent),
              area_km2_estimate: toNumber(region.area_km2_estimate),
              relative_size: String(firstDefined(region.relative_size, "UNKNOWN")).toUpperCase(),
              centroid: {
                lat: toNumber(region.centroid?.lat),
                lon: toNumber(firstDefined(region.centroid?.lon, region.centroid?.lng))
              },
              bbox_geo: Array.isArray(region.bbox_geo)
                ? region.bbox_geo.map(Number)
                : null,
              mean_change_intensity: toNumber(region.mean_change_intensity),
              max_change_intensity: toNumber(region.max_change_intensity),
              interpretation: String(firstDefined(region.interpretation, "visual_change_candidate")),
              firms_correlation: (() => {
                const firms = region.firms_correlation || {};
                return {
                  classification: String(
                    firstDefined(firms.classification, "NONE")
                  ).toUpperCase(),
                  inside_hotspot_count: toNumber(
                    firms.inside_hotspot_count
                  ) ?? 0,
                  nearby_hotspot_count: toNumber(
                    firms.nearby_hotspot_count
                  ) ?? 0,
                  nearest_distance_km: toNumber(
                    firms.nearest_distance_km
                  ),
                  hotspots: Array.isArray(firms.hotspots)
                    ? firms.hotspots
                    : [],
                  note: String(firstDefined(firms.note, ""))
                };
              })()
            }))
        : [],
      firms_correlation: (() => {
        const firms = source.firms_correlation || {};
        return {
          status: String(firstDefined(firms.status, "unavailable")).toLowerCase(),
          provider: String(firstDefined(firms.provider, "NASA LANCE FIRMS")),
          window_start: String(firstDefined(firms.window_start, "")),
          window_end: String(firstDefined(firms.window_end, "")),
          aoi_hotspot_count: toNumber(firms.aoi_hotspot_count) ?? 0,
          regions_with_correlation: toNumber(
            firms.regions_with_correlation
          ) ?? 0,
          inside_region_hotspot_matches: toNumber(
            firms.inside_region_hotspot_matches
          ) ?? 0,
          nearby_hotspot_matches: toNumber(
            firms.nearby_hotspot_matches
          ) ?? 0,
          nearby_threshold_km: toNumber(
            firms.nearby_threshold_km
          ),
          errors: Array.isArray(firms.errors) ? firms.errors : []
        };
      })()
    };
  }

  function formatMetric(value, digits = 1, suffix = "") {
    const number = toNumber(value);
    return number === null ? "n/a" : `${number.toFixed(digits)}${suffix}`;
  }

  function changeLevelClass(level) {
    const normalized = String(level || "").toLowerCase().replace(/_/g, "-");
    return ["low", "medium", "high", "very-high"].includes(normalized)
      ? normalized
      : "unknown";
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
      regionHighlight: null,
      firmsHotspotLayer: L.layerGroup(),
      firmsHotspotMarkers: [],
      firmsHotspotsVisible: true,
      selectedRegion: null,
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

    function getAssetUrlCandidates(value) {
      const raw = String(value || "").trim();
      if (!raw) return [];

      if (/^(?:blob:|data:)/i.test(raw)) return [raw];
      if (/^https?:/i.test(raw)) return [raw];

      const clean = raw.replace(/^\.\//, "").replace(/^\//, "");
      const candidates = [];
      const add = (candidate) => {
        if (!candidate) return;
        try {
          const absolute = new URL(candidate, document.baseURI).href;
          if (!candidates.includes(absolute)) candidates.push(absolute);
        } catch (_error) {
          if (!candidates.includes(candidate)) candidates.push(candidate);
        }
      };

      add(clean);

      if (clean.startsWith("data/")) {
        add(`docs/${clean}`);
      } else if (clean.startsWith("docs/data/")) {
        add(clean.slice(5));
      }

      const archiveUrl = String(state.archiveUrl || "");
      if (archiveUrl) {
        try {
          const archiveAbsolute = new URL(archiveUrl, document.baseURI);
          const archiveDirectory = new URL("./", archiveAbsolute);

          if (clean.startsWith("data/satellite/")) {
            const satelliteRelative = clean.slice("data/satellite/".length);
            add(new URL(satelliteRelative, archiveDirectory).href);
          }

          if (clean.startsWith("docs/data/satellite/")) {
            const satelliteRelative = clean.slice("docs/data/satellite/".length);
            add(new URL(satelliteRelative, archiveDirectory).href);
          }
        } catch (_error) {
          // The document-base candidates above remain available.
        }
      }

      return candidates;
    }

    function canLoadImage(url) {
      return new Promise((resolve) => {
        if (!url) {
          resolve(false);
          return;
        }

        if (/^(?:blob:|data:)/i.test(url)) {
          resolve(true);
          return;
        }

        const image = new Image();
        let finished = false;
        const finish = (result) => {
          if (finished) return;
          finished = true;
          image.onload = null;
          image.onerror = null;
          resolve(result);
        };

        image.onload = () => finish(true);
        image.onerror = () => finish(false);
        image.src = url;

        window.setTimeout(() => finish(false), 12000);
      });
    }

    async function resolveExistingAssetUrl(value) {
      const candidates = getAssetUrlCandidates(value);

      for (const candidate of candidates) {
        if (await canLoadImage(candidate)) return candidate;
      }

      return candidates[0] || "";
    }

    function resolveAssetUrl(value) {
      return getAssetUrlCandidates(value)[0] || "";
    }

    async function resolveRecordAssetUrls(record) {
      if (!record || typeof record !== "object") return record;

      const before = record.before && typeof record.before === "object"
        ? { ...record.before }
        : null;
      const after = record.after && typeof record.after === "object"
        ? { ...record.after }
        : null;

      const tasks = [];

      if (record.image_url) {
        tasks.push(
          resolveExistingAssetUrl(record.image_url).then((url) => {
            record.image_url = url;
          })
        );
      }

      if (before?.image_url) {
        tasks.push(
          resolveExistingAssetUrl(before.image_url).then((url) => {
            before.image_url = url;
          })
        );
      }

      if (after?.image_url) {
        tasks.push(
          resolveExistingAssetUrl(after.image_url).then((url) => {
            after.image_url = url;
          })
        );
      }

      if (record.change_detection?.change_map_url) {
        tasks.push(
          resolveExistingAssetUrl(record.change_detection.change_map_url).then((url) => {
            record.change_detection = {
              ...record.change_detection,
              change_map_url: url
            };
          })
        );
      }

      await Promise.all(tasks);

      if (before) record.before = before;
      if (after) record.after = after;
      return record;
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

      const block = dom.locationSelect?.closest('[data-control-block="satellite-intelligence"]')
        || dom.summary?.closest('[data-control-block="satellite-intelligence"]')
        || dom.locationSelect?.parentElement;

      if (!block) return null;

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

      const archiveImageLabel = dom.imageSelect?.previousElementSibling;
      const insertionPoint = archiveImageLabel && archiveImageLabel.parentElement === block
        ? archiveImageLabel
        : dom.imageSelect;

      if (insertionPoint && insertionPoint.parentElement === block) {
        block.insertBefore(root, insertionPoint);
      } else if (dom.locationSelect?.parentElement === block) {
        block.insertBefore(root, dom.locationSelect.nextSibling);
      } else {
        block.appendChild(root);
      }

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



    function ensureFirmsHotspotLayer() {
      if (!map.hasLayer(state.firmsHotspotLayer)) {
        state.firmsHotspotLayer.addTo(map);
      }
      return state.firmsHotspotLayer;
    }

    function clearFirmsHotspots() {
      state.firmsHotspotLayer.clearLayers();
      state.firmsHotspotMarkers = [];
    }

    function hotspotMarkerIcon(hotspot) {
      const inside = Boolean(hotspot?.inside_region_bbox);
      const status = inside ? "inside" : "nearby";

      return L.divIcon({
        className: "me-satellite-firms-marker-wrapper",
        html: `
          <div
            class="me-satellite-firms-marker me-satellite-firms-marker--${status}"
            title="${inside ? "FIRMS – régión belül" : "FIRMS – közeli hőpont"}"
          ></div>
        `,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        popupAnchor: [0, -12]
      });
    }

    function buildFirmsPopupHtml(hotspot, region) {
      const inside = Boolean(hotspot?.inside_region_bbox);
      const status = inside ? "INSIDE" : "NEARBY";
      const statusClass = inside ? "inside" : "nearby";

      const sensor = [
        hotspot?.satellite,
        hotspot?.instrument
      ].filter(Boolean).join(" / ")
        || hotspot?.source
        || "n/a";

      return `
        <div class="me-satellite-firms-popup">
          <span class="me-satellite-firms-popup__status me-satellite-firms-popup__status--${statusClass}">
            ${status}
          </span><br>
          <strong>${escapeHtml(region?.id || "FIRMS")}</strong><br>
          Idő: ${escapeHtml(firstDefined(
            hotspot?.acquisition_datetime_utc,
            hotspot?.acquisition_date,
            "n/a"
          ))}<br>
          Szenzor: ${escapeHtml(sensor)}<br>
          FRP: ${formatMetric(hotspot?.frp, 2, " MW")}<br>
          Bizonyosság: ${escapeHtml(
            formatFirmsConfidence(hotspot?.confidence)
          )}<br>
          Távolság a régió középpontjától:
          ${formatMetric(hotspot?.distance_km, 3, " km")}<br>
          Pozíció:
          ${formatMetric(hotspot?.latitude, 6)},
          ${formatMetric(hotspot?.longitude, 6)}
        </div>
      `;
    }

    function drawFirmsHotspots(region) {
      clearFirmsHotspots();
      state.selectedRegion = region || null;

      if (!state.firmsHotspotsVisible || !region) return;

      const hotspots = Array.isArray(
        region?.firms_correlation?.hotspots
      )
        ? region.firms_correlation.hotspots
        : [];

      if (!hotspots.length) return;

      ensureFirmsHotspotLayer();

      hotspots.forEach((hotspot) => {
        const lat = toNumber(hotspot?.latitude);
        const lon = toNumber(hotspot?.longitude);

        if (lat === null || lon === null) return;

        const marker = L.marker([lat, lon], {
          icon: hotspotMarkerIcon(hotspot),
          keyboard: true,
          riseOnHover: true,
          zIndexOffset: 980
        });

        marker.bindPopup(buildFirmsPopupHtml(hotspot, region), {
          maxWidth: 320,
          className: "me-satellite-firms-leaflet-popup"
        });

        marker.addTo(state.firmsHotspotLayer);
        state.firmsHotspotMarkers.push(marker);
      });
    }

    function setFirmsHotspotsVisible(visible) {
      state.firmsHotspotsVisible = Boolean(visible);

      if (state.firmsHotspotsVisible) {
        drawFirmsHotspots(state.selectedRegion);
      } else {
        clearFirmsHotspots();
      }
    }

    function regionBounds(region) {
      const bbox = region?.bbox_geo;

      if (
        Array.isArray(bbox) &&
        bbox.length === 4 &&
        bbox.every((value) => Number.isFinite(Number(value)))
      ) {
        const [west, south, east, north] = bbox.map(Number);
        return [[south, west], [north, east]];
      }

      const lat = toNumber(region?.centroid?.lat);
      const lon = toNumber(region?.centroid?.lon);

      if (lat !== null && lon !== null) {
        const delta = 0.01;
        return [[lat - delta, lon - delta], [lat + delta, lon + delta]];
      }

      return null;
    }

    function clearRegionHighlight() {
      if (state.regionHighlight && map.hasLayer(state.regionHighlight)) {
        map.removeLayer(state.regionHighlight);
      }
      state.regionHighlight = null;
    }

    function focusRegion(region, record) {
      const bounds = regionBounds(region);
      if (!bounds) return false;

      clearRegionHighlight();

      state.regionHighlight = L.rectangle(bounds, {
        color: "#dc2626",
        weight: 3,
        opacity: 1,
        fillColor: "#ef4444",
        fillOpacity: 0.12,
        dashArray: "7 5",
        interactive: false,
        pane: "overlayPane"
      }).addTo(map);

      state.regionHighlight.bindTooltip(
        `${escapeHtml(region.id)} · ${formatMetric(region.area_km2_estimate, 3, " km²")}`,
        {
          permanent: true,
          direction: "top",
          className: "me-satellite-region-highlight-label"
        }
      ).openTooltip();

      map.fitBounds(bounds, {
        padding: [42, 42],
        maxZoom: 15
      });

      state.selectedLocationSlug = record.location_slug;
      state.selectedRecordId = record.id;
      drawFirmsHotspots(region);
      return true;
    }


    function firmsBadgeClass(classification) {
      const value = String(classification || "NONE").toUpperCase();

      if (value === "INSIDE") return "inside";
      if (value === "NEARBY") return "nearby";
      if (value === "NONE") return "none";
      return "unavailable";
    }

    function formatFirmsConfidence(value) {
      if (value === null || value === undefined || value === "") return "n/a";

      const number = toNumber(value);
      if (number !== null) return `${number.toFixed(0)}%`;

      return String(value).toUpperCase();
    }

    function buildFirmsHotspotsHtml(region) {
      const firms = region.firms_correlation || {};
      const hotspots = Array.isArray(firms.hotspots)
        ? firms.hotspots
        : [];

      if (!hotspots.length) return "";

      return `
        <div class="me-satellite-firms-hotspot-list">
          ${hotspots.slice(0, 5).map((hotspot, index) => `
            <div class="me-satellite-firms-hotspot">
              <strong>Hőpont ${index + 1}</strong><br>
              Idő: ${escapeHtml(
                firstDefined(
                  hotspot.acquisition_datetime_utc,
                  hotspot.acquisition_date,
                  "n/a"
                )
              )}<br>
              Szenzor: ${escapeHtml(
                [hotspot.satellite, hotspot.instrument]
                  .filter(Boolean)
                  .join(" / ") || hotspot.source || "n/a"
              )}<br>
              FRP: ${formatMetric(hotspot.frp, 2, " MW")}
              · Bizonyosság: ${escapeHtml(
                formatFirmsConfidence(hotspot.confidence)
              )}<br>
              Távolság: ${formatMetric(
                hotspot.distance_km,
                3,
                " km"
              )}
              ${hotspot.inside_region_bbox
                ? "· <strong>régión belül</strong>"
                : "· közeli találat"}
            </div>
          `).join("")}
        </div>
      `;
    }

    function buildFirmsSummaryHtml(change) {
      const firms = change.firms_correlation || {};
      const status = firms.status || "unavailable";

      return `
        <div class="me-satellite-region-section">
          <div class="me-satellite-region-section__header">
            <span class="me-satellite-region-section__title">
              NASA FIRMS korreláció
            </span>
            <span class="me-satellite-firms-badge me-satellite-firms-badge--${escapeHtml(
              status === "completed" || status === "partial"
                ? "nearby"
                : "unavailable"
            )}">
              ${escapeHtml(status.toUpperCase())}
            </span>
          </div>

          <div class="me-satellite-firms-summary">
            <div class="me-satellite-firms-summary__item">
              <span class="me-satellite-firms-summary__label">
                AOI hőpontok
              </span>
              <span class="me-satellite-firms-summary__value">
                ${formatMetric(firms.aoi_hotspot_count, 0)}
              </span>
            </div>

            <div class="me-satellite-firms-summary__item">
              <span class="me-satellite-firms-summary__label">
                Korreláló régiók
              </span>
              <span class="me-satellite-firms-summary__value">
                ${formatMetric(firms.regions_with_correlation, 0)}
              </span>
            </div>

            <div class="me-satellite-firms-summary__item">
              <span class="me-satellite-firms-summary__label">
                Régión belüli egyezés
              </span>
              <span class="me-satellite-firms-summary__value">
                ${formatMetric(firms.inside_region_hotspot_matches, 0)}
              </span>
            </div>

            <div class="me-satellite-firms-summary__item">
              <span class="me-satellite-firms-summary__label">
                Közeli egyezés
              </span>
              <span class="me-satellite-firms-summary__value">
                ${formatMetric(firms.nearby_hotspot_matches, 0)}
              </span>
            </div>
          </div>

          <label class="me-satellite-firms-map-control">
            <input
              type="checkbox"
              data-me-satellite-firms-map-toggle
              ${state.firmsHotspotsVisible ? "checked" : ""}
            >
            FIRMS-hőpontok megjelenítése a térképen
          </label>

          <div class="me-satellite-firms-details">
            Időablak:
            <strong>${escapeHtml(firms.window_start || "n/a")}</strong>
            –
            <strong>${escapeHtml(firms.window_end || "n/a")}</strong>.
            A FIRMS-egyezés térbeli-időbeli jelzés; önmagában nem bizonyít
            támadást, tűz okát vagy fizikai károsodást.
          </div>
        </div>
      `;
    }

    function buildRegionListHtml(change) {
      if (!change.regions.length) {
        return `
          <div class="me-satellite-region-section">
            <div class="me-satellite-region-section__header">
              <span class="me-satellite-region-section__title">
                Rangsorolt változási régiók
              </span>
            </div>
            <div class="me-satellite-detail-box">
              Ehhez a futáshoz még nem készült objektumalapú régiólista.
              Futtasd a Sentinel-2 builder 3.1.0 vagy újabb verzióját.
            </div>
          </div>
        `;
      }

      const items = change.regions.map((region) => {
        const coordinate = (
          region.centroid.lat !== null &&
          region.centroid.lon !== null
        )
          ? `${region.centroid.lat.toFixed(6)}, ${region.centroid.lon.toFixed(6)}`
          : "n/a";

        return `
          <button
            type="button"
            class="me-satellite-region-item"
            data-me-satellite-region-id="${escapeHtml(region.id)}"
          >
            <span class="me-satellite-region-item__id">
              ${escapeHtml(region.id)}
            </span>
            <span class="me-satellite-region-item__main">
              <span class="me-satellite-region-item__title">
                ${formatMetric(region.area_km2_estimate, 3, " km²")}
                · ${escapeHtml(region.relative_size)}
              </span>
              <span class="me-satellite-region-item__meta">
                Koordináta: ${escapeHtml(coordinate)}<br>
                Területi arány: ${formatMetric(region.area_percent, 3, "%")}
                · Intenzitás: ${formatMetric(region.mean_change_intensity, 3)}<br>
                FIRMS:
                <span class="me-satellite-firms-badge me-satellite-firms-badge--${firmsBadgeClass(
                  region.firms_correlation?.classification
                )}">
                  ${escapeHtml(
                    region.firms_correlation?.classification || "NONE"
                  )}
                </span>
                · belül: ${formatMetric(
                  region.firms_correlation?.inside_hotspot_count,
                  0
                )}
                · közel: ${formatMetric(
                  region.firms_correlation?.nearby_hotspot_count,
                  0
                )}
                · legközelebb: ${formatMetric(
                  region.firms_correlation?.nearest_distance_km,
                  3,
                  " km"
                )}
                ${buildFirmsHotspotsHtml(region)}
              </span>
            </span>
            <span class="me-satellite-region-item__size">
              #${formatMetric(region.rank, 0)}
            </span>
          </button>
        `;
      }).join("");

      return `
        <div class="me-satellite-region-section">
          <div class="me-satellite-region-section__header">
            <span class="me-satellite-region-section__title">
              Rangsorolt változási régiók (${change.regions.length})
            </span>
            <span class="me-satellite-region-section__hint">
              Kattintásra térképi nagyítás és kiemelés
            </span>
          </div>
          <div class="me-satellite-region-list">
            ${items}
          </div>
        </div>
      `;
    }

    function buildChangeDetectionHtml(record) {
      const change = normalizeChangeDetection(record);

      if (!change) {
        return `
          <details class="me-satellite-change-details">
            <summary>Automatikus változásdetektálás</summary>
            <div class="me-satellite-change-body">
              <div class="me-satellite-detail-box">
                Ehhez a rekordhoz még nem érhető el automatikus változásdetektálási eredmény.
              </div>
            </div>
          </details>
        `;
      }

      const changeMapUrl = resolveAssetUrl(change.change_map_url);
      const levelClass = changeLevelClass(change.level);
      const warnings = change.warnings.length
        ? `<ul class="me-satellite-change-warnings">${change.warnings
            .map((warning) => `<li>${escapeHtml(warning)}</li>`)
            .join("")}</ul>`
        : "";

      const largestRegion = change.largest_region_km2 !== null
        ? `${formatMetric(change.largest_region_km2, 3, " km²")}`
        : formatMetric(change.largest_region_percent, 2, "%");

      return `
        <details class="me-satellite-change-details">
          <summary>
            <span>Automatikus változásdetektálás</span>
            <span class="me-satellite-change-badge me-satellite-change-badge--${levelClass}">
              ${escapeHtml(change.level)} · ${formatMetric(change.score, 1, "/100")}
            </span>
          </summary>

          <div class="me-satellite-change-body">
            <div class="me-satellite-change-metrics">
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Változási pontszám</span>
                <span class="me-satellite-change-metric__value">${formatMetric(change.score, 1, "/100")}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Összehasonlíthatóság</span>
                <span class="me-satellite-change-metric__value">${escapeHtml(change.comparability)}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Comparability score</span>
                <span class="me-satellite-change-metric__value">${formatMetric(change.comparability_score, 1, "%")}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">SSIM</span>
                <span class="me-satellite-change-metric__value">${formatMetric(change.ssim, 4)}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Megváltozott pixelek</span>
                <span class="me-satellite-change-metric__value">${formatMetric(change.changed_pixel_percent, 2, "%")}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Jelentős régiók</span>
                <span class="me-satellite-change-metric__value">${formatMetric(change.significant_regions, 0)}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Legnagyobb régió</span>
                <span class="me-satellite-change-metric__value">${largestRegion}</span>
              </div>
              <div class="me-satellite-change-metric">
                <span class="me-satellite-change-metric__label">Feldolgozási idő</span>
                <span class="me-satellite-change-metric__value">${formatMetric(change.processing_time_seconds, 2, " s")}</span>
              </div>
            </div>

            <div class="me-satellite-change-assessment">
              <strong>Automatikus értékelés</strong><br>
              ${escapeHtml(change.assessment)}
            </div>

            ${warnings}

            ${buildFirmsSummaryHtml(change)}

            ${buildRegionListHtml(change)}

            ${changeMapUrl ? `
              <img
                class="me-satellite-change-map"
                src="${escapeHtml(changeMapUrl)}"
                alt="${escapeHtml(record.location_name)} change map"
              >
              <div class="me-satellite-modal__actions">
                <a
                  class="me-satellite-modal__button"
                  href="${escapeHtml(changeMapUrl)}"
                  target="_blank"
                  rel="noopener noreferrer"
                >CHANGE MAP teljes felbontás</a>
                <button
                  type="button"
                  class="me-satellite-modal__button me-satellite-modal__button--primary"
                  data-me-satellite-show-change-map
                >CHANGE MAP a térképen</button>
              </div>
            ` : ""}

            <div class="me-satellite-change-note">
              Az eredmény automatikus vizuális változásjelzés. Önmagában nem bizonyít rombolást,
              katonai aktivitást vagy a változás okát; emberi elemzői ellenőrzés szükséges.
            </div>
          </div>
        </details>
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

          ${buildChangeDetectionHtml(record)}

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

        body
          .querySelector("[data-me-satellite-show-change-map]")
          ?.addEventListener("click", () => {
            const change = normalizeChangeDetection(record);
            if (!change?.change_map_url) return;

            const changeRecord = {
              ...record,
              image_url: resolveAssetUrl(change.change_map_url)
            };
            showRecord(changeRecord, { fitBounds: true });
          });

        const normalizedChange = normalizeChangeDetection(record);

        body
          .querySelector("[data-me-satellite-firms-map-toggle]")
          ?.addEventListener("change", (event) => {
            setFirmsHotspotsVisible(Boolean(event.target.checked));
          });

        body
          .querySelectorAll("[data-me-satellite-region-id]")
          .forEach((button) => {
            button.addEventListener("click", () => {
              const regionId = button.dataset.meSatelliteRegionId;
              const region = normalizedChange?.regions.find(
                (item) => item.id === regionId
              );
              if (!region) return;

              body
                .querySelectorAll(".me-satellite-region-item.is-active")
                .forEach((item) => item.classList.remove("is-active"));

              button.classList.add("is-active");

              if (focusRegion(region, record)) {
                state.modalRoot?.classList.remove("is-open");
                document.body.style.removeProperty("overflow");
              }
            });
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

        await Promise.all(state.records.map(resolveRecordAssetUrls));
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
        clearRegionHighlight();
        clearFirmsHotspots();
        state.selectedRegion = null;
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
      setFirmsHotspotsVisible,
      clearFirmsHotspots,
      destroy() {
        removeOverlay();
        clearRegionHighlight();
        clearFirmsHotspots();
        if (map.hasLayer(state.firmsHotspotLayer)) {
          map.removeLayer(state.firmsHotspotLayer);
        }
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


