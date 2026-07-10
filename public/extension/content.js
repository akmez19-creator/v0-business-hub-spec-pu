// Akmez Quick Order v4.0 - Draggable Floating Widget with Full Functionality

const API_BASE = 'https://www.akmez.tech';

// Create floating toggle button
const toggleBtn = document.createElement('div');
toggleBtn.id = 'akmez-toggle';
toggleBtn.innerHTML = '<span>A</span>';
toggleBtn.title = 'Open Akmez Quick Order';
document.body.appendChild(toggleBtn);

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

// Create floating widget with tabs
const widget = document.createElement('div');
widget.id = 'akmez-widget';
widget.innerHTML = `
  <div class="akmez-header" id="akmez-drag">
    <div class="akmez-logo">A</div>
    <div style="flex:1">
      <span>Quick Order v4.0</span>
      <div style="font-size:10px;opacity:0.7">Create orders from anywhere</div>
    </div>
    <div class="akmez-header-btns">
      <button class="akmez-hbtn" id="akmez-settings" title="Settings">&#9881;</button>
      <button class="akmez-hbtn" id="akmez-close" title="Close">&times;</button>
    </div>
  </div>
  <div class="akmez-tabs">
    <button class="akmez-tab active" data-tab="orders">&#128203; Orders</button>
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
#akmez-toggle{position:fixed;bottom:20px;right:20px;width:56px;height:56px;background:linear-gradient(135deg,#6b7280,#4b5563);border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483646;box-shadow:0 4px 20px rgba(107,114,128,0.5);font-family:sans-serif;transition:all 0.3s ease;}
#akmez-toggle:hover{transform:scale(1.1);}
#akmez-toggle span{color:white;font-size:24px;font-weight:800;}
#akmez-toggle.logged-in{background:linear-gradient(135deg,#f97316,#ea580c);box-shadow:0 4px 20px rgba(249,115,22,0.5);}
#akmez-toggle.logged-in::after{content:'';position:absolute;top:-2px;right:-2px;width:14px;height:14px;background:#10b981;border-radius:50%;border:2px solid #1a1a2e;}
#akmez-widget{position:fixed;top:40px;right:20px;width:440px;max-width:calc(100vw - 40px);height:calc(100vh - 80px);max-height:900px;background:linear-gradient(135deg,#0f0f1a 0%,#1a1a2e 100%);border-radius:16px;box-shadow:0 10px 50px rgba(0,0,0,0.6);border:2px solid #f97316;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;overflow:hidden;display:flex;flex-direction:column;}
.akmez-header{background:linear-gradient(135deg,#f97316,#ea580c);padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:move;user-select:none;}
.akmez-logo{width:32px;height:32px;background:rgba(255,255,255,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}
.akmez-header span{font-weight:700;font-size:14px;}
.akmez-header-btns{display:flex;gap:6px;}
.akmez-hbtn{width:26px;height:26px;border:none;border-radius:6px;background:rgba(255,255,255,0.2);color:white;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.akmez-hbtn:hover{background:rgba(255,255,255,0.3);}
.akmez-tabs{display:flex;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(255,255,255,0.1);}
.akmez-tab{flex:1;padding:10px 12px;background:none;border:none;color:#888;font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;border-bottom:2px solid transparent;transition:all 0.15s;}
.akmez-tab:hover{color:#fff;background:rgba(255,255,255,0.05);}
.akmez-tab.active{color:#f97316;border-bottom-color:#f97316;background:rgba(249,115,22,0.1);}
.akmez-body{padding:12px;overflow-y:auto;overflow-x:hidden;flex:1;min-height:0;}
.akmez-loading{text-align:center;padding:40px;color:#888;}
.akmez-spinner{width:32px;height:32px;border:3px solid rgba(249,115,22,0.2);border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px;}
@keyframes spin{to{transform:rotate(360deg);}}

/* Orders Form Styles */
.akmez-user{background:rgba(139,92,246,0.1);border-radius:8px;padding:8px 12px;font-size:11px;color:#a5b4fc;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.akmez-user .dot{width:8px;height:8px;background:#10b981;border-radius:50%;}
.akmez-row{display:flex;gap:8px;margin-bottom:10px;}
.akmez-field{flex:1;}
.akmez-label{font-size:9px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-weight:600;}
.akmez-label .req{color:#f97316;}
.akmez-input-wrap{position:relative;}
.akmez-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 50px 10px 12px;color:white;font-size:13px;outline:none;transition:all 0.15s;}
.akmez-input:focus{border-color:#f97316;background:rgba(249,115,22,0.05);}
.akmez-input::placeholder{color:#555;}
.akmez-paste{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:rgba(249,115,22,0.3);border:none;border-radius:5px;padding:6px 10px;color:#f97316;font-size:9px;font-weight:700;cursor:pointer;text-transform:uppercase;}
.akmez-paste:hover{background:rgba(249,115,22,0.5);}
.akmez-sel-list{margin-bottom:8px;}
.akmez-sel-row{display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:4px;}
.akmez-sel-text{flex:1;font-size:11px;color:#ccc;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.akmez-sel-del{background:rgba(239,68,68,0.15);border:none;color:#fca5a5;width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:15px;line-height:1;flex-shrink:0;}
.akmez-sel-del:hover{background:rgba(239,68,68,0.3);}
.akmez-sel-empty{font-size:11px;color:#777;padding:8px;text-align:center;line-height:1.4;}
.akmez-hint-text{font-size:10px;color:#777;margin:6px 0 4px;line-height:1.4;}
.akmez-adid-toggle{font-size:11px;color:#f97316;cursor:pointer;margin:2px 0 8px;user-select:none;display:inline-block;}
.akmez-adid-toggle:hover{text-decoration:underline;}
.akmez-select{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:white;font-size:13px;outline:none;cursor:pointer;}
.akmez-select:focus{border-color:#f97316;}
.akmez-select option{background:#1a1a2e;color:white;}
.akmez-input-plain{padding-right:12px;}
.akmez-autocomplete{position:relative;}
.akmez-suggest{position:absolute;left:0;right:0;top:100%;margin-top:2px;z-index:10;background:#1a1a2e;border:1px solid rgba(249,115,22,0.4);border-radius:8px;max-height:160px;overflow-y:auto;box-shadow:0 6px 20px rgba(0,0,0,0.4);display:none;}
.akmez-suggest-item{padding:9px 12px;font-size:12px;color:#eee;cursor:pointer;}
.akmez-suggest-item:hover,.akmez-suggest-item.active{background:rgba(249,115,22,0.35);color:#fff;}
.akmez-cutoff-input{background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:6px 8px;color:#fff;font-size:12px;font-weight:600;outline:none;}
.akmez-cutoff-input:focus{border-color:#f97316;}
.akmez-section{font-size:10px;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid rgba(249,115,22,0.2);font-weight:600;}
.akmez-subsection{font-size:11px;color:#bbb;font-weight:600;margin:12px 0 6px;}
.akmez-managed-tag{background:rgba(16,185,129,0.15);color:#10b981;font-size:8px;padding:2px 6px;border-radius:4px;margin-left:6px;letter-spacing:0.5px;vertical-align:middle;}
.akmez-product-search{width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(249,115,22,0.3);border-radius:8px;padding:10px 12px;color:white;font-size:13px;outline:none;margin-bottom:10px;}
.akmez-product-search:focus{border-color:#f97316;background:rgba(249,115,22,0.1);}
.akmez-product-search::placeholder{color:#888;}
.akmez-suggest-price{color:#10b981;font-weight:700;font-size:11px;margin-left:8px;white-space:nowrap;}
.akmez-suggest-item{display:flex;justify-content:space-between;align-items:center;}
.akmez-cart-list{display:flex;flex-direction:column;gap:6px;margin-top:4px;}
.akmez-cart-item{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;}
.akmez-cart-item-name{font-size:12px;font-weight:600;color:#fff;line-height:1.2;}
.akmez-cart-item-price{font-size:10px;color:#888;margin-top:2px;}
.akmez-qty{display:flex;align-items:center;gap:4px;flex-shrink:0;}
.akmez-qty-btn{width:24px;height:24px;border:1px solid rgba(249,115,22,0.4);background:rgba(249,115,22,0.12);color:#f97316;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding:0;}
.akmez-qty-btn:hover{background:rgba(249,115,22,0.3);}
.akmez-qty-val{min-width:20px;text-align:center;font-size:12px;font-weight:700;color:#fff;}
.akmez-qty-del{border-color:rgba(239,68,68,0.4);background:rgba(239,68,68,0.12);color:#ef4444;margin-left:2px;}
.akmez-qty-del:hover{background:rgba(239,68,68,0.3);}
.akmez-cart{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px 12px;margin-top:10px;display:flex;justify-content:space-between;font-size:12px;}
.akmez-cart .items{color:#6ee7b7;}
.akmez-cart .total{color:#10b981;font-weight:700;}
.akmez-submit{width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:10px;color:white;font-size:13px;font-weight:700;cursor:pointer;margin-top:12px;text-transform:uppercase;letter-spacing:1px;transition:all 0.15s;}
.akmez-submit:hover{transform:scale(1.02);box-shadow:0 4px 20px rgba(16,185,129,0.3);}
.akmez-submit:disabled{opacity:0.5;cursor:not-allowed;transform:none;}
.akmez-success{text-align:center;padding:20px;}
.akmez-success .check{font-size:48px;color:#10b981;}
.akmez-success h3{color:#10b981;margin:10px 0 6px;font-size:16px;}
.akmez-success p{color:#6ee7b7;font-size:12px;margin-bottom:16px;}
.akmez-success button{background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#10b981;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:12px;}
.akmez-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px;color:#fca5a5;font-size:11px;margin-bottom:10px;}

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
.wt-pin{display:flex;justify-content:center;gap:8px;margin-bottom:20px;}
.wt-pin input{width:48px;height:56px;background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);border-radius:10px;text-align:center;font-size:24px;font-weight:700;color:#fff;outline:none;}
.wt-pin input:focus{border-color:#f97316;background:rgba(249,115,22,0.1);}
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
let isDragging = false, dragOffset = {x:0,y:0};
let worktimeData = { isClockedIn: false, clockInTime: null, todayHours: 0, history: [] };
let timerInterval = null;

// Drag functionality
document.getElementById('akmez-drag').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  isDragging = true;
  const r = widget.getBoundingClientRect();
  dragOffset = {x: e.clientX - r.left, y: e.clientY - r.top};
});
document.addEventListener('mousemove', e => {
  if (!isDragging) return;
  widget.style.left = Math.max(0, Math.min(window.innerWidth - 400, e.clientX - dragOffset.x)) + 'px';
  widget.style.top = Math.max(0, Math.min(window.innerHeight - 500, e.clientY - dragOffset.y)) + 'px';
  widget.style.right = 'auto';
});
document.addEventListener('mouseup', () => isDragging = false);

// Toggle widget
toggleBtn.addEventListener('click', () => {
  widget.style.display = widget.style.display === 'none' ? 'block' : 'none';
  if (widget.style.display === 'block') loadData();
});
document.getElementById('akmez-close').addEventListener('click', () => widget.style.display = 'none');

// Settings panel
document.getElementById('akmez-settings').addEventListener('click', () => renderSettings());

function renderSettings() {
  const body = document.getElementById('akmez-body');
  const version = chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '4.1.0';
  
  chrome.storage.local.get(['authToken', 'userName', 'userEmail', 'nameSelectors', 'phoneSelectors', 'adidSelectors', 'cutoffTime', 'userRole'], stored => {
    const signedIn = !!stored.authToken;
    const isAdmin = stored.userRole === 'admin';
    const cutoff = stored.cutoffTime || '20:00';
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
    const nameHtml = renderSelList(nameSel, 'name', 'No selectors yet. Click "Pick name from page" then click the customer name in the conversation.');
    const phoneHtml = renderSelList(phoneSel, 'phone', 'No selectors yet. Click "Pick phone from page" then click the phone number (e.g. in the contact panel).');
    const adidHtml = renderSelList(adidSel, 'adid', 'No selectors yet. Click "Pick ad id from page" then click the ad_id label in the contact panel.');
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
        
        <div class="akmez-subsection">Delivery Cut-off</div>
        <div class="akmez-set-row">
          <span class="akmez-set-label">Cut-off time</span>
          <input type="time" id="set-cutoff" class="akmez-cutoff-input" value="${cutoff}"${isAdmin ? '' : ' disabled'}>
        </div>
        ${isAdmin ? '<div class="akmez-hint-text">Orders before cut-off deliver the next working day. After cut-off the picking list is closed, so delivery skips to the working day after. Sundays and Mauritius public holidays are never selectable.</div>' : ''}
        
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
      document.getElementById('set-cutoff').onchange = e => {
        const v = e.target.value || '20:00';
        chrome.storage.local.set({ cutoffTime: v }, () => pushSharedSettings('Cut-off saved for all users'));
      };
      body.querySelectorAll('.akmez-sel-del').forEach(b => {
        b.onclick = () => {
          const kind = b.dataset.kind;
          getSelectors(kind, list => {
            list.splice(parseInt(b.dataset.i, 10), 1);
            saveSelectors(kind, list, () => { pushSharedSettings('Removed for all users'); renderSettings(); });
          });
        };
      });
    }
    document.getElementById('set-reset-pos').onclick = () => {
      widget.style.left = 'auto';
      widget.style.top = '60px';
      widget.style.right = '20px';
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
const SEL_KEYS = { name: 'nameSelectors', phone: 'phoneSelectors', adid: 'adidSelectors' };

function getSelectors(kind, cb) {
  const key = SEL_KEYS[kind];
  chrome.storage.local.get([key], s => cb(Array.isArray(s[key]) ? s[key] : []));
}
function saveSelectors(kind, list, cb) {
  chrome.storage.local.set({ [SEL_KEYS[kind]]: list }, () => cb && cb());
}
// Admin-only: push the locally-edited settings to the server so all users inherit them
function pushSharedSettings(successMsg) {
  chrome.storage.local.get(['nameSelectors', 'phoneSelectors', 'adidSelectors', 'cutoffTime'], s => {
    chrome.runtime.sendMessage({
      action: 'saveSettings',
      data: {
        nameSelectors: s.nameSelectors || [],
        phoneSelectors: s.phoneSelectors || [],
        adidSelectors: s.adidSelectors || [],
        cutoffTime: s.cutoffTime || '20:00',
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

// ===== Delivery date rules: no deliveries on Sundays or Mauritius public holidays =====
// Official Mauritius public holidays 2026 (General Notice No. 1195 of 2025)
const MU_HOLIDAYS = [
  '2026-01-01', // New Year
  '2026-01-02', // New Year
  '2026-02-01', // Abolition of Slavery / Thaipoosam Cavadee
  '2026-02-15', // Maha Shivaratree
  '2026-02-17', // Chinese Spring Festival
  '2026-03-12', // Independence and Republic Day
  '2026-03-19', // Ugaadi
  '2026-03-21', // Eid-Ul-Fitr (subject to moon)
  '2026-05-01', // Labour Day
  '2026-08-15', // Assumption
  '2026-09-16', // Ganesh Chaturthi
  '2026-11-02', // Arrival of Indentured Labourers
  '2026-11-08', // Divali
  '2026-12-25', // Christmas
];
function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Sunday (getDay()===0) or a listed public holiday
function isNonWorking(d) {
  return d.getDay() === 0 || MU_HOLIDAYS.includes(ymd(d));
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
  chrome.storage.local.get(['cutoffTime'], s => cb(s.cutoffTime || '20:00'));
}
// Default delivery date = next working day, or the one after if past the cut-off (picking list closed)
function computeDefaultDeliveryDate(cutoff, cb) {
  const now = new Date();
  const [ch, cm] = (cutoff || '20:00').split(':').map(Number);
  const afterCutoff = now.getHours() > ch || (now.getHours() === ch && now.getMinutes() >= cm);
  cb(addWorkingDays(now, afterCutoff ? 2 : 1), afterCutoff);
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
  const label = kind === 'phone' ? 'phone number' : 'customer name';
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
    widget.style.display = 'block';
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
      worktimeData = data.worktime || worktimeData;
      // Mirror the shared, admin-configured settings into local storage so the
      // auto-fill readers (which read these keys) inherit them for every user.
      const s = data.settings || {};
      chrome.storage.local.set({
        userRole: data.role || null,
        nameSelectors: Array.isArray(s.nameSelectors) ? s.nameSelectors : [],
        phoneSelectors: Array.isArray(s.phoneSelectors) ? s.phoneSelectors : [],
        adidSelectors: Array.isArray(s.adidSelectors) ? s.adidSelectors : [],
        cutoffTime: s.cutoffTime || '20:00',
      }, () => renderCurrentTab());
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
  else renderWorktime();
}

// Render orders form
function renderOrdersForm() {
  const body = document.getElementById('akmez-body');
  body.innerHTML = `
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
        document.getElementById(b.dataset.t).value = await navigator.clipboard.readText();
      } catch(e) {}
    };
  });
  
  // Auto-fill name + phone + ad id - continuously follows the currently open conversation
  const fields = {
    name:  { input: document.getElementById('ak-name'), edited: false, last: null, emptyStreak: 0 },
    phone: { input: document.getElementById('ak-c1'),   edited: false, last: null, emptyStreak: 0 },
    adid:  { input: document.getElementById('ak-adid'), edited: false, last: null, emptyStreak: 0 },
  };
  Object.values(fields).forEach(f => f.input.addEventListener('input', () => { f.edited = true; }));

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
    readCustomerName(txt => applyField(fields.name, txt));
    readCustomerPhone(num => applyField(fields.phone, num));
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
  if (window.__akmezSyncTimer) clearInterval(window.__akmezSyncTimer);
  window.__akmezSyncTimer = setInterval(syncFields, 1200);
  
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
    prodSuggest.innerHTML = prodMatches.map((p, i) => `
      <div class="akmez-suggest-item${i === 0 ? ' active' : ''}" data-i="${i}">
        <span>${p.name.replace(/</g, '&lt;')}</span>
        <span class="akmez-suggest-price">Rs ${p.price}</span>
      </div>`).join('');
    prodSuggest.style.display = 'block';
    prodSuggest.querySelectorAll('.akmez-suggest-item').forEach(it => {
      it.onmousedown = e => { e.preventDefault(); pickProduct(parseInt(it.dataset.i, 10)); };
    });
  }

  function pickProduct(i) {
    if (i < 0 || i >= prodMatches.length) return;
    const p = prodMatches[i];
    cart[p.id] = (cart[p.id] || 0) + 1;
    updateCart();
    // Clear the query so the agent can immediately search the next product
    prodInput.value = '';
    prodSuggest.style.display = 'none';
    prodInput.focus();
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
    regionSuggest.innerHTML = regionMatches.map((r, i) =>
      `<div class="akmez-suggest-item${i === 0 ? ' active' : ''}" data-i="${i}">${r.replace(/</g, '&lt;')}</div>`
    ).join('');
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
  }

  regionInput.addEventListener('input', showRegionSuggestions);
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
  getCutoff(cutoff => {
    computeDefaultDeliveryDate(cutoff, (d, afterCutoff) => {
      dateInput.value = ymd(d);
      if (afterCutoff) toast('After ' + cutoff + ' cut-off - delivery set to ' + ymd(d));
    });
  });
  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const picked = new Date(dateInput.value + 'T00:00:00');
    if (isNonWorking(picked)) {
      const fixed = nextWorkingOnOrAfter(picked);
      dateInput.value = ymd(fixed);
      const why = picked.getDay() === 0 ? 'Sundays' : 'public holidays';
      toast('No deliveries on ' + why + ' - moved to ' + ymd(fixed));
    }
  });
}

