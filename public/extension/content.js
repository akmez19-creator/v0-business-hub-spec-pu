// Akmez Quick Order v4.0 - Draggable Floating Widget with Full Functionality

const API_BASE = 'https://www.akmez.tech';

// Create floating toggle button
const toggleBtn = document.createElement('div');
toggleBtn.id = 'akmez-toggle';
toggleBtn.innerHTML = '<span>A</span>';
toggleBtn.title = 'Open Akmez Quick Order';
document.body.appendChild(toggleBtn);

// ===== Idle tuck-away: after 4s untouched, slide halfway off the edge =====
let akmezIdleTimer = null;
function akmezArmIdle() {
  toggleBtn.classList.remove('akmez-idle');
  clearTimeout(akmezIdleTimer);
  akmezIdleTimer = setTimeout(() => toggleBtn.classList.add('akmez-idle'), 4000);
}
toggleBtn.addEventListener('mouseenter', akmezArmIdle);
toggleBtn.addEventListener('focus', akmezArmIdle);
akmezArmIdle();

// ===== Drag the launcher up/down the edge; position is remembered =====
// A real click (< 6px movement) still toggles the panel as before.
let akmezDragMoved = false;
(function initToggleDrag() {
  let startY = 0, startBottom = 0, dragging = false;
  chrome.storage.local.get(['toggleBottom'], s => {
    if (typeof s.toggleBottom === 'number') {
      toggleBtn.style.bottom = Math.min(Math.max(s.toggleBottom, 8), window.innerHeight - 46) + 'px';
    }
  });
  toggleBtn.addEventListener('pointerdown', e => {
    dragging = true; akmezDragMoved = false;
    startY = e.clientY;
    startBottom = parseInt(getComputedStyle(toggleBtn).bottom, 10) || 20;
    toggleBtn.setPointerCapture(e.pointerId);
    clearTimeout(akmezIdleTimer);
    toggleBtn.classList.remove('akmez-idle');
  });
  toggleBtn.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 6) akmezDragMoved = true;
    if (!akmezDragMoved) return;
    toggleBtn.classList.add('akmez-dragging');
    const next = Math.min(Math.max(startBottom + dy, 8), window.innerHeight - 46);
    toggleBtn.style.bottom = next + 'px';
  });
  toggleBtn.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    toggleBtn.classList.remove('akmez-dragging');
    if (akmezDragMoved) {
      chrome.storage.local.set({ toggleBottom: parseInt(toggleBtn.style.bottom, 10) || 20 });
    }
    akmezArmIdle();
  });
})();

// Update toggle button based on auth state
function updateToggleButton() {
  chrome.storage.local.get(['authToken'], stored => {
    const isLoggedIn = !!stored.authToken;
    if (isLoggedIn) {
      toggleBtn.classList.add('logged-in');
      toggleBtn.title = 'Open Akmez Quick Order (Signed In)';
    } else {
      toggleBtn.classList.remove('logged-in');
      toggleBtn.title = 'Open Akmez Quick Order (Sign In Required)';
    }
  });
}

// Listen for auth state changes from popup
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && (changes.authToken || changes.tokenExpiry)) {
    updateToggleButton();
    // If widget is open, reload data
    if (widget.style.display !== 'none') {
      loadData();
    }
  }
});

// Check auth state on load
updateToggleButton();

// Real extension version from the manifest (single source of truth)
const EXT_VERSION = (() => {
  try { return chrome.runtime.getManifest().version; } catch { return ''; }
})();

// Create floating widget with tabs
const widget = document.createElement('div');
widget.id = 'akmez-widget';
widget.setAttribute('role', 'dialog');
widget.setAttribute('aria-label', 'Akmez Quick Order');
widget.innerHTML = `
  <div class="akmez-header" id="akmez-drag">
    <div class="akmez-logo">A</div>
    <div style="flex:1">
      <span>Quick Order${EXT_VERSION ? ' v' + EXT_VERSION : ''}</span>
      <span id="akmez-page-badge" style="display:none"></span>
      <div style="font-size:10px;opacity:0.7">Create orders from anywhere</div>
    </div>
    <div class="akmez-header-btns">
      <button class="akmez-hbtn" id="akmez-settings" title="Settings" aria-label="Open settings">&#9881;</button>
      <button class="akmez-hbtn" id="akmez-close" title="Close" aria-label="Close panel">&times;</button>
    </div>
  </div>
  <div class="akmez-cutoff-banner" id="akmez-cutoff-banner" style="display:none">
    <span class="akmez-cutoff-pulse"></span>
    <span class="akmez-cutoff-text">Cut-off in <strong id="akmez-cutoff-count">00:00</strong></span>
  </div>
  <div class="akmez-tabs">
    <button class="akmez-tab active" data-tab="orders">&#128203; Orders</button>
    <button class="akmez-tab" data-tab="stats">&#128202; My Stats</button>
    <button class="akmez-tab" data-tab="worktime">&#9201; Working Time</button>
  </div>
  <div class="akmez-body" id="akmez-body">
    <div class="akmez-loading"><div class="akmez-spinner"></div></div>
  </div>
`;
widget.style.display = 'none';
document.body.appendChild(widget);

