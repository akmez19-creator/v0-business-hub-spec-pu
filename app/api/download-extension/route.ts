import { NextResponse } from 'next/server'
import JSZip from 'jszip'

// Embedded extension files
const MANIFEST = `{
  "manifest_version": 3,
  "name": "Akmez Quick Order",
  "version": "2.1.0",
  "description": "Create delivery orders directly from Facebook Business Suite",
  "permissions": ["activeTab", "clipboardRead", "clipboardWrite", "storage"],
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
      width: 400px;
      max-height: 600px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
      color: #fff;
      overflow-y: auto;
    }
    .header {
      background: linear-gradient(135deg, #f97316, #ea580c);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 10;
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
    .header h1 { font-size: 16px; font-weight: 700; }
    .header .sub { font-size: 10px; opacity: 0.8; }
    .content { padding: 14px; }
    .login-msg {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
    }
    .login-msg p { color: #fca5a5; margin-bottom: 12px; font-size: 13px; line-height: 1.5; }
    .login-btn {
      background: linear-gradient(135deg, #f97316, #ea580c);
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    .login-btn:hover { opacity: 0.9; }
    .form-group { margin-bottom: 12px; }
    .form-group label {
      display: block;
      font-size: 10px;
      font-weight: 600;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 5px;
    }
    .form-group label .req { color: #f97316; }
    .input-row { display: flex; gap: 8px; }
    .input-row .form-group { flex: 1; margin-bottom: 0; }
    input, select, textarea {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      padding: 10px 12px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: all 0.15s;
    }
    input:focus, select:focus, textarea:focus {
      border-color: #f97316;
      background: rgba(249, 115, 22, 0.05);
    }
    input::placeholder, textarea::placeholder { color: #555; }
    select { cursor: pointer; }
    select option { background: #1a1a2e; color: #fff; }
    textarea { resize: none; height: 50px; }
    .input-wrap { position: relative; }
    .input-wrap input { padding-right: 55px; }
    .paste-btn {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(249, 115, 22, 0.3);
      border: none;
      border-radius: 5px;
      padding: 5px 8px;
      color: #f97316;
      font-size: 9px;
      font-weight: 700;
      cursor: pointer;
      text-transform: uppercase;
    }
    .paste-btn:hover { background: rgba(249, 115, 22, 0.5); }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: #f97316;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 16px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid rgba(249, 115, 22, 0.2);
    }
    .products-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 140px;
      overflow-y: auto;
      padding: 2px;
    }
    .product-btn {
      position: relative;
      padding: 8px 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .product-btn:hover {
      background: rgba(249, 115, 22, 0.15);
      border-color: #f97316;
    }
    .product-btn.selected {
      background: linear-gradient(135deg, #f97316, #ea580c);
      border-color: #f97316;
    }
    .product-btn .qty-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      min-width: 16px;
      height: 16px;
      background: #10b981;
      border-radius: 8px;
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 4px;
    }
    .product-btn .price { font-size: 9px; opacity: 0.7; display: block; margin-top: 2px; }
    .cart-summary {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 8px;
      padding: 10px 12px;
      margin-top: 10px;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
    }
    .cart-summary .items { color: #6ee7b7; }
    .cart-summary .total { color: #10b981; font-weight: 700; }
    .submit-btn {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #10b981, #059669);
      border: none;
      border-radius: 10px;
      color: white;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      transition: all 0.15s;
    }
    .submit-btn:hover { transform: scale(1.02); box-shadow: 0 4px 20px rgba(16, 185, 129, 0.3); }
    .submit-btn:active { transform: scale(0.98); }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
    .success-msg {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }
    .success-msg .checkmark { font-size: 48px; margin-bottom: 12px; }
    .success-msg h3 { color: #10b981; margin-bottom: 8px; font-size: 16px; }
    .success-msg p { color: #6ee7b7; font-size: 12px; margin-bottom: 16px; }
    .success-msg .new-order-btn {
      background: rgba(16, 185, 129, 0.2);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #10b981;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      font-size: 12px;
    }
    .error-msg {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      border-radius: 8px;
      padding: 10px;
      color: #fca5a5;
      font-size: 11px;
      margin-bottom: 10px;
    }
    .loading {
      text-align: center;
      padding: 50px 20px;
      color: #888;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(249, 115, 22, 0.2);
      border-top-color: #f97316;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 14px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .user-info {
      background: rgba(139, 92, 246, 0.1);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 11px;
      color: #a5b4fc;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .user-info .dot {
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">A</div>
    <div>
      <h1>Akmez Quick Order</h1>
      <div class="sub">Create orders from anywhere</div>
    </div>
  </div>
  <div class="content" id="content">
    <div class="loading" id="loading">
      <div class="spinner"></div>
      <p>Connecting to Akmez...</p>
    </div>
  </div>
  <script src="popup.js"></script>
</body>
</html>`