function updateCart() {
  const c = document.getElementById('ak-cart');
  const list = document.getElementById('ak-cart-list');
  if (!c || !list) return;
  const entries = Object.entries(cart).filter(([,q]) => q > 0);
  if (!entries.length) {
    c.style.display = 'none';
    list.innerHTML = '';
    return;
  }

  let qty = 0, amt = 0;
  // Render each selected product with quantity controls
  list.innerHTML = entries.map(([id, q]) => {
    const p = products.find(x => x.id === id);
    if (!p) return '';
    qty += q;
    amt += parseFloat(p.price) * q;
    return `
      <div class="akmez-cart-item" data-id="${id}">
        <div class="akmez-cart-item-info">
          <div class="akmez-cart-item-name">${p.name.replace(/</g, '&lt;')}</div>
          <div class="akmez-cart-item-price">Rs ${p.price}</div>
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

  c.style.display = 'flex';
  c.querySelector('.items').textContent = qty + ' item' + (qty !== 1 ? 's' : '');
  c.querySelector('.total').textContent = 'Rs ' + amt.toFixed(0);
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
  
  const prods = entries.map(([id, q]) => {
    const p = products.find(x => x.id === id);
    return p ? p.name + ' x' + q : '';
  }).filter(Boolean).join(', ');
  
  let qty = 0, amt = 0;
  entries.forEach(([id, q]) => {
    qty += q;
    const p = products.find(x => x.id === id);
    if (p) amt += parseFloat(p.price) * q;
  });
  
  chrome.runtime.sendMessage({
    action: 'createOrder',
    data: { customerName: name, contact1: c1, contact2: c2, region, deliveryDate: date, products: prods, qty, amount: amt, adId }
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
    
    document.getElementById('akmez-body').innerHTML = `
      <div class="akmez-success">
        <div class="check">&#10003;</div>
        <h3>Order Created!</h3>
        <p>${name}</p>
        <button id="ak-new">New Order</button>
      </div>
    `;
    document.getElementById('ak-new').onclick = () => {
      cart = {};
      renderOrdersForm();
    };
  });
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
      <div class="wt-pin" id="wt-pin">
        <input type="password" maxlength="1" data-index="0" />
        <input type="password" maxlength="1" data-index="1" />
        <input type="password" maxlength="1" data-index="2" />
        <input type="password" maxlength="1" data-index="3" />
      </div>
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
  
  // PIN input handling
  const pinInputs = document.querySelectorAll('.wt-pin input');
  pinInputs.forEach((input, index) => {
    input.addEventListener('input', e => {
      if (e.target.value && index < 3) {
        pinInputs[index + 1].focus();
      }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !e.target.value && index > 0) {
        pinInputs[index - 1].focus();
      }
    });
  });
  
  // Clock button
  document.getElementById('wt-btn').onclick = () => {
    const pin = Array.from(pinInputs).map(i => i.value).join('');
    if (pin.length !== 4) {
      toast('Enter 4-digit PIN');
      return;
    }
    
    const btn = document.getElementById('wt-btn');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    
    chrome.runtime.sendMessage({
      action: isClockedIn ? 'clockOut' : 'clockIn',
      pin
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

// Text selection popup
const sel = document.createElement('div');
sel.id = 'akmez-sel';
sel.innerHTML = '<button data-f="name">Name</button><button data-f="c1">C1</button><button data-f="c2">C2</button>';
document.body.appendChild(sel);

document.addEventListener('mouseup', e => {
  if (e.target.closest('#akmez-sel,#akmez-widget')) return;
  setTimeout(() => {
    const s = window.getSelection(), t = s.toString().trim();
    if (t && t.length > 0 && t.length < 200) {
      const r = s.getRangeAt(0).getBoundingClientRect();
      sel.style.display = 'flex';
      sel.style.left = Math.max(10, r.left) + 'px';
      sel.style.top = (r.bottom + 8) + 'px';
      sel.dataset.text = t;
    } else {
      sel.style.display = 'none';
    }
  }, 10);
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
    const inp = document.getElementById('ak-' + b.dataset.f) || document.getElementById('ak-name');
    if (inp) inp.value = t;
    toast('Copied: ' + t.substring(0, 20));
    sel.style.display = 'none';
    window.getSelection().removeAllRanges();
  }
};
