export function createStaticPoiLayer(map, opts = {}) {
  const options = {
    url: opts.url ?? "./data/strategic_sites.geojson",
    middleEastOnly: opts.middleEastOnly ?? true,
  };

  const layer = L.layerGroup();

  // Middle East bounding box (durva, zajszűrő)
  // Lat: 10..42, Lng: 25..65
  function inMiddleEast(lat, lng) {
    return lat >= 10 && lat <= 42 && lng >= 25 && lng <= 65;
  }

  function safeText(s) {
    return String(s || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function emoji(kind) {
    const k = String(kind || "").toLowerCase();
    if (k === "airport") return "✈️";
    if (k === "port") return "⚓";
    if (k === "nuclear") return "☢️";
    if (k === "base") return "🛡️";
    if (k === "chokepoint") return "🚪";
    return "📍";
  }

  function makeIcon(kind) {
    const k = String(kind || "").toLowerCase();
    // kis “badge” jellegű ikon (emoji + kör)
    const bg = {
      airport: "#4ea1ff",
      port: "#2de2a6",
      nuclear: "#ff5a5a",
      base: "#b7b7b7",
      chokepoint: "#ffd84e",
      other: "#ffffff",
    }[k] || "#ffffff";

    const html = `
      <div style="
        width:22px;height:22px;border-radius:999px;
        background:${bg};
        border:1px solid rgba(255,255,255,.65);
        box-shadow:0 0 10px rgba(0,0,0,.35);
        display:flex;align-items:center;justify-content:center;
        font-size:14px; line-height:1;
      ">${emoji(k)}</div>
    `;

    return L.divIcon({
      className: "",
      html,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function featureLatLng(f) {
    if (f?.geometry?.type !== "Point") return null;
    const c = f.geometry.coordinates;
    if (!Array.isArray(c) || c.length < 2) return null;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function makeMarker(f) {
    const p = f?.properties || {};
    const kind = (p.kind || "other").toLowerCase();
    const name = p.name || "Site";

    const ll = featureLatLng(f);

    const m = L.marker([ll.lat, ll.lng], { icon: makeIcon(kind) });
    m.bindPopup(`<b>${safeText(name)}</b><br/><small>${safeText(kind)}</small>`);
    return m;
  }

  async function refresh() {
    const res = await fetch(options.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`strategic_sites.geojson HTTP ${res.status}`);
    const geo = await res.json();

    layer.clearLayers();

    const feats = Array.isArray(geo?.features) ? geo.features : [];
    let added = 0;

    for (const f of feats) {
      const ll = featureLatLng(f);
      if (!ll) continue;

      if (options.middleEastOnly && !inMiddleEast(ll.lat, ll.lng)) continue;

      layer.addLayer(makeMarker(f));
      added++;
    }

    if (added === 0) {
      console.warn("[static-poi-layer] 0 POIs added. Check bbox or geojson coordinates.");
    }
  }

  return { layer, refresh };
}
