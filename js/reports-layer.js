export function createReportsLayer(map, opts = {}) {
  const options = {
    maxAgeHours: opts.maxAgeHours ?? 48,
  };

  const layer = L.layerGroup();

  function ageOk(iso) {
    try {
      const t = new Date(iso).getTime();
      const h = (Date.now() - t) / 3600000;
      return h <= options.maxAgeHours;
    } catch {
      return true;
    }
  }

  function markerHtml() {
    return `<div style="
      width:10px;height:10px;border-radius:999px;
      background:#ffd84e;
      border:1px solid rgba(255,255,255,.55);
      box-shadow:0 0 10px rgba(0,0,0,.35);
    "></div>`;
  }

  function makeMarker(r) {
    const icon = L.divIcon({
      className: "",
      html: markerHtml(),
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });

    const m = L.marker([r.location.lat, r.location.lng], { icon });

    const src = r?.source || {};
    const link = src.url
      ? `<a href="${src.url}" target="_blank" rel="noreferrer">open source</a>`
      : "";

    const hint = r.aircraft_hint ? `<b>${r.aircraft_hint}</b> · ` : "";
    const place = r.location?.name ? ` · ${r.location.name}` : "";
    const when = r.published_at ? new Date(r.published_at).toISOString().slice(0, 16).replace("T", " ") : "—";

    m.bindPopup(`
      ${hint}${r.title || "Crowd report"}<br/>
      <small>${when}${place} · ${r.confidence || "LOW"} · ${src.type || ""}</small><br/>
      <small>${(r.text || "").replace(/</g, "&lt;").slice(0, 300)}...</small><br/>
      <small>${link}</small>
    `);

    return m;
  }

  async function refresh() {
    const res = await fetch("reports.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`reports.json HTTP ${res.status}`);
    const payload = await res.json();

    layer.clearLayers();
    const reports = Array.isArray(payload?.reports) ? payload.reports : [];
    for (const r of reports) {
      if (!ageOk(r.published_at)) continue;
      if (!r.location || !Number.isFinite(r.location.lat) || !Number.isFinite(r.location.lng)) continue;
      layer.addLayer(makeMarker(r));
    }
  }

  return { layer, refresh };
}