// Styles
const style = document.createElement('style');
style.textContent = `
#akmez-widget, #akmez-widget *{box-sizing:border-box;}
/* Compact launcher: 38px (down from 56px). After a few idle seconds it tucks
   itself halfway off the right edge at reduced opacity so it never blocks
   page content - hovering or focusing it brings it back instantly. It is
   also draggable up/down along the edge (position is remembered). */
#akmez-toggle{position:fixed;bottom:20px;right:12px;width:38px;height:38px;background:linear-gradient(135deg,#6b7280,#4b5563);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:grab;z-index:2147483646;box-shadow:0 3px 12px rgba(107,114,128,0.45);font-family:sans-serif;transition:transform 0.25s ease,opacity 0.25s ease,box-shadow 0.25s ease;touch-action:none;}
#akmez-toggle:hover{transform:scale(1.08);}
#akmez-toggle span{color:white;font-size:16px;font-weight:800;pointer-events:none;}
#akmez-toggle.logged-in{background:linear-gradient(135deg,#f97316,#ea580c);box-shadow:0 3px 12px rgba(249,115,22,0.45);}
#akmez-toggle.logged-in::after{content:'';position:absolute;top:-2px;right:-2px;width:10px;height:10px;background:#10b981;border-radius:50%;border:2px solid #1a1a2e;}
#akmez-toggle.akmez-idle{transform:translateX(60%);opacity:0.4;}
#akmez-toggle.akmez-idle:hover,#akmez-toggle.akmez-idle:focus-visible{transform:translateX(0) scale(1.08);opacity:1;}
#akmez-toggle.akmez-dragging{cursor:grabbing;transition:none;opacity:1;}
/* Never tuck away while the cut-off alert is pulsing - it must stay visible */
#akmez-toggle.cutoff-alert.akmez-idle{transform:none;opacity:1;}
/* Compact by default (~400px on a 1080p screen, matching the intended look) and
   scales proportionally with screen resolution via a viewport-relative width:
   21vw = ~403px at 1920px wide, ~538px at 2560px, capped at 560px on 4K, and
   never below 360px on small screens. Height stays bounded to the viewport so
   the sticky footer / Create Order button is always on-screen (no zoom, which
   would scale the height and push the footer off-screen). */
#akmez-widget{position:fixed;top:40px;right:20px;width:clamp(360px,21vw,560px);max-width:calc(100vw - 40px);height:calc(100vh - 80px);max-height:calc(100vh - 80px);background:linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 100%);border-radius:16px;box-shadow:0 10px 50px rgba(0,0,0,0.6);border:2px solid #f97316;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;overflow:hidden;display:flex;flex-direction:column;}
/* Accessibility: clear keyboard-focus ring on every interactive control */
#akmez-widget button:focus-visible,#akmez-widget input:focus-visible,#akmez-widget select:focus-visible,#akmez-widget [tabindex]:focus-visible,#akmez-toggle:focus-visible{outline:3px solid #38bdf8;outline-offset:2px;border-radius:6px;}
/* Respect users who prefer reduced motion */
@media (prefers-reduced-motion:reduce){#akmez-widget *,#akmez-toggle{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;}}
.akmez-header{background:linear-gradient(120deg,#fb923c 0%,#f97316 45%,#ea580c 100%);padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:move;user-select:none;box-shadow:inset 0 -1px 0 rgba(0,0,0,0.25),0 2px 12px rgba(249,115,22,0.25);}
.akmez-logo{width:34px;height:34px;background:rgba(255,255,255,0.22);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.3);}
.akmez-header span{font-weight:700;font-size:14px;text-shadow:0 1px 2px rgba(0,0,0,0.2);}
.akmez-header-btns{display:flex;gap:6px;}
.akmez-hbtn{width:32px;height:32px;border:none;border-radius:8px;background:rgba(255,255,255,0.18);color:white;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s,transform 0.15s;}
.akmez-hbtn:hover{background:rgba(255,255,255,0.32);transform:translateY(-1px);}
.akmez-tabs{display:flex;background:rgba(0,0,0,0.35);border-bottom:1px solid rgba(255,255,255,0.08);}
.akmez-tab{flex:1;padding:12px 12px;background:none;border:none;color:#8b93a7;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;border-bottom:2px solid transparent;transition:all 0.15s;min-height:44px;}
.akmez-tab:hover{color:#fff;background:rgba(255,255,255,0.05);}
.akmez-tab.active{color:#fb923c;border-bottom-color:#f97316;background:linear-gradient(180deg,rgba(249,115,22,0.14),rgba(249,115,22,0.04));}
.akmez-body{padding:14px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0;scrollbar-width:thin;scrollbar-color:rgba(249,115,22,0.5) transparent;}
.akmez-body::-webkit-scrollbar{width:8px;}
.akmez-body::-webkit-scrollbar-track{background:transparent;}
.akmez-body::-webkit-scrollbar-thumb{background:rgba(249,115,22,0.35);border-radius:8px;}
.akmez-body::-webkit-scrollbar-thumb:hover{background:rgba(249,115,22,0.6);}
.akmez-loading{text-align:center;padding:40px;color:#888;}
.akmez-spinner{width:32px;height:32px;border:3px solid rgba(249,115,22,0.2);border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px;}
@keyframes spin{to{transform:rotate(360deg);}}

/* Delivery cut-off countdown banner */
.akmez-cutoff-banner{display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 12px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;font-size:12px;font-weight:700;letter-spacing:0.3px;}
.akmez-cutoff-text strong{font-variant-numeric:tabular-nums;font-size:13px;}
.akmez-cutoff-pulse{width:9px;height:9px;border-radius:50%;background:#fff;animation:akmez-pulse 1s ease-in-out infinite;}
@keyframes akmez-pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:0.4;transform:scale(0.7);}}

/* When cut-off is near, recolor the ENTIRE interface to a red alert theme */
#akmez-widget.cutoff-alert{border-color:#dc2626;}
#akmez-widget.cutoff-alert .akmez-header{background:linear-gradient(135deg,#dc2626,#991b1b);}
#akmez-widget.cutoff-alert .akmez-logo{background:rgba(255,255,255,0.25);}
#akmez-widget.cutoff-alert .akmez-tab.active{color:#f87171;border-bottom-color:#dc2626;background:rgba(220,38,38,0.12);}
#akmez-widget.cutoff-alert .akmez-tab:hover{color:#fecaca;}
#akmez-widget.cutoff-alert .akmez-spinner{border-color:rgba(220,38,38,0.2);border-top-color:#dc2626;}
#akmez-toggle.cutoff-alert{background:linear-gradient(135deg,#dc2626,#991b1b) !important;box-shadow:0 4px 20px rgba(220,38,38,0.6) !important;animation:akmez-toggle-pulse 1.2s ease-in-out infinite;}
@keyframes akmez-toggle-pulse{0%,100%{box-shadow:0 4px 20px rgba(220,38,38,0.5);}50%{box-shadow:0 4px 28px rgba(220,38,38,0.9);}}

/* Orders Form Styles */
.akmez-user{background:rgba(139,92,246,0.1);border-radius:8px;padding:8px 12px;font-size:11px;color:#a5b4fc;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.akmez-user .dot{width:8px;height:8px;background:#10b981;border-radius:50%;}
.akmez-row{display:flex;gap:8px;margin-bottom:10px;}
.akmez-field{flex:1;}
.akmez-rating{margin-top:2px;line-height:1.4;display:flex;align-items:center;flex-wrap:wrap;gap:2px;}
.akmez-salestype{display:flex;flex-wrap:wrap;gap:6px;}
.akmez-st-pill{padding:5px 12px;border-radius:9999px;font-size:11px;font-weight:600;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.03);color:#94a3b8;cursor:pointer;transition:all 0.15s;}
.akmez-st-pill:hover{border-color:rgba(255,255,255,0.4);color:#e2e8f0;transform:translateY(-1px);}
.akmez-st-pill.active{background:linear-gradient(135deg,#34d399,#10b981);border-color:#10b981;color:#04110b;box-shadow:0 2px 10px rgba(16,185,129,0.35);}
.akmez-label{font-size:10px;color:#8b93a7;text-transform:uppercase;letter-spacing:0.7px;margin-bottom:5px;font-weight:700;}
.akmez-label .req{color:#f97316;}
.akmez-oldprod-status{font-size:11px;margin-bottom:6px;line-height:1.4;}
.akmez-oldprod-status.loading{color:#94a3b8;}
.akmez-oldprod-status.ok{color:#34d399;font-weight:600;}
.akmez-oldprod-status.blocked{color:#f87171;font-weight:600;}
.akmez-oldprod-picked{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px 8px;margin-top:2px;}
.akmez-oldprod-hint{font-size:11px;color:#94a3b8;margin-top:6px;}
.akmez-oldprod-hint.nil{color:#34d399;}
.akmez-oldprod-hint.pay{color:#fbbf24;font-weight:600;}
.akmez-input-wrap{position:relative;}
.akmez-input{width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 50px 10px 12px;color:white;font-size:13px;outline:none;transition:border-color 0.15s,box-shadow 0.15s,background 0.15s;}
.akmez-input:focus{border-color:#f97316;background:rgba(249,115,22,0.06);box-shadow:0 0 0 3px rgba(249,115,22,0.18);}
.akmez-input:hover:not(:focus){border-color:rgba(255,255,255,0.22);}
.akmez-input::placeholder{color:#5b6172;}
.akmez-paste{position:absolute;right:5px;top:50%;transform:translateY(-50%);background:rgba(249,115,22,0.25);border:1px solid rgba(249,115,22,0.35);border-radius:7px;padding:6px 10px;color:#fb923c;font-size:9px;font-weight:700;cursor:pointer;text-transform:uppercase;transition:all 0.15s;}
.akmez-paste:hover{background:rgba(249,115,22,0.45);color:#fff;}
.akmez-sel-list{margin-bottom:8px;}
.akmez-sel-row{display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:4px;}
.akmez-sel-text{flex:1;font-size:11px;color:#ccc;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.akmez-sel-del{background:rgba(239,68,68,0.15);border:none;color:#fca5a5;width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0;}
.akmez-sel-del:hover{background:rgba(239,68,68,0.3);}
.akmez-sel-empty{font-size:11px;color:#777;padding:8px;text-align:center;line-height:1.4;}
.akmez-hint-text{font-size:10px;color:#777;margin:6px 0 4px;line-height:1.4;}
.akmez-adid-toggle{font-size:11px;color:#f97316;cursor:pointer;margin:2px 0 8px;user-select:none;display:inline-block;}
.akmez-adid-toggle:hover{text-decoration:underline;}
.akmez-select{width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:10px 12px;color:white;font-size:13px;outline:none;cursor:pointer;transition:border-color 0.15s,box-shadow 0.15s;}
.akmez-select:focus{border-color:#f97316;box-shadow:0 0 0 3px rgba(249,115,22,0.18);}
.akmez-select option{background:#1a1a2e;color:white;}
.akmez-input-plain{padding-right:12px;}
.akmez-autocomplete{position:relative;}
.akmez-suggest{position:absolute;left:0;right:0;top:100%;margin-top:4px;z-index:10;background:#181826;border:1px solid rgba(249,115,22,0.4);border-radius:10px;max-height:200px;overflow-y:auto;box-shadow:0 12px 32px rgba(0,0,0,0.55);display:none;}
.akmez-suggest-item{padding:9px 12px;font-size:12px;color:#eee;cursor:pointer;}
.akmez-suggest-item:hover,.akmez-suggest-item.active{background:rgba(249,115,22,0.35);color:#fff;}
  .akmez-cutoff-input{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;color:#fff;font-size:12px;font-weight:600;outline:none;}
  .akmez-cutoff-input:focus{border-color:#f97316;}
  .akmez-notes{resize:vertical;min-height:38px;font-family:inherit;line-height:1.4;}
  .akmez-scheme-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;}
  .akmez-scheme-label{font-size:12px;color:#cbd5e1;}
  .akmez-scheme-select{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:5px 8px;color:#fff;font-size:12px;outline:none;min-width:150px;}
  .akmez-scheme-select:focus{border-color:#f97316;}
  .akmez-scheme-select:disabled{opacity:0.6;}
  /* Non-delivery days (holidays / cyclone closures) */
  .akmez-hol-list{display:flex;flex-direction:column;gap:6px;margin-bottom:8px;max-height:220px;overflow-y:auto;}
  .akmez-hol-row{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:7px 9px;}
  .akmez-hol-type{width:8px;height:8px;border-radius:50%;flex-shrink:0;background:#94a3b8;}
  .akmez-hol-type.fixed{background:#38bdf8;}
  .akmez-hol-type.variable{background:#fbbf24;}
  .akmez-hol-type.adhoc{background:#ef4444;}
  .akmez-hol-main{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0;}
  .akmez-hol-date{font-size:12px;color:#f1f5f9;font-weight:600;}
  .akmez-hol-label{font-size:10px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .akmez-hol-tag{font-size:8px;color:#cbd5e1;background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;letter-spacing:0.4px;flex-shrink:0;}
  .akmez-hol-del{background:none;border:none;color:#ef4444;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;flex-shrink:0;}
  .akmez-hol-del:hover{color:#f87171;}
  .akmez-hol-quick{display:flex;gap:8px;margin-bottom:8px;}
  .akmez-hol-quick .akmez-set-btn{flex:1;margin:0;}
  .akmez-hol-form{display:flex;flex-direction:column;gap:8px;margin-bottom:8px;}
  .akmez-hol-form-row{display:flex;gap:8px;align-items:center;}
  .akmez-hol-form-row .akmez-scheme-select{flex:1;min-width:0;}
  .akmez-hol-form-row .akmez-set-btn{margin:0;white-space:nowrap;}
  .akmez-hol-flabel{flex:1;display:flex;flex-direction:column;gap:3px;font-size:10px;color:#94a3b8;}
  /* Delivery-day climate info strip on the order form */
  .akmez-delivery-info{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:7px 10px;margin:-4px 0 10px;font-size:11px;}
  .akmez-delivery-info.cyclone{background:rgba(239,68,68,0.08);border-color:rgba(239,68,68,0.3);}
  .akmez-di-weather{color:#e2e8f0;font-weight:600;}
  .akmez-di-cyclone{color:#f87171;font-weight:600;}
.akmez-section{display:flex;align-items:center;gap:8px;font-size:10px;color:#fb923c;text-transform:uppercase;letter-spacing:1.2px;margin:16px 0 8px;font-weight:700;}
.akmez-section::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(249,115,22,0.4),transparent);}
.akmez-subsection{font-size:11px;color:#bbb;font-weight:600;margin:12px 0 6px;}
.akmez-managed-tag{background:rgba(16,185,129,0.15);color:#10b981;font-size:8px;padding:2px 6px;border-radius:4px;margin-left:6px;letter-spacing:0.5px;vertical-align:middle;}
.akmez-product-search{width:100%;background:rgba(249,115,22,0.06);border:1px solid rgba(249,115,22,0.35);border-radius:10px;padding:11px 12px;color:white;font-size:13px;outline:none;margin-bottom:10px;transition:border-color 0.15s,box-shadow 0.15s,background 0.15s;}
.akmez-product-search:focus{border-color:#f97316;background:rgba(249,115,22,0.1);box-shadow:0 0 0 3px rgba(249,115,22,0.18);}
.akmez-product-search::placeholder{color:#8b93a7;}
.akmez-suggest-price{color:#10b981;font-weight:700;font-size:11px;margin-left:8px;white-space:nowrap;}
.akmez-suggest-item{display:flex;justify-content:space-between;align-items:center;gap:8px;}
.akmez-suggest-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px;}
.akmez-suggest-thumb,.akmez-cart-thumb{width:34px;height:34px;border-radius:6px;object-fit:cover;background:#1e293b;flex-shrink:0;cursor:zoom-in;border:1px solid rgba(255,255,255,0.12);}
.akmez-suggest-thumb.placeholder,.akmez-cart-thumb.placeholder{cursor:default;background:repeating-linear-gradient(45deg,#1e293b,#1e293b 4px,#243244 4px,#243244 8px);}
#akmez-hover-preview{position:fixed;z-index:2147483647;display:none;width:220px;height:220px;border-radius:12px;overflow:hidden;background:#0f172a;box-shadow:0 12px 40px rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.15);pointer-events:none;}
#akmez-hover-preview img{width:100%;height:100%;object-fit:contain;display:block;}
.akmez-offer-badge{display:inline-block;background:rgba(249,115,22,0.2);color:#fb923c;font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;white-space:nowrap;letter-spacing:0.3px;}
/* Product variety (colour/size) selection */
.akmez-var-badge{display:inline-block;background:rgba(56,189,248,0.18);color:#7dd3fc;font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;white-space:nowrap;}
.akmez-var-tag{display:inline-block;background:rgba(56,189,248,0.18);color:#7dd3fc;font-size:9px;font-weight:700;padding:1px 6px;border-radius:6px;margin-left:4px;vertical-align:middle;}
.akmez-var-head{padding:8px 10px;font-size:11px;font-weight:700;color:#e2e8f0;border-bottom:1px solid rgba(255,255,255,0.08);}
.akmez-var-group{padding:8px 10px;}
.akmez-var-attr{font-size:9px;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;margin-bottom:6px;}
.akmez-var-opts{display:flex;flex-wrap:wrap;gap:6px;}
.akmez-var-chip{background:rgba(249,115,22,0.12);border:1px solid rgba(249,115,22,0.4);color:#fb923c;font-size:11px;font-weight:600;padding:6px 10px;border-radius:8px;cursor:pointer;}
.akmez-var-chip:hover{background:rgba(249,115,22,0.28);}
.akmez-var-chip.sold{opacity:0.45;cursor:not-allowed;background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.12);color:#94a3b8;}
.akmez-var-cancel{width:calc(100% - 20px);margin:4px 10px 10px;padding:7px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#e2e8f0;font-size:11px;font-weight:600;cursor:pointer;}
.akmez-cart-item-price s{color:#64748b;font-weight:400;margin-left:4px;}
#akmez-img-overlay{position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.82);display:none;align-items:center;justify-content:center;padding:24px;}
.akmez-img-box{position:relative;max-width:90vw;max-height:88vh;display:flex;flex-direction:column;align-items:center;gap:10px;}
.akmez-img-box img{max-width:90vw;max-height:80vh;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,0.6);object-fit:contain;background:#0f172a;}
.akmez-img-cap{color:#fff;font-size:13px;font-weight:600;text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
.akmez-img-close{position:absolute;top:-14px;right:-14px;width:34px;height:34px;border-radius:50%;border:none;background:#f97316;color:#fff;font-size:20px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 4px 12px rgba(0,0,0,0.4);}
.akmez-cart-list{display:flex;flex-direction:column;gap:7px;margin-top:4px;}
.akmez-cart-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.09);border-radius:10px;transition:background 0.15s,border-color 0.15s;}
.akmez-cart-item:hover{background:rgba(255,255,255,0.07);border-color:rgba(249,115,22,0.3);}
.akmez-cart-item-info{flex:1;min-width:0;}
.akmez-cart-item-name{font-size:12px;font-weight:600;color:#fff;line-height:1.25;}
.akmez-cart-item-price{font-size:10px;color:#9aa1b5;margin-top:2px;}
.akmez-qty{display:flex;align-items:center;gap:4px;flex-shrink:0;}
.akmez-qty-btn{width:26px;height:26px;border:1px solid rgba(249,115,22,0.4);background:rgba(249,115,22,0.12);color:#fb923c;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding:0;transition:background 0.15s;}
.akmez-qty-btn:hover{background:rgba(249,115,22,0.32);}
.akmez-qty-val{min-width:22px;text-align:center;font-size:13px;font-weight:700;color:#fff;}
.akmez-qty-del{border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#f87171;margin-left:2px;}
.akmez-qty-del:hover{background:rgba(239,68,68,0.32);}
    /* Sticky summary + CTA so both stay reachable with a long product list */
    .akmez-cart{position:sticky;bottom:64px;z-index:5;background:linear-gradient(135deg,rgba(6,46,36,0.97),rgba(9,60,45,0.97));backdrop-filter:blur(6px);border:1px solid rgba(16,185,129,0.35);border-radius:12px;padding:11px 14px;margin-top:10px;display:flex;justify-content:space-between;align-items:center;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.35);}
.akmez-cart .items{color:#6ee7b7;}
.akmez-cart .total{color:#34d399;font-weight:800;font-size:15px;}
    .akmez-submit{position:sticky;bottom:0;z-index:6;width:100%;display:block;padding:14px;margin:12px 0 0;background:linear-gradient(135deg,#34d399,#10b981 55%,#059669);border:none;border-radius:12px;color:#04110b;font-size:14px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:1.2px;transition:filter 0.15s,box-shadow 0.15s,transform 0.15s;box-shadow:0 6px 20px rgba(16,185,129,0.35),0 -10px 18px -8px rgba(0,0,0,0.7);}
.akmez-submit:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 8px 26px rgba(16,185,129,0.5);}
.akmez-submit:active{transform:translateY(0);}
.akmez-submit:disabled{opacity:0.5;cursor:not-allowed;transform:none;filter:none;}
.akmez-success{text-align:center;padding:20px;}
.akmez-success .check{font-size:48px;color:#10b981;}
.akmez-success h3{color:#10b981;margin:10px 0 6px;font-size:16px;}
.akmez-success p{color:#6ee7b7;font-size:12px;margin-bottom:16px;}
.akmez-success button{background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#10b981;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:12px;}
/* Proforma invoice link shown after an order is created */
.akmez-proforma{text-align:left;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:10px;padding:12px;margin-bottom:16px;}
.akmez-proforma-title{font-size:12px;font-weight:700;color:#e2e8f0;margin-bottom:8px;}
.akmez-proforma-item{display:flex;flex-direction:column;gap:6px;padding:6px 0;border-top:1px solid rgba(255,255,255,0.06);}
.akmez-proforma-item:first-of-type{border-top:none;padding-top:0;}
.akmez-proforma-prod{font-size:11px;color:#cbd5e1;font-weight:600;}
.akmez-proforma-actions{display:flex;gap:8px;}
.akmez-pf-copy,.akmez-pf-open{flex:1;text-align:center;padding:8px 10px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;text-decoration:none;}
.akmez-pf-copy{background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.4);color:#7dd3fc;}
.akmez-pf-open{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);color:#e2e8f0;}
.akmez-proforma-hint{font-size:10px;color:#94a3b8;margin-top:8px;line-height:1.4;}
    .akmez-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-left:3px solid #ef4444;border-radius:10px;padding:10px 12px;color:#fca5a5;font-size:11px;line-height:1.5;margin-bottom:10px;}

/* Working Time Styles */
.wt-panel{text-align:center;}
.wt-status{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:16px;margin-bottom:16px;}
.wt-status.out{background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.3);}
.wt-status .dot{width:12px;height:12px;background:#10b981;border-radius:50%;display:inline-block;margin-right:8px;animation:pulse 2s infinite;}
.wt-status.out .dot{background:#ef4444;animation:none;}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.5;}}
.wt-status .text{font-size:14px;font-weight:600;color:#10b981;}
.wt-status.out .text{color:#ef4444;}
.wt-timer{font-size:42px;font-weight:700;font-family:'SF Mono',monospace;color:#fff;margin:20px 0;letter-spacing:2px;}
.wt-info{font-size:11px;color:#888;margin-bottom:20px;}
.wt-info span{color:#f97316;font-weight:600;}
.wt-btn{width:100%;padding:14px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:1px;transition:all 0.15s;}
.wt-btn.in{background:linear-gradient(135deg,#10b981,#059669);color:white;}
.wt-btn.out{background:linear-gradient(135deg,#ef4444,#dc2626);color:white;}
.wt-btn:hover{transform:scale(1.02);}
.wt-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}
.wt-history{margin-top:20px;text-align:left;}
.wt-history h4{font-size:11px;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;}
.wt-history-item{display:flex;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;font-size:11px;}
.wt-history-item .date{color:#888;}
.wt-history-item .hours{color:#10b981;font-weight:600;}

/* My Stats */
.stats-metrics{display:flex;gap:8px;margin-bottom:10px;}
.stats-card{flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px 8px;text-align:center;}
.stats-card-val{font-size:20px;font-weight:800;color:#fff;line-height:1.1;}
.stats-card-lbl{font-size:10px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.04em;}
.stats-window{font-size:11px;color:#94a3b8;text-align:center;margin-bottom:12px;line-height:1.4;}
.stats-search-wrap{margin-bottom:10px;}
.stats-search{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;outline:none;}
.stats-search:focus{border-color:#f97316;}
.stats-search::placeholder{color:#64748b;}
.stats-list{display:flex;flex-direction:column;gap:8px;}
.stats-client{background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 12px;}
.stats-client-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.stats-client-top-right{display:flex;align-items:center;gap:6px;flex-shrink:0;}
.stats-edit-btn{border:1px solid rgba(249,115,22,0.4);background:rgba(249,115,22,0.12);color:#fb923c;border-radius:7px;padding:3px 9px;font-size:10px;font-weight:700;cursor:pointer;transition:background 0.15s;white-space:nowrap;}
.stats-edit-btn:hover{background:rgba(249,115,22,0.3);color:#fff;}
.stats-edit-form{display:flex;flex-direction:column;gap:6px;}
.stats-edit-title{font-size:12px;font-weight:700;color:#fb923c;margin-bottom:2px;}
.stats-edit-row{display:flex;gap:8px;}
.stats-edit-err{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);border-left:3px solid #ef4444;border-radius:8px;padding:8px 10px;color:#fca5a5;font-size:11px;line-height:1.4;}
.stats-edit-actions{display:flex;gap:8px;margin-top:4px;}
.stats-edit-cancel{flex:1;padding:10px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.05);color:#cbd5e1;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;transition:background 0.15s;}
.stats-edit-cancel:hover{background:rgba(255,255,255,0.12);}
.stats-edit-save{flex:2;padding:10px;border:none;background:linear-gradient(135deg,#34d399,#10b981 55%,#059669);color:#04110b;border-radius:9px;font-size:12px;font-weight:800;cursor:pointer;text-transform:uppercase;letter-spacing:0.6px;transition:filter 0.15s;}
.stats-edit-save:hover{filter:brightness(1.08);}
.stats-edit-save:disabled{opacity:0.5;cursor:not-allowed;}
.stats-client-name{font-size:13px;font-weight:700;color:#fff;}
.stats-client-prod{font-size:12px;color:#cbd5e1;margin-top:2px;line-height:1.4;}
.stats-client-meta{font-size:11px;color:#94a3b8;margin-top:4px;display:flex;flex-wrap:wrap;gap:8px;}
.stats-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap;background:rgba(148,163,184,0.15);color:#cbd5e1;}
.stats-badge.pending{background:rgba(249,115,22,0.15);color:#fdba74;}
.stats-badge.delivered{background:rgba(16,185,129,0.15);color:#6ee7b7;}
.stats-badge.cancelled,.stats-badge.returned{background:rgba(239,68,68,0.15);color:#fca5a5;}
.stats-empty{text-align:center;color:#94a3b8;padding:30px 12px;font-size:12px;}
/* Proforma / invoice link on each client card */
.stats-doc{margin-top:8px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:8px 10px;}
.stats-doc-title{font-size:11px;font-weight:700;color:#e2e8f0;display:block;margin-bottom:6px;}
.stats-doc-actions{display:flex;gap:8px;}
.stats-doc-copy,.stats-doc-open{flex:1;text-align:center;padding:7px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;text-decoration:none;border:1px solid transparent;}
.stats-doc-copy{background:rgba(56,189,248,0.15);border-color:rgba(56,189,248,0.4);color:#7dd3fc;}
.stats-doc-open{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.15);color:#e2e8f0;}
/* Full customer detail grid */
.stats-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin-top:10px;}
.stats-cell{display:flex;flex-direction:column;gap:1px;min-width:0;}
.stats-cell-lbl{font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.04em;}
.stats-cell-val{font-size:12px;color:#e2e8f0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.stats-note{margin-top:8px;font-size:11px;color:#cbd5e1;line-height:1.4;background:rgba(255,255,255,0.03);border-radius:6px;padding:6px 8px;}
.stats-note strong{color:#94a3b8;}

#akmez-page-badge{margin-left:6px;background:#0ea5e9;color:#fff;font-size:10px;font-weight:700;padding:1px 7px;border-radius:9px;vertical-align:middle;letter-spacing:0.5px;align-items:center;gap:4px;}
.akmez-page-badge-logo{width:14px;height:14px;border-radius:50%;object-fit:cover;background:#fff;flex-shrink:0;}
.akmez-logo-img{width:100%;height:100%;border-radius:8px;object-fit:cover;display:block;}
.akmez-toggle-img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;}
.akmez-pagemap-thumb{width:22px;height:22px;border-radius:6px;object-fit:cover;background:#1e293b;flex-shrink:0;margin-right:6px;}
.akmez-pagemap-thumb.placeholder{display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#94a3b8;border:1px dashed #334155;}
 .akmez-sel-logo{background:none;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;}
.akmez-sel-link{background:none;border:none;color:#94a3b8;cursor:pointer;font-size:13px;padding:2px 4px;flex-shrink:0;}
.akmez-sel-link:hover{color:#0ea5e9;}
.akmez-sel-link.active{color:#10b981;}
.akmez-linked{font-size:9px;color:#10b981;background:rgba(16,185,129,0.12);padding:1px 5px;border-radius:6px;margin-left:4px;white-space:nowrap;}
.akmez-sel-logo:hover{color:#0ea5e9;}
.akmez-pagemap-logo-preview{display:flex;align-items:center;gap:6px;font-size:11px;color:#6ee7b7;margin:4px 0;}
.akmez-region-delivery{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:7px 10px;font-size:11px;color:#6ee7b7;margin:-4px 0 10px;line-height:1.4;}
.akmez-region-delivery b{color:#10b981;}
.akmez-region-delivery.warn{background:rgba(245,158,11,0.1);border-color:rgba(245,158,11,0.3);color:#fcd34d;}
.akmez-suggest-contractor{font-size:10px;color:#10b981;background:rgba(16,185,129,0.12);padding:1px 6px;border-radius:8px;margin-left:8px;white-space:nowrap;}
.akmez-pagemap-form{display:flex;gap:6px;margin:6px 0 2px;flex-wrap:wrap;}
.akmez-pagemap-input{flex:1;min-width:120px;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:6px 8px;font-size:12px;}
.akmez-pagemap-input.code{flex:0 0 90px;min-width:70px;text-transform:uppercase;}
.akmez-ai-prompt{width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:8px 10px;font-size:12px;line-height:1.4;resize:vertical;font-family:inherit;margin-bottom:6px;}
.akmez-ai-prompt:focus{outline:none;border-color:#f97316;}
/* AI reply draft panel on the Orders tab */
.akmez-ai-draft{margin-top:10px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:8px;padding:10px;}
.akmez-ai-draft-title{font-size:11px;font-weight:700;color:#7dd3fc;margin-bottom:6px;display:flex;align-items:center;gap:6px;}
.akmez-ai-draft-text{width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;color:#e2e8f0;border-radius:6px;padding:8px;font-size:12px;line-height:1.45;resize:vertical;font-family:inherit;min-height:70px;}
.akmez-ai-draft-actions{display:flex;gap:8px;margin-top:8px;}
.akmez-ai-draft-actions button{flex:1;padding:7px 8px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;border:1px solid transparent;}
.akmez-ai-insert{background:#f97316;color:#fff;}
.akmez-ai-regen{background:rgba(255,255,255,0.06);border-color:rgba(255,255,255,0.15);color:#e2e8f0;}
.akmez-pagemap-form .akmez-set-btn{flex:0 0 auto;width:auto;margin:0;padding:6px 10px;}
/* Settings Styles */
.akmez-settings-panel{padding:4px 2px;}
.akmez-set-row{display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;font-size:12px;}
.akmez-set-label{color:#888;}
.akmez-set-value{color:#fff;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.akmez-set-btn{width:100%;padding:12px;margin-bottom:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;text-align:left;transition:all 0.15s;}
.akmez-set-btn:hover{background:rgba(249,115,22,0.15);border-color:#f97316;}
.akmez-set-btn.danger{color:#fca5a5;border-color:rgba(239,68,68,0.3);}
.akmez-set-btn.danger:hover{background:rgba(239,68,68,0.15);border-color:#ef4444;}
.akmez-set-btn.back{text-align:center;margin-top:10px;background:rgba(249,115,22,0.15);border-color:rgba(249,115,22,0.4);color:#f97316;}
.akmez-set-btn:disabled{opacity:0.5;cursor:not-allowed;}

/* Login Styles */
.akmez-login{text-align:center;padding:20px;}
.akmez-login p{color:#fca5a5;margin-bottom:12px;font-size:12px;}
.akmez-login button{background:#f97316;border:none;color:white;padding:12px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:12px;}
.akmez-login-form{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:20px;}
.akmez-login-form .title{color:#fff;font-size:14px;font-weight:600;margin-bottom:14px;text-align:center;}
.akmez-login-form .form-group{margin-bottom:12px;}
.akmez-login-form input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:12px 14px;color:#fff;font-size:13px;outline:none;}
.akmez-login-form input:focus{border-color:#f97316;background:rgba(249,115,22,0.05);}
.akmez-login-form input::placeholder{color:#666;}
.akmez-login-btn{width:100%;background:linear-gradient(135deg,#f97316,#ea580c);color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;margin-top:4px;}
.akmez-login-btn:hover{opacity:0.9;}
.akmez-login-btn:disabled{opacity:0.5;cursor:not-allowed;}
.akmez-login-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px 10px;color:#fca5a5;font-size:11px;margin-bottom:12px;display:none;}

/* Toast & Selection */
#akmez-sel{display:none;position:fixed;z-index:2147483647;background:#1a1a2e;padding:4px;border-radius:8px;border:2px solid #f97316;gap:3px;font-family:sans-serif;}
#akmez-sel button{padding:6px 10px;border:none;border-radius:5px;background:#f97316;color:white;font-size:10px;font-weight:700;cursor:pointer;}
#akmez-sel button:hover{background:#ea580c;}
.akmez-toast{position:fixed;bottom:80px;right:20px;background:#10b981;color:white;padding:10px 16px;border-radius:8px;font-family:sans-serif;font-size:12px;font-weight:600;z-index:2147483647;animation:fadeIn .3s;}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
`;
document.head.appendChild(style);

// State
let products = [], regions = [], cart = {}, currentTab = 'orders';
// Map: region name -> { contractor, rider } (delivery assignment set by admin)
let regionDelivery = {};
// Admin-defined page mappings: [{ match: 'Made By Moris', code: 'MBM' }]
let pageMappings = [];
// Admin-managed non-delivery days: [{ id, start, end, label, type }]
// type: 'fixed' | 'variable' (moon-based) | 'adhoc' (cyclone/rain closure)
let muHolidays = [];
// Mauritius daily weather forecast keyed by date: { 'YYYY-MM-DD': { code, tMax, tMin, rain } }
let weatherByDate = {};
chrome.storage.local.get(['pageMappings', 'holidays'], s => {
  if (Array.isArray(s.pageMappings)) pageMappings = s.pageMappings;
  if (Array.isArray(s.holidays)) muHolidays = s.holidays;
});

// Detect which Facebook page the current conversation belongs to by matching
// admin-defined text against the tab title, URL, headings, nav and aria labels.
let __akmezLastPageKey = null;
// The page mapping detected for the current conversation (used by order create)
window.__akmezDetectedPage = null;

// Read the Facebook Page ID from the current URL. In Business Suite / Meta
// inboxes this is the asset_id (falls back to page_id / business_id). This is
// the ONE signal that is always present, regardless of conversation content.
function getCurrentPageId() {
  try {
    const u = new URL(location.href);
    return u.searchParams.get('asset_id')
      || u.searchParams.get('page_id')
      || u.searchParams.get('mailbox_id')
      || null;
  } catch (e) { return null; }
}

