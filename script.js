// script.js (PART 1 / 2)
// =========================

import { createAircraftLayer } from "./js/aircraft-layer.js";
import { createReportsLayer } from "./js/reports-layer.js";

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

    // ===== Accordion (Timeline panel existing) =====
    function setArrow(btn, isOpen) {
      const arrow = btn.querySelector(".acc-arrow");
      if (arrow) arrow.style.transform = isOpen ? "rotate(90deg)" : "rotate(0deg)";
      btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }
    document.querySelectorAll(".acc-btn").forEach((btn) => {
      const targetId = btn.getAttribute("data-acc");
      const panel = targetId ? document.getElementById(targetId) : null;
      if (!panel) return;
      setArrow(btn, !panel.classList.contains("closed"));
      btn.addEventListener("click", () => {
        const wasClosed = panel.classList.contains("closed");
        panel.classList.toggle("closed");
        setArrow(btn, wasClosed);
        if (wasClosed) setTimeout(() => updateAll(), 80);
      });
    });

    // ===== Control panel accordion helper (for slicing) =====
    function makeAccSection(title, contentEl, openByDefault = false) {
      const wrap = document.createElement("div");
      wrap.className = "acc";

      const btn = document.createElement("button");
      btn.className = "acc-btn";
      btn.type = "button";
      btn.setAttribute("aria-expanded", openByDefault ? "true" : "false");
      btn.innerHTML = `<span>${title}</span><span class="acc-arrow">▶</span>`;

      const panel = document.createElement("div");
      panel.className = "acc-panel" + (openByDefault ? "" : " closed");
      panel.appendChild(contentEl);

      const arrow = btn.querySelector(".acc-arrow");
      if (arrow) arrow.style.transform = openByDefault ? "rotate(90deg)" : "rotate(0deg)";

      btn.addEventListener("click", () => {
        const wasClosed = panel.classList.contains("closed");
        panel.classList.toggle("closed");
        const isOpen = !wasClosed;
        btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (arrow) arrow.style.transform = isOpen ? "rotate(90deg)" : "rotate(0deg)";
      });

      wrap.appendChild(btn);
      wrap.appendChild(panel);
      return wrap;
    }

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

    function getLatLng(ev) {
      const lat = Number(ev?.location?.lat);
      const lng = Number(ev?.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
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

    function matchesSearch(ev, q) {
      if (!q) return true;
      const t = norm(ev.title);
      const s = norm(ev.summary);
      const tags = Array.isArray(ev.tags) ? ev.tags.map(norm).join(" ") : "";
      const loc = norm(ev?.location?.name);
      return t.includes(q) || s.includes(q) || tags.includes(q) || loc.includes(q);
    }

    // ===== Hotspot filter =====
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
      renderHotspotList([]);
      updateAll();
    });

    // ===== Markers (events) =====
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

    // ===== Trend =====
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

    // ===== Risk scoring =====
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

    // ===== Weekly anomaly + hotspots =====
    const BIN_DEG = 1.0;
    const HOTSPOT_RADIUS_KM = 120;

    function binKey(lat, lng) {
      const bx = Math.floor(lng / BIN_DEG);
      const by = Math.floor(lat / BIN_DEG);
      return `${by}:${bx}`;
    }
    function binCenterFromKey(k) {
      const [by, bx] = k.split(":").map(Number);
      return { lat: (by + 0.5) * BIN_DEG, lng: (bx + 0.5) * BIN_DEG };
    }
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
        if (!filterFn(ev, idx, { weeklyMode: true })) continue;

        const key = binKey(ll.lat, ll.lng);
        if (idx >= a1 && idx <= a2) aCounts.set(key, (aCounts.get(key) || 0) + 1);
        if (idx >= b1 && idx <= b2) bCounts.set(key, (bCounts.get(key) || 0) + 1);
      }

      const allKeys = new Set([...aCounts.keys(), ...bCounts.keys()]);
      const bins = [];
      for (const k of allKeys) {
        const a = aCounts.get(k) || 0;
        const b = bCounts.get(k) || 0;
        const delta = a - b;
        const ratio = delta / Math.max(1, b);
        if (delta <= 0) continue;
        const center = binCenterFromKey(k);
        bins.push({ key: k, lat: center.lat, lng: center.lng, a, b, delta, ratio, score: delta + ratio });
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

          const isSame = activeHotspot && Math.abs(activeHotspot.lat - b.lat) < 0.001 && Math.abs(activeHotspot.lng - b.lng) < 0.001;
          if (isSame) setHotspot(null);
          else setHotspot({ lat: b.lat, lng: b.lng, radiusKm: HOTSPOT_RADIUS_KM, label: `Weekly hotspot Δ${b.delta}` });

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

        if (!matchesRegion(ev)) return false;
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

    // ===== Alerts =====
    function computeRolling7dSpike(selectedIndex, filterFn, category = null) {
      const todayIdx = selectedIndex;
      const baseStart = Math.max(0, selectedIndex - 7);
      const baseEnd = Math.max(0, selectedIndex - 1);

      let today = 0;
      let base = 0;

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (category && norm(ev.category) !== category) continue;
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

    // ===== Country risk =====
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

    // ===== Actor escalation =====
    function updateEscalation(visibleEvents, selectedIndex) {
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

    // ===== Layer toggles (NEW) =====
    let eventsEnabled = true;

    // ===== Compute visible list window =====
    function computeVisible(selectedIndex, windowDays, filterFn) {
      const out = [];
      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (!filterFn(ev, idx, { weeklyMode: false })) continue;
        out.push(ev);
      }
      out.sort((a, b) => (b.date + (b.title || "")).localeCompare(a.date + (a.title || "")));
      return out;
    }

    // ===== END PART 1 =====
    // (Part 2 continues below)
  // =========================
// script.js (PART 2 / 2)
// =========================

    // ===== Aircraft layer (civil + military) =====
    const aircraft = createAircraftLayer(map, {
      updateIntervalMs: 20000,  // 20s
      trackSeconds: 300,
      militaryOnly: false,      // IMPORTANT: civil visible by default
      showTracks: true
    });

    let aircraftEnabled = true;
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

    // ===== Reports layer (reports.json) =====
    const reports = createReportsLayer(map, { maxAgeHours: 48, middleEastOnly: true });
    let reportsEnabled = true;

    async function refreshReportsSafe() {
      try {
        await reports.refresh();
      } catch (e) {
        console.warn("[reports] refresh failed:", e?.message || e);
      }
    }

    function setReportsEnabled(on) {
      reportsEnabled = !!on;
      if (reportsEnabled) {
        if (!map.hasLayer(reports.layer)) reports.layer.addTo(map);
        refreshReportsSafe();
      } else {
        if (map.hasLayer(reports.layer)) map.removeLayer(reports.layer);
      }
    }

    // refresh every 5 minutes
    window.setInterval(() => {
      if (reportsEnabled) refreshReportsSafe();
    }, 5 * 60 * 1000);

    // ===== POI layer (pois.json) =====
    const poiLayer = L.layerGroup();
    let poisEnabled = true;
    let poisLoaded = false;

    function poiEmoji(type) {
      const t = norm(type);
      if (t === "airport") return "✈️";
      if (t === "port") return "⚓";
      if (t === "airbase" || t === "base") return "🛡️";
      if (t === "chokepoint" || t === "choke_point") return "⛔";
      if (t === "nuclear") return "☢️";
      if (t === "pipeline") return "⛽";
      // NEW
  if (t === "powerplant" || t === "power_plant") return "⚡";
  if (t === "dam") return "💧";
      // default
      return "📍";
    }

    function poiIconHtml(emoji) {
      return `<div style="
        width:22px;height:22px;border-radius:999px;
        display:flex;align-items:center;justify-content:center;
        background: rgba(0,0,0,.35);
        border:1px solid rgba(255,255,255,.35);
        box-shadow:0 0 10px rgba(0,0,0,.35);
        font-size:14px;
      ">${emoji}</div>`;
    }

    async function loadPoisOnce() {
      if (poisLoaded) return;
      poisLoaded = true;
      try {
        const res = await fetch("pois.json", { cache: "no-store" });
        if (!res.ok) throw new Error(`pois.json HTTP ${res.status}`);
        const list = await res.json();
        if (!Array.isArray(list)) throw new Error("pois.json must be an array");

        poiLayer.clearLayers();
        for (const p of list) {
          const lat = Number(p?.lat);
          const lng = Number(p?.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

          const emoji = poiEmoji(p?.type);
          const icon = L.divIcon({
            className: "",
            html: poiIconHtml(emoji),
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });

          const m = L.marker([lat, lng], { icon });
          const name = String(p?.name || "POI").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const type = String(p?.type || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          m.bindPopup(`<b>${name}</b><br/><small>${type} · ${lat.toFixed(3)}, ${lng.toFixed(3)}</small>`);
          poiLayer.addLayer(m);
        }
      } catch (e) {
        console.warn("[pois] load failed:", e?.message || e);
      }
    }

    function setPoisEnabled(on) {
      poisEnabled = !!on;
      if (poisEnabled) {
        loadPoisOnce();
        if (!map.hasLayer(poiLayer)) poiLayer.addTo(map);
      } else {
        if (map.hasLayer(poiLayer)) map.removeLayer(poiLayer);
      }
    }

// ===== FIRMS fires layer (fires.json generated server-side) =====
// User-friendly analytical FIRMS panel.
// UI ids are created dynamically below in the Layers accordion.

const firesLayer = L.layerGroup();
let firesHeat = null;

let firesEnabled = false;
let firesMarkersEnabled = true;
let firesHeatEnabled = true;
let firesAreaMode = "middle_east"; // middle_east | israel_gaza | gaza | west_bank | israel_lebanon | south_lebanon | syria | iraq | yemen | iran
let firesAgeMode = "7d";        // 24h | 3d | 7d | 15d | 30d | all
let firesSensorMode = "all";     // all | viirs | modis
let firesConfidenceMode = "all"; // all | high | nominal | low
let firesFrpMin = 0;
let firesLastUpdate = "—";
let firesLastVisibleStats = {
  visible: 0,
  high: 0,
  avgFrp: 0,
  maxFrp: 0,
  totalAfterBBox: 0
};

const FIRE_AREAS = {
  middle_east: {
    label: "Entire Middle East",
    bounds: [[10.0, 25.0], [42.0, 65.0]],
    zoom: [[12.0, 26.0], [41.5, 64.5]]
  },
  israel_gaza: {
    label: "Israel–Gaza",
    bounds: [[29.0, 33.7], [33.6, 36.0]],
    zoom: [[29.4, 33.8], [33.4, 35.9]]
  },
  gaza: {
    label: "Gaza Strip",
    bounds: [[31.20, 34.15], [31.62, 34.60]],
    zoom: [[31.20, 34.15], [31.62, 34.60]]
  },
  west_bank: {
    label: "West Bank",
    bounds: [[31.25, 34.85], [32.75, 35.75]],
    zoom: [[31.25, 34.85], [32.75, 35.75]]
  },
  israel_lebanon: {
    label: "Israel–Lebanon",
    bounds: [[32.5, 34.8], [34.0, 36.0]],
    zoom: [[32.5, 34.8], [34.0, 36.0]]
  },
  south_lebanon: {
    label: "South Lebanon",
    bounds: [[33.00, 35.05], [33.75, 36.00]],
    zoom: [[33.00, 35.05], [33.75, 36.00]]
  },
  syria: {
    label: "Syria",
    bounds: [[32.0, 35.5], [37.5, 42.5]],
    zoom: [[32.0, 35.5], [37.5, 42.5]]
  },
  iraq: {
    label: "Iraq",
    bounds: [[29.0, 38.5], [37.5, 49.0]],
    zoom: [[29.0, 38.5], [37.5, 49.0]]
  },
  yemen: {
    label: "Yemen",
    bounds: [[12.0, 41.5], [19.2, 54.8]],
    zoom: [[12.0, 41.5], [19.2, 54.8]]
  },
  iran: {
    label: "Iran",
    bounds: [[24.0, 43.0], [40.0, 64.0]],
    zoom: [[24.0, 43.0], [40.0, 64.0]]
  }
};

function currentFireArea() {
  return FIRE_AREAS[firesAreaMode] || FIRE_AREAS.middle_east;
}

function inFireArea(lat, lng) {
  const area = currentFireArea();
  const b = area.bounds || FIRE_AREAS.middle_east.bounds;
  return lat >= b[0][0] && lat <= b[1][0] && lng >= b[0][1] && lng <= b[1][1];
}

function zoomToFireArea() {
  const area = currentFireArea();
  const b = area.zoom || area.bounds;
  if (!b || !map) return;
  map.fitBounds(L.latLngBounds(b[0], b[1]).pad(0.05));
}


// --- FIRMS UI helpers ---
function safeText(value, fallback = "—") {
  const s = String(value ?? fallback);
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function setTextIfExists(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(value);
}

function setFirmsStatus(text, mode = "neutral") {
  const el = document.getElementById("firmsStatusBadge");
  if (!el) return;
  el.textContent = text;
  el.className = "badge-mini";
  if (mode === "online") el.classList.add("badge-ok");
  else if (mode === "warn") el.classList.add("badge-warn");
  else if (mode === "error") el.classList.add("badge-alert");
}

function updateFiresUiStats() {
  setTextIfExists("firmsVisibleCount", firesLastVisibleStats.visible);
  setTextIfExists("firmsHighCount", firesLastVisibleStats.high);
  setTextIfExists("firmsAvgFrp", Number(firesLastVisibleStats.avgFrp || 0).toFixed(1));
  setTextIfExists("firmsMaxFrp", Number(firesLastVisibleStats.maxFrp || 0).toFixed(1));
  setTextIfExists("firmsLastUpdate", firesLastUpdate);
}

function readFiresUiState() {
  const checkedRadio = (name, fallback) => {
    const el = [...document.querySelectorAll(`input[name="${name}"]`)].find(r => r.checked);
    return el ? el.value : fallback;
  };

  const markersEl = document.getElementById("firesMarkersCheckbox");
  const heatEl = document.getElementById("firesHeatCheckbox");
  const frpEl = document.getElementById("firesFrpSelect");
  const areaEl = document.getElementById("firesAreaSelect");

  if (areaEl) firesAreaMode = areaEl.value || firesAreaMode;

  if (markersEl) firesMarkersEnabled = !!markersEl.checked;
  if (heatEl) firesHeatEnabled = !!heatEl.checked;

  firesAgeMode = checkedRadio("firesAge", firesAgeMode || "7d");
  firesSensorMode = checkedRadio("firesSensor", firesSensorMode || "all");
  firesConfidenceMode = checkedRadio("firesConfidence", firesConfidenceMode || "all");

  if (frpEl) {
    const v = Number(frpEl.value);
    firesFrpMin = Number.isFinite(v) ? v : 0;
  }
}

function bindFiresUi() {
  const bindChange = (selector, handler) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.boundFirms === "1") return;
      el.dataset.boundFirms = "1";
      el.addEventListener("change", handler);
    });
  };

  bindChange('input[name="firesAge"]', () => {
    readFiresUiState();
    if (firesEnabled) refreshFiresSafe();
  });
  bindChange('input[name="firesSensor"]', () => {
    readFiresUiState();
    if (firesEnabled) refreshFiresSafe();
  });
  bindChange('input[name="firesConfidence"]', () => {
    readFiresUiState();
    if (firesEnabled) refreshFiresSafe();
  });

  const markersEl = document.getElementById("firesMarkersCheckbox");
  if (markersEl && markersEl.dataset.boundFirms !== "1") {
    markersEl.dataset.boundFirms = "1";
    markersEl.addEventListener("change", () => {
      readFiresUiState();
      if (firesEnabled) refreshFiresSafe();
    });
  }

  const heatEl = document.getElementById("firesHeatCheckbox");
  if (heatEl && heatEl.dataset.boundFirms !== "1") {
    heatEl.dataset.boundFirms = "1";
    heatEl.addEventListener("change", () => {
      readFiresUiState();
      if (firesEnabled) refreshFiresSafe();
    });
  }

  const frpEl = document.getElementById("firesFrpSelect");
  if (frpEl && frpEl.dataset.boundFirms !== "1") {
    frpEl.dataset.boundFirms = "1";
    frpEl.addEventListener("change", () => {
      readFiresUiState();
      if (firesEnabled) refreshFiresSafe();
    });
  }

  const areaEl = document.getElementById("firesAreaSelect");
  if (areaEl && areaEl.dataset.boundFirms !== "1") {
    areaEl.dataset.boundFirms = "1";
    areaEl.addEventListener("change", () => {
      readFiresUiState();
      zoomToFireArea();
      if (firesEnabled) refreshFiresSafe();
    });
  }

  const zoomBtn = document.getElementById("firesAreaZoomBtn");
  if (zoomBtn && zoomBtn.dataset.boundFirms !== "1") {
    zoomBtn.dataset.boundFirms = "1";
    zoomBtn.addEventListener("click", () => {
      readFiresUiState();
      zoomToFireArea();
    });
  }

  const refreshBtn = document.getElementById("firesRefreshBtn");
  if (refreshBtn && refreshBtn.dataset.boundFirms !== "1") {
    refreshBtn.dataset.boundFirms = "1";
    refreshBtn.addEventListener("click", () => refreshFiresSafe());
  }
}

// --- Helpers ---
function inMiddleEastBBox(lat, lng) {
  // Broad Middle East filter.
  return lat >= 10 && lat <= 42 && lng >= 25 && lng <= 65;
}

function isoDateUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isoDateLocal(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseAcqDateMs(f) {
  const d = String(f?.acq_date || f?.date || "").trim();
  if (!d) return NaN;

  const rawTime = String(f?.acq_time || f?.time || "").trim().replace(/[^0-9]/g, "");
  if (rawTime) {
    const padded = rawTime.padStart(4, "0").slice(0, 4);
    const hh = padded.slice(0, 2);
    const mm = padded.slice(2, 4);
    const ms = Date.parse(`${d}T${hh}:${mm}:00Z`);
    if (Number.isFinite(ms)) return ms;
  }

  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : NaN;
}

function passFiresAgeFilter(f) {
  if (firesAgeMode === "all") return true;

  const ms = parseAcqDateMs(f);
  if (!Number.isFinite(ms)) return true;

  const now = Date.now();
  const ageDays = (now - ms) / 86400000;

  if (firesAgeMode === "24h") return ageDays <= 1;
  if (firesAgeMode === "3d") return ageDays <= 3;
  if (firesAgeMode === "7d") return ageDays <= 7;
  if (firesAgeMode === "15d") return ageDays <= 15;
  if (firesAgeMode === "30d") return ageDays <= 30;

  // Backward compatibility with older controls.
  if (firesAgeMode === "today") {
    const acq = isoDateUTC(ms);
    const todayUtc = isoDateUTC(now);
    const todayLocal = isoDateLocal(now);
    return acq === todayUtc || acq === todayLocal;
  }
  if (firesAgeMode === "5d") return ageDays <= 5;

  return true;
}

function fireSensor(f) {
  const raw = String(f?.satellite || f?.instrument || f?.sensor || f?.platform || "").toLowerCase();
  if (raw.includes("viirs") || raw.includes("n20") || raw.includes("n21") || raw.includes("suomi") || raw.includes("snpp") || raw.includes("noaa")) return "viirs";
  if (raw.includes("modis") || raw.includes("terra") || raw.includes("aqua")) return "modis";
  return "unknown";
}

function passFiresSensorFilter(f) {
  if (firesSensorMode === "all") return true;
  return fireSensor(f) === firesSensorMode;
}

function fireConfidenceLevel(f) {
  const raw = String(f?.confidence ?? f?.confidence_level ?? "").trim().toLowerCase();
  const num = Number(raw);

  if (raw === "h" || raw === "high") return "high";
  if (raw === "n" || raw === "nominal" || raw === "medium") return "nominal";
  if (raw === "l" || raw === "low") return "low";

  if (Number.isFinite(num)) {
    if (num >= 80) return "high";
    if (num >= 30) return "nominal";
    return "low";
  }

  return "unknown";
}

function passFiresConfidenceFilter(f) {
  if (firesConfidenceMode === "all") return true;
  return fireConfidenceLevel(f) === firesConfidenceMode;
}

function fireFrp(f) {
  const frp = Number(f?.frp ?? f?.FRP ?? 0);
  return Number.isFinite(frp) ? frp : 0;
}

function passFiresFrpFilter(f) {
  return fireFrp(f) >= firesFrpMin;
}

function fireSeverity(f) {
  const frp = fireFrp(f);
  if (frp >= 100) return "extreme";
  if (frp >= 50) return "high";
  if (frp >= 15) return "medium";
  return "low";
}

function fireColor(f) {
  const sev = fireSeverity(f);
  if (sev === "extreme") return "#7b2cbf";
  if (sev === "high") return "#d62828";
  if (sev === "medium") return "#f77f00";
  return "#fcbf49";
}

function fireIconHtml(f) {
  const color = fireColor(f);
  const sev = fireSeverity(f);
  const size = sev === "extreme" ? 20 : sev === "high" ? 18 : sev === "medium" ? 16 : 14;
  return `
    <div style="
      width:${size}px;height:${size}px;border-radius:999px;
      border:2px solid ${color};
      background:${color};
      opacity:.88;
      box-shadow:0 0 12px ${color};
      position:relative;
    ">
      <div style="
        position:absolute;left:50%;top:50%;width:4px;height:4px;
        border-radius:999px;background:rgba(0,0,0,.45);
        transform:translate(-50%,-50%);
      "></div>
    </div>
  `;
}

function buildFirePopup(f, lat, lng) {
  const acqDate = safeText(f?.acq_date || f?.date || "—");
  const acqTime = safeText(f?.acq_time || f?.time || "");
  const dt = acqTime ? `${acqDate} ${acqTime} UTC` : acqDate;
  const frp = fireFrp(f);
  const br = f?.brightness ?? f?.bright_ti4 ?? f?.bright_ti5 ?? "—";
  const confidence = safeText(f?.confidence ?? f?.confidence_level ?? fireConfidenceLevel(f));
  const sensor = fireSensor(f).toUpperCase();
  const severity = fireSeverity(f).toUpperCase();

  return `
    <div style="min-width:240px;">
      <b>NASA FIRMS thermal anomaly</b><br/>
      <small>Detected: ${dt}</small>
      <hr/>
      <table style="width:100%;font-size:12px;line-height:1.5;">
        <tr><td><b>Severity</b></td><td>${severity}</td></tr>
        <tr><td><b>Sensor</b></td><td>${safeText(sensor)}</td></tr>
        <tr><td><b>Confidence</b></td><td>${confidence}</td></tr>
        <tr><td><b>FRP</b></td><td>${frp.toFixed(1)}</td></tr>
        <tr><td><b>Brightness</b></td><td>${safeText(br)}</td></tr>
        <tr><td><b>Lat / Lng</b></td><td>${lat.toFixed(4)}, ${lng.toFixed(4)}</td></tr>
      </table>
      <hr/>
      <small>Thermal anomaly only. It is not automatic proof of a military strike.</small>
    </div>
  `;
}

function getFiresGeneratedAt(payload) {
  const raw = payload?.generated_at || payload?.updated_at || payload?.last_update || payload?.timestamp || "";
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  return String(raw);
}

async function refreshFiresSafe() {
  readFiresUiState();
  bindFiresUi();

  if (!firesEnabled) {
    updateFiresUiStats();
    return;
  }

  setFirmsStatus("Loading", "warn");

  try {
    const res = await fetch("fires.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`fires.json HTTP ${res.status}`);
    const payload = await res.json();

    const list = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.fires) ? payload.fires : []);

    firesLastUpdate = Array.isArray(payload) ? "—" : getFiresGeneratedAt(payload);

    firesLayer.clearLayers();

    const heatPts = [];
    let added = 0;
    let high = 0;
    let frpSum = 0;
    let maxFrp = 0;
    let totalAfterBBox = 0;

    for (const f of list) {
      const lat = Number(f?.lat ?? f?.latitude);
      const lng = Number(f?.lng ?? f?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!inMiddleEastBBox(lat, lng)) continue;
      if (!inFireArea(lat, lng)) continue;
      totalAfterBBox++;

      if (!passFiresAgeFilter(f)) continue;
      if (!passFiresSensorFilter(f)) continue;
      if (!passFiresConfidenceFilter(f)) continue;
      if (!passFiresFrpFilter(f)) continue;

      const frp = fireFrp(f);
      const severity = fireSeverity(f);
      const confidence = fireConfidenceLevel(f);

      if (confidence === "high") high++;
      frpSum += frp;
      maxFrp = Math.max(maxFrp, frp);

      if (firesMarkersEnabled) {
        const icon = L.divIcon({
          className: "",
          html: fireIconHtml(f),
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        });

        const m = L.marker([lat, lng], { icon });
        m.bindPopup(buildFirePopup(f, lat, lng));
        firesLayer.addLayer(m);
      }

      const heatIntensity = severity === "extreme" ? 3.0 : severity === "high" ? 2.2 : severity === "medium" ? 1.2 : 0.55;
      heatPts.push([lat, lng, heatIntensity]);
      added++;
    }

    if (firesHeat && map.hasLayer(firesHeat)) map.removeLayer(firesHeat);
    firesHeat = null;

    if (firesHeatEnabled && heatPts.length) {
      firesHeat = L.heatLayer(heatPts, { radius: 28, blur: 20, maxZoom: 8 });
      firesHeat.addTo(map);
      firesHeat.bringToBack();
      if (bordersLayer && map.hasLayer(bordersLayer)) bordersLayer.bringToBack();
    }

    firesLastVisibleStats = {
      visible: added,
      high,
      avgFrp: added ? frpSum / added : 0,
      maxFrp,
      totalAfterBBox
    };

    updateFiresUiStats();
    setFirmsStatus("Online", "online");

    if (added === 0) {
      console.warn("[fires] 0 visible markers after filters.", {
        firesAgeMode,
        firesSensorMode,
        firesConfidenceMode,
        firesFrpMin,
        firesAreaMode,
        totalAfterBBox
      });
    }

  } catch (e) {
    console.warn("[fires] refresh failed:", e?.message || e);
    setFirmsStatus("Error", "error");
    firesLastVisibleStats = { visible: 0, high: 0, avgFrp: 0, maxFrp: 0, totalAfterBBox: 0 };
    updateFiresUiStats();
  }
}

function setFiresEnabled(on) {
  firesEnabled = !!on;
  const checkbox = document.getElementById("firesCheckbox");
  if (checkbox) checkbox.checked = firesEnabled;

  if (firesEnabled) {
    if (!map.hasLayer(firesLayer)) firesLayer.addTo(map);
    refreshFiresSafe();
  } else {
    if (map.hasLayer(firesLayer)) map.removeLayer(firesLayer);
    if (firesHeat && map.hasLayer(firesHeat)) map.removeLayer(firesHeat);
    setFirmsStatus("Off", "neutral");
    updateFiresUiStats();
  }
}

function setFiresMarkersEnabled(on) {
  firesMarkersEnabled = !!on;
  if (firesEnabled) refreshFiresSafe();
}

function setFiresHeatEnabled(on) {
  firesHeatEnabled = !!on;
  if (firesEnabled) refreshFiresSafe();
}

// refresh every 10 minutes
window.setInterval(() => {
  if (firesEnabled) refreshFiresSafe();
}, 10 * 60 * 1000);

    // ===== Israel military activity layer (data/israel-activity.json) =====
    let israelActivityEnabled = false;
    let israelActivityScriptLoading = null;

    const israelActivityFilters = {
      gaza: true,
      lebanon: true,
      airstrike: true,
      ground_activity: true,
      artillery: true,
      cross_border_fire: true,
      drone_activity: true,
      evacuation_warning: true,
      humanitarian_zone: true
    };

    window.israelActivityFilters = israelActivityFilters;

    function loadScriptOnce(src) {
      return new Promise((resolve, reject) => {
        const existing = [...document.scripts].find((s) => s.getAttribute("src") === src || s.src.endsWith(src));
        if (existing) {
          if (window.loadIsraelActivityLayer) resolve();
          else existing.addEventListener("load", () => resolve(), { once: true });
          return;
        }

        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Script load failed: ${src}`));
        document.body.appendChild(script);
      });
    }

    async function ensureIsraelActivityLayerLoaded() {
      if (window.loadIsraelActivityLayer) return;
      if (!israelActivityScriptLoading) {
        israelActivityScriptLoading = loadScriptOnce("js/israel-activity-layer.js");
      }
      await israelActivityScriptLoading;
      if (!window.loadIsraelActivityLayer) {
        throw new Error("window.loadIsraelActivityLayer is not available after script load.");
      }
    }

    function syncIsraelActivityFiltersFromUi() {
      const getChecked = (id, fallback = true) => {
        const el = document.getElementById(id);
        return el ? !!el.checked : fallback;
      };

      israelActivityFilters.gaza = getChecked("israelGazaCheckbox", true);
      israelActivityFilters.lebanon = getChecked("israelLebanonCheckbox", true);
      israelActivityFilters.airstrike = getChecked("israelAirstrikeCheckbox", true);
      israelActivityFilters.ground_activity = getChecked("israelGroundActivityCheckbox", true);
      israelActivityFilters.artillery = getChecked("israelArtilleryCheckbox", true);
      israelActivityFilters.cross_border_fire = getChecked("israelCrossBorderFireCheckbox", true);
      israelActivityFilters.drone_activity = getChecked("israelDroneActivityCheckbox", true);
      israelActivityFilters.evacuation_warning = getChecked("israelEvacuationWarningCheckbox", true);
      israelActivityFilters.humanitarian_zone = getChecked("israelHumanitarianZoneCheckbox", true);

      window.israelActivityFilters = israelActivityFilters;
    }

    async function refreshIsraelActivitySafe() {
      if (!israelActivityEnabled) return;
      try {
        syncIsraelActivityFiltersFromUi();
        await ensureIsraelActivityLayerLoaded();
        if (typeof window.refreshIsraelActivityLayer === "function") {
          await window.refreshIsraelActivityLayer();
        }
        if (window.israelActivityLayer && !map.hasLayer(window.israelActivityLayer)) {
          window.israelActivityLayer.addTo(map);
        }
      } catch (e) {
        console.warn("[israel-activity] refresh failed:", e?.message || e);
      }
    }

    async function setIsraelActivityEnabled(on) {
      israelActivityEnabled = !!on;
      try {
        if (israelActivityEnabled) {
          syncIsraelActivityFiltersFromUi();
          await ensureIsraelActivityLayerLoaded();
          await window.loadIsraelActivityLayer(map);
        } else {
          if (window.israelActivityLayer && map.hasLayer(window.israelActivityLayer)) {
            map.removeLayer(window.israelActivityLayer);
          }
          if (typeof window.clearIsraelActivityLayer === "function") {
            window.clearIsraelActivityLayer();
          }
        }
      } catch (e) {
        console.warn("[israel-activity] toggle failed:", e?.message || e);
      }
    }

    window.setInterval(() => {
      if (israelActivityEnabled) refreshIsraelActivitySafe();
    }, 5 * 60 * 1000);

    
    // ===== Control panel slicing into accordions (HARD, stable) =====
    // We move:
    // - first two .row (heat/weekly + borders/clear) into Layers
    // - everything else into Filters
    const controlTitle = controlPanel.querySelector("h3");
    const directRows = [...controlPanel.querySelectorAll(":scope > .row")];
    const firstRow = directRows[0] || null;
    const secondRow = directRows[1] || null;

    // Remove any static Israel control block from index.html before rebuilding the control panel.
    // The dynamic block below is the single source of truth for this layer UI.
    [
      "israelActivityCheckbox",
      "israelGazaCheckbox",
      "israelLebanonCheckbox",
      "israelAirstrikeCheckbox",
      "israelGroundActivityCheckbox",
      "israelArtilleryCheckbox",
      "israelCrossBorderFireCheckbox",
      "israelDroneActivityCheckbox",
      "israelEvacuationWarningCheckbox",
      "israelHumanitarianZoneCheckbox"
    ].forEach((id) => {
      const el = document.getElementById(id);
      const block = el?.closest?.(".israel-activity-control-block") || el?.closest?.("[data-control-block='israel-activity']");
      if (block) block.remove();
    });

    const layersBox = document.createElement("div");
    const filtersBox = document.createElement("div");

    // Move first two rows to Layers
    if (firstRow) layersBox.appendChild(firstRow);
    if (secondRow) layersBox.appendChild(secondRow);

    // Add NEW layer toggles (events / aircraft / reports / pois / fires)
    const layersExtra = document.createElement("div");
    layersExtra.innerHTML = `
      <div class="row" style="margin-top:6px;">
        <label><input id="eventsLayerCheckbox" type="checkbox" checked /> Events (news/ISW)</label>
      </div>

      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.10);">
        <div class="muted" style="margin-bottom:6px;">Aircraft</div>
        <div class="row">
          <label><input id="aircraftCheckbox" type="checkbox" checked /> Aircraft layer</label>
        </div>
        <div class="row">
          <label><input id="aircraftMilitaryOnlyCheckbox" type="checkbox" /> Military only</label>
          <label><input id="aircraftTracksCheckbox" type="checkbox" checked /> Tracks</label>
        </div>
        <div class="muted" style="margin-top:6px;">Civil is ON by default. “Military only” is heuristic.</div>
      </div>

      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.10);">
        <div class="muted" style="margin-bottom:6px;">Crowd reports</div>
        <div class="row">
          <label><input id="reportsCheckbox" type="checkbox" checked /> Reports (reports.json)</label>
          <span class="btn-mini" id="reportsRefreshBtn">Refresh</span>
        </div>
        <div class="muted">Source: Mastodon/Reddit RSS pipeline.</div>
      </div>

      <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.10);">
        <div class="muted" style="margin-bottom:6px;">Strategic POIs</div>
        <div class="row">
          <label><input id="poisCheckbox" type="checkbox" checked /> POIs (pois.json)</label>
          <span class="btn-mini" id="poisReloadBtn">Reload</span>
        </div>
      </div>

      <div class="israel-activity-control-block" data-control-block="israel-activity" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.10);">
        <div class="muted" style="margin-bottom:6px;">Israel military activity</div>
        <div class="row">
          <label><input id="israelActivityCheckbox" type="checkbox" /> Israel Activity (Gaza / Lebanon)</label>
          <span class="btn-mini" id="israelActivityRefreshBtn">Refresh</span>
        </div>
        <div class="row">
          <label><input id="israelGazaCheckbox" type="checkbox" checked /> Gaza</label>
          <label><input id="israelLebanonCheckbox" type="checkbox" checked /> South Lebanon</label>
        </div>
        <div class="row">
          <label><input id="israelAirstrikeCheckbox" type="checkbox" checked /> Airstrikes</label>
          <label><input id="israelGroundActivityCheckbox" type="checkbox" checked /> Ground</label>
        </div>
        <div class="row">
          <label><input id="israelArtilleryCheckbox" type="checkbox" checked /> Artillery</label>
          <label><input id="israelCrossBorderFireCheckbox" type="checkbox" checked /> Border fire</label>
        </div>
        <div class="row">
          <label><input id="israelDroneActivityCheckbox" type="checkbox" checked /> Drones</label>
          <label><input id="israelEvacuationWarningCheckbox" type="checkbox" checked /> Warnings</label>
        </div>
        <div class="row">
          <label><input id="israelHumanitarianZoneCheckbox" type="checkbox" checked /> Humanitarian zones</label>
        </div>
        <div class="muted">OSINT-alapú, késleltetett eseményréteg. Nem valós idejű taktikai térkép.</div>
      </div>

      <div class="firms-control-block" data-control-block="firms" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.10);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
          <div class="muted" style="font-weight:800;color:#22313d;">NASA FIRMS</div>
          <span id="firmsStatusBadge" class="badge-mini">Off</span>
        </div>

        <div class="muted" style="margin-top:8px;margin-bottom:5px;">Analysis area</div>
        <select id="firesAreaSelect">
          <option value="middle_east" selected>Entire Middle East</option>
          <option value="israel_gaza">Israel–Gaza</option>
          <option value="gaza">Gaza Strip</option>
          <option value="west_bank">West Bank</option>
          <option value="israel_lebanon">Israel–Lebanon</option>
          <option value="south_lebanon">South Lebanon</option>
          <option value="syria">Syria</option>
          <option value="iraq">Iraq</option>
          <option value="yemen">Yemen</option>
          <option value="iran">Iran</option>
        </select>
        <div class="row" style="margin-top:6px;">
          <span class="btn-mini" id="firesAreaZoomBtn">Zoom to area</span>
        </div>

        <div class="row">
          <label><input id="firesCheckbox" type="checkbox" /> FIRMS layer</label>
          <span class="btn-mini" id="firesRefreshBtn">Refresh</span>
        </div>

        <div class="row">
          <label><input id="firesMarkersCheckbox" type="checkbox" checked /> Hotspot markers</label>
          <label><input id="firesHeatCheckbox" type="checkbox" checked /> Heatmap</label>
        </div>

        <div class="muted" style="margin-top:8px;margin-bottom:5px;">Time window</div>
        <div class="row">
          <label><input type="radio" name="firesAge" value="24h" /> 24h</label>
          <label><input type="radio" name="firesAge" value="3d" /> 3d</label>
          <label><input type="radio" name="firesAge" value="7d" checked /> 7d</label>
          <label><input type="radio" name="firesAge" value="15d" /> 15d</label>
          <label><input type="radio" name="firesAge" value="30d" /> 30d</label>
          <label><input type="radio" name="firesAge" value="all" /> All</label>
        </div>

        <div class="muted" style="margin-top:8px;margin-bottom:5px;">Sensor</div>
        <div class="row">
          <label><input type="radio" name="firesSensor" value="all" checked /> All</label>
          <label><input type="radio" name="firesSensor" value="viirs" /> VIIRS</label>
          <label><input type="radio" name="firesSensor" value="modis" /> MODIS</label>
        </div>

        <div class="muted" style="margin-top:8px;margin-bottom:5px;">Confidence</div>
        <div class="row">
          <label><input type="radio" name="firesConfidence" value="all" checked /> All</label>
          <label><input type="radio" name="firesConfidence" value="high" /> High</label>
          <label><input type="radio" name="firesConfidence" value="nominal" /> Nominal</label>
          <label><input type="radio" name="firesConfidence" value="low" /> Low</label>
        </div>

        <div class="muted" style="margin-top:8px;margin-bottom:5px;">FRP threshold</div>
        <select id="firesFrpSelect">
          <option value="0" selected>0+</option>
          <option value="10">10+</option>
          <option value="25">25+</option>
          <option value="50">50+</option>
          <option value="100">100+</option>
        </select>

        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <div class="mini-item"><div class="name">Visible</div><div class="val" id="firmsVisibleCount">0</div></div>
          <div class="mini-item"><div class="name">High conf.</div><div class="val" id="firmsHighCount">0</div></div>
          <div class="mini-item"><div class="name">Avg FRP</div><div class="val" id="firmsAvgFrp">0.0</div></div>
          <div class="mini-item"><div class="name">Max FRP</div><div class="val" id="firmsMaxFrp">0.0</div></div>
        </div>

        <div class="muted" style="margin-top:8px;">Last update: <span id="firmsLastUpdate">—</span></div>

        <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
          <div class="muted"><span class="event-dot" style="background:#fcbf49;"></span> Low FRP</div>
          <div class="muted"><span class="event-dot" style="background:#f77f00;"></span> Medium FRP</div>
          <div class="muted"><span class="event-dot" style="background:#d62828;"></span> High FRP</div>
          <div class="muted"><span class="event-dot" style="background:#7b2cbf;"></span> Extreme FRP</div>
        </div>

        <div class="muted" style="margin-top:8px;line-height:1.45;">
          NASA FIRMS thermal anomalies. A hotspot does not automatically mean a military strike. Concentrated and repeated anomalies may support an activity assessment.
        </div>
      </div>
    `;
    layersBox.appendChild(layersExtra);

    // Move all remaining nodes into Filters (everything still inside controlPanel except the title we keep)
    const remaining = [...controlPanel.children].filter((ch) => ch !== controlTitle);
    for (const node of remaining) {
      // after moving firstRow/secondRow, they’re already relocated; skip if not in DOM
      if (node === firstRow || node === secondRow) continue;
      // any other leftover nodes -> filters
      filtersBox.appendChild(node);
    }

    // Rebuild controlPanel
    controlPanel.innerHTML = "";
    controlPanel.appendChild(controlTitle);
    controlPanel.appendChild(makeAccSection("Layers", layersBox, true));
    controlPanel.appendChild(makeAccSection("Filters", filtersBox, false));

    // ===== Bind NEW layer UI handlers =====
    const eventsLayerCheckbox = document.getElementById("eventsLayerCheckbox");
    const aircraftCheckbox = document.getElementById("aircraftCheckbox");
    const aircraftMilitaryOnlyCheckbox = document.getElementById("aircraftMilitaryOnlyCheckbox");
    const aircraftTracksCheckbox = document.getElementById("aircraftTracksCheckbox");

    const reportsCheckbox = document.getElementById("reportsCheckbox");
    const reportsRefreshBtn = document.getElementById("reportsRefreshBtn");

    const poisCheckbox = document.getElementById("poisCheckbox");
    const poisReloadBtn = document.getElementById("poisReloadBtn");

    const firesCheckbox = document.getElementById("firesCheckbox");
    const firesMarkersCheckbox = document.getElementById("firesMarkersCheckbox");
    const firesHeatCheckbox = document.getElementById("firesHeatCheckbox");
    const firesRefreshBtn = document.getElementById("firesRefreshBtn");

    const israelActivityCheckbox = document.getElementById("israelActivityCheckbox");
    const israelActivityRefreshBtn = document.getElementById("israelActivityRefreshBtn");
    const israelActivityFilterCheckboxes = [
      "israelGazaCheckbox",
      "israelLebanonCheckbox",
      "israelAirstrikeCheckbox",
      "israelGroundActivityCheckbox",
      "israelArtilleryCheckbox",
      "israelCrossBorderFireCheckbox",
      "israelDroneActivityCheckbox",
      "israelEvacuationWarningCheckbox",
      "israelHumanitarianZoneCheckbox"
    ].map((id) => document.getElementById(id)).filter(Boolean);

    eventsLayerCheckbox.addEventListener("change", (e) => { eventsEnabled = e.target.checked; updateAll(); });

    aircraftCheckbox.addEventListener("change", (e) => setAircraftEnabled(e.target.checked));
    aircraftMilitaryOnlyCheckbox.addEventListener("change", (e) => aircraft.setMilitaryOnly(e.target.checked));
    aircraftTracksCheckbox.addEventListener("change", (e) => aircraft.setShowTracks(e.target.checked));

    reportsCheckbox.addEventListener("change", (e) => setReportsEnabled(e.target.checked));
    reportsRefreshBtn.addEventListener("click", () => refreshReportsSafe());

    poisCheckbox.addEventListener("change", (e) => setPoisEnabled(e.target.checked));
    poisReloadBtn.addEventListener("click", async () => { poisLoaded = false; await loadPoisOnce(); });

    if (firesCheckbox) firesCheckbox.addEventListener("change", (e) => setFiresEnabled(e.target.checked));
    if (firesMarkersCheckbox) firesMarkersCheckbox.addEventListener("change", (e) => setFiresMarkersEnabled(e.target.checked));
    if (firesHeatCheckbox) firesHeatCheckbox.addEventListener("change", (e) => setFiresHeatEnabled(e.target.checked));
    if (firesRefreshBtn) firesRefreshBtn.addEventListener("click", () => refreshFiresSafe());
    bindFiresUi();
    updateFiresUiStats();

    if (israelActivityCheckbox) {
      israelActivityCheckbox.addEventListener("change", (e) => setIsraelActivityEnabled(e.target.checked));
    }
    if (israelActivityRefreshBtn) {
      israelActivityRefreshBtn.addEventListener("click", () => refreshIsraelActivitySafe());
    }
    israelActivityFilterCheckboxes.forEach((cb) => {
      cb.addEventListener("change", () => refreshIsraelActivitySafe());
    });

    // Start layers
    setAircraftEnabled(true);
    setReportsEnabled(true);
    setPoisEnabled(true);

    // ===== Borders UI =====
    function applyBordersStyleNowSafe() {
      try { applyBordersStyleNow(); } catch {}
    }

    // ===== Wiring (existing) =====
    function refresh() { updateAll(); }

    slider.addEventListener("input", refresh);
    searchInput.addEventListener("input", refresh);
    catCheckboxes.forEach((cb) => cb.addEventListener("change", refresh));
    srcCheckboxes.forEach((cb) => cb.addEventListener("change", refresh));
    windowRadios.forEach((r) => r.addEventListener("change", refresh));

    heatCheckbox.addEventListener("change", refresh);
    weeklyHeatCheckbox.addEventListener("change", () => {
      if (!weeklyHeatCheckbox.checked) renderHotspotList([]);
      refresh();
    });

    regionSelect.addEventListener("change", async () => {
      activeRegion = regionSelect.value || "ALL";
      updateRegionNote();
      await zoomToRegion(activeRegion);
      applyBordersStyleNowSafe();
      refresh();
    });
    regionClear.addEventListener("click", async () => {
      activeRegion = "ALL";
      regionSelect.value = "ALL";
      updateRegionNote();
      applyBordersStyleNowSafe();
      refresh();
    });

    borderWeightSlider.addEventListener("input", () => {
      borderWeight = Number(borderWeightSlider.value);
      syncBorderLabels();
      applyBordersStyleNowSafe();
    });
    borderOpacitySlider.addEventListener("input", () => {
      borderOpacity = Number(borderOpacitySlider.value);
      syncBorderLabels();
      applyBordersStyleNowSafe();
    });
    borderFillCheckbox.addEventListener("change", () => {
      borderFillOn = borderFillCheckbox.checked;
      applyBordersStyleNowSafe();
    });
    borderFillOpacitySlider.addEventListener("input", () => {
      borderFillOpacity = Number(borderFillOpacitySlider.value);
      syncBorderLabels();
      applyBordersStyleNowSafe();
    });

    // ===== Main updater =====
    function updateAll() {
      const selectedIndex = Number(slider.value);
      const selectedDate = days365[selectedIndex];
      const windowDays = getWindowDays();
      label.textContent = selectedDate || "—";

      applyBordersStyleNowSafe();

      const filterFn = filterBuilder(selectedIndex, windowDays);
      const visible = computeVisible(selectedIndex, windowDays, filterFn);

      // Events markers
      clusterGroup.clearLayers();
      markerByEventId.clear();
      if (eventsEnabled) {
        for (const ev of visible) {
          const m = makeMarker(ev);
          if (!m) continue;
          clusterGroup.addLayer(m);
          if (ev.id) markerByEventId.set(ev.id, m);
        }
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

    // ===== Load events =====
    fetch("events.json")
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("events.json must be an array");
        eventsData = data.map((ev, i) => {
          const hasId = ev && (typeof ev.id === "string" || typeof ev.id === "number");
          if (hasId) return ev;
          const seed = `${ev?.date || ""}|${ev?.title || ""}|${ev?.location?.name || ""}|${i}`;
          const id = "e_" + btoa(unescape(encodeURIComponent(seed))).replace(/=+/g, "").slice(0, 18);
          return { ...ev, id };
        });
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
