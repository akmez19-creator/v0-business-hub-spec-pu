import { NextResponse } from 'next/server'
import JSZip from 'jszip'

// Embedded extension files - Updated 2026-04-21
const MANIFEST = `{
  "manifest_version": 3,
  "name": "Akmez Quick Order v3.0",
  "version": "3.0.8",
  "description": "Create delivery orders directly from Facebook Business Suite",
  "permissions": ["activeTab", "clipboardRead", "clipboardWrite", "storage", "scripting"],
  "host_permissions": ["https://www.akmez.tech/*", "<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "css": ["content.css"]
    }
  ],
  "icons": {
    "16": "icon16.png",
    "48": "icon48.png",
    "128": "icon128.png"
  }
}`

const BACKGROUND_JS = `const API_BASE='https://www.akmez.tech';
chrome.runtime.onMessage.addListener((request,sender,sendResponse)=>{
if(request.action==='fetchData'){
  chrome.storage.local.get(['authToken'],stored=>{
    const headers=stored.authToken?{'Authorization':'Bearer '+stored.authToken}:{};
    fetch(API_BASE+'/api/extension',{headers}).then(r=>r.json()).then(d=>sendResponse({success:true,data:d})).catch(e=>sendResponse({success:false,error:e.message}));
  });
  return true;
}
if(request.action==='createOrder'){
  chrome.storage.local.get(['authToken'],stored=>{
    fetch(API_BASE+'/api/extension',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(stored.authToken||'')},body:JSON.stringify(request.data)}).then(r=>r.json()).then(d=>sendResponse({success:true,data:d})).catch(e=>sendResponse({success:false,error:e.message}));
  });
  return true;
}
if(request.action==='worktime'){
  chrome.storage.local.get(['authToken'],stored=>{
    fetch(API_BASE+'/api/extension/worktime',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(stored.authToken||'')},body:JSON.stringify(request.data)}).then(r=>r.json()).then(d=>sendResponse({success:true,data:d})).catch(e=>sendResponse({success:false,error:e.message}));
  });
  return true;
}
});`

