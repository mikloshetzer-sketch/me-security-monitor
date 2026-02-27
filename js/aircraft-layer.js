// /js/aircraft-layer.js
export function createAircraftLayer(map, opts = {}) {
  const options = {
    updateIntervalMs: 15000,
    staleMs: 60000,
    trackSeconds: 300,          // 5 perc
    trackMaxPoints: 60,         // pontok limitje gépenként
    showTracks: true,
    militaryOnly: false,
    ...opts
  };

  const aircraftLayer = L.layerGroup();
  const tracksLayer = L.layerGroup(); // külön layer a vonalaknak
  const aircraftMarkers = new Map();  // icao24 -> { marker, lastSeen, lastState }
  const trackStore = new Map();       // icao24 -> { points:[{lat,lon,t}], polyline }

  function openskyUrlForCurrentView() {
    const b = map.getBounds();
    const qs = new URLSearchParams({
      lamin: b.getSouth().toFixed(4),
      lamax: b.getNorth().toFixed(4),
      lomin: b.getWest().toFixed(4),
      lomax: b.getEast().toFixed(4),
    });
    return `https://opensky-network.org/api/states/all?${qs.toString()}`;
  }

  // --- "Military-ish" heurisztika (nem tökéletes!) ---
  // S[1] callsign, S[14] squawk
  const CALLSIGN_RE = new RegExp(
    // tipikus katonai / állami / tanker / transport / AWACS minták (általános, régiófüggetlen)
    String.raw`^(RCH|MCV|QID|DUKE|HOBO|KNIFE|REACH|PAT|HKY|TIGER|EAGLE|RAVEN|NATO|NAF|LAGR|SHELL|TEXACO|MAFIA|JEDI|CAMELOT|KING|LION|NOBLE)\d*`,
    "i"
  );

  function isMilitaryLike(state) {
    const callsign = ((state[1] || "") + "").trim();
    const squawk = ((state[14] || "") + "").trim();

    // 1) callsign alapú jel
    if (callsign && CALLSIGN_RE.test(callsign)) return true;

    // 2) squawk heurisztika (nem garancia!)
    // Pl. 7000 VFR Európában nem katonai, viszont bizonyos 0xxx/1xxx/4xxx minták előfordulnak állami gépeknél is.
    // Itt óvatosan: csak nagyon gyenge jelként használjuk.
    if (/^\d{4}$/.test(squawk)) {
      // “gyanúsabb” tartományok (nem állítás, csak OSINT támpont)
      const n = parseInt(squawk, 10);
      if (n === 0) return true;             // néha “no squawk / special”
      if (n >= 1000 && n <= 1777) return true;
      if (n >= 4000 && n <= 4777) return true;
    }

    return false;
  }

  function formatTooltip(s) {
    const icao24 = (s[0] || "").trim();
    const callsign = (s[1] || "").trim();
    const country = (s[2] || "").trim();
    const altM = s[13] ?? s[7];
    const altFt = (typeof altM === "number") ? Math.round(altM * 3.28084) : null;
    const spdKt = (typeof s[9] === "number") ? Math.round(s[9] * 1.94384) : null;
    const trk = (typeof s[10] === "number") ? Math.round(s[10]) : null;
    const squawk = (s[14] || "").trim();

    const mil = isMilitaryLike(s) ? "🟠 military-ish" : "⚪ unknown/civil";

    return [
      `<b>${callsign || icao24 || "UNKNOWN"}</b>`,
      mil,
      country ? `Country: ${country}` : null,
      altFt != null ? `Alt: ${altFt} ft` : null,
      spdKt != null ? `Speed: ${spdKt} kt` : null,
      trk != null ? `Track: ${trk}°` : null,
      squawk ? `Squawk: ${squawk}` : null,
      icao24 ? `ICAO24: ${icao24}` : null,
    ].filter(Boolean).join("<br/>");
  }

  function upsertTrack(icao24, lat, lon, t) {
    if (!options.showTracks) return;

    const cutoff = t - options.trackSeconds * 1000;
    let obj = trackStore.get(icao24);

    if (!obj) {
      obj = { points: [], polyline: null };
      trackStore.set(icao24, obj);
    }

    // adjuk hozzá pontot (ha nem “ugyanaz”, hogy ne rajzoljon zajt)
    const last = obj.points[obj.points.length - 1];
    if (!last || Math.abs(last.lat - lat) > 0.0005 || Math.abs(last.lon - lon) > 0.0005) {
      obj.points.push({ lat, lon, t });
    }

    // vágás idő és max pont alapján
    obj.points = obj.points.filter(p => p.t >= cutoff);
    if (obj.points.length > options.trackMaxPoints) {
      obj.points = obj.points.slice(obj.points.length - options.trackMaxPoints);
    }

    const latlngs = obj.points.map(p => [p.lat, p.lon]);

    if (!obj.polyline) {
      obj.polyline = L.polyline(latlngs, { weight: 2, opacity: 0.75 });
      tracksLayer.addLayer(obj.polyline);
    } else {
      obj.polyline.setLatLngs(latlngs);
    }
  }

  function removeTrack(icao24) {
    const obj = trackStore.get(icao24);
    if (!obj) return;
    if (obj.polyline) tracksLayer.removeLayer(obj.polyline);
    trackStore.delete(icao24);
  }

  async function fetchAndRender() {
    try {
      const res = await fetch(openskyUrlForCurrentView(), { mode: "cors" });
      if (!res.ok) throw new Error(`OpenSky HTTP ${res.status}`);
      const data = await res.json();

      const now = Date.now();
      const seenNow = new Set();

      for (const s of (data.states || [])) {
        const icao24 = (s[0] || "").trim();
        const lon = s[5], lat = s[6];
        if (!icao24 || typeof lat !== "number" || typeof lon !== "number") continue;

        // militaryOnly szűrés
        if (options.militaryOnly && !isMilitaryLike(s)) continue;

        seenNow.add(icao24);

        const tooltip = formatTooltip(s);

        const existing = aircraftMarkers.get(icao24);
        if (existing) {
          existing.marker.setLatLng([lat, lon]);
          existing.marker.setTooltipContent(tooltip);
          existing.lastSeen = now;
          existing.lastState = s;
        } else {
          const marker = L.circleMarker([lat, lon], {
            radius: 5,
            weight: 1,
            fillOpacity: 0.85,
          }).bindTooltip(tooltip, { direction: "top" });

          aircraftLayer.addLayer(marker);
          aircraftMarkers.set(icao24, { marker, lastSeen: now, lastState: s });
        }

        // track update
        upsertTrack(icao24, lat, lon, now);
      }

      // stale cleanup
      for (const [icao24, obj] of aircraftMarkers.entries()) {
        if (!seenNow.has(icao24) && (now - obj.lastSeen) > options.staleMs) {
          aircraftLayer.removeLayer(obj.marker);
          aircraftMarkers.delete(icao24);
          removeTrack(icao24);
        }
      }
    } catch (e) {
      console.warn("Aircraft update failed:", e);
    }
  }

  let timer = null;

  function start() {
    if (timer) return timer;
    fetchAndRender();
    timer = setInterval(fetchAndRender, options.updateIntervalMs);
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function setMilitaryOnly(v) {
    options.militaryOnly = !!v;
    // hard refresh: töröljük a civil marker-eket, majd újrahúzzuk
    aircraftLayer.clearLayers();
    tracksLayer.clearLayers();
    aircraftMarkers.clear();
    trackStore.clear();
    fetchAndRender();
  }

  function setShowTracks(v) {
    options.showTracks = !!v;
    if (!options.showTracks) {
      tracksLayer.clearLayers();
      // a pontokat megtartjuk, ha később visszakapcsolod, de polylinet újra kell építeni
      for (const obj of trackStore.values()) obj.polyline = null;
    } else {
      // rebuild polylines
      for (const [icao24, obj] of trackStore.entries()) {
        const latlngs = obj.points.map(p => [p.lat, p.lon]);
        if (latlngs.length >= 2) {
          obj.polyline = L.polyline(latlngs, { weight: 2, opacity: 0.75 });
          tracksLayer.addLayer(obj.polyline);
        }
      }
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
