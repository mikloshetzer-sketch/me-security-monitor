/*
 * ME Security Monitor
 * Unified dashboard navigation block
 *
 * File:
 *   js/dashboard-navigation.js
 *
 * Load after script.js:
 *   <script src="./js/dashboard-navigation.js"></script>
 */

(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const ROOT_ID = "analysisDashboardNavigation";
  const STYLE_ID = "analysis-dashboard-navigation-styles";

  const DASHBOARDS = [
    {
      id: "openCirAnalysisBtn",
      label: "CIR Incident Dashboard",
      icon: "CIR",
      description: "Verified incident analysis, response phases and structured CIR filters.",
      sourceClass: "cir",
      existing: true
    },
    {
      id: "openIranStrikeAnalysisBtn",
      label: "IranStrike Dashboard",
      icon: "IS",
      description: "Independent Iran-focused incident trends, locations and categories.",
      sourceClass: "iranstrike",
      existing: true
    },
    {
      id: "openIdfAnalysisBtn",
      label: "IDF Official Source Dashboard",
      icon: "IDF",
      description: "Official statement trends, regions, target profiles and claimed results.",
      sourceClass: "idf",
      existing: false,
      href: "idf-analysis.html"
    }
  ];

  let initialized = false;
  let observer = null;
  let retryTimer = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .analysis-dashboard-navigation {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,.10);
      }
      .analysis-dashboard-navigation__head {
        display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px;
      }
      .analysis-dashboard-navigation__title {font-size:12px;font-weight:850;line-height:1.25;}
      .analysis-dashboard-navigation__subtitle {margin-top:3px;opacity:.68;font-size:9px;line-height:1.35;}
      .analysis-dashboard-navigation__badge {flex:0 0 auto;padding:3px 7px;border-radius:999px;background:rgba(255,255,255,.09);font-size:9px;font-weight:800;}
      .analysis-dashboard-navigation__list {display:grid;gap:7px;}
      .analysis-dashboard-navigation__item {
        display:grid;grid-template-columns:36px minmax(0,1fr) 20px;gap:8px;align-items:center;
        width:100%;min-height:58px;margin:0!important;padding:8px 9px!important;
        border:1px solid rgba(255,255,255,.12)!important;
        border-left:4px solid var(--dashboard-accent,#8ca0b3)!important;
        border-radius:9px!important;background:rgba(255,255,255,.055)!important;
        color:inherit!important;text-align:left!important;box-shadow:none!important;
        transition:background .16s ease,border-color .16s ease,transform .16s ease;
      }
      .analysis-dashboard-navigation__item:hover {background:rgba(255,255,255,.105)!important;border-color:rgba(255,255,255,.22)!important;transform:translateY(-1px);}
      .analysis-dashboard-navigation__item.cir {--dashboard-accent:#8b5cf6;}
      .analysis-dashboard-navigation__item.iranstrike {--dashboard-accent:#3b82f6;}
      .analysis-dashboard-navigation__item.idf {--dashboard-accent:#dc4b4b;}
      .analysis-dashboard-navigation__icon {display:inline-grid;place-items:center;width:34px;height:34px;border-radius:8px;background:var(--dashboard-accent,#8ca0b3);color:#fff;font-size:9px;font-weight:900;letter-spacing:.035em;}
      .analysis-dashboard-navigation__copy {min-width:0;}
      .analysis-dashboard-navigation__name {display:block;font-size:11px;font-weight:850;line-height:1.25;}
      .analysis-dashboard-navigation__description {display:block;margin-top:3px;opacity:.68;font-size:9px;line-height:1.35;}
      .analysis-dashboard-navigation__arrow {opacity:.64;font-size:15px;font-weight:800;text-align:right;}
      .analysis-dashboard-navigation__moved-note {margin-top:7px;opacity:.6;font-size:9px;line-height:1.4;}
      .dashboard-button-placeholder {margin-top:7px;padding:6px 7px;border-radius:7px;background:rgba(255,255,255,.04);opacity:.58;font-size:9px;line-height:1.35;}
    `;
    document.head.appendChild(style);
  }

  function createHub() {
    const existing = document.getElementById(ROOT_ID);
    if (existing) return existing;

    const hub = document.createElement("div");
    hub.id = ROOT_ID;
    hub.className = "analysis-dashboard-navigation";
    hub.dataset.controlBlock = "analysis-dashboards";
    hub.innerHTML = `
      <div class="analysis-dashboard-navigation__head">
        <div>
          <div class="analysis-dashboard-navigation__title">Analysis dashboards</div>
          <div class="analysis-dashboard-navigation__subtitle">Open detailed source-specific analytical pages</div>
        </div>
        <span class="analysis-dashboard-navigation__badge">${DASHBOARDS.length} pages</span>
      </div>
      <div class="analysis-dashboard-navigation__list" id="analysisDashboardNavigationList"></div>
      <div class="analysis-dashboard-navigation__moved-note">Dashboard links are grouped here. Map-layer switches remain in their original source sections.</div>
    `;
    return hub;
  }

  function findInsertionPoint() {
    return document.querySelector('[data-control-block="cir-incidents"]') ||
      document.querySelector('[data-control-block="iranstrike"]') ||
      document.querySelector('[data-control-block="attack-annotations"]');
  }

  function decorateButton(button, dashboard) {
    button.type = "button";
    button.className = `analysis-dashboard-navigation__item ${dashboard.sourceClass}`;
    button.removeAttribute("style");
    button.setAttribute("aria-label", `Open ${dashboard.label}`);
    button.innerHTML = `
      <span class="analysis-dashboard-navigation__icon">${dashboard.icon}</span>
      <span class="analysis-dashboard-navigation__copy">
        <span class="analysis-dashboard-navigation__name">${dashboard.label}</span>
        <span class="analysis-dashboard-navigation__description">${dashboard.description}</span>
      </span>
      <span class="analysis-dashboard-navigation__arrow">›</span>
    `;
    return button;
  }

  function addPlaceholderAtOldLocation(button, dashboard) {
    const oldParent = button.parentElement;
    if (!oldParent) return;
    if (oldParent.querySelector(`[data-dashboard-placeholder="${dashboard.id}"]`)) return;

    const placeholder = document.createElement("div");
    placeholder.className = "dashboard-button-placeholder";
    placeholder.dataset.dashboardPlaceholder = dashboard.id;
    placeholder.textContent = `${dashboard.label} is available in the shared Analysis dashboards section.`;
    oldParent.insertBefore(placeholder, button);
  }

  function createIdfButton(dashboard) {
    const button = document.createElement("button");
    button.id = dashboard.id;
    button.addEventListener("click", () => {
      window.location.href = dashboard.href;
    });
    return decorateButton(button, dashboard);
  }

  function moveExistingButton(dashboard, list) {
    const button = document.getElementById(dashboard.id);
    if (!button) return false;

    if (button.parentElement !== list) {
      addPlaceholderAtOldLocation(button, dashboard);
      list.appendChild(button);
    }

    decorateButton(button, dashboard);
    return true;
  }

  function initialize() {
    if (initialized) return true;

    const insertionPoint = findInsertionPoint();
    const cirButton = document.getElementById("openCirAnalysisBtn");
    const iranStrikeButton = document.getElementById("openIranStrikeAnalysisBtn");

    if (!insertionPoint || !cirButton || !iranStrikeButton) return false;

    injectStyles();
    const hub = createHub();
    insertionPoint.insertAdjacentElement("beforebegin", hub);
    const list = hub.querySelector("#analysisDashboardNavigationList");

    DASHBOARDS.forEach(dashboard => {
      if (dashboard.existing) {
        moveExistingButton(dashboard, list);
      } else {
        const existing = document.getElementById(dashboard.id);
        if (existing) {
          decorateButton(existing, dashboard);
          if (existing.parentElement !== list) list.appendChild(existing);
        } else {
          list.appendChild(createIdfButton(dashboard));
        }
      }
    });

    initialized = true;
    if (observer) observer.disconnect();
    if (retryTimer) window.clearInterval(retryTimer);

    console.info("[dashboard-navigation]", {
      initialized: true,
      dashboardCount: DASHBOARDS.length
    });

    return true;
  }

  function startObserver() {
    if (initialize()) return;

    observer = new MutationObserver(initialize);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    retryTimer = window.setInterval(initialize, 500);

    window.setTimeout(() => {
      if (!initialized) {
        console.warn("[dashboard-navigation] Existing CIR and IranStrike buttons were not found.");
      }
    }, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }
})();