// Persist a learned Page ID onto a mapping so future detection is instant.
// Only admins can push shared settings; for everyone else we still cache it
// locally so it works for the rest of the session.
function learnPageId(code, pageId) {
  if (!code || !pageId) return;
  let changed = false;
  pageMappings = pageMappings.map(m => {
    if (m.code === code && !m.pageId) { changed = true; return { ...m, pageId: String(pageId) }; }
    return m;
  });
  if (!changed) return;
  chrome.storage.local.set({ pageMappings }, () => {
    // Push to the server only if this user is an admin (silent — no toast)
    chrome.storage.local.get(['userRole'], s => {
      if (s.userRole === 'admin' || s.userRole === 'manager') {
        chrome.runtime.sendMessage({
          action: 'saveSettings',
          data: { pageMappings },
        }, () => {});
      }
    });
  });
}

function detectSourcePage() {
  let found = null;
  const pageId = getCurrentPageId();
  if (pageMappings.length) {
    // 1) Match by Page ID (asset_id) — bulletproof, works on every conversation
    if (pageId) {
      found = pageMappings.find(m => m.pageId && String(m.pageId) === String(pageId)) || null;
    }
    // 2) Fall back to matching the page NAME against everything visible
    if (!found) {
      const haystacks = [document.title || '', decodeURIComponent(location.href)];
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) haystacks.push(og.content);
      document.querySelectorAll('h1, h2, [role="banner"] span, [role="navigation"] span, a[aria-label], div[aria-label], span[aria-label]').forEach(el => {
        const t = (el.textContent || '').trim();
        if (t && t.length < 120) haystacks.push(t);
        const al = el.getAttribute && el.getAttribute('aria-label');
        if (al && al.length < 120) haystacks.push(al);
      });
      // Full visible page text catches inline mentions in plain divs, e.g. the
      // Business Suite banner "This chat contains a reply to <Page>".
      try {
        const bodyText = (document.body && document.body.innerText) || '';
        if (bodyText) haystacks.push(bodyText.slice(0, 50000));
      } catch (e) { /* ignore */ }
      const joined = haystacks.join(' | ').toLowerCase();
      for (const m of pageMappings) {
        const needle = (m.match || '').toLowerCase().trim();
        if (needle && joined.includes(needle)) { found = m; break; }
      }
      // Self-heal: once matched by name while a Page ID is in the URL, bind them
      // so it detects instantly (by ID) on every future conversation.
      if (found && pageId && !found.pageId) learnPageId(found.code, pageId);
    }
  }
  window.__akmezDetectedPage = found;
  // Skip DOM updates when nothing changed (runs every 1.2s) — but re-apply
  // if the widget was re-created and lost its state
  const key = found ? (found.code + '|' + (found.logo ? found.logo.length : 0)) : null;
  const badgeEl = document.getElementById('akmez-page-badge');
  const headerLogoEl = document.querySelector('#akmez-widget .akmez-logo');
  const stale = found && (
    (badgeEl && badgeEl.style.display === 'none') ||
    (headerLogoEl && headerLogoEl.textContent === 'A')
  );
  if (key === __akmezLastPageKey && !stale) return;
  __akmezLastPageKey = key;

  const hasLogo = !!(found && found.logo && found.logo.indexOf('data:image/') === 0);

  // 1. Header badge (code + small logo)
  const badge = document.getElementById('akmez-page-badge');
  if (badge) {
    if (found) {
      badge.textContent = '';
      if (hasLogo) {
        const img = document.createElement('img');
        img.src = found.logo;
        img.alt = '';
        img.className = 'akmez-page-badge-logo';
        badge.appendChild(img);
      }
      badge.appendChild(document.createTextNode(found.code));
      badge.title = 'Message from: ' + found.match;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // 2. Header "A" square: show the page logo instead when detected
  const headerLogo = document.querySelector('#akmez-widget .akmez-logo');
  if (headerLogo) {
    if (hasLogo) {
      headerLogo.innerHTML = '<img src="' + found.logo + '" alt="" class="akmez-logo-img">';
      headerLogo.title = found.match;
    } else if (found) {
      headerLogo.textContent = found.code.slice(0, 3);
      headerLogo.title = found.match;
    } else {
      headerLogo.textContent = 'A';
      headerLogo.title = '';
    }
  }

  // 3. Floating toggle button: swap the "A" for the page logo too
  if (toggleBtn) {
    if (hasLogo) {
      toggleBtn.innerHTML = '<img src="' + found.logo + '" alt="" class="akmez-toggle-img">';
      toggleBtn.title = 'Akmez Quick Order — ' + found.match;
    } else {
      toggleBtn.innerHTML = '<span>A</span>';
      toggleBtn.title = 'Open Akmez Quick Order';
    }
  }
}
let isDragging = false, dragOffset = {x:0,y:0};
  let worktimeData = { isClockedIn: false, clockInTime: null, todayHours: 0, history: [] };
  let timerInterval = null;
  let statsSearchTimer = null;
  let statsSearchTerm = '';

// Drag functionality. Clamp with the widget's REAL rendered size (it varies
// with screen width/zoom) so it can never be dragged past the viewport edge,
// and shrink its height when dragged down so the footer always stays visible.
function clampWidget() {
  const r = widget.getBoundingClientRect();
  const maxLeft = Math.max(0, window.innerWidth - r.width);
  const left = Math.max(0, Math.min(maxLeft, r.left));
  const maxTop = Math.max(0, window.innerHeight - Math.min(r.height, 300));
  const top = Math.max(0, Math.min(maxTop, r.top));
  widget.style.left = left + 'px';
  widget.style.top = top + 'px';
  widget.style.right = 'auto';
  // Same fonts, adjusted frame: the widget height always fits between its
  // current top and the bottom of the screen; the body scrolls inside it
  widget.style.height = Math.max(300, window.innerHeight - top - 20) + 'px';
}
document.getElementById('akmez-drag').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  isDragging = true;
  const r = widget.getBoundingClientRect();
  dragOffset = {x: e.clientX - r.left, y: e.clientY - r.top};
});
document.addEventListener('mousemove', e => {
  if (!isDragging) return;
  widget.style.left = (e.clientX - dragOffset.x) + 'px';
  widget.style.top = (e.clientY - dragOffset.y) + 'px';
  widget.style.right = 'auto';
  clampWidget();
});
document.addEventListener('mouseup', () => isDragging = false);
// Keep the widget on-screen when the window is resized or the page is zoomed
window.addEventListener('resize', () => {
  if (widget.style.display !== 'none') clampWidget();
});

// Toggle widget. 'flex' (not 'block') keeps the column layout so the body
// area gets flex:1 + overflow-y:auto and scrolls instead of overflowing
toggleBtn.addEventListener('click', () => {
  if (akmezDragMoved) { akmezDragMoved = false; return; } // was a drag, not a click
  widget.style.display = widget.style.display === 'none' ? 'flex' : 'none';
  if (widget.style.display === 'flex') { clampWidget(); loadData(); }
});
document.getElementById('akmez-close').addEventListener('click', () => widget.style.display = 'none');

// Keyboard shortcut (default Alt+A, rebindable at chrome://extensions/shortcuts):
// the background script relays the command here - same behavior as clicking "A"
chrome.runtime.onMessage.addListener((request) => {
  if (request && request.action === 'toggleWidget') toggleBtn.click();
});

// Settings panel
document.getElementById('akmez-settings').addEventListener('click', () => renderSettings());

// Delivery cut-off countdown: starts 15 minutes before the cut-off time and
// recolors the whole interface to a red alert theme so the agent can't miss it.
const CUTOFF_WARN_SECONDS = 15 * 60;
function tickCutoffCountdown() {
  chrome.storage.local.get(['cutoffTime'], s => {
    const cutoff = s.cutoffTime || '20:00';
    const [ch, cm] = cutoff.split(':').map(Number);
    if (isNaN(ch) || isNaN(cm)) return;
    const now = new Date();
    const target = new Date();
    target.setHours(ch, cm, 0, 0);
    const remaining = Math.floor((target.getTime() - now.getTime()) / 1000);

    const banner = document.getElementById('akmez-cutoff-banner');
    const active = remaining > 0 && remaining <= CUTOFF_WARN_SECONDS;

    if (active) {
      const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
      const ss = String(remaining % 60).padStart(2, '0');
      const countEl = document.getElementById('akmez-cutoff-count');
      if (countEl) countEl.textContent = mm + ':' + ss;
      if (banner) banner.style.display = 'flex';
      widget.classList.add('cutoff-alert');
      toggleBtn.classList.add('cutoff-alert');
    } else {
      if (banner) banner.style.display = 'none';
      widget.classList.remove('cutoff-alert');
      toggleBtn.classList.remove('cutoff-alert');
    }
  });
}
tickCutoffCountdown();
setInterval(tickCutoffCountdown, 1000);

