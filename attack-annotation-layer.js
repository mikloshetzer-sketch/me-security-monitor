/*
 * ME Security Monitor
 * Shared draggable attack annotation layer for Leaflet maps.
 *
 * File: attack-annotation-layer.js
 *
 * Public API:
 *   const annotations = window.createAttackAnnotationLayer(map, options);
 *
 *   annotations.setEvents("iranstrike", iranStrikeEvents);
 *   annotations.setEvents("cir", cirEvents);
 *   annotations.setEnabled(true);
 *   annotations.setSourceEnabled("iranstrike", true);
 *   annotations.setSourceEnabled("cir", true);
 *   annotations.setLimit(10);
 *   annotations.refresh();
 *
 * Events must contain valid latitude/longitude values.
 * The layer does not move the original event marker. It creates a draggable
 * HTML card and draws a dashed line from the event coordinate to that card.
 */

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const DEFAULT_ATTACKERS = {
    usa: {
      label: "United States",
      color: "#2563eb"
    },
    iran: {
      label: "Iran",
      color: "#16a34a"
    },
    israel: {
      label: "Israel",
      color: "#dc2626"
    },
    other: {
      label: "Other actor",
      color: "#7c3aed"
    },
    unknown: {
      label: "Unknown actor",
      color: "#64748b"
    }
  };

  const DEFAULT_OPTIONS = {
    enabled: false,
    limit: 10,
    maxDescriptionLength: 180,
    cardWidth: 290,
    cardMinHeight: 118,
    initialOffsetX: 52,
    initialOffsetY: -70,
    cascadeX: 18,
    cascadeY: 24,
    lineWeight: 1.7,
    lineDashArray: "6 7",
    lineOpacity: 0.86,
    paneZIndex: 780,
    cardZIndex: 790,
    sourceLabels: {
      iranstrike: "IranStrike",
      cir: "CIR"
    },
    attackerStyles: DEFAULT_ATTACKERS,
    newestFirst: true,
    showCloseButton: true,
    preservePositions: true
  };

  function asText(value, fallback = "") {
    const text = String(value ?? "").trim();
    return text || fallback;
  }

  function asNumber(value) {
    if (value === null || value === undefined || value === "") return null;
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

  function parseDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateValue(value) {
    const parsed = parseDate(value);
    return parsed ? parsed.getTime() : 0;
  }

  function formatDate(value) {
    const parsed = parseDate(value);
    if (!parsed) return asText(value, "Unknown time");

    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC"
    }).format(parsed) + " UTC";
  }

  function truncate(value, maxLength) {
    const text = asText(value);
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function slug(value) {
    return asText(value, "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown";
  }

  function eventId(event, source, index) {
    return asText(
      event?.id ||
      event?.event_id ||
      event?.eventId ||
      event?.uuid,
      `${source}-${dateValue(event?.date || event?.timestamp)}-${index}`
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

  function eventTitle(event) {
    return asText(
      event?.title ||
      event?.headline ||
      event?.event ||
      event?.main_category ||
      event?.category,
      "Security incident"
    );
  }

  function eventDescription(event) {
    return asText(
      event?.description ||
      event?.summary ||
      event?.details ||
      event?.text ||
      event?.violence ||
      event?.sub_category
    );
  }

  function eventLocation(event) {
    return asText(
      event?.location ||
      event?.location_name ||
      event?.location_zone ||
      event?.city ||
      event?.region ||
      event?.country,
      "Unknown location"
    );
  }

  function eventCategory(event) {
    return asText(
      event?.category ||
      event?.main_category ||
      event?.sub_category ||
      event?.type,
      "other"
    );
  }

  function eventDate(event) {
    return (
      event?.date ||
      event?.timestamp ||
      event?.datetime ||
      event?.created_at ||
      event?.published_at ||
      ""
    );
  }

  function normalizeAttacker(event) {
    const explicit = asText(
      event?.attacker ||
      event?.actor ||
      event?.responsible_actor ||
      event?.perpetrator
    ).toLowerCase();

    if (["usa", "us", "u.s.", "united states", "america", "american"].includes(explicit)) {
      return "usa";
    }

    if (["iran", "iranian", "irgc"].includes(explicit)) {
      return "iran";
    }

    if (["israel", "israeli", "idf", "iaf"].includes(explicit)) {
      return "israel";
    }

    if (explicit && explicit !== "unknown") {
      return "other";
    }

    return "unknown";
  }

  function injectStyles() {
    if (document.getElementById("me-attack-annotation-styles")) return;

    const style = document.createElement("style");
    style.id = "me-attack-annotation-styles";
    style.textContent = `
      .me-attack-annotation-root {
        position: absolute;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
      }

      .me-attack-annotation-lines {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }

      .me-attack-annotation-line {
        fill: none;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }

      .me-attack-annotation-anchor {
        vector-effect: non-scaling-stroke;
      }

      .me-attack-annotation-card {
        position: absolute;
        width: var(--me-annotation-card-width, 290px);
        min-height: var(--me-annotation-card-min-height, 118px);
        border: 1px solid rgba(15, 23, 42, 0.16);
        border-left: 5px solid var(--me-attacker-color, #64748b);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.20);
        color: #172033;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
        user-select: none;
        touch-action: none;
        overflow: hidden;
        backdrop-filter: blur(7px);
      }

      .me-attack-annotation-card.is-dragging {
        cursor: grabbing;
        box-shadow: 0 14px 38px rgba(15, 23, 42, 0.28);
      }

      .me-attack-annotation-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 9px 9px 7px 11px;
        background:
          linear-gradient(
            90deg,
            color-mix(in srgb, var(--me-attacker-color, #64748b) 12%, white),
            rgba(255, 255, 255, 0.94)
          );
        cursor: grab;
      }

      .me-attack-annotation-card.is-dragging .me-attack-annotation-header {
        cursor: grabbing;
      }

      .me-attack-annotation-heading {
        min-width: 0;
        flex: 1;
      }

      .me-attack-annotation-title {
        margin: 0;
        font-size: 13px;
        line-height: 1.3;
        font-weight: 750;
        color: #152033;
        overflow-wrap: anywhere;
      }

      .me-attack-annotation-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 5px;
      }

      .me-attack-annotation-chip {
        display: inline-flex;
        align-items: center;
        min-height: 20px;
        padding: 2px 7px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.07);
        color: #475569;
        font-size: 10px;
        line-height: 1.2;
        font-weight: 650;
      }

      .me-attack-annotation-chip.actor {
        background: color-mix(
          in srgb,
          var(--me-attacker-color, #64748b) 14%,
          white
        );
        color: var(--me-attacker-color, #64748b);
      }

      .me-attack-annotation-close {
        display: inline-grid;
        place-items: center;
        flex: 0 0 auto;
        width: 24px;
        height: 24px;
        padding: 0;
        border: 1px solid rgba(15, 23, 42, 0.12);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.82);
        color: #475569;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
      }

      .me-attack-annotation-close:hover {
        background: #ffffff;
        color: #0f172a;
      }

      .me-attack-annotation-body {
        padding: 8px 11px 10px;
      }

      .me-attack-annotation-location {
        margin: 0 0 5px;
        color: #334155;
        font-size: 11px;
        line-height: 1.35;
        font-weight: 700;
      }

      .me-attack-annotation-description {
        margin: 0;
        color: #475569;
        font-size: 11px;
        line-height: 1.42;
        overflow-wrap: anywhere;
      }

      .me-attack-annotation-footer {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 7px;
        color: #64748b;
        font-size: 9px;
        line-height: 1.25;
      }

      @media (max-width: 720px) {
        .me-attack-annotation-card {
          width: min(var(--me-annotation-card-width, 290px), calc(100vw - 28px));
        }
      }
    `;

    document.head.appendChild(style);
  }

  function createAttackAnnotationLayer(map, userOptions = {}) {
    if (!map || typeof map.latLngToContainerPoint !== "function") {
      throw new Error("A valid Leaflet map instance is required.");
    }

    if (typeof window.L === "undefined") {
      throw new Error("Leaflet must be loaded before attack-annotation-layer.js.");
    }

    injectStyles();

    const options = {
      ...DEFAULT_OPTIONS,
      ...userOptions,
      sourceLabels: {
        ...DEFAULT_OPTIONS.sourceLabels,
        ...(userOptions.sourceLabels || {})
      },
      attackerStyles: {
        ...DEFAULT_OPTIONS.attackerStyles,
        ...(userOptions.attackerStyles || {})
      }
    };

    const mapContainer = map.getContainer();
    const computedPosition = window.getComputedStyle(mapContainer).position;

    if (computedPosition === "static") {
      mapContainer.style.position = "relative";
    }

    const root = document.createElement("div");
    root.className = "me-attack-annotation-root";
    root.style.zIndex = String(options.paneZIndex);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("me-attack-annotation-lines");
    svg.setAttribute("aria-hidden", "true");

    const cardHost = document.createElement("div");
    cardHost.className = "me-attack-annotation-card-host";
    cardHost.style.position = "absolute";
    cardHost.style.inset = "0";
    cardHost.style.pointerEvents = "none";
    cardHost.style.zIndex = String(options.cardZIndex);

    root.appendChild(svg);
    root.appendChild(cardHost);
    mapContainer.appendChild(root);

    const state = {
      enabled: Boolean(options.enabled),
      limit: Math.max(1, Number(options.limit) || 10),
      sources: new Map(),
      sourceEnabled: new Map(),
      cards: new Map(),
      positions: new Map(),
      hiddenIds: new Set(),
      destroyed: false
    };

    function sourceLabel(source) {
      return options.sourceLabels[source] || source;
    }

    function attackerStyle(attacker) {
      return (
        options.attackerStyles[attacker] ||
        options.attackerStyles.unknown ||
        DEFAULT_ATTACKERS.unknown
      );
    }

    function normalizeEvent(event, source, index) {
      const latitude = eventLatitude(event);
      const longitude = eventLongitude(event);

      if (!validCoordinate(latitude, longitude)) {
        return null;
      }

      const attacker = normalizeAttacker(event);
      const style = attackerStyle(attacker);
      const id = `${slug(source)}:${eventId(event, source, index)}`;

      return {
        id,
        source,
        sourceLabel: sourceLabel(source),
        raw: event,
        latitude,
        longitude,
        title: eventTitle(event),
        description: eventDescription(event),
        location: eventLocation(event),
        category: eventCategory(event),
        date: eventDate(event),
        dateValue: dateValue(eventDate(event)),
        attacker,
        attackerLabel: asText(event?.attacker_label, style.label),
        attackerColor: asText(event?.attacker_color, style.color),
        attackerConfidence: asText(event?.attacker_confidence, "unknown")
      };
    }

    function allVisibleEvents() {
      const output = [];

      for (const [source, events] of state.sources.entries()) {
        if (state.sourceEnabled.get(source) === false) continue;

        events.forEach((event, index) => {
          const normalized = normalizeEvent(event, source, index);
          if (!normalized) return;
          if (state.hiddenIds.has(normalized.id)) return;
          output.push(normalized);
        });
      }

      output.sort((a, b) => {
        return options.newestFirst
          ? b.dateValue - a.dateValue
          : a.dateValue - b.dateValue;
      });

      return output.slice(0, state.limit);
    }

    function defaultPosition(event, index) {
      const point = map.latLngToContainerPoint([
        event.latitude,
        event.longitude
      ]);

      const cardWidth = Number(options.cardWidth) || 290;
      const cardHeight = Number(options.cardMinHeight) || 118;
      const containerWidth = Math.max(1, mapContainer.clientWidth);
      const containerHeight = Math.max(1, mapContainer.clientHeight);

      const alternatingDirection = index % 2 === 0 ? 1 : -1;
      const column = Math.floor(index / 2) % 4;

      let left =
        point.x +
        alternatingDirection *
          (options.initialOffsetX + column * options.cascadeX);

      if (alternatingDirection < 0) {
        left -= cardWidth;
      }

      let top =
        point.y +
        options.initialOffsetY +
        (index % 5) * options.cascadeY;

      left = Math.min(
        Math.max(8, left),
        Math.max(8, containerWidth - cardWidth - 8)
      );

      top = Math.min(
        Math.max(8, top),
        Math.max(8, containerHeight - cardHeight - 8)
      );

      return { left, top };
    }

    function clampPosition(left, top, card) {
      const width = card.offsetWidth || Number(options.cardWidth) || 290;
      const height =
        card.offsetHeight || Number(options.cardMinHeight) || 118;

      return {
        left: Math.min(
          Math.max(4, left),
          Math.max(4, mapContainer.clientWidth - width - 4)
        ),
        top: Math.min(
          Math.max(4, top),
          Math.max(4, mapContainer.clientHeight - height - 4)
        )
      };
    }

    function createSvgLine(event) {
      const group = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "g"
      );

      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line"
      );
      line.classList.add("me-attack-annotation-line");
      line.setAttribute("stroke", event.attackerColor);
      line.setAttribute("stroke-width", String(options.lineWeight));
      line.setAttribute("stroke-dasharray", options.lineDashArray);
      line.setAttribute("opacity", String(options.lineOpacity));

      const anchor = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle"
      );
      anchor.classList.add("me-attack-annotation-anchor");
      anchor.setAttribute("r", "3.5");
      anchor.setAttribute("fill", event.attackerColor);
      anchor.setAttribute("stroke", "#ffffff");
      anchor.setAttribute("stroke-width", "1.5");

      group.appendChild(line);
      group.appendChild(anchor);
      svg.appendChild(group);

      return { group, line, anchor };
    }

    function cardHtml(event) {
      const description = truncate(
        event.description,
        options.maxDescriptionLength
      );

      const confidenceText =
        event.attackerConfidence &&
        event.attackerConfidence !== "unknown"
          ? ` · ${event.attackerConfidence} confidence`
          : "";

      return `
        <div class="me-attack-annotation-header">
          <div class="me-attack-annotation-heading">
            <h4 class="me-attack-annotation-title">${escapeHtml(event.title)}</h4>
            <div class="me-attack-annotation-meta">
              <span class="me-attack-annotation-chip actor">${escapeHtml(event.attackerLabel)}</span>
              <span class="me-attack-annotation-chip">${escapeHtml(event.category)}</span>
              <span class="me-attack-annotation-chip">${escapeHtml(event.sourceLabel)}</span>
            </div>
          </div>
          ${
            options.showCloseButton
              ? '<button class="me-attack-annotation-close" type="button" title="Hide annotation" aria-label="Hide annotation">×</button>'
              : ""
          }
        </div>
        <div class="me-attack-annotation-body">
          <p class="me-attack-annotation-location">${escapeHtml(event.location)}</p>
          ${
            description
              ? `<p class="me-attack-annotation-description">${escapeHtml(description)}</p>`
              : ""
          }
          <div class="me-attack-annotation-footer">
            <span>${escapeHtml(formatDate(event.date))}</span>
            <span>${escapeHtml(event.attackerLabel + confidenceText)}</span>
          </div>
        </div>
      `;
    }

    function updateConnection(item) {
      if (!item || !item.card.isConnected) return;

      const eventPoint = map.latLngToContainerPoint([
        item.event.latitude,
        item.event.longitude
      ]);

      const cardLeft = parseFloat(item.card.style.left) || 0;
      const cardTop = parseFloat(item.card.style.top) || 0;
      const cardWidth = item.card.offsetWidth || Number(options.cardWidth);
      const cardHeight =
        item.card.offsetHeight || Number(options.cardMinHeight);

      const centerX = cardLeft + cardWidth / 2;
      const centerY = cardTop + cardHeight / 2;

      const deltaX = eventPoint.x - centerX;
      const deltaY = eventPoint.y - centerY;

      let targetX = centerX;
      let targetY = centerY;

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        targetX = deltaX > 0 ? cardLeft + cardWidth : cardLeft;
        targetY = Math.min(
          Math.max(eventPoint.y, cardTop + 10),
          cardTop + cardHeight - 10
        );
      } else {
        targetY = deltaY > 0 ? cardTop + cardHeight : cardTop;
        targetX = Math.min(
          Math.max(eventPoint.x, cardLeft + 10),
          cardLeft + cardWidth - 10
        );
      }

      item.line.setAttribute("x1", String(eventPoint.x));
      item.line.setAttribute("y1", String(eventPoint.y));
      item.line.setAttribute("x2", String(targetX));
      item.line.setAttribute("y2", String(targetY));

      item.anchor.setAttribute("cx", String(eventPoint.x));
      item.anchor.setAttribute("cy", String(eventPoint.y));
    }

    function updateAllConnections() {
      if (!state.enabled || state.destroyed) return;

      const width = Math.max(1, mapContainer.clientWidth);
      const height = Math.max(1, mapContainer.clientHeight);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));

      for (const item of state.cards.values()) {
        updateConnection(item);
      }
    }

    function enableDragging(item) {
      const handle = item.card.querySelector(
        ".me-attack-annotation-header"
      );

      if (!handle) return;

      let active = false;
      let pointerId = null;
      let startClientX = 0;
      let startClientY = 0;
      let startLeft = 0;
      let startTop = 0;

      function onPointerDown(event) {
        if (
          event.target.closest(".me-attack-annotation-close")
        ) {
          return;
        }

        active = true;
        pointerId = event.pointerId;
        startClientX = event.clientX;
        startClientY = event.clientY;
        startLeft = parseFloat(item.card.style.left) || 0;
        startTop = parseFloat(item.card.style.top) || 0;

        item.card.classList.add("is-dragging");
        handle.setPointerCapture?.(pointerId);
        event.preventDefault();
        event.stopPropagation();
      }

      function onPointerMove(event) {
        if (!active || event.pointerId !== pointerId) return;

        const next = clampPosition(
          startLeft + event.clientX - startClientX,
          startTop + event.clientY - startClientY,
          item.card
        );

        item.card.style.left = `${next.left}px`;
        item.card.style.top = `${next.top}px`;

        if (options.preservePositions) {
          state.positions.set(item.event.id, next);
        }

        updateConnection(item);
        event.preventDefault();
        event.stopPropagation();
      }

      function finishDrag(event) {
        if (!active || event.pointerId !== pointerId) return;

        active = false;
        item.card.classList.remove("is-dragging");

        try {
          handle.releasePointerCapture?.(pointerId);
        } catch (_) {
          // Pointer capture may already have been released.
        }

        pointerId = null;
        event.preventDefault();
        event.stopPropagation();
      }

      handle.addEventListener("pointerdown", onPointerDown);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", finishDrag);
      handle.addEventListener("pointercancel", finishDrag);

      item.cleanupDrag = function () {
        handle.removeEventListener("pointerdown", onPointerDown);
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", finishDrag);
        handle.removeEventListener("pointercancel", finishDrag);
      };
    }

    function removeCard(id, hidePermanently = false) {
      const item = state.cards.get(id);
      if (!item) return;

      item.cleanupDrag?.();
      item.card.remove();
      item.lineGroup.remove();
      state.cards.delete(id);

      if (hidePermanently) {
        state.hiddenIds.add(id);
      }
    }

    function clearCards(keepPositions = true) {
      for (const id of [...state.cards.keys()]) {
        removeCard(id, false);
      }

      if (!keepPositions) {
        state.positions.clear();
      }
    }

    function createCard(event, index) {
      const card = document.createElement("article");
      card.className =
        `me-attack-annotation-card source-${slug(event.source)} ` +
        `attacker-${slug(event.attacker)}`;
      card.dataset.annotationId = event.id;
      card.dataset.source = event.source;
      card.dataset.attacker = event.attacker;
      card.style.setProperty(
        "--me-attacker-color",
        event.attackerColor
      );
      card.style.setProperty(
        "--me-annotation-card-width",
        `${Number(options.cardWidth) || 290}px`
      );
      card.style.setProperty(
        "--me-annotation-card-min-height",
        `${Number(options.cardMinHeight) || 118}px`
      );
      card.innerHTML = cardHtml(event);

      const storedPosition = state.positions.get(event.id);
      const initialPosition =
        storedPosition || defaultPosition(event, index);

      card.style.left = `${initialPosition.left}px`;
      card.style.top = `${initialPosition.top}px`;

      cardHost.appendChild(card);

      const clamped = clampPosition(
        initialPosition.left,
        initialPosition.top,
        card
      );
      card.style.left = `${clamped.left}px`;
      card.style.top = `${clamped.top}px`;

      if (options.preservePositions) {
        state.positions.set(event.id, clamped);
      }

      const svgParts = createSvgLine(event);

      const item = {
        event,
        card,
        lineGroup: svgParts.group,
        line: svgParts.line,
        anchor: svgParts.anchor,
        cleanupDrag: null
      };

      state.cards.set(event.id, item);
      enableDragging(item);

      const closeButton = card.querySelector(
        ".me-attack-annotation-close"
      );

      closeButton?.addEventListener("click", function (clickEvent) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        removeCard(event.id, true);
      });

      updateConnection(item);
    }

    function render() {
      if (state.destroyed) return;

      root.style.display = state.enabled ? "block" : "none";

      if (!state.enabled) {
        clearCards(true);
        return;
      }

      const visibleEvents = allVisibleEvents();
      const visibleIds = new Set(
        visibleEvents.map((event) => event.id)
      );

      for (const id of [...state.cards.keys()]) {
        if (!visibleIds.has(id)) {
          removeCard(id, false);
        }
      }

      visibleEvents.forEach((event, index) => {
        const existing = state.cards.get(event.id);

        if (existing) {
          existing.event = event;
          existing.card.style.setProperty(
            "--me-attacker-color",
            event.attackerColor
          );
          existing.line.setAttribute(
            "stroke",
            event.attackerColor
          );
          existing.anchor.setAttribute(
            "fill",
            event.attackerColor
          );
          updateConnection(existing);
          return;
        }

        createCard(event, index);
      });

      window.requestAnimationFrame(updateAllConnections);
    }

    function setEvents(source, events) {
      const normalizedSource = slug(source);

      state.sources.set(
        normalizedSource,
        Array.isArray(events) ? events.slice() : []
      );

      if (!state.sourceEnabled.has(normalizedSource)) {
        state.sourceEnabled.set(normalizedSource, true);
      }

      render();
      return api;
    }

    function appendEvents(source, events) {
      const normalizedSource = slug(source);
      const current = state.sources.get(normalizedSource) || [];
      const additions = Array.isArray(events) ? events : [];

      state.sources.set(
        normalizedSource,
        current.concat(additions)
      );

      if (!state.sourceEnabled.has(normalizedSource)) {
        state.sourceEnabled.set(normalizedSource, true);
      }

      render();
      return api;
    }

    function setEnabled(enabled) {
      state.enabled = Boolean(enabled);
      render();
      return api;
    }

    function setSourceEnabled(source, enabled) {
      state.sourceEnabled.set(slug(source), Boolean(enabled));
      render();
      return api;
    }

    function setLimit(limit) {
      const parsed = Math.floor(Number(limit));
      state.limit = Number.isFinite(parsed)
        ? Math.max(1, parsed)
        : state.limit;
      render();
      return api;
    }

    function restoreHidden() {
      state.hiddenIds.clear();
      render();
      return api;
    }

    function resetPositions() {
      state.positions.clear();
      clearCards(false);
      render();
      return api;
    }

    function clearSource(source) {
      const normalizedSource = slug(source);
      state.sources.delete(normalizedSource);
      state.sourceEnabled.delete(normalizedSource);

      for (const [id, item] of state.cards.entries()) {
        if (item.event.source === normalizedSource) {
          removeCard(id, false);
        }
      }

      render();
      return api;
    }

    function getState() {
      return {
        enabled: state.enabled,
        limit: state.limit,
        renderedCount: state.cards.size,
        hiddenCount: state.hiddenIds.size,
        sources: [...state.sources.entries()].map(
          ([source, events]) => ({
            source,
            enabled: state.sourceEnabled.get(source) !== false,
            eventCount: events.length
          })
        )
      };
    }

    function destroy() {
      if (state.destroyed) return;

      state.destroyed = true;
      map.off("move zoom resize viewreset", updateAllConnections);
      window.removeEventListener("resize", updateAllConnections);
      clearCards(false);
      root.remove();
      state.sources.clear();
      state.sourceEnabled.clear();
      state.hiddenIds.clear();
    }

    map.on(
      "move zoom resize viewreset",
      updateAllConnections
    );
    window.addEventListener("resize", updateAllConnections);

    const api = {
      setEvents,
      appendEvents,
      setEnabled,
      setSourceEnabled,
      setLimit,
      restoreHidden,
      resetPositions,
      clearSource,
      clear: function () {
        state.sources.clear();
        state.hiddenIds.clear();
        clearCards(false);
        return api;
      },
      refresh: function () {
        render();
        return api;
      },
      getState,
      destroy
    };

    render();
    return api;
  }

  window.createAttackAnnotationLayer =
    createAttackAnnotationLayer;
})();
