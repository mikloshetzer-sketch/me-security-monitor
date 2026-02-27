// js/aircraft-layer.js
// Data source: Airplanes.live / ADSB One (ADSBExchange v2-compatible)
// Docs: /v2/point/[lat]/[lon]/[radius] and /v2/mil :contentReference[oaicite:2]{index=2}

export function createAircraftLayer(map, opts = {}) {
  const options = {
    updateIntervalMs: opts.updateIntervalMs ?? 2000, // API rate limit ~1 req/sec -> 2s safe
    trackSeconds: opts.trackSeconds ?? 300,
    militaryOnly: opts.militaryOnly ?? false,
    showTracks: opts.showTracks ?? true,
    maxRadiusNm: 250, // endpoint max 250nm :contentReference[oaicite:3]{index=3}
  };

  // Layers
  const aircraftLayer = L.layerGroup();
  const tracksLayer = L.layerGroup();

  // State
  let timer = null;
  let running = false;

  // markers + tracks
  const markerByHex = new Map(); // hex -> Leaflet marker
  const trackByHex = new Map();  // hex -> { polyline, points:[{lat,lng,t}] }

  function nowMs() { return Date.now(); }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function boundsCenterAndRadiusNm() {
    const b = map.getBounds();
    const c = b.getCenter();
    const ne = b.getNorthEast();
    const sw = b.getSouthWest();

    const d1 = c.distanceTo(ne); // meters
    const d2 = c.distanceTo(sw);
    const maxMeters = Math.max(d1, d2);

    const nm = maxMeters / 1852; // meters -> nautical miles
    return {
      lat: c.lat,
      lon: c.lng,
      radiusNm: clamp(Math.ceil(nm), 20, options.maxRadiusNm),
    };
  }

  function iconHtml(isMil) {
    // kék pötty alapból; ha mil, lehet később pirosra cserélni, de most hagyjuk kéken (egységes)
    return `<div style="
      width:10px;height:10px;border-radius:999px;
      background:#4ea1ff;
      border:1px solid rgba(255,255,255,.55);
      box-shadow:0 0 10px rgba(0,0,0,.35);
    "></div>`;
  }

  function makeMarker(ac) {
    const icon = L.divIcon({
      className: "",
      html: iconHtml(ac._mil === true),
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    const m = L.marker([ac.lat, ac.lon], { icon });

    const callsign = (ac.flight || "").trim();
    const hex = (ac.hex || "").trim();
    const alt = Number.isFinite(ac.alt_baro) ? `${Math.round(ac.alt_baro)} ft` : "—";
    const gs = Number.isFinite(ac.gs) ? `${Math.round(ac.gs)} kt` : "—";
    const trk = Number.isFinite(ac.track) ? `${Math.round(ac.track)}°` : "—";
    const sq = (ac.squawk || "").trim();

    m.bindPopup(`
      <b>${callsign || "Aircraft"}</b><br/>
      <small>hex: ${hex || "—"}</small><br/>
      <small>alt: ${alt} · gs: ${gs} · track: ${trk}${sq ? ` · squawk: ${sq}` : ""}</small>
    `);

    return m;
  }

  function upsertTrack(hex, lat, lon) {
    if (!options.showTracks) return;

    const t = nowMs();
    const keepMs = options.trackSeconds * 1000;

    let obj = trackByHex.get(hex);
    if (!obj) {
      const pl = L.polyline([[lat, lon]], { weight: 2, opacity: 0.9 });
      obj = { polyline: pl, points: [{ lat, lng: lon, t }] };
      trackByHex.set(hex, obj);
      tracksLayer.addLayer(pl);
    } else {
      obj.points.push({ lat, lng: lon, t });
      // purge old points
      obj.points = obj.points.filter(p => (t - p.t) <= keepMs);
      obj.polyline.setLatLngs(obj.points.map(p => [p.lat, p.lng]));
    }
  }

  function pruneStale() {
    const t = nowMs();
    const keepMs = options.trackSeconds * 1000;

    // prune tracks
    for (const [hex, obj] of trackByHex.entries()) {
      obj.points = obj.points.filter(p => (t - p.t) <= keepMs);
      if (obj.points.length < 2) {
        tracksLayer.removeLayer(obj.polyline);
        trackByHex.delete(hex);
      } else {
        obj.polyline.setLatLngs(obj.points.map(p => [p.lat, p.lng]));
      }
    }
  }

  async function fetchAircraft() {
    const { lat, lon, radiusNm } = boundsCenterAndRadiusNm();

    // militaryOnly -> /v2/mil (worldwide) túl nagy lehet, ezért inkább point + local mil filter
    // point endpoint: /v2/point/[lat]/[lon]/[radius] up to 250nm :contentReference[oaicite:4]{index=4}
    const url = `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`airplanes.live HTTP ${res.status}`);
    const json = await res.json();

    // ADSBExchange v2 compatible: { ac: [...] }
    const list = Array.isArray(json?.ac) ? json.ac : [];
    return list;
  }

  function isMilitary(ac) {
    // Airplanes.live ad külön /mil endpointot is :contentReference[oaicite:5]{index=5}
    // point válaszban nincs garantált "mil" flag; ezért heurisztika:
    // - "category" / "type" / callsign minták / squawk (nem 100%)
    const flight = (ac.flight || "").trim().toUpperCase();
    const sq = (ac.squawk || "").trim();
    const typ = (ac.t || ac.type || "").toString().toUpperCase();

    if (sq === "7000" || sq === "2000") {
      // ez nem military, csak példa; nem használjuk.
    }

    // nagyon basic minták (bővíthető):
    const patterns = [
      "RCH", "CFC", "HKY", "RRR", "NATO", "BLUE", "ASL", "DUKE",
      "QID", "IAM", "LAGR", "FNY", "BAF", "DAF", "RAF", "LFT",
    ];
    if (patterns.some(p => flight.startsWith(p))) return true;
    if (typ.includes("C130") || typ.includes("KC") || typ.includes("P8") || typ.includes("E3")) return true;

    return false;
  }

  async function tick() {
    try {
      const list = await fetchAircraft();

      let shown = 0;
      for (const ac of list) {
        if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;

        const hex = (ac.hex || "").trim().toLowerCase();
        if (!hex) continue;

        const mil = isMilitary(ac);
        ac._mil = mil;

        if (options.militaryOnly && !mil) continue;

        shown++;

        let m = markerByHex.get(hex);
        if (!m) {
          m = makeMarker(ac);
          markerByHex.set(hex, m);
          aircraftLayer.addLayer(m);
        } else {
          m.setLatLng([ac.lat, ac.lon]);
        }

        upsertTrack(hex, ac.lat, ac.lon);
      }

      pruneStale();

      // Debug (ha kell)
      // console.debug("[aircraft]", "received:", list.length, "shown:", shown);

    } catch (err) {
      // Ez most hasznos: látni fogod, ha HTTP 429 / CORS / stb.
      console.warn("[aircraft] fetch failed:", err?.message || err);
    }
  }

  function start() {
    if (running) return;
    running = true;
    tick();
    timer = window.setInterval(tick, options.updateIntervalMs);
  }

  function stop() {
    running = false;
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function setMilitaryOnly(on) {
    options.militaryOnly = !!on;
    // azonnali frissítés
    tick();
  }

  function setShowTracks(on) {
    options.showTracks = !!on;
    if (!options.showTracks) {
      // töröljük a meglévő trackeket
      tracksLayer.clearLayers();
      trackByHex.clear();
    }
  }

  return {
    aircraftLayer,
    tracksLayer,
    start,
    stop,
    setMilitaryOnly,
    setShowTracks,
  };
}