function renderSettings() {
  const body = document.getElementById('akmez-body');
  const version = EXT_VERSION || (chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '');
  
  chrome.storage.local.get(['authToken', 'userName', 'userEmail', 'nameSelectors', 'phoneSelectors', 'adidSelectors', 'cutoffTime', 'userRole', 'pageMappings', 'deliveryDayScheme', 'holidays', 'messageSelectors', 'sendboxSelectors', 'aiReplyPrompt'], stored => {
    const signedIn = !!stored.authToken;
    const isAdmin = stored.userRole === 'admin';
    const cutoff = stored.cutoffTime || '20:00';
    const scheme = (stored.deliveryDayScheme && typeof stored.deliveryDayScheme === 'object') ? stored.deliveryDayScheme : {};
    // Non-delivery days list, sorted, upcoming/current first (past hidden)
    const todayStr = ymd(new Date());
    const holidayTypeLabels = { fixed: 'Public holiday', variable: 'Moon-based', adhoc: 'Cyclone / closure' };
    const allHolidays = Array.isArray(stored.holidays) ? stored.holidays.slice() : [];
    const upcomingHolidays = allHolidays
      .filter(h => h && h.start && (h.end || h.start) >= todayStr)
      .sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
    const fmtRange = (h) => {
      const opts = { month: 'short', day: 'numeric' };
      const s = new Date(h.start + 'T00:00:00').toLocaleDateString('en-GB', opts);
      if (!h.end || h.end === h.start) return s;
      const e = new Date(h.end + 'T00:00:00').toLocaleDateString('en-GB', opts);
      return s + ' - ' + e;
    };
    const holidayRowsHtml = upcomingHolidays.length
      ? upcomingHolidays.map(h => `
        <div class="akmez-hol-row">
          <span class="akmez-hol-type ${statsEsc(h.type || 'fixed')}"></span>
          <span class="akmez-hol-main">
            <span class="akmez-hol-date">${statsEsc(fmtRange(h))}</span>
            <span class="akmez-hol-label">${statsEsc(h.label || holidayTypeLabels[h.type] || 'Closed')}</span>
          </span>
          <span class="akmez-hol-tag">${statsEsc(holidayTypeLabels[h.type] || 'Holiday')}</span>
          ${isAdmin ? `<button class="akmez-hol-del" data-id="${statsEsc(h.id)}" title="Remove">&times;</button>` : ''}
        </div>`).join('')
      : `<div class="akmez-sel-empty">No upcoming non-delivery days.</div>`;
    // Mon-first ordering for display; value is the JS getDay() index (0=Sun..6=Sat)
    const WEEKDAYS = [['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday'],['0','Sunday']];
    const schemeRowsHtml = WEEKDAYS.map(([dow, label]) => {
      const sel = scheme[dow];
      const opts = ['<option value="">Next working day (default)</option>']
        .concat(WEEKDAYS.map(([v, l]) => `<option value="${v}"${String(sel) === v ? ' selected' : ''}>${l}</option>`))
        .join('');
      return `<div class="akmez-scheme-row">
          <span class="akmez-scheme-label">Order on ${label}</span>
          <select class="akmez-scheme-select" data-dow="${dow}"${isAdmin ? '' : ' disabled'}>${opts}</select>
        </div>`;
    }).join('');
    const currentPageId = getCurrentPageId();
    const renderSelList = (arr, kind, emptyMsg) => (arr.length
      ? arr.map((s, i) => `
        <div class="akmez-sel-row">
          <span class="akmez-sel-text" title="${s.replace(/"/g, '&quot;')}">${s.replace(/</g, '&lt;')}</span>
          ${isAdmin ? `<button class="akmez-sel-del" data-kind="${kind}" data-i="${i}" title="Remove">&times;</button>` : ''}
        </div>`).join('')
      : `<div class="akmez-sel-empty">${isAdmin ? emptyMsg : 'Not configured by your admin yet.'}</div>`);
    const nameSel = Array.isArray(stored.nameSelectors) ? stored.nameSelectors : [];
    const phoneSel = Array.isArray(stored.phoneSelectors) ? stored.phoneSelectors : [];
    const adidSel = Array.isArray(stored.adidSelectors) ? stored.adidSelectors : [];
    const messageSel = Array.isArray(stored.messageSelectors) ? stored.messageSelectors : [];
    const sendboxSel = Array.isArray(stored.sendboxSelectors) ? stored.sendboxSelectors : [];
    const aiPrompt = typeof stored.aiReplyPrompt === 'string' ? stored.aiReplyPrompt : '';
    const nameHtml = renderSelList(nameSel, 'name', 'No selectors yet. Click "Pick name from page" then click the customer name in the conversation.');
    const phoneHtml = renderSelList(phoneSel, 'phone', 'No selectors yet. Click "Pick phone from page" then click the phone number (e.g. in the contact panel).');
    const adidHtml = renderSelList(adidSel, 'adid', 'No selectors yet. Click "Pick ad id from page" then click the ad_id label in the contact panel.');
    const messageHtml = renderSelList(messageSel, 'message', 'No selectors yet. Click "Pick message from page" then click a customer message bubble in the conversation.');
    const sendboxHtml = renderSelList(sendboxSel, 'sendbox', 'No selectors yet. Click "Pick send box from page" then click the reply text box you type in.');
    body.innerHTML = `
      <div class="akmez-settings-panel">
        <div class="akmez-section">Account</div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Status</span>
          <span class="akmez-set-value" style="color:${signedIn ? '#10b981' : '#ef4444'}">${signedIn ? 'Signed in' : 'Not signed in'}</span>
        </div>
        ${signedIn ? `
        <div class="akmez-set-row">
          <span class="akmez-set-label">Name</span>
          <span class="akmez-set-value">${(stored.userName || 'User').replace(/</g, '&lt;')}</span>
        </div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Email</span>
          <span class="akmez-set-value">${(stored.userEmail || '-').replace(/</g, '&lt;')}</span>
        </div>` : ''}
        
        <div class="akmez-section">Actions</div>
        <button class="akmez-set-btn" id="set-refresh">&#8635; Refresh Data</button>
        <button class="akmez-set-btn" id="set-reset-pos">&#8982; Reset Widget Position</button>
        ${signedIn ? '<button class="akmez-set-btn danger" id="set-logout">&#10162; Sign Out (clocks you out)</button>' : ''}
        
        <div class="akmez-section">Auto-Fill &amp; Delivery ${isAdmin ? '' : '<span class="akmez-managed-tag">Managed by admin</span>'}</div>
        ${isAdmin ? '' : '<div class="akmez-hint-text">These settings are configured by your administrator and apply to everyone. They cannot be changed here.</div>'}
        
        <div class="akmez-subsection">Customer Name Auto-Fill</div>
        <div class="akmez-sel-list">${nameHtml}</div>
        ${isAdmin ? '<button class="akmez-set-btn" id="set-pick-name">&#9678; Pick name from page</button><div class="akmez-hint-text">Add one selector per platform (Facebook, WhatsApp, etc.). The first matching selector auto-fills the Name box.</div>' : ''}
        
        <div class="akmez-subsection">Phone Number Auto-Fill</div>
        <div class="akmez-sel-list">${phoneHtml}</div>
        ${isAdmin ? '<button class="akmez-set-btn" id="set-pick-phone">&#9678; Pick phone from page</button><div class="akmez-hint-text">On WhatsApp the number shows in the right contact panel. Pick it once and Contact 1 auto-fills. The +230 code is removed automatically.</div>' : ''}
        
        <div class="akmez-subsection">Ad ID Auto-Fill</div>
        <div class="akmez-sel-list">${adidHtml}</div>
        ${isAdmin ? '<button class="akmez-set-btn" id="set-pick-adid">&#9678; Pick ad id from page</button><div class="akmez-hint-text">Pick the ad_id label (e.g. ad_id.120248...) in the contact panel. The numeric id is extracted automatically.</div>' : ''}

        <div class="akmez-section">AI Reply ${isAdmin ? '' : '<span class="akmez-managed-tag">Managed by admin</span>'}</div>
        ${isAdmin ? '<div class="akmez-hint-text">Let agents draft a reply with ChatGPT from the customer\'s messages and drop it straight into the send box. Pick the message bubble and the reply box once per platform (Facebook Business Suite, WhatsApp, etc.).</div>' : '<div class="akmez-hint-text">Use the &#9728; Reply with AI button on the Orders tab to draft a response in the send box.</div>'}

        <div class="akmez-subsection">Customer Messages</div>
        <div class="akmez-sel-list">${messageHtml}</div>
        ${isAdmin ? '<button class="akmez-set-btn" id="set-pick-message">&#9678; Pick message from page</button><div class="akmez-hint-text">Click one customer message bubble. The plugin reads all messages that match to understand the conversation.</div>' : ''}

        <div class="akmez-subsection">Reply / Send Box</div>
        <div class="akmez-sel-list">${sendboxHtml}</div>
        ${isAdmin ? '<button class="akmez-set-btn" id="set-pick-sendbox">&#9678; Pick send box from page</button><div class="akmez-hint-text">Click the text box you type replies into. The AI draft is inserted there for you to review and send.</div>' : ''}

        <div class="akmez-subsection">Business Context &amp; Tone</div>
        ${isAdmin
          ? `<textarea id="set-ai-prompt" class="akmez-ai-prompt" rows="5" placeholder="Describe your business, tone, delivery info, and how replies should sound. E.g. 'We are Made By Moris, a Mauritian online shop. Be warm and helpful, reply in the customer's language, mention free delivery over Rs 1000, ask for the delivery address if not given.'">${aiPrompt.replace(/</g, '&lt;')}</textarea>
          <button class="akmez-set-btn" id="set-save-ai-prompt">Save AI Instructions</button>
          <div class="akmez-hint-text">This steers every AI reply. Keep it short and specific. Do not put prices you don&apos;t want the AI to quote.</div>`
          : `<div class="akmez-sel-empty">${aiPrompt ? 'Configured by your admin.' : 'Not configured by your admin yet.'}</div>`}
        
        <div class="akmez-subsection">Page Identification</div>
        ${isAdmin && currentPageId ? `<div class="akmez-hint-text">You are currently viewing page ID <b>${currentPageId}</b>. Use the &#128279; button on a page below to link it to this ID for instant, reliable detection.</div>` : ''}
        <div class="akmez-sel-list">${(Array.isArray(stored.pageMappings) && stored.pageMappings.length
          ? stored.pageMappings.map((m, i) => `
            <div class="akmez-sel-row">
              ${m.logo && m.logo.indexOf('data:image/') === 0
                ? `<img src="${m.logo}" alt="" class="akmez-pagemap-thumb">`
                : `<span class="akmez-pagemap-thumb placeholder">${(m.code || '?').slice(0, 2).replace(/</g, '&lt;')}</span>`}
              <span class="akmez-sel-text" title="${(m.match || '').replace(/"/g, '&quot;')}">${(m.match || '').replace(/</g, '&lt;')} &rarr; <b>${(m.code || '').replace(/</g, '&lt;')}</b>${m.pageId ? ` <span class="akmez-linked" title="Linked to page ID ${m.pageId}">&#128279; ${m.pageId}</span>` : ''}</span>
              ${isAdmin ? `${currentPageId ? `<button class="akmez-sel-link ${m.pageId === currentPageId ? 'active' : ''}" data-i="${i}" title="${m.pageId === currentPageId ? 'Linked to the current page' : 'Link to current page (' + currentPageId + ')'}">&#128279;</button>` : ''}<button class="akmez-sel-logo" data-i="${i}" title="${m.logo ? 'Change logo' : 'Add logo'}">&#128247;</button><button class="akmez-sel-del" data-kind="pagemap" data-i="${i}" title="Remove">&times;</button>` : ''}
            </div>`).join('')
          : `<div class="akmez-sel-empty">${isAdmin ? 'No pages defined yet. Add a page name and its short code below (e.g. Made By Moris → MBM).' : 'Not configured by your admin yet.'}</div>`)}</div>
        ${isAdmin ? `
        <div class="akmez-pagemap-form">
          <input type="text" id="pagemap-match" class="akmez-pagemap-input" placeholder="Page name (e.g. Made By Moris)" maxlength="120">
          <input type="text" id="pagemap-code" class="akmez-pagemap-input code" placeholder="Code (e.g. MBM)" maxlength="20">
          <button class="akmez-set-btn" id="pagemap-logo-btn" title="Attach a logo (optional)">&#128247; Logo</button>
          <button class="akmez-set-btn" id="pagemap-add">+ Add Page</button>
          <input type="file" id="pagemap-logo-file" accept="image/*" style="display:none">
        </div>
        <div class="akmez-pagemap-logo-preview" id="pagemap-logo-preview" style="display:none"></div>
        <div class="akmez-hint-text">Detection matches by the page&apos;s Facebook ID (most reliable) or by finding the page name in the conversation. Open a page&apos;s inbox, then press &#128279; here to bind it &mdash; after that the code and logo show instantly on every conversation for that page. Use &#128247; to add a logo.</div>` : ''}
        
        <div class="akmez-subsection">Delivery Cut-off</div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Cut-off time</span>
          <input type="time" id="set-cutoff" class="akmez-cutoff-input" value="${cutoff}"${isAdmin ? '' : ' disabled'}>
        </div>
        ${isAdmin ? '<div class="akmez-hint-text">Orders before cut-off deliver the next working day. After cut-off the picking list is closed, so delivery skips to the working day after. Sundays and Mauritius public holidays are never selectable.</div>' : ''}

        <div class="akmez-subsection">Default Delivery Day</div>
        <div class="akmez-scheme-list">${schemeRowsHtml}</div>
        ${isAdmin
          ? '<div class="akmez-hint-text">Choose which day an order delivers based on the day it&apos;s taken. E.g. orders taken on Saturday &amp; Sunday deliver on Monday. Days left on &ldquo;Next working day&rdquo; use the cut-off rule above. Holidays are always skipped forward.</div>'
          : '<div class="akmez-hint-text">These delivery days are configured by your administrator.</div>'}

        <div class="akmez-subsection">Non-Delivery Days ${isAdmin ? '' : '<span class="akmez-managed-tag">Managed by admin</span>'}</div>
        <div class="akmez-hol-list">${holidayRowsHtml}</div>
        ${isAdmin ? `
        <div class="akmez-hol-quick">
          <button class="akmez-set-btn danger" id="hol-close-today">&#9888; Close today</button>
          <button class="akmez-set-btn danger" id="hol-close-tomorrow">&#9888; Close tomorrow</button>
        </div>
        <div class="akmez-hol-form">
          <div class="akmez-hol-form-row">
            <label class="akmez-hol-flabel">From<input type="date" id="hol-start" class="akmez-cutoff-input"></label>
            <label class="akmez-hol-flabel">To<input type="date" id="hol-end" class="akmez-cutoff-input"></label>
          </div>
          <input type="text" id="hol-label" class="akmez-pagemap-input" placeholder="Reason (e.g. Eid, Cyclone warning)" maxlength="80">
          <div class="akmez-hol-form-row">
            <select id="hol-type" class="akmez-scheme-select">
              <option value="fixed">Public holiday</option>
              <option value="variable">Moon-based (Eid / Divali)</option>
              <option value="adhoc">Cyclone / rain closure</option>
            </select>
            <button class="akmez-set-btn" id="hol-add">+ Add</button>
          </div>
        </div>
        <div class="akmez-hint-text">Add public holidays, moon-based holidays (enter a 2-day range so a shifted Eid/Divali is covered), or instant cyclone/rain closures. Deliveries never fall on these days &mdash; orders skip forward to the next working day for everyone. Cyclone season (Nov&ndash;Apr) is flagged automatically on the order form.</div>`
          : '<div class="akmez-hint-text">These are the days deliveries are closed. Your administrator manages this list; orders automatically skip forward to the next working day.</div>'}

        <div class="akmez-section">About</div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Version</span>
          <span class="akmez-set-value">v${version}</span>
        </div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Auto clock-in</span>
          <span class="akmez-set-value">On login</span>
        </div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Auto clock-out</span>
          <span class="akmez-set-value">After 5 min idle</span>
        </div>
        
        <button class="akmez-set-btn back" id="set-back">&#8592; Back</button>
      </div>
    `;
    
    document.getElementById('set-back').onclick = () => renderCurrentTab();
    document.getElementById('set-refresh').onclick = () => { toast('Refreshing...'); loadData(); };
    if (isAdmin) {
      document.getElementById('set-pick-name').onclick = () => startPicker('name');
      document.getElementById('set-pick-phone').onclick = () => startPicker('phone');
      document.getElementById('set-pick-adid').onclick = () => startPicker('adid');
      const pickMsg = document.getElementById('set-pick-message');
      if (pickMsg) pickMsg.onclick = () => startPicker('message');
      const pickSend = document.getElementById('set-pick-sendbox');
      if (pickSend) pickSend.onclick = () => startPicker('sendbox');
      const saveAiPrompt = document.getElementById('set-save-ai-prompt');
      if (saveAiPrompt) saveAiPrompt.onclick = () => {
        const val = (document.getElementById('set-ai-prompt').value || '').slice(0, 2000);
        chrome.storage.local.set({ aiReplyPrompt: val }, () => pushSharedSettings('AI instructions saved for all users'));
      };
      document.getElementById('set-cutoff').onchange = e => {
        const v = e.target.value || '20:00';
        chrome.storage.local.set({ cutoffTime: v }, () => pushSharedSettings('Cut-off saved for all users'));
      };
      body.querySelectorAll('.akmez-scheme-select').forEach(sel => {
        sel.onchange = () => {
          chrome.storage.local.get(['deliveryDayScheme'], s => {
            const next = (s.deliveryDayScheme && typeof s.deliveryDayScheme === 'object') ? { ...s.deliveryDayScheme } : {};
            const dow = sel.dataset.dow;
            const val = sel.value;
            if (val === '') delete next[dow];
            else next[dow] = parseInt(val, 10);
            chrome.storage.local.set({ deliveryDayScheme: next }, () => pushSharedSettings('Delivery day saved for all users'));
          });
        };
      });

      // ----- Non-delivery days (holidays / cyclone closures) -----
      const saveHolidays = (list, msg) => {
        muHolidays = list;
        chrome.storage.local.set({ holidays: list }, () => { pushSharedSettings(msg); renderSettings(); });
      };
      const addHolidayRange = (start, end, label, type, msg) => {
        chrome.storage.local.get(['holidays'], s => {
          const list = Array.isArray(s.holidays) ? s.holidays.slice() : [];
          const id = 'h-' + start + '-' + Math.random().toString(36).slice(2, 7);
          list.push({ id, start, end: end || start, label: (label || '').trim(), type: type || 'fixed' });
          saveHolidays(list, msg);
        });
      };
      const addBtn = document.getElementById('hol-add');
      if (addBtn) addBtn.onclick = () => {
        const start = document.getElementById('hol-start').value;
        let end = document.getElementById('hol-end').value;
        const label = document.getElementById('hol-label').value;
        const type = document.getElementById('hol-type').value;
        if (!start) { toast('Pick a start date'); return; }
        if (end && end < start) end = start;
        addHolidayRange(start, end, label, type, 'Non-delivery day saved for all users');
      };
      const closeToday = document.getElementById('hol-close-today');
      if (closeToday) closeToday.onclick = () => {
        const t = ymd(new Date());
        addHolidayRange(t, t, 'Emergency closure', 'adhoc', 'Deliveries closed today for all users');
      };
      const closeTomorrow = document.getElementById('hol-close-tomorrow');
      if (closeTomorrow) closeTomorrow.onclick = () => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        const t = ymd(d);
        addHolidayRange(t, t, 'Emergency closure', 'adhoc', 'Deliveries closed tomorrow for all users');
      };
      body.querySelectorAll('.akmez-hol-del').forEach(b => {
        b.onclick = () => {
          const id = b.dataset.id;
          chrome.storage.local.get(['holidays'], s => {
            const list = (Array.isArray(s.holidays) ? s.holidays : []).filter(h => h.id !== id);
            saveHolidays(list, 'Non-delivery day removed for all users');
          });
        };
      });

      body.querySelectorAll('.akmez-sel-del').forEach(b => {
        b.onclick = () => {
          const kind = b.dataset.kind;
          if (kind === 'pagemap') {
            chrome.storage.local.get(['pageMappings'], s => {
              const list = Array.isArray(s.pageMappings) ? s.pageMappings : [];
              list.splice(parseInt(b.dataset.i, 10), 1);
              chrome.storage.local.set({ pageMappings: list }, () => {
                pageMappings = list;
                pushSharedSettings('Page removed for all users');
                renderSettings();
              });
            });
            return;
          }
          getSelectors(kind, list => {
            list.splice(parseInt(b.dataset.i, 10), 1);
            saveSelectors(kind, list, () => { pushSharedSettings('Removed for all users'); renderSettings(); });
          });
        };
      });
      // --- Page logo upload (shrinks any image to a small 48px data URL) ---
      const logoFile = document.getElementById('pagemap-logo-file');
      let pendingLogo = null;      // logo staged for the "+ Add Page" form
      let logoTargetIndex = null;  // when set, the upload replaces an existing mapping's logo
      const resizePageLogo = (file, cb) => {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const size = 48;
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            const scale = Math.min(size / img.width, size / img.height);
            const w = img.width * scale, h = img.height * scale;
            ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
            cb(canvas.toDataURL('image/png'));
          };
          img.onerror = () => { toast('Could not read that image'); cb(null); };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      };
      if (logoFile) {
        logoFile.onchange = () => {
          const f = logoFile.files && logoFile.files[0];
          logoFile.value = '';
          if (!f) return;
          resizePageLogo(f, dataUrl => {
            if (!dataUrl) return;
            if (logoTargetIndex !== null) {
              const idx = logoTargetIndex;
              logoTargetIndex = null;
              chrome.storage.local.get(['pageMappings'], s => {
                const list = Array.isArray(s.pageMappings) ? s.pageMappings : [];
                if (!list[idx]) return;
                list[idx].logo = dataUrl;
                chrome.storage.local.set({ pageMappings: list }, () => {
                  pageMappings = list;
                  pushSharedSettings('Logo updated for all users');
                  renderSettings();
                });
              });
            } else {
              pendingLogo = dataUrl;
              const prev = document.getElementById('pagemap-logo-preview');
              if (prev) {
                prev.innerHTML = '<img src="' + dataUrl + '" alt="" class="akmez-pagemap-thumb"> Logo ready &mdash; it will be attached when you add the page';
                prev.style.display = 'flex';
              }
            }
          });
        };
      }
      const logoBtn = document.getElementById('pagemap-logo-btn');
      if (logoBtn) logoBtn.onclick = () => { logoTargetIndex = null; logoFile.click(); };
      body.querySelectorAll('.akmez-sel-logo').forEach(b => {
        b.onclick = () => { logoTargetIndex = parseInt(b.dataset.i, 10); logoFile.click(); };
      });
      // Link a mapping to the Facebook Page ID of the inbox currently open
      body.querySelectorAll('.akmez-sel-link').forEach(b => {
        b.onclick = () => {
          const idx = parseInt(b.dataset.i, 10);
          const pid = getCurrentPageId();
          if (!pid) { toast('No page ID found in the current tab. Open a page inbox first.'); return; }
          chrome.storage.local.get(['pageMappings'], s => {
            const list = Array.isArray(s.pageMappings) ? s.pageMappings : [];
            if (!list[idx]) return;
            // Clear this ID from any other mapping, then bind it here
            list.forEach(m => { if (m.pageId === pid) delete m.pageId; });
            list[idx].pageId = pid;
            chrome.storage.local.set({ pageMappings: list }, () => {
              pageMappings = list;
              __akmezLastPageKey = null; // force re-detect
              pushSharedSettings('Linked "' + list[idx].match + '" to page ID ' + pid);
              renderSettings();
            });
          });
        };
      });
      const pagemapAdd = document.getElementById('pagemap-add');
      if (pagemapAdd) {
        pagemapAdd.onclick = () => {
          const match = (document.getElementById('pagemap-match').value || '').trim();
          const code = (document.getElementById('pagemap-code').value || '').trim().toUpperCase();
          if (!match || !code) { toast('Enter both the page name and its code'); return; }
          chrome.storage.local.get(['pageMappings'], s => {
            const list = Array.isArray(s.pageMappings) ? s.pageMappings : [];
            if (list.some(m => (m.match || '').toLowerCase() === match.toLowerCase())) {
              toast('This page is already defined');
              return;
            }
            const entry = { match, code };
            if (pendingLogo) entry.logo = pendingLogo;
            list.push(entry);
            chrome.storage.local.set({ pageMappings: list }, () => {
              pageMappings = list;
              pendingLogo = null;
              pushSharedSettings('Page "' + match + '" saved as ' + code + ' for all users');
              renderSettings();
            });
          });
        };
      }
    }
    document.getElementById('set-reset-pos').onclick = () => {
      widget.style.left = 'auto';
      widget.style.top = '60px';
      widget.style.right = '20px';
      widget.style.height = '';
      clampWidget();
      toast('Position reset');
    };
    const logoutBtn = document.getElementById('set-logout');
    if (logoutBtn) {
      logoutBtn.onclick = () => {
        logoutBtn.disabled = true;
        logoutBtn.textContent = 'Signing out...';
        chrome.runtime.sendMessage({ action: 'logout' }, () => {
          toast('Signed out');
          updateToggleButton();
          renderLogin('');
        });
      };
    }
  });
}

// ===== Auto-fill selectors: name + phone, multiple per field (Facebook, WhatsApp, etc.) =====
const SEL_KEYS = { name: 'nameSelectors', phone: 'phoneSelectors', adid: 'adidSelectors', message: 'messageSelectors', sendbox: 'sendboxSelectors' };

function getSelectors(kind, cb) {
  const key = SEL_KEYS[kind];
  chrome.storage.local.get([key], s => cb(Array.isArray(s[key]) ? s[key] : []));
}
function saveSelectors(kind, list, cb) {
  chrome.storage.local.set({ [SEL_KEYS[kind]]: list }, () => cb && cb());
}
// Admin-only: push the locally-edited settings to the server so all users inherit them
function pushSharedSettings(successMsg) {
  chrome.storage.local.get(['nameSelectors', 'phoneSelectors', 'adidSelectors', 'cutoffTime', 'pageMappings', 'deliveryDayScheme', 'holidays', 'messageSelectors', 'sendboxSelectors', 'aiReplyPrompt'], s => {
    chrome.runtime.sendMessage({
      action: 'saveSettings',
      data: {
        nameSelectors: s.nameSelectors || [],
        phoneSelectors: s.phoneSelectors || [],
        adidSelectors: s.adidSelectors || [],
        cutoffTime: s.cutoffTime || '20:00',
        pageMappings: s.pageMappings || [],
        deliveryDayScheme: (s.deliveryDayScheme && typeof s.deliveryDayScheme === 'object') ? s.deliveryDayScheme : {},
        holidays: Array.isArray(s.holidays) ? s.holidays : [],
        messageSelectors: s.messageSelectors || [],
        sendboxSelectors: s.sendboxSelectors || [],
        aiReplyPrompt: typeof s.aiReplyPrompt === 'string' ? s.aiReplyPrompt : '',
      }
    }, resp => {
      if (resp && resp.success) toast(successMsg || 'Settings saved for all users');
      else toast('Save failed: ' + ((resp && resp.error) || 'try again'));
    });
  });
}
// Try each saved selector in order; return the first non-empty text found
function readFromSelectors(kind, cb) {
  getSelectors(kind, selectors => {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = (el.value || el.textContent || '').trim();
          if (text) { cb(text); return; }
        }
      } catch (e) { /* invalid selector, skip */ }
    }
    cb('');
  });
}
function readCustomerName(cb) { readFromSelectors('name', cb); }
// Extract a clean local phone number: strips Mauritius country code 230 -> 5XXXXXXX
function readCustomerPhone(cb) {
  readFromSelectors('phone', raw => {
    if (!raw) { cb(''); return; }
    const m = raw.match(/\+?\d[\d\s().-]{5,}\d/);
    if (!m) { cb(''); return; }
    let digits = m[0].replace(/[^\d]/g, '');
    // Drop the +230 country code so it stores as the local 8-digit number
    if (digits.startsWith('230') && digits.length > 8) digits = digits.slice(3);
    cb(digits);
  });
}
// Extract the ad id (e.g. "ad_id.120248441310790621" -> "120248441310790621")
function readCustomerAdId(cb) {
  readFromSelectors('adid', raw => {
    if (!raw) { cb(''); return; }
    const m = raw.match(/(\d{6,})/);
    cb(m ? m[1] : raw.trim());
  });
}

// Read the whole visible conversation as [{ from: 'customer'|'business', text }].
// The message selector should match the message bubbles (querySelectorAll picks
// them all). Sender is inferred from horizontal alignment: in chat UIs the
// business's own replies sit on the right, the customer's on the left.
function readConversation(cb) {
  getSelectors('message', selectors => {
    const seen = new Set();
    const bubbles = [];
    for (const sel of selectors) {
      let els = [];
      try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { continue; }
      for (const el of els) {
        const text = (el.innerText || el.textContent || '').trim();
        if (!text || text.length > 1200) continue;
        const key = text.slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        bubbles.push({ text, top: r.top, center: r.left + r.width / 2 });
      }
    }
    if (!bubbles.length) { cb([]); return; }
    // Alignment midpoint across all bubbles -> anything past it is our reply
    const lefts = bubbles.map(b => b.center);
    const mid = (Math.min(...lefts) + Math.max(...lefts)) / 2;
    const spread = Math.max(...lefts) - Math.min(...lefts);
    bubbles.sort((a, b) => a.top - b.top); // top-to-bottom = oldest-to-newest
    const turns = bubbles.map(b => ({
      // Only classify by side when bubbles actually differ in alignment
      from: (spread > 40 && b.center > mid) ? 'business' : 'customer',
      text: b.text,
    }));
    cb(turns);
  });
}

// Type AI-drafted text into the platform's reply/send box. Works for plain
// inputs/textareas and for contenteditable rich editors (Messenger, Business
// Suite) by using execCommand so the framework's own input handlers fire.
function insertIntoSendBox(text, cb) {
  getSelectors('sendbox', selectors => {
    let box = null;
    for (const sel of selectors) {
      try { const el = document.querySelector(sel); if (el) { box = el; break; } } catch (e) { /* skip */ }
    }
    if (!box) { cb(false, 'No send box selector set. Add one in Settings.'); return; }
    try {
      box.focus();
      const tag = box.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'input') {
        const setter = Object.getOwnPropertyDescriptor(box.__proto__, 'value');
        if (setter && setter.set) setter.set.call(box, text); else box.value = text;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // contenteditable rich editor: replace any existing content
        const range = document.createRange();
        range.selectNodeContents(box);
        const selApi = window.getSelection();
        selApi.removeAllRanges();
        selApi.addRange(range);
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
        if (!ok) {
          box.textContent = text;
          box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        }
      }
      cb(true);
    } catch (e) {
      cb(false, 'Could not write into the send box.');
    }
  });
}

// ===== Delivery date rules: no deliveries on Sundays or non-delivery days =====
// Non-delivery days are admin-managed (synced from the server into `muHolidays`)
// and support multi-day ranges so a 2-day Eid/Divali or a multi-day cyclone
// closure fits a single entry. Falls back to just Sundays if none are loaded.
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Return the holiday entry covering date `d`, or null. Ranges are inclusive.
function holidayForDate(d) {
  const s = ymd(d);
  for (const h of (muHolidays || [])) {
    if (h && h.start && s >= h.start && s <= (h.end || h.start)) return h;
  }
  return null;
}
// Sunday (getDay()===0) or a day inside an admin-configured non-delivery range
function isNonWorking(d) {
  return d.getDay() === 0 || !!holidayForDate(d);
}
// Mauritius cyclone season runs roughly Nov -> Apr (Southern-hemisphere summer)
function isCycloneSeason(d) {
  const m = d.getMonth(); // 0=Jan
  return m >= 10 || m <= 3; // Nov,Dec,Jan,Feb,Mar,Apr
}
// Map an Open-Meteo WMO weather code to a climate emoji
function weatherEmoji(code) {
  if (code == null) return '';
  if (code === 0) return '\u2600\uFE0F';               // clear sky
  if (code <= 2) return '\uD83C\uDF24\uFE0F';          // mainly clear / partly cloudy
  if (code === 3) return '\u2601\uFE0F';               // overcast
  if (code >= 45 && code <= 48) return '\uD83C\uDF2B\uFE0F'; // fog
  if (code >= 51 && code <= 67) return '\uD83C\uDF26\uFE0F'; // drizzle / rain
  if (code >= 71 && code <= 77) return '\u2744\uFE0F'; // snow (never in MU, safety)
  if (code >= 80 && code <= 82) return '\uD83C\uDF27\uFE0F'; // rain showers
  if (code >= 95) return '\u26C8\uFE0F';               // thunderstorm / cyclonic
  return '\uD83C\uDF24\uFE0F';
}
// Weather info for a date: { emoji, label } or null if we have no forecast
function weatherForDate(d) {
  const w = weatherByDate[ymd(d)];
  if (!w) return null;
  const emoji = weatherEmoji(w.code);
  const parts = [];
  if (w.tMax != null) parts.push(Math.round(w.tMax) + '\u00B0C');
  if (w.rain != null && w.rain >= 30) parts.push(w.rain + '% rain');
  return { emoji, label: parts.join(' \u00B7 ') };
}
// Fetch the Mauritius 16-day forecast (Open-Meteo, no API key) via the
// background worker, cache it for 3h, and refresh the current view.
let __weatherLoading = false;
function loadWeather() {
  if (__weatherLoading) return;
  chrome.storage.local.get(['weatherCache'], c => {
    const cache = c.weatherCache;
    const fresh = cache && cache.fetchedAt && (Date.now() - cache.fetchedAt < 3 * 60 * 60 * 1000);
    if (fresh && cache.byDate) {
      weatherByDate = cache.byDate;
      if (currentTab === 'orders') renderCurrentTab();
      return;
    }
    __weatherLoading = true;
    chrome.runtime.sendMessage({ action: 'getWeather' }, resp => {
      __weatherLoading = false;
      if (resp && resp.success && resp.data && resp.data.byDate) {
        weatherByDate = resp.data.byDate;
        chrome.storage.local.set({ weatherCache: { fetchedAt: Date.now(), byDate: weatherByDate } });
        if (currentTab === 'orders') renderCurrentTab();
      }
    });
  });
}
// First working day on or after the given date
function nextWorkingOnOrAfter(date) {
  const x = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (isNonWorking(x)) x.setDate(x.getDate() + 1);
  return x;
}
// Add N working days (skipping Sundays + holidays) to a starting date
function addWorkingDays(from, n) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    if (!isNonWorking(d)) added++;
  }
  return d;
}
function getCutoff(cb) {
  // Reads both the cut-off time and the admin's per-weekday delivery scheme
  chrome.storage.local.get(['cutoffTime', 'deliveryDayScheme'], s => {
    const scheme = (s.deliveryDayScheme && typeof s.deliveryDayScheme === 'object') ? s.deliveryDayScheme : {};
    cb(s.cutoffTime || '20:00', scheme);
  });
}
// First date strictly after `from` whose weekday === target, skipping Sundays/holidays
function nextDateForWeekday(from, target) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let i = 0; i < 21; i++) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() === target && !isNonWorking(d)) return d;
  }
  return addWorkingDays(from, 1); // safety fallback
}
// Default delivery date:
//  - If the admin set a target weekday for today's weekday, deliver on the next
//    occurrence of that weekday (skipping Sundays/holidays). Cut-off is ignored.
//  - Otherwise: next working day, or the one after if past the cut-off.
function computeDefaultDeliveryDate(cutoff, scheme, cb) {
  const now = new Date();
  const orderDow = now.getDay();
  const target = scheme ? scheme[String(orderDow)] : undefined;
  if (target !== undefined && target !== null && target !== '') {
    const t = parseInt(target, 10);
    if (t >= 0 && t <= 6) { cb(nextDateForWeekday(now, t), false, true); return; }
  }
  const [ch, cm] = (cutoff || '20:00').split(':').map(Number);
  const afterCutoff = now.getHours() > ch || (now.getHours() === ch && now.getMinutes() >= cm);
  cb(addWorkingDays(now, afterCutoff ? 2 : 1), afterCutoff, false);
}

// Build a reasonably stable CSS selector for a clicked element
function buildSelector(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  const parts = [];
  let node = el, depth = 0;
  while (node && node.nodeType === 1 && depth < 6) {
    let part = node.tagName.toLowerCase();
    const cls = (node.className && typeof node.className === 'string')
      ? node.className.trim().split(/\s+/).filter(c => c && !/\d{4,}/.test(c) && c.length < 25)
      : [];
    if (cls.length) part += '.' + CSS.escape(cls[0]);
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
      if (sameTag.length > 1) {
        part += ':nth-of-type(' + (Array.from(parent.children).indexOf(node) + 1) + ')';
      }
    }
    parts.unshift(part);
    try { if (document.querySelectorAll(parts.join(' > ')).length === 1) break; } catch (e) {}
    node = node.parentElement;
    depth++;
  }
  return parts.join(' > ');
}
// Highlight click-to-pick: user clicks the name or phone on the page
function startPicker(kind) {
  const label = kind === 'phone' ? 'phone number'
    : kind === 'adid' ? 'ad id label'
    : kind === 'message' ? 'a customer message bubble'
    : kind === 'sendbox' ? 'the reply / send box'
    : 'customer name';
  toast('Click the ' + label + ' on the page (ESC to cancel)');
  widget.style.display = 'none';

  const hint = document.createElement('div');
  hint.textContent = 'Click the ' + label + '  -  press ESC to cancel';
  hint.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#f97316;color:#fff;padding:10px 18px;border-radius:8px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.4);pointer-events:none;';
  document.body.appendChild(hint);

  const hl = document.createElement('div');
  hl.style.cssText = 'position:fixed;z-index:2147483646;background:rgba(249,115,22,0.25);border:2px solid #f97316;border-radius:4px;pointer-events:none;transition:all 0.05s;';
  document.body.appendChild(hl);

  let lastEl = null;
  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === hl || el === hint) return;
    lastEl = el;
    const r = el.getBoundingClientRect();
    hl.style.left = r.left + 'px';
    hl.style.top = r.top + 'px';
    hl.style.width = r.width + 'px';
    hl.style.height = r.height + 'px';
  }
  function cleanup() {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    hl.remove();
    hint.remove();
    widget.style.display = 'flex';
    clampWidget();
  }
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = lastEl || document.elementFromPoint(e.clientX, e.clientY);
    cleanup();
    if (!el) return;
    const sel = buildSelector(el);
    const preview = (el.textContent || '').trim().slice(0, 30);
    getSelectors(kind, list => {
      if (!list.includes(sel)) list.push(sel);
    saveSelectors(kind, list, () => {
      pushSharedSettings('Saved for all users: "' + preview + '"');
      renderSettings();
    });
    });
  }
  function onKey(e) {
    if (e.key === 'Escape') { cleanup(); toast('Cancelled'); }
  }
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

// Tab switching
document.querySelectorAll('.akmez-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.akmez-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    renderCurrentTab();
  });
});

// Toast notification
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'akmez-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// Load data via background script - uses shared auth from chrome.storage
async function loadData() {
  const body = document.getElementById('akmez-body');
  body.innerHTML = '<div class="akmez-loading"><div class="akmez-spinner"></div></div>';
  
  // Check if a token exists - the background script handles validation and refresh
  chrome.storage.local.get(['authToken', 'userName'], stored => {
    if (!stored.authToken) {
      renderLogin('');
      return;
    }
    
    // Fetch data using shared auth token
    chrome.runtime.sendMessage({ action: 'fetchData' }, response => {
      if (!response || !response.success) {
        renderLogin('Connection failed');
        return;
      }
      const data = response.data;
      if (!data.authenticated) {
        // Token might be invalid, clear it
        chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName', 'userEmail']);
        renderLogin('Session expired. Please sign in again.');
        return;
      }
      products = data.products || [];
      regions = data.regions || [];
      regionDelivery = data.regionDelivery || {};
      worktimeData = data.worktime || worktimeData;
      // Mirror the shared, admin-configured settings into local storage so the
      // auto-fill readers (which read these keys) inherit them for every user.
      const s = data.settings || {};
      muHolidays = Array.isArray(s.holidays) ? s.holidays : [];
      chrome.storage.local.set({
        userRole: data.role || null,
        nameSelectors: Array.isArray(s.nameSelectors) ? s.nameSelectors : [],
        phoneSelectors: Array.isArray(s.phoneSelectors) ? s.phoneSelectors : [],
        adidSelectors: Array.isArray(s.adidSelectors) ? s.adidSelectors : [],
        cutoffTime: s.cutoffTime || '20:00',
        pageMappings: Array.isArray(s.pageMappings) ? s.pageMappings : [],
        deliveryDayScheme: (s.deliveryDayScheme && typeof s.deliveryDayScheme === 'object') ? s.deliveryDayScheme : {},
        holidays: muHolidays,
        messageSelectors: Array.isArray(s.messageSelectors) ? s.messageSelectors : [],
        sendboxSelectors: Array.isArray(s.sendboxSelectors) ? s.sendboxSelectors : [],
        aiReplyPrompt: typeof s.aiReplyPrompt === 'string' ? s.aiReplyPrompt : '',
      }, () => { pageMappings = Array.isArray(s.pageMappings) ? s.pageMappings : []; loadWeather(); renderCurrentTab(); });
    });
  });
}

// Render login form - synced with extension popup
function renderLogin(error) {
  const body = document.getElementById('akmez-body');
  body.innerHTML = `
    <div class="akmez-login-form">
      <div class="title">Sign in to Akmez</div>
      <div class="akmez-login-error" id="login-error">${error || ''}</div>
      <div class="form-group">
        <input type="email" id="login-email" placeholder="Email" />
      </div>
      <div class="form-group">
        <input type="password" id="login-password" placeholder="Password" />
      </div>
      <button class="akmez-login-btn" id="login-btn">Sign In</button>
      <div class="akmez-login-hint" style="margin-top:12px;font-size:10px;color:#888;text-align:center;">
        Sign in to create orders and manage working time
      </div>
    </div>
  `;
  if (error) document.getElementById('login-error').style.display = 'block';
  
  // Enter key support
  document.getElementById('login-email').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('login-password').focus();
  });
  document.getElementById('login-password').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
  
  document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const err = document.getElementById('login-error');
    
    if (!email || !password) {
      err.textContent = 'Please enter email and password';
      err.style.display = 'block';
      return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    
    // Use background script login which stores token in shared storage
    chrome.runtime.sendMessage({ action: 'login', email, password }, response => {
      if (response && response.success) {
        loadData();
      } else {
        err.textContent = response?.error || 'Login failed';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    });
  };
}

// Render current tab
function renderCurrentTab() {
  if (currentTab === 'orders') renderOrdersForm();
  else if (currentTab === 'stats') renderMyStats();
  else renderWorktime();
}

// Render orders form
function renderOrdersForm() {
  const body = document.getElementById('akmez-body');
  body.innerHTML = `
    <button type="button" class="akmez-set-btn" id="ak-ai-reply">&#9728; Reply with AI</button>
    <div class="akmez-ai-draft" id="ak-ai-draft" style="display:none;">
      <div class="akmez-ai-draft-title">&#9728; Suggested reply</div>
      <textarea class="akmez-ai-draft-text" id="ak-ai-draft-text"></textarea>
      <div class="akmez-ai-draft-actions">
        <button type="button" class="akmez-ai-insert" id="ak-ai-insert">Insert into Send Box</button>
        <button type="button" class="akmez-ai-regen" id="ak-ai-regen">Regenerate</button>
      </div>
    </div>
    <div class="akmez-row">
      <div class="akmez-field">
        <div class="akmez-label">Name <span class="req">*</span></div>
        <div class="akmez-input-wrap">
          <input type="text" id="ak-name" class="akmez-input" placeholder="Auto-filled from conversation">
        </div>
      </div>
    </div>
    <div class="akmez-row">
      <div class="akmez-field">
        <div class="akmez-label">Contact 1 <span class="req">*</span></div>
        <div class="akmez-input-wrap">
          <input type="text" id="ak-c1" class="akmez-input" placeholder="Phone (auto)">
          <button class="akmez-paste" data-t="ak-c1">PASTE</button>
        </div>
      </div>
      <div class="akmez-field">
        <div class="akmez-label">Contact 2</div>
        <div class="akmez-input-wrap">
          <input type="text" id="ak-c2" class="akmez-input" placeholder="Optional">
          <button class="akmez-paste" data-t="ak-c2">PASTE</button>
        </div>
      </div>
    </div>
    <div id="ak-rating" class="akmez-rating" style="display:none;"></div>
    <div class="akmez-row">
      <div class="akmez-field akmez-autocomplete">
        <div class="akmez-label">Region <span class="req">*</span></div>
        <input type="text" id="ak-region" class="akmez-input akmez-input-plain" placeholder="Type region..." autocomplete="off">
        <div class="akmez-suggest" id="ak-region-suggest"></div>
      </div>
      <div class="akmez-field">
        <div class="akmez-label">Date <span class="req">*</span></div>
        <input type="date" id="ak-date" class="akmez-input akmez-input-plain">
      </div>
    </div>
    <div class="akmez-delivery-info" id="ak-delivery-info" style="display:none;"></div>
    <div class="akmez-region-delivery" id="ak-region-delivery" style="display:none;"></div>
    <div class="akmez-field">
      <div class="akmez-label">Sales Type</div>
      <div class="akmez-salestype" id="ak-salestype">
        <button type="button" class="akmez-st-pill active" data-st="sale">Sale</button>
        <button type="button" class="akmez-st-pill" data-st="exchange">Exchange</button>
        <button type="button" class="akmez-st-pill" data-st="trade_in">Trade In</button>
        <button type="button" class="akmez-st-pill" data-st="refund">Refund</button>
        <button type="button" class="akmez-st-pill" data-st="drop_off">Drop Off</button>
      </div>
    </div>
    <div class="akmez-field akmez-autocomplete" id="ak-oldprod-field" style="display:none;">
      <div class="akmez-label" id="ak-oldprod-label">Product client currently has <span class="req">*</span></div>
      <div id="ak-oldprod-status" class="akmez-oldprod-status"></div>
      <input type="text" id="ak-oldprod-search" class="akmez-input akmez-input-plain" placeholder="Search the product being returned..." autocomplete="off">
      <div class="akmez-suggest" id="ak-oldprod-suggest"></div>
      <div id="ak-oldprod-picked" class="akmez-oldprod-picked" style="display:none;"></div>
      <div id="ak-oldprod-hint" class="akmez-oldprod-hint"></div>
    </div>
    <div class="akmez-adid-toggle" id="ak-adid-toggle">Show Ad ID (auto-captured)</div>
    <div class="akmez-row akmez-adid-row" id="ak-adid-row" style="display:none;">
      <div class="akmez-field">
        <div class="akmez-label">Ad ID</div>
        <div class="akmez-input-wrap">
          <input type="text" id="ak-adid" class="akmez-input" placeholder="Ad ID (auto)">
          <button class="akmez-paste" data-t="ak-adid">PASTE</button>
        </div>
      </div>
    </div>
    <div class="akmez-field">
      <div class="akmez-label">Notes</div>
      <textarea id="ak-notes" class="akmez-input akmez-input-plain akmez-notes" placeholder="Optional note for the delivery team..." rows="2"></textarea>
    </div>
    <div class="akmez-section">Add Products</div>
    <div class="akmez-autocomplete">
      <input type="text" class="akmez-product-search" id="ak-search" placeholder="Type to search ${products.length} products..." autocomplete="off">
      <div class="akmez-suggest" id="ak-prod-suggest"></div>
    </div>
    <div class="akmez-cart-list" id="ak-cart-list"></div>
    <div class="akmez-cart" id="ak-cart" style="display:none">
      <span class="items">0 items</span>
      <span class="total">Rs 0</span>
    </div>
    <div id="ak-err" class="akmez-error" style="display:none"></div>
    <button class="akmez-submit" id="ak-submit">Create Order</button>
  `;
  
  // Paste buttons
  body.querySelectorAll('.akmez-paste').forEach(b => {
  b.onclick = async () => {
  try {
  const el = document.getElementById(b.dataset.t);
  el.value = await navigator.clipboard.readText();
  // Fire input so listeners react (e.g. instant client rating on C1)
  el.dispatchEvent(new Event('input', { bubbles: true }));
  } catch(e) {}
  };
  });

  // ----- Reply with AI: scrape the conversation, draft a reply via ChatGPT,
  // then let the agent insert it into the platform's send box -----
  const aiBtn = document.getElementById('ak-ai-reply');
  const aiDraft = document.getElementById('ak-ai-draft');
  const aiText = document.getElementById('ak-ai-draft-text');
  const generateReply = () => {
    readConversation(turns => {
      if (!turns.length) {
        toast('No messages found. Ask your admin to set the message selector in Settings.');
        return;
      }
      aiBtn.disabled = true;
      aiBtn.innerHTML = '&#9728; Thinking...';
      const customerName = (document.getElementById('ak-name').value || '').trim();
      const dp = window.__akmezDetectedPage;
      const pageName = (dp && (dp.match || dp.code)) ? (dp.match || dp.code) : '';
      chrome.runtime.sendMessage({ action: 'aiReply', data: { messages: turns, customerName, pageName } }, resp => {
        aiBtn.disabled = false;
        aiBtn.innerHTML = '&#9728; Reply with AI';
        const data = resp && resp.data;
        if (resp && resp.success && data && data.success && data.reply) {
          aiText.value = data.reply;
          aiDraft.style.display = 'block';
          aiText.focus();
        } else {
          toast((data && data.error) || (resp && resp.error) || 'Could not generate a reply');
        }
      });
    });
  };
  if (aiBtn) aiBtn.onclick = generateReply;
  const aiRegen = document.getElementById('ak-ai-regen');
  if (aiRegen) aiRegen.onclick = generateReply;
  const aiInsert = document.getElementById('ak-ai-insert');
  if (aiInsert) aiInsert.onclick = () => {
    const txt = (aiText.value || '').trim();
    if (!txt) { toast('Nothing to insert'); return; }
    insertIntoSendBox(txt, (ok, err) => {
      if (ok) toast('Inserted into the send box');
      else toast(err || 'Could not insert');
    });
  };

  // The product the client is returning (Exchange / Trade In). Held here so the
  // submit handler and the difference calculator can both read it.
  let oldProduct = null; // { id, name, price }
  let oldProductAuto = false; // true when auto-filled from delivery history (agent hasn't overridden)

  // Eligibility gate: Exchange / Trade In require a past DELIVERED order.
  // state: idle | loading | ok | none
  let deliveredElig = { phone: null, state: 'idle', count: 0, product: null };
  let __deliveredTimer = null;

  // Reflect the selected sales type in the "current product" sub-form:
  //  - Exchange  : defective unit swapped for the same product, no charge
  //  - Trade In  : swapped for an equivalent product, client pays any price gap
  function updateSalesTypeUI() {
    const active = body.querySelector('#ak-salestype .akmez-st-pill.active');
    const st = active ? active.dataset.st : 'sale';
    const field = document.getElementById('ak-oldprod-field');
    const label = document.getElementById('ak-oldprod-label');
    const search = document.getElementById('ak-oldprod-search');
    if (!field) return;
    if (st === 'exchange' || st === 'trade_in') {
      field.style.display = '';
      if (st === 'exchange') {
        label.innerHTML = 'Defective product being returned <span class="req">*</span>';
        search.placeholder = 'Search the defective product...';
      } else {
        label.innerHTML = 'Product client currently has (trading in) <span class="req">*</span>';
        search.placeholder = 'Search the product being traded in...';
      }
      // Verify the client has a past delivered order and auto-fill from history
      lookupLastDelivered();
    } else {
      field.style.display = 'none';
    }
    updateEligUI();
    updateOldProdHint();
    updateCart();
  }

  // Sales type pills: Sale / Exchange / Trade In / Refund / Drop Off
  body.querySelectorAll('.akmez-st-pill').forEach(p => {
    p.onclick = () => {
      body.querySelectorAll('.akmez-st-pill').forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      updateSalesTypeUI();
    };
  });
  
  // Auto-fill name + phone + ad id - continuously follows the currently open conversation
  const fields = {
    name:  { input: document.getElementById('ak-name'), edited: false, last: null, emptyStreak: 0 },
    phone: { input: document.getElementById('ak-c1'),   edited: false, last: null, emptyStreak: 0 },
    adid:  { input: document.getElementById('ak-adid'), edited: false, last: null, emptyStreak: 0 },
  };
  Object.values(fields).forEach(f => f.input.addEventListener('input', () => { f.edited = true; }));

  // ===== Client rating lookup: shows Good/Average/Bad badge for the current phone =====
  let __ratingLastPhone = null;
  let __ratingTimer = null;
  function refreshClientRating() {
    const box = document.getElementById('ak-rating');
    if (!box) return;
    const digits = (fields.phone.input.value || '').replace(/\D/g, '');
    if (digits.length < 7) {
      __ratingLastPhone = null;
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    if (digits === __ratingLastPhone) return; // same client - keep current badge
    __ratingLastPhone = digits;
    clearTimeout(__ratingTimer);
    __ratingTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'getClientRating', phone: digits }, resp => {
        // Ignore stale responses (user switched conversation meanwhile)
        const nowDigits = (fields.phone.input.value || '').replace(/\D/g, '');
        if (nowDigits !== digits) return;
        if (!resp || !resp.success || !resp.data) { box.style.display = 'none'; return; }
        const d = resp.data;
        const colors = {
          good:    { bg: '#dcfce7', fg: '#15803d', label: 'GOOD CLIENT' },
          average: { bg: '#fef9c3', fg: '#a16207', label: 'AVERAGE CLIENT' },
          bad:     { bg: '#fee2e2', fg: '#b91c1c', label: 'BAD CLIENT' },
          new:     { bg: '#f1f5f9', fg: '#475569', label: 'NEW CLIENT' },
        };
        const c = colors[d.rating] || colors.new;
        let detail = '';
        if (d.found) {
          const pct = (d.deliveredPct !== null && d.deliveredPct !== undefined) ? ` &middot; ${d.deliveredPct}% delivered` : '';
          const sales = d.totalSales ? ` &middot; Rs ${Number(d.totalSales).toLocaleString()}` : '';
          detail = `<span style="color:#64748b;font-size:11px;">${d.totalOrders} orders${pct}${sales}</span>`;
        } else {
          detail = '<span style="color:#64748b;font-size:11px;">No order history</span>';
        }
        // For bad clients, grade severity by failed (CMS) orders
        let severity = '';
        if (d.rating === 'bad' && d.badSeverity) {
          const sevBg = { low: '#fee2e2', moderate: '#fecaca', high: '#fca5a5', critical: '#dc2626' };
          const sevFg = { low: '#b91c1c', moderate: '#b91c1c', high: '#7f1d1d', critical: '#ffffff' };
          const lvl = d.badSeverity.level;
          severity = `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;background:${sevBg[lvl] || sevBg.low};color:${sevFg[lvl] || sevFg.low};margin-right:6px;">${d.badSeverity.label.toUpperCase()} &middot; ${d.badSeverity.failedOrders} FAILED</span>`;
        }
        box.innerHTML = `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;background:${c.bg};color:${c.fg};margin-right:6px;">${c.label}</span>${severity}${detail}`;
        box.style.display = 'block';
        box.style.padding = '4px 2px';
      });
    }, 350);
  }
  fields.phone.input.addEventListener('input', () => { refreshClientRating(); lookupLastDelivered(); });

  // Apply a freshly detected value, or clear the field once its selector stops matching.
  function applyField(f, val) {
    if (val) {
      f.emptyStreak = 0;
      if (val !== f.last) {
        // Conversation changed - follow it and drop any stale manual edit
        f.last = val;
        f.edited = false;
        f.input.value = val;
      } else if (!f.edited) {
        f.input.value = val;
      }
    } else if (!f.edited && f.last !== null) {
      // Selector no longer matches (switched to a conversation without this value).
      // Require 2 consecutive empty reads to avoid clearing during Meta's re-renders.
      if (++f.emptyStreak >= 2) {
        f.last = null;
        f.input.value = '';
      }
    }
  }

  function syncFields() {
    // Self-clean if the order form is no longer on screen
    if (!document.getElementById('ak-name')) {
      if (window.__akmezSyncTimer) { clearInterval(window.__akmezSyncTimer); window.__akmezSyncTimer = null; }
      return;
    }
    readCustomerName(txt => {
      const prevName = fields.name.last;
      applyField(fields.name, txt);
      // New conversation detected (name switched to a different client):
      // reset the product cart so items from the previous client don't carry over.
      if (txt && fields.name.last !== prevName && prevName !== null) {
        if (Object.keys(cart).length) {
          cart = {};
          updateCart();
        }
        // Allow the new client's ad id to resolve its product again
        window.__akmezLastResolvedAd = null;
      }
    });
    readCustomerPhone(num => { applyField(fields.phone, num); refreshClientRating(); lookupLastDelivered(); });
    readCustomerAdId(id => {
      const prev = fields.adid.last;
      applyField(fields.adid, id);
      // When the ad id changes to a new value, auto-resolve its linked product
      if (fields.adid.input.value && fields.adid.input.value !== prev) {
        resolveProductFromAdId(fields.adid.input.value);
      }
    });
  }
  syncFields();
  detectSourcePage();
  if (window.__akmezSyncTimer) clearInterval(window.__akmezSyncTimer);
  window.__akmezSyncTimer = setInterval(() => { syncFields(); detectSourcePage(); }, 1200);
  
  // Product search - type-to-search autocomplete with keyboard navigation
  const prodInput = document.getElementById('ak-search');
  const prodSuggest = document.getElementById('ak-prod-suggest');
  let prodMatches = [];
  let prodActive = -1;

  // Prefix matches first, then other contains matches
  function rankProducts(q) {
    if (!q) return products.slice(0, 8);
    const starts = [], contains = [];
    for (const p of products) {
      const l = p.name.toLowerCase();
      if (l.startsWith(q)) starts.push(p);
      else if (l.includes(q)) contains.push(p);
    }
    return starts.concat(contains).slice(0, 8);
  }

  function paintProdActive() {
    prodSuggest.querySelectorAll('.akmez-suggest-item').forEach((el, i) => {
      el.classList.toggle('active', i === prodActive);
      if (i === prodActive) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function showProdSuggestions() {
    const q = prodInput.value.toLowerCase().trim();
    prodMatches = rankProducts(q);
    if (!prodMatches.length) { prodSuggest.style.display = 'none'; return; }
    prodActive = 0;
    prodSuggest.innerHTML = prodMatches.map((p, i) => {
      const offer = akmezOfferLabel(p);
      const hasVar = p.has_variants && Array.isArray(p.variants) && p.variants.length;
      const varBadge = hasVar ? ` <span class="akmez-var-badge">${p.variants.length} options</span>` : '';
      return `
      <div class="akmez-suggest-item${i === 0 ? ' active' : ''}" data-i="${i}">
        ${akmezThumb(p, 'akmez-suggest-thumb')}
        <span class="akmez-suggest-name">${p.name.replace(/</g, '&lt;')}${offer ? ` <span class="akmez-offer-badge">${offer}</span>` : ''}${varBadge}</span>
        <span class="akmez-suggest-price">Rs ${p.price}</span>
      </div>`;
    }).join('');
    prodSuggest.style.display = 'block';
    prodSuggest.querySelectorAll('.akmez-suggest-item').forEach(it => {
      it.onmousedown = e => {
        // Tapping the thumbnail enlarges it instead of adding to cart
        if (e.target.classList.contains('akmez-suggest-thumb')) {
          e.preventDefault();
          const p = prodMatches[parseInt(it.dataset.i, 10)];
          if (p) akmezShowImage(p.image_url, p.name);
          return;
        }
        e.preventDefault();
        pickProduct(parseInt(it.dataset.i, 10));
      };
    });
  }

  function pickProduct(i) {
    if (i < 0 || i >= prodMatches.length) return;
    const p = prodMatches[i];
    // If this product has varieties (e.g. colours), let the agent choose one
    // before adding it to the cart instead of adding it straight away.
    if (p.has_variants && Array.isArray(p.variants) && p.variants.length) {
      showVariantPicker(p);
      return;
    }
    cart[p.id] = (cart[p.id] || 0) + 1;
    updateCart();
    // Clear the query so the agent can immediately search the next product
    prodInput.value = '';
    prodSuggest.style.display = 'none';
    prodInput.focus();
  }

  // Show a chooser for a product's varieties, grouped by attribute (Colour, Size...).
  // Picking an option adds that specific variant as its own cart line.
  function showVariantPicker(p) {
    const groups = {};
    (p.variants || []).forEach(v => {
      const key = v.attribute_name || 'Option';
      (groups[key] = groups[key] || []).push(v);
    });
    let html = `<div class="akmez-var-head">${p.name.replace(/</g, '&lt;')} &mdash; choose an option</div>`;
    Object.keys(groups).forEach(attr => {
      html += `<div class="akmez-var-group"><div class="akmez-var-attr">${String(attr).replace(/</g, '&lt;')}</div><div class="akmez-var-opts">`;
      groups[attr].forEach(v => {
        const soldOut = (v.quantity != null && Number(v.quantity) <= 0);
        const hasOverride = v.price_override != null && v.price_override !== '';
        const priceTag = hasOverride ? ` (Rs ${Math.round(parseFloat(v.price_override))})` : '';
        html += `<button class="akmez-var-chip${soldOut ? ' sold' : ''}" data-vid="${v.id}"${soldOut ? ' disabled' : ''}>${String(v.attribute_value).replace(/</g, '&lt;')}${priceTag}${soldOut ? ' &middot; out of stock' : ''}</button>`;
      });
      html += `</div></div>`;
    });
    html += `<button class="akmez-var-cancel" data-cancel="1">Cancel</button>`;
    prodSuggest.innerHTML = html;
    prodSuggest.style.display = 'block';
    prodSuggest.querySelectorAll('.akmez-var-chip:not(.sold)').forEach(chip => {
      chip.onmousedown = e => {
        e.preventDefault();
        const key = p.id + '::' + chip.dataset.vid;
        cart[key] = (cart[key] || 0) + 1;
        updateCart();
        prodInput.value = '';
        prodSuggest.style.display = 'none';
        prodInput.focus();
      };
    });
    const cancel = prodSuggest.querySelector('[data-cancel]');
    if (cancel) cancel.onmousedown = e => { e.preventDefault(); prodSuggest.style.display = 'none'; prodInput.focus(); };
  }

  // ===== "Current product" picker for Exchange / Trade In =====
  const oldInput = document.getElementById('ak-oldprod-search');
  const oldSuggest = document.getElementById('ak-oldprod-suggest');
  const oldPicked = document.getElementById('ak-oldprod-picked');
  let oldMatches = [];
  let oldActive = -1;

  // Current cart total (after B1G1 / bundle pricing) - the value of the new product(s)
  function cartTotalAmount() {
    let amt = 0;
    Object.entries(cart).forEach(([key, q]) => {
      if (q > 0) { const r = akmezCartResolve(key); if (r) amt += akmezPriceFor(r.priced, q); }
    });
    return amt;
  }

  // Show the charge outcome under the picker: nil for a defective exchange,
  // else the price difference the client must pay on a trade in.
  function updateOldProdHint() {
    const hint = document.getElementById('ak-oldprod-hint');
    if (!hint) return;
    const active = document.querySelector('#ak-salestype .akmez-st-pill.active');
    const st = active ? active.dataset.st : 'sale';
    if (st !== 'exchange' && st !== 'trade_in') { hint.textContent = ''; return; }
    if (st === 'exchange') {
      hint.textContent = 'Defective swap - no charge (Rs 0).';
      hint.className = 'akmez-oldprod-hint nil';
      return;
    }
    // Trade In: difference = new product total - returned product price (min 0)
    const oldPrice = oldProduct ? (parseFloat(oldProduct.price) || 0) : 0;
    const diff = Math.max(0, cartTotalAmount() - oldPrice);
    if (!oldProduct) {
      hint.textContent = 'Select the product being traded in to compute the difference.';
      hint.className = 'akmez-oldprod-hint';
    } else if (diff <= 0) {
      hint.textContent = 'Equivalent price - no difference to pay (Rs 0).';
      hint.className = 'akmez-oldprod-hint nil';
    } else {
      hint.textContent = 'Difference to pay: Rs ' + diff.toFixed(0);
      hint.className = 'akmez-oldprod-hint pay';
    }
  }

  // Best-effort match of a historical product name to the current catalog
  // (to recover its price/image for the trade-in difference calculation).
  function matchCatalog(name) {
    if (!name) return null;
    const low = name.toLowerCase().trim();
    return products.find(x => x.name.toLowerCase() === low)
      || products.find(x => { const n = x.name.toLowerCase(); return n.startsWith(low) || low.startsWith(n); })
      || products.find(x => { const n = x.name.toLowerCase(); return n.includes(low) || low.includes(n); })
      || null;
  }

  // Auto-fill the returned product from the client's most recent delivered order.
  function autofillReturnedProduct(rawName) {
    const p = matchCatalog(rawName);
    if (p) {
      oldProduct = { id: p.id, name: p.name, price: p.price, image_url: p.image_url };
    } else if (rawName) {
      // Product no longer in the catalog - keep the historical name, price unknown
      oldProduct = { id: null, name: rawName, price: 0, image_url: null };
    } else {
      return;
    }
    oldProductAuto = true;
    window.__akmezOldProduct = oldProduct;
    renderOldPicked();
    updateOldProdHint();
  }

  // Reflect the eligibility gate in the UI and enable/disable the picker.
  function updateEligUI() {
    window.__akmezDeliveredState = deliveredElig.state; // mirror for submit handler
    const status = document.getElementById('ak-oldprod-status');
    if (!status) return;
    const active = document.querySelector('#ak-salestype .akmez-st-pill.active');
    const st = active ? active.dataset.st : 'sale';
    if (st !== 'exchange' && st !== 'trade_in') { status.textContent = ''; status.className = 'akmez-oldprod-status'; return; }
    const kind = st === 'exchange' ? 'Exchange' : 'Trade In';
    if (deliveredElig.state === 'idle') {
      status.textContent = "Enter the client's phone to verify a past delivered order.";
      status.className = 'akmez-oldprod-status loading';
      if (oldInput) oldInput.disabled = true;
    } else if (deliveredElig.state === 'loading') {
      status.textContent = 'Checking delivery history...';
      status.className = 'akmez-oldprod-status loading';
      if (oldInput) oldInput.disabled = true;
    } else if (deliveredElig.state === 'ok') {
      status.innerHTML = '\u2713 Verified: ' + deliveredElig.count + ' delivered order'
        + (deliveredElig.count !== 1 ? 's' : '')
        + (deliveredElig.product ? ' \u00b7 last: ' + deliveredElig.product.replace(/</g, '&lt;') : '');
      status.className = 'akmez-oldprod-status ok';
      if (oldInput) oldInput.disabled = false;
    } else { // none
      status.textContent = '\u26A0 No delivered order found for this number - ' + kind + ' is only allowed for past customers.';
      status.className = 'akmez-oldprod-status blocked';
      if (oldInput) oldInput.disabled = true;
    }
  }

  // Look up the client's most recent delivered product to gate Exchange / Trade In.
  function lookupLastDelivered() {
    const active = body.querySelector('#ak-salestype .akmez-st-pill.active');
    const st = active ? active.dataset.st : 'sale';
    if (st !== 'exchange' && st !== 'trade_in') return;
    const digits = (fields.phone.input.value || '').replace(/\D/g, '');
    if (digits.length < 7) {
      deliveredElig = { phone: null, state: 'idle', count: 0, product: null };
      window.__akmezDeliveredOk = false;
      updateEligUI();
      return;
    }
    // Reuse a resolved result for the same phone
    if (deliveredElig.phone === digits && (deliveredElig.state === 'ok' || deliveredElig.state === 'none')) {
      window.__akmezDeliveredOk = deliveredElig.state === 'ok';
      updateEligUI();
      return;
    }
    deliveredElig = { phone: digits, state: 'loading', count: 0, product: null };
    window.__akmezDeliveredOk = false;
    updateEligUI();
    clearTimeout(__deliveredTimer);
    __deliveredTimer = setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'getClientLastDelivered', phone: digits }, resp => {
        // Ignore stale responses (phone changed meanwhile)
        const now = (fields.phone.input.value || '').replace(/\D/g, '');
        if (now !== digits) return;
        if (resp && resp.success && resp.data && resp.data.found && resp.data.deliveredCount > 0) {
          const d = resp.data;
          deliveredElig = { phone: digits, state: 'ok', count: d.deliveredCount, product: d.lastProduct };
          window.__akmezDeliveredOk = true;
          // Auto-fill from history unless the agent already picked one manually
          if (!oldProduct || oldProductAuto) autofillReturnedProduct(d.lastProduct);
        } else {
          deliveredElig = { phone: digits, state: 'none', count: 0, product: null };
          window.__akmezDeliveredOk = false;
          // Clear any auto-filled product since the client isn't eligible
          if (oldProductAuto) { oldProduct = null; oldProductAuto = false; window.__akmezOldProduct = null; renderOldPicked(); }
        }
        updateEligUI();
        updateOldProdHint();
      });
    }, 300);
  }

  function renderOldPicked() {
    if (!oldProduct) { oldPicked.style.display = 'none'; oldPicked.innerHTML = ''; oldInput.style.display = ''; return; }
    oldInput.style.display = 'none';
    oldPicked.style.display = 'flex';
    oldPicked.innerHTML = `
      ${akmezThumb(oldProduct, 'akmez-cart-thumb')}
      <div class="akmez-cart-item-info">
        <div class="akmez-cart-item-name">${oldProduct.name.replace(/</g, '&lt;')}</div>
        <div class="akmez-cart-item-price">Rs ${(parseFloat(oldProduct.price) || 0).toFixed(0)}</div>
      </div>
      <button class="akmez-qty-btn akmez-qty-del" id="ak-oldprod-clear" title="Change">&times;</button>`;
    const clr = document.getElementById('ak-oldprod-clear');
    if (clr) clr.onclick = () => { oldProduct = null; oldProductAuto = false; window.__akmezOldProduct = null; renderOldPicked(); updateOldProdHint(); oldInput.focus(); };
  }

  function showOldSuggestions() {
    const q = oldInput.value.toLowerCase().trim();
    oldMatches = rankProducts(q);
    if (!oldMatches.length) { oldSuggest.style.display = 'none'; return; }
    oldActive = 0;
    oldSuggest.innerHTML = oldMatches.map((p, i) => {
      return `
      <div class="akmez-suggest-item${i === 0 ? ' active' : ''}" data-i="${i}">
        ${akmezThumb(p, 'akmez-suggest-thumb')}
        <span class="akmez-suggest-name">${p.name.replace(/</g, '&lt;')}</span>
        <span class="akmez-suggest-price">Rs ${p.price}</span>
      </div>`;
    }).join('');
    oldSuggest.style.display = 'block';
    oldSuggest.querySelectorAll('.akmez-suggest-item').forEach(it => {
      it.onmousedown = e => {
        if (e.target.classList.contains('akmez-suggest-thumb')) {
          e.preventDefault();
          const p = oldMatches[parseInt(it.dataset.i, 10)];
          if (p) akmezShowImage(p.image_url, p.name);
          return;
        }
        e.preventDefault();
        pickOldProduct(parseInt(it.dataset.i, 10));
      };
    });
  }

  function pickOldProduct(i) {
    if (i < 0 || i >= oldMatches.length) return;
    const p = oldMatches[i];
    oldProduct = { id: p.id, name: p.name, price: p.price, image_url: p.image_url };
    oldProductAuto = false; // agent overrode the auto-filled product
    window.__akmezOldProduct = oldProduct; // mirror so submitOrder can read it
    oldInput.value = '';
    oldSuggest.style.display = 'none';
    renderOldPicked();
    updateOldProdHint();
  }

  if (oldInput) {
    oldInput.addEventListener('input', showOldSuggestions);
    oldInput.addEventListener('focus', showOldSuggestions);
    oldInput.addEventListener('blur', () => setTimeout(() => { oldSuggest.style.display = 'none'; }, 150));
    oldInput.addEventListener('keydown', e => {
      const open = oldSuggest.style.display === 'block' && oldMatches.length;
      if (e.key === 'ArrowDown') {
        if (!open) { showOldSuggestions(); return; }
        e.preventDefault();
        oldActive = (oldActive + 1) % oldMatches.length;
        oldSuggest.querySelectorAll('.akmez-suggest-item').forEach((el, i) => el.classList.toggle('active', i === oldActive));
      } else if (e.key === 'ArrowUp') {
        if (!open) return;
        e.preventDefault();
        oldActive = (oldActive - 1 + oldMatches.length) % oldMatches.length;
        oldSuggest.querySelectorAll('.akmez-suggest-item').forEach((el, i) => el.classList.toggle('active', i === oldActive));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (open && oldActive >= 0) { if (e.key === 'Enter') e.preventDefault(); pickOldProduct(oldActive); }
      } else if (e.key === 'Escape') {
        oldSuggest.style.display = 'none';
      }
    });
  }

  // Given a captured Ad ID, resolve its linked product (ad -> campaign -> product)
  // and auto-add it to the cart. Guards against resolving the same ad twice.
  function resolveProductFromAdId(adId) {
    if (!adId || !/^\d+$/.test(adId)) return;
    if (window.__akmezLastResolvedAd === adId) return;
    window.__akmezLastResolvedAd = adId;
    chrome.runtime.sendMessage({ action: 'resolveAdProduct', adId }, resp => {
      if (chrome.runtime.lastError) return;
      if (!resp || !resp.success || !resp.product) return;
      // Only add if this ad id is still the one shown (conversation may have changed)
      if (fields.adid.input.value !== adId) return;
      // Match against a loaded product so the cart id lines up with the picker
      const match = products.find(p => p.id === resp.product.id);
      if (!match) return;
      if (!cart[match.id]) {
        cart[match.id] = 1;
        updateCart();
        toast('Product linked from Ad ID: ' + match.name);
      }
    });
  }

  prodInput.addEventListener('input', showProdSuggestions);
  prodInput.addEventListener('focus', showProdSuggestions);
  prodInput.addEventListener('blur', () => setTimeout(() => { prodSuggest.style.display = 'none'; }, 150));
  prodInput.addEventListener('keydown', e => {
    const open = prodSuggest.style.display === 'block' && prodMatches.length;
    if (e.key === 'ArrowDown') {
      if (!open) { showProdSuggestions(); return; }
      e.preventDefault();
      prodActive = (prodActive + 1) % prodMatches.length;
      paintProdActive();
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      prodActive = (prodActive - 1 + prodMatches.length) % prodMatches.length;
      paintProdActive();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (open && prodActive >= 0) {
        if (e.key === 'Enter') e.preventDefault();
        pickProduct(prodActive);
      }
    } else if (e.key === 'Escape') {
      prodSuggest.style.display = 'none';
    }
  });

  // Reset the returned-product selection for this fresh form, and let updateCart
  // (module scope) refresh the trade-in difference hint whenever the cart changes.
  window.__akmezOldProduct = null;
  window.__akmezDeliveredOk = false;
  window.__akmezDeliveredState = 'idle';
  window.__akmezOnCartChange = updateOldProdHint;
  updateSalesTypeUI();
  updateCart();
  document.getElementById('ak-submit').onclick = submitOrder;

  // Ad ID stays hidden (auto-captured in the background); agent can reveal it if needed
  const adidToggle = document.getElementById('ak-adid-toggle');
  const adidRow = document.getElementById('ak-adid-row');
  adidToggle.onclick = () => {
    const show = adidRow.style.display === 'none';
    adidRow.style.display = show ? '' : 'none';
    adidToggle.textContent = show ? 'Hide Ad ID' : 'Show Ad ID (auto-captured)';
  };

  // Region autocomplete - type-to-search with full keyboard navigation
  const regionInput = document.getElementById('ak-region');
  const regionSuggest = document.getElementById('ak-region-suggest');
  let regionMatches = [];   // currently shown regions
  let regionActive = -1;    // index of the highlighted suggestion

  // Rank: prefix matches first (Cur -> Curepipe before Cite la Cure), then other contains
  function rankRegions(q) {
    if (!q) return regions.slice(0, 8);
    const starts = [], contains = [];
    for (const r of regions) {
      const l = r.toLowerCase();
      if (l.startsWith(q)) starts.push(r);
      else if (l.includes(q)) contains.push(r);
    }
    return starts.concat(contains).slice(0, 8);
  }

  function paintActive() {
    regionSuggest.querySelectorAll('.akmez-suggest-item').forEach((el, i) => {
      el.classList.toggle('active', i === regionActive);
      if (i === regionActive) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function showRegionSuggestions() {
    const q = regionInput.value.toLowerCase().trim();
    regionMatches = rankRegions(q);
    if (!regionMatches.length) { regionSuggest.style.display = 'none'; return; }
    // Highlight the first match by default so Enter/Tab accepts it immediately
    regionActive = 0;
    regionSuggest.innerHTML = regionMatches.map((r, i) => {
      const d = regionDelivery[r];
      const tag = d ? `<span class="akmez-suggest-contractor">${String(d.contractor).replace(/</g, '&lt;')}</span>` : '';
      return `<div class="akmez-suggest-item${i === 0 ? ' active' : ''}" data-i="${i}">${r.replace(/</g, '&lt;')}${tag}</div>`;
    }).join('');
    regionSuggest.style.display = 'block';
    regionSuggest.querySelectorAll('.akmez-suggest-item').forEach(it => {
      // mousedown fires before blur so the value is set before the list hides
      it.onmousedown = e => { e.preventDefault(); selectRegion(parseInt(it.dataset.i, 10)); };
    });
  }

  function selectRegion(i) {
    if (i < 0 || i >= regionMatches.length) return;
    regionInput.value = regionMatches[i];
    regionSuggest.style.display = 'none';
    regionActive = -1;
    updateRegionDelivery();
  }

  // Show which contractor/rider is assigned to deliver the chosen region
  function updateRegionDelivery() {
    const box = document.getElementById('ak-region-delivery');
    if (!box) return;
    const val = (regionInput.value || '').trim().toLowerCase();
    let info = null;
    if (val) {
      for (const name in regionDelivery) {
        if (name.toLowerCase() === val) { info = regionDelivery[name]; break; }
      }
    }
    if (info) {
      box.innerHTML = '&#128666; Delivered by: <b>' + String(info.contractor).replace(/</g, '&lt;') + '</b>'
        + (info.rider ? ' &middot; Rider: <b>' + String(info.rider).replace(/</g, '&lt;') + '</b>' : '');
      box.style.display = 'block';
    } else if (val && regions.some(r => r.toLowerCase() === val)) {
      box.innerHTML = '&#9888;&#65039; No contractor assigned to this region yet';
      box.className = 'akmez-region-delivery warn';
      box.style.display = 'block';
      return;
    } else {
      box.style.display = 'none';
    }
    box.className = 'akmez-region-delivery';
  }

  regionInput.addEventListener('input', () => { showRegionSuggestions(); updateRegionDelivery(); });
  regionInput.addEventListener('focus', showRegionSuggestions);
  regionInput.addEventListener('blur', () => setTimeout(() => { regionSuggest.style.display = 'none'; }, 150));
  regionInput.addEventListener('keydown', e => {
    const open = regionSuggest.style.display === 'block' && regionMatches.length;
    if (e.key === 'ArrowDown') {
      if (!open) { showRegionSuggestions(); return; }
      e.preventDefault();
      regionActive = (regionActive + 1) % regionMatches.length;
      paintActive();
    } else if (e.key === 'ArrowUp') {
      if (!open) return;
      e.preventDefault();
      regionActive = (regionActive - 1 + regionMatches.length) % regionMatches.length;
      paintActive();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      // Accept the highlighted match; Enter stays in the form, Tab moves on
      if (open && regionActive >= 0) {
        if (e.key === 'Enter') e.preventDefault();
        selectRegion(regionActive);
      }
    } else if (e.key === 'Escape') {
      regionSuggest.style.display = 'none';
    }
  });

  // Delivery date - default to next working day (or +1 after cut-off), block Sundays + holidays
  const dateInput = document.getElementById('ak-date');
  dateInput.min = ymd(new Date());
  // Show the climate emoji + any cyclone-season note for the chosen delivery day
  function updateDeliveryInfo() {
    const box = document.getElementById('ak-delivery-info');
    if (!box || !dateInput.value) { if (box) box.style.display = 'none'; return; }
    const d = new Date(dateInput.value + 'T00:00:00');
    const w = weatherForDate(d);
    const cyclone = isCycloneSeason(d);
    const bits = [];
    if (w) bits.push(`<span class="akmez-di-weather">${w.emoji} ${statsEsc(w.label || 'Forecast')}</span>`);
    if (cyclone) bits.push('<span class="akmez-di-cyclone" title="Mauritius cyclone season (Nov-Apr): deliveries may be disrupted by weather">\uD83C\uDF00 Cyclone season</span>');
    if (!bits.length) { box.style.display = 'none'; return; }
    box.innerHTML = bits.join('');
    box.style.display = 'flex';
    box.classList.toggle('cyclone', cyclone);
  }
  getCutoff((cutoff, scheme) => {
    computeDefaultDeliveryDate(cutoff, scheme, (d, afterCutoff, fromScheme) => {
      dateInput.value = ymd(d);
      if (fromScheme) toast('Delivery date set to ' + ymd(d));
      else if (afterCutoff) toast('After ' + cutoff + ' cut-off - delivery set to ' + ymd(d));
      updateDeliveryInfo();
    });
  });
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const picked = new Date(dateInput.value + 'T00:00:00');
    if (isNonWorking(picked)) {
      const fixed = nextWorkingOnOrAfter(picked);
      dateInput.value = ymd(fixed);
      const h = holidayForDate(picked);
      const why = picked.getDay() === 0 ? 'Sundays' : (h && h.label ? h.label : 'non-delivery days');
      toast('No deliveries on ' + why + ' - moved to ' + ymd(fixed));
    }
    updateDeliveryInfo();
  });
  updateDeliveryInfo();
}