const POPUP_JS = `const API_BASE = 'https://www.akmez.tech';
const content = document.getElementById('content');
let products = [];
let regions = [];
let cart = {};

async function init() {
  try {
    const res = await fetch(API_BASE + '/api/extension', { credentials: 'include' });
    const data = await res.json();
    if (!data.success) { showLoginRequired(); return; }
    products = data.products || [];
    regions = data.regions || [];
    chrome.storage.local.get(['name', 'c1', 'c2'], (saved) => { renderForm(saved); });
  } catch (err) { showLoginRequired(); }
}

function showLoginRequired() {
  content.innerHTML = '<div class="login-msg"><p>Please login to Akmez first to create orders.</p><button class="login-btn" id="loginBtn">Open Akmez Login</button></div>';
  document.getElementById('loginBtn').addEventListener('click', () => { chrome.tabs.create({ url: API_BASE + '/auth/sign-in' }); });
}

function renderForm(saved = {}) {
  content.innerHTML = '<div class="user-info"><span class="dot"></span>Connected to Akmez</div><div id="errorMsg" class="error-msg" style="display:none;"></div><div class="form-group"><label>Customer Name <span class="req">*</span></label><div class="input-wrap"><input type="text" id="customerName" placeholder="Paste customer name" value="' + (saved.name || '') + '"><button class="paste-btn" data-target="customerName">Paste</button></div></div><div class="input-row" style="margin-bottom:12px"><div class="form-group"><label>Contact #1 <span class="req">*</span></label><div class="input-wrap"><input type="text" id="contact1" placeholder="Phone" value="' + (saved.c1 || '') + '"><button class="paste-btn" data-target="contact1">Paste</button></div></div><div class="form-group"><label>Contact #2</label><div class="input-wrap"><input type="text" id="contact2" placeholder="Optional" value="' + (saved.c2 || '') + '"><button class="paste-btn" data-target="contact2">Paste</button></div></div></div><div class="input-row" style="margin-bottom:12px"><div class="form-group"><label>Region <span class="req">*</span></label><select id="region"><option value="">Select region...</option>' + regions.map(r => '<option value="' + r + '">' + r + '</option>').join('') + '</select></div><div class="form-group"><label>Delivery Date</label><input type="date" id="deliveryDate" value="' + new Date().toISOString().split('T')[0] + '"></div></div><div class="section-title">Products (click to add)</div><div class="products-grid" id="productsGrid">' + products.map(p => '<button class="product-btn" data-id="' + p.id + '" data-name="' + p.name + '" data-price="' + p.price + '">' + p.name + '<span class="price">Rs ' + p.price + '</span></button>').join('') + '</div><div class="cart-summary" id="cartSummary" style="display:none;"><span class="items" id="cartItems">0 items</span><span class="total" id="cartTotal">Rs 0</span></div><div class="form-group" style="margin-top:12px"><label>Notes</label><textarea id="notes" placeholder="Optional delivery notes"></textarea></div><button class="submit-btn" id="submitBtn" disabled>Create Order</button>';
  document.querySelectorAll('.paste-btn').forEach(btn => { btn.addEventListener('click', async () => { const t = btn.dataset.target; document.getElementById(t).value = (await navigator.clipboard.readText()).trim(); updateSubmitState(); }); });
  document.querySelectorAll('.product-btn').forEach(btn => {
    btn.addEventListener('click', () => { const id = btn.dataset.id, name = btn.dataset.name, price = parseFloat(btn.dataset.price) || 0; if (!cart[id]) cart[id] = { name, price, qty: 0 }; cart[id].qty++; updateUI(); });
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); const id = btn.dataset.id; if (cart[id] && cart[id].qty > 0) { cart[id].qty--; if (cart[id].qty === 0) delete cart[id]; updateUI(); } });
  });
  document.getElementById('customerName').addEventListener('input', updateSubmitState);
  document.getElementById('contact1').addEventListener('input', updateSubmitState);
  document.getElementById('region').addEventListener('change', updateSubmitState);
  document.getElementById('submitBtn').addEventListener('click', submitOrder);
}

function updateUI() { updateProductButtons(); updateCartSummary(); updateSubmitState(); }

function updateProductButtons() {
  document.querySelectorAll('.product-btn').forEach(btn => {
    const id = btn.dataset.id, item = cart[id];
    btn.classList.toggle('selected', item && item.qty > 0);
    const badge = btn.querySelector('.qty-badge'); if (badge) badge.remove();
    if (item && item.qty > 0) { const b = document.createElement('span'); b.className = 'qty-badge'; b.textContent = item.qty; btn.appendChild(b); }
  });
}

function updateCartSummary() {
  const s = document.getElementById('cartSummary'), items = Object.values(cart), tQty = items.reduce((a, i) => a + i.qty, 0), tAmt = items.reduce((a, i) => a + i.price * i.qty, 0);
  if (tQty > 0) { s.style.display = 'flex'; document.getElementById('cartItems').textContent = tQty + ' item' + (tQty > 1 ? 's' : ''); document.getElementById('cartTotal').textContent = 'Rs ' + tAmt.toLocaleString(); }
  else { s.style.display = 'none'; }
}

function updateSubmitState() {
  const name = document.getElementById('customerName').value.trim(), c1 = document.getElementById('contact1').value.trim(), reg = document.getElementById('region').value, hasP = Object.values(cart).some(i => i.qty > 0);
  document.getElementById('submitBtn').disabled = !name || !c1 || !reg || !hasP;
}

async function submitOrder() {
  const btn = document.getElementById('submitBtn'), err = document.getElementById('errorMsg');
  btn.disabled = true; btn.textContent = 'Creating...'; err.style.display = 'none';
  const data = { customerName: document.getElementById('customerName').value.trim(), contact1: document.getElementById('contact1').value.trim(), contact2: document.getElementById('contact2').value.trim(), region: document.getElementById('region').value, deliveryDate: document.getElementById('deliveryDate').value, notes: document.getElementById('notes').value.trim(), products: Object.values(cart).filter(i => i.qty > 0).map(i => ({ name: i.name, price: i.price, qty: i.qty })) };
  try {
    const res = await fetch(API_BASE + '/api/extension', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(data) });
    const r = await res.json();
    if (r.success) { showSuccess(r.createdBy); } else { err.textContent = r.error || 'Failed'; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Create Order'; }
  } catch (e) { err.textContent = 'Connection error'; err.style.display = 'block'; btn.disabled = false; btn.textContent = 'Create Order'; }
}

function showSuccess(by) {
  content.innerHTML = '<div class="success-msg"><div class="checkmark">✓</div><h3>Order Created!</h3><p>Order created' + (by ? ' by ' + by : '') + '</p><button class="new-order-btn" id="newOrderBtn">Create Another</button></div>';
  cart = {}; chrome.storage.local.remove(['name', 'c1', 'c2']);
  document.getElementById('newOrderBtn').addEventListener('click', () => { renderForm(); });
}

init();`

