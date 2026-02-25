window.addEventListener("DOMContentLoaded", () => {
  try {
    const $ = (id) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`Missing element: #${id}`);
      return el;
    };

    // ----- Panels (top-level) -----
    const controlPanel = $("controlPanel");
    const timelinePanel = $("timelinePanel");
    const legendPanel = $("legendPanel");

    const controlToggle = $("controlToggle");
    const timelineToggle = $("timelineToggle");
    const legendToggle = $("legendToggle");

    function togglePanel(panelEl) {
      const wasClosed = panelEl.classList.contains("closed");
      panelEl.classList.toggle("closed");
      if (wasClosed && panelEl === timelinePanel) {
        setTimeout(() => updateMapAndList(), 80);
      }
    }
    controlToggle.addEventListener("click", () => togglePanel(controlPanel));
    timelineToggle.addEventListener("click", () => togglePanel(timelinePanel));
    legendToggle.addEventListener("click", () => togglePanel(legendPanel));

    // ----- Accordion (inside timeline) -----
    function setArrow(btn, isOpen) {
      const arrow = btn.querySelector(".acc-arrow");
      if (!arrow) return;
      arrow.style.transform = isOpen ? "rotate(90deg)" : "rotate(0deg)";
      btn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    }

    document.querySelectorAll(".acc-btn").forEach((btn) => {
      const targetId = btn.getAttribute("data-acc");
      const panel = document.getElementById(targetId);
      if (!panel) return;

      // ensure default closed -> arrow reset
      setArrow(btn, !panel.classList.contains("closed"));

      btn.addEventListener("click", () => {
        const isClosed = panel.classList.contains("closed");
        panel.classList.toggle("closed");
        setArrow(btn, isClosed);

        // redraw trend when opened
        if (targetId === "accTrend" && isClosed) {
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

    // ----- Heatmap (Hotspot) -----
    const heatCheckbox = $("heatmapCheckbox");
    let heatLayer = null;

    // ----- Borders -----
    const BORDERS_GEOJSON_URL =
      "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/refs/heads/master/geojson/ne_50m_admin_0_countries.geojson";

    const bordersCheckbox = $("bordersCheckbox");
    let bordersLayer = null;
    let bordersLoaded = false;

    function bordersStyle() {
      return { color: "#ffffff", weight: 2.2, opacity: 0.85, fillOpacity: 0 };
    }

    async function ensureBordersLoaded() {
      if (bordersLoaded) return;
      const res = await fetch(BORDERS_GEOJSON_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`Borders HTTP ${res.status}`);
      const geojson = await res.json();
      bordersLayer = L.geoJSON(geojson, { style: bordersStyle });
      bordersLoaded = true;
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

    // ----- Actors dictionary -----
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

    slider.max = days365.length - 1;
    slider.value = days365.length - 1;

    const catCheckboxes = [...document.querySelectorAll(".cat-filter")];
    const srcCheckboxes = [...document.querySelectorAll(".src-filter")];
    const windowRadios = [...document.querySelectorAll("input[name='window']")];

    // ----- Data -----
    let eventsData = [];
    const markerByEventId = new Map();

    // ----- helpers -----
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

    function makeMarker(ev) {
      const lat = ev?.location?.lat;
      const lng = ev?.location?.lng;
      if (typeof lat !== "number" || typeof lng !== "number") return null;

      const icon = L.divIcon({
        className: "",
        html: `<div class="event-dot" style="background:${categoryColor(ev.category)}"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });

      const m = L.marker([lat, lng], { icon });

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
      const out = base.out.filter((ev) => matchesActorFilter(ev) && matchesPairFilter(ev));
      return { ...base, out };
    }

    function openEventOnMap(ev) {
      const marker = ev?.id ? markerByEventId.get(ev.id) : null;
      const lat = ev?.location?.lat;
      const lng = ev?.location?.lng;

      if (typeof lat === "number" && typeof lng === "number") {
        map.setView([lat, lng], Math.max(map.getZoom(), 9));
      }

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
        if (st === "isw") isw++;
        else news++;
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

    function updateRisk(visibleEvents, selectedIndex, windowDays) {
      let total = 0;
      const byLoc = new Map();

      for (const ev of visibleEvents) {
        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;

        const locName = (ev?.location?.name || "Unknown").trim() || "Unknown";
        const score =
          categoryWeight(ev.category) *
          sourceMultiplier(ev) *
          recencyWeight(idx, selectedIndex, windowDays);

        total += score;
        byLoc.set(locName, (byLoc.get(locName) || 0) + score);
      }

      riskTotalEl.textContent = total.toFixed(1);

      const rows = [...byLoc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      riskListEl.innerHTML = rows.length
        ? rows.map(([name, val]) => `
            <div class="risk-row">
              <div class="name">${name}</div>
              <div class="val">${val.toFixed(1)}</div>
            </div>`).join("")
        : `<div class="muted">No risk data for current filters.</div>`;
    }

    // ----- Actors -----
    function updateActors(baseEvents) {
      const counts = new Map();
      for (const ev of baseEvents) {
        for (const a of actorsInEvent(ev)) counts.set(a, (counts.get(a) || 0) + 1);
      }
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
          updateMapAndList();
        };
      });
    }

    // ----- Pairs -----
    const pairKey = (a, b) => [a, b].sort().join(" + ");

    function updatePairs(baseEvents) {
      const counts = new Map();

      for (const ev of baseEvents) {
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
              <div class="name">${k}</div>
              <div class="val">${n}</div>
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

          updateMapAndList();
        };
      });
    }

    // ----- Heatmap -----
    function updateHeatmap(visibleEvents, selectedIndex, windowDays) {
      if (!heatCheckbox.checked) {
        if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
        heatLayer = null;
        return;
      }

      const points = [];
      for (const ev of visibleEvents) {
        const lat = ev?.location?.lat;
        const lng = ev?.location?.lng;
        if (typeof lat !== "number" || typeof lng !== "number") continue;

        const idx = dateToIndex.get(ev.date);
        if (idx === undefined) continue;

        const w =
          categoryWeight(ev.category) *
          sourceMultiplier(ev) *
          recencyWeight(idx, selectedIndex, windowDays);

        points.push([lat, lng, w]);
      }

      if (heatLayer && map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
      heatLayer = null;

      if (points.length === 0) return;

      heatLayer = L.heatLayer(points, { radius: 28, blur: 22, maxZoom: 9 });
      heatLayer.addTo(map);
      heatLayer.bringToBack();
      if (bordersLayer && map.hasLayer(bordersLayer)) bordersLayer.bringToBack();
    }

    // ----- Trend (always draw something) -----
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
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      ctx.fillRect(0, 0, cssW, cssH);

      const padL = 26, padR = 8, padT = 10, padB = 18;
      const w = cssW - padL - padR;
      const h = cssH - padT - padB;

      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);

      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(padL, padT);
      ctx.lineTo(padL, padT + h);
      ctx.lineTo(padL + w, padT + h);
      ctx.stroke();

      const max = Math.max(1, ...counts);
      const barW = w / Math.max(1, counts.length);

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#ffffff";
      counts.forEach((c, i) => {
        const bh = (c / max) * h;
        const x = padL + i * barW + 1;
        const y = padT + h - bh;
        ctx.fillRect(x, y, Math.max(1, barW - 2), bh);
      });

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#ffffff";
      ctx.font = "11px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(`Total: ${total}`, padL, 16);

      ctx.globalAlpha = 0.7;
      ctx.fillText(String(max), 4, padT + 10);
      ctx.fillText("0", 10, padT + h);

      const start = dates[0] || "";
      const end = dates[dates.length - 1] || "";
      ctx.fillText(start.slice(5), padL, padT + h + 14);
      const endW = ctx.measureText(end.slice(5)).width;
      ctx.fillText(end.slice(5), padL + w - endW, padT + h + 14);
    }

    function updateTrend(selectedIndex, windowDays) {
      const startIndex = Math.max(0, selectedIndex - (windowDays - 1));
      const dates = days365.slice(startIndex, selectedIndex + 1);
      const counts = new Array(dates.length).fill(0);

      const q = normalize(searchInput.value).trim();
      const catSet = getSelectedCategories();
      const srcSet = getSelectedSources();

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

        counts[idx - startIndex] += 1;
      }

      const total = counts.reduce((a, b) => a + b, 0);
      trendTotalEl.textContent = String(total);
      trendRangeEl.textContent = `${dates[0]} → ${dates[dates.length - 1]} (${dates.length} days)`;

      drawTrend(dates, counts, total);
    }

    // ----- MAIN UPDATE -----
    function updateMapAndList() {
      clusterGroup.clearLayers();
      markerByEventId.clear();
      listContainer.innerHTML = "";

      const view = computeVisibleEvents();
      label.textContent = view.selectedDate || "—";

      updateTrend(view.selectedIndex, view.windowDays);
      updateStats(view.out);
      updateRisk(view.out, view.selectedIndex, view.windowDays);

      const base = computeBaseWindowEvents();
      updateActors(base.out);
      updatePairs(base.out);

      view.out.forEach((ev) => {
        const m = makeMarker(ev);
        if (!m) return;
        clusterGroup.addLayer(m);
        if (ev.id) markerByEventId.set(ev.id, m);
      });

      updateHeatmap(view.out, view.selectedIndex, view.windowDays);

      if (view.out.length === 0) {
        listContainer.innerHTML = `<div class="muted">No events for current filters/search/actor/pair.</div>`;
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

          row.innerHTML = `
            <div class="event-row-title">${ev.title || "Untitled"}</div>
            <div class="event-row-meta">
              <span>${st}</span>
              <span>${(ev.category || "other")} · ${ev.date}${locName}</span>
            </div>
          `;
          row.onclick = () => openEventOnMap(ev);
          listContainer.appendChild(row);
        });
    }

    // ----- Wiring -----
    slider.addEventListener("input", updateMapAndList);
    catCheckboxes.forEach((cb) => cb.addEventListener("change", updateMapAndList));
    srcCheckboxes.forEach((cb) => cb.addEventListener("change", updateMapAndList));
    windowRadios.forEach((r) => r.addEventListener("change", updateMapAndList));
    searchInput.addEventListener("input", updateMapAndList);

    actorClearBtn.addEventListener("click", () => { activeActor = null; updateMapAndList(); });
    pairClearBtn.addEventListener("click", () => { activePair = null; updateMapAndList(); });

    heatCheckbox.addEventListener("change", updateMapAndList);

    window.addEventListener("resize", () => {
      clearTimeout(window.__trendResizeT);
      window.__trendResizeT = setTimeout(updateMapAndList, 160);
    });

    // ----- Load data -----
    fetch("events.json")
      .then((r) => r.json())
      .then((data) => {
        eventsData = data;
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
