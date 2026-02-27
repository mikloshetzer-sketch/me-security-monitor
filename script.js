window.addEventListener("DOMContentLoaded", () => {
  try {
    const $ = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing element: #${id}`);
      return el;
    };

    // ===== Panels =====
    const controlPanel = $("controlPanel");
    const timelinePanel = $("timelinePanel");
    const legendPanel = $("legendPanel");

    const controlToggle = $("controlToggle");
    const timelineToggle = $("timelineToggle");
    const legendToggle = $("legendToggle");

    function togglePanel(panelEl) {
      const isClosed = panelEl.classList.contains("closed");
      panelEl.classList.toggle("closed");

      // bombabiztos: inline display felülírja az esetleges CSS display:none-t
      if (isClosed) panelEl.style.display = "block";
      else panelEl.style.display = "none";
    }

    // Panels start closed (as requested)
    controlPanel.classList.add("closed");
    timelinePanel.classList.add("closed");
    legendPanel.classList.add("closed");
    controlPanel.style.display = "none";
    timelinePanel.style.display = "none";
    legendPanel.style.display = "none";

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
        if (wasClosed) setTimeout(() => updateMapAndList(), 80);
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

    // ===== UI refs =====
    const heatCheckbox = $("heatmapCheckbox");
    const bordersCheckbox = $("bordersCheckbox");

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
    const listContainer = $("eventsList");
    const searchInput = $("eventSearch");

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
    const trendBox = trendCanvas.closest(".trend") || timelinePanel;

    const spikeBadge = $("spikeBadge");
    const spikeText = $("spikeText");
    const spikeDetails = $("spikeDetails");

    const countryRiskList = $("countryRiskList");
    const countryRiskNote = $("countryRiskNote");

    const escalationList = $("escalationList");
    const escNote = $("escNote");

    const catCheckboxes = [...document.querySelectorAll(".cat-filter")];
    const srcCheckboxes = [...document.querySelectorAll(".src-filter")];
    const windowRadios = [...document.querySelectorAll("input[name='window']")];

    // ===== Date =====
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

    // ===== Region =====
    let activeRegion = "ALL";
    const normalize = (s) => String(s || "").trim().toLowerCase();

    const REGION_ALIASES = {
      LEVANT: new Set(["israel","lebanon","syria","jordan","iraq","palestine","palestinian territories","palestinian territory","west bank","gaza","gaza strip"]),
      GULF: new Set(["saudi arabia","united arab emirates","uae","qatar","bahrain","kuwait","oman","yemen","iran"]),
      NORTH: new Set(["egypt","turkey"]),
    };

    function regionContainsCountry(region, countryName) {
      if (!region || region === "ALL") return true;
      const set = REGION_ALIASES[region];
      if (!set) return true;
      const c = normalize(countryName);
      if (set.has(c)) return true;
      if (region === "LEVANT" && (c.includes("palestin") || c.includes("gaza") || c.includes("west bank"))) return true;
      return false;
    }

    function updateRegionNote() {
      regionNote.textContent = (activeRegion === "ALL") ? "No region filter" : `Region: ${activeRegion}`;
    }
    updateRegionNote();

    // ===== Borders =====
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
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
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

    // ===== Minimal event plumbing (keep your existing logic) =====
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
    function sourceType(ev) {
      const t = normalize(ev?.source?.type || "news");
      return t === "isw" ? "isw" : "news";
    }
    function categoryColor(cat) {
      const c = normalize(cat);
      if (c === "military") return "#ff5a5a";
      if (c === "political") return "#4ea1ff";
      if (c === "security") return "#ffd84e";
      return "#b7b7b7";
    }
    function getLatLng(ev) {
      const lat = Number(ev?.location?.lat);
      const lng = Number(ev?.location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    }
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
      const srcLine = srcUrl ? `<a href="${srcUrl}" target="_blank" rel="noreferrer">${srcName || "source"}</a>` : `${srcName}`;
      m.bindPopup(`<b>${ev.title || "Untitled"}</b><br>${ev.summary || ""}<br><small>${srcLine}</small>`);
      return m;
    }

    // Country inference (simple: try polygon if borders loaded; else fallback)
    function bboxContains(bbox, lng, lat) {
      return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
    }
    function pointInRing(lng, lat, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
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
      if (ll) {
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

    // filters
    function matchesSearch(ev, q) {
      if (!q) return true;
      const t = normalize(ev.title);
      const s = normalize(ev.summary);
      const tags = Array.isArray(ev.tags) ? ev.tags.map(normalize).join(" ") : "";
      const loc = normalize(ev?.location?.name);
      return t.includes(q) || s.includes(q) || tags.includes(q) || loc.includes(q);
    }
    function matchesRegion(ev) {
      if (activeRegion === "ALL") return true;
      return regionContainsCountry(activeRegion, getCountry(ev));
    }

    // ===== Heatmap (normal) =====
    let heatLayer = null;
    function clearHeatLayer() { if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer); heatLayer = null; }

    function categoryWeight(cat) {
      const c = normalize(cat || "other");
      if (c === "military") return 3.0;
      if (c === "security") return 2.0;
      if (c === "political") return 1.0;
      return 0.5;
    }
    function sourceMultiplier(ev) { return sourceType(ev) === "isw" ? 1.3 : 1.0; }
    function recencyWeight(eventIndex, selectedIndex, windowDays) {
      const ageDays = selectedIndex - eventIndex;
      if (windowDays <= 1) return 1.0;
      const t = ageDays / (windowDays - 1);
      return 1.0 - 0.6 * t;
    }
    function eventRiskScore(ev, eventIndex, selectedIndex, windowDays) {
      return categoryWeight(ev.category) * sourceMultiplier(ev) * recencyWeight(eventIndex, selectedIndex, windowDays);
    }

    function updateHeatmap(visibleEvents, selectedIndex, windowDays) {
      if (!heatCheckbox.checked) { clearHeatLayer(); return; }
      const points = [];
      for (const ev of visibleEvents) {
        const ll = getLatLng(ev);
        if (!ll) continue;
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const w = eventRiskScore(ev, idx, selectedIndex, windowDays);
        points.push([ll.lat, ll.lng, w]);
      }
      clearHeatLayer();
      if (!points.length) return;
      heatLayer = L.heatLayer(points, { radius: 28, blur: 22, maxZoom: 9 });
      heatLayer.addTo(map);
      heatLayer.bringToBack();
      if (bordersLayer && map.hasLayer(bordersLayer)) bordersLayer.bringToBack();
    }

    // ===== Data =====
    let eventsData = [];
    const markerByEventId = new Map();

    function updateMapAndList() {
      const selectedIndex = Number(slider.value);
      const selectedDate = days365[selectedIndex];
      const windowDays = getWindowDays();
      const cats = getSelectedCategories();
      const srcs = getSelectedSources();
      const q = normalize(searchInput.value).trim();

      label.textContent = selectedDate;

      const visible = [];
      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;

        const within = idx <= selectedIndex && idx >= selectedIndex - (windowDays - 1);
        if (!within) continue;

        const cat = normalize(ev.category || "other");
        if (!cats.has(cat)) continue;

        const st = sourceType(ev);
        if (!srcs.has(st)) continue;

        if (!matchesSearch(ev, q)) continue;
        if (!matchesRegion(ev)) continue;

        visible.push(ev);
      }

      // borders style (region highlight)
      applyBordersStyleNow();

      // map markers
      clusterGroup.clearLayers();
      markerByEventId.clear();
      for (const ev of visible) {
        const m = makeMarker(ev);
        if (!m) continue;
        clusterGroup.addLayer(m);
        if (ev.id) markerByEventId.set(ev.id, m);
      }

      // heatmap
      updateHeatmap(visible, selectedIndex, windowDays);

      // minimal stats to keep UI not empty
      statsTotalEl.textContent = String(visible.length);
      statsMilEl.textContent = String(visible.filter(e => normalize(e.category)==="military").length);
      statsSecEl.textContent = String(visible.filter(e => normalize(e.category)==="security").length);
      statsPolEl.textContent = String(visible.filter(e => normalize(e.category)==="political").length);
      statsOthEl.textContent = String(visible.filter(e => normalize(e.category)==="other").length);
      statsNewsEl.textContent = String(visible.filter(e => sourceType(e)==="news").length);
      statsIswEl.textContent = String(visible.filter(e => sourceType(e)==="isw").length);

      // simple risk
      let totalRisk = 0;
      const byLoc = new Map();
      for (const ev of visible) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const locName = (ev?.location?.name || "Unknown").trim() || "Unknown";
        const score = eventRiskScore(ev, idx, selectedIndex, windowDays);
        totalRisk += score;
        byLoc.set(locName, (byLoc.get(locName) || 0) + score);
      }
      riskTotalEl.textContent = totalRisk.toFixed(1);
      const topLoc = [...byLoc.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
      riskListEl.innerHTML = topLoc.length
        ? topLoc.map(([n,v]) => `<div class="risk-row"><div class="name">${n}</div><div class="val">${v.toFixed(1)}</div></div>`).join("")
        : `<div class="muted">No risk data.</div>`;

      // alerts label
      spikeBadge.className = "badge-mini badge-ok";
      spikeBadge.textContent = "OK";
      spikeText.textContent = `Region=${activeRegion} · events=${visible.length}`;
      spikeDetails.innerHTML = "";

      // country list
      const byC = new Map();
      for (const ev of visible) {
        const c = getCountry(ev);
        byC.set(c, (byC.get(c)||0)+1);
      }
      const topC = [...byC.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10);
      countryRiskNote.textContent = "Counts in current view";
      countryRiskList.innerHTML = topC.length
        ? topC.map(([n,v]) => `<div class="rank-row"><div class="name">${n}</div><div class="val">${v}</div></div>`).join("")
        : `<div class="muted">No country data.</div>`;

      // trend stub (keep canvas alive)
      trendTotalEl.textContent = String(visible.length);
      trendRangeEl.textContent = `${days365[Math.max(0, selectedIndex-(windowDays-1))]} → ${selectedDate} (${windowDays} days)`;

      // escalation stub
      escNote.textContent = "—";
      escalationList.innerHTML = `<div class="muted">—</div>`;

      // list
      listContainer.innerHTML = "";
      if (!visible.length) {
        listContainer.innerHTML = `<div class="muted">No events for current filters/region.</div>`;
        return;
      }
      visible
        .slice()
        .sort((a,b)=> (b.date+(b.title||"")).localeCompare(a.date+(a.title||"")))
        .forEach((ev) => {
          const row = document.createElement("div");
          row.className = "event-row";
          const st = sourceType(ev).toUpperCase();
          const locName = ev?.location?.name ? ` · ${ev.location.name}` : "";
          const ctry = getCountry(ev);
          row.innerHTML = `
            <div class="event-row-title">${ev.title || "Untitled"}</div>
            <div class="event-row-meta">
              <span>${st}</span>
              <span>${(ev.category || "other")} · ${ev.date}${locName} · ${ctry}</span>
            </div>`;
          row.onclick = () => {
            const ll = getLatLng(ev);
            if (ll) map.setView([ll.lat, ll.lng], Math.max(map.getZoom(), 9));
            const m = ev.id ? markerByEventId.get(ev.id) : null;
            if (m) m.openPopup();
          };
          listContainer.appendChild(row);
        });
    }

    // ===== Wiring =====
    function refresh() { updateMapAndList(); }

    slider.addEventListener("input", refresh);
    catCheckboxes.forEach((cb) => cb.addEventListener("change", refresh));
    srcCheckboxes.forEach((cb) => cb.addEventListener("change", refresh));
    windowRadios.forEach((r) => r.addEventListener("change", refresh));
    searchInput.addEventListener("input", refresh);
    heatCheckbox.addEventListener("change", refresh);

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
      .then((data) => {
        if (!Array.isArray(data)) throw new Error("events.json must be an array");
        eventsData = data.map((ev, i) => {
          const hasId = ev && (typeof ev.id === "string" || typeof ev.id === "number");
          if (hasId) return ev;
          const seed = `${ev?.date || ""}|${ev?.title || ""}|${ev?.location?.name || ""}|${i}`;
          const id = "e_" + btoa(unescape(encodeURIComponent(seed))).replace(/=+/g, "").slice(0, 18);
          return { ...ev, id };
        });
        updateMapAndList();
      })
      .catch((err) => {
        console.error(err);
        listContainer.innerHTML = `<div class="muted">events.json load error</div>`;
      });

  } catch (e) {
    console.error("Fatal init error:", e);
    alert("Hiba történt inicializáláskor. Nyisd meg a konzolt (F12) a részletekért.");
  }
});