const CONTENT_JS = `const API_BASE='https://www.akmez.tech';
const toggleBtn=document.createElement('div');toggleBtn.id='akmez-toggle';toggleBtn.innerHTML='<span>A</span>';document.body.appendChild(toggleBtn);
const widget=document.createElement('div');widget.id='akmez-widget';widget.innerHTML='<div class="akmez-header" id="akmez-drag"><div class="akmez-logo">A</div><span>Quick Order</span><button class="akmez-close" id="akmez-close">×</button></div><div class="akmez-body" id="akmez-body"><div class="akmez-loading"><div class="akmez-spinner"></div></div></div>';widget.style.display='none';document.body.appendChild(widget);
const style=document.createElement('style');style.textContent='#akmez-toggle{position:fixed;bottom:20px;right:20px;width:56px;height:56px;background:linear-gradient(135deg,#f97316,#ea580c);border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483646;box-shadow:0 4px 20px rgba(249,115,22,0.5);font-family:sans-serif;}#akmez-toggle:hover{transform:scale(1.1);}#akmez-toggle span{color:white;font-size:24px;font-weight:800;}#akmez-widget{position:fixed;top:60px;right:20px;width:360px;background:#0f0f1a;border-radius:16px;box-shadow:0 10px 50px rgba(0,0,0,0.6);border:2px solid #f97316;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;}.akmez-header{background:linear-gradient(135deg,#f97316,#ea580c);padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:move;border-radius:14px 14px 0 0;user-select:none;}.akmez-logo{width:26px;height:26px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;}.akmez-header span{flex:1;font-weight:700;font-size:13px;}.akmez-close{width:24px;height:24px;border:none;border-radius:6px;background:rgba(255,255,255,0.2);color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;}.akmez-close:hover{background:rgba(255,255,255,0.3);}.akmez-body{padding:10px;}.akmez-loading{text-align:center;padding:30px;color:#888;}.akmez-spinner{width:28px;height:28px;border:3px solid rgba(249,115,22,0.2);border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}@keyframes spin{to{transform:rotate(360deg);}}.akmez-row{display:flex;gap:6px;margin-bottom:8px;}.akmez-field{flex:1;}.akmez-label{font-size:9px;color:#666;text-transform:uppercase;margin-bottom:3px;}.akmez-label .req{color:#f97316;}.akmez-input-wrap{position:relative;}.akmez-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 44px 8px 8px;color:white;font-size:12px;outline:none;}.akmez-input:focus{border-color:#f97316;}.akmez-input::placeholder{color:#444;}.akmez-paste{position:absolute;right:3px;top:50%;transform:translateY(-50%);background:#f97316;border:none;border-radius:4px;padding:5px 8px;color:white;font-size:8px;font-weight:700;cursor:pointer;}.akmez-paste:hover{background:#ea580c;}.akmez-select{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px;color:white;font-size:12px;outline:none;}.akmez-select:focus{border-color:#f97316;}.akmez-select option{background:#1a1a2e;}.akmez-section{font-size:9px;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(249,115,22,0.2);}.akmez-products{display:flex;flex-wrap:wrap;gap:5px;}.akmez-product{position:relative;padding:6px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:10px;font-weight:500;cursor:pointer;}.akmez-product:hover{border-color:#f97316;background:rgba(249,115,22,0.1);}.akmez-product.sel{background:#f97316;border-color:#f97316;}.akmez-product .badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;background:#10b981;border-radius:8px;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;}.akmez-product .price{font-size:8px;opacity:0.7;display:block;}.akmez-cart{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:6px 10px;margin-top:8px;display:flex;justify-content:space-between;font-size:11px;}.akmez-cart .items{color:#6ee7b7;}.akmez-cart .total{color:#10b981;font-weight:700;}.akmez-submit{width:100%;padding:10px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:8px;color:white;font-size:12px;font-weight:700;cursor:pointer;margin-top:10px;text-transform:uppercase;}.akmez-submit:hover{box-shadow:0 4px 15px rgba(16,185,129,0.3);}.akmez-submit:disabled{opacity:0.5;cursor:not-allowed;}.akmez-success{text-align:center;padding:15px;}.akmez-success .check{font-size:36px;color:#10b981;}.akmez-success h3{color:#10b981;margin:8px 0 4px;font-size:14px;}.akmez-success p{color:#6ee7b7;font-size:11px;margin-bottom:12px;}.akmez-success button{background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#10b981;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:11px;}.akmez-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px;color:#fca5a5;font-size:10px;margin-bottom:8px;}.akmez-login{text-align:center;padding:15px;}.akmez-login p{color:#fca5a5;margin-bottom:12px;font-size:11px;}.akmez-login button{background:#f97316;border:none;color:white;padding:10px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:11px;}#akmez-sel{display:none;position:fixed;z-index:2147483647;background:#1a1a2e;padding:4px;border-radius:8px;border:2px solid #f97316;gap:3px;font-family:sans-serif;}#akmez-sel button{padding:6px 10px;border:none;border-radius:5px;background:#f97316;color:white;font-size:10px;font-weight:700;cursor:pointer;}#akmez-sel button:hover{background:#ea580c;}.akmez-toast{position:fixed;bottom:80px;right:20px;background:#10b981;color:white;padding:10px 16px;border-radius:8px;font-family:sans-serif;font-size:12px;font-weight:600;z-index:2147483647;animation:fadeIn .3s;}@keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}';document.head.appendChild(style);
let products=[],regions=[],cart={},isDragging=false,dragOffset={x:0,y:0};
document.getElementById('akmez-drag').addEventListener('mousedown',e=>{if(e.target.closest('button'))return;isDragging=true;const r=widget.getBoundingClientRect();dragOffset={x:e.clientX-r.left,y:e.clientY-r.top};});
document.addEventListener('mousemove',e=>{if(!isDragging)return;widget.style.left=Math.max(0,Math.min(window.innerWidth-360,e.clientX-dragOffset.x))+'px';widget.style.top=Math.max(0,Math.min(window.innerHeight-400,e.clientY-dragOffset.y))+'px';widget.style.right='auto';});
document.addEventListener('mouseup',()=>isDragging=false);
toggleBtn.addEventListener('click',()=>{widget.style.display=widget.style.display==='none'?'block':'none';if(widget.style.display==='block')loadData();});
document.getElementById('akmez-close').addEventListener('click',()=>widget.style.display='none');
function toast(msg){const t=document.createElement('div');t.className='akmez-toast';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2000);}
function loadData(){const body=document.getElementById('akmez-body');body.innerHTML='<div class="akmez-loading"><div class="akmez-spinner"></div></div>';chrome.runtime.sendMessage({action:'fetchData'},res=>{if(!res||!res.success){body.innerHTML='<div class="akmez-error">Connection failed - use extension popup</div>';return;}const data=res.data;if(!data.authenticated){body.innerHTML='<div class="akmez-login"><p>Log in to Akmez first</p><button id="akmez-login-btn">Open Login</button></div>';document.getElementById('akmez-login-btn').onclick=()=>window.open(API_BASE+'/auth/sign-in','_blank');return;}products=data.products||[];regions=data.regions||[];renderForm();});}
function renderForm(){const body=document.getElementById('akmez-body');body.innerHTML='<div class="akmez-row"><div class="akmez-field"><div class="akmez-label">Name <span class="req">*</span></div><div class="akmez-input-wrap"><input type="text" id="ak-name" class="akmez-input" placeholder="Customer"><button class="akmez-paste" data-t="ak-name">PASTE</button></div></div></div><div class="akmez-row"><div class="akmez-field"><div class="akmez-label">Contact 1 <span class="req">*</span></div><div class="akmez-input-wrap"><input type="text" id="ak-c1" class="akmez-input" placeholder="Phone"><button class="akmez-paste" data-t="ak-c1">PASTE</button></div></div><div class="akmez-field"><div class="akmez-label">Contact 2</div><div class="akmez-input-wrap"><input type="text" id="ak-c2" class="akmez-input" placeholder="Phone 2"><button class="akmez-paste" data-t="ak-c2">PASTE</button></div></div></div><div class="akmez-row"><div class="akmez-field"><div class="akmez-label">Region <span class="req">*</span></div><select id="ak-region" class="akmez-select"><option value="">Select</option>'+regions.map(r=>'<option value="'+r+'">'+r+'</option>').join('')+'</select></div><div class="akmez-field"><div class="akmez-label">Date <span class="req">*</span></div><input type="date" id="ak-date" class="akmez-input" value="'+new Date().toISOString().split('T')[0]+'"></div></div><div class="akmez-section">Products (tap to add)</div><div class="akmez-products">'+products.map(p=>'<div class="akmez-product" data-id="'+p.id+'" data-name="'+p.name+'" data-price="'+p.price+'">'+p.name+'<span class="price">Rs '+p.price+'</span></div>').join('')+'</div><div class="akmez-cart" id="ak-cart" style="display:none"><span class="items">0</span><span class="total">Rs 0</span></div><div id="ak-err" class="akmez-error" style="display:none"></div><button class="akmez-submit" id="ak-submit">Create Order</button>';body.querySelectorAll('.akmez-paste').forEach(b=>b.onclick=async()=>{try{document.getElementById(b.dataset.t).value=await navigator.clipboard.readText();}catch(e){}});body.querySelectorAll('.akmez-product').forEach(el=>el.onclick=()=>{cart[el.dataset.id]=(cart[el.dataset.id]||0)+1;updateCart();});document.getElementById('ak-submit').onclick=submit;}
function updateCart(){const c=document.getElementById('ak-cart');const e=Object.entries(cart).filter(([,q])=>q>0);if(!e.length){c.style.display='none';return;}let qty=0,amt=0;e.forEach(([id,q])=>{qty+=q;const p=products.find(x=>x.id===id);if(p)amt+=parseFloat(p.price)*q;});c.style.display='flex';c.querySelector('.items').textContent=qty+' items';c.querySelector('.total').textContent='Rs '+amt;document.querySelectorAll('.akmez-product').forEach(el=>{const q=cart[el.dataset.id]||0;el.classList.toggle('sel',q>0);let b=el.querySelector('.badge');if(q>0){if(!b){b=document.createElement('span');b.className='badge';el.appendChild(b);}b.textContent=q;}else if(b)b.remove();});}
function submit(){const name=document.getElementById('ak-name').value.trim();const c1=document.getElementById('ak-c1').value.trim();const c2=document.getElementById('ak-c2').value.trim();const region=document.getElementById('ak-region').value;const date=document.getElementById('ak-date').value;const err=document.getElementById('ak-err');const btn=document.getElementById('ak-submit');err.style.display='none';if(!name||!c1||!region||!date){err.textContent='Fill required fields';err.style.display='block';return;}const e=Object.entries(cart).filter(([,q])=>q>0);if(!e.length){err.textContent='Select products';err.style.display='block';return;}btn.disabled=true;btn.textContent='Creating...';const prods=e.map(([id,q])=>{const p=products.find(x=>x.id===id);return p?p.name+' x'+q:'';}).filter(Boolean).join(', ');let qty=0,amt=0;e.forEach(([id,q])=>{qty+=q;const p=products.find(x=>x.id===id);if(p)amt+=parseFloat(p.price)*q;});chrome.runtime.sendMessage({action:'createOrder',data:{customerName:name,contact1:c1,contact2:c2,region,deliveryDate:date,products:prods,qty,amount:amt}},res=>{if(!res||!res.success){err.textContent='Failed';err.style.display='block';btn.disabled=false;btn.textContent='Create Order';return;}const data=res.data;if(data.error){err.textContent=data.error;err.style.display='block';btn.disabled=false;btn.textContent='Create Order';return;}document.getElementById('akmez-body').innerHTML='<div class="akmez-success"><div class="check">✓</div><h3>Order Created!</h3><p>'+name+'</p><button id="ak-new">New Order</button></div>';document.getElementById('ak-new').onclick=()=>{cart={};renderForm();};});}
const sel=document.createElement('div');sel.id='akmez-sel';sel.innerHTML='<button data-f="name">Name</button><button data-f="c1">C1</button><button data-f="c2">C2</button>';document.body.appendChild(sel);
document.addEventListener('mouseup',e=>{if(e.target.closest('#akmez-sel,#akmez-widget'))return;setTimeout(()=>{const s=window.getSelection(),t=s.toString().trim();if(t&&t.length>0&&t.length<200){const r=s.getRangeAt(0).getBoundingClientRect();sel.style.display='flex';sel.style.left=Math.max(10,r.left)+'px';sel.style.top=(r.bottom+8)+'px';sel.dataset.text=t;}else sel.style.display='none';},10);});
document.addEventListener('mousedown',e=>{if(!e.target.closest('#akmez-sel'))setTimeout(()=>sel.style.display='none',100);});
sel.onclick=async e=>{const b=e.target.closest('button');if(!b)return;const t=sel.dataset.text;if(t){await navigator.clipboard.writeText(t);const inp=document.getElementById('ak-'+b.dataset.f)||document.getElementById('ak-name');if(inp)inp.value=t;toast('Copied: '+t.substring(0,20));sel.style.display='none';window.getSelection().removeAllRanges();}};`

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
