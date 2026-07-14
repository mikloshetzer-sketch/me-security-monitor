/*
 * ME Security Monitor
 * Multi-source annotation controller
 *
 * File:
 *   js/annotation-controller.js
 *
 * Purpose:
 *   Extends the existing attack annotation system without modifying script.js.
 *
 * Required:
 *   - attack-annotation-layer.js V2
 *   - the existing script.js annotation controls
 *
 * Load after script.js:
 *   <script src="./js/annotation-controller.js"></script>
 *
 * Automatically supported sources:
 *   IDF:
 *     data/israel-military-activity.json
 *
 * Optional sources:
 *   Reuters:
 *     data/reuters-events.json
 *
 *   Reddit:
 *     data/reddit-events.json
 *
 *   Mastodon:
 *     data/mastodon-events.json
 *
 *   Crowd reports:
 *     data/crowd-events.json
 *
 *   NASA FIRMS:
 *     data/firms-events.json
 *
 * Public API:
 *   window.MEAnnotationController.refresh()
 *   window.MEAnnotationController.getState()
 *   window.MEAnnotationController.setSourceEnabled(source, enabled)
 *   window.MEAnnotationController.setMinimumReliability(score)
 */

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const CONTROLLER_ID = "me-multisource-annotation-controller";

  if (window[CONTROLLER_ID]) {
    return;
  }

  const SOURCE_DEFINITIONS = {
    idf: {
      label: "IDF Official",
      checkboxId: "attackAnnotationsIdfCheckbox",
      enabledByDefault: true,
      required: true,
      urls: [
        "data/israel-military-activity.json"
      ],
      extract(payload) {
        if (Array.isArray(payload?.map_events)) {
          return payload.map_events;
        }

        if (Array.isArray(payload?.events)) {
          return payload.events.filter(
            event =>
              event?.map_visualizable === true &&
              validEventCoordinate(event)
          );
        }

        return [];
      }
    },

    reuters: {
      label: "Reuters",
      checkboxId: "attackAnnotationsReutersCheckbox",
      enabledByDefault: false,
      required: false,
      urls: [
        "data/reuters-events.json",
        "data/reuters.json"
      ],
      extract: extractGenericEvents
    },

    reddit: {
      label: "Reddit",
      checkboxId: "attackAnnotationsRedditCheckbox",
      enabledByDefault: false,
      required: false,
      urls: [
        "reports.json",
        "data/reports.json",
        "data/reddit-events.json",
        "data/reddit.json"
      ],
      extract(payload) {
        return extractReportEvents(payload, "reddit");
      }
    },

    mastodon: {
      label: "Mastodon",
      checkboxId: "attackAnnotationsMastodonCheckbox",
      enabledByDefault: false,
      required: false,
      urls: [
        "reports.json",
        "data/reports.json",
        "data/mastodon-events.json",
        "data/mastodon.json"
      ],
      extract(payload) {
        return extractReportEvents(payload, "mastodon");
      }
    },

    crowd: {
      label: "Other crowd reports",
      checkboxId: "attackAnnotationsCrowdCheckbox",
      enabledByDefault: false,
      required: false,
      urls: [
        "reports.json",
        "data/reports.json",
        "data/crowd-events.json",
        "data/crowd-reports.json"
      ],
      extract(payload) {
        return extractReportEvents(payload, "crowd");
      }
    },

    firms: {
      label: "NASA FIRMS",
      checkboxId: "attackAnnotationsFirmsCheckbox",
      enabledByDefault: false,
      required: false,
      urls: [
        "data/firms-events.json",
        "data/firms.json"
      ],
      extract: extractGenericEvents
    }
  };

  const state = {
    initialized: false,
    uiReady: false,
    destroyed: false,
    refreshing: false,
    controller: null,
    panelBlock: null,
    reliabilitySelect: null,
    sourceStatusHost: null,
    sourceData: new Map(),
    sourceUrls: new Map(),
    sourceErrors: new Map(),
    sourceEnabled: new Map(),
    lastRefreshAt: "",
    pollTimer: null,
    refreshTimer: null,
    listeners: []
  };

  function asText(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function asNumber(value) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
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
      !(
        Math.abs(latitude) < 0.000001 &&
        Math.abs(longitude) < 0.000001
      )
    );
  }

  function eventLatitude(event) {
    return asNumber(
      event?.latitude ??
      event?.lat ??
      event?.location?.latitude ??
      event?.location?.lat
    );
  }

  function eventLongitude(event) {
    return asNumber(
      event?.longitude ??
      event?.lng ??
      event?.lon ??
      event?.location?.longitude ??
      event?.location?.lng ??
      event?.location?.lon
    );
  }

  function validEventCoordinate(event) {
    return validCoordinate(
      eventLatitude(event),
      eventLongitude(event)
    );
  }

  function reportSourceText(event) {
    const source = event?.source;

    const parts = [
      event?.platform,
      event?.network,
      event?.source_type,
      event?.source_name,
      event?.feed,
      event?.provider,
      event?.origin,
      event?.author,
      event?.url,
      event?.link,
      event?.permalink,
      typeof source === "string" ? source : "",
      source?.type,
      source?.name,
      source?.platform,
      source?.url
    ];

    return parts
      .map(value => asText(value).toLowerCase())
      .filter(Boolean)
      .join(" ");
  }

  function classifyReportSource(event) {
    const explicitType = asText(
      typeof event?.source === "object"
        ? event.source?.type
        : event?.source_type
    ).toLowerCase();

    if (explicitType === "reddit") {
      return "reddit";
    }

    if (
      explicitType === "mastodon" ||
      explicitType === "fediverse" ||
      explicitType === "activitypub"
    ) {
      return "mastodon";
    }

    const text = reportSourceText(event);

    if (
      text.includes("reddit") ||
      text.includes("redd.it") ||
      text.includes("/r/")
    ) {
      return "reddit";
    }

    if (
      text.includes("mastodon") ||
      text.includes("mstdn") ||
      text.includes("fediverse") ||
      text.includes("activitypub") ||
      text.includes(".social/@") ||
      text.includes(".host/@")
    ) {
      return "mastodon";
    }

    return "crowd";
  }

  function normalizeReportEvent(event, source) {
    if (!event || typeof event !== "object") {
      return null;
    }

    const location =
      event.location &&
      typeof event.location === "object"
        ? event.location
        : {};

    const latitude = asNumber(
      event.latitude ??
      event.lat ??
      location.latitude ??
      location.lat
    );

    const longitude = asNumber(
      event.longitude ??
      event.lng ??
      event.lon ??
      location.longitude ??
      location.lng ??
      location.lon
    );

    if (!validCoordinate(latitude, longitude)) {
      return null;
    }

    const sourceObject =
      event.source &&
      typeof event.source === "object"
        ? event.source
        : {};

    const sourceUrl = asText(
      event.source_url ||
      event.url ||
      event.link ||
      event.permalink ||
      sourceObject.url
    );

    return {
      ...event,
      latitude,
      longitude,
      location:
        asText(
          typeof event.location === "string"
            ? event.location
            : "",
          asText(
            event.location_name ||
            event.city ||
            location.name ||
            location.label ||
            location.city ||
            event.region ||
            event.country,
            "Unknown location"
          )
        ),
      title:
        asText(
          event.title ||
          event.headline ||
          event.name,
          source === "reddit"
            ? "Reddit security report"
            : source === "mastodon"
              ? "Mastodon security report"
              : "Crowd security report"
        ),
      description:
        asText(
          event.description ||
          event.summary ||
          event.text ||
          event.content ||
          event.body
        ),
      category:
        asText(
          event.category ||
          event.type ||
          event.event_type,
          "social_report"
        ),
      date:
        event.date ||
        event.timestamp ||
        event.datetime ||
        event.created_at ||
        event.published_at ||
        "",
      source_url: sourceUrl,
      source_label:
        source === "reddit"
          ? "Reddit"
          : source === "mastodon"
            ? "Mastodon"
            : "Crowd report",
      source_type: "social_media",
      verification_status:
        asText(
          event.verification_status,
          "unverified_social_report"
        ),
      reliability_score:
        asText(event.confidence).toUpperCase() === "HIGH"
          ? 48
          : asText(event.confidence).toUpperCase() === "MED"
            ? 38
            : asText(event.confidence).toUpperCase() === "LOW"
              ? 28
              : undefined,
      map_visualizable: true
    };
  }

  function reportPayloadEvents(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    const candidates = [
      payload?.events,
      payload?.reports,
      payload?.items,
      payload?.data,
      payload?.results
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }

    return [];
  }

  function extractReportEvents(payload, requestedSource) {
    return reportPayloadEvents(payload)
      .filter(
        event =>
          classifyReportSource(event) ===
          requestedSource
      )
      .map(
        event =>
          normalizeReportEvent(
            event,
            requestedSource
          )
      )
      .filter(Boolean);
  }

  function extractGenericEvents(payload) {
    if (Array.isArray(payload)) {
      return payload.filter(validEventCoordinate);
    }

    const candidates = [
      payload?.map_events,
      payload?.events,
      payload?.incidents,
      payload?.reports,
      payload?.items,
      payload?.features
    ];

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;

      if (candidate === payload?.features) {
        return candidate
          .map(feature => {
            const coordinates =
              feature?.geometry?.coordinates;

            if (
              !Array.isArray(coordinates) ||
              coordinates.length < 2
            ) {
              return null;
            }

            return {
              ...(feature?.properties || {}),
              longitude: coordinates[0],
              latitude: coordinates[1],
              geometry: feature.geometry
            };
          })
          .filter(
            event =>
              event &&
              validEventCoordinate(event)
          );
      }

      return candidate.filter(validEventCoordinate);
    }

    return [];
  }

  function cacheBust(url) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${Date.now()}`;
  }

  const sharedPayloadPromises = new Map();

  async function fetchJson(url) {
    if (sharedPayloadPromises.has(url)) {
      return sharedPayloadPromises.get(url);
    }

    const promise = fetch(
      cacheBust(url),
      {
        cache: "no-store",
        headers: {
          Accept: "application/json"
        }
      }
    )
      .then(response => {
        if (!response.ok) {
          const error = new Error(
            `HTTP ${response.status}: ${url}`
          );

          error.status = response.status;
          error.url = url;

          throw error;
        }

        return response.json();
      })
      .catch(error => {
        sharedPayloadPromises.delete(url);
        throw error;
      });

    sharedPayloadPromises.set(url, promise);
    return promise;
  }

  async function loadSource(source) {
    const definition = SOURCE_DEFINITIONS[source];

    if (!definition) {
      throw new Error(`Unknown annotation source: ${source}`);
    }

    let lastError = null;

    for (const url of definition.urls) {
      try {
        const payload = await fetchJson(url);
        const events = definition
          .extract(payload)
          .filter(validEventCoordinate);

        state.sourceData.set(source, events);
        state.sourceUrls.set(source, url);
        state.sourceErrors.delete(source);

        return {
          source,
          url,
          eventCount: events.length,
          events,
          available: true
        };
      } catch (error) {
        lastError = error;

        if (
          !definition.required &&
          error?.status === 404
        ) {
          continue;
        }
      }
    }

    state.sourceData.set(source, []);
    state.sourceUrls.delete(source);

    if (
      definition.required ||
      lastError?.status !== 404
    ) {
      state.sourceErrors.set(
        source,
        asText(
          lastError?.message,
          "Source loading failed"
        )
      );
    } else {
      state.sourceErrors.delete(source);
    }

    return {
      source,
      url: "",
      eventCount: 0,
      events: [],
      available: false,
      error: lastError
    };
  }

  function findAnnotationController() {
    const controller =
      window.attackAnnotationController;

    if (
      controller &&
      typeof controller.setEvents === "function" &&
      typeof controller.setSourceEnabled === "function"
    ) {
      return controller;
    }

    return null;
  }

  function mainAnnotationEnabled() {
    return Boolean(
      document.getElementById(
        "attackAnnotationsCheckbox"
      )?.checked
    );
  }

  function sourceCheckbox(source) {
    const definition = SOURCE_DEFINITIONS[source];

    return definition
      ? document.getElementById(
          definition.checkboxId
        )
      : null;
  }

  function readSourceEnabled(source) {
    const checkbox = sourceCheckbox(source);

    if (checkbox) {
      return Boolean(checkbox.checked);
    }

    return Boolean(
      SOURCE_DEFINITIONS[source]
        ?.enabledByDefault
    );
  }

  function readMinimumReliability() {
    return Number(
      document.getElementById(
        "attackAnnotationReliabilitySelect"
      )?.value || 0
    );
  }

  function attachListener(
    element,
    eventName,
    handler
  ) {
    if (!element) return;

    element.addEventListener(
      eventName,
      handler
    );

    state.listeners.push({
      element,
      eventName,
      handler
    });
  }

  function createSourceCheckbox(source) {
    const definition = SOURCE_DEFINITIONS[source];

    const label = document.createElement("label");
    label.className =
      "me-annotation-source-toggle";

    label.style.display = "flex";
    label.style.alignItems = "center";
    label.style.gap = "6px";
    label.style.minWidth = "118px";

    const checkbox =
      document.createElement("input");

    checkbox.type = "checkbox";
    checkbox.id = definition.checkboxId;
    checkbox.checked =
      definition.enabledByDefault;

    const text =
      document.createElement("span");

    text.textContent = definition.label;

    label.appendChild(checkbox);
    label.appendChild(text);

    state.sourceEnabled.set(
      source,
      checkbox.checked
    );

    attachListener(
      checkbox,
      "change",
      () => {
        state.sourceEnabled.set(
          source,
          checkbox.checked
        );

        syncSourceToController(source);
        updateSourceStatusUi();
      }
    );

    return label;
  }

  function injectControllerStyles() {
    if (
      document.getElementById(
        "me-annotation-controller-styles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "me-annotation-controller-styles";

    style.textContent = `
      .me-annotation-controller-section {
        margin-top: 9px;
        padding-top: 9px;
        border-top: 1px solid rgba(255,255,255,.10);
      }

      .me-annotation-source-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px 10px;
        margin-top: 6px;
      }

      .me-annotation-source-toggle {
        color: inherit;
        font-size: 11px;
        line-height: 1.3;
      }

      .me-annotation-controller-label {
        margin: 8px 0 5px;
        color: inherit;
        opacity: .76;
        font-size: 10px;
        font-weight: 750;
      }

      .me-annotation-controller-status {
        display: grid;
        gap: 4px;
        margin-top: 8px;
        padding: 7px 8px;
        border-radius: 8px;
        background: rgba(255,255,255,.055);
        font-size: 9px;
        line-height: 1.35;
      }

      .me-annotation-source-status {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .me-annotation-source-status-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .me-annotation-source-status-value {
        flex: 0 0 auto;
        font-weight: 800;
      }

      .me-annotation-source-status-value.error {
        color: #ff8b8b;
      }

      .me-annotation-source-status-value.missing {
        opacity: .58;
      }

      @media (max-width: 720px) {
        .me-annotation-source-grid {
          grid-template-columns: 1fr;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureUi() {
    if (state.uiReady) {
      return true;
    }

    const block = document.querySelector(
      '[data-control-block="attack-annotations"]'
    );

    if (!block) {
      return false;
    }

    injectControllerStyles();

    state.panelBlock = block;

    const existingSection =
      block.querySelector(
        ".me-annotation-controller-section"
      );

    if (existingSection) {
      state.uiReady = true;
      return true;
    }

    const section =
      document.createElement("div");

    section.className =
      "me-annotation-controller-section";

    const sourceTitle =
      document.createElement("div");

    sourceTitle.className =
      "me-annotation-controller-label";

    sourceTitle.textContent =
      "Additional analysis-card sources";

    const sourceGrid =
      document.createElement("div");

    sourceGrid.className =
      "me-annotation-source-grid";

    Object.keys(SOURCE_DEFINITIONS)
      .forEach(source => {
        sourceGrid.appendChild(
          createSourceCheckbox(source)
        );
      });

    const reliabilityLabel =
      document.createElement("div");

    reliabilityLabel.className =
      "me-annotation-controller-label";

    reliabilityLabel.textContent =
      "Minimum reliability";

    const reliabilitySelect =
      document.createElement("select");

    reliabilitySelect.id =
      "attackAnnotationReliabilitySelect";

    reliabilitySelect.style.width = "100%";

    reliabilitySelect.innerHTML = `
      <option value="0" selected>All reliability levels</option>
      <option value="30">30+ · include social reports</option>
      <option value="50">50+ · moderate and higher</option>
      <option value="70">70+ · stronger OSINT sources</option>
      <option value="85">85+ · highest-reliability sources</option>
    `;

    state.reliabilitySelect =
      reliabilitySelect;

    attachListener(
      reliabilitySelect,
      "change",
      () => {
        const controller =
          findAnnotationController();

        controller?.setMinimumReliability?.(
          readMinimumReliability()
        );

        controller?.refresh?.();
        updateSourceStatusUi();
      }
    );

    const statusHost =
      document.createElement("div");

    statusHost.className =
      "me-annotation-controller-status";

    state.sourceStatusHost =
      statusHost;

    section.appendChild(sourceTitle);
    section.appendChild(sourceGrid);
    section.appendChild(reliabilityLabel);
    section.appendChild(reliabilitySelect);
    section.appendChild(statusHost);

    const visibleCountRow =
      block.querySelector(
        "#attackAnnotationsVisibleCount"
      )?.closest(".risk-row");

    if (visibleCountRow) {
      visibleCountRow.insertAdjacentElement(
        "beforebegin",
        section
      );
    } else {
      block.appendChild(section);
    }

    const mainCheckbox =
      document.getElementById(
        "attackAnnotationsCheckbox"
      );

    attachListener(
      mainCheckbox,
      "change",
      () => {
        window.setTimeout(
          () => {
            connectController();
            syncAllSources();
          },
          80
        );
      }
    );

    const refreshButton =
      document.getElementById(
        "attackAnnotationsRefreshBtn"
      );

    attachListener(
      refreshButton,
      "click",
      () => {
        window.setTimeout(
          () => refresh(),
          100
        );
      }
    );

    state.uiReady = true;
    updateSourceStatusUi();

    return true;
  }

  function sourceStatus(source) {
    const definition =
      SOURCE_DEFINITIONS[source];

    const events =
      state.sourceData.get(source) || [];

    const error =
      state.sourceErrors.get(source);

    const available =
      state.sourceUrls.has(source);

    if (error) {
      return {
        label: definition.label,
        value: "Error",
        className: "error"
      };
    }

    if (!available) {
      return {
        label: definition.label,
        value: definition.required
          ? "Unavailable"
          : "No feed",
        className: "missing"
      };
    }

    return {
      label: definition.label,
      value: `${events.length} events`,
      className: ""
    };
  }

  function updateSourceStatusUi() {
    if (!state.sourceStatusHost) return;

    state.sourceStatusHost.innerHTML =
      Object.keys(SOURCE_DEFINITIONS)
        .map(source => {
          const status =
            sourceStatus(source);

          return `
            <div class="me-annotation-source-status">
              <span class="me-annotation-source-status-name">
                ${escapeHtml(status.label)}
              </span>
              <span class="me-annotation-source-status-value ${status.className}">
                ${escapeHtml(status.value)}
              </span>
            </div>
          `;
        })
        .join("");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function connectController() {
    const controller =
      findAnnotationController();

    if (!controller) {
      state.controller = null;
      return false;
    }

    state.controller = controller;

    controller.setMinimumReliability?.(
      readMinimumReliability()
    );

    return true;
  }

  function syncSourceToController(source) {
    const controller =
      findAnnotationController();

    if (!controller) return false;

    const events =
      state.sourceData.get(source) || [];

    const enabled =
      readSourceEnabled(source);

    controller.setEvents(source, events);
    controller.setSourceEnabled(
      source,
      enabled
    );

    if (mainAnnotationEnabled()) {
      controller.setEnabled(true);
    }

    controller.refresh?.();

    return true;
  }

  function syncAllSources() {
    const controller =
      findAnnotationController();

    if (!controller) {
      return false;
    }

    controller.setMinimumReliability?.(
      readMinimumReliability()
    );

    Object.keys(SOURCE_DEFINITIONS)
      .forEach(source => {
        const events =
          state.sourceData.get(source) || [];

        controller.setEvents(
          source,
          events
        );

        controller.setSourceEnabled(
          source,
          readSourceEnabled(source)
        );
      });

    controller.setEnabled(
      mainAnnotationEnabled()
    );

    controller.refresh?.();
    updateSourceStatusUi();

    return true;
  }

  async function refresh() {
    if (state.refreshing) {
      return getState();
    }

    state.refreshing = true;

    try {
      ensureUi();
      sharedPayloadPromises.clear();

      const results =
        await Promise.all(
          Object.keys(SOURCE_DEFINITIONS)
            .map(source =>
              loadSource(source)
            )
        );

      state.lastRefreshAt =
        new Date().toISOString();

      connectController();
      syncAllSources();
      updateSourceStatusUi();

      console.info(
        "[annotation-controller]",
        {
          lastRefreshAt:
            state.lastRefreshAt,
          sources:
            results.map(result => ({
              source: result.source,
              available: result.available,
              eventCount: result.eventCount,
              url: result.url
            })),
          controllerConnected:
            Boolean(findAnnotationController()),
          reportsClassification: {
            reddit:
              (state.sourceData.get("reddit") || []).length,
            mastodon:
              (state.sourceData.get("mastodon") || []).length,
            crowd:
              (state.sourceData.get("crowd") || []).length
          }
        }
      );

      return getState();
    } finally {
      state.refreshing = false;
    }
  }

  function setSourceEnabled(
    source,
    enabled
  ) {
    if (!SOURCE_DEFINITIONS[source]) {
      return false;
    }

    const checkbox =
      sourceCheckbox(source);

    if (checkbox) {
      checkbox.checked =
        Boolean(enabled);
    }

    state.sourceEnabled.set(
      source,
      Boolean(enabled)
    );

    syncSourceToController(source);
    updateSourceStatusUi();

    return true;
  }

  function setMinimumReliability(score) {
    const normalized =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(
            Number(score) || 0
          )
        )
      );

    if (state.reliabilitySelect) {
      const optionExists =
        Array.from(
          state.reliabilitySelect.options
        ).some(
          option =>
            Number(option.value) ===
            normalized
        );

      if (optionExists) {
        state.reliabilitySelect.value =
          String(normalized);
      }
    }

    const controller =
      findAnnotationController();

    controller?.setMinimumReliability?.(
      normalized
    );

    controller?.refresh?.();

    return normalized;
  }

  function getState() {
    return {
      initialized: state.initialized,
      uiReady: state.uiReady,
      refreshing: state.refreshing,
      controllerConnected: Boolean(
        findAnnotationController()
      ),
      mainEnabled:
        mainAnnotationEnabled(),
      minimumReliability:
        readMinimumReliability(),
      lastRefreshAt:
        state.lastRefreshAt,
      sources:
        Object.keys(SOURCE_DEFINITIONS)
          .map(source => ({
            source,
            label:
              SOURCE_DEFINITIONS[source]
                .label,
            enabled:
              readSourceEnabled(source),
            available:
              state.sourceUrls.has(source),
            dataUrl:
              state.sourceUrls.get(source) ||
              "",
            eventCount:
              (
                state.sourceData.get(source) ||
                []
              ).length,
            error:
              state.sourceErrors.get(source) ||
              ""
          })),
      annotationState:
        findAnnotationController()
          ?.getState?.() ||
        null
    };
  }

  function poll() {
    if (state.destroyed) return;

    ensureUi();

    const connectedBefore =
      Boolean(state.controller);

    const connectedNow =
      connectController();

    if (
      connectedNow &&
      !connectedBefore
    ) {
      syncAllSources();
    }
  }

  function init() {
    if (state.initialized) return;

    state.initialized = true;

    ensureUi();

    state.pollTimer =
      window.setInterval(
        poll,
        750
      );

    state.refreshTimer =
      window.setInterval(
        () => {
          refresh().catch(error => {
            console.warn(
              "[annotation-controller] scheduled refresh failed:",
              error?.message || error
            );
          });
        },
        10 * 60 * 1000
      );

    refresh().catch(error => {
      console.warn(
        "[annotation-controller] initial refresh failed:",
        error?.message || error
      );
    });
  }

  function destroy() {
    if (state.destroyed) return;

    state.destroyed = true;

    if (state.pollTimer) {
      window.clearInterval(
        state.pollTimer
      );
    }

    if (state.refreshTimer) {
      window.clearInterval(
        state.refreshTimer
      );
    }

    state.listeners.forEach(
      ({
        element,
        eventName,
        handler
      }) => {
        element.removeEventListener(
          eventName,
          handler
        );
      }
    );

    state.listeners = [];
  }

  const api = {
    refresh,
    getState,
    setSourceEnabled,
    setMinimumReliability,
    sync: syncAllSources,
    destroy
  };

  window.MEAnnotationController = api;
  window[CONTROLLER_ID] = api;

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }
})();
