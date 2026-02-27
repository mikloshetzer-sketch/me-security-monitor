import { createAircraftLayer } from "./js/aircraft-layer.js";
window.addEventListener("DOMContentLoaded", () => {
  try {
    const $ = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing element: #${id}`);
      return el;
    };
    const norm = (s) => String(s || "").trim().toLowerCase();

    // ===== Panels + toggles (start closed) =====
    const controlPanel = $("controlPanel");
    const timelinePanel = $("timelinePanel");
    const legendPanel = $("legendPanel");

    const controlToggle = $("controlToggle");
    const timelineToggle = $("timelineToggle");
    const legendToggle = $("legendToggle");

    function togglePanel(panelEl) {
      const isClosed = panelEl.classList.contains("closed");
      panelEl.classList.toggle("closed");
      panelEl.style.display = isClosed ? "block" : "none";
    }

    [controlPanel, timelinePanel, legendPanel].forEach((p) => {
      p.classList.add("closed");
      p.style.display = "none";
    });

    controlToggle.addEventListener("click", () => togglePanel(controlPanel));
    timelineToggle.addEventListener("click", () => togglePanel(timelinePanel));
    legendToggle.addEventListener("click", () => togglePanel(legendPanel));

    // ===== Accordion =====
    function setArrow(btn, isOpen) {
      const arrow = btn.querySelector(".acc-arrow");
      if (arrow) arrow.style.transform = isOpen ? "rotate(90deg)" : "rotate(0deg)";
      btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
    document.querySelectorAll(".acc-btn").forEach((btn) => {
      const targetId = btn.getAttribute("data-acc");
      const panel = document.getElementById(targetId);
      if (!panel) return;
      setArrow(btn, !panel.classList.contains("closed"));
      btn.addEventListener("click", () => {
        const wasClosed = panel.classList.contains("closed");
        panel.classList.toggle("closed");
        setArrow(btn, wasClosed);
        if (wasClosed) setTimeout(() => updateAll(), 80);
      });
    });

    // ===== Map =====
    const map = L.map("map").setView([33.5, 44.0], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    const clusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 10,
    });
    map.addLayer(clusterGroup);
    
// =========================
    // ===== Aircraft layer =====
    // =========================
    const aircraft = createAircraftLayer(map, {
      updateIntervalMs: 15000,
      trackSeconds: 300,   // 5 perc track
      militaryOnly: true,  // induljon military-szűrve
      showTracks: true
    });

    let aircraftEnabled = true; // alapból ON
    let aircraftRunning = false;

    function setAircraftEnabled(on) {
      aircraftEnabled = !!on;

      if (aircraftEnabled) {
        if (!map.hasLayer(aircraft.tracksLayer)) aircraft.tracksLayer.addTo(map);
        if (!map.hasLayer(aircraft.aircraftLayer)) aircraft.aircraftLayer.addTo(map);

        if (!aircraftRunning) {
          aircraft.start();
          aircraftRunning = true;
        }
      } else {
        if (map.hasLayer(aircraft.tracksLayer)) map.removeLayer(aircraft.tracksLayer);
        if (map.hasLayer(aircraft.aircraftLayer)) map.removeLayer(aircraft.aircraftLayer);

        if (aircraftRunning) {
          aircraft.stop();
          aircraftRunning = false;
        }
      }
    }

    // ---- UI (HTML módosítás nélkül): betesszük a Control panelbe ----
    // A "bordersCheckbox" és társai később jönnek, ezért itt csak előkészítünk egy helyet.
    // (A DOM már kész, Control panel létezik)
    const aircraftUiWrap = document.createElement("div");
    aircraftUiWrap.style.marginTop = "12px";
    aircraftUiWrap.style.paddingTop = "10px";
    aircraftUiWrap.style.borderTop = "1px solid rgba(255,255,255,.10)";
    aircraftUiWrap.innerHTML = `
      <div class="muted" style="margin-bottom:6px;">Aircraft (OpenSky)</div>

      <div class="row">
        <label><input id="aircraftCheckbox" type="checkbox" checked /> Aircraft</label>
      </div>

      <div class="row">
        <label><input id="aircraftMilitaryOnlyCheckbox" type="checkbox" checked /> Military only</label>
        <label><input id="aircraftTracksCheckbox" type="checkbox" checked /> Tracks</label>
      </div>

      <div class="muted" style="margin-top:6px;">
        Tip: a “Military only” heurisztika (callsign/squawk) — nem 100%.
      </div>
    `;

    // Control panel aljára tesszük
    controlPanel.appendChild(aircraftUiWrap);

    const aircraftCheckbox = document.getElementById("aircraftCheckbox");
    const aircraftMilitaryOnlyCheckbox = document.getElementById("aircraftMilitaryOnlyCheckbox");
    const aircraftTracksCheckbox = document.getElementById("aircraftTracksCheckbox");

    aircraftCheckbox.addEventListener("change", (e) => {
      setAircraftEnabled(e.target.checked);
    });

    aircraftMilitaryOnlyCheckbox.addEventListener("change", (e) => {
      aircraft.setMilitaryOnly(e.target.checked);
    });

    aircraftTracksCheckbox.addEventListener("change", (e) => {
      aircraft.setShowTracks(e.target.checked);
      // ha tracks OFF, akkor a layer ott van, csak üres; ez oké
    });

    // Indítás (alapból ON)
    setAircraftEnabled(true);
    
    // ===== UI refs =====
    const heatCheckbox = $("heatmapCheckbox");
    const weeklyHeatCheckbox = $("weeklyHeatCheckbox");
    const bordersCheckbox = $("bordersCheckbox");
    const clearHotspotBtn = $("clearHotspotBtn");
    const hotspotListEl = $("hotspotList");

    const regionSelect = $("regionSelect");
    const regionClear = $("regionClear");
    const regionNote = $("regionNote");

    const borderWeightSlider = $("borderWeightSlider");
    const borderOpacitySlider = $("borderOpacitySlider");
    const borderFillCheckbox = $("borderFillCheckbox");
    const borderFillOpacitySlider = $("borderFillOpacitySlider");

    const borderWeightLabel = $("borderWeightLabel");
    const borderOpacityLabel = $("borderOpacityLabel");
    const borderFillOpacityLabel = $("borderFillOpacityLabel");

    const slider = $("timelineSlider");
    const label = $("selectedDateLabel");
    const searchInput = $("eventSearch");
    const eventsListEl = $("eventsList");

    const statsTotalEl = $("statsTotal");
    const statsMilEl = $("statsMil");
    const statsSecEl = $("statsSec");
    const statsPolEl = $("statsPol");
    const statsOthEl = $("statsOth");
    const statsNewsEl = $("statsNews");
    const statsIswEl = $("statsIsw");

    const riskTotalEl = $("riskTotal");
    const riskListEl = $("riskList");

    const actorsListEl = $("actorsList");
    const actorActiveEl = $("actorActive");
    const actorClearBtn = $("actorClear");

    const pairsListEl = $("pairsList");
    const pairActiveEl = $("pairActive");
    const pairClearBtn = $("pairClear");

    const trendCanvas = $("trendCanvas");
    const trendTotalEl = $("trendTotal");
    const trendRangeEl = $("trendRange");

    const spikeBadge = $("spikeBadge");
    const spikeText = $("spikeText");
    const spikeDetails = $("spikeDetails");

    const countryRiskNote = $("countryRiskNote");
    const countryRiskList = $("countryRiskList");

    const escNote = $("escNote");
    const escalationList = $("escalationList");

    const catCheckboxes = [...document.querySelectorAll(".cat-filter")];
    const srcCheckboxes = [...document.querySelectorAll(".src-filter")];
    const windowRadios = [...document.querySelectorAll("input[name='window']")];

    // ===== Date utilities =====
    function makeLast365Days() {
      const days = [];
      const today = new Date();
      for (let i = 364; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }
      return days;
    }
    const days365 = makeLast365Days();
    const dateToIndex = new Map(days365.map((d, i) => [d, i]));
    slider.max = days365.length - 1;
    slider.value = days365.length - 1;

    function getWindowDays() {
      const r = windowRadios.find((x) => x.checked);
      return Number(r?.value || 1);
    }
    function getSelectedCategories() {
      const set = new Set();
      catCheckboxes.forEach((cb) => cb.checked && set.add(cb.value));
      return set;
    }
    function getSelectedSources() {
      const set = new Set();
      srcCheckboxes.forEach((cb) => cb.checked && set.add(cb.value));
      return set;
    }

    // ===== Actors =====
    const ACTORS = [
      { name: "IDF", patterns: ["idf", "israel defense forces"] },
      { name: "Hezbollah", patterns: ["hezbollah"] },
      { name: "IRGC", patterns: ["irgc", "islamic revolutionary guard", "revolutionary guards"] },
      { name: "Houthis", patterns: ["houthi", "houthis", "ansar allah"] },
      { name: "Hamas", patterns: ["hamas"] },
      { name: "ISIS", patterns: ["isis", "isil", "islamic state"] },
      { name: "PMF", patterns: ["pmf", "popular mobilization forces", "popular mobilisation forces"] },
      { name: "US forces", patterns: ["u.s. forces", "us forces", "u.s. military", "pentagon"] },
      { name: "Russia", patterns: ["russia", "russian"] },
      { name: "Turkey", patterns: ["turkey", "turkish"] },
    ];

    let activeActor = null;
    let activePair = null;

    function eventText(ev) {
      const tags = Array.isArray(ev.tags) ? ev.tags.join(" ") : "";
      const loc = ev?.location?.name || "";
      return norm(`${ev.title || ""} ${ev.summary || ""} ${tags} ${loc}`);
    }
    function actorsInEvent(ev) {
      const text = eventText(ev);
      const found = [];
      for (const a of ACTORS) {
        for (const p of a.patterns) {
          if (text.includes(p)) { found.push(a.name); break; }
        }
      }
      return [...new Set(found)];
    }
    const pairKey = (a, b) => [a, b].sort().join(" + ");
    function matchesActor(ev) { return !activeActor || actorsInEvent(ev).includes(activeActor); }
    function matchesPair(ev) {
      if (!activePair) return true;
      const found = actorsInEvent(ev);
      return found.includes(activePair.a) && found.includes(activePair.b);
    }

    // ===== Region model =====
    let activeRegion = "ALL";
    const REGION_ALIASES = {
      LEVANT: new Set(["israel","lebanon","syria","jordan","iraq","palestine","palestinian territories","palestinian territory","west bank","gaza","gaza strip"]),
      GULF: new Set(["saudi arabia","united arab emirates","uae","qatar","bahrain","kuwait","oman","yemen","iran"]),
      NORTH: new Set(["egypt","turkey"]),
    };
    function regionContainsCountry(region, countryName) {
      if (!region || region === "ALL") return true;
      const set = REGION_ALIASES[region];
      if (!set) return true;
      const c = norm(countryName);
      if (set.has(c)) return true;
      if (region === "LEVANT" && (c.includes("palestin") || c.includes("gaza") || c.includes("west bank"))) return true;
      return false;
    }
    function updateRegionNote() {
      regionNote.textContent = (activeRegion === "ALL") ? "No region filter" : `Region: ${activeRegion}`;
    }
    updateRegionNote();

    // ===== Borders + polygons =====
    const BORDERS_GEOJSON_URL =
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

    let bordersLayer = null;
    let bordersLoaded = false;
    let countryFeatures = [];
    const countryCache = new Map();

    let borderWeight = Number(borderWeightSlider.value);
    let borderOpacity = Number(borderOpacitySlider.value);
    let borderFillOn = borderFillCheckbox.checked;
    let borderFillOpacity = Number(borderFillOpacitySlider.value);

    function syncBorderLabels() {
      borderWeightLabel.textContent = borderWeight.toFixed(1);
      borderOpacityLabel.textContent = borderOpacity.toFixed(2);
      borderFillOpacityLabel.textContent = borderFillOpacity.toFixed(2);
    }
    syncBorderLabels();

    function featureCountryName(feature) {
      const props = feature?.properties || {};
      return props.ADMIN || props.NAME || props.name || props.SOVEREIGNT || "Unknown";
    }
    function bordersStyle(feature) {
      const name = featureCountryName(feature);
      const inRegion = activeRegion !== "ALL" && regionContainsCountry(activeRegion, name);
      const fillOpacity = (borderFillOn && inRegion) ? borderFillOpacity : 0;
      return {
        color: "#ffffff",
        weight: borderWeight,
        opacity: borderOpacity,
        fillColor: "#ffffff",
        fillOpacity: fillOpacity,
      };
    }

    function computeBBoxFromCoords(coords) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const walk = (c) => {
        if (!Array.isArray(c)) return;
        if (typeof c[0] === "number" && typeof c[1] === "number") {
          const x = c[0], y = c[1];
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
          return;
        }
        for (const child of c) walk(child);
      };
      walk(coords);
      return [minX, minY, maxX, maxY];
    }

    async function ensureBordersLoaded() {
      if (bordersLoaded) return;
      const res = await fetch(BORDERS_GEOJSON_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Borders HTTP ${res.status}`);
      const geojson = await res.json();

      bordersLayer = L.geoJSON(geojson, { style: bordersStyle });
      bordersLoaded = true;

      countryFeatures = [];
      for (const f of geojson.features || []) {
        const name = featureCountryName(f);
        const geom = f.geometry;
        if (!geom || !geom.type || !geom.coordinates) continue;
        const bbox = computeBBoxFromCoords(geom.coordinates);
        countryFeatures.push({ name, bbox, geom });
      }
    }

    function applyBordersStyleNow() {
      if (bordersLayer) bordersLayer.setStyle(bordersStyle);
    }

    async function setBordersVisible(visible) {
      if (visible) {
        await ensureBordersLoaded();
        if (bordersLayer && !map.hasLayer(bordersLayer)) {
          bordersLayer.addTo(map);
          bordersLayer.bringToBack();
        }
        applyBordersStyleNow();
      } else {
        if (bordersLayer && map.hasLayer(bordersLayer)) map.removeLayer(bordersLayer);
      }
    }

    bordersCheckbox.addEventListener("change", (e) => {
      setBordersVisible(e.target.checked).catch((err) => {
        console.error(err);
        alert("Nem sikerült betölteni az országhatárokat.");
        bordersCheckbox.checked = false;
      });
    });

    function regionBoundsFromBBoxes(region) {
      if (!bordersLoaded || region === "ALL") return null;
      let bounds = null;
      for (const cf of countryFeatures) {
        if (!regionContainsCountry(region, cf.name)) continue;
        const [minLng, minLat, maxLng, maxLat] = cf.bbox;
        const b = L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
        bounds = bounds ? bounds.extend(b) : b;
      }
      return bounds;
    }

    async function zoomToRegion(region) {
      if (region === "ALL") return;
      await ensureBordersLoaded();
      const b = regionBoundsFromBBoxes(region);
      if (b) map.fitBounds(b.pad(0.08));
    }

    // ===== Country inference =====
    function bboxContains(bbox, lng, lat) {
      return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
    }
    function pointInRing(lng, lat, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect =
          (yi > lat) !== (yj > lat) &&
          lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    }
    function pointInPolygon(lng, lat, polygonCoords) {
      if (!polygonCoords || !polygonCoords.length) return false;
      const outer = polygonCoords[0];
      if (!pointInRing(lng, lat, outer)) return false;
      for (let i = 1; i < polygonCoords.length; i++) if (pointInRing(lng, lat, polygonCoords[i])) return false;
      return true;
    }
    function inferCountryFromPoint(lat, lng) {
      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      if (countryCache.has(key)) return countryCache.get(key);
      if (!bordersLoaded || !countryFeatures.length) return null;

      for (const cf of countryFeatures) {
        if (!bboxContains(cf.bbox, lng, lat)) continue;
        const geom = cf.geom;
        if (!geom) continue;

        if (geom.type === "Polygon") {
          if (pointInPolygon(lng, lat, geom.coordinates)) { countryCache.set(key, cf.name); return cf.name; }
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) {
            if (pointInPolygon(lng, lat, poly)) { countryCache.set(key, cf.name); return cf.name; }
          }
        }
      }
      countryCache.set(key, null);
      return null;
    }
    function getCountry(ev) {
      const c1 = ev?.location?.country;
      if (c1) return String(c1).trim();
      const ll = getLatLng(ev);
      if (ll && bordersLoaded) {
        const inferred = inferCountryFromPoint(ll.lat, ll.lng);
        if (inferred) return inferred;
      }
      const name = (ev?.location?.name || "").trim();
      if (name.includes(",")) {
        const parts = name.split(",").map((s) => s.trim()).filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && last.length >= 3) return last;
      }
      return "Unknown";
    }
    function matchesRegion(ev) {
      if (activeRegion === "ALL") return true;
      return regionContainsCountry(activeRegion, getCountry(ev));
    }

    // ===== Source/category =====
    function sourceType(ev) {
      const t = norm(ev?.source?.type || "news");
      return t === "isw" ? "isw" : "news";
    }
    function categoryColor(cat) {
      const c = norm(cat);
      if (c === "military") return "#ff5a5a";
      if (c === "political") return "#4ea1ff";
      if (c === "security") return "#ffd84e";
      return "#b7b7b7";
    }
    function categoryWeight(cat) {
      const c = norm(cat || "other");
      if (c === "military") return 3.0;
      if (c === "security") return 2.0;
      if (c === "political") return 1.0;
      return 0.5;
    }
    function sourceMultiplier(ev) { return sourceType(ev) === "isw" ? 1.3 : 1.0; }

    function getLatLng(ev) {
      const lat = Number(ev?.location?.lat);
      const lng = Number(ev?.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    }

    function matchesSearch(ev, q) {
      if (!q) return true;
      const t = norm(ev.title);
      const s = norm(ev.summary);
      const tags = Array.isArray(ev.tags) ? ev.tags.map(norm).join(" ") : "";
      const loc = norm(ev?.location?.name);
      return t.includes(q) || s.includes(q) || tags.includes(q) || loc.includes(q);
    }

    // ===== Hotspot filter (NEW) =====
    // activeHotspot: {lat,lng,radiusKm,label}
    let activeHotspot = null;
    let hotspotCircle = null;

    function haversineKm(aLat, aLng, bLat, bLng) {
      const R = 6371;
      const dLat = (bLat - aLat) * Math.PI / 180;
      const dLng = (bLng - aLng) * Math.PI / 180;
      const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
      const aa = s1*s1 + Math.cos(aLat*Math.PI/180)*Math.cos(bLat*Math.PI/180)*s2*s2;
      return 2 * R * Math.asin(Math.sqrt(aa));
    }

    function matchesHotspot(ev) {
      if (!activeHotspot) return true;
      const ll = getLatLng(ev);
      if (!ll) return false;
      const d = haversineKm(activeHotspot.lat, activeHotspot.lng, ll.lat, ll.lng);
      return d <= activeHotspot.radiusKm;
    }

    function setHotspot(h) {
      activeHotspot = h;
      clearHotspotBtn.style.display = activeHotspot ? "inline-block" : "none";

      if (hotspotCircle) {
        map.removeLayer(hotspotCircle);
        hotspotCircle = null;
      }
      if (activeHotspot) {
        hotspotCircle = L.circle([activeHotspot.lat, activeHotspot.lng], {
          radius: activeHotspot.radiusKm * 1000,
          color: "#ffffff",
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.08,
        }).addTo(map);
        map.fitBounds(hotspotCircle.getBounds().pad(0.2));
      }
    }

    clearHotspotBtn.addEventListener("click", () => {
      setHotspot(null);
      renderHotspotList([]); // will be re-rendered by updateWeekly
      updateAll();
    });

    // ===== Markers =====
    const markerByEventId = new Map();
    function makeMarker(ev) {
      const ll = getLatLng(ev);
      if (!ll) return null;

      const icon = L.divIcon({
        className: "",
        html: `<div class="event-dot" style="background:${categoryColor(ev.category)}"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      const m = L.marker([ll.lat, ll.lng], { icon });
      const srcName = ev?.source?.name || "";
      const srcUrl = ev?.source?.url || "";
      const srcLine = srcUrl
        ? `<a href="${srcUrl}" target="_blank" rel="noreferrer">${srcName || "source"}</a>`
        : `${srcName}`;

      m.bindPopup(
        `<b>${ev.title || "Untitled"}</b><br>${ev.summary || ""}<br><small>${srcLine}</small>`
      );
      return m;
    }

    function openEventOnMap(ev) {
      const ll = getLatLng(ev);
      if (ll) map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 9));
      const marker = ev?.id ? markerByEventId.get(ev.id) : null;
      if (marker) {
        const parent = clusterGroup.getVisibleParent(marker);
        if (parent && parent !== marker && parent.spiderfy) {
          parent.spiderfy();
          setTimeout(() => marker.openPopup(), 150);
        } else {
          marker.openPopup();
        }
      }
    }

    // ===== Trend (restored) =====
    function drawTrendBars(counts, total, rangeText) {
      const ctx = trendCanvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;

      const cssW = Math.max(320, Math.floor(trendCanvas.parentElement.getBoundingClientRect().width || 320));
      const cssH = 120;

      trendCanvas.style.width = "100%";
      trendCanvas.style.height = cssH + "px";
      trendCanvas.width = Math.floor(cssW * dpr);
      trendCanvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "rgba(0,0,0,.16)";
      ctx.fillRect(0, 0, cssW, cssH);

      const padL = 24, padR = 8, padT = 12, padB = 20;
      const w = cssW - padL - padR;
      const h = cssH - padT - padB;

      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(padL, padT);
      ctx.lineTo(padL, padT + h);
      ctx.lineTo(padL + w, padT + h);
      ctx.stroke();

      const max = Math.max(1, ...counts);
      const barW = w / Math.max(1, counts.length);

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#fff";
      for (let i = 0; i < counts.length; i++) {
        const c = counts[i];
        const bh = (c / max) * h;
        const x = padL + i * barW + 1;
        const y = padT + h - bh;
        ctx.fillRect(x, y, Math.max(1, barW - 2), bh);
      }

      ctx.globalAlpha = 0.9;
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "#fff";
      ctx.fillText(`Total: ${total}`, padL, 16);

      trendTotalEl.textContent = String(total);
      trendRangeEl.textContent = rangeText;

      ctx.globalAlpha = 1.0;
    }

    function computeTrend(selectedIndex, windowDays, filters) {
      const startIndex = Math.max(0, selectedIndex - (windowDays - 1));
      const dates = days365.slice(startIndex, selectedIndex + 1);
      const counts = new Array(dates.length).fill(0);

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (idx < startIndex || idx > selectedIndex) continue;
        if (!filters(ev, idx)) continue;
        counts[idx - startIndex] += 1;
      }
      const total = counts.reduce((a, b) => a + b, 0);
      const rangeText = `${dates[0]} → ${dates[dates.length - 1]} (${dates.length} days)`;
      return { counts, total, rangeText };
    }

    // ===== Risk scoring for list =====
    function recencyWeight(eventIndex, selectedIndex, windowDays) {
      const ageDays = selectedIndex - eventIndex;
      if (windowDays <= 1) return 1.0;
      const t = ageDays / (windowDays - 1);
      return 1.0 - 0.6 * t;
    }
    function eventRiskScore(ev, eventIndex, selectedIndex, windowDays) {
      return categoryWeight(ev.category) * sourceMultiplier(ev) * recencyWeight(eventIndex, selectedIndex, windowDays);
    }

    // ===== Heat layers =====
    let heatLayer = null;
    let weeklyHeatLayer = null;

    function clearHeat() {
      if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      heatLayer = null;
    }
    function clearWeeklyHeat() {
      if (weeklyHeatLayer && map.hasLayer(weeklyHeatLayer)) map.removeLayer(weeklyHeatLayer);
      weeklyHeatLayer = null;
    }

    // ===== Weekly anomaly + hotspots (NEW, region-aware) =====
    // Grid bin size in degrees (works well for ME scale)
    const BIN_DEG = 1.0; // ~111km lat; good compromise
    const HOTSPOT_RADIUS_KM = 120; // filter radius when clicked
    function binKey(lat, lng) {
      const bx = Math.floor(lng / BIN_DEG);
      const by = Math.floor(lat / BIN_DEG);
      return `${by}:${bx}`;
    }
    function binCenterFromKey(k) {
      const [by, bx] = k.split(":").map(Number);
      const clat = (by + 0.5) * BIN_DEG;
      const clng = (bx + 0.5) * BIN_DEG;
      return { lat: clat, lng: clng };
    }

    // Weekly windows relative to selected date:
    // "today" = selectedIndex day; 7d window excludes today: [selected-7 .. selected-1]
    // prev 7: [selected-14 .. selected-8]
    function weeklyWindows(selectedIndex) {
      const a1 = Math.max(0, selectedIndex - 7);
      const a2 = Math.max(0, selectedIndex - 1);
      const b1 = Math.max(0, selectedIndex - 14);
      const b2 = Math.max(0, selectedIndex - 8);
      return { a1, a2, b1, b2 };
    }

    function computeWeeklyHotspots(selectedIndex, filterFn) {
      const { a1, a2, b1, b2 } = weeklyWindows(selectedIndex);

      const aCounts = new Map();
      const bCounts = new Map();

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const ll = getLatLng(ev);
        if (!ll) continue;

        // apply same filters (region aware included via filterFn)
        if (!filterFn(ev, idx, { weeklyMode: true })) continue;

        const key = binKey(ll.lat, ll.lng);
        if (idx >= a1 && idx <= a2) aCounts.set(key, (aCounts.get(key) || 0) + 1);
        if (idx >= b1 && idx <= b2) bCounts.set(key, (bCounts.get(key) || 0) + 1);
      }

      // anomaly score: (a - b) / max(1, b)
      const allKeys = new Set([...aCounts.keys(), ...bCounts.keys()]);
      const bins = [];
      for (const k of allKeys) {
        const a = aCounts.get(k) || 0;
        const b = bCounts.get(k) || 0;
        const delta = a - b;
        const ratio = delta / Math.max(1, b);
        // show only positive deltas to avoid "blue"
        if (delta <= 0) continue;
        const center = binCenterFromKey(k);
        bins.push({
          key: k,
          lat: center.lat,
          lng: center.lng,
          a,
          b,
          delta,
          ratio,
          score: delta + ratio, // simple combined score
        });
      }

      bins.sort((x, y) => (y.score - x.score));
      return bins.slice(0, 10);
    }

    function renderHotspotList(bins) {
      if (!weeklyHeatCheckbox.checked) {
        hotspotListEl.innerHTML = `<div class="muted">Turn on “Weekly anomaly heatmap”.</div>`;
        return;
      }
      if (!bins.length) {
        hotspotListEl.innerHTML = `<div class="muted">No positive weekly anomalies (try wider filters or different date).</div>`;
        return;
      }

      hotspotListEl.innerHTML = bins.map((b, i) => {
        const active = activeHotspot && Math.abs(activeHotspot.lat - b.lat) < 0.001 && Math.abs(activeHotspot.lng - b.lng) < 0.001;
        return `
          <div class="hotspot-row ${active ? "active" : ""}" data-key="${b.key}">
            <div>
              <div><b>#${i+1}</b> Δ ${b.delta} (7d:${b.a} vs prev:${b.b})</div>
              <div class="muted">ratio ${b.ratio.toFixed(2)} · ${b.lat.toFixed(2)}, ${b.lng.toFixed(2)}</div>
            </div>
            <div class="muted">▶</div>
          </div>
        `;
      }).join("");

      [...hotspotListEl.querySelectorAll(".hotspot-row")].forEach((row) => {
        row.onclick = () => {
          const key = row.getAttribute("data-key");
          const b = bins.find(x => x.key === key);
          if (!b) return;

          // toggle on/off
          const isSame = activeHotspot && Math.abs(activeHotspot.lat - b.lat) < 0.001 && Math.abs(activeHotspot.lng - b.lng) < 0.001;
          if (isSame) {
            setHotspot(null);
          } else {
            setHotspot({ lat: b.lat, lng: b.lng, radiusKm: HOTSPOT_RADIUS_KM, label: `Weekly hotspot Δ${b.delta}` });
          }
          renderHotspotList(bins);
          updateAll();
        };
      });
    }

    function updateWeeklyHeatmapAndHotspots(selectedIndex, filterFn) {
      if (!weeklyHeatCheckbox.checked) {
        clearWeeklyHeat();
        renderHotspotList([]);
        return;
      }

      const bins = computeWeeklyHotspots(selectedIndex, filterFn);

      // build heat points: intensity based on delta+ratio
      const points = bins.map(b => [b.lat, b.lng, Math.max(0.1, b.delta + b.ratio)]);
      clearWeeklyHeat();
      if (points.length) {
        weeklyHeatLayer = L.heatLayer(points, { radius: 38, blur: 28, maxZoom: 8 });
        weeklyHeatLayer.addTo(map);
        weeklyHeatLayer.bringToBack();
        if (bordersLayer && map.hasLayer(bordersLayer)) bordersLayer.bringToBack();
      }

      renderHotspotList(bins);
    }

    // ===== Main filters =====
    function filterBuilder(selectedIndex, windowDays) {
      const catSet = getSelectedCategories();
      const srcSet = getSelectedSources();
      const q = norm(searchInput.value).trim();

      return (ev, evIndex, opts = {}) => {
        // date window:
        // - normal list uses [selected-window+1 .. selected]
        // - weekly mode uses its own windows, so skip this part
        if (!opts.weeklyMode) {
          const within = evIndex <= selectedIndex && evIndex >= selectedIndex - (windowDays - 1);
          if (!within) return false;
        }

        const cat = norm(ev.category || "other");
        if (!catSet.has(cat)) return false;

        const st = sourceType(ev);
        if (!srcSet.has(st)) return false;

        if (!matchesSearch(ev, q)) return false;
        if (!matchesActor(ev)) return false;
        if (!matchesPair(ev)) return false;

        // region-aware (country inference)
        if (!matchesRegion(ev)) return false;

        // hotspot filter (applies to list + trend + stats; weekly itself uses bins, not hotspot)
        if (!opts.weeklyMode && !matchesHotspot(ev)) return false;

        return true;
      };
    }

    // ===== Heatmap (normal) =====
    function updateNormalHeatmap(visibleEvents, selectedIndex, windowDays) {
      if (!heatCheckbox.checked) { clearHeat(); return; }

      const points = [];
      for (const ev of visibleEvents) {
        const ll = getLatLng(ev);
        if (!ll) continue;
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const w = eventRiskScore(ev, idx, selectedIndex, windowDays);
        points.push([ll.lat, ll.lng, w]);
      }

      clearHeat();
      if (!points.length) return;

      heatLayer = L.heatLayer(points, { radius: 28, blur: 22, maxZoom: 9 });
      heatLayer.addTo(map);
      heatLayer.bringToBack();
      if (weeklyHeatLayer) weeklyHeatLayer.bringToBack();
      if (bordersLayer && map.hasLayer(bordersLayer)) bordersLayer.bringToBack();
    }

    // ===== Stats / Risk / Actors / Pairs =====
    function updateStats(visibleEvents) {
      let mil=0, sec=0, pol=0, oth=0, news=0, isw=0;
      for (const ev of visibleEvents) {
        const c = norm(ev.category || "other");
        if (c === "military") mil++;
        else if (c === "security") sec++;
        else if (c === "political") pol++;
        else oth++;

        const st = sourceType(ev);
        if (st === "isw") isw++; else news++;
      }
      statsTotalEl.textContent = String(visibleEvents.length);
      statsMilEl.textContent = String(mil);
      statsSecEl.textContent = String(sec);
      statsPolEl.textContent = String(pol);
      statsOthEl.textContent = String(oth);
      statsNewsEl.textContent = String(news);
      statsIswEl.textContent = String(isw);
    }

    function updateRisk(visibleEvents, selectedIndex, windowDays) {
      let total = 0;
      const byLoc = new Map();
      for (const ev of visibleEvents) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const locName = (ev?.location?.name || "Unknown").trim() || "Unknown";
        const score = eventRiskScore(ev, idx, selectedIndex, windowDays);
        total += score;
        byLoc.set(locName, (byLoc.get(locName) || 0) + score);
      }
      riskTotalEl.textContent = total.toFixed(1);

      const rows = [...byLoc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      riskListEl.innerHTML = rows.length
        ? rows.map(([name, val]) => `
          <div class="risk-row"><div class="name">${name}</div><div class="val">${val.toFixed(1)}</div></div>
        `).join("")
        : `<div class="muted">No risk data for current filters.</div>`;
    }

    function updateActors(visibleEvents) {
      const counts = new Map();
      for (const ev of visibleEvents) for (const a of actorsInEvent(ev)) counts.set(a, (counts.get(a) || 0) + 1);
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

      actorActiveEl.textContent = activeActor ? activeActor : "ALL";
      actorClearBtn.style.display = activeActor ? "inline-block" : "none";

      actorsListEl.innerHTML = rows.length
        ? rows.map(([name, n]) => `
          <div class="actor-chip ${activeActor === name ? "active" : ""}" data-actor="${name}">
            <span>${name}</span><b>${n}</b>
          </div>`).join("")
        : `<div class="muted">No actor signals in this window.</div>`;

      [...actorsListEl.querySelectorAll(".actor-chip")].forEach((el) => {
        el.onclick = () => {
          const a = el.getAttribute("data-actor");
          activeActor = (activeActor === a) ? null : a;
          updateAll();
        };
      });
    }

    function updatePairs(visibleEvents) {
      const counts = new Map();
      for (const ev of visibleEvents) {
        const found = actorsInEvent(ev);
        if (found.length < 2) continue;
        for (let i = 0; i < found.length; i++) {
          for (let j = i + 1; j < found.length; j++) {
            const k = pairKey(found[i], found[j]);
            counts.set(k, (counts.get(k) || 0) + 1);
          }
        }
      }
      const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

      pairActiveEl.textContent = activePair ? `${activePair.a} + ${activePair.b}` : "ALL";
      pairClearBtn.style.display = activePair ? "inline-block" : "none";

      pairsListEl.innerHTML = rows.length
        ? rows.map(([k, n]) => `
          <div class="pair-row ${activePair && pairKey(activePair.a, activePair.b) === k ? "active" : ""}" data-pair="${k}">
            <div class="name">${k}</div><div class="val">${n}</div>
          </div>`).join("")
        : `<div class="muted">No interaction pairs in this window.</div>`;

      [...pairsListEl.querySelectorAll(".pair-row")].forEach((el) => {
        el.onclick = () => {
          const k = el.getAttribute("data-pair") || "";
          const parts = k.split(" + ");
          if (parts.length !== 2) return;
          const a = parts[0], b = parts[1];
          if (activePair && pairKey(activePair.a, activePair.b) === pairKey(a, b)) activePair = null;
          else activePair = { a, b };
          updateAll();
        };
      });
    }

    actorClearBtn.addEventListener("click", () => { activeActor = null; updateAll(); });
    pairClearBtn.addEventListener("click", () => { activePair = null; updateAll(); });

    // ===== Alerts (restored simplified rolling 7d baseline; region-aware) =====
    function computeRolling7dSpike(selectedIndex, filterFn, category = null) {
      // today = selectedIndex day (in list window), baseline = prev 7 days excluding today
      const todayIdx = selectedIndex;
      const baseStart = Math.max(0, selectedIndex - 7);
      const baseEnd = Math.max(0, selectedIndex - 1);

      let today = 0;
      let base = 0;

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;

        if (category && norm(ev.category) !== category) continue;

        // apply filter, but force weeklyMode=false (respect hotspot), AND date window checks outside
        if (!filterFn(ev, idx, { weeklyMode: false })) continue;

        if (idx === todayIdx) today++;
        if (idx >= baseStart && idx <= baseEnd) base++;
      }

      const baseAvg = base / 7.0;
      const ratio = today / Math.max(0.25, baseAvg);
      return { today, baseAvg, ratio };
    }

    function updateAlerts(selectedIndex, filterFn) {
      const overall = computeRolling7dSpike(selectedIndex, filterFn, null);
      const hardsec = computeRolling7dSpike(selectedIndex, filterFn, "security");
      const military = computeRolling7dSpike(selectedIndex, filterFn, "military");

      const maxRatio = Math.max(overall.ratio, hardsec.ratio, military.ratio);
      let status = "OK";
      let cls = "badge-mini badge-ok";
      if (maxRatio >= 3.0) { status = "ALERT"; cls = "badge-mini badge-alert"; }
      else if (maxRatio >= 2.0) { status = "WARN"; cls = "badge-mini badge-warn"; }

      spikeBadge.className = cls;
      spikeBadge.textContent = status;

      spikeText.textContent =
        `Rolling 7d baseline | Overall: ${status} (today ${overall.today}, base ${overall.baseAvg.toFixed(1)}, x${overall.ratio.toFixed(2)})`;

      spikeDetails.innerHTML = `
        <div class="risk-row"><div class="name">Security spike</div><div class="val">${hardsec.today} vs ${hardsec.baseAvg.toFixed(1)} · x${hardsec.ratio.toFixed(2)}</div></div>
        <div class="risk-row"><div class="name">Military spike</div><div class="val">${military.today} vs ${military.baseAvg.toFixed(1)} · x${military.ratio.toFixed(2)}</div></div>
        <div class="muted">Filters include Region + Hotspot (if active) + Actor/Pair/Search.</div>
      `;
    }

    // ===== Country risk (restored) =====
    function updateCountryRisk(visibleEvents) {
      const byCountry = new Map();
      for (const ev of visibleEvents) {
        const c = getCountry(ev);
        byCountry.set(c, (byCountry.get(c) || 0) + 1);
      }
      const rows = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      countryRiskNote.textContent = bordersLoaded ? "Country counts (polygon inference ON)" : "Country counts";
      countryRiskList.innerHTML = rows.length
        ? rows.map(([name, val]) => `<div class="rank-row"><div class="name">${name}</div><div class="val">${val}</div></div>`).join("")
        : `<div class="muted">No country data.</div>`;
    }

    // ===== Actor escalation (light) =====
    function updateEscalation(visibleEvents, selectedIndex) {
      // Compare last 7d (excluding today) vs prev 7d for actor counts
      const { a1, a2, b1, b2 } = weeklyWindows(selectedIndex);
      const aMap = new Map();
      const bMap = new Map();

      for (const ev of visibleEvents) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const actors = actorsInEvent(ev);
        for (const a of actors) {
          if (idx >= a1 && idx <= a2) aMap.set(a, (aMap.get(a) || 0) + 1);
          if (idx >= b1 && idx <= b2) bMap.set(a, (bMap.get(a) || 0) + 1);
        }
      }

      const rows = [];
      const all = new Set([...aMap.keys(), ...bMap.keys()]);
      for (const a of all) {
        const ca = aMap.get(a) || 0;
        const cb = bMap.get(a) || 0;
        const delta = ca - cb;
        if (delta <= 0) continue;
        rows.push({ a, ca, cb, delta });
      }
      rows.sort((x, y) => y.delta - x.delta);
      const top = rows.slice(0, 8);

      escNote.textContent = `7d vs prev 7d · (region/hotspot aware)`;
      escalationList.innerHTML = top.length
        ? top.map(r => `<div class="rank-row"><div class="name">${r.a} (Δ ${r.delta})</div><div class="val">${r.ca} vs ${r.cb}</div></div>`).join("")
        : `<div class="muted">No positive actor deltas.</div>`;
    }

    // ===== Data =====
    let eventsData = [];

    // ===== Compute visible list window =====
    function computeVisible(selectedIndex, windowDays, filterFn) {
      const out = [];
      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (!filterFn(ev, idx, { weeklyMode: false })) continue;
        out.push(ev);
      }
      // sort latest first
      out.sort((a, b) => (b.date + (b.title || "")).localeCompare(a.date + (a.title || "")));
      return out;
    }

    // ===== Main updater =====
    function updateAll() {
      const selectedIndex = Number(slider.value);
      const selectedDate = days365[selectedIndex];
      const windowDays = getWindowDays();
      label.textContent = selectedDate || "—";

      // Ensure borders style reflects region highlight
      applyBordersStyleNow();

      const filterFn = filterBuilder(selectedIndex, windowDays);
      const visible = computeVisible(selectedIndex, windowDays, filterFn);

      // Markers
      clusterGroup.clearLayers();
      markerByEventId.clear();
      for (const ev of visible) {
        const m = makeMarker(ev);
        if (!m) continue;
        clusterGroup.addLayer(m);
        if (ev.id) markerByEventId.set(ev.id, m);
      }

      // Heatmaps
      updateNormalHeatmap(visible, selectedIndex, windowDays);
      updateWeeklyHeatmapAndHotspots(selectedIndex, filterFn);

      // Trend
      const trend = computeTrend(selectedIndex, windowDays, (ev, idx) => filterFn(ev, idx, { weeklyMode: false }));
      drawTrendBars(trend.counts, trend.total, trend.rangeText);

      // Stats / Risk / Actors / Pairs
      updateStats(visible);
      updateRisk(visible, selectedIndex, windowDays);
      updateActors(visible);
      updatePairs(visible);

      // Alerts / country / escalation
      updateAlerts(selectedIndex, filterFn);
      updateCountryRisk(visible);
      updateEscalation(visible, selectedIndex);

      // Events list
      if (!visible.length) {
        eventsListEl.innerHTML = `<div class="muted">No events for current filters (region/hotspot/actor/pair/search).</div>`;
      } else {
        eventsListEl.innerHTML = visible.map((ev) => {
          const st = sourceType(ev).toUpperCase();
          const locName = ev?.location?.name ? ` · ${ev.location.name}` : "";
          const ctry = getCountry(ev);
          return `
            <div class="event-row" data-id="${ev.id}">
              <div class="event-row-title">${ev.title || "Untitled"}</div>
              <div class="event-row-meta">
                <span>${st}</span>
                <span>${(ev.category || "other")} · ${ev.date}${locName} · ${ctry}</span>
              </div>
            </div>
          `;
        }).join("");

        [...eventsListEl.querySelectorAll(".event-row")].forEach((row) => {
          row.onclick = () => {
            const id = row.getAttribute("data-id");
            const ev = eventsData.find(e => String(e.id) === String(id));
            if (ev) openEventOnMap(ev);
          };
        });
      }
    }

    // ===== Wiring =====
    function refresh() { updateAll(); }

    slider.addEventListener("input", refresh);
    searchInput.addEventListener("input", refresh);
    catCheckboxes.forEach((cb) => cb.addEventListener("change", refresh));
    srcCheckboxes.forEach((cb) => cb.addEventListener("change", refresh));
    windowRadios.forEach((r) => r.addEventListener("change", refresh));

    heatCheckbox.addEventListener("change", refresh);
    weeklyHeatCheckbox.addEventListener("change", () => {
      // turning off weekly heat also clears hotspot list; hotspot filter stays unless user clears
      if (!weeklyHeatCheckbox.checked) renderHotspotList([]);
      refresh();
    });

    regionSelect.addEventListener("change", async () => {
      activeRegion = regionSelect.value || "ALL";
      updateRegionNote();
      await zoomToRegion(activeRegion);
      applyBordersStyleNow();
      refresh();
    });
    regionClear.addEventListener("click", async () => {
      activeRegion = "ALL";
      regionSelect.value = "ALL";
      updateRegionNote();
      applyBordersStyleNow();
      refresh();
    });

    borderWeightSlider.addEventListener("input", () => {
      borderWeight = Number(borderWeightSlider.value);
      syncBorderLabels();
      applyBordersStyleNow();
    });
    borderOpacitySlider.addEventListener("input", () => {
      borderOpacity = Number(borderOpacitySlider.value);
      syncBorderLabels();
      applyBordersStyleNow();
    });
    borderFillCheckbox.addEventListener("change", () => {
      borderFillOn = borderFillCheckbox.checked;
      applyBordersStyleNow();
    });
    borderFillOpacitySlider.addEventListener("input", () => {
      borderFillOpacity = Number(borderFillOpacitySlider.value);
      syncBorderLabels();
      applyBordersStyleNow();
    });

    // ===== Load events =====
    fetch("events.json")
      .then((r) => r.json())
      .then(async (data) => {
        if (!Array.isArray(data)) throw new Error("events.json must be an array");
        eventsData = data.map((ev, i) => {
          const hasId = ev && (typeof ev.id === "string" || typeof ev.id === "number");
          if (hasId) return ev;
          const seed = `${ev?.date || ""}|${ev?.title || ""}|${ev?.location?.name || ""}|${i}`;
          const id = "e_" + btoa(unescape(encodeURIComponent(seed))).replace(/=+/g, "").slice(0, 18);
          return { ...ev, id };
        });

        // preload borders in background ONLY if user toggles Borders later, but for country inference region filter
        // we don't force load; region filter will still work if location.country is present in events.json.
        updateAll();
      })
      .catch((err) => {
        console.error(err);
        eventsListEl.innerHTML = `<div class="muted">events.json load error</div>`;
      });

  } catch (e) {
    console.error("Fatal init error:", e);
    alert("Hiba történt inicializáláskor. Nyisd meg a konzolt (F12) a részletekért.");
  }
});