// Compute the total price for `q` units of product `p`, honouring inventory
// pricing rules so the extension always matches the admin inventory:
//   - B1G1 (buy one get one free): the free unit is bonus stock, NOT a price
//     discount, so the client pays full unit price for every unit ordered.
//   - Bundle prices e.g. { "2": 775 }: "2 for 775". Uses DP to find the
//     cheapest combination of bundles + singles for the chosen quantity.
function akmezPriceFor(p, q) {
  q = Math.max(0, parseInt(q, 10) || 0);
  if (q === 0 || !p) return 0;
  const unit = parseFloat(p.price) || 0;
  // Note: B1G1 does NOT discount the price - the free unit is bonus stock
  // shipped, so the client still pays full unit price for every unit ordered.
  const bp = p.bundle_prices && typeof p.bundle_prices === 'object' ? p.bundle_prices : null;
  if (bp) {
    const tiers = Object.keys(bp)
      .map(k => ({ n: parseInt(k, 10), price: parseFloat(bp[k]) }))
      .filter(t => t.n > 0 && t.price > 0);
    if (tiers.length) {
      const cost = new Array(q + 1).fill(Infinity);
      cost[0] = 0;
      for (let i = 1; i <= q; i++) {
        cost[i] = cost[i - 1] + unit; // one more at unit price
        for (const t of tiers) {
          if (t.n <= i && cost[i - t.n] + t.price < cost[i]) cost[i] = cost[i - t.n] + t.price;
        }
      }
      if (isFinite(cost[q])) return cost[q];
    }
  }
  return unit * q;
}

