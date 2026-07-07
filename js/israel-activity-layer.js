/* ==========================================================================
   Israel Activity Layer
   Middle East Security Monitor
   --------------------------------------------------------------------------
   Loads:
     data/israel-activity.json

   Creates:
     window.israelActivityLayer

   Public functions:
     loadIsraelActivityLayer(map)
     refreshIsraelActivityLayer()
     clearIsraelActivityLayer()

   ========================================================================== */

(function () {

    "use strict";

    let mapInstance = null;

    let markers = [];

    let layerGroup = L.layerGroup();

    window.israelActivityLayer = layerGroup;

    //--------------------------------------------------------------------------

    function markerColor(type) {

        switch (type) {

            case "airstrike":
                return "#e53935";

            case "ground_activity":
                return "#fb8c00";

            case "artillery":
                return "#8e24aa";

            case "cross_border_fire":
                return "#f4511e";

            case "evacuation_warning":
                return "#fdd835";

            case "humanitarian_zone":
                return "#43a047";

            case "drone_activity":
                return "#1e88e5";

            default:
                return "#607d8b";
        }

    }

    //--------------------------------------------------------------------------

    function markerRadius(intensity) {

        switch (intensity) {

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

    //--------------------------------------------------------------------------

    function buildPopup(event) {

        return `
        <div style="min-width:260px">

            <h3 style="margin-top:0;">
                ${event.location_name}
            </h3>

            <table style="width:100%;font-size:13px;">

                <tr>
                    <td><b>Date</b></td>
                    <td>${event.date}</td>
                </tr>

                <tr>
                    <td><b>UTC</b></td>
                    <td>${event.time_utc}</td>
                </tr>

                <tr>
                    <td><b>Region</b></td>
                    <td>${event.region}</td>
                </tr>

                <tr>
                    <td><b>Activity</b></td>
                    <td>${event.activity_type}</td>
                </tr>

                <tr>
                    <td><b>Intensity</b></td>
                    <td>${event.intensity}</td>
                </tr>

                <tr>
                    <td><b>Confidence</b></td>
                    <td>${event.confidence}/5</td>
                </tr>

            </table>

            <hr>

            <p>${event.summary}</p>

            <small>
                ${event.analysis_note}
            </small>

        </div>
        `;
    }

    //--------------------------------------------------------------------------

    function clearIsraelActivityLayer() {

        markers = [];

        layerGroup.clearLayers();

    }

    //--------------------------------------------------------------------------

    async function refreshIsraelActivityLayer() {

        clearIsraelActivityLayer();

        try {

            const response = await fetch("data/israel-activity.json");

            const data = await response.json();

            if (!data.events) {

                console.warn("No Israel activity events found.");

                return;
            }

            data.events.forEach(event => {

                const marker = L.circleMarker(

                    [event.latitude, event.longitude],

                    {

                        radius: markerRadius(event.intensity),

                        color: markerColor(event.activity_type),

                        fillColor: markerColor(event.activity_type),

                        fillOpacity: 0.8,

                        weight: 2

                    }

                );

                marker.bindPopup(buildPopup(event));

                marker.eventData = event;

                marker.addTo(layerGroup);

                markers.push(marker);

            });

        }

        catch (err) {

            console.error("Israel activity layer loading failed.", err);

        }

    }

    //--------------------------------------------------------------------------

    async function loadIsraelActivityLayer(map) {

        mapInstance = map;

        await refreshIsraelActivityLayer();

        if (!map.hasLayer(layerGroup)) {

            layerGroup.addTo(map);

        }

    }

    //--------------------------------------------------------------------------

    window.loadIsraelActivityLayer = loadIsraelActivityLayer;

    window.refreshIsraelActivityLayer = refreshIsraelActivityLayer;

    window.clearIsraelActivityLayer = clearIsraelActivityLayer;

})();
