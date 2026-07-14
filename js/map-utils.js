/* ==========================================================================
   ME Security Monitor – Shared Map Utilities
   --------------------------------------------------------------------------
   File:
     js/map-utils.js

   Purpose:
     Shared Leaflet helpers for IranStrike, CIR, IDF and future map layers.

   Public API:
     window.MEMapUtils

   Main functions:
     groupByCoordinate(events, options)
     spreadOverlappingEvents(events, map, options)
     getDisplayLatLng(event, map, groupInfo, options)
     bringLayerToFront(layer)
     escapeHtml(value)
     formatDate(value, options)
     truncateText(value, maxLength)
     humanize(value)
     validCoordinate(latitude, longitude)
     createPopupLink(url, label)
   ========================================================================== */

(function () {

    "use strict";

    if (typeof window === "undefined") {
        return;
    }

    const DEFAULT_SPREAD_OPTIONS = {

        coordinatePrecision: 6,

        minPixelRadius: 18,

        maxPixelRadius: 34,

        radiusStep: 4,

        startAngleDegrees: -90,

        preserveOriginalCoordinates: true,

        includeSingletons: true

    };

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

    function truncateText(value, maxLength = 180) {

        const text = asText(value);

        if (
            !Number.isFinite(Number(maxLength)) ||
            Number(maxLength) < 2
        ) {
            return text;
        }

        const limit = Math.floor(Number(maxLength));

        if (text.length <= limit) {
            return text;
        }

        return (
            text
                .slice(0, limit - 1)
                .trim()
            + "…"
        );

    }

    function parseDate(value) {

        if (!value) {
            return null;
        }

        const date = new Date(value);

        return Number.isNaN(date.getTime())
            ? null
            : date;

    }

    function formatDate(
        value,
        options = {}
    ) {

        const date = parseDate(value);

        if (!date) {
            return asText(
                value,
                options.fallback || "Unknown time"
            );
        }

        const locale =
            options.locale || "en-GB";

        const timeZone =
            options.timeZone || "UTC";

        const showTime =
            options.showTime !== false;

        const formatOptions = {

            year: "numeric",

            month:
                options.month || "short",

            day: "2-digit",

            timeZone

        };

        if (showTime) {

            formatOptions.hour = "2-digit";

            formatOptions.minute = "2-digit";

            formatOptions.hour12 = false;

        }

        const formatted =
            new Intl.DateTimeFormat(
                locale,
                formatOptions
            ).format(date);

        return (
            showTime &&
            options.appendTimeZone !== false
        )
            ? `${formatted} ${timeZone}`
            : formatted;

    }

    function normalizeCoordinate(
        value,
        precision = 6
    ) {

        const number =
            asNumber(value);

        if (!Number.isFinite(number)) {
            return null;
        }

        const safePrecision =
            Math.min(
                10,
                Math.max(
                    0,
                    Math.floor(
                        Number(precision) || 0
                    )
                )
            );

        return number.toFixed(safePrecision);

    }

    function coordinateKey(
        latitude,
        longitude,
        precision = 6
    ) {

        const lat =
            normalizeCoordinate(
                latitude,
                precision
            );

        const lng =
            normalizeCoordinate(
                longitude,
                precision
            );

        if (
            lat === null ||
            lng === null
        ) {
            return "";
        }

        return `${lat}:${lng}`;

    }

    function eventLatitude(event) {

        return asNumber(

            event?.latitude ??
            event?.lat ??
            event?.location?.latitude

        );

    }

    function eventLongitude(event) {

        return asNumber(

            event?.longitude ??
            event?.lng ??
            event?.lon ??
            event?.location?.longitude

        );

    }

    function groupByCoordinate(
        events,
        options = {}
    ) {

        const config = {

            ...DEFAULT_SPREAD_OPTIONS,

            ...options

        };

        const groups =
            new Map();

        asArray(events).forEach(
            (
                event,
                index
            ) => {

                const latitude =
                    eventLatitude(event);

                const longitude =
                    eventLongitude(event);

                if (
                    !validCoordinate(
                        latitude,
                        longitude
                    )
                ) {
                    return;
                }

                const key =
                    coordinateKey(
                        latitude,
                        longitude,
                        config.coordinatePrecision
                    );

                if (!groups.has(key)) {

                    groups.set(
                        key,
                        {

                            key,

                            latitude,

                            longitude,

                            events: []

                        }
                    );

                }

                groups
                    .get(key)
                    .events
                    .push(
                        {

                            event,

                            sourceIndex:
                                index

                        }
                    );

            }
        );

        return groups;

    }

    function spreadRadius(
        count,
        options = {}
    ) {

        const config = {

            ...DEFAULT_SPREAD_OPTIONS,

            ...options

        };

        if (count <= 1) {
            return 0;
        }

        const radius =

            config.minPixelRadius

            +

            Math.max(
                0,
                count - 2
            )

            *

            config.radiusStep;

        return Math.min(
            config.maxPixelRadius,
            radius
        );

    }

    function angleForIndex(
        index,
        count,
        options = {}
    ) {

        const config = {

            ...DEFAULT_SPREAD_OPTIONS,

            ...options

        };

        if (count <= 1) {
            return 0;
        }

        const startAngle =
            Number(
                config.startAngleDegrees
            ) || 0;

        return (
            startAngle +
            (
                index /
                count
            ) *
            360
        );

    }

    function pixelOffsetForIndex(
        index,
        count,
        options = {}
    ) {

        if (count <= 1) {

            return {

                x: 0,

                y: 0,

                radius: 0,

                angleDegrees: 0

            };

        }

        const radius =
            spreadRadius(
                count,
                options
            );

        const angleDegrees =
            angleForIndex(
                index,
                count,
                options
            );

        const angleRadians =
            angleDegrees *
            Math.PI /
            180;

        return {

            x:
                Math.cos(angleRadians)
                *
                radius,

            y:
                Math.sin(angleRadians)
                *
                radius,

            radius,

            angleDegrees

        };

    }

    function requireLeafletMap(map) {

        if (
            !map ||
            typeof map.latLngToLayerPoint !== "function" ||
            typeof map.layerPointToLatLng !== "function"
        ) {

            throw new Error(

                "A valid Leaflet map instance "
                +
                "is required."

            );

        }

    }

    function offsetLatLng(
        map,
        latitude,
        longitude,
        pixelOffset
    ) {

        requireLeafletMap(map);

        const lat =
            asNumber(latitude);

        const lng =
            asNumber(longitude);

        if (
            !validCoordinate(
                lat,
                lng
            )
        ) {
            return null;
        }

        const originalLatLng =
            window.L.latLng(
                lat,
                lng
            );

        const originalPoint =
            map.latLngToLayerPoint(
                originalLatLng
            );

        const displayPoint =
            window.L.point(

                originalPoint.x
                +
                (
                    Number(
                        pixelOffset?.x
                    ) || 0
                ),

                originalPoint.y
                +
                (
                    Number(
                        pixelOffset?.y
                    ) || 0
                )

            );

        const displayLatLng =
            map.layerPointToLatLng(
                displayPoint
            );

        return {

            originalLatLng,

            displayLatLng,

            pixelOffset: {

                x:
                    Number(
                        pixelOffset?.x
                    ) || 0,

                y:
                    Number(
                        pixelOffset?.y
                    ) || 0

            }

        };

    }

    function spreadOverlappingEvents(
        events,
        map,
        options = {}
    ) {

        requireLeafletMap(map);

        const config = {

            ...DEFAULT_SPREAD_OPTIONS,

            ...options

        };

        const groups =
            groupByCoordinate(
                events,
                config
            );

        const result = [];

        groups.forEach(group => {

            const count =
                group.events.length;

            group.events.forEach(
                (
                    entry,
                    groupIndex
                ) => {

                    const offset =
                        pixelOffsetForIndex(
                            groupIndex,
                            count,
                            config
                        );

                    const position =
                        offsetLatLng(
                            map,
                            group.latitude,
                            group.longitude,
                            offset
                        );

                    if (!position) {
                        return;
                    }

                    result.push({

                        event:
                            entry.event,

                        sourceIndex:
                            entry.sourceIndex,

                        groupKey:
                            group.key,

                        groupIndex,

                        groupCount:
                            count,

                        originalLatitude:
                            group.latitude,

                        originalLongitude:
                            group.longitude,

                        displayLatitude:
                            position
                                .displayLatLng
                                .lat,

                        displayLongitude:
                            position
                                .displayLatLng
                                .lng,

                        pixelOffset:
                            position.pixelOffset,

                        isOverlapping:
                            count > 1

                    });

                }
            );

        });

        return result.sort(
            (
                left,
                right
            ) =>
                left.sourceIndex
                -
                right.sourceIndex
        );

    }

    function getDisplayLatLng(
        event,
        map,
        groupInfo = null,
        options = {}
    ) {

        const latitude =
            eventLatitude(event);

        const longitude =
            eventLongitude(event);

        if (
            !validCoordinate(
                latitude,
                longitude
            )
        ) {
            return null;
        }

        if (
            !groupInfo ||
            groupInfo.groupCount <= 1
        ) {

            return {

                originalLatitude:
                    latitude,

                originalLongitude:
                    longitude,

                displayLatitude:
                    latitude,

                displayLongitude:
                    longitude,

                pixelOffset: {
                    x: 0,
                    y: 0
                },

                isOverlapping:
                    false

            };

        }

        const offset =
            pixelOffsetForIndex(

                groupInfo.groupIndex,

                groupInfo.groupCount,

                options

            );

        const position =
            offsetLatLng(
                map,
                latitude,
                longitude,
                offset
            );

        if (!position) {
            return null;
        }

        return {

            originalLatitude:
                latitude,

            originalLongitude:
                longitude,

            displayLatitude:
                position
                    .displayLatLng
                    .lat,

            displayLongitude:
                position
                    .displayLatLng
                    .lng,

            pixelOffset:
                position.pixelOffset,

            isOverlapping:
                true

        };

    }

    function bringLayerToFront(layer) {

        if (!layer) {
            return;
        }

        if (
            typeof layer.bringToFront === "function"
        ) {

            layer.bringToFront();

        }

        if (
            typeof layer.setZIndexOffset === "function"
        ) {

            layer.setZIndexOffset(10000);

        }

        const element =
            typeof layer.getElement === "function"
                ? layer.getElement()
                : null;

        if (element) {

            element.style.zIndex =
                "10000";

        }

    }

    function restoreLayerZIndex(
        layer,
        fallback = 0
    ) {

        if (!layer) {
            return;
        }

        if (
            typeof layer.setZIndexOffset === "function"
        ) {

            layer.setZIndexOffset(
                Number(fallback) || 0
            );

        }

        const element =
            typeof layer.getElement === "function"
                ? layer.getElement()
                : null;

        if (element) {

            element.style.zIndex = "";

        }

    }

    function bindBringToFront(
        layer,
        options = {}
    ) {

        if (
            !layer ||
            typeof layer.on !== "function"
        ) {
            return layer;
        }

        const resetOnClose =
            options.resetOnClose !== false;

        layer.on(
            "click popupopen mouseover",
            () => {

                bringLayerToFront(layer);

            }
        );

        if (resetOnClose) {

            layer.on(
                "popupclose mouseout",
                () => {

                    restoreLayerZIndex(
                        layer,
                        options.fallbackZIndex || 0
                    );

                }
            );

        }

        return layer;

    }

    function createPopupLink(
        url,
        label = "Open source ↗",
        options = {}
    ) {

        const href =
            asText(url);

        if (!href) {
            return "";
        }

        const className =
            asText(
                options.className,
                "me-popup-source-link"
            );

        return `

            <a

                class="${escapeHtml(
                    className
                )}"

                href="${escapeHtml(
                    href
                )}"

                target="_blank"

                rel="noopener noreferrer"

            >

                ${escapeHtml(label)}

            </a>

        `;

    }

    function cloneEventsWithDisplayCoordinates(
        events,
        map,
        options = {}
    ) {

        return spreadOverlappingEvents(
            events,
            map,
            options
        ).map(item => {

            return {

                ...item.event,

                original_latitude:
                    item.originalLatitude,

                original_longitude:
                    item.originalLongitude,

                display_latitude:
                    item.displayLatitude,

                display_longitude:
                    item.displayLongitude,

                marker_overlap_group:
                    item.groupKey,

                marker_overlap_index:
                    item.groupIndex,

                marker_overlap_count:
                    item.groupCount,

                marker_pixel_offset:
                    item.pixelOffset

            };

        });

    }

    window.MEMapUtils = Object.freeze({

        DEFAULT_SPREAD_OPTIONS,

        asText,

        asNumber,

        asArray,

        validCoordinate,

        escapeHtml,

        humanize,

        truncateText,

        parseDate,

        formatDate,

        normalizeCoordinate,

        coordinateKey,

        eventLatitude,

        eventLongitude,

        groupByCoordinate,

        spreadRadius,

        angleForIndex,

        pixelOffsetForIndex,

        offsetLatLng,

        spreadOverlappingEvents,

        getDisplayLatLng,

        cloneEventsWithDisplayCoordinates,

        bringLayerToFront,

        restoreLayerZIndex,

        bindBringToFront,

        createPopupLink

    });

})();
