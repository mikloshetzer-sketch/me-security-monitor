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