// POPUP - LOGIN ONLY (toolbar pinned extension)
const POPUP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
      color: #fff;
    }
    .header {
      background: linear-gradient(135deg, #f97316, #ea580c);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 36px;
      height: 36px;
      background: rgba(255,255,255,0.2);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
    }
    .header-text h1 { font-size: 15px; font-weight: 700; }
    .header-text .sub { font-size: 10px; opacity: 0.8; }
    .content { padding: 20px; }
    .status {
      text-align: center;
      padding: 24px 16px;
    }
    .status-icon {
      width: 56px;
      height: 56px;
      background: rgba(16, 185, 129, 0.15);
      border: 2px solid rgba(16, 185, 129, 0.4);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 16px;
      font-size: 24px;
    }
    .status-icon.disconnected {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
    }
    .status h2 { font-size: 16px; margin-bottom: 8px; color: #10b981; }
    .status.disconnected h2 { color: #ef4444; }
    .status p { font-size: 12px; color: #888; line-height: 1.5; }
    .login-form { padding: 4px 0; }
    .field { margin-bottom: 12px; }
    .field input {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 12px 14px;
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    .field input:focus { border-color: #f97316; background: rgba(249,115,22,0.05); }
    .field input::placeholder { color: #555; }
    .error {
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.3);
      border-radius: 6px;
      padding: 10px;
      color: #fca5a5;
      font-size: 11px;
      margin-bottom: 12px;
      display: none;
    }
    .btn {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: white;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #888;
      margin-top: 10px;
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.15); color: #fff; }
    .divider {
      display: flex;
      align-items: center;
      margin: 16px 0;
      color: #444;
      font-size: 11px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255,255,255,0.1);
    }
    .divider span { padding: 0 12px; }
    .hint {
      background: rgba(249, 115, 22, 0.1);
      border: 1px solid rgba(249, 115, 22, 0.2);
      border-radius: 8px;
      padding: 12px;
      margin-top: 16px;
    }
    .hint p { font-size: 11px; color: #f97316; line-height: 1.5; }
    .loading { text-align: center; padding: 30px; }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(249, 115, 22, 0.2);
      border-top-color: #f97316;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">A</div>
    <div class="header-text">
      <h1>Akmez Quick Order</h1>
      <div class="sub">Login to get started</div>
    </div>
  </div>
  <div class="content" id="content">
    <div class="loading">
      <div class="spinner"></div>
      <p style="color:#888;font-size:12px;">Checking connection...</p>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>`

const POPUP_JS = `const API_BASE = 'https://www.akmez.tech';
const content = document.getElementById('content');

async function init() {
  const stored = await chrome.storage.local.get(['authToken', 'tokenExpiry', 'userName']);
  if (stored.authToken && stored.tokenExpiry && Date.now() < stored.tokenExpiry * 1000) {
    // Verify token still works
    try {
      const res = await fetch(API_BASE + '/api/extension', { headers: { 'Authorization': 'Bearer ' + stored.authToken } });
      const data = await res.json();
      if (data.authenticated) {
        showConnected(stored.userName || data.userName || 'User');
        return;
      }
    } catch (e) {}
    // Token invalid
    await chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName']);
  }
  showLogin();
}

function showConnected(name) {
  content.innerHTML = '<div class="status"><div class="status-icon">✓</div><h2>Connected</h2><p>Logged in as <strong>' + name + '</strong></p></div><div class="hint"><p>Click the floating <strong>A button</strong> on any page to create orders and track working time.</p></div><button class="btn btn-secondary" id="signOutBtn">Sign Out</button>';
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName', 'clockedIn', 'clockInTime']);
    showLogin();
  });
}

function showLogin() {
  content.innerHTML = '<div class="status disconnected"><div class="status-icon">!</div><h2>Not Connected</h2><p>Sign in to create orders</p></div><div class="login-form"><div class="error" id="error"></div><div class="field"><input type="email" id="email" placeholder="Email address"></div><div class="field"><input type="password" id="password" placeholder="Password"></div><button class="btn btn-primary" id="loginBtn">Sign In</button><div class="divider"><span>or</span></div><button class="btn btn-secondary" id="openBtn">Open Akmez Website</button></div>';
  
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('error');
  const email = document.getElementById('email');
  const pwd = document.getElementById('password');
  
  btn.addEventListener('click', async () => {
    if (!email.value.trim() || !pwd.value) {
      err.textContent = 'Enter email and password';
      err.style.display = 'block';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    err.style.display = 'none';
    
    try {
      const res = await fetch(API_BASE + '/api/extension/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: pwd.value })
      });
      const data = await res.json();
      if (data.success && data.accessToken) {
        const name = data.user?.name || data.userName || 'User';
        await chrome.storage.local.set({
          authToken: data.accessToken,
          tokenExpiry: data.expiresAt,
          userName: name
        });
        showConnected(name);
      } else {
        err.textContent = data.error || 'Invalid credentials';
        err.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    } catch (e) {
      err.textContent = 'Connection error';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
  
  pwd.addEventListener('keypress', (e) => { if (e.key === 'Enter') btn.click(); });
  document.getElementById('openBtn').addEventListener('click', () => { chrome.tabs.create({ url: API_BASE + '/auth/sign-in' }); });
}

init();`

// CONTENT.JS - FULL FUNCTIONALITY (floating A button)
const CONTENT_JS = `const API_BASE='https://www.akmez.tech';
let products=[],regions=[],cart={},authToken=null,currentTab='orders',clockedIn=false,clockInTime=null,timerInterval=null;

// Create toggle button
const toggleBtn=document.createElement('div');
toggleBtn.id='akmez-toggle';
toggleBtn.innerHTML='<span>A</span>';
document.body.appendChild(toggleBtn);

// Create widget
const widget=document.createElement('div');
widget.id='akmez-widget';
widget.innerHTML=\`
<div class="akmez-header" id="akmez-drag">
  <div class="akmez-logo">A</div>
  <div class="akmez-title">
    <span>Quick Order v3.0</span>
    <small>Create orders from anywhere</small>
  </div>
  <div class="akmez-header-btns">
    <button class="akmez-settings-btn" id="akmez-settings">⚙</button>
    <button class="akmez-close-btn" id="akmez-close">×</button>
  </div>
</div>
<div class="akmez-tabs">
  <button class="akmez-tab active" data-tab="orders">📋 Orders</button>
  <button class="akmez-tab" data-tab="worktime">⏱ Working Time</button>
</div>
<div class="akmez-body" id="akmez-body">
  <div class="akmez-loading"><div class="akmez-spinner"></div><p>Connecting...</p></div>
</div>
\`;
widget.style.display='none';
document.body.appendChild(widget);

// Add styles
const style=document.createElement('style');
style.textContent=\`
#akmez-toggle{position:fixed;bottom:20px;right:20px;width:56px;height:56px;background:linear-gradient(135deg,#f97316,#ea580c);border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483646;box-shadow:0 4px 20px rgba(249,115,22,0.5);font-family:sans-serif;transition:transform 0.2s;}
#akmez-toggle:hover{transform:scale(1.1);}
#akmez-toggle span{color:white;font-size:24px;font-weight:800;}
#akmez-widget{position:fixed;top:60px;right:20px;width:420px;max-width:95vw;background:#0f0f1a;border-radius:16px;box-shadow:0 10px 50px rgba(0,0,0,0.6);border:2px solid #f97316;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;overflow:hidden;}
.akmez-header{background:linear-gradient(135deg,#f97316,#ea580c);padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:move;border-radius:14px 14px 0 0;user-select:none;}
.akmez-logo{width:32px;height:32px;background:rgba(255,255,255,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px;}
.akmez-title{flex:1;}
.akmez-title span{font-weight:700;font-size:14px;display:block;}
.akmez-title small{font-size:10px;opacity:0.8;}
.akmez-header-btns{display:flex;gap:6px;}
.akmez-settings-btn,.akmez-close-btn{width:28px;height:28px;border:none;border-radius:6px;background:rgba(255,255,255,0.2);color:white;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.akmez-settings-btn:hover,.akmez-close-btn:hover{background:rgba(255,255,255,0.3);}
.akmez-tabs{display:flex;background:rgba(0,0,0,0.3);border-bottom:1px solid rgba(255,255,255,0.1);}
.akmez-tab{flex:1;padding:12px;background:none;border:none;color:#888;font-size:12px;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.15s;}
.akmez-tab:hover{color:#fff;background:rgba(255,255,255,0.05);}
.akmez-tab.active{color:#f97316;border-bottom-color:#f97316;background:rgba(249,115,22,0.1);}
.akmez-body{padding:14px;max-height:500px;overflow-y:auto;overflow-x:hidden;}
.akmez-loading{text-align:center;padding:40px;color:#888;}
.akmez-spinner{width:32px;height:32px;border:3px solid rgba(249,115,22,0.2);border-top-color:#f97316;border-radius:50%;animation:akmez-spin 0.8s linear infinite;margin:0 auto 12px;}
@keyframes akmez-spin{to{transform:rotate(360deg);}}
.akmez-login{text-align:center;padding:30px 20px;}
.akmez-login p{color:#888;margin-bottom:16px;font-size:13px;}
.akmez-login small{display:block;color:#666;font-size:11px;margin-bottom:16px;}
.akmez-login-btn{width:100%;background:linear-gradient(135deg,#f97316,#ea580c);color:white;border:none;padding:12px 24px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;margin-top:12px;}
.akmez-login-btn:hover{opacity:0.9;}
.akmez-login-btn:disabled{opacity:0.6;cursor:not-allowed;}
.akmez-user{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px 12px;margin-bottom:14px;display:flex;align-items:center;gap:8px;font-size:12px;color:#6ee7b7;}
.akmez-user .dot{width:8px;height:8px;background:#10b981;border-radius:50%;animation:akmez-pulse 2s infinite;}
@keyframes akmez-pulse{0%,100%{opacity:1;}50%{opacity:0.5;}}
.akmez-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px;padding:10px;color:#fca5a5;font-size:11px;margin-bottom:12px;display:none;}
.akmez-row{display:flex;gap:8px;margin-bottom:10px;}
.akmez-field{flex:1;}
.akmez-label{font-size:10px;font-weight:600;color:#888;text-transform:uppercase;margin-bottom:4px;}
.akmez-label .req{color:#f97316;}
.akmez-input-wrap{position:relative;}
.akmez-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;outline:none;}
.akmez-input:focus{border-color:#f97316;background:rgba(249,115,22,0.05);}
.akmez-input::placeholder{color:#555;}
.akmez-paste{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:rgba(249,115,22,0.3);border:none;border-radius:4px;padding:4px 8px;color:#f97316;font-size:9px;font-weight:700;cursor:pointer;}
.akmez-paste:hover{background:rgba(249,115,22,0.5);}
.akmez-select{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;outline:none;cursor:pointer;}
.akmez-select:focus{border-color:#f97316;}
.akmez-select option{background:#1a1a2e;color:#fff;}
.akmez-section{font-size:11px;font-weight:600;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(249,115,22,0.2);}
.akmez-products{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;max-height:220px;overflow-y:auto;margin-bottom:10px;}
.akmez-product{position:relative;padding:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;font-size:11px;transition:all 0.15s;display:flex;gap:8px;align-items:flex-start;}
.akmez-product:hover{background:rgba(249,115,22,0.15);border-color:#f97316;}
.akmez-product.sel{background:linear-gradient(135deg,#f97316,#ea580c);border-color:#f97316;}
.akmez-product .img{width:40px;height:40px;border-radius:6px;object-fit:cover;background:rgba(255,255,255,0.1);flex-shrink:0;}
.akmez-product .img-placeholder{width:40px;height:40px;border-radius:6px;background:rgba(255,255,255,0.1);flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#555;font-size:14px;}
.akmez-product .info{flex:1;min-width:0;}
.akmez-product .name{font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.2;}
.akmez-product .price{font-size:10px;color:#888;margin-top:2px;}
.akmez-product.sel .price{color:rgba(255,255,255,0.8);}
.akmez-product .tags{display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;}
.akmez-product .tag{font-size:8px;padding:2px 4px;border-radius:3px;background:rgba(249,115,22,0.2);color:#f97316;}
.akmez-product.sel .tag{background:rgba(255,255,255,0.2);color:#fff;}
.akmez-product .badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;background:#10b981;border-radius:9px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 4px;}
.akmez-variant-modal{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100;border-radius:14px;}
.akmez-variant-content{background:#1a1a2e;border-radius:12px;padding:16px;width:90%;max-width:320px;max-height:80%;overflow-y:auto;}
.akmez-variant-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
.akmez-variant-header h4{color:#fff;font-size:14px;margin:0;}
.akmez-variant-close{background:none;border:none;color:#888;font-size:18px;cursor:pointer;}
.akmez-variant-img{width:60px;height:60px;border-radius:8px;object-fit:cover;margin-bottom:12px;}
.akmez-variant-list{display:flex;flex-direction:column;gap:6px;}
.akmez-variant-item{display:flex;justify-content:space-between;align-items:center;padding:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;}
.akmez-variant-item:hover{border-color:#f97316;}
.akmez-variant-item .attr{color:#fff;font-size:12px;}
.akmez-variant-item .stock{font-size:10px;color:#888;}
.akmez-variant-item .vprice{color:#f97316;font-size:12px;font-weight:600;}
.akmez-cart{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:10px 12px;display:none;justify-content:space-between;font-size:12px;margin-bottom:10px;}
.akmez-cart .items{color:#6ee7b7;}
.akmez-cart .total{color:#10b981;font-weight:700;}
.akmez-submit{width:100%;padding:14px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:10px;color:white;font-size:13px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:1px;transition:all 0.15s;}
.akmez-submit:hover{transform:scale(1.02);box-shadow:0 4px 20px rgba(16,185,129,0.3);}
.akmez-submit:disabled{opacity:0.5;cursor:not-allowed;transform:none;box-shadow:none;}
.akmez-success{text-align:center;padding:30px;}
.akmez-success .check{font-size:48px;margin-bottom:12px;}
.akmez-success h3{color:#10b981;margin-bottom:8px;}
.akmez-success p{color:#6ee7b7;font-size:12px;margin-bottom:16px;}
.akmez-success button{background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:12px;}
.akmez-worktime{text-align:center;padding:20px;}
.akmez-worktime-status{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:16px;margin-bottom:16px;}
.akmez-worktime-status.out{background:rgba(239,68,68,0.1);border-color:rgba(239,68,68,0.3);}
.akmez-worktime-status .status-dot{width:12px;height:12px;background:#10b981;border-radius:50%;display:inline-block;margin-right:8px;animation:akmez-pulse 2s infinite;}
.akmez-worktime-status.out .status-dot{background:#ef4444;animation:none;}
.akmez-worktime-status .status-text{font-size:14px;font-weight:600;color:#10b981;}
.akmez-worktime-status.out .status-text{color:#ef4444;}
.akmez-timer{font-size:42px;font-weight:700;font-family:monospace;color:#fff;margin:20px 0;letter-spacing:2px;}
.akmez-worktime-info{font-size:11px;color:#888;margin-bottom:20px;}
.akmez-worktime-info span{color:#f97316;font-weight:600;}
.akmez-pin-wrap{display:flex;justify-content:center;gap:8px;margin-bottom:20px;}
.akmez-pin{width:48px;height:56px;background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);border-radius:10px;text-align:center;font-size:24px;font-weight:700;color:#fff;outline:none;}
.akmez-pin:focus{border-color:#f97316;background:rgba(249,115,22,0.1);}
.akmez-clock-btn{width:100%;padding:14px;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;text-transform:uppercase;letter-spacing:1px;transition:all 0.15s;}
.akmez-clock-btn.in{background:linear-gradient(135deg,#10b981,#059669);color:white;}
.akmez-clock-btn.out{background:linear-gradient(135deg,#ef4444,#dc2626);color:white;}
.akmez-clock-btn:hover{transform:scale(1.02);}
.akmez-clock-btn:disabled{opacity:0.5;cursor:not-allowed;transform:none;}
.akmez-history{margin-top:20px;text-align:left;}
.akmez-history h4{font-size:11px;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;}
.akmez-history-item{display:flex;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:6px;font-size:11px;}
.akmez-history-item .date{color:#888;}
.akmez-history-item .hours{color:#10b981;font-weight:600;}
.akmez-toast{position:fixed;bottom:90px;right:20px;background:#10b981;color:white;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:2147483648;animation:akmez-toast 2s forwards;}
@keyframes akmez-toast{0%{opacity:0;transform:translateY(10px);}10%{opacity:1;transform:translateY(0);}90%{opacity:1;transform:translateY(0);}100%{opacity:0;transform:translateY(-10px);}}
#akmez-sel{position:fixed;display:none;gap:4px;background:#1a1a2e;border:1px solid #f97316;border-radius:8px;padding:4px;z-index:2147483648;box-shadow:0 4px 20px rgba(0,0,0,0.5);}
#akmez-sel button{background:rgba(249,115,22,0.2);border:none;padding:6px 10px;border-radius:4px;color:#f97316;font-size:10px;font-weight:600;cursor:pointer;}
#akmez-sel button:hover{background:#f97316;color:white;}
\`;
document.head.appendChild(style);

// Drag functionality
let isDragging=false,dragOffset={x:0,y:0};
document.getElementById('akmez-drag').addEventListener('mousedown',e=>{
  if(e.target.closest('button'))return;
  isDragging=true;
  const r=widget.getBoundingClientRect();
  dragOffset={x:e.clientX-r.left,y:e.clientY-r.top};
});
document.addEventListener('mousemove',e=>{
  if(!isDragging)return;
  widget.style.left=Math.max(0,Math.min(window.innerWidth-380,e.clientX-dragOffset.x))+'px';
  widget.style.top=Math.max(0,Math.min(window.innerHeight-400,e.clientY-dragOffset.y))+'px';
  widget.style.right='auto';
});
document.addEventListener('mouseup',()=>isDragging=false);

// Toggle widget
toggleBtn.addEventListener('click',()=>{
  widget.style.display=widget.style.display==='none'?'block':'none';
  if(widget.style.display==='block')loadData();
});
document.getElementById('akmez-close').addEventListener('click',()=>widget.style.display='none');

// Calibration state
let calibrating=null;
let calibratingPlatform=null;
let calibrationOverlay=null;

const PLATFORMS=['Messenger','WhatsApp','Instagram','Other'];

function startCalibration(field,platform){
  calibrating=field;
  calibratingPlatform=platform;
  widget.style.display='none';
  
  // Create overlay
  calibrationOverlay=document.createElement('div');
  calibrationOverlay.id='akmez-calibration-overlay';
  calibrationOverlay.innerHTML=\`
    <div style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#f97316;color:#fff;padding:12px 24px;border-radius:12px;font-size:14px;font-weight:600;z-index:2147483647;box-shadow:0 4px 20px rgba(249,115,22,0.4);">
      Click on the element containing <strong>\${field}</strong> for <strong>\${platform}</strong> | <span style="cursor:pointer;text-decoration:underline;" id="cancel-calibration">Cancel</span>
    </div>
  \`;
  document.body.appendChild(calibrationOverlay);
  
  document.getElementById('cancel-calibration').onclick=(e)=>{
    e.stopPropagation();
    endCalibration();
  };
  
  // Highlight elements on hover
  document.addEventListener('mouseover',highlightElement);
  document.addEventListener('mouseout',unhighlightElement);
  document.addEventListener('click',selectElement,true);
}

function showPlatformPicker(field){
  const body=document.getElementById('akmez-body');
  chrome.storage.local.get(null,stored=>{
    const fieldKey=field.replace(/\\s+/g,'_').toLowerCase();
    const existingSelectors=PLATFORMS.map(p=>{
      const key='selector_'+fieldKey+'_'+p.toLowerCase();
      return {platform:p,selector:stored[key]||null};
    });
    
    body.innerHTML=\`
      <div class="akmez-settings-panel">
        <h3 style="color:#f97316;font-size:14px;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">\${field}</h3>
        <p style="font-size:11px;color:#666;margin-bottom:16px;">Add selectors for different platforms</p>
        
        \${existingSelectors.map(s=>\`
          <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
            <div style="flex:1;">
              <div style="font-size:12px;color:#fff;display:flex;align-items:center;gap:6px;">
                \${s.platform==='Messenger'?'💬':s.platform==='WhatsApp'?'📱':s.platform==='Instagram'?'📷':'🌐'} \${s.platform}
              </div>
              <div style="font-size:10px;color:\${s.selector?'#22c55e':'#888'};margin-top:2px;">\${s.selector?'Configured':'Not set'}</div>
            </div>
            <div style="display:flex;gap:4px;">
              <button class="platform-calibrate" data-platform="\${s.platform}" style="background:#f97316;border:none;color:#fff;padding:6px 10px;border-radius:6px;font-size:11px;cursor:pointer;">\${s.selector?'Update':'Add'}</button>
              \${s.selector?\`<button class="platform-remove" data-platform="\${s.platform}" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.3);color:#ef4444;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;">×</button>\`:''}
            </div>
          </div>
        \`).join('')}
        
        <button class="akmez-btn" style="width:100%;background:transparent;margin-top:16px;" id="platform-back">← Back to Settings</button>
      </div>
    \`;
    
    document.querySelectorAll('.platform-calibrate').forEach(btn=>{
      btn.onclick=()=>startCalibration(field,btn.dataset.platform);
    });
    
    document.querySelectorAll('.platform-remove').forEach(btn=>{
      btn.onclick=()=>{
        const key='selector_'+fieldKey+'_'+btn.dataset.platform.toLowerCase();
        chrome.storage.local.remove([key],()=>{
          toast(btn.dataset.platform+' selector removed');
          showPlatformPicker(field);
        });
      };
    });
    
    document.getElementById('platform-back').onclick=()=>document.getElementById('akmez-settings').click();
  });
}

function highlightElement(e){
  if(!calibrating)return;
  if(e.target.closest('#akmez-widget')||e.target.closest('#akmez-toggle')||e.target.closest('#akmez-calibration-overlay'))return;
  e.target.style.outline='3px solid #f97316';
  e.target.style.outlineOffset='2px';
}

function unhighlightElement(e){
  if(!calibrating)return;
  e.target.style.outline='';
  e.target.style.outlineOffset='';
}

function selectElement(e){
  if(!calibrating)return;
  if(e.target.closest('#akmez-widget')||e.target.closest('#akmez-toggle')||e.target.closest('#akmez-calibration-overlay'))return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const selector=generateSelector(e.target);
  const fieldKey='selector_'+calibrating.replace(/\\s+/g,'_').toLowerCase()+'_'+calibratingPlatform.toLowerCase();
  
  chrome.storage.local.set({[fieldKey]:selector},()=>{
    toast(calibrating+' ('+calibratingPlatform+') saved!');
    endCalibration(calibrating);
  });
}

function generateSelector(el){
  // Generate a unique CSS selector for the element
  if(el.id)return '#'+el.id;
  
  let path=[];
  while(el&&el.nodeType===Node.ELEMENT_NODE){
    let selector=el.nodeName.toLowerCase();
    if(el.className&&typeof el.className==='string'){
      const classes=el.className.trim().split(/\\s+/).filter(c=>c&&!c.includes('akmez')).slice(0,2);
      if(classes.length)selector+='.'+classes.join('.');
    }
    path.unshift(selector);
    el=el.parentNode;
    if(path.length>4)break;
  }
  return path.join(' > ');
}

function endCalibration(returnToField){
  const field=calibrating;
  calibrating=null;
  calibratingPlatform=null;
  document.removeEventListener('mouseover',highlightElement);
  document.removeEventListener('mouseout',unhighlightElement);
  document.removeEventListener('click',selectElement,true);
  if(calibrationOverlay){
    calibrationOverlay.remove();
    calibrationOverlay=null;
  }
  // Remove any leftover outlines
  document.querySelectorAll('[style*="outline"]').forEach(el=>{
    el.style.outline='';
    el.style.outlineOffset='';
  });
  widget.style.display='block';
  if(returnToField)showPlatformPicker(returnToField);
  else document.getElementById('akmez-settings').click();
}

function countConfiguredPlatforms(stored,fieldKey){
  return PLATFORMS.filter(p=>stored['selector_'+fieldKey+'_'+p.toLowerCase()]).length;
}

// Settings button
document.getElementById('akmez-settings').addEventListener('click',()=>{
  const body=document.getElementById('akmez-body');
  chrome.storage.local.get(null,stored=>{
    const nameCount=countConfiguredPlatforms(stored,'customer_name');
    const c1Count=countConfiguredPlatforms(stored,'contact_1');
    const c2Count=countConfiguredPlatforms(stored,'contact_2');
    
    body.innerHTML=\`
      <div class="akmez-settings-panel">
        <h3 style="color:#f97316;font-size:14px;margin-bottom:16px;text-transform:uppercase;letter-spacing:1px;">Settings</h3>
        
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:12px;">
          <div style="font-size:11px;color:#888;margin-bottom:4px;">Logged in as</div>
          <div style="font-size:14px;font-weight:600;color:#fff;">\${stored.userName||'User'}</div>
        </div>
        
        <h4 style="color:#888;font-size:11px;margin:16px 0 8px;text-transform:uppercase;letter-spacing:1px;">Element Calibration</h4>
        <p style="font-size:11px;color:#666;margin-bottom:12px;">Configure selectors for different platforms (Messenger, WhatsApp, etc.)</p>
        
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;" class="calibration-item" data-field="Customer Name">
          <div>
            <div style="font-size:12px;color:#fff;">Customer Name</div>
            <div style="font-size:10px;color:\${nameCount>0?'#22c55e':'#888'};">\${nameCount>0?nameCount+' platform(s) configured':'Not set'}</div>
          </div>
          <div style="color:#f97316;font-size:14px;">→</div>
        </div>
        
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;" class="calibration-item" data-field="Contact 1">
          <div>
            <div style="font-size:12px;color:#fff;">Contact 1 (Phone)</div>
            <div style="font-size:10px;color:\${c1Count>0?'#22c55e':'#888'};">\${c1Count>0?c1Count+' platform(s) configured':'Not set'}</div>
          </div>
          <div style="color:#f97316;font-size:14px;">→</div>
        </div>
        
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;" class="calibration-item" data-field="Contact 2">
          <div>
            <div style="font-size:12px;color:#fff;">Contact 2 (Phone)</div>
            <div style="font-size:10px;color:\${c2Count>0?'#22c55e':'#888'};">\${c2Count>0?c2Count+' platform(s) configured':'Not set'}</div>
          </div>
          <div style="color:#f97316;font-size:14px;">→</div>
        </div>
        
        <button class="akmez-btn" style="width:100%;background:rgba(255,255,255,0.1);margin-bottom:8px;" id="settings-clear-selectors">Clear All Selectors</button>
        
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin:16px 0;"></div>
        
        <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:12px;">
          <div style="font-size:11px;color:#888;margin-bottom:4px;">Version</div>
          <div style="font-size:14px;font-weight:600;color:#fff;">Quick Order v3.0</div>
        </div>
        
        <button class="akmez-btn" style="width:100%;background:rgba(255,255,255,0.1);margin-bottom:8px;" id="settings-refresh">Refresh Data</button>
        <button class="akmez-btn" style="width:100%;background:rgba(239,68,68,0.2);color:#ef4444;border-color:rgba(239,68,68,0.3);" id="settings-logout">Sign Out</button>
        <button class="akmez-btn" style="width:100%;background:transparent;margin-top:16px;" id="settings-back">← Back</button>
      </div>
    \`;
    
    // Calibration item clicks - now opens platform picker
    document.querySelectorAll('.calibration-item').forEach(item=>{
      item.onclick=()=>showPlatformPicker(item.dataset.field);
    });
    
    document.getElementById('settings-clear-selectors').onclick=()=>{
      const keysToRemove=[];
      PLATFORMS.forEach(p=>{
        keysToRemove.push('selector_customer_name_'+p.toLowerCase());
        keysToRemove.push('selector_contact_1_'+p.toLowerCase());
        keysToRemove.push('selector_contact_2_'+p.toLowerCase());
      });
      chrome.storage.local.remove(keysToRemove,()=>{
        toast('All selectors cleared');
        document.getElementById('akmez-settings').click();
      });
    };
    
    document.getElementById('settings-back').onclick=()=>{
      if(currentTab==='orders')loadData();
      else renderWorktime();
    };
    document.getElementById('settings-refresh').onclick=()=>{
      toast('Refreshing data...');
      loadData();
    };
    document.getElementById('settings-logout').onclick=()=>{
      chrome.storage.local.remove(['authToken','tokenExpiry','userName']);
      authToken=null;
      toast('Signed out');
      showLogin();
    };
  });
});

// Tab switching
document.querySelectorAll('.akmez-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.akmez-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    currentTab=tab.dataset.tab;
    if(currentTab==='orders'){
      if(authToken)renderForm();
      else showLogin();
    }else{
      renderWorktime();
    }
  });
});

function toast(msg){
  const t=document.createElement('div');
  t.className='akmez-toast';
  t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),2000);
}

function loadData(){
  const body=document.getElementById('akmez-body');
  body.innerHTML='<div class="akmez-loading"><div class="akmez-spinner"></div><p>Connecting...</p></div>';
  
  // Check memory variable first (set after successful login)
  if(authToken){
    console.log('[v0] loadData - using memory token');
    fetchWithToken(authToken);
    return;
  }
  
  // Fall back to storage
  chrome.storage.local.get(['authToken','tokenExpiry'],stored=>{
    console.log('[v0] loadData - stored:', stored.authToken ? 'has token' : 'no token', 'expiry:', stored.tokenExpiry, 'now:', Date.now());
    
    if(stored.authToken){
      // Check if token is expired (tokenExpiry is Unix timestamp in seconds)
      const isExpired = stored.tokenExpiry && Date.now() > stored.tokenExpiry * 1000;
      console.log('[v0] Token expired?', isExpired);
      
      if(!isExpired){
        authToken = stored.authToken;
        fetchWithToken(authToken);
        return;
      }
    }
    
    // No valid token, show login
    showLogin();
  });
}

function fetchWithToken(token){
  const body=document.getElementById('akmez-body');
  console.log('[v0] fetchWithToken - calling API with token:', token.substring(0,20)+'...');
  
  fetch(API_BASE+'/api/extension',{
    headers:{'Authorization':'Bearer '+token}
  })
  .then(r=>{
    console.log('[v0] API response status:', r.status);
    return r.json();
  })
  .then(data=>{
    console.log('[v0] API response data:', data.authenticated, data.products?.length || 0, 'products');
    
    if(!data.authenticated){
      console.log('[v0] Not authenticated - clearing token');
      chrome.storage.local.remove(['authToken','tokenExpiry']);
      authToken=null;
      showLogin();
      return;
    }
    products=data.products||[];
    regions=data.regions||[];
    renderForm();
  })
  .catch(e=>{
    console.log('[v0] Fetch error:', e);
    body.innerHTML='<div class="akmez-login"><p>Connection failed</p><button class="akmez-login-btn" id="retry-btn">Retry</button></div>';
    document.getElementById('retry-btn').onclick=()=>loadData();
  });
}

function showLogin(){
  const body=document.getElementById('akmez-body');
  body.innerHTML=\`
    <div class="akmez-login">
      <p>Sign in to create orders</p>
      <small style="color:#888;display:block;margin-bottom:16px;">Click the Akmez icon in your browser toolbar to sign in</small>
      <button class="akmez-login-btn" id="akmez-refresh-auth">Check Login Status</button>
    </div>
  \`;
  
  document.getElementById('akmez-refresh-auth').onclick=()=>loadData();
}

// Listen for auth changes from popup
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.authToken&&changes.authToken.newValue){
    authToken=changes.authToken.newValue;
    if(widget.style.display==='block')loadData();
  }
});

function renderWorktime(){
  const body=document.getElementById('akmez-body');
  chrome.storage.local.get(['clockedIn','clockInTime','worktimeHistory'],stored=>{
    clockedIn=stored.clockedIn||false;
    clockInTime=stored.clockInTime||null;
    const history=stored.worktimeHistory||[];
    
    body.innerHTML=\`
      <div class="akmez-worktime">
        <div class="akmez-worktime-status \${clockedIn?'':'out'}">
          <span class="status-dot"></span>
          <span class="status-text">\${clockedIn?'Currently Working':'Not Clocked In'}</span>
        </div>
        <div class="akmez-timer" id="akmez-timer">\${clockedIn?formatTime(Date.now()-clockInTime):'00:00:00'}</div>
        <div class="akmez-worktime-info">\${clockedIn?'Started at <span>'+new Date(clockInTime).toLocaleTimeString()+'</span>':'Enter PIN to clock in'}</div>
        <div class="akmez-pin-wrap">
          <input type="password" class="akmez-pin" maxlength="1" id="pin1">
          <input type="password" class="akmez-pin" maxlength="1" id="pin2">
          <input type="password" class="akmez-pin" maxlength="1" id="pin3">
          <input type="password" class="akmez-pin" maxlength="1" id="pin4">
        </div>
        <div class="akmez-error" id="pin-error"></div>
        <button class="akmez-clock-btn \${clockedIn?'out':'in'}" id="clock-btn">\${clockedIn?'Clock Out':'Clock In'}</button>
        \${history.length>0?'<div class="akmez-history"><h4>Recent Sessions</h4>'+history.slice(0,3).map(h=>'<div class="akmez-history-item"><span class="date">'+h.date+'</span><span class="hours">'+h.hours+'</span></div>').join('')+'</div>':''}
      </div>
    \`;
    
    if(clockedIn)startTimer();
    
    // PIN input handling
    const pins=[document.getElementById('pin1'),document.getElementById('pin2'),document.getElementById('pin3'),document.getElementById('pin4')];
    pins.forEach((pin,i)=>{
      pin.addEventListener('input',()=>{if(pin.value.length===1&&i<3)pins[i+1].focus();});
      pin.addEventListener('keydown',e=>{if(e.key==='Backspace'&&pin.value===''&&i>0)pins[i-1].focus();});
    });
    
    document.getElementById('clock-btn').addEventListener('click',async()=>{
      const pin=pins.map(p=>p.value).join('');
      const err=document.getElementById('pin-error');
      if(pin.length!==4){err.textContent='Enter 4-digit PIN';err.style.display='block';return;}
      
      const btn=document.getElementById('clock-btn');
      btn.disabled=true;
      
      chrome.runtime.sendMessage({action:'worktime',data:{pin,action:clockedIn?'clock-out':'clock-in'}},res=>{
        if(!res||!res.success||!res.data.success){
          err.textContent=res?.data?.error||'Invalid PIN';
          err.style.display='block';
          btn.disabled=false;
          return;
        }
        
        if(clockedIn){
          const duration=formatTime(Date.now()-clockInTime);
          const historyEntry={date:new Date().toLocaleDateString(),hours:duration};
          const newHistory=[historyEntry,...history].slice(0,10);
          chrome.storage.local.set({clockedIn:false,clockInTime:null,worktimeHistory:newHistory});
          clearInterval(timerInterval);
        }else{
          chrome.storage.local.set({clockedIn:true,clockInTime:Date.now()});
        }
        renderWorktime();
      });
    });
  });
}

function formatTime(ms){
  const secs=Math.floor(ms/1000);
  const h=Math.floor(secs/3600);
  const m=Math.floor((secs%3600)/60);
  const s=secs%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}

function startTimer(){
  clearInterval(timerInterval);
  timerInterval=setInterval(()=>{
    const timer=document.getElementById('akmez-timer');
    if(timer&&clockInTime)timer.textContent=formatTime(Date.now()-clockInTime);
  },1000);
}

function renderForm(){
  const body=document.getElementById('akmez-body');
  body.innerHTML=\`
    <div class="akmez-user"><span class="dot"></span>Connected</div>
    <div class="akmez-error" id="form-error"></div>
    <div class="akmez-row">
      <div class="akmez-field" style="flex:1">
        <div class="akmez-label">Name <span class="req">*</span></div>
        <div class="akmez-input-wrap">
          <input type="text" class="akmez-input" id="ak-name" placeholder="Customer name">
          <button class="akmez-paste" data-t="ak-name">PASTE</button>
        </div>
      </div>
    </div>
    <div class="akmez-row">
      <div class="akmez-field">
        <div class="akmez-label">Contact 1 <span class="req">*</span></div>
        <div class="akmez-input-wrap">
          <input type="text" class="akmez-input" id="ak-c1" placeholder="Phone">
          <button class="akmez-paste" data-t="ak-c1">PASTE</button>
        </div>
      </div>
      <div class="akmez-field">
        <div class="akmez-label">Contact 2</div>
        <div class="akmez-input-wrap">
          <input type="text" class="akmez-input" id="ak-c2" placeholder="Optional">
          <button class="akmez-paste" data-t="ak-c2">PASTE</button>
        </div>
      </div>
    </div>
    <div class="akmez-row">
      <div class="akmez-field">
        <div class="akmez-label">Region <span class="req">*</span></div>
        <select class="akmez-select" id="ak-region">
          <option value="">Select...</option>
          \${regions.map(r=>'<option value="'+r+'">'+r+'</option>').join('')}
        </select>
      </div>
      <div class="akmez-field">
        <div class="akmez-label">Date</div>
        <input type="date" class="akmez-input" id="ak-date" value="\${new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    <div class="akmez-section">Add Products</div>
    <input type="text" class="akmez-input" id="ak-search" placeholder="Type to search \${products.length} products..." style="margin-bottom:8px;">
    <div id="ak-hint" style="text-align:center;color:#666;font-size:11px;padding:10px;">Type at least 2 letters to search</div>
    <div class="akmez-products" id="ak-products" style="display:none;">
      \${products.map(p=>{
        const imgHtml=p.image_url?'<img class="img" src="'+p.image_url+'" alt="">':'<div class="img-placeholder">📦</div>';
        const tags=[];
        if(p.is_b1g1)tags.push('<span class="tag">B1G1</span>');
        if(p.bundle_prices&&Object.keys(p.bundle_prices).length>0)tags.push('<span class="tag">Bundle</span>');
        if(p.has_variants&&p.variants&&p.variants.length>0)tags.push('<span class="tag">'+p.variants.length+' variants</span>');
        const tagsHtml=tags.length>0?'<div class="tags">'+tags.join('')+'</div>':'';
        const variantsData=p.has_variants&&p.variants?JSON.stringify(p.variants).replace(/"/g,'&quot;'):'[]';
        return '<div class="akmez-product" data-id="'+p.id+'" data-name="'+p.name+'" data-price="'+p.price+'" data-img="'+(p.image_url||'')+'" data-b1g1="'+(p.is_b1g1?'1':'0')+'" data-bundles="'+(p.bundle_prices?JSON.stringify(p.bundle_prices).replace(/"/g,'&quot;'):'{}')+'" data-variants="'+variantsData+'" data-has-variants="'+(p.has_variants?'1':'0')+'">'+imgHtml+'<div class="info"><div class="name">'+p.name+'</div><div class="price">Rs '+p.price+'</div>'+tagsHtml+'</div></div>';
      }).join('')}
    </div>
    <div id="ak-variant-modal" class="akmez-variant-modal" style="display:none;"></div>
    <div class="akmez-cart" id="ak-cart"><span class="items">0 items</span><span class="total">Rs 0</span></div>
    <button class="akmez-submit" id="ak-submit" disabled>Create Order</button>
  \`;
  
  // Search functionality
  const search=document.getElementById('ak-search');
  const productsDiv=document.getElementById('ak-products');
  const hint=document.getElementById('ak-hint');
  
  search.addEventListener('input',()=>{
    const q=search.value.toLowerCase().trim();
    if(q.length<2){
      productsDiv.style.display='none';
      hint.style.display='block';
      return;
    }
    productsDiv.style.display='grid';
    hint.style.display='none';
    document.querySelectorAll('.akmez-product').forEach(el=>{
      el.style.display=el.dataset.name.toLowerCase().includes(q)?'flex':'none';
    });
  });
  
  // Paste buttons
  document.querySelectorAll('.akmez-paste').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const t=btn.dataset.t;
      try{
        const text=await navigator.clipboard.readText();
        document.getElementById(t).value=text.trim();
        updateSubmitState();
      }catch(e){}
    });
  });
  
  // Auto-fill from calibrated selectors - try all platforms
  chrome.storage.local.get(null,stored=>{
    const platforms=['messenger','whatsapp','instagram','other'];
    
    // Helper to try all platform selectors for a field
    function trySelectors(fieldKey,inputId,isPhone){
      for(const p of platforms){
        const selector=stored['selector_'+fieldKey+'_'+p];
        if(selector){
          try{
            const el=document.querySelector(selector);
            if(el){
              let text=el.textContent||el.innerText||el.value||'';
              if(isPhone)text=text.replace(/[^0-9+]/g,'');
              if(text.trim()){
                document.getElementById(inputId).value=text.trim();
                return true;
              }
            }
          }catch(e){}
        }
      }
      return false;
    }
    
    trySelectors('customer_name','ak-name',false);
    trySelectors('contact_1','ak-c1',true);
    trySelectors('contact_2','ak-c2',true);
    updateSubmitState();
  });
  
  // Variant modal
  const variantModal=document.getElementById('ak-variant-modal');
  
  function showVariantModal(productEl){
    const name=productEl.dataset.name;
    const price=productEl.dataset.price;
    const img=productEl.dataset.img;
    const variants=JSON.parse(productEl.dataset.variants||'[]');
    const productId=productEl.dataset.id;
    
    const imgHtml=img?'<img class="akmez-variant-img" src="'+img+'" alt="">':'';
    
    variantModal.innerHTML=\`
      <div class="akmez-variant-content">
        <div class="akmez-variant-header">
          <h4>\${name}</h4>
          <button class="akmez-variant-close">×</button>
        </div>
        \${imgHtml}
        <p style="color:#888;font-size:11px;margin-bottom:12px;">Select a variant:</p>
        <div class="akmez-variant-list">
          \${variants.map(v=>\`
            <div class="akmez-variant-item" data-product-id="\${productId}" data-variant-id="\${v.id}" data-variant-name="\${v.attribute_name}: \${v.attribute_value}" data-price="\${v.price_override||price}">
              <div>
                <div class="attr">\${v.attribute_name}: \${v.attribute_value}</div>
                <div class="stock">Stock: \${v.quantity}</div>
              </div>
              <div class="vprice">Rs \${v.price_override||price}</div>
            </div>
          \`).join('')}
        </div>
      </div>
    \`;
    
    variantModal.style.display='flex';
    
    variantModal.querySelector('.akmez-variant-close').onclick=()=>variantModal.style.display='none';
    
    variantModal.querySelectorAll('.akmez-variant-item').forEach(vItem=>{
      vItem.onclick=()=>{
        const cartKey=vItem.dataset.productId+'_'+vItem.dataset.variantId;
        if(!cart[cartKey])cart[cartKey]={qty:0,name:name+' ('+vItem.dataset.variantName+')',price:parseFloat(vItem.dataset.price)};
        cart[cartKey].qty++;
        updateCart();
        updateSubmitState();
        variantModal.style.display='none';
      };
    });
  }
  
  // Product selection
  document.querySelectorAll('.akmez-product').forEach(el=>{
    el.addEventListener('click',()=>{
      const hasVariants=el.dataset.hasVariants==='1';
      const variants=JSON.parse(el.dataset.variants||'[]');
      
      if(hasVariants&&variants.length>0){
        showVariantModal(el);
        return;
      }
      
      const id=el.dataset.id;
      if(!cart[id])cart[id]={qty:0,name:el.dataset.name,price:parseFloat(el.dataset.price)};
      cart[id].qty++;
      updateCart();
      updateSubmitState();
    });
    el.addEventListener('contextmenu',e=>{
      e.preventDefault();
      const id=el.dataset.id;
      // Find matching cart entry (could be base product or variant)
      const cartKey=Object.keys(cart).find(k=>k===id||k.startsWith(id+'_'));
      if(cartKey&&cart[cartKey]&&cart[cartKey].qty>0){
        cart[cartKey].qty--;
        if(cart[cartKey].qty===0)delete cart[cartKey];
        updateCart();
        updateSubmitState();
      }
    });
  });
  
  // Form validation
  ['ak-name','ak-c1','ak-region'].forEach(id=>{
    document.getElementById(id).addEventListener('input',updateSubmitState);
    document.getElementById(id).addEventListener('change',updateSubmitState);
  });
  
  // Submit
  document.getElementById('ak-submit').addEventListener('click',submitOrder);
}

function updateCart(){
  const cartDiv=document.getElementById('ak-cart');
  const entries=Object.entries(cart).filter(([,item])=>item.qty>0);
  if(!entries.length){
  cartDiv.style.display='none';
  // Clear badges
  document.querySelectorAll('.akmez-product .badge').forEach(b=>b.remove());
  return;
  }
  let totalQty=0,totalAmt=0;
  entries.forEach(([key,item])=>{
  totalQty+=item.qty;
  totalAmt+=item.price*item.qty;
  });
  cartDiv.style.display='flex';
  cartDiv.querySelector('.items').textContent=totalQty+' item'+(totalQty>1?'s':'');
  cartDiv.querySelector('.total').textContent='Rs '+totalAmt.toLocaleString();
  
  // Update badges on products
  document.querySelectorAll('.akmez-product').forEach(el=>{
    const existingBadge=el.querySelector('.badge');
    if(existingBadge)existingBadge.remove();
    
    const productId=el.dataset.id;
    // Count all cart items for this product (base + variants)
    let productQty=0;
    Object.entries(cart).forEach(([key,item])=>{
      if(key===productId||key.startsWith(productId+'_')){
        productQty+=item.qty;
      }
    });
    
    if(productQty>0){
      el.classList.add('sel');
      const badge=document.createElement('div');
      badge.className='badge';
      badge.textContent=productQty;
      el.appendChild(badge);
    }else{
      el.classList.remove('sel');
    }
  });
  
  }
  
  function updateSubmitState(){
  const name=document.getElementById('ak-name').value.trim();
  const c1=document.getElementById('ak-c1').value.trim();
  const region=document.getElementById('ak-region').value;
  const hasProducts=Object.values(cart).some(item=>item.qty>0);
  document.getElementById('ak-submit').disabled=!name||!c1||!region||!hasProducts;
  }
  
  function submitOrder(){
  const btn=document.getElementById('ak-submit');
  const err=document.getElementById('form-error');
  btn.disabled=true;
  btn.textContent='Creating...';
  err.style.display='none';
  
  // Build products array from new cart structure
  const cartProducts=Object.entries(cart).filter(([,item])=>item.qty>0).map(([key,item])=>{
    return {name:item.name,price:item.price,qty:item.qty};
  });
  
  const data={
  customerName:document.getElementById('ak-name').value.trim(),
  contact1:document.getElementById('ak-c1').value.trim(),
  contact2:document.getElementById('ak-c2').value.trim(),
  region:document.getElementById('ak-region').value,
  deliveryDate:document.getElementById('ak-date').value,
  products:cartProducts
  };
  
  chrome.runtime.sendMessage({action:'createOrder',data},res=>{
    if(!res||!res.success||res.data.error){
      err.textContent=res?.data?.error||'Failed to create order';
      err.style.display='block';
      btn.disabled=false;
      btn.textContent='Create Order';
      return;
    }
    
    document.getElementById('akmez-body').innerHTML=\`
      <div class="akmez-success">
        <div class="check">✓</div>
        <h3>Order Created!</h3>
        <p>\${data.customerName}</p>
        <button id="ak-new">Create Another</button>
      </div>
    \`;
    cart={};
    document.getElementById('ak-new').onclick=()=>renderForm();
  });
}

// Text selection popup
const sel=document.createElement('div');
sel.id='akmez-sel';
sel.innerHTML='<button data-f="name">Name</button><button data-f="c1">C1</button><button data-f="c2">C2</button>';
document.body.appendChild(sel);

document.addEventListener('mouseup',e=>{
  if(e.target.closest('#akmez-sel,#akmez-widget'))return;
  setTimeout(()=>{
    const s=window.getSelection(),t=s.toString().trim();
    if(t&&t.length>0&&t.length<200){
      const r=s.getRangeAt(0).getBoundingClientRect();
      sel.style.display='flex';
      sel.style.left=Math.max(10,r.left)+'px';
      sel.style.top=(r.bottom+8)+'px';
      sel.dataset.text=t;
    }else{
      sel.style.display='none';
    }
  },10);
});

document.addEventListener('mousedown',e=>{
  if(!e.target.closest('#akmez-sel'))setTimeout(()=>sel.style.display='none',100);
});

sel.onclick=async e=>{
  const b=e.target.closest('button');
  if(!b)return;
  const t=sel.dataset.text;
  if(t){
    await navigator.clipboard.writeText(t);
    const fieldMap={name:'ak-name',c1:'ak-c1',c2:'ak-c2'};
    const inp=document.getElementById(fieldMap[b.dataset.f]);
    if(inp)inp.value=t;
    toast('Copied: '+t.substring(0,20));
    sel.style.display='none';
    window.getSelection().removeAllRanges();
    updateSubmitState();
  }
};
`

const CONTENT_CSS = ``

const ICON_16_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADsSURBVDiNpZMxDoJAEEXfLBQWJhZewMbCA3gGj+FRPIIntbGwsvECNhYWxATiAsuyO2NBYwj+ZDKZyfy/M0kHf0K7AULAg4gMjLEvy0IAOJBSLnvAtwgR4YDZ8wnDIWQZVBVUVefP80opuG0LlwuEYUgqRFYlqOuamOQXjDEURcFsNsPzPNrtNnEcc7/fKcuSzWbDcrnkdrvRNA1ZljGdTnFdl+12i+M4OI7D4XBAa41SCsdxHpBOp8NqtWI+n3M6nYjjmMPhwHg8ptvtYq0lSRL2+z1SSqSUz/8JCIKAtm1xXZcwDN9GEkJ8C/6FLyI2TVG0Y+xYAAAAAElFTkSuQmCC'
const ICON_48_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAGXSURBVGiB7ZoxSgNBFIa/t9loYWVhZ+MBbCw8gGfwGF7Fk3hSGwsrGy9gY2FhTETIJmE3uzNjEYMh5k9mZjdZC/fB8Gbm/d+b2Z0Z+E/oF0AI+BCRQdd1T+dzCAAX1trzLnAtIhzwnD5hOoXhEPIc6hqqqus951qp4HY+w/kMIYxIheiqAl1XN5LsgMuS+XyB7+PoOI4pioLFYkGWZbTbbfI85/F4pCxL1us1q9WK8/nM7Xaj6zryPGc2m+H7Puv1Gsdx8DyP/X6P1hohhcBxnBvI6XQ6rFYr5vM5p9OJPMvZ7/dMp1P6/T5aa/I8Z7vdIqVESvnwfwIcxyGOYyzLwnVdwjC8MSKG+Ff4IxIEAV3X4fs+YRj+mUgI8Sv4B58iEkLMBhGRSKRyOP+HbJpGnE4nPM9jMpk8R0VIfgj8hciybJpGNE0jpJRMJpNnVITkh8BfiMRxPBhEGCQik8kkFJFOZMQHYn9C4u/AH4hEIjIYRBgkIpHIZDIJRaQTGfGB2J+Q+DvwByKRyGAQYZCIRCKTySQUkU5kxAcShskFqnLHPwAAAABJRU5ErkJggg=='
const ICON_128_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAOxAAADsQBlSsOGwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAANGSURBVHic7d0xaxRBGMbx/73DxsJCsLCxs/EANhYewDN4DK/iSTyph4WVjRewsbCwJiLkcrmb3dnZsUgIIeab2Zm9u5T/B4acZub59p29y9yBiIiIiIiIiIiIiIiIiIiIiIhI8vr9PkEQ+I7jhBgjYIwRMPZ9qW4/APb7fdrtdgCEGCNgjJExdpD0EgHD4dD3fZ8wDAmCgDAM8TwPz/MIgoDxeEwURYxGI8bjMcPhkCAIGI1GjMdjgiAgiiLG4zFhGBKG4ZPxIYQPj7Hv+4RhiBdFEVEUEQQBURQRRRFBEDAej4miiCAIvp7f9/05xniOIb8LmE6njEYjPM9jNBoxHo9fxwuCgNFoRBRFeJ7HeDwmCALG4zGe5xGGIePxuGu3283kcvk5Xs7j3gVAp9NBSkmn0+H4+JjJZMLJyQntdpvJZEKn06HdbhOGIe12m3a7zXg8Jgx/7AKj0ahb1+VO5OFsNuN8Puc8z+fz+Ww2m89ns9lsNptN53POu06aM5vNOEfO+X4XGAwGdLtdOp0O3W6Xfr/PYDCg2+0ymUy67XYby7Lo9/u02236/T6TyaRrWRb9fh/bthuWZTE4PLT++ecfyuUyr1+/ZjQa4fs+nueRZRl5ntPr9XAcB8/z8H0f13VxXRfP83Ach16vh+/7uK5Lr9fDdV0cxwFgNpthWRaTyYRer8dgMKDX6zGZTLBtmyzLsG2bfr9Pt9ul3+9j2za2bZNlGf1+n06nQ6fTwbZtHMfBcRwcx8Gybfq2bdPpdKg5joPjOJycnDCdTjk5OaHX69Hv9zk5OcG2bbrdbmKbTqdDp9Oh0+ngeR62bSckCAIcx8G2bYbDIZ1OB8/z6HQ6BEFAEAR0Oh0sy8J1XTqdDv1+n263i+u6ZFlGlmVYlkWWZViWheu6uK5Lt9ul1+thWRaO42BZFrZt02q1uvy2bWPbNq1Wi1arxXA4pNVq0el0sG2bTqeDZVkMh0Oq1SqWZWFZFu12m2q1SrVaxbIs2u02rVaLTqdDq9Wi0+kwHA4ZDodYlkW73Sb7lf+rQgiha9u2bdutfr+fLJfLyWKxmCwWi8lisZguFovJarVa7e/vm/V6nQaDgdNqteh0OlQqlUqlUqlUKpUKIiIi8rf8BBxpQJlJZ0nZAAAAAElFTkSuQmCC'

export async function GET() {
  try {
    const zip = new JSZip()
    zip.file('manifest.json', MANIFEST)
    zip.file('background.js', BACKGROUND_JS)
    zip.file('popup.html', POPUP_HTML)
    zip.file('popup.js', POPUP_JS)
    zip.file('content.js', CONTENT_JS)
    zip.file('content.css', CONTENT_CSS)
    zip.file('icon16.png', ICON_16_BASE64, { base64: true })
    zip.file('icon48.png', ICON_48_BASE64, { base64: true })
    zip.file('icon128.png', ICON_128_BASE64, { base64: true })
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' })
    return new NextResponse(zipContent, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="akmez-quick-order-v3.0.8.zip"',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('Error creating extension zip:', error)
    return NextResponse.json({ error: 'Failed to create extension package' }, { status: 500 })
  }
}
