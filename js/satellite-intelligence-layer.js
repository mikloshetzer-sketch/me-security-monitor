(function () {
  "use strict";

  const MODULE_NAME = "ME Satellite Intelligence";
  const MODULE_VERSION = "2.4.0";
  const DEFAULT_OPACITY = 0.72;
  const DEFAULT_LOCATIONS_URLS = [
    "./data/satellite/locations.json",
    "./docs/data/satellite/locations.json"
  ];

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


      .me-satellite-region-overview-label {
        padding: 2px 6px;
        border: 1px solid rgba(71, 85, 105, .34);
        border-radius: 6px;
        background: rgba(255, 255, 255, .9);
        color: #475569;
        font-size: 10px;
        font-weight: 850;
        box-shadow: 0 1px 5px rgba(15, 23, 42, .14);
        white-space: nowrap;
      }

      .me-satellite-region-overview-label.is-active {
        border-color: rgba(220, 38, 38, .55);
        background: rgba(255, 255, 255, .97);
        color: #991b1b;
        font-size: 11px;
        font-weight: 950;
      }

      .me-region-spatial-summary {
        margin-top: 12px;
        padding: 12px;
        border: 1px solid #dbe4ee;
        border-radius: 11px;
        background: #f8fafc;
      }

      .me-region-spatial-summary__headline {
        color: #0f172a;
        font-size: 12px;
        font-weight: 900;
        line-height: 1.55;
      }

      .me-region-spatial-bands {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 7px;
        margin-top: 10px;
      }

      .me-region-spatial-band {
        padding: 8px 6px;
        border: 1px solid #dbe4ee;
        border-radius: 9px;
        background: #ffffff;
        text-align: center;
      }

      .me-region-spatial-band__label {
        display: block;
        color: #64748b;
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .02em;
      }

      .me-region-spatial-band__value {
        display: block;
        margin-top: 3px;
        color: #0f172a;
        font-size: 14px;
        font-weight: 950;
      }

      @media (max-width: 760px) {
        .me-region-spatial-bands {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
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


      .me-region-intelligence-panel {
        margin-top: 14px;
        border: 1px solid #b8c7d9;
        border-radius: 14px;
        overflow: hidden;
        background: #ffffff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, .08);
      }

      .me-region-intelligence-panel__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 15px;
        background: linear-gradient(135deg, #102a43, #1f5f86);
        color: #ffffff;
      }

      .me-region-intelligence-panel__title {
        font-size: 14px;
        font-weight: 900;
      }

      .me-region-intelligence-panel__score {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 74px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, .16);
        font-size: 12px;
        font-weight: 900;
      }

      .me-region-intelligence-panel__body {
        padding: 14px;
      }

      .me-region-intelligence-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 9px;
      }

      .me-region-intelligence-metric {
        padding: 10px 11px;
        border: 1px solid #dbe4ee;
        border-radius: 10px;
        background: #f8fafc;
      }

      .me-region-intelligence-metric__label {
        display: block;
        color: #64748b;
        font-size: 9px;
        font-weight: 900;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      .me-region-intelligence-metric__value {
        display: block;
        margin-top: 4px;
        color: #0f172a;
        font-size: 14px;
        font-weight: 900;
      }

      .me-region-intelligence-assessment {
        margin-top: 11px;
        padding: 11px 12px;
        border-left: 4px solid #2563eb;
        border-radius: 8px;
        background: #eff6ff;
        color: #1e3a5f;
        font-size: 12px;
        line-height: 1.6;
      }

      .me-region-intelligence-events {
        display: grid;
        gap: 6px;
        margin-top: 10px;
      }

      .me-region-intelligence-event {
        padding: 8px 9px;
        border: 1px solid #c7d2fe;
        border-radius: 8px;
        background: #f8faff;
        color: #334155;
        font-size: 10px;
        line-height: 1.5;
      }

      .me-region-intelligence-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 11px;
      }

      .me-satellite-iranstrike-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 66px;
        padding: 4px 7px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
      }

      .me-satellite-iranstrike-badge--inside { background: #dbeafe; color: #1e40af; }
      .me-satellite-iranstrike-badge--nearby { background: #e0e7ff; color: #4338ca; }
      .me-satellite-iranstrike-badge--none { background: #e2e8f0; color: #475569; }


      .me-satellite-iranstrike-marker-wrapper {
        background: transparent;
        border: 0;
      }

      .me-satellite-iranstrike-marker {
        position: relative;
        width: 22px;
        height: 22px;
        transform: rotate(45deg);
        border-radius: 5px;
        box-shadow: 0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-iranstrike-marker--inside {
        border: 3px solid #ffffff;
        background: #1d4ed8;
        box-shadow:
          0 0 0 3px rgba(29, 78, 216, .88),
          0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-iranstrike-marker--nearby {
        border: 4px solid #3b82f6;
        background: rgba(147, 197, 253, .35);
        box-shadow:
          0 0 0 2px rgba(255, 255, 255, .92),
          0 3px 10px rgba(15, 23, 42, .35);
      }

      .me-satellite-iranstrike-marker::after {
        position: absolute;
        left: 50%;
        top: 50%;
        content: "✦";
        transform: translate(-50%, -52%) rotate(-45deg);
        color: #ffffff;
        font-size: 12px;
        font-weight: 900;
        line-height: 1;
      }

      .me-satellite-iranstrike-popup {
        min-width: 240px;
        color: #334155;
        font-size: 12px;
        line-height: 1.55;
      }

      .me-satellite-iranstrike-popup strong {
        color: #0f172a;
      }

      .me-satellite-iranstrike-popup__status {
        display: inline-flex;
        margin-bottom: 6px;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 900;
      }

      .me-satellite-iranstrike-popup__status--inside {
        background: #dbeafe;
        color: #1e3a8a;
      }

      .me-satellite-iranstrike-popup__status--nearby {
        background: #e0e7ff;
        color: #3730a3;
      }

      .me-satellite-iranstrike-popup__source {
        display: inline-flex;
        margin-top: 7px;
        color: #1d4ed8;
        font-weight: 800;
        text-decoration: none;
      }

      @media (max-width: 760px) {
        .me-region-intelligence-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
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


      .me-satellite-cluster-count {
        position: absolute;
        left: 50%;
        top: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        transform: translate(-50%, -50%);
        border: 2px solid rgba(255, 255, 255, .96);
        border-radius: 999px;
        background: #ffffff;
        color: #0f172a;
        box-shadow: 0 1px 4px rgba(15, 23, 42, .3);
        font-size: 9px;
        font-weight: 950;
        line-height: 1;
      }

      .me-satellite-firms-marker.is-cluster {
        width: 30px;
        height: 30px;
      }

      .me-satellite-firms-marker.is-cluster::after {
        display: none;
      }

      .me-satellite-iranstrike-marker.is-cluster {
        width: 31px;
        height: 31px;
      }

      .me-satellite-iranstrike-marker.is-cluster::after {
        display: none;
      }

      .me-satellite-cluster-popup {
        min-width: 290px;
        max-width: 390px;
        color: #334155;
        font-size: 12px;
        line-height: 1.5;
      }

      .me-satellite-cluster-popup__head {
        margin-bottom: 9px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e2e8f0;
      }

      .me-satellite-cluster-popup__title {
        color: #0f172a;
        font-size: 14px;
        font-weight: 950;
      }

      .me-satellite-cluster-popup__meta {
        margin-top: 3px;
        color: #64748b;
        font-size: 11px;
      }

      .me-satellite-cluster-popup__list {
        display: grid;
        gap: 7px;
        max-height: 330px;
        overflow-y: auto;
        padding-right: 4px;
      }

      .me-satellite-cluster-popup__item {
        padding: 8px 9px;
        border: 1px solid #dbe4ee;
        border-radius: 8px;
        background: #f8fafc;
      }

      .me-satellite-cluster-popup__item strong {
        color: #0f172a;
      }

      .me-satellite-cluster-popup__item a {
        display: inline-flex;
        margin-top: 5px;
        color: #1d4ed8;
        font-weight: 800;
        text-decoration: none;
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


  function normalizeLocationEntry(entry, index = 0) {
    if (!entry || typeof entry !== "object") return null;

    const slug = String(firstDefined(
      entry.slug,
      entry.location_slug,
      entry.id,
      `location-${index + 1}`
    )).trim();

    const name = String(firstDefined(
      entry.name,
      entry.location_name,
      entry.target_area?.name,
      slug
    )).trim();

    const lat = toNumber(firstDefined(
      entry.lat,
      entry.latitude,
      entry.target_area?.lat,
      entry.target_area?.latitude
    ));

    const lon = toNumber(firstDefined(
      entry.lon,
      entry.lng,
      entry.longitude,
      entry.target_area?.lon,
      entry.target_area?.lng,
      entry.target_area?.longitude
    ));

    const radiusKm = toNumber(firstDefined(
      entry.radius_km,
      entry.radius,
      entry.target_area?.radius_km,
      10
    ));

    let bbox = Array.isArray(entry.bbox) && entry.bbox.length === 4
      ? entry.bbox.map(Number)
      : Array.isArray(entry.target_area?.bbox) &&
          entry.target_area.bbox.length === 4
        ? entry.target_area.bbox.map(Number)
        : null;

    if (
      !bbox &&
      lat !== null &&
      lon !== null &&
      radiusKm !== null &&
      radiusKm > 0
    ) {
      const latDelta = radiusKm / 111.32;
      const cosine = Math.max(
        Math.abs(Math.cos((lat * Math.PI) / 180)),
        0.15
      );
      const lonDelta = radiusKm / (111.32 * cosine);

      bbox = [
        lon - lonDelta,
        lat - latDelta,
        lon + lonDelta,
        lat + latDelta
      ];
    }

    if (
      !slug ||
      lat === null ||
      lon === null ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      !bbox ||
      bbox.some((value) => !Number.isFinite(value))
    ) {
      console.warn(
        "[ME Satellite Intelligence] Rejected location entry",
        { index, entry }
      );
      return null;
    }

    const latestRecordId = String(firstDefined(
      entry.latest_record_id,
      entry.latest_record,
      entry.record_id,
      `${slug}-latest`
    ));

    return {
      ...entry,
      slug,
      name: name || slug,
      location_slug: slug,
      location_name: name || slug,
      lat,
      lon,
      radius_km: radiusKm,
      bbox,
      normalized_bounds: [
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]]
      ],
      latest_record_id: latestRecordId,
      latest_record_url: String(firstDefined(
        entry.latest_record_url,
        entry.record_url,
        ""
      )),
      latest_thumbnail_url: String(firstDefined(
        entry.latest_thumbnail_url,
        entry.thumbnail_url,
        ""
      )),
      index_url: String(firstDefined(
        entry.index_url,
        `data/satellite/locations/${slug}/index.json`
      )),
      record_count: Number(firstDefined(
        entry.record_count,
        entry.records_count,
        0
      )),
      timestamp: String(firstDefined(
        entry.updated_at,
        entry.generated_at,
        entry.timestamp,
        ""
      ))
    };
  }

  function locationEntryToRecord(location) {
    return normalizeRecord({
      id: location.latest_record_id,
      location_name: location.name,
      location_slug: location.slug,
      timestamp: location.timestamp,
      bbox: location.bbox,
      target_area: {
        name: location.name,
        lat: location.lat,
        lon: location.lon,
        radius_km: location.radius_km
      },
      image_url: location.latest_thumbnail_url,
      record_url: location.latest_record_url,
      index_url: location.index_url,
      record_count: location.record_count,
      __summaryOnly: true,
      __locationEntry: location
    });
  }

  function normalizeLocationRecordSummary(summary, location) {
    if (!summary || typeof summary !== "object") return null;

    return normalizeRecord({
      ...summary,
      location_name: firstDefined(
        summary.location_name,
        location?.name
      ),
      location_slug: firstDefined(
        summary.location_slug,
        location?.slug
      ),
      bbox: firstDefined(summary.bbox, location?.bbox),
      target_area: {
        name: firstDefined(summary.location_name, location?.name),
        lat: firstDefined(
          summary.target_area?.lat,
          location?.lat
        ),
        lon: firstDefined(
          summary.target_area?.lon,
          location?.lon
        ),
        radius_km: firstDefined(
          summary.target_area?.radius_km,
          location?.radius_km
        )
      },
      image_url: firstDefined(
        summary.thumbnail_url,
        summary.image_url,
        location?.latest_thumbnail_url
      ),
      record_url: firstDefined(
        summary.record_url,
        location?.latest_record_url
      ),
      __summaryOnly: true
    });
  }

  function extractLocationsPayload(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];

    if (Array.isArray(payload.locations)) return payload.locations;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;

    return [];
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
              })(),
              iranstrike_correlation: (() => {
                const strikes = region.iranstrike_correlation || {};
                return {
                  classification: String(
                    firstDefined(strikes.classification, "NONE")
                  ).toUpperCase(),
                  inside_event_count: toNumber(
                    strikes.inside_event_count
                  ) ?? 0,
                  nearby_event_count: toNumber(
                    strikes.nearby_event_count
                  ) ?? 0,
                  nearest_distance_km: toNumber(
                    strikes.nearest_distance_km
                  ),
                  events: Array.isArray(strikes.events)
                    ? strikes.events
                    : [],
                  note: String(firstDefined(strikes.note, ""))
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
      })(),
      iranstrike_correlation: (() => {
        const strikes = source.iranstrike_correlation || {};
        return {
          status: String(firstDefined(strikes.status, "unavailable")).toLowerCase(),
          provider: String(firstDefined(strikes.provider, "IranStrike")),
          window_start: String(firstDefined(strikes.window_start, "")),
          window_end: String(firstDefined(strikes.window_end, "")),
          aoi_event_count: toNumber(strikes.aoi_event_count) ?? 0,
          regions_with_correlation: toNumber(strikes.regions_with_correlation) ?? 0,
          inside_region_event_matches: toNumber(strikes.inside_region_event_matches) ?? 0,
          nearby_event_matches: toNumber(strikes.nearby_event_matches) ?? 0,
          nearby_threshold_km: toNumber(strikes.nearby_threshold_km),
          aoi_events: Array.isArray(strikes.aoi_events) ? strikes.aoi_events : []
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
    const locationsUrls = asArray(
      options.locationsUrls?.length
        ? options.locationsUrls
        : DEFAULT_LOCATIONS_URLS
    );
    const archiveUrls = asArray(
      options.archiveUrls?.length
        ? options.archiveUrls
        : DEFAULT_ARCHIVE_URLS
    );
    const zIndex = Number.isFinite(Number(options.zIndex)) ? Number(options.zIndex) : 180;

    const state = {
      enabled: false,
      mode: dom.sourceSelect?.value || "sentinel2",
      baseMap: dom.baseMapSelect?.value || "osm",
      opacity: Math.min(1, Math.max(0, Number(dom.opacityInput?.value || 72) / 100)),
      archiveUrl: null,
      locationsUrl: null,
      dataMode: "unknown",
      locations: [],
      records: [],
      locationIndexCache: new Map(),
      recordDetailCache: new Map(),
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
      regionOverviewLayer: L.layerGroup(),
      regionOverviewItems: new Map(),
      firmsHotspotLayer: L.layerGroup(),
      firmsHotspotMarkers: [],
      firmsHotspotsVisible: true,
      iranStrikeLayer: L.layerGroup(),
      iranStrikeMarkers: [],
      iranStrikeVisible: true,
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

      const locationsUrl = String(state.locationsUrl || "");
      if (locationsUrl) {
        try {
          const locationsAbsolute = new URL(locationsUrl, document.baseURI);
          const locationsDirectory = new URL("./", locationsAbsolute);

          if (clean.startsWith("data/satellite/")) {
            const satelliteRelative = clean.slice("data/satellite/".length);
            add(new URL(satelliteRelative, locationsDirectory).href);
          }

          if (clean.startsWith("docs/data/satellite/")) {
            const satelliteRelative = clean.slice("docs/data/satellite/".length);
            add(new URL(satelliteRelative, locationsDirectory).href);
          }
        } catch (_error) {
          // Document-base candidates remain available.
        }
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
      if (state.overlay && map.hasLayer(state.overlay)) {
        map.removeLayer(state.overlay);
      }
      state.overlay = null;
      clearRegionHighlight();
      clearRegionOverview();
    }

    function getLocations() {
      if (state.locations.length) {
        return state.locations
          .map((location) => ({
            ...location,
            count: Number(location.record_count || 0)
          }))
          .sort((a, b) => a.name.localeCompare(b.name, "hu"));
      }

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
      return [...grouped.values()]
        .sort((a, b) => a.name.localeCompare(b.name, "hu"));
    }

    function getLatestRecordForLocation(slug) {
      const loaded = state.records
        .filter((record) => record.location_slug === slug)
        .sort((a, b) => (
          String(b.timestamp).localeCompare(String(a.timestamp))
        ))[0];

      if (loaded) return loaded;

      const location = state.locations.find(
        (item) => item.slug === slug
      );
      return location ? locationEntryToRecord(location) : null;
    }

    async function fetchJson(url) {
      const candidates = getAssetUrlCandidates(url);
      const errors = [];

      for (const candidate of candidates) {
        try {
          const response = await fetch(candidate, { cache: "no-store" });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return await response.json();
        } catch (error) {
          errors.push(`${candidate}: ${error.message}`);
        }
      }

      throw new Error(
        `JSON resource could not be loaded. ${errors.join(" | ")}`
      );
    }

    async function loadLocationRecords(slug, { force = false } = {}) {
      if (state.dataMode !== "scalable") {
        return state.records.filter(
          (record) => record.location_slug === slug
        );
      }

      if (!force && state.locationIndexCache.has(slug)) {
        return state.locationIndexCache.get(slug);
      }

      const location = state.locations.find(
        (item) => item.slug === slug
      );
      if (!location) return [];

      let summaries = [];

      try {
        const payload = await fetchJson(location.index_url);
        summaries = asArray(payload)
          .map((item) => normalizeLocationRecordSummary(item, location))
          .filter(Boolean)
          .sort((a, b) => (
            String(b.timestamp).localeCompare(String(a.timestamp))
          ));
      } catch (error) {
        console.warn(
          "[ME Satellite Intelligence] Location index unavailable; " +
          "using latest record from locations.json.",
          { slug, indexUrl: location.index_url, error }
        );

        const fallback = locationEntryToRecord(location);
        summaries = fallback ? [fallback] : [];
      }

      if (!summaries.length) {
        const fallback = locationEntryToRecord(location);
        if (fallback) summaries = [fallback];
      }

      state.records = [
        ...state.records.filter(
          (record) => record.location_slug !== slug
        ),
        ...summaries
      ];
      state.locationIndexCache.set(slug, summaries);
      return summaries;
    }

    async function loadRecordDetail(record, { force = false } = {}) {
      if (!record) return null;
      if (!record.__summaryOnly) return record;

      if (!force && state.recordDetailCache.has(record.id)) {
        return state.recordDetailCache.get(record.id);
      }

      const recordUrl = String(record.record_url || "");
      if (!recordUrl) return record;

      let payload;
      try {
        payload = await fetchJson(recordUrl);
      } catch (error) {
        console.warn(
          "[ME Satellite Intelligence] Detailed record unavailable; " +
          "keeping lightweight summary.",
          { recordUrl, error }
        );
        return record;
      }

      const detailed = normalizeRecord(payload);
      if (!detailed) return record;

      await resolveRecordAssetUrls(detailed);
      detailed.__summaryOnly = false;
      detailed.record_url = recordUrl;

      state.recordDetailCache.set(detailed.id, detailed);
      state.records = state.records.map((item) => (
        item.id === detailed.id ? detailed : item
      ));

      return detailed;
    }

    async function ensureSelectedRecordLoaded() {
      if (!state.selectedLocationSlug) return null;

      await loadLocationRecords(state.selectedLocationSlug);
      const selected = getSelectedRecord();
      const detailed = await loadRecordDetail(selected);

      if (detailed) {
        state.selectedRecordId = detailed.id;
        state.currentRecord = detailed;
      }

      return detailed;
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

      marker.on("click", async () => {
        state.selectedLocationSlug = record.location_slug;

        if (dom.locationSelect) {
          dom.locationSelect.value = record.location_slug;
        }

        setSummary("Helyszín részletes adatainak betöltése…");

        try {
          await loadLocationRecords(record.location_slug);
          updateImageSelect();

          const latest = getLatestRecordForLocation(
            record.location_slug
          );
          state.selectedRecordId = latest?.id || null;

          if (dom.imageSelect && state.selectedRecordId) {
            dom.imageSelect.value = state.selectedRecordId;
          }

          const detailed = await loadRecordDetail(latest);
          state.currentRecord = detailed || latest;
          showCompareModal(state.currentRecord);
          setSummary(buildSummary(state.currentRecord));
        } catch (error) {
          setSummary(
            `A helyszín részletes adatai nem tölthetők be.<br><small>${escapeHtml(error.message)}</small>`,
            "error"
          );
        }
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




    function coordinateClusterKey(latitude, longitude, precision = 4) {
      const lat = toNumber(latitude);
      const lon = toNumber(longitude);

      if (lat === null || lon === null) return null;

      return `${lat.toFixed(precision)}|${lon.toFixed(precision)}`;
    }

    function groupItemsByCoordinate(items, precision = 4) {
      const groups = new Map();

      asArray(items).forEach((item) => {
        const lat = toNumber(item?.latitude);
        const lon = toNumber(item?.longitude);
        const key = coordinateClusterKey(lat, lon, precision);

        if (!key) return;

        if (!groups.has(key)) {
          groups.set(key, {
            key,
            latitude: lat,
            longitude: lon,
            items: []
          });
        }

        groups.get(key).items.push(item);
      });

      return [...groups.values()].sort((a, b) => (
        b.items.length - a.items.length
      ));
    }

    function clusterStatus(items) {
      return asArray(items).some(
        (item) => Boolean(item?.inside_region_bbox)
      )
        ? "inside"
        : "nearby";
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

    function hotspotMarkerIcon(hotspotOrGroup) {
      const items = Array.isArray(hotspotOrGroup?.items)
        ? hotspotOrGroup.items
        : [hotspotOrGroup];
      const count = items.length;
      const status = clusterStatus(items);
      const inside = status === "inside";

      return L.divIcon({
        className: "me-satellite-firms-marker-wrapper",
        html: `
          <div
            class="me-satellite-firms-marker me-satellite-firms-marker--${status} ${count > 1 ? "is-cluster" : ""}"
            title="${
              count > 1
                ? `FIRMS – ${count} hőpont ezen a koordinátán`
                : inside
                  ? "FIRMS – régión belül"
                  : "FIRMS – közeli hőpont"
            }"
          >
            ${count > 1
              ? `<span class="me-satellite-cluster-count">${count}</span>`
              : ""}
          </div>
        `,
        iconSize: count > 1 ? [30, 30] : [22, 22],
        iconAnchor: count > 1 ? [15, 15] : [11, 11],
        popupAnchor: [0, count > 1 ? -16 : -12]
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

    function buildFirmsClusterPopupHtml(group, region) {
      const items = group.items;
      const maxFrp = items.reduce((maximum, item) => {
        const frp = toNumber(item?.frp);
        return frp === null ? maximum : Math.max(maximum, frp);
      }, 0);

      return `
        <div class="me-satellite-cluster-popup">
          <div class="me-satellite-cluster-popup__head">
            <div class="me-satellite-cluster-popup__title">
              NASA FIRMS · ${items.length} hőpont
            </div>
            <div class="me-satellite-cluster-popup__meta">
              ${escapeHtml(region?.id || "Régió")} ·
              ${formatMetric(group.latitude, 6)},
              ${formatMetric(group.longitude, 6)} ·
              max. FRP ${formatMetric(maxFrp, 2, " MW")}
            </div>
          </div>

          <div class="me-satellite-cluster-popup__list">
            ${items.map((hotspot, index) => {
              const sensor = [
                hotspot?.satellite,
                hotspot?.instrument
              ].filter(Boolean).join(" / ")
                || hotspot?.source
                || "n/a";

              return `
                <div class="me-satellite-cluster-popup__item">
                  <strong>Hőpont ${index + 1}</strong><br>
                  Idő: ${escapeHtml(firstDefined(
                    hotspot?.acquisition_datetime_utc,
                    hotspot?.acquisition_date,
                    "n/a"
                  ))}<br>
                  Szenzor: ${escapeHtml(sensor)}<br>
                  FRP: ${formatMetric(hotspot?.frp, 2, " MW")}
                  · Bizonyosság: ${escapeHtml(
                    formatFirmsConfidence(hotspot?.confidence)
                  )}<br>
                  Távolság: ${formatMetric(
                    hotspot?.distance_km,
                    3,
                    " km"
                  )}
                </div>
              `;
            }).join("")}
          </div>
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

      const groups = groupItemsByCoordinate(hotspots);

      if (!groups.length) return;

      ensureFirmsHotspotLayer();

      groups.forEach((group) => {
        const marker = L.marker(
          [group.latitude, group.longitude],
          {
            icon: hotspotMarkerIcon(group),
            keyboard: true,
            riseOnHover: true,
            zIndexOffset: 980
          }
        );

        marker.bindPopup(
          group.items.length > 1
            ? buildFirmsClusterPopupHtml(group, region)
            : buildFirmsPopupHtml(group.items[0], region),
          {
            maxWidth: 410,
            className: "me-satellite-firms-leaflet-popup"
          }
        );

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


    function ensureIranStrikeLayer() {
      if (!map.hasLayer(state.iranStrikeLayer)) {
        state.iranStrikeLayer.addTo(map);
      }
      return state.iranStrikeLayer;
    }

    function clearIranStrikeMarkers() {
      state.iranStrikeLayer.clearLayers();
      state.iranStrikeMarkers = [];
    }

    function iranStrikeMarkerIcon(eventOrGroup) {
      const items = Array.isArray(eventOrGroup?.items)
        ? eventOrGroup.items
        : [eventOrGroup];
      const count = items.length;
      const status = clusterStatus(items);
      const inside = status === "inside";

      return L.divIcon({
        className: "me-satellite-iranstrike-marker-wrapper",
        html: `
          <div
            class="me-satellite-iranstrike-marker me-satellite-iranstrike-marker--${status} ${count > 1 ? "is-cluster" : ""}"
            title="${
              count > 1
                ? `IranStrike – ${count} esemény ezen a koordinátán`
                : inside
                  ? "IranStrike – régión belül"
                  : "IranStrike – közeli esemény"
            }"
          >
            ${count > 1
              ? `<span class="me-satellite-cluster-count">${count}</span>`
              : ""}
          </div>
        `,
        iconSize: count > 1 ? [31, 31] : [22, 22],
        iconAnchor: count > 1 ? [16, 16] : [11, 11],
        popupAnchor: [0, count > 1 ? -18 : -13]
      });
    }

    function buildIranStrikePopupHtml(event, region) {
      const inside = Boolean(event?.inside_region_bbox);
      const status = inside ? "INSIDE" : "NEARBY";
      const statusClass = inside ? "inside" : "nearby";
      const sourceUrl = String(event?.source_url || "").trim();
      const description = String(event?.description || "").trim();

      return `
        <div class="me-satellite-iranstrike-popup">
          <span class="me-satellite-iranstrike-popup__status me-satellite-iranstrike-popup__status--${statusClass}">
            ${status}
          </span><br>
          <strong>${escapeHtml(event?.title || region?.id || "IranStrike event")}</strong><br>
          Dátum: ${escapeHtml(firstDefined(event?.date, "n/a"))}<br>
          Támadó: ${escapeHtml(firstDefined(
            event?.attacker_label,
            event?.attacker,
            "n/a"
          ))}<br>
          Kategória: ${escapeHtml(firstDefined(event?.category, "n/a"))}<br>
          Súlyosság: ${escapeHtml(firstDefined(event?.severity, "n/a"))}<br>
          Távolság a régió középpontjától:
          ${formatMetric(event?.distance_km, 3, " km")}<br>
          Pozíció:
          ${formatMetric(event?.latitude, 6)},
          ${formatMetric(event?.longitude, 6)}
          ${description ? `<br><br>${escapeHtml(description)}` : ""}
          ${sourceUrl ? `
            <br><a
              class="me-satellite-iranstrike-popup__source"
              href="${escapeHtml(sourceUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >Forrás megnyitása ↗</a>
          ` : ""}
        </div>
      `;
    }

    function buildIranStrikeClusterPopupHtml(group, region) {
      const items = group.items;
      const categories = new Map();
      const severities = new Map();

      items.forEach((event) => {
        const category = String(event?.category || "unknown");
        const severity = String(event?.severity || "unknown");

        categories.set(category, (categories.get(category) || 0) + 1);
        severities.set(severity, (severities.get(severity) || 0) + 1);
      });

      const categoryText = [...categories.entries()]
        .map(([name, count]) => `${name}: ${count}`)
        .join(" · ");

      const severityText = [...severities.entries()]
        .map(([name, count]) => `${name}: ${count}`)
        .join(" · ");

      return `
        <div class="me-satellite-cluster-popup">
          <div class="me-satellite-cluster-popup__head">
            <div class="me-satellite-cluster-popup__title">
              IranStrike · ${items.length} esemény
            </div>
            <div class="me-satellite-cluster-popup__meta">
              ${escapeHtml(region?.id || "Régió")} ·
              ${formatMetric(group.latitude, 6)},
              ${formatMetric(group.longitude, 6)}<br>
              Kategóriák: ${escapeHtml(categoryText || "n/a")}<br>
              Súlyosság: ${escapeHtml(severityText || "n/a")}
            </div>
          </div>

          <div class="me-satellite-cluster-popup__list">
            ${items.map((event, index) => {
              const sourceUrl = String(event?.source_url || "").trim();
              const description = String(event?.description || "").trim();

              return `
                <div class="me-satellite-cluster-popup__item">
                  <strong>
                    ${index + 1}. ${escapeHtml(
                      event?.title || event?.category || "IranStrike esemény"
                    )}
                  </strong><br>
                  Dátum: ${escapeHtml(firstDefined(event?.date, "n/a"))}<br>
                  Támadó: ${escapeHtml(firstDefined(
                    event?.attacker_label,
                    event?.attacker,
                    "n/a"
                  ))}
                  · Kategória: ${escapeHtml(
                    firstDefined(event?.category, "n/a")
                  )}
                  · Súlyosság: ${escapeHtml(
                    firstDefined(event?.severity, "n/a")
                  )}<br>
                  Távolság: ${formatMetric(
                    event?.distance_km,
                    3,
                    " km"
                  )}
                  ${description
                    ? `<br>${escapeHtml(description)}`
                    : ""}
                  ${sourceUrl
                    ? `<br><a href="${escapeHtml(sourceUrl)}"
                        target="_blank"
                        rel="noopener noreferrer">Forrás megnyitása ↗</a>`
                    : ""}
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    function drawIranStrikeEvents(region) {
      clearIranStrikeMarkers();

      if (!state.iranStrikeVisible || !region) return;

      const events = Array.isArray(
        region?.iranstrike_correlation?.events
      )
        ? region.iranstrike_correlation.events
        : [];

      const groups = groupItemsByCoordinate(events);

      if (!groups.length) return;

      ensureIranStrikeLayer();

      groups.forEach((group) => {
        const marker = L.marker(
          [group.latitude, group.longitude],
          {
            icon: iranStrikeMarkerIcon(group),
            keyboard: true,
            riseOnHover: true,
            zIndexOffset: 970
          }
        );

        marker.bindPopup(
          group.items.length > 1
            ? buildIranStrikeClusterPopupHtml(group, region)
            : buildIranStrikePopupHtml(group.items[0], region),
          {
            maxWidth: 430,
            className: "me-satellite-iranstrike-leaflet-popup"
          }
        );

        marker.addTo(state.iranStrikeLayer);
        state.iranStrikeMarkers.push(marker);
      });
    }

    function setIranStrikeVisible(visible) {
      state.iranStrikeVisible = Boolean(visible);

      if (state.iranStrikeVisible) {
        drawIranStrikeEvents(state.selectedRegion);
      } else {
        clearIranStrikeMarkers();
      }
    }


    function clearRegionOverview() {
      if (
        state.regionOverviewLayer &&
        map.hasLayer(state.regionOverviewLayer)
      ) {
        map.removeLayer(state.regionOverviewLayer);
      }

      state.regionOverviewLayer.clearLayers();
      state.regionOverviewItems.clear();
    }

    function regionOverviewStyle(region, activeRegionId) {
      const active = String(region?.id) === String(activeRegionId);

      return active
        ? {
            color: "#dc2626",
            weight: 3,
            opacity: 1,
            fillColor: "#ef4444",
            fillOpacity: 0.16,
            dashArray: "7 5"
          }
        : {
            color: "#64748b",
            weight: 1.5,
            opacity: 0.72,
            fillColor: "#94a3b8",
            fillOpacity: 0.07,
            dashArray: "4 4"
          };
    }

    function regionOverviewLabel(region, active, zoom) {
      if (zoom < 9 && !active) return "";
      if (zoom < 11 && !active) {
        return escapeHtml(region?.id || "R");
      }

      const change = normalizeChangeDetection(state.currentRecord);
      const intelligence = calculateRegionIntelligence(region, change);

      return active
        ? `${escapeHtml(region?.id || "R")} · ` +
          `${formatMetric(region?.area_km2_estimate, 3, " km²")} · ` +
          `${intelligence.score}/100`
        : `${escapeHtml(region?.id || "R")} · ` +
          `${formatMetric(region?.area_km2_estimate, 3, " km²")}`;
    }

    function renderRegionOverview(activeRegion = null) {
      clearRegionOverview();

      if (!state.currentRecord) return;

      const change = normalizeChangeDetection(state.currentRecord);
      const regions = Array.isArray(change?.regions)
        ? change.regions
        : [];

      if (!regions.length) return;

      state.regionOverviewLayer.addTo(map);

      const activeRegionId = firstDefined(
        activeRegion?.id,
        state.selectedRegion?.id,
        ""
      );
      const zoom = map.getZoom();

      regions.forEach((region) => {
        const bounds = regionBounds(region);
        if (!bounds) return;

        const active =
          String(region?.id) === String(activeRegionId);

        const rectangle = L.rectangle(
          bounds,
          regionOverviewStyle(region, activeRegionId)
        );

        rectangle.on("click", () => {
          state.selectedRegion = region;
          renderRegionOverview(region);
          focusRegion(region, state.currentRecord, {
            fitBounds: true
          });
        });

        const label = regionOverviewLabel(region, active, zoom);

        if (label) {
          rectangle.bindTooltip(label, {
            permanent: active || zoom >= 10,
            direction: "center",
            className:
              "me-satellite-region-overview-label" +
              (active ? " is-active" : "")
          });
        }

        rectangle.addTo(state.regionOverviewLayer);
        state.regionOverviewItems.set(region.id, rectangle);
      });

      if (
        typeof state.regionOverviewLayer.bringToFront === "function"
      ) {
        state.regionOverviewLayer.bringToFront();
      }
    }

    function refreshRegionOverviewForZoom() {
      if (!state.currentRecord) return;
      renderRegionOverview(state.selectedRegion);
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

    function focusRegion(
      region,
      record,
      { fitBounds = true } = {}
    ) {
      const bounds = regionBounds(region);
      if (!bounds || !record) return false;

      clearRegionHighlight();
      state.selectedRegion = region;
      state.currentRecord = record;

      renderRegionOverview(region);

      state.regionHighlight = L.rectangle(bounds, {
        color: "#dc2626",
        weight: 3,
        opacity: 1,
        fillColor: "#ef4444",
        fillOpacity: 0.16,
        dashArray: "7 5"
      }).addTo(map);

      const change = normalizeChangeDetection(record);
      const intelligence = calculateRegionIntelligence(
        region,
        change
      );

      state.regionHighlight.bindTooltip(
        `${escapeHtml(region.id)} · ` +
        `${formatMetric(region.area_km2_estimate, 3, " km²")} · ` +
        `${intelligence.score}/100`,
        {
          permanent: true,
          direction: "center",
          className: "me-satellite-region-highlight-label"
        }
      ).openTooltip();

      if (fitBounds) {
        map.fitBounds(bounds, {
          padding: [42, 42],
          maxZoom: 15
        });
      }

      state.selectedLocationSlug = record.location_slug;
      state.selectedRecordId = record.id;
      drawFirmsHotspots(region);
      drawIranStrikeEvents(region);
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

    function iranStrikeBadgeClass(classification) {
      const value = String(classification || "NONE").toUpperCase();
      if (value === "INSIDE") return "inside";
      if (value === "NEARBY") return "nearby";
      return "none";
    }


    function classifyIranStrikeDistance(distanceKm, insideRegion = false) {
      const distance = toNumber(distanceKm);

      if (insideRegion || distance === 0) return "INSIDE";
      if (distance === null) return "UNKNOWN";
      if (distance <= 1) return "VERY_CLOSE";
      if (distance <= 3) return "CLOSE";
      if (distance <= 10) return "NEAR";
      if (distance <= 20) return "DISTANT";
      return "OUTSIDE_AOI";
    }

    function iranStrikeProximityScore(distanceKm, insideRegion = false) {
      const distance = toNumber(distanceKm);

      if (insideRegion || distance === 0) return 100;
      if (distance === null) return 0;
      if (distance <= 1) return Math.round(100 - distance * 5);
      if (distance <= 3) {
        return Math.round(95 - (distance - 1) * 7.5);
      }
      if (distance <= 10) {
        return Math.round(80 - (distance - 3) * (30 / 7));
      }
      if (distance <= 20) {
        return Math.round(50 - (distance - 10) * 3);
      }
      return Math.max(0, Math.round(20 - (distance - 20)));
    }

    function buildIranStrikeSpatialSummary(region) {
      const correlation = region?.iranstrike_correlation || {};
      const events = Array.isArray(correlation.events)
        ? correlation.events
        : [];
      const coordinateGroups = groupItemsByCoordinate(events);

      const bands = {
        INSIDE: 0,
        VERY_CLOSE: 0,
        CLOSE: 0,
        NEAR: 0,
        DISTANT: 0,
        OUTSIDE_AOI: 0,
        UNKNOWN: 0
      };

      const distances = [];
      const scores = [];

      events.forEach((event) => {
        const inside = Boolean(event?.inside_region_bbox);
        const distance = toNumber(event?.distance_km);
        const band = classifyIranStrikeDistance(distance, inside);

        bands[band] += 1;

        if (distance !== null) distances.push(distance);
        scores.push(iranStrikeProximityScore(distance, inside));
      });

      return {
        eventCount: events.length,
        coordinateGroupCount: coordinateGroups.length,
        nearestDistanceKm: distances.length
          ? Math.min(...distances)
          : null,
        averageDistanceKm: distances.length
          ? distances.reduce((sum, value) => sum + value, 0) /
            distances.length
          : null,
        proximityScore: scores.length
          ? Math.round(
              scores.reduce((sum, value) => sum + value, 0) /
              scores.length
            )
          : 0,
        bands
      };
    }

    function buildIranStrikeSpatialSummaryHtml(region) {
      const spatial = buildIranStrikeSpatialSummary(region);
      const bands = spatial.bands;

      return `
        <div class="me-region-spatial-summary">
          <div class="me-region-spatial-summary__headline">
            IranStrike térbeli összegzés:
            ${spatial.eventCount} esemény,
            ${spatial.coordinateGroupCount} koordinátacsoport ·
            legközelebbi ${formatMetric(
              spatial.nearestDistanceKm,
              3,
              " km"
            )} ·
            átlag ${formatMetric(
              spatial.averageDistanceKm,
              3,
              " km"
            )} ·
            közelségi pontszám
            <strong>${spatial.proximityScore}/100</strong>
          </div>

          <div class="me-region-spatial-bands">
            <div class="me-region-spatial-band">
              <span class="me-region-spatial-band__label">INSIDE</span>
              <span class="me-region-spatial-band__value">${bands.INSIDE}</span>
            </div>
            <div class="me-region-spatial-band">
              <span class="me-region-spatial-band__label">VERY CLOSE</span>
              <span class="me-region-spatial-band__value">${bands.VERY_CLOSE}</span>
            </div>
            <div class="me-region-spatial-band">
              <span class="me-region-spatial-band__label">CLOSE</span>
              <span class="me-region-spatial-band__value">${bands.CLOSE}</span>
            </div>
            <div class="me-region-spatial-band">
              <span class="me-region-spatial-band__label">NEAR</span>
              <span class="me-region-spatial-band__value">${bands.NEAR}</span>
            </div>
            <div class="me-region-spatial-band">
              <span class="me-region-spatial-band__label">DISTANT</span>
              <span class="me-region-spatial-band__value">${bands.DISTANT}</span>
            </div>
          </div>
        </div>
      `;
    }

    function calculateRegionIntelligence(region, change) {
      const firms = region?.firms_correlation || {};
      const strikes = region?.iranstrike_correlation || {};
      const spatial = buildIranStrikeSpatialSummary(region);
      const area = Math.max(
        0,
        toNumber(region?.area_km2_estimate) || 0
      );
      const intensity = Math.max(
        0,
        toNumber(region?.mean_change_intensity) || 0
      );
      const areaPercent = Math.max(
        0,
        toNumber(region?.area_percent) || 0
      );

      let score = 0;
      score += Math.min(20, area * 4);
      score += Math.min(22, intensity * 36);
      score += Math.min(8, areaPercent * 3);
      score += Math.min(
        18,
        (firms.inside_hotspot_count || 0) * 4.5
      );
      score += Math.min(
        7,
        (firms.nearby_hotspot_count || 0) * 1.25
      );
      score += Math.min(
        12,
        (strikes.inside_event_count || 0) * 6
      );
      score += Math.min(
        5,
        (strikes.nearby_event_count || 0) * 0.2
      );
      score += Math.min(13, spatial.proximityScore * 0.13);

      if (
        String(change?.comparability || "").toUpperCase() === "HIGH"
      ) {
        score += 5;
      }

      score = Math.max(0, Math.min(100, Math.round(score)));

      const level = score >= 80
        ? "VERY HIGH"
        : score >= 60
          ? "HIGH"
          : score >= 35
            ? "MEDIUM"
            : "LOW";

      return {
        score,
        level,
        proximityScore: spatial.proximityScore,
        iranStrikeEventCount: spatial.eventCount,
        iranStrikeCoordinateGroups: spatial.coordinateGroupCount
      };
    }

    function buildIranStrikeEventsHtml(region) {
      const strikes = region?.iranstrike_correlation || {};
      const events = Array.isArray(strikes.events) ? strikes.events : [];
      if (!events.length) return "";

      return `
        <div class="me-region-intelligence-events">
          ${events.slice(0, 4).map((event, index) => `
            <div class="me-region-intelligence-event">
              <strong>IranStrike ${index + 1}</strong>
              · ${escapeHtml(firstDefined(event.date, "n/a"))}<br>
              ${escapeHtml(firstDefined(event.title, event.category, "Esemény"))}<br>
              Szereplő: ${escapeHtml(firstDefined(event.attacker_label, event.attacker, "n/a"))}
              · Súlyosság: ${escapeHtml(firstDefined(event.severity, "n/a"))}<br>
              Távolság: ${formatMetric(event.distance_km, 3, " km")}
              ${event.inside_region_bbox ? "· <strong>régión belül</strong>" : "· közeli esemény"}
              ${event.source_url ? `<br><a href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener noreferrer">Forrás megnyitása</a>` : ""}
            </div>
          `).join("")}
        </div>
      `;
    }

    function buildRegionAssessment(region, change) {
      const intelligence = calculateRegionIntelligence(region, change);
      const firms = region?.firms_correlation || {};
      const strikes = region?.iranstrike_correlation || {};
      const signals = [];

      if ((firms.inside_hotspot_count || 0) > 0) {
        signals.push(`${firms.inside_hotspot_count} FIRMS-hőpont található a régión belül`);
      } else if ((firms.nearby_hotspot_count || 0) > 0) {
        signals.push(`${firms.nearby_hotspot_count} FIRMS-hőpont található a közelben`);
      }

      if ((strikes.inside_event_count || 0) > 0) {
        signals.push(`${strikes.inside_event_count} IranStrike-esemény esik a régión belülre`);
      } else if ((strikes.nearby_event_count || 0) > 0) {
        signals.push(`${strikes.nearby_event_count} IranStrike-esemény található a közelben`);
      }

      const signalText = signals.length
        ? signals.join("; ")
        : "nem található közvetlen FIRMS- vagy IranStrike-egyezés";

      return `A(z) ${escapeHtml(region.id)} régió becsült területe ${formatMetric(region.area_km2_estimate, 3, " km²")}, ` +
        `átlagos változási intenzitása ${formatMetric(region.mean_change_intensity, 3)}. ` +
        `${signalText}. Az összesített elemzői prioritás ${intelligence.score}/100 (${intelligence.level}). ` +
        `Ez automatikus korrelációs jelzés, nem bizonyítja önmagában a változás okát vagy fizikai károsodást.`;
    }

    function buildRegionIntelligencePanelHtml(region, change) {
      if (!region) return "";
      const intelligence = calculateRegionIntelligence(region, change);
      const firms = region.firms_correlation || {};
      const strikes = region.iranstrike_correlation || {};

      return `
        <section class="me-region-intelligence-panel" data-me-region-intelligence-panel>
          <div class="me-region-intelligence-panel__header">
            <span class="me-region-intelligence-panel__title">
              Region Intelligence – ${escapeHtml(region.id)}
            </span>
            <span class="me-region-intelligence-panel__score">
              ${intelligence.score}/100 · ${escapeHtml(intelligence.level)}
            </span>
          </div>
          <div class="me-region-intelligence-panel__body">
            <div class="me-region-intelligence-grid">
              <div class="me-region-intelligence-metric">
                <span class="me-region-intelligence-metric__label">Terület</span>
                <span class="me-region-intelligence-metric__value">${formatMetric(region.area_km2_estimate, 3, " km²")}</span>
              </div>
              <div class="me-region-intelligence-metric">
                <span class="me-region-intelligence-metric__label">Intenzitás</span>
                <span class="me-region-intelligence-metric__value">${formatMetric(region.mean_change_intensity, 3)}</span>
              </div>
              <div class="me-region-intelligence-metric">
                <span class="me-region-intelligence-metric__label">FIRMS</span>
                <span class="me-region-intelligence-metric__value">${formatMetric(firms.inside_hotspot_count, 0)} belül / ${formatMetric(firms.nearby_hotspot_count, 0)} közel</span>
              </div>
              <div class="me-region-intelligence-metric">
                <span class="me-region-intelligence-metric__label">IranStrike</span>
                <span class="me-region-intelligence-metric__value">
                  ${intelligence.iranStrikeEventCount} esemény /
                  ${intelligence.iranStrikeCoordinateGroups} hely
                </span>
              </div>
            </div>

            <div class="me-region-intelligence-assessment">
              ${buildRegionAssessment(region, change)}
            </div>

            ${buildIranStrikeSpatialSummaryHtml(region)}

            ${buildIranStrikeEventsHtml(region)}

            <div class="me-region-intelligence-actions">
              <button type="button" class="me-satellite-modal__button me-satellite-modal__button--primary" data-me-region-show-map="${escapeHtml(region.id)}">
                Régió megjelenítése a térképen
              </button>
            </div>
          </div>
        </section>
      `;
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
                )}<br>
                IranStrike:
                <span class="me-satellite-iranstrike-badge me-satellite-iranstrike-badge--${iranStrikeBadgeClass(
                  region.iranstrike_correlation?.classification
                )}">
                  ${escapeHtml(region.iranstrike_correlation?.classification || "NONE")}
                </span>
                · belül: ${formatMetric(region.iranstrike_correlation?.inside_event_count, 0)}
                · közel: ${formatMetric(region.iranstrike_correlation?.nearby_event_count, 0)}
                · prioritás: ${calculateRegionIntelligence(region, change).score}/100
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

            <div data-me-region-intelligence-host>
              ${buildRegionIntelligencePanelHtml(change.regions[0], change)}
            </div>

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
          .querySelector("[data-me-region-show-map]")
          ?.addEventListener("click", (event) => {
            const regionId = event.currentTarget.dataset.meRegionShowMap;
            const region = normalizedChange?.regions.find(
              (item) => item.id === regionId
            );
            if (!region) return;
            if (focusRegion(region, record)) {
              state.modalRoot?.classList.remove("is-open");
              document.body.style.removeProperty("overflow");
            }
          });

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

              const intelligenceHost = body.querySelector(
                "[data-me-region-intelligence-host]"
              );
              if (intelligenceHost) {
                intelligenceHost.innerHTML = buildRegionIntelligencePanelHtml(
                  region,
                  normalizedChange
                );

                intelligenceHost
                  .querySelector("[data-me-region-show-map]")
                  ?.addEventListener("click", () => {
                    if (focusRegion(region, record)) {
                      state.modalRoot?.classList.remove("is-open");
                      document.body.style.removeProperty("overflow");
                    }
                  });
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

      const previousSlug = state.selectedLocationSlug;
      const hasPrevious = locations.some(
        (location) => location.slug === previousSlug
      );

      locations.forEach((location, index) => {
        const selected = hasPrevious
          ? location.slug === previousSlug
          : index === 0;

        dom.locationSelect.add(
          new Option(
            `${location.name} (${location.count})`,
            location.slug,
            selected,
            selected
          )
        );
      });

      state.selectedLocationSlug = hasPrevious
        ? previousSlug
        : locations[0].slug;
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

      if (record.__summaryOnly && state.dataMode === "scalable") {
        setSummary(
          `<strong>${escapeHtml(record.location_name)}</strong><br>` +
          "A részletes rekord még nincs betöltve."
        );
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
      renderRegionOverview(state.selectedRegion);
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

    async function loadLegacyArchive() {
      const { payload, url } = await fetchFirstAvailable(archiveUrls);
      state.locations = [];
      state.locationIndexCache.clear();
      state.recordDetailCache.clear();
      state.records = normalizeArchive(payload).sort((a, b) => (
        String(b.timestamp).localeCompare(String(a.timestamp))
      ));
      state.archiveUrl = url;
      state.locationsUrl = null;
      state.dataMode = "legacy";
      state.locations = [];

      await Promise.all(state.records.map(resolveRecordAssetUrls));
      return state.records;
    }

    async function loadScalableLocations() {
      const { payload, url } = await fetchFirstAvailable(locationsUrls);
      const rawLocations = extractLocationsPayload(payload);
      const locations = rawLocations
        .map(normalizeLocationEntry)
        .filter(Boolean);

      console.info("[ME Satellite Intelligence] locations.json", {
        url,
        rawCount: rawLocations.length,
        acceptedCount: locations.length,
        rejectedCount: rawLocations.length - locations.length
      });

      if (!locations.length) {
        throw new Error(
          `locations.json contains no valid locations ` +
          `(raw records: ${rawLocations.length}).`
        );
      }

      state.locations = locations;
      state.locationsUrl = url;
      state.archiveUrl = null;
      state.dataMode = "scalable";
      state.locationIndexCache.clear();
      state.recordDetailCache.clear();

      // Only lightweight pseudo-records are kept initially. No detailed
      // regions, FIRMS lists or full-resolution imagery is downloaded here.
      state.records = locations
        .map(locationEntryToRecord)
        .filter(Boolean);

      return state.records;
    }

    async function loadArchive() {
      state.loading = true;
      state.lastError = null;
      dom.refreshButton?.classList.add("me-satellite-loading");
      setSummary("Könnyű műholdas helyszínindex betöltése…");

      try {
        try {
          await loadScalableLocations();
        } catch (scalableError) {
          console.warn(
            "[ME Satellite Intelligence] Scalable index unavailable; using legacy archive.",
            scalableError
          );
          setSummary(
            "Az új helyszínindex még nem érhető el. Régi archívum betöltése…"
          );
          await loadLegacyArchive();
        }

        state.ready = true;
        updateLocationSelect();

        // In scalable mode the first location index is not fetched during
        // initial page load. The lightweight pseudo-record from locations.json
        // is enough to populate the controls and markers. Detailed data is
        // loaded only after an explicit location or marker interaction.
        if (state.dataMode === "legacy" && state.selectedLocationSlug) {
          await loadLocationRecords(state.selectedLocationSlug);
        }

        updateImageSelect();

        const locations = getLocations();
        const knownSlugs = new Set(
          locations.map((location) => location.slug)
        );

        [...state.visibleLocationSlugs].forEach((slug) => {
          if (!knownSlugs.has(slug)) {
            state.visibleLocationSlugs.delete(slug);
          }
        });

        if (state.visibleLocationSlugs.size === 0) {
          locations.forEach((location) => {
            state.visibleLocationSlugs.add(location.slug);
          });
        }

        renderLocationControls();
        syncLocationMarkers();

        const selected = getSelectedRecord();
        state.currentRecord = state.dataMode === "legacy"
          ? selected
          : null;

        if (state.dataMode === "legacy") {
          applySelectedRecord({ fitBounds: false });
        } else {
          removeOverlay();
          setSummary(
            `<strong>${locations.length} helyszín betöltve.</strong><br>` +
            "A helyszínlista aktív. A részletes rekordok és képek csak " +
            "kiválasztáskor töltődnek le."
          );
        }

        notify(
          state.dataMode === "scalable"
            ? `Könnyű helyszínindex betöltve: ${locations.length} helyszín`
            : `Régi műholdas archívum betöltve: ${state.records.length} kép`
        );
        return [...state.records];
      } catch (error) {
        state.ready = false;
        state.lastError = error;
        state.records = [];
        state.locations = [];
        updateLocationSelect();
        updateImageSelect();
        removeOverlay();
        setSummary(
          `Műholdas adatok nem érhetők el.<br><small>${escapeHtml(error.message)}</small>`,
          "error"
        );
        notify("Műholdas adatok betöltési hiba");
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
        clearIranStrikeMarkers();
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
    map.on("zoomend", refreshRegionOverviewForZoom);

    dom.locationSelect?.addEventListener("change", async () => {
      state.selectedLocationSlug = dom.locationSelect.value || null;
      state.selectedRecordId = null;
      setSummary("Helyszín archívumának betöltése…");

      try {
        await loadLocationRecords(state.selectedLocationSlug);
        updateImageSelect();
        const detailed = await ensureSelectedRecordLoaded();
        showRecord(detailed, { fitBounds: true });
      } catch (error) {
        setSummary(
          `A helyszín archívuma nem tölthető be.<br><small>${escapeHtml(error.message)}</small>`,
          "error"
        );
      }
    });

    dom.imageSelect?.addEventListener("change", async () => {
      state.selectedRecordId = dom.imageSelect.value || null;
      setSummary("Kiválasztott műholdas rekord betöltése…");

      try {
        const detailed = await ensureSelectedRecordLoaded();
        showRecord(detailed, { fitBounds: true });
      } catch (error) {
        setSummary(
          `A műholdas rekord nem tölthető be.<br><small>${escapeHtml(error.message)}</small>`,
          "error"
        );
      }
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
      loadLocationRecords,
      loadRecordDetail,
      ensureSelectedRecordLoaded,
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
      setIranStrikeVisible,
      clearIranStrikeMarkers,
      destroy() {
        removeOverlay();
        clearRegionHighlight();
        clearFirmsHotspots();
        clearIranStrikeMarkers();
        if (map.hasLayer(state.firmsHotspotLayer)) {
          map.removeLayer(state.firmsHotspotLayer);
        }
        if (map.hasLayer(state.iranStrikeLayer)) {
          map.removeLayer(state.iranStrikeLayer);
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

