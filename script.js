<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8" />
  <title>Middle East Security Monitor</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />

  <link rel="stylesheet" href="style.css" />
</head>
<body>

<div id="map"></div>

<!-- Controls -->
<div id="controlPanel" class="panel panel-top-left closed" aria-label="Controls panel">
  <div class="panel-header">
    <button id="controlToggle" class="panel-toggle" aria-label="Controls ki/be">☰</button>
    <div class="panel-title">Controls</div>
  </div>

  <div class="panel-body">
    <div class="row">
      <label><input id="bordersCheckbox" type="checkbox" checked /> Country borders</label>
    </div>

    <div class="row">
      <label><input id="heatmapCheckbox" type="checkbox" /> Hotspot heatmap</label>
    </div>

    <hr class="sep" />

    <div class="row"><b>Sources</b></div>
    <div class="row"><label><input class="src-filter" type="checkbox" value="news" checked /> News</label></div>
    <div class="row"><label><input class="src-filter" type="checkbox" value="isw" checked /> ISW</label></div>

    <hr class="sep" />

    <div class="row"><b>Categories</b></div>
    <div class="row"><label><input class="cat-filter" type="checkbox" value="political" checked /> political</label></div>
    <div class="row"><label><input class="cat-filter" type="checkbox" value="military" checked /> military</label></div>
    <div class="row"><label><input class="cat-filter" type="checkbox" value="security" checked /> security</label></div>
    <div class="row"><label><input class="cat-filter" type="checkbox" value="other" checked /> other</label></div>

    <hr class="sep" />

    <div class="row"><b>Time Window</b></div>
    <div class="row"><label><input type="radio" name="window" value="1" checked /> 1 day</label></div>
    <div class="row"><label><input type="radio" name="window" value="7" /> 7 days</label></div>
    <div class="row"><label><input type="radio" name="window" value="30" /> 30 days</label></div>
  </div>
</div>

<!-- Timeline + list -->
<div id="timelinePanel" class="panel panel-top-right closed" aria-label="Timeline panel">
  <div class="panel-header">
    <button id="timelineToggle" class="panel-toggle" aria-label="Timeline ki/be">☰</button>
    <div class="panel-title">Timeline</div>
  </div>

  <div class="panel-body">
    <div class="muted">Selected date</div>
    <div id="selectedDateLabel" class="big">—</div>
    <input id="timelineSlider" type="range" min="0" max="364" value="364" />

    <hr class="sep" />

    <!-- STATS -->
    <div class="stats">
      <div class="stats-top">
        <div class="stats-title">Window stats</div>
        <div id="statsTotal" class="stats-total">0</div>
      </div>

      <div class="stats-grid">
        <div class="stat-pill"><span>mil</span><b id="statsMil">0</b></div>
        <div class="stat-pill"><span>sec</span><b id="statsSec">0</b></div>
        <div class="stat-pill"><span>pol</span><b id="statsPol">0</b></div>
        <div class="stat-pill"><span>oth</span><b id="statsOth">0</b></div>
      </div>

      <div class="stats-grid">
        <div class="stat-pill"><span>news</span><b id="statsNews">0</b></div>
        <div class="stat-pill"><span>isw</span><b id="statsIsw">0</b></div>
      </div>
    </div>

    <hr class="sep" />

    <!-- RISK -->
    <div class="risk">
      <div class="risk-top">
        <div class="risk-title">Risk Index (window)</div>
        <div id="riskTotal" class="risk-total">0.0</div>
      </div>
      <div class="muted" style="margin-bottom:8px;">
        Weighted: mil=3, sec=2, pol=1, oth=0.5 · ISW×1.3 · recent events higher
      </div>
      <div id="riskList" class="risk-list"></div>
    </div>

    <hr class="sep" />

    <!-- ACTORS -->
    <div class="actors">
      <div class="actors-top">
        <div class="actors-title">Top Actors (window)</div>
        <div class="actors-right">
          <span id="actorActive" class="muted">ALL</span>
          <button id="actorClear" class="btn-mini" type="button">Clear</button>
        </div>
      </div>
      <div id="actorsList" class="actors-list"></div>
    </div>

    <hr class="sep" />

    <!-- PAIRS -->
    <div class="pairs">
      <div class="pairs-top">
        <div class="pairs-title">Top Interaction Pairs (window)</div>
        <div class="pairs-right">
          <span id="pairActive" class="muted">ALL</span>
          <button id="pairClear" class="btn-mini" type="button">Clear</button>
        </div>
      </div>
      <div id="pairsList" class="pairs-list"></div>
    </div>

    <hr class="sep" />

    <div class="events-title">Events</div>
    <input id="eventSearch" class="search" type="text" placeholder="Search title/summary/tags..." />
    <div id="eventsList" class="events-list"></div>
  </div>
</div>

<!-- Legend -->
<div id="legendPanel" class="panel panel-bottom-left closed" aria-label="Legend panel">
  <div class="panel-header">
    <button id="legendToggle" class="panel-toggle" aria-label="Legend ki/be">☰</button>
    <div class="panel-title">Legend</div>
  </div>

  <div class="panel-body">
    <div class="legend-item"><span class="dot dot-military"></span> military</div>
    <div class="legend-item"><span class="dot dot-political"></span> political</div>
    <div class="legend-item"><span class="dot dot-security"></span> security</div>
    <div class="legend-item"><span class="dot dot-other"></span> other</div>

    <hr class="sep" />

    <div class="legend-item"><span class="badge badge-news">NEWS</span> source</div>
    <div class="legend-item"><span class="badge badge-isw">ISW</span> source</div>
  </div>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>

<!-- hotspot heatmap plugin -->
<script src="https://unpkg.com/leaflet.heat/dist/leaflet-heat.js"></script>

<script src="script.js"></script>
</body>
</html>
