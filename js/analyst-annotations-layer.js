/* ==========================================================================
   Analyst Annotations Layer
   Middle East Security Monitor
   --------------------------------------------------------------------------
   User-created analytical notes stored locally in the browser.

   Creates:
     window.analystAnnotationsLayer

   Public functions:
     initAnalystAnnotationsLayer(options)
     enableAnalystAnnotationsLayer()
     disableAnalystAnnotationsLayer()
     clearAnalystAnnotationsLayer()
     getAnalystAnnotations()
     getAnalystAnnotationsState()
   ========================================================================== */

(function () {

    "use strict";

    const STORAGE_KEY =
        "me_security_monitor_analyst_annotations_v1";

    const PANE_NAME =
        "analystAnnotationsPane";

    const STYLE_ELEMENT_ID =
        "analyst-annotations-layer-styles";

    const DEFAULT_TYPE =
        "analysis";

    const ANNOTATION_TYPES = {

        analysis: {
            icon: "📊",
            color: "#2563eb",
            title: "Analysis"
        },

        operation: {
            icon: "⚔️",
            color: "#b91c1c",
            title: "Operational"
        },

        logistics: {
            icon: "🚚",
            color: "#ea580c",
            title: "Logistics"
        },

        warning: {
            icon: "⚠️",
            color: "#ca8a04",
            title: "Warning"
        },

        note: {
            icon: "📝",
            color: "#475569",
            title: "Note"
        }

    };

    let mapInstance = null;

    let layerGroup = null;

    let annotations = [];

    let markers = [];

    let addMode = false;

    let enabled = false;

    let initialized = false;

    let lastError = "";

    let controls = {

        toggle: null,

        addButton: null,

        clearButton: null,

        textInput: null,

        typeSelect: null,

        summary: null

    };

    window.analystAnnotationsLayer = null;

    // -------------------------------------------------------------------------
    // General helpers
    // -------------------------------------------------------------------------

    function asText(value, fallback = "") {

        const text =
            String(value ?? "").trim();

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

        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : null;

    }

    function validCoordinate(latitude, longitude) {

        return (

            Number.isFinite(latitude) &&

            Number.isFinite(longitude) &&

            latitude >= -90 &&
            latitude <= 90 &&

            longitude >= -180 &&
            longitude <= 180

        );

    }

    function escapeHtml(value) {

        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

    }

    function textToHtml(value) {

        return escapeHtml(value)
            .replace(/\r?\n/g, "<br>");

    }

    function generateId() {

        if (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        ) {
            return crypto.randomUUID();
        }

        return (
            `${Date.now()}_`
            +
            Math.random()
                .toString(16)
                .slice(2)
        );

    }

    function normalizeType(value) {

        const type =
            asText(value, DEFAULT_TYPE)
                .toLowerCase();

        return ANNOTATION_TYPES[type]
            ? type
            : DEFAULT_TYPE;

    }

    function getTypeStyle(type) {

        return (
            ANNOTATION_TYPES[
                normalizeType(type)
            ]
            ||
            ANNOTATION_TYPES[DEFAULT_TYPE]
        );

    }

    function formatCreatedAt(value) {

        const date =
            new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "";
        }

        return new Intl.DateTimeFormat(
            "en-GB",
            {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
            }
        ).format(date);

    }

    // -------------------------------------------------------------------------
    // Isolated component styles
    // -------------------------------------------------------------------------

    function injectStyles() {

        if (
            document.getElementById(
                STYLE_ELEMENT_ID
            )
        ) {
            return;
        }

        const style =
            document.createElement("style");

        style.id =
            STYLE_ELEMENT_ID;

        style.textContent = `

            .analyst-annotation-div-icon {
                width: auto !important;
                height: auto !important;
                margin: 0 !important;
                background: transparent !important;
                border: 0 !important;
            }

            .analyst-annotation-card {
                --analyst-annotation-color: #2563eb;
                position: relative;
                width: 260px;
                min-width: 220px;
                max-width: min(280px, 78vw);
                box-sizing: border-box;
                overflow: hidden;
                border:
                    1px solid
                    rgba(15, 23, 42, .20);
                border-left:
                    5px solid
                    var(--analyst-annotation-color);
                border-radius: 12px;
                background:
                    rgba(255, 255, 255, .97);
                color: #172033;
                box-shadow:
                    0 8px 22px rgba(15, 23, 42, .24),
                    0 2px 6px rgba(15, 23, 42, .14);
                font-family:
                    Inter,
                    system-ui,
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    Arial,
                    sans-serif;
                line-height: 1.4;
                white-space: normal;
                user-select: none;
                cursor: grab;
                transform-origin: 22px 22px;
                transition:
                    box-shadow .16s ease,
                    transform .16s ease;
            }

            .analyst-annotation-card:hover {
                transform: translateY(-1px);
                box-shadow:
                    0 11px 28px rgba(15, 23, 42, .30),
                    0 3px 8px rgba(15, 23, 42, .16);
            }

            .leaflet-marker-draggable
            .analyst-annotation-card,
            .analyst-annotation-card:active {
                cursor: grabbing;
            }

            .analyst-annotation-card__header {
                display: flex;
                align-items: center;
                gap: 7px;
                min-height: 31px;
                padding: 7px 9px 6px;
                border-bottom:
                    1px solid
                    rgba(15, 23, 42, .09);
                background: #f5f8fb;
            }

            .analyst-annotation-card__icon {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                font-size: 15px;
                line-height: 1;
            }

            .analyst-annotation-card__type {
                min-width: 0;
                overflow: hidden;
                color:
                    var(--analyst-annotation-color);
                font-size: 11px;
                font-weight: 850;
                letter-spacing: .035em;
                text-overflow: ellipsis;
                text-transform: uppercase;
                white-space: nowrap;
            }

            .analyst-annotation-card__text {
                max-height: 150px;
                overflow: auto;
                padding: 9px 10px 8px;
                color: #172033;
                font-size: 12px;
                font-weight: 600;
                line-height: 1.48;
                overflow-wrap: anywhere;
                word-break: break-word;
                user-select: text;
                cursor: text;
            }

            .analyst-annotation-card__date {
                padding: 0 10px 7px;
                color: #64748b;
                font-size: 10px;
                font-weight: 650;
                line-height: 1.3;
            }

            .analyst-annotation-card__footer {
                padding: 6px 9px 7px;
                border-top:
                    1px solid
                    rgba(15, 23, 42, .08);
                background: #f8fafc;
                color: #64748b;
                font-size: 9px;
                font-weight: 650;
                line-height: 1.35;
            }

            body.analyst-annotation-placement-active
            #map {
                cursor: crosshair;
            }

            body.analyst-annotation-placement-active
            #map::after {
                content:
                    "Click the map to place the analyst annotation";
                position: absolute;
                z-index: 900;
                left: 50%;
                bottom: 20px;
                transform: translateX(-50%);
                max-width:
                    min(
                        420px,
                        calc(100vw - 32px)
                    );
                box-sizing: border-box;
                padding: 9px 13px;
                border:
                    1px solid
                    rgba(255, 255, 255, .22);
                border-radius: 999px;
                background:
                    rgba(15, 23, 42, .88);
                color: #ffffff;
                box-shadow:
                    0 6px 18px
                    rgba(0, 0, 0, .25);
                font-size: 11px;
                font-weight: 750;
                line-height: 1.3;
                text-align: center;
                pointer-events: none;
            }

            @media (max-width: 720px) {

                .analyst-annotation-card {
                    width: 230px;
                    min-width: 200px;
                    max-width: 72vw;
                }

                .analyst-annotation-card__text {
                    max-height: 120px;
                    font-size: 11px;
                }

                body.analyst-annotation-placement-active
                #map::after {
                    bottom: 14px;
                    border-radius: 10px;
                }

            }

        `;

        document.head.appendChild(style);

    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    function normalizeAnnotation(item, index) {

        if (
            !item ||
            typeof item !== "object"
        ) {
            return null;
        }

        const latitude =
            asNumber(
                item.lat ??
                item.latitude
            );

        const longitude =
            asNumber(
                item.lng ??
                item.longitude
            );

        const text =
            asText(item.text);

        if (
            !validCoordinate(
                latitude,
                longitude
            )
            ||
            !text
        ) {
            return null;
        }

        return {

            id:
                asText(
                    item.id,
                    `analyst-annotation-${index + 1}`
                ),

            lat:
                latitude,

            lng:
                longitude,

            text,

            type:
                normalizeType(item.type),

            createdAt:
                asText(
                    item.createdAt,
                    new Date().toISOString()
                ),

            updatedAt:
                asText(
                    item.updatedAt,
                    item.createdAt ||
                    new Date().toISOString()
                )

        };

    }

    function loadAnnotationsFromStorage() {

        try {

            const raw =
                localStorage.getItem(
                    STORAGE_KEY
                );

            if (!raw) {
                return [];
            }

            const parsed =
                JSON.parse(raw);

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .map(normalizeAnnotation)
                .filter(Boolean);

        }

        catch (error) {

            lastError =
                asText(
                    error?.message,
                    "Unable to load analyst annotations."
                );

            console.warn(
                "[analyst-annotations] "
                +
                "Stored annotations could not be loaded.",
                error
            );

            return [];

        }

    }

    function saveAnnotationsToStorage() {

        try {

            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(annotations)
            );

            lastError = "";

            return true;

        }

        catch (error) {

            lastError =
                asText(
                    error?.message,
                    "Unable to save analyst annotations."
                );

            console.error(
                "[analyst-annotations] "
                +
                "Annotations could not be saved.",
                error
            );

            return false;

        }

    }

    // -------------------------------------------------------------------------
    // Leaflet setup
    // -------------------------------------------------------------------------

    function ensurePane() {

        if (!mapInstance) {
            return;
        }

        if (!mapInstance.getPane(PANE_NAME)) {

            const pane =
                mapInstance.createPane(
                    PANE_NAME
                );

            pane.style.zIndex =
                "690";

            pane.style.pointerEvents =
                "auto";

        }

    }

    function ensureLayerGroup() {

        if (
            layerGroup ||
            typeof window.L === "undefined"
        ) {
            return layerGroup;
        }

        layerGroup =
            window.L.layerGroup();

        window.analystAnnotationsLayer =
            layerGroup;

        return layerGroup;

    }

    // -------------------------------------------------------------------------
    // Control panel status
    // -------------------------------------------------------------------------

    function setSummaryHtml(html) {

        if (!controls.summary) {
            return;
        }

        controls.summary.innerHTML =
            html;

    }

    function updateSummary() {

        if (!controls.summary) {
            return;
        }

        if (addMode) {

            setSummaryHtml(
                "<strong>Placement mode active.</strong><br>"
                +
                "Click the map where the annotation should appear."
            );

            return;

        }

        if (!annotations.length) {

            setSummaryHtml(
                "No analyst annotations have been created."
            );

            return;

        }

        setSummaryHtml(
            `Annotations: <strong>${annotations.length}</strong><br>`
            +
            "Create a new note, then click the map to place it."
        );

    }

    function setAddMode(nextState) {

        addMode =
            Boolean(nextState);

        document.body.classList.toggle(
            "analyst-annotation-placement-active",
            addMode
        );

        if (controls.addButton) {

            controls.addButton.classList.toggle(
                "is-active",
                addMode
            );

            controls.addButton.setAttribute(
                "aria-pressed",
                addMode
                    ? "true"
                    : "false"
            );

        }

        updateSummary();

    }

    // -------------------------------------------------------------------------
    // Marker rendering
    // -------------------------------------------------------------------------

    function createAnnotationIcon(item) {

        const style =
            getTypeStyle(item.type);

        const createdAt =
            formatCreatedAt(
                item.createdAt
            );

        const metadata =
            createdAt
                ? `<div class="analyst-annotation-card__date">${escapeHtml(createdAt)}</div>`
                : "";

        return window.L.divIcon({

            className:
                "analyst-annotation-div-icon",

            html: `

                <article
                    class="analyst-annotation-card"
                    style="
                        --analyst-annotation-color:
                        ${style.color};
                    "
                >

                    <header class="analyst-annotation-card__header">

                        <span class="analyst-annotation-card__icon">
                            ${escapeHtml(style.icon)}
                        </span>

                        <span class="analyst-annotation-card__type">
                            ${escapeHtml(style.title)}
                        </span>

                    </header>

                    <div class="analyst-annotation-card__text">
                        ${textToHtml(item.text)}
                    </div>

                    ${metadata}

                    <footer class="analyst-annotation-card__footer">
                        Drag to move · Right-click to delete
                    </footer>

                </article>

            `,

            iconSize:
                [270, 120],

            iconAnchor:
                [22, 22],

            popupAnchor:
                [0, -22]

        });

    }

    function removeAnnotationById(id) {

        const annotation =
            annotations.find(
                item => item.id === id
            );

        if (!annotation) {
            return false;
        }

        const confirmed =
            window.confirm(
                "Delete this analyst annotation?"
            );

        if (!confirmed) {
            return false;
        }

        annotations =
            annotations.filter(
                item => item.id !== id
            );

        saveAnnotationsToStorage();

        renderAnnotations();

        return true;

    }

    function updateAnnotationPosition(
        id,
        latitude,
        longitude
    ) {

        if (
            !validCoordinate(
                latitude,
                longitude
            )
        ) {
            return;
        }

        const updatedAt =
            new Date().toISOString();

        annotations =
            annotations.map(item => {

                if (item.id !== id) {
                    return item;
                }

                return {

                    ...item,

                    lat:
                        latitude,

                    lng:
                        longitude,

                    updatedAt

                };

            });

        saveAnnotationsToStorage();

        updateSummary();

    }

    function createMarker(item) {

        const marker =
            window.L.marker(

                [
                    item.lat,
                    item.lng
                ],

                {

                    draggable:
                        true,

                    interactive:
                        true,

                    keyboard:
                        true,

                    riseOnHover:
                        true,

                    pane:
                        PANE_NAME,

                    icon:
                        createAnnotationIcon(item),

                    title:
                        getTypeStyle(
                            item.type
                        ).title

                }

            );

        marker.annotationData =
            item;

        marker.on(
            "dragend",
            event => {

                const position =
                    event.target.getLatLng();

                updateAnnotationPosition(
                    item.id,
                    position.lat,
                    position.lng
                );

            }
        );

        marker.on(
            "contextmenu",
            event => {

                if (
                    event?.originalEvent &&
                    typeof event.originalEvent.preventDefault === "function"
                ) {
                    event.originalEvent.preventDefault();
                }

                removeAnnotationById(
                    item.id
                );

            }
        );

        return marker;

    }

    function renderAnnotations() {

        const group =
            ensureLayerGroup();

        if (!group) {
            return;
        }

        group.clearLayers();

        markers = [];

        annotations.forEach(item => {

            const marker =
                createMarker(item);

            marker.addTo(group);

            markers.push(marker);

        });

        updateSummary();

    }

    // -------------------------------------------------------------------------
    // Annotation creation
    // -------------------------------------------------------------------------

    function readAnnotationText() {

        return asText(
            controls.textInput?.value
        );

    }

    function readAnnotationType() {

        return normalizeType(
            controls.typeSelect?.value
        );

    }

    function addAnnotationAt(latlng) {

        if (!latlng) {
            return false;
        }

        const text =
            readAnnotationText();

        if (!text) {

            window.alert(
                "Enter an analytical note before placing it on the map."
            );

            controls.textInput?.focus();

            return false;

        }

        const latitude =
            asNumber(latlng.lat);

        const longitude =
            asNumber(latlng.lng);

        if (
            !validCoordinate(
                latitude,
                longitude
            )
        ) {

            window.alert(
                "The selected map position is invalid."
            );

            return false;

        }

        const timestamp =
            new Date().toISOString();

        const item = {

            id:
                generateId(),

            lat:
                latitude,

            lng:
                longitude,

            text,

            type:
                readAnnotationType(),

            createdAt:
                timestamp,

            updatedAt:
                timestamp

        };

        annotations.push(item);

        saveAnnotationsToStorage();

        renderAnnotations();

        if (controls.textInput) {

            controls.textInput.value =
                "";

        }

        return true;

    }

    // -------------------------------------------------------------------------
    // Layer visibility
    // -------------------------------------------------------------------------

    function enableAnalystAnnotationsLayer() {

        const group =
            ensureLayerGroup();

        if (
            !mapInstance ||
            !group
        ) {
            return false;
        }

        if (!mapInstance.hasLayer(group)) {

            group.addTo(
                mapInstance
            );

        }

        enabled = true;

        if (controls.toggle) {
            controls.toggle.checked = true;
        }

        return true;

    }

    function disableAnalystAnnotationsLayer() {

        if (
            mapInstance &&
            layerGroup &&
            mapInstance.hasLayer(layerGroup)
        ) {

            mapInstance.removeLayer(
                layerGroup
            );

        }

        enabled = false;

        setAddMode(false);

        if (controls.toggle) {
            controls.toggle.checked = false;
        }

        return true;

    }

    function syncLayerVisibilityFromToggle() {

        if (!controls.toggle) {

            enableAnalystAnnotationsLayer();

            return;

        }

        if (controls.toggle.checked) {

            enableAnalystAnnotationsLayer();

        }

        else {

            disableAnalystAnnotationsLayer();

        }

    }

    // -------------------------------------------------------------------------
    // Event handlers
    // -------------------------------------------------------------------------

    function handleAddButtonClick() {

        const text =
            readAnnotationText();

        if (!text) {

            window.alert(
                "Enter an analytical note before activating placement mode."
            );

            controls.textInput?.focus();

            return;

        }

        setAddMode(true);

    }

    function handleMapClick(event) {

        if (!addMode) {
            return;
        }

        const created =
            addAnnotationAt(
                event.latlng
            );

        if (created) {
            setAddMode(false);
        }

    }

    function handleClearButtonClick() {

        if (!annotations.length) {

            updateSummary();

            return;

        }

        const confirmed =
            window.confirm(
                "Delete all analyst annotations?"
            );

        if (!confirmed) {
            return;
        }

        clearAnalystAnnotationsLayer();

    }

    function handleToggleChange() {

        syncLayerVisibilityFromToggle();

    }

    function bindControls() {

        controls.addButton?.addEventListener(
            "click",
            handleAddButtonClick
        );

        controls.clearButton?.addEventListener(
            "click",
            handleClearButtonClick
        );

        controls.toggle?.addEventListener(
            "change",
            handleToggleChange
        );

        mapInstance?.on(
            "click",
            handleMapClick
        );

    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    function clearAnalystAnnotationsLayer() {

        annotations = [];

        markers = [];

        saveAnnotationsToStorage();

        ensureLayerGroup()?.clearLayers();

        setAddMode(false);

        updateSummary();

        return true;

    }

    function initAnalystAnnotationsLayer(options = {}) {

        if (initialized) {

            console.warn(
                "[analyst-annotations] "
                +
                "The layer has already been initialized."
            );

            return getAnalystAnnotationsState();

        }

        mapInstance =
            options.map || null;

        if (!mapInstance) {

            throw new Error(
                "initAnalystAnnotationsLayer requires a Leaflet map."
            );

        }

        if (
            typeof window.L === "undefined"
        ) {

            throw new Error(
                "Leaflet is unavailable."
            );

        }

        controls = {

            toggle:
                options.toggle || null,

            addButton:
                options.addButton || null,

            clearButton:
                options.clearButton || null,

            textInput:
                options.textInput || null,

            typeSelect:
                options.typeSelect || null,

            summary:
                options.summary || null

        };

        injectStyles();

        ensurePane();

        ensureLayerGroup();

        annotations =
            loadAnnotationsFromStorage();

        bindControls();

        renderAnnotations();

        syncLayerVisibilityFromToggle();

        initialized = true;

        console.info(

            "[analyst-annotations]",

            {

                loaded:
                    annotations.length,

                enabled,

                storageKey:
                    STORAGE_KEY

            }

        );

        return getAnalystAnnotationsState();

    }

    // -------------------------------------------------------------------------
    // Public state
    // -------------------------------------------------------------------------

    function getAnalystAnnotations() {

        return annotations.map(
            item => ({ ...item })
        );

    }

    function getAnalystAnnotationsState() {

        return {

            initialized,

            enabled,

            addMode,

            count:
                annotations.length,

            markerCount:
                markers.length,

            storageKey:
                STORAGE_KEY,

            lastError,

            layerAvailable:
                Boolean(layerGroup),

            mapAvailable:
                Boolean(mapInstance)

        };

    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    window.initAnalystAnnotationsLayer =
        initAnalystAnnotationsLayer;

    window.enableAnalystAnnotationsLayer =
        enableAnalystAnnotationsLayer;

    window.disableAnalystAnnotationsLayer =
        disableAnalystAnnotationsLayer;

    window.clearAnalystAnnotationsLayer =
        clearAnalystAnnotationsLayer;

    window.getAnalystAnnotations =
        getAnalystAnnotations;

    window.getAnalystAnnotationsState =
        getAnalystAnnotationsState;

})();
