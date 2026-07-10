# IranStrike integration audit

- Generated: `2026-07-10T14:00:53Z`
- Target: `https://iranstrike.com/`
- Result: **public_data_candidates_found**

5 public JSON/GeoJSON GET candidate endpoint(s) found.

## Homepage

- HTTP status: `200`
- Content type: `text/html; charset=utf-8`
- Final URL: `https://iranstrike.com/`

## Highest-scoring endpoint candidates

### Score 10 — `https://iranstrike.com/api/events`

- HTTP: `200`
- Content type: `application/json; charset=utf-8`
- JSON: `True`
- Record count: `10000`
- CORS: ``
- Sample keys: `events, lastUpdated, stale, viewerCount`

### Score 10 — `https://iranstrike.com/api/feed`

- HTTP: `200`
- Content type: `application/json; charset=utf-8`
- JSON: `True`
- Record count: `250`
- CORS: ``
- Sample keys: `ceasefire, developments, events, lastUpdated, spotlight, stale, totalCount, viewerCount`

### Score 9 — `https://iranstrike.com/manifest.json`

- HTTP: `200`
- Content type: `application/json; charset=utf-8`
- JSON: `True`
- Record count: `None`
- CORS: `*`
- Sample keys: `background_color, categories, description, display, icons, id, name, orientation, scope, short_name, start_url, theme_color`

### Score 8 — `https://iranstrike.com/api/summary`

- HTTP: `200`
- Content type: `application/json; charset=utf-8`
- JSON: `True`
- Record count: `None`
- CORS: ``
- Sample keys: `data, lastUpdated, stale`

### Score 8 — `https://iranstrike.com/api/vitals`

- HTTP: `200`
- Content type: `application/json; charset=utf-8`
- JSON: `True`
- Record count: `None`
- CORS: ``
- Sample keys: `lastUpdated, vitals`

### Score 4 — `https://iranstrike.com/api/og`

- HTTP: `200`
- Content type: `image/png`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 4 — `https://iranstrike.com/api/og?count=${K}`

- HTTP: `200`
- Content type: `image/png`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 2 — `https://iranstrike.com/RadarMap-d1Z0r1X_.js`

- HTTP: `404`
- Content type: `application/json`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 2 — `https://iranstrike.com/api`

- HTTP: `404`
- Content type: `application/json`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 2 — `https://iranstrike.com/api/`

- HTTP: `404`
- Content type: `application/json`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 2 — `https://iranstrike.com/feed/`

- HTTP: `404`
- Content type: `application/json`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 2 — `https://iranstrike.com/missiles`

- HTTP: `404`
- Content type: `application/json`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

### Score 2 — `https://iranstrike.com/radar`

- HTTP: `404`
- Content type: `application/json`
- JSON: `False`
- Record count: `None`
- CORS: ``
- Sample keys: ``

## WebSocket references

No WebSocket reference detected.

## Environment-variable names

- `REACT_APP_VERCEL_OBSERVABILITY_BASEPATH`
- `vite__mapDeps`

## Assessment

Review the highest-scoring candidates. If none contain event records, run a browser network audit with Playwright or browser DevTools.

Technical accessibility does not grant reuse or republication rights. Review the site's terms, robots policy, attribution requirements, and source licences before integration.