// A short label describing the active offer, shown as a badge
function akmezOfferLabel(p) {
  if (!p) return '';
  if (p.is_b1g1) return 'B1G1';
  const bp = p.bundle_prices && typeof p.bundle_prices === 'object' ? p.bundle_prices : null;
  if (bp) {
    const keys = Object.keys(bp).map(k => parseInt(k, 10)).filter(n => n > 0).sort((a, b) => a - b);
    if (keys.length) { const n = keys[0]; return n + ' for Rs' + Math.round(parseFloat(bp[String(n)])); }
  }
  return '';
}

// Fullscreen image preview so agents can inspect the product photo
function akmezShowImage(src, name) {
  if (!src) return;
  let ov = document.getElementById('akmez-img-overlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'akmez-img-overlay';
    ov.innerHTML = '<div class="akmez-img-box"><img alt=""><div class="akmez-img-cap"></div><button class="akmez-img-close" title="Close">&times;</button></div>';
    document.body.appendChild(ov);
    const close = () => { ov.style.display = 'none'; };
    ov.addEventListener('click', e => { if (e.target === ov || e.target.classList.contains('akmez-img-close')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }
  ov.querySelector('img').src = src;
  ov.querySelector('.akmez-img-cap').textContent = name || '';
  ov.style.display = 'flex';
}

// Floating preview shown while the mouse hovers a product thumbnail
let __akmezHover = null;
function akmezHoverShow(el) {
  const src = el.getAttribute('data-img');
  if (!src) return;
  if (!__akmezHover) {
    __akmezHover = document.createElement('div');
    __akmezHover.id = 'akmez-hover-preview';
    __akmezHover.innerHTML = '<img alt="">';
    document.body.appendChild(__akmezHover);
  }
  __akmezHover.querySelector('img').src = src;
  const r = el.getBoundingClientRect();
  const size = 220;
  // Prefer showing to the left of the widget/thumbnail; clamp to viewport
  let left = r.left - size - 12;
  if (left < 8) left = Math.min(r.right + 12, window.innerWidth - size - 8);
  let top = r.top + r.height / 2 - size / 2;
  top = Math.max(8, Math.min(top, window.innerHeight - size - 8));
  __akmezHover.style.left = left + 'px';
  __akmezHover.style.top = top + 'px';
  __akmezHover.style.display = 'block';
}
function akmezHoverHide() {
  if (__akmezHover) __akmezHover.style.display = 'none';
}
// Delegated hover handling covers both search results and cart thumbnails
document.addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('.akmez-suggest-thumb[data-img],.akmez-cart-thumb[data-img]');
  if (t) akmezHoverShow(t);
});
document.addEventListener('mouseout', e => {
  const t = e.target.closest && e.target.closest('.akmez-suggest-thumb[data-img],.akmez-cart-thumb[data-img]');
  if (t) akmezHoverHide();
});

// Small helper to render a product thumbnail (or a placeholder square)
function akmezThumb(p, cls) {
  const url = p && p.image_url ? p.image_url : '';
  if (url) return '<img src="' + url + '" alt="" class="' + cls + '" data-img="' + url.replace(/"/g, '&quot;') + '">';
  return '<span class="' + cls + ' placeholder"></span>';
}

// Resolve a cart key into its product + chosen variant. Cart keys are either a
// plain product id, or "productId::variantId" when the agent picked a variety
// (e.g. a colour). Returns a pricing-ready product object: when the variant has
// its own price_override we use it as the unit price and drop bundle/B1G1 offers
// (variant-specific pricing), otherwise the base product pricing applies.
function akmezCartResolve(key) {
  const str = String(key);
  const sep = str.indexOf('::');
  const pid = sep === -1 ? str : str.slice(0, sep);
  const vid = sep === -1 ? '' : str.slice(sep + 2);
  const p = products.find(x => x.id === pid);
  if (!p) return null;
  let variant = null;
  if (vid && Array.isArray(p.variants)) variant = p.variants.find(v => v.id === vid) || null;
  let priced = p;
  const hasOverride = variant && variant.price_override != null && variant.price_override !== '';
  if (hasOverride) {
    priced = Object.assign({}, p, { price: variant.price_override, bundle_prices: null, is_b1g1: false });
  }
  const label = variant ? (p.name + ' - ' + variant.attribute_value) : p.name;
  return { p, variant, priced, label };
}

function updateCart() {
  const c = document.getElementById('ak-cart');
  const list = document.getElementById('ak-cart-list');
  if (!c || !list) return;
  const entries = Object.entries(cart).filter(([,q]) => q > 0);
  if (!entries.length) {
    c.style.display = 'none';
    list.innerHTML = '';
    if (typeof window.__akmezOnCartChange === 'function') window.__akmezOnCartChange();
    return;
  }

  let qty = 0, amt = 0;
  // Render each selected product with quantity controls
  list.innerHTML = entries.map(([id, q]) => {
    const r = akmezCartResolve(id);
    if (!r) return '';
    const priced = r.priced;
    qty += q;
    const unit = parseFloat(priced.price) || 0;
    const line = akmezPriceFor(priced, q);   // price after B1G1 / bundle rules
    const listTotal = unit * q;              // price with no offer
    amt += line;
    const offer = akmezOfferLabel(priced);
    const saved = listTotal - line;
    // Show the discounted line total, with the struck-through list price + offer
    const priceHtml = saved > 0.5
      ? `Rs ${line.toFixed(0)} <s>Rs ${listTotal.toFixed(0)}</s>${offer ? ` <span class="akmez-offer-badge">${offer}</span>` : ''}`
      : `Rs ${line.toFixed(0)}`;
    // For variants show the attribute (e.g. colour) as a small chip under the name
    const varTag = r.variant ? ` <span class="akmez-var-tag">${String(r.variant.attribute_value).replace(/</g, '&lt;')}</span>` : '';
    return `
      <div class="akmez-cart-item" data-id="${id}">
        ${akmezThumb(r.p, 'akmez-cart-thumb')}
        <div class="akmez-cart-item-info">
          <div class="akmez-cart-item-name">${r.p.name.replace(/</g, '&lt;')}${varTag}</div>
          <div class="akmez-cart-item-price">${priceHtml}</div>
        </div>
        <div class="akmez-qty">
          <button class="akmez-qty-btn" data-act="dec" data-id="${id}">-</button>
          <span class="akmez-qty-val">${q}</span>
          <button class="akmez-qty-btn" data-act="inc" data-id="${id}">+</button>
          <button class="akmez-qty-btn akmez-qty-del" data-act="del" data-id="${id}" title="Remove">&times;</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.akmez-qty-btn').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.id;
      if (b.dataset.act === 'inc') cart[id] = (cart[id] || 0) + 1;
      else if (b.dataset.act === 'dec') cart[id] = Math.max(0, (cart[id] || 0) - 1);
      else if (b.dataset.act === 'del') cart[id] = 0;
      updateCart();
    };
  });

  // Clicking a cart thumbnail enlarges the product photo
  list.querySelectorAll('.akmez-cart-thumb[data-img]').forEach(img => {
    img.onclick = () => akmezShowImage(img.getAttribute('data-img'), '');
  });

  c.style.display = 'flex';
  c.querySelector('.items').textContent = qty + ' item' + (qty !== 1 ? 's' : '');
  c.querySelector('.total').textContent = 'Rs ' + amt.toFixed(0);

  // Keep the Trade In price-difference hint in sync with the cart total
  if (typeof window.__akmezOnCartChange === 'function') window.__akmezOnCartChange();
}

function submitOrder() {
  const name = document.getElementById('ak-name').value.trim();
  const c1 = document.getElementById('ak-c1').value.trim();
  const c2 = document.getElementById('ak-c2').value.trim();
  const region = document.getElementById('ak-region').value;
  const date = document.getElementById('ak-date').value;
  const adId = document.getElementById('ak-adid').value.trim();
  const err = document.getElementById('ak-err');
  const btn = document.getElementById('ak-submit');
  
  err.style.display = 'none';
  
  if (!name || !c1 || !region || !date) {
    err.textContent = 'Please fill all required fields';
    err.style.display = 'block';
    return;
  }
  
  if (isNonWorking(new Date(date + 'T00:00:00'))) {
    err.textContent = 'No deliveries on Sundays or public holidays. Pick another date.';
    err.style.display = 'block';
    return;
  }

  const entries = Object.entries(cart).filter(([,q]) => q > 0);
  if (!entries.length) {
    err.textContent = 'Please select at least one product';
    err.style.display = 'block';
    return;
  }
  
  btn.disabled = true;
  btn.textContent = 'Creating...';
  
  // Build one line per product so the server can create a separate delivery
  // entry for each. Each carries its own name (with B1G1 flag), quantity and
  // line amount (after B1G1 / bundle pricing).
  const productLines = entries.map(([key, q]) => {
    const r = akmezCartResolve(key);
    if (!r) return null;
    // r.label already includes the chosen variety (e.g. "M8 Smartband - Red").
    // Flag B1G1 so the picking list shows the offer.
    return {
      name: r.priced.is_b1g1 ? r.label + ' - B1G1' : r.label,
      qty: q,
      amount: akmezPriceFor(r.priced, q),
    };
  }).filter(Boolean);

  // Aggregate string / totals kept for Exchange & Trade In (order-level amount)
  const prods = productLines.map(l => l.name).join(', ');
  let qty = 0, amt = 0;
  productLines.forEach(l => { qty += l.qty; amt += l.amount; });
  
  // The detected page's code becomes the order's MEDIUM (e.g. MBM / DBM),
  // matching the import sheet. Falls back to "Extension" server-side if unknown.
  const pageCode = (window.__akmezDetectedPage && window.__akmezDetectedPage.code) || null;

  // Selected sales type pill (sale / exchange / trade_in / refund / drop_off)
  const stActive = document.querySelector('#ak-salestype .akmez-st-pill.active');
  const salesType = stActive ? stActive.dataset.st : 'sale';

  // Agent-typed note (shown for every sales type). Merged with any auto-generated
  // exchange / trade-in note below.
  const agentNote = (document.getElementById('ak-notes')?.value || '').trim();

  // Exchange / Trade In carry the returned product (in notes + return_product)
  // and adjust the amount charged.
  let notes = agentNote || null;
  let returnProduct = null;
  if (salesType === 'exchange' || salesType === 'trade_in') {
    // Gate: only genuine past customers (with a delivered order) may exchange / trade in
    if (window.__akmezDeliveredOk !== true) {
      const kind = salesType === 'exchange' ? 'Exchange' : 'Trade In';
      err.textContent = window.__akmezDeliveredState === 'loading'
        ? 'Still verifying the delivery history, please wait a moment...'
        : 'This client has no delivered order in our database - ' + kind + ' is only allowed for past customers.';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Order';
      return;
    }
    const oldP = window.__akmezOldProduct;
    if (!oldP || !oldP.name) {
      err.textContent = salesType === 'exchange'
        ? 'Select the defective product being returned'
        : 'Select the product the client is trading in';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Order';
      return;
    }
    returnProduct = oldP.name;
    if (salesType === 'exchange') {
      // Defective unit swapped for the same product - no charge
      amt = 0;
      notes = 'Exchange (defective) - returned: ' + oldP.name;
    } else {
      // Trade In - client pays only the price difference (never negative)
      const oldPrice = parseFloat(oldP.price) || 0;
      const diff = Math.max(0, amt - oldPrice);
      amt = diff;
      notes = 'Trade In - returned: ' + oldP.name + ' (Rs ' + oldPrice.toFixed(0) + ')'
        + (diff > 0 ? ' | difference paid: Rs ' + diff.toFixed(0) : ' | no difference');
    }
    // Keep the agent's own note alongside the auto-generated return note
    if (agentNote) notes = agentNote + ' | ' + notes;
  }

  chrome.runtime.sendMessage({
    action: 'createOrder',
    data: { customerName: name, contact1: c1, contact2: c2, region, deliveryDate: date, products: prods, qty, amount: amt, productLines, adId, pageCode, salesType, notes, returnProduct }
  }, response => {
    if (!response || !response.success) {
      err.textContent = 'Connection failed';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Order';
      return;
    }
    
    const data = response.data;
    if (data.error) {
      err.textContent = data.error;
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Order';
      return;
    }
    
    const entryCount = data.entryCount || 1;
    // Proforma invoice link(s) returned by the server - the same public page the
    // rider shares: it shows a Proforma now and becomes an Invoice once delivered.
    const links = Array.isArray(data.proformaLinks) ? data.proformaLinks : [];
    const proformaHtml = links.length ? `
      <div class="akmez-proforma">
        <div class="akmez-proforma-title">&#128196; Proforma Invoice${links.length > 1 ? 's' : ''}</div>
        ${links.map((l, i) => `
          <div class="akmez-proforma-item">
            ${links.length > 1 ? `<div class="akmez-proforma-prod">${statsEsc(l.products || ('Entry ' + (i + 1)))}</div>` : ''}
            <div class="akmez-proforma-actions">
              <button class="akmez-pf-copy" data-url="${statsEsc(l.url)}">Copy Link</button>
              <a class="akmez-pf-open" href="${statsEsc(l.url)}" target="_blank" rel="noopener">Open</a>
            </div>
          </div>
        `).join('')}
        <div class="akmez-proforma-hint">Share with the customer as their proforma. It turns into an invoice automatically once the order is delivered.</div>
      </div>
    ` : '';
    document.getElementById('akmez-body').innerHTML = `
      <div class="akmez-success">
        <div class="check">&#10003;</div>
        <h3>Order Created!</h3>
        <p>${statsEsc(name)}${entryCount > 1 ? ` &middot; ${entryCount} separate entries` : ''}</p>
        ${proformaHtml}
        <button id="ak-new">New Order</button>
      </div>
    `;
    // Wire copy buttons (clipboard with a graceful fallback)
    document.querySelectorAll('.akmez-pf-copy').forEach(b => {
      b.onclick = () => {
        const url = b.dataset.url;
        const done = () => { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy Link'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta); ta.select();
            try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
            document.body.removeChild(ta);
          });
        } else {
          const ta = document.createElement('textarea');
          ta.value = url; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
          document.body.removeChild(ta);
        }
      };
    });
    document.getElementById('ak-new').onclick = () => {
      cart = {};
      renderOrdersForm();
    };
  });
}

// Escape untrusted text before injecting into innerHTML
function statsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Human-friendly "Xh Ym" from seconds
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

// Short time e.g. "09:42"
function shortTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const STATS_STATUS_LABELS = {
  pending: 'Pending', assigned: 'Assigned', dispatched: 'Dispatched',
  delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned',
};

// Render the "My Stats" tab: today's metrics + 30-day client search engine
function renderMyStats() {
  const body = document.getElementById('akmez-body');
  body.innerHTML = '<div class="akmez-loading"><div class="akmez-spinner"></div></div>';

  chrome.runtime.sendMessage({ action: 'getMyStats', q: statsSearchTerm }, resp => {
    if (!resp || !resp.success || !resp.data) {
      body.innerHTML = '<div class="stats-empty">Could not load stats. Please try again.</div>';
      return;
    }
    if (resp.data.authenticated === false) {
      body.innerHTML = '<div class="stats-empty">Please sign in to view your stats.</div>';
      return;
    }
    const t = resp.data.today || {};
    const clients = resp.data.clients || [];
    // Orders the signed-in agent may edit (they created them and the order is
    // still pending/assigned), keyed by order id for the Edit buttons below.
    const editMap = {};
    clients.forEach(c => { if (c.last_editable && c.last_id) editMap[c.last_id] = c; });

    const fmtMoney = v => (v == null || isNaN(v)) ? '-' : 'Rs ' + Number(v).toFixed(0);
    const fmtDay = iso => {
      if (!iso) return '-';
      const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
      return isNaN(d) ? '-' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    };
    // A detail cell shown only when it has a value
    const cell = (label, value) => value ? `<div class="stats-cell"><span class="stats-cell-lbl">${label}</span><span class="stats-cell-val">${statsEsc(value)}</span></div>` : '';

    const clientRows = !statsSearchTerm
      ? `<div class="stats-empty">&#128269; Search by name or phone to find a client from the last 30 days.</div>`
      : clients.length === 0
      ? `<div class="stats-empty">No clients match your search.</div>`
      : clients.map(c => {
          const statusKey = c.last_status || 'pending';
          const statusLabel = STATS_STATUS_LABELS[statusKey] || statusKey;
          const delivered = statusKey === 'delivered';
          // Same public link: proforma before delivery, invoice/receipt after
          const docLabel = delivered ? '\uD83E\uDDFE Invoice / Receipt' : '\uD83D\uDCC4 Proforma Invoice';
          const docHtml = c.proforma_url ? `
            <div class="stats-doc">
              <span class="stats-doc-title">${docLabel}</span>
              <div class="stats-doc-actions">
                <button class="stats-doc-copy akmez-pf-copy" data-url="${statsEsc(c.proforma_url)}">Copy Link</button>
                <a class="stats-doc-open" href="${statsEsc(c.proforma_url)}" target="_blank" rel="noopener">Open</a>
              </div>
            </div>` : '';
          const phones = [c.contact_1, c.contact_2].filter(Boolean).map(p => statsEsc(p)).join(' / ');
          // Build the detail grid explicitly (cell() hides empty ones)
          const grid = [
            cell('Phone', phones || ''),
            cell('Region', c.locality || ''),
            cell('Route', c.rte || ''),
            cell('Delivery', c.last_delivery_date ? fmtDay(c.last_delivery_date) : ''),
            cell('Qty', c.last_qty != null ? String(c.last_qty) : ''),
            cell('Last amount', c.last_amount != null ? fmtMoney(c.last_amount) : ''),
            cell('Total spent', c.total_amount ? fmtMoney(c.total_amount) : ''),
            cell('Orders', c.order_count > 1 ? String(c.order_count) : ''),
            cell('Type', c.last_sales_type && c.last_sales_type !== 'sale' ? c.last_sales_type.replace('_', ' ') : ''),
            cell('Source', c.medium || ''),
            cell('Ad ID', c.ad_id || ''),
          ].join('');
          return `
            <div class="stats-client" ${c.last_editable && c.last_id ? `data-cid="${statsEsc(c.last_id)}"` : ''}>
              <div class="stats-client-top">
                <span class="stats-client-name">${statsEsc(c.customer_name)}</span>
                <span class="stats-client-top-right">
                  ${c.last_editable && c.last_id ? `<button class="stats-edit-btn" data-eid="${statsEsc(c.last_id)}" title="Edit this entry" aria-label="Edit this entry">&#9998; Edit</button>` : ''}
                  <span class="stats-badge ${statsEsc(statusKey)}">${statsEsc(statusLabel)}</span>
                </span>
              </div>
              ${c.last_products ? `<div class="stats-client-prod">${statsEsc(c.last_products)}</div>` : ''}
              ${docHtml}
              <div class="stats-grid">${grid}</div>
              ${c.last_return_product ? `<div class="stats-note"><strong>Returned:</strong> ${statsEsc(c.last_return_product)}</div>` : ''}
              ${c.last_notes ? `<div class="stats-note"><strong>Notes:</strong> ${statsEsc(c.last_notes)}</div>` : ''}
            </div>`;
        }).join('');

    body.innerHTML = `
      <div class="stats-metrics">
        <div class="stats-card">
          <div class="stats-card-val">${statsEsc(t.totalClients || 0)}</div>
          <div class="stats-card-lbl">Clients Today</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-val">${statsEsc(formatDuration(t.workingSeconds || 0))}</div>
          <div class="stats-card-lbl">Working Time</div>
        </div>
        <div class="stats-card">
          <div class="stats-card-val">${statsEsc(t.avgClientsPerHour || 0)}</div>
          <div class="stats-card-lbl">Clients / Hour</div>
        </div>
      </div>
      <div class="stats-window">
        ${t.firstEntry ? `First entry ${statsEsc(shortTime(t.firstEntry))} &middot; Last entry ${statsEsc(shortTime(t.lastEntry))} &middot; ${statsEsc(t.totalEntries || 0)} entries` : 'No entries made yet today'}
      </div>
      <div class="stats-search-wrap">
        <input type="text" id="stats-search" class="stats-search" placeholder="Search clients (last 30 days) by name or phone..." value="${statsEsc(statsSearchTerm)}" autocomplete="off">
      </div>
      <div class="stats-list" id="stats-list">${clientRows}</div>
    `;

    const searchInput = document.getElementById('stats-search');
    // Keep focus + caret at end after re-render when typing
    if (statsSearchTerm) {
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }
    searchInput.addEventListener('input', e => {
      statsSearchTerm = e.target.value;
      if (statsSearchTimer) clearTimeout(statsSearchTimer);
      // Debounce so we don't hit the server on every keystroke
      statsSearchTimer = setTimeout(() => renderMyStats(), 350);
    });

    // Copy proforma/invoice link buttons on each client card
    body.querySelectorAll('.akmez-pf-copy').forEach(b => {
      b.onclick = () => {
        const url = b.dataset.url;
        const done = () => { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy Link'; }, 1500); };
        const fallback = () => {
          const ta = document.createElement('textarea');
          ta.value = url; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
          document.body.removeChild(ta);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(fallback);
        } else { fallback(); }
      };
    });

    // Edit buttons: swap the client card for an inline edit form (only shown
    // on entries this agent created that are still pending/assigned)
    body.querySelectorAll('.stats-edit-btn').forEach(btn => {
      btn.onclick = () => {
        const c = editMap[btn.dataset.eid];
        const card = btn.closest('.stats-client');
        if (c && card) statsRenderEditForm(card, c);
      };
    });
  });
}

// Inline edit form for an agent's own entry. Saves via the updateOrder action
// (server re-checks ownership + status), then reloads the stats list.
function statsRenderEditForm(card, c) {
  const val = v => statsEsc(v == null ? '' : v);
  const dateVal = c.last_delivery_date ? String(c.last_delivery_date).slice(0, 10) : '';
  card.innerHTML = `
    <div class="stats-edit-form">
      <div class="stats-edit-title">&#9998; Edit entry &middot; ${statsEsc(c.customer_name)}</div>
      <div class="akmez-label">Name *</div>
      <input class="akmez-input se-name" type="text" value="${val(c.customer_name)}" style="padding-right:12px;">
      <div class="stats-edit-row">
        <div style="flex:1;min-width:0;">
          <div class="akmez-label">Contact 1 *</div>
          <input class="akmez-input se-c1" type="text" value="${val(c.contact_1)}" style="padding-right:12px;">
        </div>
        <div style="flex:1;min-width:0;">
          <div class="akmez-label">Contact 2</div>
          <input class="akmez-input se-c2" type="text" value="${val(c.contact_2)}" style="padding-right:12px;">
        </div>
      </div>
      <div class="stats-edit-row">
        <div style="flex:1;min-width:0;">
          <div class="akmez-label">Region *</div>
          <input class="akmez-input se-region" type="text" value="${val(c.locality)}" style="padding-right:12px;">
        </div>
        <div style="flex:1;min-width:0;">
          <div class="akmez-label">Delivery date *</div>
          <input class="akmez-input se-date" type="date" value="${val(dateVal)}" style="padding-right:12px;">
        </div>
      </div>
      <div class="akmez-label">Products *</div>
      <input class="akmez-input se-products" type="text" value="${val(c.last_products)}" style="padding-right:12px;">
      <div class="stats-edit-row">
        <div style="flex:1;min-width:0;">
          <div class="akmez-label">Qty *</div>
          <input class="akmez-input se-qty" type="number" min="1" step="1" value="${val(c.last_qty != null ? c.last_qty : 1)}" style="padding-right:12px;">
        </div>
        <div style="flex:1;min-width:0;">
          <div class="akmez-label">Amount (Rs) *</div>
          <input class="akmez-input se-amount" type="number" min="0" step="0.01" value="${val(c.last_amount != null ? c.last_amount : '')}" style="padding-right:12px;">
        </div>
      </div>
      <div class="akmez-label">Notes</div>
      <textarea class="akmez-input se-notes" rows="2" style="padding-right:12px;resize:vertical;">${val(c.last_notes)}</textarea>
      <div class="stats-edit-err" style="display:none;"></div>
      <div class="stats-edit-actions">
        <button class="stats-edit-cancel">Cancel</button>
        <button class="stats-edit-save">Save Changes</button>
      </div>
    </div>
  `;
  const q = sel => card.querySelector(sel);
  q('.stats-edit-cancel').onclick = () => renderMyStats();
  q('.stats-edit-save').onclick = () => {
    const err = q('.stats-edit-err');
    err.style.display = 'none';
    const name = q('.se-name').value.trim();
    const c1 = q('.se-c1').value.trim();
    const region = q('.se-region').value.trim();
    const date = q('.se-date').value;
    const products = q('.se-products').value.trim();
    const qty = parseInt(q('.se-qty').value, 10);
    const amount = parseFloat(q('.se-amount').value);
    if (!name || !c1 || !region || !date || !products || !(qty > 0) || !(amount >= 0)) {
      err.textContent = 'Please fill all required fields correctly';
      err.style.display = 'block';
      return;
    }
    const saveBtn = q('.stats-edit-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    chrome.runtime.sendMessage({
      action: 'updateOrder',
      data: {
        id: c.last_id,
        customerName: name,
        contact1: c1,
        contact2: q('.se-c2').value.trim(),
        region,
        deliveryDate: date,
        products,
        qty,
        amount,
        notes: q('.se-notes').value.trim(),
      }
    }, resp => {
      const data = resp && resp.data;
      if (!resp || !resp.success || !data || data.success !== true) {
        err.textContent = (data && data.error) || (resp && resp.error) || 'Failed to save changes';
        err.style.display = 'block';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
        return;
      }
      toast('Entry updated!');
      renderMyStats();
    });
  };
}

// Render working time panel
function renderWorktime() {
  const body = document.getElementById('akmez-body');
  const { isClockedIn, clockInTime, todayHours, history } = worktimeData;
  
  body.innerHTML = `
    <div class="wt-panel">
      <div class="wt-status ${isClockedIn ? '' : 'out'}">
        <span class="dot"></span>
        <span class="text">${isClockedIn ? 'Clocked In' : 'Clocked Out'}</span>
      </div>
      <div class="wt-timer" id="wt-timer">${formatTime(isClockedIn && clockInTime ? (Date.now() - new Date(clockInTime).getTime()) / 1000 : todayHours * 3600)}</div>
      <div class="wt-info">Today: <span id="wt-today">${todayHours.toFixed(2)} hours</span></div>
      <button class="wt-btn ${isClockedIn ? 'out' : 'in'}" id="wt-btn">${isClockedIn ? 'Clock Out' : 'Clock In'}</button>
      ${history && history.length ? `
        <div class="wt-history">
          <h4>Recent Activity</h4>
          ${history.slice(0, 5).map(h => `
            <div class="wt-history-item">
              <span class="date">${h.date}</span>
              <span class="hours">${h.hours}h</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
  
  // Clock button - no PIN needed, the agent is already signed in
  document.getElementById('wt-btn').onclick = () => {
    const btn = document.getElementById('wt-btn');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    
    chrome.runtime.sendMessage({
      action: isClockedIn ? 'clockOut' : 'clockIn'
    }, response => {
      if (response && response.success) {
        worktimeData = response.data || worktimeData;
        worktimeData.isClockedIn = !isClockedIn;
        if (!isClockedIn) worktimeData.clockInTime = new Date().toISOString();
        toast(isClockedIn ? 'Clocked out!' : 'Clocked in!');
        renderWorktime();
      } else {
        toast(response?.error || 'Failed');
        btn.disabled = false;
        btn.textContent = isClockedIn ? 'Clock Out' : 'Clock In';
      }
    });
  };
  
  // Timer update
  if (timerInterval) clearInterval(timerInterval);
  if (isClockedIn && clockInTime) {
    timerInterval = setInterval(() => {
      const el = document.getElementById('wt-timer');
      // Stop ticking if the agent has left the Working Time tab (element is gone)
      if (!el) { clearInterval(timerInterval); timerInterval = null; return; }
      const elapsed = (Date.now() - new Date(clockInTime).getTime()) / 1000;
      el.textContent = formatTime(elapsed);
    }, 1000);
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Text selection popup (C1 / C2 quick-fill)
const sel = document.createElement('div');
sel.id = 'akmez-sel';
sel.innerHTML = '<button data-f="c1">C1</button><button data-f="c2">C2</button>';
document.body.appendChild(sel);

// Show the toolbar next to the current text selection, if any
function showSelToolbar() {
  const s = window.getSelection(), t = s && s.toString().trim();
  if (t && t.length > 0 && t.length < 200 && s.rangeCount) {
    const r = s.getRangeAt(0).getBoundingClientRect();
    sel.style.display = 'flex';
    sel.style.left = Math.max(10, r.left) + 'px';
    sel.style.top = (r.bottom + 8) + 'px';
    sel.dataset.text = t;
  } else {
    sel.style.display = 'none';
  }
}

// Trigger on both normal selection (mouseup) and double-click (word select)
document.addEventListener('mouseup', e => {
  if (e.target.closest('#akmez-sel,#akmez-widget')) return;
  setTimeout(showSelToolbar, 10);
});
document.addEventListener('dblclick', e => {
  if (e.target.closest('#akmez-sel,#akmez-widget')) return;
  setTimeout(showSelToolbar, 10);
});

document.addEventListener('mousedown', e => {
  if (!e.target.closest('#akmez-sel')) {
    setTimeout(() => sel.style.display = 'none', 100);
  }
});

sel.onclick = async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const t = sel.dataset.text;
  if (t) {
    await navigator.clipboard.writeText(t);
    const inp = document.getElementById('ak-' + b.dataset.f);
    if (inp) {
      inp.value = t;
      // Fire input so listeners react (e.g. instant client rating on C1)
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    toast('Copied: ' + t.substring(0, 20));
    sel.style.display = 'none';
    window.getSelection().removeAllRanges();
  }
};
