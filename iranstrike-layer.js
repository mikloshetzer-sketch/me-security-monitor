(function () {
  "use strict";

  function createIranStrikeLayer(map, options = {}) {
    const config = {
      dataUrl: options.dataUrl || "data/iranstrike.json",
      enabled: Boolean(options.enabled),
      maxVisible: Number(options.maxVisible || 4000),
      defaultDays: Number(options.defaultDays || 30),
      displayMode: options.displayMode || "markers"
    };

    let enabled = config.enabled;
    let payload = null;
    let events = [];
    let visibleEvents = [];
    let displayMode = config.displayMode;
    let filters = {
      days: config.defaultDays,
      categories: [],
      search: "",
      severity: []
    };

    const markerLayer = L.layerGroup();
    let heatLayer = null;

    const CATEGORY_COLORS = {
      airstrike: "#d9342b",
      missile: "#f07623",
      drone: "#8c3fd1",
      explosion: "#d94ca3",
      ground: "#71543a",
      infrastructure: "#2676bd",
      alert: "#e0b800",
      political: "#3a9b63",
      other: "#6f7782"
    };

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function parseDate(value) {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function categoryColor(category) {
      return CATEGORY_COLORS[String(category || "other").toLowerCase()] ||
        CATEGORY_COLORS.other;
    }

    function ageOpacity(event) {
      const date = parseDate(event.date);
      if (!date) return 0.55;

      const ageDays = Math.max(
        0,
        (Date.now() - date.getTime()) / 86400000
      );

      if (ageDays <= 1) return 0.95;
      if (ageDays <= 7) return 0.85;
      if (ageDays <= 30) return 0.7;
      if (ageDays <= 90) return 0.55;
      return 0.38;
    }

    function markerFor(event) {
      const lat = Number(event.latitude);
      const lon = Number(event.longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
      }

      const color = categoryColor(event.category);
      const severity = String(event.severity || "unknown").toLowerCase();

      let radius = 5;
      if (severity === "critical") radius = 8;
      else if (severity === "high") radius = 7;
      else if (severity === "medium") radius = 6;

      const marker = L.circleMarker(
        [lat, lon],
        {
          radius,
          color: "#ffffff",
          weight: 1,
          fillColor: color,
          fillOpacity: ageOpacity(event)
        }
      );

      const sourceLink = event.source_url
        ? `<a href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener">Open source</a>`
        : "";

      marker.bindPopup(`
        <div style="min-width:240px;line-height:1.45;">
          <strong>${escapeHtml(event.title || "IranStrike event")}</strong>
          <div style="margin-top:5px;color:#5a6170;">
            ${escapeHtml(event.date || "Unknown date")}
          </div>
          <div style="margin-top:6px;">
            <b>Category:</b> ${escapeHtml(event.category || "other")}<br />
            <b>Severity:</b> ${escapeHtml(event.severity || "unknown")}<br />
            <b>Location:</b> ${escapeHtml(event.location || event.country || "Unknown")}
          </div>
          ${
            event.description
              ? `<div style="margin-top:7px;">${escapeHtml(event.description)}</div>`
              : ""
          }
          ${
            sourceLink
              ? `<div style="margin-top:8px;">${sourceLink}</div>`
              : ""
          }
          <div style="margin-top:7px;color:#5a6170;font-size:11px;">
            Source: IranStrike
          </div>
        </div>
      `);

      return marker;
    }

    function eventMatches(event) {
      if (filters.days > 0) {
        const date = parseDate(event.date);
        if (!date) return false;

        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - filters.days);

        if (date < cutoff) return false;
      }

      if (
        filters.categories.length &&
        !filters.categories.includes(
          String(event.category || "other").toLowerCase()
        )
      ) {
        return false;
      }

      if (
        filters.severity.length &&
        !filters.severity.includes(
          String(event.severity || "unknown").toLowerCase()
        )
      ) {
        return false;
      }

      const query = String(filters.search || "").trim().toLowerCase();

      if (query) {
        const haystack = [
          event.title,
          event.description,
          event.location,
          event.country,
          event.category,
          event.severity,
          event.source_name
        ].join(" ").toLowerCase();

        if (!haystack.includes(query)) return false;
      }

      return true;
    }

    function removeLayers() {
      if (map.hasLayer(markerLayer)) {
        map.removeLayer(markerLayer);
      }

      if (heatLayer && map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
      }
    }

    function rebuild() {
      markerLayer.clearLayers();

      if (heatLayer && map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
      }

      visibleEvents = events
        .filter(eventMatches)
        .slice(0, config.maxVisible);

      const heatPoints = [];

      for (const event of visibleEvents) {
        const marker = markerFor(event);
        if (marker) markerLayer.addLayer(marker);

        const lat = Number(event.latitude);
        const lon = Number(event.longitude);

        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          let intensity = 0.45;

          const severity = String(event.severity || "").toLowerCase();
          if (severity === "critical") intensity = 1;
          else if (severity === "high") intensity = 0.8;
          else if (severity === "medium") intensity = 0.62;

          heatPoints.push([lat, lon, intensity]);
        }
      }

      if (
        typeof L.heatLayer === "function" &&
        heatPoints.length
      ) {
        heatLayer = L.heatLayer(
          heatPoints,
          {
            radius: 20,
            blur: 14,
            minOpacity: 0.3
          }
        );
      } else {
        heatLayer = null;
      }

      removeLayers();

      if (!enabled) return;

      if (displayMode === "markers" || displayMode === "both") {
        markerLayer.addTo(map);
      }

      if (
        heatLayer &&
        (displayMode === "heatmap" || displayMode === "both")
      ) {
        heatLayer.addTo(map);
      }
    }

    async function refresh() {
      const response = await fetch(
        config.dataUrl,
        { cache: "no-store" }
      );

      if (!response.ok) {
        throw new Error(
          `IranStrike data HTTP ${response.status}`
        );
      }

      payload = await response.json();
      events = Array.isArray(payload.events)
        ? payload.events
        : [];

      rebuild();
      return getState();
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      rebuild();
    }

    function setFilters(nextFilters = {}) {
      filters = {
        ...filters,
        ...nextFilters,
        categories: Array.isArray(nextFilters.categories)
          ? nextFilters.categories.map(
              value => String(value).toLowerCase()
            )
          : filters.categories,
        severity: Array.isArray(nextFilters.severity)
          ? nextFilters.severity.map(
              value => String(value).toLowerCase()
            )
          : filters.severity
      };

      rebuild();
    }

    function setDisplayMode(value) {
      displayMode = ["markers", "heatmap", "both"].includes(value)
        ? value
        : "markers";

      rebuild();
    }

    function getState() {
      return {
        enabled,
        loadedCount: events.length,
        visibleCount: visibleEvents.length,
        generatedAt: payload?.generated_at || "",
        source: payload?.source || null,
        analytics: payload?.analytics || null,
        heatmapAvailable: typeof L.heatLayer === "function",
        displayMode,
        filters: { ...filters }
      };
    }

    return {
      refresh,
      setEnabled,
      setFilters,
      setDisplayMode,
      getState,
      getVisibleEvents: () => [...visibleEvents],
      getPayload: () => payload
    };
  }

  window.createIranStrikeLayer = createIranStrikeLayer;
})();
