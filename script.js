window.addEventListener("DOMContentLoaded", () => {
  try {
    const $ = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing element: #${id}`);
      return el;
    };

    // ----- Panels -----
    const controlPanel = $("controlPanel");
    const timelinePanel = $("timelinePanel");
    const legendPanel = $("legendPanel");

    const controlToggle = $("controlToggle");
    const timelineToggle = $("timelineToggle");
    const legendToggle = $("legendToggle");

    function togglePanel(panelEl) {
      const wasClosed = panelEl.classList.contains("closed");
      panelEl.classList.toggle("closed");
      if (wasClosed && panelEl === timelinePanel) setTimeout(() => updateMapAndList(), 80);
    }
    controlToggle.addEventListener("click", () => togglePanel(controlPanel));
    timelineToggle.addEventListener("click", () => togglePanel(timelinePanel));
    legendToggle.addEventListener("click", () => togglePanel(legendPanel));

    // ----- Accordion -----
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
        const isClosed = panel.classList.contains("closed");
        panel.classList.toggle("closed");
        setArrow(btn, isClosed);
        if (
          (targetId === "accTrend" ||
            targetId === "accAlerts" ||
            targetId === "accCountryRisk" ||
            targetId === "accEscalation") &&
          isClosed
        ) {
          setTimeout(() => updateMapAndList(), 80);
        }
      });
    });

    // ----- Map -----
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

    // ----- Heatmap (normal) -----
    const heatCheckbox = $("heatmapCheckbox");
    heatCheckbox.checked = false;
    let heatLayer = null;

    // ✅ Weekly anomaly checkbox (dynamic UI)
    let weeklyHeatCheckbox = document.getElementById("weeklyHeatCheckbox");
    if (!weeklyHeatCheckbox) {
      const wrap = document.createElement("label");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";
      wrap.style.marginTop = "8px";
      wrap.style.userSelect = "none";

      weeklyHeatCheckbox = document.createElement("input");
      weeklyHeatCheckbox.type = "checkbox";
      weeklyHeatCheckbox.id = "weeklyHeatCheckbox";

      const span = document.createElement("span");
      span.textContent = "Weekly anomaly heatmap (7d vs prev 7d)";
      span.style.fontSize = "12px";
      span.style.opacity = "0.95";

      wrap.appendChild(weeklyHeatCheckbox);
      wrap.appendChild(span);

      const normalHeatRow = heatCheckbox.closest("label") || heatCheckbox.parentElement;
      if (normalHeatRow && normalHeatRow.parentElement) {
        normalHeatRow.parentElement.insertBefore(wrap, normalHeatRow.nextSibling);
      } else {
        controlPanel.appendChild(wrap);
      }
    }

    // ----- Borders + Country polygons -----
    const BORDERS_GEOJSON_URL =
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

    const bordersCheckbox = $("bordersCheckbox");
    let bordersLayer = null;
    let bordersLoaded = false;

    let countryFeatures = [];
    const countryCache = new Map();
    let countryLoadRequested = false;

    function bordersStyle() {
      return { color: "#ffffff", weight: 2.2, opacity: 0.85, fillOpacity: 0 };
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
        const props = f.properties || {};
        const name =
          props.ADMIN || props.NAME || props.name || props.SOVEREIGNT || "Unknown";
        const geom = f.geometry;
        if (!geom || !geom.type || !geom.coordinates) continue;
        const bbox = computeBBoxFromCoords(geom.coordinates);
        countryFeatures.push({ name, bbox, geom });
      }
    }

    async function setBordersVisible(visible) {
      if (visible) {
        try {
          await ensureBordersLoaded();
          if (bordersLayer && !map.hasLayer(bordersLayer)) {
            bordersLayer.addTo(map);
            bordersLayer.bringToBack();
          }
        } catch (err) {
          console.error("Borders load failed:", err);
          alert("Nem sikerült betölteni az országhatárokat.");
          bordersCheckbox.checked = false;
        }
      } else {
        if (bordersLayer && map.hasLayer(bordersLayer)) map.removeLayer(bordersLayer);
      }
    }

    setBordersVisible(!!bordersCheckbox.checked);
    bordersCheckbox.addEventListener("change", (e) => setBordersVisible(e.target.checked));

    // ----- Date -----
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

    // ----- Actors -----
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
    let activeCountry = null;

    // ----- UI refs -----
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

    // Alerts / country risk / escalation
    const spikeBadge = $("spikeBadge");
    const spikeText = $("spikeText");
    const spikeDetails = $("spikeDetails");

    const countryRiskList = $("countryRiskList");
    const countryRiskNote = $("countryRiskNote");

    const escalationList = $("escalationList");
    const escNote = $("escNote");

    slider.max = days365.length - 1;
    slider.value = days365.length - 1;

    const catCheckboxes = [...document.querySelectorAll(".cat-filter")];
    const srcCheckboxes = [...document.querySelectorAll(".src-filter")];
    const windowRadios = [...document.querySelectorAll("input[name='window']")];

    // ----- Data -----
    let eventsData = [];
    const markerByEventId = new Map();

    // ----- Helpers -----
    const normalize = (s) => String(s || "").toLowerCase();

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
      const srcLine = srcUrl
        ? `<a href="${srcUrl}" target="_blank" rel="noreferrer">${srcName || "source"}</a>`
        : `${srcName}`;

      m.bindPopup(
        `<b>${ev.title || "Untitled"}</b><br>${ev.summary || ""}<br><small>${srcLine}</small>`
      );

      return m;
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

    function getWindowDays() {
      const r = windowRadios.find((x) => x.checked);
      return Number(r?.value || 1);
    }

    function matchesSearch(ev, q) {
      if (!q) return true;
      const t = normalize(ev.title);
      const s = normalize(ev.summary);
      const tags = Array.isArray(ev.tags) ? ev.tags.map(normalize).join(" ") : "";
      const loc = normalize(ev?.location?.name);
      return t.includes(q) || s.includes(q) || tags.includes(q) || loc.includes(q);
    }

    function eventText(ev) {
      const tags = Array.isArray(ev.tags) ? ev.tags.join(" ") : "";
      const loc = ev?.location?.name || "";
      return normalize(`${ev.title || ""} ${ev.summary || ""} ${tags} ${loc}`);
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

    function matchesActorFilter(ev) {
      return !activeActor || actorsInEvent(ev).includes(activeActor);
    }

    function matchesPairFilter(ev) {
      if (!activePair) return true;
      const found = actorsInEvent(ev);
      return found.includes(activePair.a) && found.includes(activePair.b);
    }

    // ----- Country inference -----
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
          if (pointInPolygon(lng, lat, geom.coordinates)) {
            countryCache.set(key, cf.name);
            return cf.name;
          }
        } else if (geom.type === "MultiPolygon") {
          for (const poly of geom.coordinates) {
            if (pointInPolygon(lng, lat, poly)) {
              countryCache.set(key, cf.name);
              return cf.name;
            }
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

        if (!bordersLoaded && !countryLoadRequested) {
          countryLoadRequested = true;
          ensureBordersLoaded()
            .then(() => { countryLoadRequested = false; updateMapAndList(); })
            .catch((e) => { console.error("Country polygons load failed:", e); countryLoadRequested = false; });
        }
      }

      const name = (ev?.location?.name || "").trim();
      if (name.includes(",")) {
        const parts = name.split(",").map((s) => s.trim()).filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && last.length >= 3) return last;
      }

      return "Unknown";
    }

    function matchesCountryFilter(ev) {
      if (!activeCountry) return true;
      return getCountry(ev) === activeCountry;
    }

    // ----- Risk scoring -----
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

    // ----- Window filtering -----
    function computeBaseWindowEvents() {
      const selectedIndex = Number(slider.value);
      const selectedDate = days365[selectedIndex];
      const windowDays = getWindowDays();
      const selectedCats = getSelectedCategories();
      const selectedSrc = getSelectedSources();
      const q = normalize(searchInput.value).trim();

      const out = [];
      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;

        const within = idx <= selectedIndex && idx >= selectedIndex - (windowDays - 1);
        if (!within) continue;

        const cat = normalize(ev.category || "other");
        if (!selectedCats.has(cat)) continue;

        const st = sourceType(ev);
        if (!selectedSrc.has(st)) continue;

        if (!matchesSearch(ev, q)) continue;

        out.push(ev);
      }
      return { out, selectedDate, selectedIndex, windowDays };
    }

    function computeVisibleEvents() {
      const base = computeBaseWindowEvents();
      const out = base.out.filter(
        (ev) => matchesActorFilter(ev) && matchesPairFilter(ev) && matchesCountryFilter(ev)
      );
      return { ...base, out };
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

    // ----- Stats -----
    function updateStats(visibleEvents) {
      let mil = 0, sec = 0, pol = 0, oth = 0, news = 0, isw = 0;
      for (const ev of visibleEvents) {
        const c = normalize(ev.category || "other");
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

    // ----- Risk -----
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

    // ----- Trend -----
    function drawTrend(dates, counts, total) {
      const ctx = trendCanvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;

      const boxRect = trendBox.getBoundingClientRect();
      const cssW = Math.max(340, Math.floor((boxRect.width || 0)));
      const cssH = 120;

      trendCanvas.style.width = "100%";
      trendCanvas.style.height = cssH + "px";
      trendCanvas.width = Math.floor(cssW * dpr);
      trendCanvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(0, 0, cssW, cssH);

      const padL = 26, padR = 8, padT = 10, padB = 18;
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
      counts.forEach((c, i) => {
        const bh = (c / max) * h;
        const x = padL + i * barW + 1;
        const y = padT + h - bh;
        ctx.fillRect(x, y, Math.max(1, barW - 2), bh);
      });

      ctx.globalAlpha = 0.9;
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Total: ${total}`, padL, 16);
      ctx.globalAlpha = 1.0;
    }

    function computeTrendCounts(selectedIndex, windowDays, catSet, srcSet, q) {
      const startIndex = Math.max(0, selectedIndex - (windowDays - 1));
      const dates = days365.slice(startIndex, selectedIndex + 1);
      const counts = new Array(dates.length).fill(0);

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (idx < startIndex || idx > selectedIndex) continue;

        const cat = normalize(ev.category || "other");
        if (!catSet.has(cat)) continue;

        const st = sourceType(ev);
        if (!srcSet.has(st)) continue;

        if (!matchesSearch(ev, q)) continue;
        if (!matchesActorFilter(ev)) continue;
        if (!matchesPairFilter(ev)) continue;
        if (!matchesCountryFilter(ev)) continue;

        counts[idx - startIndex] += 1;
      }

      const total = counts.reduce((a, b) => a + b, 0);
      return { dates, counts, total };
    }

    function updateTrendAndReturn(selectedIndex, windowDays) {
      const q = normalize(searchInput.value).trim();
      const catSet = getSelectedCategories();
      const srcSet = getSelectedSources();

      const t = computeTrendCounts(selectedIndex, windowDays, catSet, srcSet, q);
      trendTotalEl.textContent = String(t.total);
      trendRangeEl.textContent = `${t.dates[0]} → ${t.dates[t.dates.length - 1]} (${t.dates.length} days)`;
      drawTrend(t.dates, t.counts, t.total);
      return t;
    }

    // ----- Alerts + Weekly anomaly -----
    function mean(arr) { return arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length); }
    function stdev(arr) {
      const m = mean(arr);
      const v = arr.reduce((a, x) => a + (x - m) * (x - m), 0) / Math.max(1, arr.length);
      return Math.sqrt(v);
    }

    function rollingCounts(selectedIndex, baselineN, predicate) {
      const start = Math.max(0, selectedIndex - baselineN);
      const len = selectedIndex - start + 1;
      const counts = new Array(len).fill(0);

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (idx < start || idx > selectedIndex) continue;
        if (!predicate(ev, idx)) continue;
        counts[idx - start] += 1;
      }
      return { startIndex: start, counts };
    }

    function classifyRollingSpike(rolling) {
      const counts = rolling.counts;
      const last = counts[counts.length - 1] || 0;
      const base = counts.slice(0, -1);
      const baseMean = base.length ? mean(base) : 0;
      const baseStd = base.length ? stdev(base) : 0;
      const z = baseStd > 0 ? (last - baseMean) / baseStd : (last > baseMean ? 999 : 0);
      const ratio = (last + 1) / (baseMean + 1);

      let level = "ok";
      if (last >= 8 && (z >= 2.0 || ratio >= 2.0)) level = "alert";
      else if (last >= 4 && (z >= 1.3 || ratio >= 1.6)) level = "warn";

      return { level, last, baseMean, baseStd, z, ratio, baseN: base.length };
    }

    function buildPredicate(extraPredicate) {
      const q = normalize(searchInput.value).trim();
      const catSet = getSelectedCategories();
      const srcSet = getSelectedSources();

      return (ev, idx) => {
        const cat = normalize(ev.category || "other");
        if (!catSet.has(cat)) return false;

        const st = sourceType(ev);
        if (!srcSet.has(st)) return false;

        if (!matchesSearch(ev, q)) return false;
        if (!matchesActorFilter(ev)) return false;
        if (!matchesPairFilter(ev)) return false;
        if (!matchesCountryFilter(ev)) return false;

        if (extraPredicate && !extraPredicate(ev, idx)) return false;
        return true;
      };
    }

    // Weekly anomaly cache + UI state
    let lastWeekly = null; // {selectedIndex, points, topBins, stats}
    let weeklyDetailsOpen = false; // compact by default

    function locBinKey(lat, lng) {
      const bin = 0.25;
      const bl = Math.round(lat / bin) * bin;
      const bg = Math.round(lng / bin) * bin;
      return `${bl.toFixed(2)},${bg.toFixed(2)}`;
    }

    function computeWeeklyAnomaly(selectedIndex) {
      const rStart = Math.max(0, selectedIndex - 6);
      const rEnd = selectedIndex;

      const pEnd = Math.max(0, rStart - 1);
      const pStart = Math.max(0, pEnd - 6);

      const pred = buildPredicate(null);

      const recent = new Map(); // key -> {lat,lng,count,riskSum}
      const prev = new Map();   // key -> count

      const addRecent = (key, lat, lng, risk) => {
        if (!recent.has(key)) recent.set(key, { lat, lng, count: 0, riskSum: 0 });
        const o = recent.get(key);
        o.count += 1;
        o.riskSum += risk;
      };

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        if (idx < pStart || idx > rEnd) continue;
        if (!pred(ev, idx)) continue;

        const ll = getLatLng(ev);
        if (!ll) continue;

        const key = locBinKey(ll.lat, ll.lng);

        if (idx >= rStart && idx <= rEnd) {
          const wDays = getWindowDays();
          const r = eventRiskScore(ev, idx, selectedIndex, wDays);
          addRecent(key, ll.lat, ll.lng, r);
        } else if (idx >= pStart && idx <= pEnd) {
          prev.set(key, (prev.get(key) || 0) + 1);
        }
      }

      const bins = [];
      const points = [];
      for (const [key, r] of recent.entries()) {
        const pCount = prev.get(key) || 0;
        const delta = r.count - pCount;
        if (delta <= 0) continue;

        const ratio = (r.count + 1) / (pCount + 1);
        const avgRisk = r.riskSum / Math.max(1, r.count);
        const intensity = delta * ratio * Math.max(0.6, avgRisk);

        bins.push({
          key,
          lat: r.lat,
          lng: r.lng,
          recent: r.count,
          prev: pCount,
          delta,
          ratio,
          avgRisk,
          intensity,
        });

        points.push([r.lat, r.lng, intensity]);
      }

      bins.sort((a, b) => b.intensity - a.intensity);
      const topBins = bins.slice(0, 10);

      const intensities = bins.map((b) => b.intensity);
      const minI = intensities.length ? Math.min(...intensities) : 0;
      const maxI = intensities.length ? Math.max(...intensities) : 0;
      const meanI = intensities.length ? mean(intensities) : 0;

      return { selectedIndex, points, topBins, stats: { minI, maxI, meanI, bins: bins.length } };
    }

    function zoomToBin(lat, lng) {
      map.setView([lat, lng], Math.max(map.getZoom(), 8));
    }

    function updateSpikeAlert(visibleEvents, selectedIndex) {
      const baselineN = 7;
      const selectedDate = days365[selectedIndex];

      const overall = classifyRollingSpike(rollingCounts(selectedIndex, baselineN, buildPredicate(null)));
      const mil = classifyRollingSpike(
        rollingCounts(selectedIndex, baselineN, buildPredicate((ev) => normalize(ev.category) === "military"))
      );
      const hard = classifyRollingSpike(
        rollingCounts(selectedIndex, baselineN, buildPredicate((ev) => {
          const c = normalize(ev.category);
          return c === "military" || c === "security";
        }))
      );

      spikeBadge.className =
        "badge-mini " + (overall.level === "alert" ? "badge-alert" : overall.level === "warn" ? "badge-warn" : "badge-ok");
      spikeBadge.textContent = overall.level === "alert" ? "ALERT" : overall.level === "warn" ? "WATCH" : "OK";

      const cfTxt = activeCountry ? ` · country=${activeCountry}` : "";
      spikeText.textContent =
        `Rolling ${overall.baseN}d baseline | ` +
        `Overall: ${overall.level.toUpperCase()} (today ${overall.last}, base ${overall.baseMean.toFixed(1)}, ×${overall.ratio.toFixed(2)})` +
        ` | HardSec: ${hard.level.toUpperCase()} (today ${hard.last}, ×${hard.ratio.toFixed(2)})` +
        ` | Military: ${mil.level.toUpperCase()} (today ${mil.last}, ×${mil.ratio.toFixed(2)})` +
        cfTxt;

      // ---- Weekly compact + details ----
      let weeklyHtml = "";
      if (weeklyHeatCheckbox.checked) {
        if (!lastWeekly || lastWeekly.selectedIndex !== selectedIndex) {
          lastWeekly = computeWeeklyAnomaly(selectedIndex);
        }
        const st = lastWeekly.stats;
        const rangeTitle = `${days365[Math.max(0, selectedIndex - 6)]} → ${days365[selectedIndex]}`;

        const top1 = lastWeekly.topBins[0];
        const topTxt = top1
          ? `Top: (${top1.lat.toFixed(2)}, ${top1.lng.toFixed(2)}) Δ${top1.delta} ×${top1.ratio.toFixed(2)}`
          : `Top: none`;

        const detailsBtnLabel = weeklyDetailsOpen ? "Hide details" : "Show details";
        const detailsStyle = weeklyDetailsOpen ? "" : "display:none;";

        const topBinsHtml = lastWeekly.topBins.length
          ? lastWeekly.topBins.map((b, i) => `
              <div class="rank-row" data-bin="${b.lat},${b.lng}" style="cursor:pointer;">
                <div class="name">#${i + 1} (${b.lat.toFixed(2)}, ${b.lng.toFixed(2)}) <span class="muted">Δ${b.delta} · ×${b.ratio.toFixed(2)}</span></div>
                <div class="val">${b.intensity.toFixed(1)}</div>
              </div>`).join("")
          : `<div class="muted">No anomaly bins in this window.</div>`;

        weeklyHtml = `
          <div id="weeklyAnomalySection" style="margin-top:2px;padding:8px 10px;border:1px solid rgba(255,255,255,0.14);border-radius:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-size:12px;font-weight:700;opacity:.95;">Weekly anomaly</div>
                <div class="muted" style="margin-top:2px;">${rangeTitle} vs prev 7d · bins ${st.bins} · max ${st.maxI.toFixed(1)}</div>
                <div class="muted" style="margin-top:2px;">${topTxt}</div>
              </div>
              <div>
                <span class="btn-mini" id="weeklyToggleDetails" style="cursor:pointer;display:inline-block;">${detailsBtnLabel}</span>
              </div>
            </div>

            <div id="weeklyDetails" style="margin-top:10px;${detailsStyle}">
              <div class="mini-item"><div class="name">intensity</div><div class="val">min ${st.minI.toFixed(1)} · mean ${st.meanI.toFixed(1)} · max ${st.maxI.toFixed(1)}</div></div>

              <div class="muted" style="margin:10px 0 6px;">Hot bins (click to zoom)</div>
              ${topBinsHtml}
            </div>
          </div>
        `;
      }

      // ---- Pair spikes + Country spikes + Today top risk ----
      const predAll = buildPredicate(null);

      // Pair spikes (monitor-friendly messages)
      const pairSpikesHtml = (() => {
        const baselineStart = Math.max(0, selectedIndex - baselineN);
        const len = selectedIndex - baselineStart + 1;
        const pairDaily = new Map();

        for (const ev of eventsData) {
          const idx = dateToIndex.get(ev.date);
          if (idx === undefined) continue;
          if (idx < baselineStart || idx > selectedIndex) continue;
          if (!predAll(ev, idx)) continue;

          const actors = actorsInEvent(ev);
          if (actors.length < 2) continue;
          for (let i = 0; i < actors.length; i++) {
            for (let j = i + 1; j < actors.length; j++) {
              const pk = pairKey(actors[i], actors[j]);
              if (!pairDaily.has(pk)) pairDaily.set(pk, new Array(len).fill(0));
              pairDaily.get(pk)[idx - baselineStart] += 1;
            }
          }
        }

        const scored = [];
        for (const [pk, counts] of pairDaily.entries()) {
          const last = counts[counts.length - 1] || 0;
          const base = counts.slice(0, -1);
          const baseMean = base.length ? mean(base) : 0;
          const ratio = (last + 1) / (baseMean + 1);
          if (last < 2 && ratio < 2.0) continue;
          const score = (last - baseMean) * ratio;
          scored.push({ pk, last, baseMean, ratio, score });
        }
        scored.sort((a, b) => b.score - a.score);
        const topPairs = scored.slice(0, 3);

        return topPairs.length
          ? topPairs.map((x) => `
              <div class="mini-item">
                <div class="name">pair spike: ${x.pk}</div>
                <div class="val">today ${x.last} · base ${x.baseMean.toFixed(1)} · ×${x.ratio.toFixed(2)}</div>
              </div>`).join("")
          : `<div class="muted">No pair spikes detected in rolling baseline.</div>`;
      })();

      // Country spikes
      const countrySpikesHtml = (() => {
        const baselineStart = Math.max(0, selectedIndex - baselineN);
        const baselineEnd = Math.max(baselineStart, selectedIndex - 1);
        const baseDays = Math.max(1, baselineEnd - baselineStart + 1);

        const todayByCountry = new Map();
        const baseByCountry = new Map();

        for (const ev of eventsData) {
          const idx = dateToIndex.get(ev.date);
          if (idx === undefined) continue;
          if (idx < baselineStart || idx > selectedIndex) continue;
          if (!predAll(ev, idx)) continue;

          const c = getCountry(ev);
          if (idx === selectedIndex) todayByCountry.set(c, (todayByCountry.get(c) || 0) + 1);
          else baseByCountry.set(c, (baseByCountry.get(c) || 0) + 1);
        }

        const countryScored = [];
        for (const [country, todayCount] of todayByCountry.entries()) {
          const baseTotal = baseByCountry.get(country) || 0;
          const baseAvg = baseTotal / baseDays;
          const ratio = (todayCount + 1) / (baseAvg + 1);
          const delta = todayCount - baseAvg;
          const score = delta * ratio;
          countryScored.push({ country, todayCount, baseAvg, ratio, score });
        }
        countryScored.sort((a, b) => b.score - a.score);
        const topCountries = countryScored.slice(0, 4);

        if (!topCountries.length) return `<div class="muted">No country spikes detected.</div>`;

        const chips = topCountries.map((x) => {
          const active = activeCountry === x.country ? "style='outline:2px solid rgba(255,255,255,0.6)'" : "";
          return `
            <span class="badge-mini" data-country="${x.country}" ${active}
              style="cursor:pointer;display:inline-flex;gap:6px;align-items:center;margin:4px 6px 0 0;">
              <b>${x.country}</b>
              <span style="opacity:.9">today ${x.todayCount} · base ${x.baseAvg.toFixed(1)} · ×${x.ratio.toFixed(2)}</span>
            </span>`;
        }).join("");

        const clear = activeCountry
          ? `<div style="margin-top:6px;"><span class="btn-mini" id="countryClearInline" style="cursor:pointer;display:inline-block;">Clear country filter</span></div>`
          : "";

        return `${chips}${clear}`;
      })();

      // Top risk events today
      const windowDays = getWindowDays();
      const todayEvents = visibleEvents.filter((ev) => ev.date === selectedDate);
      const todayTopRisk = todayEvents
        .map((ev) => {
          const idx = dateToIndex.get(ev.date) ?? selectedIndex;
          return { ev, score: eventRiskScore(ev, idx, selectedIndex, windowDays) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      const eventsHtml = todayTopRisk.length
        ? todayTopRisk.map(({ ev, score }) => {
            const loc = ev?.location?.name ? ` · ${ev.location.name}` : "";
            const st = sourceType(ev).toUpperCase();
            const id = ev.id || "";
            return `
              <div class="event-row" data-ev="${id}" style="cursor:pointer;">
                <div class="event-row-title">${ev.title || "Untitled"}</div>
                <div class="event-row-meta">
                  <span>${st}</span>
                  <span>${(ev.category || "other")} · risk ${score.toFixed(1)}${loc}</span>
                </div>
              </div>`;
          }).join("")
        : `<div class="muted">No events today in this window.</div>`;

      spikeDetails.innerHTML = `
        ${weeklyHtml}

        <div style="margin-top:10px;">
          <div class="mini-item"><div class="name">Rolling baseline</div><div class="val">${overall.baseN} days (excluding today)</div></div>
          <div class="mini-item"><div class="name">Hard security spike</div><div class="val">${hard.level.toUpperCase()} (today ${hard.last}, base ${hard.baseMean.toFixed(1)}, ×${hard.ratio.toFixed(2)})</div></div>
          <div class="mini-item"><div class="name">Military spike</div><div class="val">${mil.level.toUpperCase()} (today ${mil.last}, base ${mil.baseMean.toFixed(1)}, ×${mil.ratio.toFixed(2)})</div></div>
        </div>

        <div style="margin-top:10px;">
          <div class="muted" style="margin-bottom:6px;">Actor–pair spikes (rolling baseline)</div>
          ${pairSpikesHtml}
        </div>

        <div style="margin-top:10px;">
          <div class="muted" style="margin-bottom:6px;">Country spikes (rolling baseline, click to filter)</div>
          ${countrySpikesHtml}
        </div>

        <div style="margin-top:12px;">
          <div class="muted" style="margin-bottom:6px;">Top risk events today (click to zoom)</div>
          ${eventsHtml}
        </div>
      `;

      // Wire: weekly details toggle
      const wbtn = document.getElementById("weeklyToggleDetails");
      if (wbtn) {
        wbtn.addEventListener("click", () => {
          weeklyDetailsOpen = !weeklyDetailsOpen;
          updateMapAndList();
          setTimeout(() => {
            const el = document.getElementById("weeklyAnomalySection");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        });
      }

      // Wire country chips
      spikeDetails.querySelectorAll("[data-country]").forEach((el) => {
        el.addEventListener("click", () => {
          const c = el.getAttribute("data-country");
          activeCountry = (activeCountry === c) ? null : c;
          lastWeekly = null;
          updateMapAndList();
        });
      });

      const cc = spikeDetails.querySelector("#countryClearInline");
      if (cc) {
        cc.addEventListener("click", () => {
          activeCountry = null;
          lastWeekly = null;
          updateMapAndList();
        });
      }

      // Wire event clicks
      spikeDetails.querySelectorAll("[data-ev]").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.getAttribute("data-ev");
          const ev = eventsData.find((x) => String(x.id) === String(id));
          if (ev) openEventOnMap(ev);
        });
      });

      // Wire bin clicks
      spikeDetails.querySelectorAll("[data-bin]").forEach((el) => {
        el.addEventListener("click", () => {
          const v = el.getAttribute("data-bin") || "";
          const parts = v.split(",").map((x) => Number(x));
          if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
          zoomToBin(parts[0], parts[1]);
        });
      });
    }

    // ----- Heatmap update (weekly vs normal) -----
    function clearHeatLayer() {
      if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      heatLayer = null;
    }

    function updateHeatmap(visibleEvents, selectedIndex, windowDays) {
      if (weeklyHeatCheckbox.checked) {
        if (heatCheckbox.checked) heatCheckbox.checked = false;

        if (!lastWeekly || lastWeekly.selectedIndex !== selectedIndex) {
          lastWeekly = computeWeeklyAnomaly(selectedIndex);
        }
        const points = lastWeekly.points;

        clearHeatLayer();
        if (!points.length) return;

        heatLayer = L.heatLayer(points, { radius: 30, blur: 22, maxZoom: 9 });
        heatLayer.addTo(map);
        heatLayer.bringToBack();
        if (bordersLayer && map.hasLayer(bordersLayer)) bordersLayer.bringToBack();
        return;
      }

      if (!heatCheckbox.checked) {
        clearHeatLayer();
        return;
      }

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

    // ----- Country risk -----
    function updateCountryRisk(visibleEvents, selectedIndex, windowDays) {
      const byCountry = new Map();
      for (const ev of visibleEvents) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;
        const country = getCountry(ev);
        const score = eventRiskScore(ev, idx, selectedIndex, windowDays);
        byCountry.set(country, (byCountry.get(country) || 0) + score);
      }

      const rows = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
      countryRiskNote.textContent = bordersLoaded
        ? `Top ${rows.length} (polygon inference ON)`
        : `Top ${rows.length} (loading country polygons...)`;

      countryRiskList.innerHTML = rows.length
        ? rows.map(([name, val]) => `
          <div class="rank-row"><div class="name">${name}</div><div class="val">${val.toFixed(1)}</div></div>
        `).join("")
        : `<div class="muted">No country risk data for current filters.</div>`;
    }

    // ----- Escalation -----
    function updateActorEscalation(selectedIndex, windowDays) {
      const q = normalize(searchInput.value).trim();
      const catSet = getSelectedCategories();
      const srcSet = getSelectedSources();

      const K = Math.min(7, Math.max(2, Math.floor(windowDays / 2)));
      const end = selectedIndex;
      const recentStart = Math.max(0, end - (K - 1));
      const prevEnd = recentStart - 1;
      const prevStart = Math.max(0, prevEnd - (K - 1));

      const recent = new Map();
      const prev = new Map();

      for (const ev of eventsData) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;

        const cat = normalize(ev.category || "other");
        if (!catSet.has(cat)) continue;

        const st = sourceType(ev);
        if (!srcSet.has(st)) continue;

        if (!matchesSearch(ev, q)) continue;
        if (!matchesPairFilter(ev)) continue;

        const actors = actorsInEvent(ev);
        if (!actors.length) continue;

        if (idx >= recentStart && idx <= end) {
          for (const a of actors) recent.set(a, (recent.get(a) || 0) + 1);
        } else if (idx >= prevStart && idx <= prevEnd) {
          for (const a of actors) prev.set(a, (prev.get(a) || 0) + 1);
        }
      }

      const allActors = new Set([...recent.keys(), ...prev.keys()]);
      const scored = [];
      for (const a of allActors) {
        const r = recent.get(a) || 0;
        const p = prev.get(a) || 0;
        const ratio = (r + 1) / (p + 1);
        const delta = r - p;
        const score = delta * ratio;
        if (r === 0 && p === 0) continue;
        scored.push({ a, r, p, delta, ratio, score });
      }

      scored.sort((x, y) => y.score - x.score);
      const top = scored.slice(0, 10);

      escNote.textContent = `Recent ${K}d vs previous ${K}d (base filters + pair filter; actor filter ignored for detection)`;
      escalationList.innerHTML = top.length
        ? top.map((x) => `
          <div class="rank-row">
            <div class="name">${x.a} <span class="muted">(${x.p}→${x.r}, Δ${x.delta}, ×${x.ratio.toFixed(2)})</span></div>
            <div class="val">${x.score.toFixed(1)}</div>
          </div>`).join("")
        : `<div class="muted">No escalation signal in this range.</div>`;
    }

    // ----- MAIN UPDATE -----
    function updateMapAndList() {
      clusterGroup.clearLayers();
      markerByEventId.clear();
      listContainer.innerHTML = "";

      const view = computeVisibleEvents();
      label.textContent = view.selectedDate || "—";

      updateTrendAndReturn(view.selectedIndex, view.windowDays);

      updateStats(view.out);
      updateRisk(view.out, view.selectedIndex, view.windowDays);
      updateHeatmap(view.out, view.selectedIndex, view.windowDays);

      updateSpikeAlert(view.out, view.selectedIndex);
      updateCountryRisk(view.out, view.selectedIndex, view.windowDays);
      updateActorEscalation(view.selectedIndex, view.windowDays);

      view.out.forEach((ev) => {
        const m = makeMarker(ev);
        if (!m) return;
        clusterGroup.addLayer(m);
        if (ev.id) markerByEventId.set(ev.id, m);
      });

      if (view.out.length === 0) {
        listContainer.innerHTML = `<div class="muted">No events for current filters/search/actor/pair/country.</div>`;
        return;
      }

      view.out
        .slice()
        .sort((a, b) => (b.date + (b.title || "")).localeCompare(a.date + (a.title || "")))
        .forEach((ev) => {
          const row = document.createElement("div");
          row.className = "event-row";
          const st = sourceType(ev).toUpperCase();
          const locName = ev?.location?.name ? ` · ${ev.location.name}` : "";
          const hasLL = !!getLatLng(ev);
          const ctry = getCountry(ev);

          row.innerHTML = `
            <div class="event-row-title">${ev.title || "Untitled"}</div>
            <div class="event-row-meta">
              <span>${st}</span>
              <span>${(ev.category || "other")} · ${ev.date}${locName} · ${ctry}</span>
              ${hasLL ? "" : `<span class="muted">no-geo</span>`}
            </div>
          `;
          row.onclick = () => openEventOnMap(ev);
          listContainer.appendChild(row);
        });
    }

    // ----- Wiring -----
    function invalidateWeekly() { lastWeekly = null; }

    slider.addEventListener("input", () => { invalidateWeekly(); updateMapAndList(); });
    catCheckboxes.forEach((cb) => cb.addEventListener("change", () => { invalidateWeekly(); updateMapAndList(); }));
    srcCheckboxes.forEach((cb) => cb.addEventListener("change", () => { invalidateWeekly(); updateMapAndList(); }));
    windowRadios.forEach((r) => r.addEventListener("change", () => { invalidateWeekly(); updateMapAndList(); }));
    searchInput.addEventListener("input", () => { invalidateWeekly(); updateMapAndList(); });

    actorClearBtn.addEventListener("click", () => { activeActor = null; invalidateWeekly(); updateMapAndList(); });
    pairClearBtn.addEventListener("click", () => { activePair = null; invalidateWeekly(); updateMapAndList(); });

    heatCheckbox.addEventListener("change", () => {
      if (heatCheckbox.checked) weeklyHeatCheckbox.checked = false;
      invalidateWeekly();
      updateMapAndList();
    });

    weeklyHeatCheckbox.addEventListener("change", () => {
      if (weeklyHeatCheckbox.checked) heatCheckbox.checked = false;
      // default: keep compact
      weeklyDetailsOpen = false;
      invalidateWeekly();
      updateMapAndList();
      setTimeout(() => {
        const el = document.getElementById("weeklyAnomalySection");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 140);
    });

    window.addEventListener("resize", () => {
      clearTimeout(window.__trendResizeT);
      window.__trendResizeT = setTimeout(() => { invalidateWeekly(); updateMapAndList(); }, 160);
    });

    // ----- Load data -----
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
