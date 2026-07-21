(function () {
  "use strict";

  function createIranStrikeLayer(map, options = {}) {
    const config = {
      dataUrl: options.dataUrl || "data/iranstrike.json",
      enabled: Boolean(options.enabled),
      maxVisible: Number(options.maxVisible || 1800),
      maxHeatPoints: Number(options.maxHeatPoints || 1000),
      defaultDays: Number(options.defaultDays || 30),
      displayMode: options.displayMode || "markers",
      autoFitOnFirstEnable: options.autoFitOnFirstEnable !== false
    };

    let enabled = config.enabled;
    let payload = null;
    let events = [];
    let visibleEvents = [];
    let displayMode = config.displayMode;
    let heatLayer = null;
    let rebuildTimer = null;
    let didAutoFit = false;

    let filters = {
      days: config.defaultDays,
      categories: [],
      severity: [],
      search: ""
    };

    const PANE_NAME = "iranstrike-marker-pane";

    if (!map.getPane(PANE_NAME)) {
      const pane = map.createPane(PANE_NAME);
      pane.style.zIndex = "1000";
      pane.style.pointerEvents = "auto";
    }

    const markerLayer = L.featureGroup();

    const ATTACKER_COLORS = {
      usa: "#2563eb",
      iran: "#16a34a",
      israel: "#dc2626",
      other: "#7c3aed",
      unknown: "#64748b"
    };

    const CATEGORY_COLORS = {
      airstrike: "#d73027",
      strike: "#ef6548",
      missile: "#f46d43",
      drone: "#8e44ad",
      explosion: "#d94ca3",
      ground: "#795548",
      movement: "#00897b",
      defense: "#3949ab",
      infrastructure: "#1976d2",
      alert: "#f9a825",
      political: "#43a047",
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

    function finiteNumber(value) {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function valueAtPath(object, path) {
      let current = object;
      for (const part of path.split(".")) {
        if (!current || typeof current !== "object" || !(part in current)) return null;
        current = current[part];
      }
      return current;
    }

    function isPlaceholderCoordinate(lat, lon) {
      // The source uses 0,0 as a missing-coordinate placeholder.
      return Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001;
    }

    function validWorld(lat, lon) {
      return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180 &&
        !isPlaceholderCoordinate(lat, lon)
      );
    }

    function validRegion(lat, lon) {
      // Broad operational area: Eastern Mediterranean, Middle East and Gulf.
      return validWorld(lat, lon) && lat >= 8 && lat <= 48 && lon >= 15 && lon <= 82;
    }

    function coordinateCandidates(event) {
      const candidates = [];
      const pushPair = (latValue, lonValue, source) => {
        const lat = finiteNumber(latValue);
        const lon = finiteNumber(lonValue);
        if (lat === null || lon === null) return;
        candidates.push({ lat, lon, source });
        candidates.push({ lat: lon, lon: lat, source: `${source}-swapped` });
      };

      pushPair(event?.latitude, event?.longitude, "normalized");

      const raw = event?.raw_source || {};
      const pairs = [
        ["latitude", "longitude"],
        ["lat", "lng"],
        ["lat", "lon"],
        ["location.latitude", "location.longitude"],
        ["location.lat", "location.lng"],
        ["location.lat", "location.lon"],
        ["geo.latitude", "geo.longitude"],
        ["geo.lat", "geo.lng"],
        ["geo.lat", "geo.lon"],
        ["position.latitude", "position.longitude"],
        ["position.lat", "position.lng"],
        ["position.lat", "position.lon"]
      ];

      for (const [latPath, lonPath] of pairs) {
        pushPair(valueAtPath(raw, latPath), valueAtPath(raw, lonPath), `raw:${latPath}/${lonPath}`);
      }

      const arrays = [
        valueAtPath(raw, "coordinates"),
        valueAtPath(raw, "geometry.coordinates"),
        valueAtPath(raw, "location.coordinates"),
        valueAtPath(raw, "position.coordinates")
      ];

      for (const array of arrays) {
        if (!Array.isArray(array) || array.length < 2) continue;
        const first = finiteNumber(array[0]);
        const second = finiteNumber(array[1]);
        if (first === null || second === null) continue;
        candidates.push({ lat: second, lon: first, source: "raw-array-geojson" });
        candidates.push({ lat: first, lon: second, source: "raw-array-latlon" });
      }

      return candidates;
    }

    function getEventLatLng(event) {
      const candidates = coordinateCandidates(event);

      // IranStrike is a regional source. Do not fall back to arbitrary
      // world coordinates because missing positions are often encoded as 0,0.
      return candidates.find((item) => validRegion(item.lat, item.lon)) || null;
    }

    function parseDate(value) {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function categoryColor(category) {
      return (
        CATEGORY_COLORS[String(category || "other").toLowerCase()] ||
        CATEGORY_COLORS.other
      );
    }

    function normalizeAttacker(value) {
      const attacker = String(value || "unknown").trim().toLowerCase();

      if (
        ["usa", "us", "u.s.", "united states", "america", "american"]
          .includes(attacker)
      ) {
        return "usa";
      }

      if (["iran", "iranian", "irgc"].includes(attacker)) {
        return "iran";
      }

      if (["israel", "israeli", "idf", "iaf"].includes(attacker)) {
        return "israel";
      }

      if (attacker && attacker !== "unknown") {
        return "other";
      }

      return "unknown";
    }

    function attackerColor(event) {
      const explicit = String(event?.attacker_color || "").trim();

      if (/^#[0-9a-f]{6}$/i.test(explicit)) {
        return explicit;
      }

      return (
        ATTACKER_COLORS[normalizeAttacker(event?.attacker)] ||
        ATTACKER_COLORS.unknown
      );
    }

    function attackerLabel(event) {
      const explicit = String(event?.attacker_label || "").trim();
      if (explicit) return explicit;

      const attacker = normalizeAttacker(event?.attacker);

      if (attacker === "usa") return "United States";
      if (attacker === "iran") return "Iran";
      if (attacker === "israel") return "Israel";
      if (attacker === "other") return "Other actor";
      return "Unknown actor";
    }

    function markerSize(event) {
      const severity = String(event?.severity || "unknown").toLowerCase();
      let size = map.getZoom() >= 8 ? 16 : 14;
      if (severity === "critical") size += 5;
      else if (severity === "high") size += 3;
      else if (severity === "medium") size += 1;
      return size;
    }

    function eventMatches(event) {
      if (filters.days > 0) {
        const eventDate = parseDate(event?.date);
        if (!eventDate) return false;

        const latestRaw = payload?.analytics?.overview?.latest_event_date;
        const latestDate = parseDate(latestRaw) || new Date();
        const cutoff = new Date(
          latestDate.getTime() -
          filters.days * 24 * 60 * 60 * 1000
        );
        if (eventDate < cutoff || eventDate > latestDate) return false;
      }

      const category = String(event?.category || "other").toLowerCase();
      if (filters.categories.length && !filters.categories.includes(category)) return false;

      const severity = String(event?.severity || "unknown").toLowerCase();
      if (filters.severity.length && !filters.severity.includes(severity)) return false;

      const query = String(filters.search || "").trim().toLowerCase();
      if (query) {
        const haystack = [
          event?.title,
          event?.description,
          event?.location,
          event?.country,
          event?.category,
          event?.severity,
          event?.source_name,
          event?.attacker,
          event?.attacker_label,
          event?.attacker_confidence
        ].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    }

    function markerFor(event, point) {
      const size = markerSize(event);
      const color = attackerColor(event);
      const categoryRing = categoryColor(event?.category);
      const attacker = normalizeAttacker(event?.attacker);
      const attackerName = attackerLabel(event);

      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10.5" fill="#ffffff" stroke="${categoryRing}" stroke-width="1.5"/>
          <circle cx="12" cy="12" r="8.2" fill="${color}" stroke="#ffffff" stroke-width="2.2"/>
          <circle cx="12" cy="12" r="11.3" fill="none" stroke="#111827" stroke-width="1"/>
        </svg>`;

      const icon = L.divIcon({
        className: `iranstrike-marker-icon attacker-${escapeHtml(attacker)}`,
        html: svg,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -(size / 2 + 3)]
      });

      const marker = L.marker([point.lat, point.lon], {
        pane: PANE_NAME,
        icon,
        keyboard: false,
        riseOnHover: true,
        riseOffset: 10000
      });

      const sourceLink = event?.source_url
        ? `<a href="${escapeHtml(event.source_url)}" target="_blank" rel="noopener">Open source</a>`
        : "";

      const confidence = String(
        event?.attacker_confidence || "unknown"
      ).trim();

      const geocodeMethod = String(
        event?.geocode_method || event?.geocode_source || ""
      ).trim();

      marker.bindPopup(`
        <div style="min-width:250px;line-height:1.45;">
          <strong>${escapeHtml(event?.title || "IranStrike event")}</strong>
          <div style="margin-top:5px;color:#5a6170;">
            ${escapeHtml(event?.date || "Unknown date")}
          </div>

          <div style="margin-top:7px;padding:7px 9px;border-left:4px solid ${color};background:${color}14;border-radius:7px;">
            <b>Attacker:</b> ${escapeHtml(attackerName)}<br />
            <b>Confidence:</b> ${escapeHtml(confidence || "unknown")}
          </div>

          <div style="margin-top:7px;">
            <b>Category:</b> ${escapeHtml(event?.category || "other")}<br />
            <b>Severity:</b> ${escapeHtml(event?.severity || "unknown")}<br />
            <b>Location:</b> ${escapeHtml(event?.location || event?.country || "Unknown")}<br />
            <b>Coordinates:</b> ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}
            ${
              geocodeMethod
                ? `<br /><b>Geocode:</b> ${escapeHtml(geocodeMethod)}`
                : ""
            }
          </div>

          ${
            event?.description
              ? `<div style="margin-top:7px;">${escapeHtml(event.description)}</div>`
              : ""
          }

          ${sourceLink ? `<div style="margin-top:8px;">${sourceLink}</div>` : ""}

          <div style="margin-top:7px;color:#5a6170;font-size:11px;">
            Source: IranStrike
          </div>
        </div>`);

      marker.options.attackMetadata = {
        attacker,
        attackerLabel: attackerName,
        attackerColor: color,
        categoryColor: categoryRing,
        eventId: event?.id || "",
        source: "iranstrike"
      };

      return marker;
    }

    function sample(items, limit) {
      if (items.length <= limit) return items;
      const result = [];
      const step = items.length / limit;
      for (let index = 0; index < limit; index += 1) {
        result.push(items[Math.floor(index * step)]);
      }
      return result;
    }

    function clearRenderedLayers() {
      if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
      if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      markerLayer.clearLayers();
      heatLayer = null;
    }

    function zoomToVisible() {
      if (!markerLayer.getLayers().length) return false;
      const bounds = markerLayer.getBounds();
      if (!bounds.isValid()) return false;
      map.fitBounds(bounds.pad(0.12), { maxZoom: 8, animate: false });
      return true;
    }

    function rebuild() {
      clearRenderedLayers();

      const usable = events
        .filter(eventMatches)
        .map((event) => ({ event, point: getEventLatLng(event) }))
        .filter((item) => Boolean(item.point));

      const limited = usable.slice(0, config.maxVisible);
      visibleEvents = limited.map((item) => item.event);

      if (displayMode === "markers" || displayMode === "both") {
        for (const item of limited) {
          markerLayer.addLayer(markerFor(item.event, item.point));
        }
      }

      if (typeof L.heatLayer === "function" && (displayMode === "heatmap" || displayMode === "both")) {
        const points = sample(usable, config.maxHeatPoints).map((item) => [item.point.lat, item.point.lon, 0.08]);
        if (points.length) {
          heatLayer = L.heatLayer(points, {
            radius: 6,
            blur: 5,
            minOpacity: 0.03,
            maxZoom: 10,
            gradient: {
              0.2: "#2c7bb6",
              0.45: "#00a6ca",
              0.65: "#fdae61",
              0.85: "#f46d43",
              1.0: "#d73027"
            }
          });
        }
      }

      if (enabled) {
        if (markerLayer.getLayers().length && (displayMode === "markers" || displayMode === "both")) {
          markerLayer.addTo(map);
        }
        if (heatLayer && (displayMode === "heatmap" || displayMode === "both")) {
          heatLayer.addTo(map);
        }

        if (config.autoFitOnFirstEnable && !didAutoFit && markerLayer.getLayers().length) {
          didAutoFit = zoomToVisible();
        }
      }

      console.info("[iranstrike-layer-v4-attacker]", {
        enabled,
        loaded: events.length,
        filtered: events.filter(eventMatches).length,
        coordinateUsable: usable.length,
        rejectedCoordinates: events.filter(eventMatches).length - usable.length,
        markersOnLayer: markerLayer.getLayers().length,
        markerLayerOnMap: map.hasLayer(markerLayer),
        displayMode,
        mapBounds: map.getBounds().toBBoxString(),
        markerBounds: markerLayer.getLayers().length ? markerLayer.getBounds().toBBoxString() : null
      });
    }

    function scheduleRebuild() {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(rebuild, 120);
    }

    map.on("zoomend", scheduleRebuild);

    async function refresh() {
      const response = await fetch(config.dataUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`IranStrike data HTTP ${response.status}`);
      payload = await response.json();
      events = Array.isArray(payload?.map_events)
        ? payload.map_events
        : Array.isArray(payload?.events)
          ? payload.events.filter(
              (event) => event?.map_visualizable !== false
            )
          : [];
      rebuild();
      return getState();
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      rebuild();
    }

    function setFilters(next = {}) {
      filters = {
        ...filters,
        ...next,
        categories: Array.isArray(next.categories)
          ? next.categories.map((value) => String(value).toLowerCase())
          : filters.categories,
        severity: Array.isArray(next.severity)
          ? next.severity.map((value) => String(value).toLowerCase())
          : filters.severity
      };
      didAutoFit = false;
      rebuild();
    }

    function setDisplayMode(value) {
      displayMode = ["markers", "heatmap", "both"].includes(value) ? value : "markers";
      didAutoFit = false;
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
        totalSourceCount: Array.isArray(payload?.events)
          ? payload.events.length
          : events.length,
        totalMapSourceCount: Array.isArray(payload?.map_events)
          ? payload.map_events.length
          : events.length,
        heatmapAvailable: typeof L.heatLayer === "function",
        displayMode,
        filters: { ...filters },
        markerLayerOnMap: map.hasLayer(markerLayer),
        markerCount: markerLayer.getLayers().length,
        attackerCounts: visibleEvents.reduce((accumulator, event) => {
          const attacker = normalizeAttacker(event?.attacker);
          accumulator[attacker] = (accumulator[attacker] || 0) + 1;
          return accumulator;
        }, {})
      };
    }

    function destroy() {
      window.clearTimeout(rebuildTimer);
      map.off("zoomend", scheduleRebuild);
      clearRenderedLayers();
      events = [];
      visibleEvents = [];
      payload = null;
    }

    return {
      refresh,
      setEnabled,
      setFilters,
      setDisplayMode,
      getState,
      getVisibleEvents: () => [...visibleEvents],
      getPayload: () => payload,
      zoomToVisible,
      destroy
    };
  }

  if (!document.getElementById("iranstrike-v4-style")) {
    const style = document.createElement("style");
    style.id = "iranstrike-v4-style";
    style.textContent = `
      .iranstrike-marker-icon {
        background: transparent !important;
        border: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        transition: transform .16s ease, filter .16s ease;
      }

      .iranstrike-marker-icon:hover {
        transform: scale(1.18);
        filter: drop-shadow(0 3px 5px rgba(15, 23, 42, 0.35));
      }
      .leaflet-pane.leaflet-iranstrike-marker-pane-pane {
        z-index: 1000 !important;
        pointer-events: auto !important;
      }
    `;
    document.head.appendChild(style);
  }

  window.createIranStrikeLayer = createIranStrikeLayer;
})();
