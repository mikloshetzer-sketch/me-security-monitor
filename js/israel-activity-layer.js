/* ==========================================================================
   Israel Activity Layer
   Middle East Security Monitor
   --------------------------------------------------------------------------
   Primary data:
     data/israel-military-activity.json

   Legacy fallback:
     data/israel-activity.json

   Creates:
     window.israelActivityLayer

   Public functions:
     loadIsraelActivityLayer(map)
     refreshIsraelActivityLayer()
     clearIsraelActivityLayer()
     getIsraelActivityEvents()
     getVisibleIsraelActivityEvents()
     getIsraelActivityState()

   Compatible with the existing control panel filters:
     window.israelActivityFilters
   ========================================================================== */

(function () {

    "use strict";

    const PRIMARY_DATA_URL =
        "data/israel-military-activity.json";

    const LEGACY_DATA_URL =
        "data/israel-activity.json";

    const PANE_NAME =
        "israelMilitaryActivityPane";

    const ACTIVITY_STYLES = {

        airstrike: {
            label: "Airstrike",
            color: "#2563eb",
            symbol: "✦"
        },

        ground_activity: {
            label: "Ground activity",
            color: "#7c3aed",
            symbol: "◆"
        },

        artillery: {
            label: "Artillery",
            color: "#d97706",
            symbol: "●"
        },

        cross_border_fire: {
            label: "Cross-border fire",
            color: "#dc2626",
            symbol: "➜"
        },

        evacuation_warning: {
            label: "Evacuation warning",
            color: "#e11d48",
            symbol: "!"
        },

        humanitarian_zone: {
            label: "Humanitarian zone",
            color: "#16a34a",
            symbol: "H"
        },

        drone_activity: {
            label: "Drone activity",
            color: "#0891b2",
            symbol: "▲"
        },

        other: {
            label: "Other activity",
            color: "#64748b",
            symbol: "•"
        }

    };

    const DEFAULT_FILTERS = {

        gaza: true,
        lebanon: true,

        airstrike: true,
        ground_activity: true,
        artillery: true,
        cross_border_fire: true,
        drone_activity: true,
        evacuation_warning: true,
        humanitarian_zone: true

    };

    let mapInstance = null;

    let payload = null;

    let events = [];

    let visibleEvents = [];

    let markers = [];

    let currentDataUrl = "";

    let lastRefreshAt = "";

    let lastError = "";

    let refreshPromise = null;

    let layerGroup = createLayerGroup();

    window.israelActivityLayer = layerGroup;

    function mapUtils() {

        return window.MEMapUtils || null;

    }

    function ensureMapUtils() {

        const utils = mapUtils();

        if (!utils) {

            throw new Error(
                "window.MEMapUtils is not available. "
                + "Load js/map-utils.js before israel-activity-layer.js."
            );

        }

        return utils;

    }

    // -------------------------------------------------------------------------
    // General helpers
    // -------------------------------------------------------------------------

    function asText(value, fallback = "") {

        const text = String(value ?? "").trim();

        return text || fallback;

    }

    function asNumber(value) {

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return null;
        }

        const number = Number(value);

        return Number.isFinite(number)
            ? number
            : null;

    }

    function asArray(value) {

        if (Array.isArray(value)) {
            return value;
        }

        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return [];
        }

        return [value];

    }

    function validCoordinate(latitude, longitude) {

        return (

            Number.isFinite(latitude) &&
            Number.isFinite(longitude) &&

            latitude >= -90 &&
            latitude <= 90 &&

            longitude >= -180 &&
            longitude <= 180 &&

            !(
                Math.abs(latitude) < 0.000001 &&
                Math.abs(longitude) < 0.000001
            )

        );

    }

    function escapeHtml(value) {

        return asText(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

    }

    function humanize(value) {

        const text = asText(value, "—")
            .replaceAll("_", " ")
            .replace(/\s+/g, " ");

        return text.replace(
            /\b\w/g,
            character => character.toUpperCase()
        );

    }

    function formatDate(value) {

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return asText(value, "Unknown time");
        }

        return (
            new Intl.DateTimeFormat(
                "en-GB",
                {
                    year: "numeric",
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                    timeZone: "UTC"
                }
            ).format(date)
            + " UTC"
        );

    }

    function truncate(value, maxLength = 700) {

        const text = asText(value);

        if (text.length <= maxLength) {
            return text;
        }

        return (
            text.slice(
                0,
                Math.max(0, maxLength - 1)
            ).trim()
            + "…"
        );

    }

    function listText(value) {

        const values = asArray(value)
            .map(humanize)
            .filter(Boolean);

        return values.length
            ? values.join(", ")
            : "—";

    }

    // -------------------------------------------------------------------------
    // Leaflet layer setup
    // -------------------------------------------------------------------------

    function createLayerGroup() {

        if (
            typeof window !== "undefined" &&
            typeof window.L !== "undefined" &&
            typeof window.L.markerClusterGroup === "function"
        ) {

            return window.L.markerClusterGroup({

                showCoverageOnHover: false,

                spiderfyOnMaxZoom: true,

                removeOutsideVisibleBounds: true,

                maxClusterRadius: 42,

                disableClusteringAtZoom: 11

            });

        }

        if (
            typeof window !== "undefined" &&
            typeof window.L !== "undefined"
        ) {

            return window.L.layerGroup();

        }

        return null;

    }

    function ensureLayerGroup() {

        if (!layerGroup) {

            layerGroup = createLayerGroup();

            window.israelActivityLayer = layerGroup;

        }

        return layerGroup;

    }

    function ensurePane() {

        if (!mapInstance) {
            return;
        }

        if (!mapInstance.getPane(PANE_NAME)) {

            const pane = mapInstance.createPane(PANE_NAME);

            pane.style.zIndex = "665";

            pane.style.pointerEvents = "auto";

        }

    }

    // -------------------------------------------------------------------------
    // Styling
    // -------------------------------------------------------------------------

    function markerColor(type) {

        return (
            ACTIVITY_STYLES[type]?.color ||
            ACTIVITY_STYLES.other.color
        );

    }

    function markerRadius(intensity) {

        switch (
            asText(intensity).toLowerCase()
        ) {

            case "high":
                return 10;

            case "medium":
                return 8;

            case "low":
                return 6;

            default:
                return 7;

        }

    }

    function primaryActivityType(event) {

        const types = eventActivityTypes(event);

        for (
            const type of Object.keys(ACTIVITY_STYLES)
        ) {

            if (
                type !== "other" &&
                types.includes(type)
            ) {

                return type;

            }

        }

        return types[0] || "other";

    }

    function activityStyle(event) {

        const type = primaryActivityType(event);

        return (
            ACTIVITY_STYLES[type] ||
            ACTIVITY_STYLES.other
        );

    }

    function injectStyles() {

        if (
            document.getElementById(
                "israel-activity-layer-styles"
            )
        ) {
            return;
        }

        const style =
            document.createElement("style");

        style.id =
            "israel-activity-layer-styles";

        style.textContent = `

            .idf-activity-div-icon {

                background: transparent !important;

                border: 0 !important;

            }

            .idf-activity-marker {

                width: 24px;

                height: 24px;

                display: flex;

                align-items: center;

                justify-content: center;

                border: 2px solid #ffffff;

                border-radius: 50%;

                box-shadow:
                    0 2px 8px rgba(15, 23, 42, .36),
                    0 0 0 2px rgba(37, 99, 235, .14);

                color: #ffffff;

                font-family:
                    Inter,
                    system-ui,
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    Arial,
                    sans-serif;

                font-size: 12px;

                font-weight: 900;

                line-height: 1;

            }

            .idf-activity-marker span {

                transform: translateY(-.3px);

            }

            .idf-popup {

                width: min(340px, 72vw);

                font-family:
                    Inter,
                    system-ui,
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    Arial,
                    sans-serif;

                color: #172033;

            }

            .idf-popup__header {

                margin: -1px -1px 10px;

                padding: 10px 11px;

                border-left:
                    5px solid
                    var(--idf-popup-color);

                border-radius: 8px;

                background: #f5f8fb;

            }

            .idf-popup__source {

                color: #64748b;

                font-size: 9px;

                font-weight: 800;

                letter-spacing: .045em;

                text-transform: uppercase;

            }

            .idf-popup__title {

                margin-top: 3px;

                color: #17324d;

                font-size: 13px;

                font-weight: 900;

                line-height: 1.35;

            }

            .idf-popup__grid {

                display: grid;

                grid-template-columns:
                    105px minmax(0, 1fr);

                gap: 5px 9px;

                margin: 9px 0;

                font-size: 10px;

                line-height: 1.4;

            }

            .idf-popup__label {

                color: #64748b;

                font-weight: 750;

            }

            .idf-popup__value {

                color: #243447;

                font-weight: 700;

                overflow-wrap: anywhere;

            }

            .idf-popup__description {

                max-height: 150px;

                overflow: auto;

                margin-top: 8px;

                padding: 9px;

                border:
                    1px solid
                    #d8e1e9;

                border-radius: 8px;

                background: #f8fafc;

                color: #425267;

                font-size: 10px;

                line-height: 1.5;

            }

            .idf-popup__notice {

                margin-top: 8px;

                padding: 7px 8px;

                border-left:
                    3px solid
                    #d97706;

                background: #fff8eb;

                color: #75510a;

                font-size: 9px;

                line-height: 1.45;

            }

            .idf-popup__link {

                display: inline-block;

                margin-top: 8px;

                color: #285879 !important;

                font-size: 10px;

                font-weight: 850;

                text-decoration: none;

            }

            .idf-popup__link:hover {

                text-decoration: underline;

            }

        `;

        document.head.appendChild(style);

    }

    // -------------------------------------------------------------------------
    // Filtering
    // -------------------------------------------------------------------------

    function currentFilters() {

        return {

            ...DEFAULT_FILTERS,

            ...(window.israelActivityFilters || {})

        };

    }

    function eventRegions(event) {

        const regions = asArray(event.regions)
            .map(
                value =>
                    asText(value).toLowerCase()
            )
            .filter(Boolean);

        const singular =
            asText(event.region).toLowerCase();

        if (
            singular &&
            !regions.includes(singular)
        ) {

            regions.push(singular);

        }

        return regions;

    }

    function eventActivityTypes(event) {

        const types =
            asArray(event.activity_types)
                .map(
                    value =>
                        asText(value).toLowerCase()
                )
                .filter(Boolean);

        const singular =
            asText(
                event.activity_type
            ).toLowerCase();

        if (
            singular &&
            !types.includes(singular)
        ) {

            types.unshift(singular);

        }

        return types.length
            ? types
            : ["other"];

    }

    function eventRegionMatches(
        event,
        filters
    ) {

        const regions =
            eventRegions(event);

        const isGaza =
            regions.some(
                region =>
                    region.includes("gaza")
            );

        const isLebanon =
            regions.some(
                region =>
                    region.includes("lebanon")
            );

        return (

            (
                filters.gaza &&
                isGaza
            )

            ||

            (
                filters.lebanon &&
                isLebanon
            )

        );

    }

    function eventTypeMatches(
        event,
        filters
    ) {

        const types =
            eventActivityTypes(event);

        return types.some(type => {

            if (type === "other") {
                return true;
            }

            return filters[type] !== false;

        });

    }

    function eventMatches(event) {

        const filters =
            currentFilters();

        return (

            eventRegionMatches(
                event,
                filters
            )

            &&

            eventTypeMatches(
                event,
                filters
            )

        );

    }

    // -------------------------------------------------------------------------
    // Data normalization
    // -------------------------------------------------------------------------

    function normalizeMapEvent(
        event,
        index
    ) {

        const latitude =
            asNumber(event.latitude);

        const longitude =
            asNumber(event.longitude);

        if (
            !validCoordinate(
                latitude,
                longitude
            )
        ) {
            return null;
        }

        return {

            ...event,

            id:
                asText(
                    event.id,
                    `idf-map-event-${index + 1}`
                ),

            latitude,

            longitude,

            location_name:
                asText(
                    event.location_name,
                    event.location
                ),

            summary:
                asText(
                    event.summary,
                    event.description
                ),

            map_visualizable: true

        };

    }

    function extractMapEvents(data) {

        const directMapEvents =
            Array.isArray(data?.map_events)
                ? data.map_events
                : [];

        if (directMapEvents.length) {

            return directMapEvents
                .map(normalizeMapEvent)
                .filter(Boolean);

        }

        const sourceEvents =
            Array.isArray(data?.events)
                ? data.events
                : Array.isArray(data)
                    ? data
                    : [];

        const expanded = [];

        sourceEvents.forEach(
            (
                event,
                eventIndex
            ) => {

                const locations =
                    asArray(event.locations);

                if (locations.length) {

                    locations.forEach(
                        (
                            location,
                            locationIndex
                        ) => {

                            const latitude =
                                asNumber(
                                    location?.latitude
                                );

                            const longitude =
                                asNumber(
                                    location?.longitude
                                );

                            if (
                                !validCoordinate(
                                    latitude,
                                    longitude
                                )
                            ) {
                                return;
                            }

                            expanded.push({

                                ...event,

                                id:
                                    `${asText(
                                        event.id,
                                        `idf-${eventIndex + 1}`
                                    )}`
                                    +
                                    `-location-${locationIndex + 1}`,

                                parent_event_id:
                                    asText(
                                        event.id,
                                        `idf-${eventIndex + 1}`
                                    ),

                                location_index:
                                    locationIndex + 1,

                                location:
                                    asText(
                                        location?.name,
                                        event.location
                                    ),

                                location_name:
                                    asText(
                                        location?.name,
                                        event.location_name ||
                                        event.location
                                    ),

                                region:
                                    asText(
                                        location?.region,
                                        event.region
                                    ),

                                country:
                                    asText(
                                        location?.country,
                                        event.country
                                    ),

                                latitude,

                                longitude,

                                map_visualizable: true,

                                geospatial_confidence:
                                    "high"

                            });

                        }
                    );

                    return;

                }

                const normalized =
                    normalizeMapEvent(
                        event,
                        eventIndex
                    );

                if (normalized) {

                    expanded.push(normalized);

                }

            }
        );

        return expanded;

    }

    // -------------------------------------------------------------------------
    // Popup
    // -------------------------------------------------------------------------

    function buildLegacyPopup(event) {

        return `

            <div style="min-width:260px">

                <h3 style="margin-top:0;">

                    ${escapeHtml(
                        event.location_name ||
                        event.location ||
                        "Israel military activity"
                    )}

                </h3>

                <table style="width:100%;font-size:13px;">

                    <tr>

                        <td><b>Date</b></td>

                        <td>
                            ${escapeHtml(
                                asText(event.date, "—")
                            )}
                        </td>

                    </tr>

                    <tr>

                        <td><b>UTC</b></td>

                        <td>
                            ${escapeHtml(
                                asText(
                                    event.time_utc,
                                    "—"
                                )
                            )}
                        </td>

                    </tr>

                    <tr>

                        <td><b>Region</b></td>

                        <td>
                            ${escapeHtml(
                                asText(
                                    event.region,
                                    "—"
                                )
                            )}
                        </td>

                    </tr>

                    <tr>

                        <td><b>Activity</b></td>

                        <td>
                            ${escapeHtml(
                                humanize(
                                    event.activity_type
                                )
                            )}
                        </td>

                    </tr>

                    <tr>

                        <td><b>Intensity</b></td>

                        <td>
                            ${escapeHtml(
                                asText(
                                    event.intensity,
                                    "—"
                                )
                            )}
                        </td>

                    </tr>

                    <tr>

                        <td><b>Confidence</b></td>

                        <td>
                            ${escapeHtml(
                                asText(
                                    event.confidence,
                                    "—"
                                )
                            )}/5
                        </td>

                    </tr>

                </table>

                <hr>

                <p>
                    ${escapeHtml(
                        asText(
                            event.summary,
                            event.description
                        )
                    )}
                </p>

                <small>

                    ${escapeHtml(
                        asText(
                            event.analysis_note,
                            ""
                        )
                    )}

                </small>

            </div>

        `;

    }

    function buildModernPopup(event) {

        const style =
            activityStyle(event);

        const sourceUrl =
            asText(event.source_url);

        const regions =
            event.regions?.length
                ? event.regions
                : event.region;

        const activities =
            event.activity_types?.length
                ? event.activity_types
                : event.activity_type;

        const organizations =
            event.target_organizations?.length
                ? event.target_organizations
                : event.target_organization;

        const targetTypes =
            event.target_types?.length
                ? event.target_types
                : event.target_type;

        const commanderTypes =
            event.commander_types?.length
                ? event.commander_types
                : event.commander_type;

        const threatDomains =
            event.threat_domains?.length
                ? event.threat_domains
                : event.threat_domain;

        const results =
            event.operation_results?.length
                ? event.operation_results
                : event.operation_result;

        const areaMentions =
            event.area_mentions?.length
                ? event.area_mentions
                : [];

        return `

            <div
                class="idf-popup"
                style="
                    --idf-popup-color:
                    ${style.color}
                "
            >

                <div class="idf-popup__header">

                    <div class="idf-popup__source">

                        IDF official statement ·
                        not independently verified

                    </div>

                    <div class="idf-popup__title">

                        ${escapeHtml(
                            asText(
                                event.title,
                                "IDF operational statement"
                            )
                        )}

                    </div>

                </div>

                <div class="idf-popup__grid">

                    <div class="idf-popup__label">
                        Date
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            formatDate(event.date)
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Location
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            asText(
                                event.location ||
                                event.location_name,
                                event.region || "—"
                            )
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Region
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            listText(regions)
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Activity
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            listText(activities)
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Organization
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            listText(organizations)
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Target
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            listText(targetTypes)
                        )}

                    </div>

                    ${
                        asArray(
                            commanderTypes
                        ).filter(Boolean).length
                            ? `

                                <div class="idf-popup__label">

                                    Commander type

                                </div>

                                <div class="idf-popup__value">

                                    ${escapeHtml(
                                        listText(
                                            commanderTypes
                                        )
                                    )}

                                </div>

                            `
                            : ""
                    }

                    <div class="idf-popup__label">
                        Threat domain
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            listText(threatDomains)
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Result
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            listText(results)
                        )}

                    </div>

                    ${
                        asArray(areaMentions).length
                            ? `

                                <div class="idf-popup__label">

                                    Area mentions

                                </div>

                                <div class="idf-popup__value">

                                    ${escapeHtml(
                                        listText(areaMentions)
                                    )}

                                </div>

                            `
                            : ""
                    }

                    <div class="idf-popup__label">
                        Classification
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            humanize(
                                event.classification_confidence ||
                                "rule based"
                            )
                        )}

                    </div>

                    <div class="idf-popup__label">
                        Geospatial confidence
                    </div>

                    <div class="idf-popup__value">

                        ${escapeHtml(
                            humanize(
                                event.geospatial_confidence ||
                                event.geocode_confidence ||
                                "high"
                            )
                        )}

                    </div>

                    ${
                        Number(
                            event.marker_overlap_count
                        ) > 1
                            ? `

                                <div class="idf-popup__label">
                                    Overlapping events
                                </div>

                                <div class="idf-popup__value">

                                    ${escapeHtml(
                                        String(
                                            event.marker_overlap_count
                                        )
                                    )}
                                    events share this locality

                                </div>

                            `
                            : ""
                    }

                </div>

                <div class="idf-popup__description">

                    ${escapeHtml(
                        truncate(
                            event.description ||
                            event.summary ||
                            "",
                            700
                        )
                    )}

                </div>

                <div class="idf-popup__notice">

                    Official statement by a party
                    to the conflict.

                    The event has not been
                    independently verified.

                    Coordinates represent the
                    named locality, not the exact
                    strike point.

                </div>

                ${
                    sourceUrl
                        ? `

                            <a
                                class="idf-popup__link"
                                href="${escapeHtml(sourceUrl)}"
                                target="_blank"
                                rel="noopener noreferrer"
                            >

                                Open official statement ↗

                            </a>

                        `
                        : ""
                }

            </div>

        `;

    }

    function buildPopup(event) {

        const isModern =
            Boolean(
                event.source_type ||
                event.target_organization ||
                event.threat_domain ||
                event.operation_result
            );

        return isModern
            ? buildModernPopup(event)
            : buildLegacyPopup(event);

    }

    // -------------------------------------------------------------------------
    // Markers
    // -------------------------------------------------------------------------

    function createModernMarker(event) {

        const style =
            activityStyle(event);

        const icon =
            L.divIcon({

                className:
                    "idf-activity-div-icon",

                html: `

                    <div
                        class="idf-activity-marker"
                        style="
                            background:
                            ${style.color};
                        "
                        title="${escapeHtml(
                            style.label
                        )}"
                    >

                        <span>
                            ${escapeHtml(
                                style.symbol
                            )}
                        </span>

                    </div>

                `,

                iconSize: [26, 26],

                iconAnchor: [13, 13],

                popupAnchor: [0, -13]

            });

        return L.marker(

            [
                event.latitude,
                event.longitude
            ],

            {

                icon,

                pane: PANE_NAME,

                keyboard: true,

                riseOnHover: true,

                title:
                    asText(
                        event.title,
                        "IDF official statement"
                    )

            }

        );

    }

    function createLegacyMarker(event) {

        return L.circleMarker(

            [
                event.latitude,
                event.longitude
            ],

            {

                pane: PANE_NAME,

                radius:
                    markerRadius(
                        event.intensity
                    ),

                color:
                    markerColor(
                        event.activity_type
                    ),

                fillColor:
                    markerColor(
                        event.activity_type
                    ),

                fillOpacity: 0.8,

                weight: 2

            }

        );

    }

    function createMarker(
        event,
        displayEvent = event
    ) {

        const markerEvent = {

            ...event,

            latitude:
                displayEvent.display_latitude ??
                displayEvent.latitude,

            longitude:
                displayEvent.display_longitude ??
                displayEvent.longitude,

            original_latitude:
                displayEvent.original_latitude ??
                event.latitude,

            original_longitude:
                displayEvent.original_longitude ??
                event.longitude,

            marker_overlap_group:
                displayEvent.marker_overlap_group ||
                "",

            marker_overlap_index:
                displayEvent.marker_overlap_index ??
                0,

            marker_overlap_count:
                displayEvent.marker_overlap_count ??
                1,

            marker_pixel_offset:
                displayEvent.marker_pixel_offset ||
                {
                    x: 0,
                    y: 0
                }

        };

        const isModern =
            Boolean(
                markerEvent.source_type ||
                markerEvent.target_organization ||
                markerEvent.threat_domain ||
                markerEvent.operation_result
            );

        const marker =
            isModern
                ? createModernMarker(markerEvent)
                : createLegacyMarker(markerEvent);

        marker.bindPopup(

            buildPopup(markerEvent),

            {

                maxWidth: 370,

                minWidth: 260,

                autoPanPadding: [42, 42]

            }

        );

        marker.eventData = event;

        marker.__idfEvent = event;

        marker.__idfDisplayEvent =
            markerEvent;

        const utils = mapUtils();

        if (
            utils &&
            typeof utils.bindBringToFront === "function"
        ) {

            utils.bindBringToFront(
                marker,
                {
                    resetOnClose: false
                }
            );

        }

        marker.on(
            "popupopen",
            () => {

                if (
                    utils &&
                    typeof utils.bringLayerToFront === "function"
                ) {

                    utils.bringLayerToFront(marker);

                }

            }
        );

        return marker;

    }

    // -------------------------------------------------------------------------
    // Layer lifecycle
    // -------------------------------------------------------------------------

    function clearIsraelActivityLayer() {

        markers = [];

        visibleEvents = [];

        ensureLayerGroup()?.clearLayers();

    }

    function rebuildLayer() {

        const group =
            ensureLayerGroup();

        if (!group) {
            return;
        }

        group.clearLayers();

        markers = [];

        visibleEvents =
            events.filter(eventMatches);

        let displayEvents =
            visibleEvents.map(event => ({

                ...event,

                original_latitude:
                    event.latitude,

                original_longitude:
                    event.longitude,

                display_latitude:
                    event.latitude,

                display_longitude:
                    event.longitude,

                marker_overlap_count:
                    1,

                marker_overlap_index:
                    0,

                marker_pixel_offset: {
                    x: 0,
                    y: 0
                }

            }));

        const utils =
            mapUtils();

        if (
            mapInstance &&
            utils &&
            typeof utils.cloneEventsWithDisplayCoordinates === "function"
        ) {

            displayEvents =
                utils.cloneEventsWithDisplayCoordinates(

                    visibleEvents,

                    mapInstance,

                    {

                        coordinatePrecision: 6,

                        minPixelRadius: 24,

                        maxPixelRadius: 42,

                        radiusStep: 5,

                        startAngleDegrees: -90

                    }

                );

        }

        displayEvents.forEach(
            (
                displayEvent,
                index
            ) => {

                const originalEvent =
                    visibleEvents[index] ||
                    displayEvent;

                const marker =
                    createMarker(
                        originalEvent,
                        displayEvent
                    );

                marker.addTo(group);

                markers.push(marker);

            }
        );

        console.info(

            "[israel-activity-layer]",

            {

                dataUrl:
                    currentDataUrl,

                loaded:
                    events.length,

                visible:
                    visibleEvents.length,

                overlappingGroups:
                    displayEvents.filter(
                        event =>
                            Number(
                                event.marker_overlap_count
                            ) > 1
                    ).length,

                generatedAt:
                    payload?.generated_at || "",

                filters:
                    currentFilters(),

                mapUtils:
                    Boolean(utils)

            }

        );

    }

    async function fetchJson(url) {

        const separator =
            url.includes("?")
                ? "&"
                : "?";

        const response =
            await fetch(

                `${url}${separator}v=${Date.now()}`,

                {

                    cache: "no-store",

                    headers: {

                        Accept:
                            "application/json"

                    }

                }

            );

        if (!response.ok) {

            throw new Error(

                `Israel activity data HTTP `
                +
                `${response.status}: ${url}`

            );

        }

        return response.json();

    }

    async function fetchPayload() {

        try {

            const data =
                await fetchJson(
                    PRIMARY_DATA_URL
                );

            currentDataUrl =
                PRIMARY_DATA_URL;

            return data;

        }

        catch (primaryError) {

            console.warn(

                "[israel-activity] "
                +
                "primary file failed, "
                +
                "trying legacy file:",

                primaryError?.message ||
                primaryError

            );

            const data =
                await fetchJson(
                    LEGACY_DATA_URL
                );

            currentDataUrl =
                LEGACY_DATA_URL;

            return data;

        }

    }

    async function refreshIsraelActivityLayer() {

        if (refreshPromise) {

            return refreshPromise;

        }

        refreshPromise =
            (async () => {

                clearIsraelActivityLayer();

                try {

                    payload =
                        await fetchPayload();

                    events =
                        extractMapEvents(payload);

                    lastRefreshAt =
                        new Date().toISOString();

                    lastError = "";

                    rebuildLayer();

                    return (
                        getIsraelActivityState()
                    );

                }

                catch (error) {

                    lastError =
                        asText(
                            error?.message,
                            "Unknown Israel activity error"
                        );

                    console.error(

                        "Israel activity layer "
                        +
                        "loading failed.",

                        error

                    );

                    throw error;

                }

                finally {

                    refreshPromise = null;

                }

            })();

        return refreshPromise;

    }

    async function loadIsraelActivityLayer(map) {

        mapInstance = map;

        if (!mapInstance) {

            throw new Error(

                "loadIsraelActivityLayer "
                +
                "requires a Leaflet map."

            );

        }

        injectStyles();

        ensureMapUtils();

        ensurePane();

        const group =
            ensureLayerGroup();

        await refreshIsraelActivityLayer();

        if (
            group &&
            !mapInstance.hasLayer(group)
        ) {

            group.addTo(mapInstance);

        }

        return group;

    }

    // -------------------------------------------------------------------------
    // Public state helpers
    // -------------------------------------------------------------------------

    function getIsraelActivityEvents() {

        return [...events];

    }

    function getVisibleIsraelActivityEvents() {

        return [...visibleEvents];

    }

    function getIsraelActivityState() {

        return {

            loaded:
                Boolean(payload),

            dataUrl:
                currentDataUrl,

            schemaVersion:
                payload?.schema_version ??
                null,

            generatedAt:
                payload?.generated_at || "",

            source:
                payload?.source || null,

            loadedCount:
                events.length,

            visibleCount:
                visibleEvents.length,

            filters:
                currentFilters(),

            lastRefreshAt,

            lastError,

            mapUtilsAvailable:
                Boolean(mapUtils()),

            spreadEnabled:
                Boolean(
                    mapUtils() &&
                    mapInstance
                )

        };

    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    window.loadIsraelActivityLayer =
        loadIsraelActivityLayer;

    window.refreshIsraelActivityLayer =
        refreshIsraelActivityLayer;

    window.clearIsraelActivityLayer =
        clearIsraelActivityLayer;

    window.getIsraelActivityEvents =
        getIsraelActivityEvents;

    window.getVisibleIsraelActivityEvents =
        getVisibleIsraelActivityEvents;

    window.getIsraelActivityState =
        getIsraelActivityState;

})();
