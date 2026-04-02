import { NextResponse } from 'next/server'
import JSZip from 'jszip'

// Embedded extension files
const MANIFEST = `{
  "manifest_version": 3,
  "name": "Akmez Quick Order",
  "version": "2.3.0",
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
if(request.action==='fetchData'){fetch(API_BASE+'/api/extension',{credentials:'include'}).then(r=>r.json()).then(d=>sendResponse({success:true,data:d})).catch(e=>sendResponse({success:false,error:e.message}));return true;}
if(request.action==='createOrder'){fetch(API_BASE+'/api/extension',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(request.data)}).then(r=>r.json()).then(d=>sendResponse({success:true,data:d})).catch(e=>sendResponse({success:false,error:e.message}));return true;}
});`

const POPUP_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 280px;
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
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
    }
    .header h1 { font-size: 15px; font-weight: 700; }
    .header .sub { font-size: 10px; opacity: 0.8; }
    .content { padding: 16px; }
    .status-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .status-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      margin: 0 auto 12px;
    }
    .status-icon.online { background: rgba(16,185,129,0.2); }
    .status-icon.offline { background: rgba(239,68,68,0.2); }
    .status-text { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .status-sub { font-size: 11px; color: #888; margin-bottom: 16px; }
    .login-form { margin-top: 12px; }
    .login-field { margin-bottom: 10px; }
    .login-field input {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 10px 12px;
      color: #fff;
      font-size: 13px;
      outline: none;
    }
    .login-field input:focus { border-color: #f97316; }
    .login-field input::placeholder { color: #555; }
    .login-error {
      background: rgba(239,68,68,0.1);
      border-radius: 6px;
      padding: 8px;
      color: #fca5a5;
      font-size: 11px;
      margin-bottom: 10px;
      display: none;
    }
    .btn {
      width: 100%;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-primary { background: linear-gradient(135deg, #f97316, #ea580c); color: white; }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: rgba(255,255,255,0.1); color: #888; margin-top: 8px; }
    .btn-secondary:hover { background: rgba(255,255,255,0.15); }
    .hint {
      font-size: 10px;
      color: #666;
      text-align: center;
      margin-top: 12px;
      line-height: 1.4;
    }
    .version {
      font-size: 9px;
      color: #444;
      text-align: center;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">A</div>
    <div>
      <h1>Akmez Quick Order</h1>
      <div class="sub">v2.3.0</div>
    </div>
  </div>
  <div class="content" id="content">
    <div class="status-card">
      <div class="status-icon offline">?</div>
      <div class="status-text">Checking...</div>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>`

const POPUP_JS = `const API_BASE = 'https://www.akmez.tech';
const content = document.getElementById('content');

async function init() {
  try {
    const stored = await chrome.storage.local.get(['authToken', 'tokenExpiry', 'userName']);
    if (stored.authToken && stored.tokenExpiry && Date.now() < stored.tokenExpiry * 1000) {
      // Verify token is still valid
      const res = await fetch(API_BASE + '/api/extension', { headers: { 'Authorization': 'Bearer ' + stored.authToken } });
      const data = await res.json();
      if (data.authenticated) {
        showLoggedIn(stored.userName || 'Agent');
      } else {
        await chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName']);
        showLoginForm();
      }
    } else {
      showLoginForm();
    }
  } catch (err) {
    showLoginForm();
  }
}

function showLoggedIn(name) {
  content.innerHTML = '<div class="status-card"><div class="status-icon online">✓</div><div class="status-text">Logged In</div><div class="status-sub">' + name + '</div><button class="btn btn-secondary" id="logoutBtn">Sign Out</button></div><div class="hint">Click the orange <b>A</b> button on any webpage to create orders</div><div class="version">v2.3.0</div>';
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName']);
    showLoginForm();
  });
}

function showLoginForm() {
  content.innerHTML = '<div class="status-card"><div class="status-icon offline">!</div><div class="status-text">Not Logged In</div><div class="status-sub">Sign in to create orders</div><div class="login-form"><div class="login-error" id="loginError"></div><div class="login-field"><input type="email" id="loginEmail" placeholder="Email"></div><div class="login-field"><input type="password" id="loginPassword" placeholder="Password"></div><button class="btn btn-primary" id="loginBtn">Sign In</button></div></div><div class="hint">Click the orange <b>A</b> button on any webpage to create orders</div><div class="version">v2.3.0</div>';
  const btn = document.getElementById('loginBtn'), err = document.getElementById('loginError'), email = document.getElementById('loginEmail'), pwd = document.getElementById('loginPassword');
  btn.addEventListener('click', async () => {
    if (!email.value.trim() || !pwd.value) { err.textContent = 'Enter email and password'; err.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Signing in...'; err.style.display = 'none';
    try {
      const res = await fetch(API_BASE + '/api/extension/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value.trim(), password: pwd.value }) });
      const data = await res.json();
      if (data.success && data.accessToken) {
        await chrome.storage.local.set({ authToken: data.accessToken, tokenExpiry: data.expiresAt, userName: data.user?.name || '' });
        showLoggedIn(data.user?.name || 'Agent');
      } else { err.textContent = data.error || 'Invalid credentials'; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Sign In'; }
    } catch (e) { err.textContent = 'Connection error'; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Sign In'; }
  });
  pwd.addEventListener('keypress', (e) => { if (e.key === 'Enter') btn.click(); });
}

init();`

const CONTENT_JS = `const API_BASE='https://www.akmez.tech';
let products=[],regions=[],cart={},settings={nameSelector:''},authToken=null,isPicking=false;

// Create UI elements
const toggleBtn=document.createElement('div');
toggleBtn.id='akmez-toggle';
toggleBtn.innerHTML='<span>A</span>';
document.body.appendChild(toggleBtn);

const widget=document.createElement('div');
widget.id='akmez-widget';
widget.innerHTML='<div class="akmez-header" id="akmez-drag"><div class="akmez-logo">A</div><span class="akmez-title">Quick Order</span><div class="akmez-header-btns"><button class="akmez-hbtn" id="akmez-settings" title="Settings">⚙</button><button class="akmez-hbtn" id="akmez-close" title="Close">×</button></div></div><div class="akmez-body" id="akmez-body"><div class="akmez-loading"><div class="akmez-spinner"></div></div></div>';
widget.style.display='none';
document.body.appendChild(widget);

const picker=document.createElement('div');
picker.id='akmez-picker';
picker.innerHTML='<div class="picker-msg">Click on any element to select it for auto-fill</div><button id="picker-cancel">Cancel</button>';
picker.style.display='none';
document.body.appendChild(picker);

const highlight=document.createElement('div');
highlight.id='akmez-highlight';
highlight.style.display='none';
document.body.appendChild(highlight);

// Inject styles
const style=document.createElement('style');
style.textContent=`
#akmez-toggle{position:fixed;bottom:20px;right:20px;width:56px;height:56px;background:linear-gradient(135deg,#f97316,#ea580c);border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483646;box-shadow:0 4px 20px rgba(249,115,22,0.5);font-family:sans-serif;transition:transform .15s}
#akmez-toggle:hover{transform:scale(1.1)}
#akmez-toggle span{color:white;font-size:24px;font-weight:800}
#akmez-widget{position:fixed;top:60px;right:20px;width:380px;max-height:90vh;background:#0f0f1a;border-radius:16px;box-shadow:0 10px 50px rgba(0,0,0,0.6);border:2px solid #f97316;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;overflow:hidden}
.akmez-header{background:linear-gradient(135deg,#f97316,#ea580c);padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:move;user-select:none}
.akmez-logo{width:26px;height:26px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.akmez-title{flex:1;font-weight:700;font-size:13px}
.akmez-header-btns{display:flex;gap:4px}
.akmez-hbtn{width:24px;height:24px;border:none;border-radius:6px;background:rgba(255,255,255,0.2);color:white;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.akmez-hbtn:hover{background:rgba(255,255,255,0.3)}
.akmez-body{padding:12px;max-height:calc(90vh - 50px);overflow-y:auto}
.akmez-loading{text-align:center;padding:30px;color:#888}
.akmez-spinner{width:28px;height:28px;border:3px solid rgba(249,115,22,0.2);border-top-color:#f97316;border-radius:50%;animation:akspin .8s linear infinite;margin:0 auto}
@keyframes akspin{to{transform:rotate(360deg)}}
.akmez-row{display:flex;gap:6px;margin-bottom:8px}
.akmez-field{flex:1}
.akmez-label{font-size:9px;color:#666;text-transform:uppercase;margin-bottom:3px}
.akmez-label .req{color:#f97316}
.akmez-input-wrap{position:relative}
.akmez-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 50px 8px 10px;color:white;font-size:12px;outline:none}
.akmez-input:focus{border-color:#f97316}
.akmez-select{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 10px;color:white;font-size:12px;outline:none}
.akmez-select option{background:#1a1a2e;color:white}
.akmez-paste{position:absolute;right:4px;top:50%;transform:translateY(-50%);background:rgba(249,115,22,0.3);border:none;border-radius:4px;padding:4px 6px;color:#f97316;font-size:8px;font-weight:700;cursor:pointer}
.akmez-paste:hover{background:rgba(249,115,22,0.5)}
.akmez-section{font-size:10px;color:#f97316;text-transform:uppercase;margin:12px 0 6px;font-weight:600}
.akmez-search{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:6px 10px;color:white;font-size:11px;outline:none;margin-bottom:6px}
.akmez-search:focus{border-color:#f97316}
.akmez-products{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-height:120px;overflow-y:auto}
.akmez-product{position:relative;padding:6px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;font-size:10px;cursor:pointer;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.akmez-product:hover{background:rgba(249,115,22,0.15);border-color:#f97316}
.akmez-product.sel{background:linear-gradient(135deg,#f97316,#ea580c);border-color:#f97316}
.akmez-product.hidden{display:none}
.akmez-product .badge{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;background:#10b981;border-radius:7px;font-size:8px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px}
.akmez-cart{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:8px 10px;margin-top:8px;display:flex;justify-content:space-between;font-size:11px}
.akmez-cart .items{color:#6ee7b7}
.akmez-cart .total{color:#10b981;font-weight:700}
.akmez-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px;color:#fca5a5;font-size:10px;margin-top:8px}
.akmez-submit{width:100%;padding:10px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:8px;color:white;font-size:12px;font-weight:700;cursor:pointer;margin-top:10px;text-transform:uppercase}
.akmez-submit:disabled{opacity:0.5;cursor:not-allowed}
.akmez-success{text-align:center;padding:20px}
.akmez-success .check{font-size:40px;color:#10b981}
.akmez-success h3{color:#10b981;margin:8px 0 4px}
.akmez-success p{color:#6ee7b7;font-size:11px;margin-bottom:12px}
.akmez-success button{background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.3);color:#10b981;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:11px}
.akmez-login{text-align:center;padding:20px}
.akmez-login p{color:#888;margin-bottom:12px;font-size:12px}
.akmez-login button{background:linear-gradient(135deg,#f97316,#ea580c);border:none;color:white;padding:10px 20px;border-radius:8px;font-weight:600;cursor:pointer;font-size:12px}
.akmez-settings{background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px}
.akmez-settings h3{font-size:12px;color:#f97316;margin-bottom:10px}
.akmez-settings .row{margin-bottom:10px}
.akmez-settings label{display:block;font-size:10px;color:#888;margin-bottom:4px}
.akmez-settings input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px;color:white;font-size:11px;outline:none}
.akmez-settings input:focus{border-color:#f97316}
.akmez-settings .hint{font-size:9px;color:#555;margin-top:4px}
.akmez-settings .btns{display:flex;gap:6px;margin-top:12px}
.akmez-settings .btns button{flex:1;padding:8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:none}
.akmez-settings .pick-btn{background:#8b5cf6;color:white}
.akmez-settings .save-btn{background:#f97316;color:white}
.akmez-settings .cancel-btn{background:rgba(255,255,255,0.1);color:#888}
#akmez-picker{position:fixed;top:0;left:0;right:0;background:rgba(139,92,246,0.95);color:white;padding:12px;text-align:center;z-index:2147483648;font-family:sans-serif}
.picker-msg{font-size:14px;font-weight:600;margin-bottom:8px}
#picker-cancel{background:white;color:#8b5cf6;border:none;padding:6px 16px;border-radius:6px;font-weight:600;cursor:pointer}
#akmez-highlight{position:fixed;pointer-events:none;border:3px solid #8b5cf6;background:rgba(139,92,246,0.2);z-index:2147483645;transition:all .1s}
.akmez-toast{position:fixed;bottom:80px;right:20px;background:#10b981;color:white;padding:10px 16px;border-radius:8px;font-size:12px;font-weight:600;z-index:2147483648;animation:aktoast .3s}
@keyframes aktoast{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
#akmez-sel{position:fixed;display:none;background:#1a1a2e;border:1px solid #f97316;border-radius:6px;padding:4px;gap:4px;z-index:2147483648;font-family:sans-serif}
#akmez-sel button{background:rgba(249,115,22,0.2);border:none;color:#f97316;padding:4px 8px;border-radius:4px;font-size:10px;font-weight:600;cursor:pointer}
#akmez-sel button:hover{background:rgba(249,115,22,0.4)}
`;
document.head.appendChild(style);

// Drag functionality
let isDragging=false,dragOffset={x:0,y:0};
document.getElementById('akmez-drag').addEventListener('mousedown',e=>{if(e.target.closest('button'))return;isDragging=true;const r=widget.getBoundingClientRect();dragOffset={x:e.clientX-r.left,y:e.clientY-r.top};});
document.addEventListener('mousemove',e=>{if(!isDragging)return;widget.style.left=Math.max(0,Math.min(window.innerWidth-380,e.clientX-dragOffset.x))+'px';widget.style.top=Math.max(0,Math.min(window.innerHeight-400,e.clientY-dragOffset.y))+'px';widget.style.right='auto';});
document.addEventListener('mouseup',()=>isDragging=false);

// Button handlers
toggleBtn.addEventListener('click',()=>{widget.style.display=widget.style.display==='none'?'block':'none';if(widget.style.display==='block')loadData();});
document.getElementById('akmez-close').addEventListener('click',()=>widget.style.display='none');
document.getElementById('akmez-settings').addEventListener('click',showSettings);

// Load auth token
chrome.storage.local.get(['authToken','tokenExpiry','settings'],stored=>{
  if(stored.authToken&&stored.tokenExpiry&&Date.now()<stored.tokenExpiry*1000)authToken=stored.authToken;
  if(stored.settings)settings=stored.settings;
});

function toast(msg){const t=document.createElement('div');t.className='akmez-toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2000);}

async function loadData(){
  const body=document.getElementById('akmez-body');
  body.innerHTML='<div class="akmez-loading"><div class="akmez-spinner"></div></div>';
  try{
    if(!authToken){body.innerHTML='<div class="akmez-login"><p>Sign in via the extension popup first</p><button id="ak-open-popup">Open Extension</button></div>';return;}
    const res=await fetch(API_BASE+'/api/extension',{headers:{'Authorization':'Bearer '+authToken}});
    const data=await res.json();
    if(!data.authenticated){body.innerHTML='<div class="akmez-login"><p>Session expired. Sign in via popup</p></div>';return;}
    products=data.products||[];regions=data.regions||[];
    renderForm();
    tryAutoFill();
  }catch(e){body.innerHTML='<div class="akmez-error">Connection failed</div>';}
}

function renderForm(){
  const body=document.getElementById('akmez-body');
  body.innerHTML='<div class="akmez-row"><div class="akmez-field"><div class="akmez-label">Name <span class="req">*</span></div><div class="akmez-input-wrap"><input type="text" id="ak-name" class="akmez-input" placeholder="Customer name"><button class="akmez-paste" data-t="ak-name">PASTE</button></div></div></div><div class="akmez-row"><div class="akmez-field"><div class="akmez-label">Contact 1 <span class="req">*</span></div><div class="akmez-input-wrap"><input type="text" id="ak-c1" class="akmez-input" placeholder="Phone"><button class="akmez-paste" data-t="ak-c1">PASTE</button></div></div><div class="akmez-field"><div class="akmez-label">Contact 2</div><div class="akmez-input-wrap"><input type="text" id="ak-c2" class="akmez-input" placeholder="Optional"><button class="akmez-paste" data-t="ak-c2">PASTE</button></div></div></div><div class="akmez-row"><div class="akmez-field"><div class="akmez-label">Region <span class="req">*</span></div><select id="ak-region" class="akmez-select"><option value="">Select...</option>'+regions.map(r=>'<option value="'+r+'">'+r+'</option>').join('')+'</select></div><div class="akmez-field"><div class="akmez-label">Date</div><input type="date" id="ak-date" class="akmez-input" value="'+new Date().toISOString().split('T')[0]+'"></div></div><div class="akmez-section">Products (tap to add)</div><input type="text" class="akmez-search" id="ak-search" placeholder="Search products..."><div class="akmez-products" id="ak-products">'+products.map(p=>'<div class="akmez-product" data-id="'+p.id+'" data-name="'+p.name+'" data-price="'+p.price+'" title="'+p.name+' - Rs '+p.price+'">'+p.name+'</div>').join('')+'</div><div class="akmez-cart" id="ak-cart" style="display:none"><span class="items">0</span><span class="total">Rs 0</span></div><div id="ak-err" class="akmez-error" style="display:none"></div><button class="akmez-submit" id="ak-submit" disabled>Create Order</button>';
  document.getElementById('ak-search').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.akmez-product').forEach(el=>el.classList.toggle('hidden',q&&!el.dataset.name.toLowerCase().includes(q)));});
  body.querySelectorAll('.akmez-paste').forEach(b=>b.onclick=async()=>{try{const t=await navigator.clipboard.readText();document.getElementById(b.dataset.t).value=t.trim();updateSubmit();}catch(e){}});
  body.querySelectorAll('.akmez-product').forEach(el=>{
    el.onclick=()=>{const id=el.dataset.id;if(!cart[id])cart[id]=0;cart[id]++;updateCart();};
    el.oncontextmenu=e=>{e.preventDefault();const id=el.dataset.id;if(cart[id]>0){cart[id]--;if(cart[id]===0)delete cart[id];}updateCart();};
  });
  document.getElementById('ak-name').addEventListener('input',updateSubmit);
  document.getElementById('ak-c1').addEventListener('input',updateSubmit);
  document.getElementById('ak-region').addEventListener('change',updateSubmit);
  document.getElementById('ak-submit').addEventListener('click',submit);
}

function updateCart(){
  const c=document.getElementById('ak-cart');
  const e=Object.entries(cart).filter(([,q])=>q>0);
  if(!e.length){c.style.display='none';updateSubmit();return;}
  let qty=0,amt=0;
  e.forEach(([id,q])=>{qty+=q;const p=products.find(x=>x.id===id);if(p)amt+=parseFloat(p.price)*q;});
  c.style.display='flex';
  c.querySelector('.items').textContent=qty+' item'+(qty>1?'s':'');
  c.querySelector('.total').textContent='Rs '+amt.toLocaleString();
  document.querySelectorAll('.akmez-product').forEach(el=>{
    const q=cart[el.dataset.id]||0;
    el.classList.toggle('sel',q>0);
    let b=el.querySelector('.badge');
    if(q>0){if(!b){b=document.createElement('span');b.className='badge';el.appendChild(b);}b.textContent=q;}
    else if(b)b.remove();
  });
  updateSubmit();
}

function updateSubmit(){
  const name=document.getElementById('ak-name')?.value.trim();
  const c1=document.getElementById('ak-c1')?.value.trim();
  const reg=document.getElementById('ak-region')?.value;
  const hasP=Object.values(cart).some(q=>q>0);
  const btn=document.getElementById('ak-submit');
  if(btn)btn.disabled=!name||!c1||!reg||!hasP;
}

async function submit(){
  const btn=document.getElementById('ak-submit'),err=document.getElementById('ak-err');
  btn.disabled=true;btn.textContent='Creating...';err.style.display='none';
  const e=Object.entries(cart).filter(([,q])=>q>0);
  let qty=0,amt=0;
  const prods=e.map(([id,q])=>{qty+=q;const p=products.find(x=>x.id===id);if(p)amt+=parseFloat(p.price)*q;return p?p.name+' x'+q:'';}).filter(Boolean).join(', ');
  const data={customerName:document.getElementById('ak-name').value.trim(),contact1:document.getElementById('ak-c1').value.trim(),contact2:document.getElementById('ak-c2').value.trim(),region:document.getElementById('ak-region').value,deliveryDate:document.getElementById('ak-date').value,products:prods,qty,amount:amt};
  try{
    const res=await fetch(API_BASE+'/api/extension',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},body:JSON.stringify(data)});
    const r=await res.json();
    if(r.success){document.getElementById('akmez-body').innerHTML='<div class="akmez-success"><div class="check">✓</div><h3>Order Created!</h3><p>'+data.customerName+'</p><button id="ak-new">New Order</button></div>';cart={};document.getElementById('ak-new').onclick=()=>renderForm();}
    else{err.textContent=r.error||'Failed';err.style.display='block';btn.disabled=false;btn.textContent='Create Order';}
  }catch(e){err.textContent='Connection error';err.style.display='block';btn.disabled=false;btn.textContent='Create Order';}
}

function showSettings(){
  document.getElementById('akmez-body').innerHTML='<div class="akmez-settings"><h3>Settings</h3><div class="row"><label>Customer Name Auto-fill Selector</label><input type="text" id="ak-selector" placeholder="Click Pick Element or enter CSS selector" value="'+(settings.nameSelector||'')+'"><div class="hint">Current: '+(settings.nameSelector||'Not set')+'</div></div><div class="btns"><button class="pick-btn" id="ak-pick">Pick Element</button><button class="cancel-btn" id="ak-cancel">Cancel</button><button class="save-btn" id="ak-save">Save</button></div></div>';
  document.getElementById('ak-pick').onclick=startPicker;
  document.getElementById('ak-cancel').onclick=()=>renderForm();
  document.getElementById('ak-save').onclick=async()=>{
    settings.nameSelector=document.getElementById('ak-selector').value.trim();
    await chrome.storage.local.set({settings});
    toast('Settings saved');
    renderForm();
    tryAutoFill();
  };
}

function startPicker(){
  isPicking=true;
  picker.style.display='block';
  widget.style.display='none';
  document.getElementById('picker-cancel').onclick=()=>{isPicking=false;picker.style.display='none';highlight.style.display='none';widget.style.display='block';};
}

document.addEventListener('mousemove',e=>{
  if(!isPicking)return;
  const el=document.elementFromPoint(e.clientX,e.clientY);
  if(!el||el.closest('#akmez-picker,#akmez-widget,#akmez-toggle'))return;
  const r=el.getBoundingClientRect();
  highlight.style.display='block';
  highlight.style.left=r.left+'px';
  highlight.style.top=r.top+'px';
  highlight.style.width=r.width+'px';
  highlight.style.height=r.height+'px';
});

document.addEventListener('click',e=>{
  if(!isPicking)return;
  if(e.target.closest('#akmez-picker'))return;
  e.preventDefault();e.stopPropagation();
  const el=document.elementFromPoint(e.clientX,e.clientY);
  if(!el)return;
  const selector=getUniqueSelector(el);
  isPicking=false;
  picker.style.display='none';
  highlight.style.display='none';
  widget.style.display='block';
  showSettings();
  setTimeout(()=>{document.getElementById('ak-selector').value=selector;},50);
},true);

function getUniqueSelector(el){
  if(el.id)return '#'+el.id;
  if(el.className){const c=el.className.split(' ').filter(c=>c&&!c.includes('akmez'))[0];if(c)return el.tagName.toLowerCase()+'.'+c;}
  const path=[];let node=el;
  while(node&&node.nodeType===1){let sel=node.tagName.toLowerCase();if(node.id){sel='#'+node.id;path.unshift(sel);break;}
  const sib=node.parentNode?Array.from(node.parentNode.children).filter(c=>c.tagName===node.tagName):[];
  if(sib.length>1)sel+=':nth-child('+(Array.from(node.parentNode.children).indexOf(node)+1)+')';
  path.unshift(sel);node=node.parentNode;}
  return path.slice(-3).join(' > ');
}

function tryAutoFill(){
  if(!settings.nameSelector)return;
  try{
    const el=document.querySelector(settings.nameSelector);
    if(el&&el.textContent){
      const name=el.textContent.trim();
      const inp=document.getElementById('ak-name');
      if(inp&&name)inp.value=name;
      updateSubmit();
    }
  }catch(e){}
}

// Text selection popup
const sel=document.createElement('div');sel.id='akmez-sel';sel.innerHTML='<button data-f="name">Name</button><button data-f="c1">C1</button><button data-f="c2">C2</button>';document.body.appendChild(sel);
document.addEventListener('mouseup',e=>{if(isPicking||e.target.closest('#akmez-sel,#akmez-widget'))return;setTimeout(()=>{const s=window.getSelection(),t=s.toString().trim();if(t&&t.length>0&&t.length<200){const r=s.getRangeAt(0).getBoundingClientRect();sel.style.display='flex';sel.style.left=Math.max(10,r.left)+'px';sel.style.top=(r.bottom+8)+'px';sel.dataset.text=t;}else sel.style.display='none';},10);});
document.addEventListener('mousedown',e=>{if(!e.target.closest('#akmez-sel'))setTimeout(()=>sel.style.display='none',100);});
sel.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const t=sel.dataset.text;if(t){await navigator.clipboard.writeText(t);const inp=document.getElementById('ak-'+b.dataset.f);if(inp)inp.value=t;toast('Copied');sel.style.display='none';window.getSelection().removeAllRanges();updateSubmit();}};
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
        'Content-Disposition': 'attachment; filename="akmez-quick-order-extension.zip"',
      },
    })
  } catch (error) {
    console.error('Error creating extension zip:', error)
    return NextResponse.json({ error: 'Failed to create extension package' }, { status: 500 })
  }
}
