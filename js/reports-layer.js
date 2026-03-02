export function createReportsLayer(map, opts = {}) {
  const options = {
    maxAgeHours: opts.maxAgeHours ?? 48,
    middleEastOnly: opts.middleEastOnly ?? true,
  };

  const layer = L.layerGroup();

  // Durva Middle East bounding box (zajszűrés)
  // Lat: 10..42, Lng: 25..65
  function inMiddleEast(lat, lng) {
    return lat >= 10 && lat <= 42 && lng >= 25 && lng <= 65;
  }

  function ageOk(iso) {
    try {
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return true;
      const h = (Date.now() - t) / 3600000;
      return h <= options.maxAgeHours;
    } catch {
      return true;
    }
  }

  // PIROS célkereszt ikon (⦿)
  function markerHtml() {
    return `
      <div style="
        width:18px;height:18px;border-radius:999px;
        display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,.28);
        border:1px solid rgba(255,255,255,.55);
        box-shadow:0 0 10px rgba(0,0,0,.35);
        color:#ff5a5a;
        font-size:14px;
        line-height:1;
        font-weight:800;
      ">⦿</div>
    `;
  }

  function getLatLng(r) {
    // 1) prefer location.lat/lng
    const lat1 = Number(r?.location?.lat);
    const lng1 = Number(r?.location?.lng);
    if (Number.isFinite(lat1) && Number.isFinite(lng1)) return { lat: lat1, lng: lng1 };

    // 2) fallback to flat lat/lng
    const lat2 = Number(r?.lat);
    const lng2 = Number(r?.lng);
    if (Number.isFinite(lat2) && Number.isFinite(lng2)) return { lat: lat2, lng: lng2 };

    return null;
  }

  function safeText(s) {
    return String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function makeMarker(r) {
    const ll = getLatLng(r);
    if (!ll) return null;

    const icon = L.divIcon({
      className: "",
      html: markerHtml(),
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    const m = L.marker([ll.lat, ll.lng], { icon });

    const src = r?.source || {};
    const link = src.url
      ? `<a href="${src.url}" target="_blank" rel="noreferrer">open source</a>`
      : "";

    const hint = r.aircraft_hint ? `<b>${safeText(r.aircraft_hint)}</b> · ` : "";
    const place = r?.location?.name ? ` · ${safeText(r.location.name)}` : "";

    const when = r.published_at
      ? new Date(r.published_at).toISOString().slice(0, 16).replace("T", " ")
      : "—";

    const title = safeText(r.title || "Crowd report");
    const text = safeText(r.text || "");

    m.bindPopup(`
      ${hint}${title}<br/>
      <small>${when}${place} · ${safeText(r.confidence || "LOW")} · ${safeText(src.type || "")}</small><br/>
      <small>${text.slice(0, 320)}${text.length > 320 ? "..." : ""}</small><br/>
      <small>${link}</small>
    `);

    return m;
  }

  async function refresh() {
    const res = await fetch("reports.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`reports.json HTTP ${res.status}`);
    const payload = await res.json();

    layer.clearLayers();

    // accept either {reports:[...]} or a root array [...]
    const reports = Array.isArray(payload) ? payload : (Array.isArray(payload?.reports) ? payload.reports : []);

    let added = 0;
    for (const r of reports) {
      if (!ageOk(r.published_at)) continue;

      const ll = getLatLng(r);
      if (!ll) continue;

      if (options.middleEastOnly && !inMiddleEast(ll.lat, ll.lng)) continue;

      const marker = makeMarker(r);
      if (!marker) continue;
      layer.addLayer(marker);
      added++;
    }

    if (added === 0) {
      console.warn("[reports-layer] 0 markers added. Check reports.json lat/lng + filters.");
    }
  }

  return { layer, refresh };
}
