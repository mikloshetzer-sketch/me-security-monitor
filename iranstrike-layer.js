(function () {
  "use strict";

  function createIranStrikeLayer(map, options = {}) {
    const config = {
      dataUrl: options.dataUrl || "data/iranstrike.json",
      enabled: Boolean(options.enabled),
      maxVisible: Number(options.maxVisible || 3500),
      maxHeatPoints: Number(options.maxHeatPoints || 1200),
      defaultDays: Number(options.defaultDays || 30),
      displayMode: options.displayMode || "markers"
    };

    let enabled = config.enabled;
    let payload = null;
    let events = [];
    let visibleEvents = [];
    let displayMode = config.displayMode;
    let filters = { days: config.defaultDays, categories: [], search: "", severity: [] };
    let heatLayer = null;
    let rebuildTimer = null;

    const paneName = "iranstrike-events-pane";
    if (!map.getPane(paneName)) {
      const pane = map.createPane(paneName);
      pane.style.zIndex = "670";
      pane.style.pointerEvents = "auto";
    }

    const markerLayer = L.layerGroup();

    const CATEGORY_COLORS = {
      airstrike: "#d73027", strike: "#ef6548", missile: "#f46d43",
      drone: "#8e44ad", explosion: "#d94ca3", ground: "#795548",
      movement: "#00897b", defense: "#3949ab", infrastructure: "#1976d2",
      alert: "#f9a825", political: "#43a047", other: "#6f7782"
    };

    function escapeHtml(value) {
      return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    }

    function parseDate(value) {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function categoryColor(category) {
      return CATEGORY_COLORS[String(category || "other").toLowerCase()] || CATEGORY_COLORS.other;
    }

    function ageOpacity(event) {
      const date = parseDate(event.date);
      if (!date) return 0.72;
      const ageDays = Math.max(0, (Date.now() - date.getTime()) / 86400000);
      if (ageDays <= 1) return 1;
      if (ageDays <= 7) return 0.92;
      if (ageDays <= 30) return 0.82;
      if (ageDays <= 90) return 0.68;
      return 0.5;
    }

    function eventMatches(event) {
      if (filters.days > 0) {
        const date = parseDate(event.date);
        if (!date) return false;
        const latest = payload?.analytics?.overview?.latest_event_date
          ? new Date(payload.analytics.overview.latest_event_date)
          : new Date();
        const cutoff = new Date(latest);
        cutoff.setUTCDate(cutoff.getUTCDate() - (filters.days - 1));
        if (date < cutoff) return false;
      }
      if (filters.categories.length && !filters.categories.includes(String(event.category || "other").toLowerCase())) return false;
      if (filters.severity.length && !filters.severity.includes(String(event.severity || "unknown").toLowerCase())) return false;
      const query = String(filters.search || "").trim().toLowerCase();
      if (query) {
        const haystack = [event.title,event.description,event.location,event.country,event.category,event.severity,event.source_name].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    }

    function inCurrentBounds(event) {
      const lat = Number(event.latitude), lon = Number(event.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      return map.getBounds().pad(0.08).contains([lat, lon]);
    }

    function markerFor(event) {
      const lat = Number(event.latitude), lon = Number(event.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const severity = String(event.severity || "unknown").toLowerCase();
      const zoom = map.getZoom();
      let radius = zoom >= 9 ? 5.5 : zoom >= 7 ? 4.5 : 3.8;
      if (severity === "critical") radius += 2;
      else if (severity === "high") radius += 1;

      const marker = L.circleMarker([lat,lon], {
        pane: paneName, radius, color: "#111827", weight: 1.4,
        fillColor: categoryColor(event.category), fillOpacity: ageOpacity(event), opacity: 0.95
      });

      const sourceLink = event.source_url
        ? `<a href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener">Open source</a>` : "";
      marker.bindPopup(`<div style="min-width:240px;line-height:1.45;"><strong>${escapeHtml(event.title || "IranStrike event")}</strong><div style="margin-top:5px;color:#5a6170;">${escapeHtml(event.date || "Unknown date")}</div><div style="margin-top:6px;"><b>Category:</b> ${escapeHtml(event.category || "other")}<br><b>Severity:</b> ${escapeHtml(event.severity || "unknown")}<br><b>Location:</b> ${escapeHtml(event.location || event.country || "Unknown")}</div>${event.description ? `<div style="margin-top:7px;">${escapeHtml(event.description)}</div>` : ""}${sourceLink ? `<div style="margin-top:8px;">${sourceLink}</div>` : ""}<div style="margin-top:7px;color:#5a6170;font-size:11px;">Source: IranStrike</div></div>`);
      return marker;
    }

    function removeLayers() {
      if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
      if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    }

    function sampleHeatEvents(items, limit) {
      if (items.length <= limit) return items;
      const step = items.length / limit;
      const output = [];
      for (let i = 0; i < limit; i += 1) output.push(items[Math.floor(i * step)]);
      return output;
    }

    function heatOptions() {
      const zoom = map.getZoom();
      return {
        radius: zoom >= 9 ? 8 : zoom >= 7 ? 7 : 6,
        blur: zoom >= 9 ? 7 : 6,
        minOpacity: 0.05,
        maxZoom: 11,
        gradient: {
          0.15: "#2c7bb6", 0.35: "#00a6ca", 0.55: "#ffff8c",
          0.72: "#fdae61", 0.88: "#f46d43", 1.0: "#d73027"
        }
      };
    }

    function rebuild() {
      markerLayer.clearLayers();
      if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);

      const filtered = events.filter(eventMatches).filter(inCurrentBounds);
      visibleEvents = filtered.slice(0, config.maxVisible);

      if (displayMode === "markers" || displayMode === "both") {
        for (const event of visibleEvents) {
          const marker = markerFor(event);
          if (marker) markerLayer.addLayer(marker);
        }
      }

      const heatEvents = sampleHeatEvents(filtered, config.maxHeatPoints);
      const heatPoints = heatEvents.map(event => {
        const lat = Number(event.latitude), lon = Number(event.longitude);
        const severity = String(event.severity || "unknown").toLowerCase();
        let intensity = 0.18;
        if (severity === "critical") intensity = 0.42;
        else if (severity === "high") intensity = 0.32;
        else if (severity === "medium") intensity = 0.24;
        return [lat, lon, intensity];
      }).filter(point => Number.isFinite(point[0]) && Number.isFinite(point[1]));

      heatLayer = typeof L.heatLayer === "function" && heatPoints.length
        ? L.heatLayer(heatPoints, heatOptions()) : null;

      removeLayers();
      if (!enabled) return;
      if ((displayMode === "markers" || displayMode === "both") && markerLayer.getLayers().length) markerLayer.addTo(map);
      if (heatLayer && (displayMode === "heatmap" || displayMode === "both")) heatLayer.addTo(map);
    }

    function scheduleRebuild() {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(rebuild, 120);
    }

    map.on("moveend zoomend", scheduleRebuild);

    async function refresh() {
      const response = await fetch(config.dataUrl, {cache:"no-store"});
      if (!response.ok) throw new Error(`IranStrike data HTTP ${response.status}`);
      payload = await response.json();
      events = Array.isArray(payload.events) ? payload.events : [];
      rebuild();
      return getState();
    }

    function setEnabled(value) { enabled = Boolean(value); rebuild(); }
    function setFilters(next = {}) {
      filters = {...filters,...next,
        categories:Array.isArray(next.categories)?next.categories.map(v=>String(v).toLowerCase()):filters.categories,
        severity:Array.isArray(next.severity)?next.severity.map(v=>String(v).toLowerCase()):filters.severity};
      rebuild();
    }
    function setDisplayMode(value) { displayMode=["markers","heatmap","both"].includes(value)?value:"markers"; rebuild(); }
    function getState() { return {enabled,loadedCount:events.length,visibleCount:visibleEvents.length,generatedAt:payload?.generated_at||"",source:payload?.source||null,analytics:payload?.analytics||null,heatmapAvailable:typeof L.heatLayer==="function",displayMode,filters:{...filters}}; }

    return {refresh,setEnabled,setFilters,setDisplayMode,getState,getVisibleEvents:()=>[...visibleEvents],getPayload:()=>payload};
  }

  window.createIranStrikeLayer = createIranStrikeLayer;
})();

