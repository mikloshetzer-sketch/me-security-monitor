(function () {
  "use strict";

  function createIranStrikeLayer(map, options = {}) {
    const config = {
      dataUrl: options.dataUrl || "data/iranstrike.json",
      enabled: Boolean(options.enabled),
      maxVisible: Number(options.maxVisible || 1800),
      maxHeatPoints: Number(options.maxHeatPoints || 1200),
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

    let heatLayer = null;
    let rebuildTimer = null;

    const IRANSTRIKE_PANE = "iranstrike-canvas-pane";

    if (!map.getPane(IRANSTRIKE_PANE)) {
      const pane = map.createPane(IRANSTRIKE_PANE);
      pane.style.zIndex = "760";
      pane.style.pointerEvents = "auto";
    }

    const iranStrikeRenderer = L.canvas({
      pane: IRANSTRIKE_PANE,
      padding: 0.75,
      tolerance: 8
    });

    const markerLayer = L.layerGroup();

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

    function parseDate(value) {
      if (!value) return null;

      const date = new Date(value);

      return Number.isNaN(date.getTime())
        ? null
        : date;
    }

    function finiteNumber(value) {
      if (value === null || value === undefined || value === "") {
        return null;
      }

      const parsed = Number(value);

      return Number.isFinite(parsed)
        ? parsed
        : null;
    }

    function valueAtPath(object, path) {
      let current = object;

      for (const part of path.split(".")) {
        if (
          current === null ||
          current === undefined ||
          typeof current !== "object" ||
          !(part in current)
        ) {
          return null;
        }

        current = current[part];
      }

      return current;
    }

    function isWorldCoordinate(lat, lon) {
      return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
      );
    }

    function isMiddleEastCoordinate(lat, lon) {
      return (
        isWorldCoordinate(lat, lon) &&
        lat >= 10 &&
        lat <= 45 &&
        lon >= 20 &&
        lon <= 75
      );
    }

    function coordinateCandidates(event) {
      const candidates = [];

      const directLat = finiteNumber(event.latitude);
      const directLon = finiteNumber(event.longitude);

      if (directLat !== null && directLon !== null) {
        candidates.push({
          lat: directLat,
          lon: directLon,
          source: "normalized"
        });

        candidates.push({
          lat: directLon,
          lon: directLat,
          source: "normalized-swapped"
        });
      }

      const raw = event.raw_source || {};

      const pathPairs = [
        ["latitude", "longitude"],
        ["lat", "lng"],
        ["lat", "lon"],
        ["location.latitude", "location.longitude"],
        ["location.lat", "location.lng"],
        ["location.lat", "location.lon"],
        ["coordinates.latitude", "coordinates.longitude"],
        ["coordinates.lat", "coordinates.lng"],
        ["coordinates.lat", "coordinates.lon"],
        ["geo.latitude", "geo.longitude"],
        ["geo.lat", "geo.lng"],
        ["geo.lat", "geo.lon"],
        ["position.latitude", "position.longitude"],
        ["position.lat", "position.lng"],
        ["position.lat", "position.lon"]
      ];

      for (const [latPath, lonPath] of pathPairs) {
        const lat = finiteNumber(valueAtPath(raw, latPath));
        const lon = finiteNumber(valueAtPath(raw, lonPath));

        if (lat === null || lon === null) {
          continue;
        }

        candidates.push({
          lat,
          lon,
          source: `raw:${latPath}/${lonPath}`
        });

        candidates.push({
          lat: lon,
          lon: lat,
          source: `raw-swapped:${latPath}/${lonPath}`
        });
      }

      const arrays = [
        valueAtPath(raw, "coordinates"),
        valueAtPath(raw, "geometry.coordinates"),
        valueAtPath(raw, "location.coordinates"),
        valueAtPath(raw, "position.coordinates")
      ];

      for (const coordinates of arrays) {
        if (
          !Array.isArray(coordinates) ||
          coordinates.length < 2
        ) {
          continue;
        }

        const first = finiteNumber(coordinates[0]);
        const second = finiteNumber(coordinates[1]);

        if (first === null || second === null) {
          continue;
        }

        // GeoJSON order: [longitude, latitude].
        candidates.push({
          lat: second,
          lon: first,
          source: "raw-array-geojson"
        });

        candidates.push({
          lat: first,
          lon: second,
          source: "raw-array-latlon"
        });
      }

      return candidates;
    }

    function getEventLatLng(event) {
      const candidates = coordinateCandidates(event);

      const regional = candidates.find(candidate =>
        isMiddleEastCoordinate(candidate.lat, candidate.lon)
      );

      if (regional) {
        return regional;
      }

      const world = candidates.find(candidate =>
        isWorldCoordinate(candidate.lat, candidate.lon)
      );

      return world || null;
    }

    function categoryColor(category) {
      return (
        CATEGORY_COLORS[
          String(category || "other").toLowerCase()
        ] ||
        CATEGORY_COLORS.other
      );
    }

    function ageOpacity(event) {
      const date = parseDate(event.date);

      if (!date) return 0.72;

      const ageDays = Math.max(
        0,
        (Date.now() - date.getTime()) / 86400000
      );

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

        cutoff.setUTCDate(
          cutoff.getUTCDate() - (filters.days - 1)
        );

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

      const query = String(filters.search || "")
        .trim()
        .toLowerCase();

      if (query) {
        const haystack = [
          event.title,
          event.description,
          event.location,
          event.country,
          event.category,
          event.severity,
          event.source_name
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(query)) {
          return false;
        }
      }

      return true;
    }

    function markerFor(event) {
      const point = getEventLatLng(event);

      if (!point) return null;

      c    function markerFor(event) {
      const point = getEventLatLng(event);

      if (!point) return null;

      const severity = String(
        event.severity || "unknown"
      ).toLowerCase();

      const category = String(
        event.category || "other"
      ).toLowerCase();

      const color = categoryColor(category);
      const zoom = map.getZoom();

      let radius =
        zoom >= 9
          ? 7
          : zoom >= 7
            ? 6
            : 5;

      if (severity === "critical") {
        radius += 3;
      } else if (severity === "high") {
        radius += 2;
      } else if (severity === "medium") {
        radius += 1;
      }

      const marker = L.circleMarker(
        [point.lat, point.lon],
        {
          pane: IRANSTRIKE_PANE,
          renderer: iranStrikeRenderer,
          radius,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillColor: color,
          fillOpacity: Math.max(0.82, ageOpacity(event)),
          interactive: true,
          bubblingMouseEvents: false
        }
      );

      marker.on("mouseover", function () {
        this.setStyle({
          weight: 3,
          color: "#111827",
          fillOpacity: 1
        });
      });

      marker.on("mouseout", function () {
        this.setStyle({
          weight: 2,
          color: "#ffffff",
          fillOpacity: Math.max(0.82, ageOpacity(event))
        });
      });

      const sourceLink = event.source_url
        ? `
          <a
            href="${escapeHtml(event.source_url)}"
            target="_blank"
            rel="noopener"
          >
            Open source
          </a>
        `
        : "";

      marker.bindPopup(`
        <div style="min-width:240px;line-height:1.45;">
          <strong>
            ${escapeHtml(event.title || "IranStrike event")}
          </strong>

          <div style="margin-top:5px;color:#5a6170;">
            ${escapeHtml(event.date || "Unknown date")}
          </div>

          <div style="margin-top:6px;">
            <b>Category:</b>
            ${escapeHtml(event.category || "other")}<br />

            <b>Severity:</b>
            ${escapeHtml(event.severity || "unknown")}<br />

            <b>Location:</b>
            ${escapeHtml(
              event.location ||
              event.country ||
              "Unknown"
            )}<br />

            <b>Coordinate source:</b>
            ${escapeHtml(point.source)}
          </div>

          ${
            event.description
              ? `
                <div style="margin-top:7px;">
                  ${escapeHtml(event.description)}
                </div>
              `
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


      if (heatLayer && map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
      }
    }

    function sampleItems(items, limit) {
      if (items.length <= limit) return items;

      const step = items.length / limit;
      const output = [];

      for (let index = 0; index < limit; index += 1) {
        output.push(
          items[Math.floor(index * step)]
        );
      }

      return output;
    }

    function heatOptions() {
      const zoom = map.getZoom();

      return {
        radius:
          zoom >= 9
            ? 7
            : zoom >= 7
              ? 6
              : 5,
        blur:
          zoom >= 9
            ? 6
            : 5,
        minOpacity: 0.025,
        maxZoom: 11,
        gradient: {
          0.15: "#2c7bb6",
          0.35: "#00a6ca",
          0.55: "#ffff8c",
          0.72: "#fdae61",
          0.88: "#f46d43",
          1.0: "#d73027"
        }
      };
    }

    function rebuild() {
      markerLayer.clearLayers();

      if (heatLayer && map.hasLayer(heatLayer)) {
        map.removeLayer(heatLayer);
      }

      const filtered = events
        .filter(eventMatches)
        .map(event => ({
          event,
          point: getEventLatLng(event)
        }))
        .filter(item => Boolean(item.point));

      // Visible means usable for map rendering, not only inside the
      // current viewport. The previous viewport filter caused 0 events.
      visibleEvents = filtered
        .slice(0, config.maxVisible)
        .map(item => item.event);

      if (
        displayMode === "markers" ||
        displayMode === "both"
      ) {
        for (const item of filtered.slice(0, config.maxVisible)) {
          const marker = markerFor(item.event);

          if (marker) {
            markerLayer.addLayer(marker);
          }
        }
      }

      const viewportBounds = map
        .getBounds()
        .pad(0.15);

      let heatItems = filtered.filter(item =>
        viewportBounds.contains([
          item.point.lat,
          item.point.lon
        ])
      );

      // If no point falls inside the viewport, use the complete filtered
      // set rather than producing a blank or invalid heat layer.
      if (!heatItems.length) {
        heatItems = filtered;
      }

      heatItems = sampleItems(
        heatItems,
        config.maxHeatPoints
      );

      const heatPoints = heatItems.map(item => {
        const severity = String(
          item.event.severity || "unknown"
        ).toLowerCase();

        let intensity = 0.08;

        if (severity === "critical") {
          intensity = 0.22;
        } else if (severity === "high") {
          intensity = 0.17;
        } else if (severity === "medium") {
          intensity = 0.12;
        }

        return [
          item.point.lat,
          item.point.lon,
          intensity
        ];
      });

      heatLayer =
        typeof L.heatLayer === "function" &&
        heatPoints.length
          ? L.heatLayer(
              heatPoints,
              heatOptions()
            )
          : null;

      removeLayers();

      if (!enabled) return;

      if (
        (
          displayMode === "markers" ||
          displayMode === "both"
        ) &&
        markerLayer.getLayers().length
      ) {
        markerLayer.addTo(map);
      }

      if (
        heatLayer &&
        (
          displayMode === "heatmap" ||
          displayMode === "both"
        )
      ) {
        heatLayer.addTo(map);
      }

      console.info(
        "[iranstrike-layer]",
        {
          loaded: events.length,
          dateAndCategoryFiltered: events.filter(eventMatches).length,
          coordinateUsable: filtered.length,
          markersRendered: markerLayer.getLayers().length,
          heatPoints: heatPoints.length,
          displayMode
        }
      );
    }

    function scheduleRebuild() {
      window.clearTimeout(rebuildTimer);

      rebuildTimer = window.setTimeout(
        rebuild,
        120
      );
    }

    map.on(
      "moveend zoomend",
      scheduleRebuild
    );

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

    function setFilters(next = {}) {
      filters = {
        ...filters,
        ...next,
        categories: Array.isArray(next.categories)
          ? next.categories.map(value =>
              String(value).toLowerCase()
            )
          : filters.categories,
        severity: Array.isArray(next.severity)
          ? next.severity.map(value =>
              String(value).toLowerCase()
            )
          : filters.severity
      };

      rebuild();
    }

    function setDisplayMode(value) {
      displayMode = [
        "markers",
        "heatmap",
        "both"
      ].includes(value)
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
        heatmapAvailable:
          typeof L.heatLayer === "function",
        displayMode,
        filters: { ...filters }
      };
    }

    function addDiagnosticMarker() {
      const center = map.getCenter();
      const marker = L.circleMarker(center, {
        pane: IRANSTRIKE_PANE,
        renderer: iranStrikeRenderer,
        radius: 12,
        color: "#ffffff",
        weight: 3,
        fillColor: "#ff00ff",
        fillOpacity: 1
      }).bindPopup("IranStrike diagnostic marker");

      marker.addTo(map);
      return marker;
    }

    return {
      refresh,
      setEnabled,
      setFilters,
      setDisplayMode,
      getState,
      getVisibleEvents: () => [...visibleEvents],
      getPayload: () => payload,
      addDiagnosticMarker
    };
  }

  window.createIranStrikeLayer = createIranStrikeLayer;
})();
