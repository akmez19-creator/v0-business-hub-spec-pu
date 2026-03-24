// Akmez Quick Order - Draggable Floating Widget

const API_BASE = 'https://www.akmez.tech';

// Create floating toggle button
const toggleBtn = document.createElement('div');
toggleBtn.id = 'akmez-toggle';
toggleBtn.innerHTML = '<span>A</span>';
toggleBtn.title = 'Open Akmez Quick Order';
document.body.appendChild(toggleBtn);

// Create floating widget
const widget = document.createElement('div');
widget.id = 'akmez-widget';
widget.innerHTML = `
  <div class="akmez-header" id="akmez-drag">
    <div class="akmez-logo">A</div>
    <span>Quick Order</span>
    <button class="akmez-close" id="akmez-close">×</button>
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
#akmez-toggle{position:fixed;bottom:20px;right:20px;width:56px;height:56px;background:linear-gradient(135deg,#f97316,#ea580c);border-radius:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2147483646;box-shadow:0 4px 20px rgba(249,115,22,0.5);font-family:sans-serif;}
#akmez-toggle:hover{transform:scale(1.1);}
#akmez-toggle span{color:white;font-size:24px;font-weight:800;}
#akmez-widget{position:fixed;top:60px;right:20px;width:360px;background:#0f0f1a;border-radius:16px;box-shadow:0 10px 50px rgba(0,0,0,0.6);border:2px solid #f97316;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:white;}
.akmez-header{background:linear-gradient(135deg,#f97316,#ea580c);padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:move;border-radius:14px 14px 0 0;user-select:none;}
.akmez-logo{width:26px;height:26px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;}
.akmez-header span{flex:1;font-weight:700;font-size:13px;}
.akmez-close{width:24px;height:24px;border:none;border-radius:6px;background:rgba(255,255,255,0.2);color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.akmez-close:hover{background:rgba(255,255,255,0.3);}
.akmez-body{padding:10px;}
.akmez-loading{text-align:center;padding:30px;color:#888;}
.akmez-spinner{width:28px;height:28px;border:3px solid rgba(249,115,22,0.2);border-top-color:#f97316;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}
@keyframes spin{to{transform:rotate(360deg);}}
.akmez-row{display:flex;gap:6px;margin-bottom:8px;}
.akmez-field{flex:1;}
.akmez-label{font-size:9px;color:#666;text-transform:uppercase;margin-bottom:3px;}
.akmez-label .req{color:#f97316;}
.akmez-input-wrap{position:relative;}
.akmez-input{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 44px 8px 8px;color:white;font-size:12px;outline:none;}
.akmez-input:focus{border-color:#f97316;}
.akmez-input::placeholder{color:#444;}
.akmez-paste{position:absolute;right:3px;top:50%;transform:translateY(-50%);background:#f97316;border:none;border-radius:4px;padding:5px 8px;color:white;font-size:8px;font-weight:700;cursor:pointer;}
.akmez-paste:hover{background:#ea580c;}
.akmez-select{width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px;color:white;font-size:12px;outline:none;}
.akmez-select:focus{border-color:#f97316;}
.akmez-select option{background:#1a1a2e;}
.akmez-section{font-size:9px;color:#f97316;text-transform:uppercase;letter-spacing:1px;margin:10px 0 6px;padding-bottom:4px;border-bottom:1px solid rgba(249,115,22,0.2);}
.akmez-products{display:flex;flex-wrap:wrap;gap:5px;}
.akmez-product{position:relative;padding:6px 10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;font-size:10px;font-weight:500;cursor:pointer;}
.akmez-product:hover{border-color:#f97316;background:rgba(249,115,22,0.1);}
.akmez-product.sel{background:#f97316;border-color:#f97316;}
.akmez-product .badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;background:#10b981;border-radius:8px;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;}
.akmez-product .price{font-size:8px;opacity:0.7;display:block;}
.akmez-cart{background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:6px 10px;margin-top:8px;display:flex;justify-content:space-between;font-size:11px;}
.akmez-cart .items{color:#6ee7b7;}
.akmez-cart .total{color:#10b981;font-weight:700;}
.akmez-submit{width:100%;padding:10px;background:linear-gradient(135deg,#10b981,#059669);border:none;border-radius:8px;color:white;font-size:12px;font-weight:700;cursor:pointer;margin-top:10px;text-transform:uppercase;}
.akmez-submit:hover{box-shadow:0 4px 15px rgba(16,185,129,0.3);}
.akmez-submit:disabled{opacity:0.5;cursor:not-allowed;}
.akmez-success{text-align:center;padding:15px;}
.akmez-success .check{font-size:36px;color:#10b981;}
.akmez-success h3{color:#10b981;margin:8px 0 4px;font-size:14px;}
.akmez-success p{color:#6ee7b7;font-size:11px;margin-bottom:12px;}
.akmez-success button{background:rgba(16,185,129,0.2);border:1px solid #10b981;color:#10b981;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer;font-size:11px;}
.akmez-error{background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:8px;color:#fca5a5;font-size:10px;margin-bottom:8px;}
.akmez-login{text-align:center;padding:15px;}
.akmez-login p{color:#fca5a5;margin-bottom:12px;font-size:11px;}
.akmez-login button{background:#f97316;border:none;color:white;padding:10px 20px;border-radius:6px;font-weight:600;cursor:pointer;font-size:11px;}
#akmez-sel{display:none;position:fixed;z-index:2147483647;background:#1a1a2e;padding:4px;border-radius:8px;border:2px solid #f97316;gap:3px;font-family:sans-serif;}
#akmez-sel button{padding:6px 10px;border:none;border-radius:5px;background:#f97316;color:white;font-size:10px;font-weight:700;cursor:pointer;}
#akmez-sel button:hover{background:#ea580c;}
.akmez-toast{position:fixed;bottom:80px;right:20px;background:#10b981;color:white;padding:10px 16px;border-radius:8px;font-family:sans-serif;font-size:12px;font-weight:600;z-index:2147483647;animation:fadeIn .3s;}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
`;
document.head.appendChild(style);

// State
let products = [], regions = [], cart = {}, isDragging = false, dragOffset = {x:0,y:0};

// Drag
document.getElementById('akmez-drag').addEventListener('mousedown', e => {
  if (e.target.closest('button')) return;
  isDragging = true;
  const r = widget.getBoundingClientRect();
  dragOffset = {x: e.clientX - r.left, y: e.clientY - r.top};
});
document.addEventListener('mousemove', e => {
  if (!isDragging) return;
  widget.style.left = Math.max(0, Math.min(window.innerWidth - 360, e.clientX - dragOffset.x)) + 'px';
  widget.style.top = Math.max(0, Math.min(window.innerHeight - 400, e.clientY - dragOffset.y)) + 'px';
  widget.style.right = 'auto';
});
document.addEventListener('mouseup', () => isDragging = false);

// Toggle
toggleBtn.addEventListener('click', () => {
  widget.style.display = widget.style.display === 'none' ? 'block' : 'none';
  if (widget.style.display === 'block') loadData();
});
document.getElementById('akmez-close').addEventListener('click', () => widget.style.display = 'none');

// Toast
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'akmez-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// Load API via background script
async function loadData() {
  const body = document.getElementById('akmez-body');
  body.innerHTML = '<div class="akmez-loading"><div class="akmez-spinner"></div></div>';
  
  chrome.runtime.sendMessage({ action: 'fetchData' }, response => {
    if (!response || !response.success) {
      body.innerHTML = '<div class="akmez-error">Connection failed - try the extension popup instead</div>';
      return;
    }
    const data = response.data;
    if (!data.authenticated) {
      body.innerHTML = '<div class="akmez-login"><p>Log in to Akmez first</p><button id="akmez-login-btn">Open Login</button></div>';
      document.getElementById('akmez-login-btn').onclick = () => window.open(API_BASE + '/auth/sign-in', '_blank');
      return;
    }
    products = data.products || [];
    regions = data.regions || [];
    renderForm();
  });
}

// Render form
function renderForm() {
  const body = document.getElementById('akmez-body');
  body.innerHTML = `
    <div class="akmez-row">
      <div class="akmez-field"><div class="akmez-label">Name <span class="req">*</span></div><div class="akmez-input-wrap"><input type="text" id="ak-name" class="akmez-input" placeholder="Customer"><button class="akmez-paste" data-t="ak-name">PASTE</button></div></div>
    </div>
    <div class="akmez-row">
      <div class="akmez-field"><div class="akmez-label">Contact 1 <span class="req">*</span></div><div class="akmez-input-wrap"><input type="text" id="ak-c1" class="akmez-input" placeholder="Phone"><button class="akmez-paste" data-t="ak-c1">PASTE</button></div></div>
      <div class="akmez-field"><div class="akmez-label">Contact 2</div><div class="akmez-input-wrap"><input type="text" id="ak-c2" class="akmez-input" placeholder="Phone 2"><button class="akmez-paste" data-t="ak-c2">PASTE</button></div></div>
    </div>
    <div class="akmez-row">
      <div class="akmez-field"><div class="akmez-label">Region <span class="req">*</span></div><select id="ak-region" class="akmez-select"><option value="">Select</option>${regions.map(r=>'<option value="'+r+'">'+r+'</option>').join('')}</select></div>
      <div class="akmez-field"><div class="akmez-label">Date <span class="req">*</span></div><input type="date" id="ak-date" class="akmez-input" value="${new Date().toISOString().split('T')[0]}"></div>
    </div>
    <div class="akmez-section">Products (tap to add)</div>
    <div class="akmez-products">${products.map(p=>'<div class="akmez-product" data-id="'+p.id+'" data-name="'+p.name+'" data-price="'+p.price+'">'+p.name+'<span class="price">Rs '+p.price+'</span></div>').join('')}</div>
    <div class="akmez-cart" id="ak-cart" style="display:none"><span class="items">0</span><span class="total">Rs 0</span></div>
    <div id="ak-err" class="akmez-error" style="display:none"></div>
    <button class="akmez-submit" id="ak-submit">Create Order</button>
  `;
  body.querySelectorAll('.akmez-paste').forEach(b => b.onclick = async () => {
    try { document.getElementById(b.dataset.t).value = await navigator.clipboard.readText(); } catch(e){}
  });
  body.querySelectorAll('.akmez-product').forEach(el => el.onclick = () => {
    cart[el.dataset.id] = (cart[el.dataset.id]||0) + 1;
    updateCart();
  });
  document.getElementById('ak-submit').onclick = submit;
}

// Update cart
function updateCart() {
  const c = document.getElementById('ak-cart');
  const e = Object.entries(cart).filter(([,q])=>q>0);
  if (!e.length) { c.style.display='none'; return; }
  let qty=0, amt=0;
  e.forEach(([id,q]) => { qty+=q; const p=products.find(x=>x.id===id); if(p) amt+=parseFloat(p.price)*q; });
  c.style.display='flex';
  c.querySelector('.items').textContent = qty+' items';
  c.querySelector('.total').textContent = 'Rs '+amt;
  document.querySelectorAll('.akmez-product').forEach(el => {
    const q = cart[el.dataset.id]||0;
    el.classList.toggle('sel', q>0);
    let b = el.querySelector('.badge');
    if (q>0) { if(!b){b=document.createElement('span');b.className='badge';el.appendChild(b);} b.textContent=q; }
    else if(b) b.remove();
  });
}

// Submit via background script
function submit() {
  const name = document.getElementById('ak-name').value.trim();
  const c1 = document.getElementById('ak-c1').value.trim();
  const c2 = document.getElementById('ak-c2').value.trim();
  const region = document.getElementById('ak-region').value;
  const date = document.getElementById('ak-date').value;
  const err = document.getElementById('ak-err');
  const btn = document.getElementById('ak-submit');
  err.style.display = 'none';
  if (!name||!c1||!region||!date) { err.textContent='Fill required fields'; err.style.display='block'; return; }
  const e = Object.entries(cart).filter(([,q])=>q>0);
  if (!e.length) { err.textContent='Select products'; err.style.display='block'; return; }
  btn.disabled = true; btn.textContent = 'Creating...';
  
  const prods = e.map(([id,q])=>{const p=products.find(x=>x.id===id);return p?p.name+' x'+q:'';}).filter(Boolean).join(', ');
  let qty=0, amt=0;
  e.forEach(([id,q])=>{qty+=q;const p=products.find(x=>x.id===id);if(p)amt+=parseFloat(p.price)*q;});
  
  chrome.runtime.sendMessage({
    action: 'createOrder',
    data: { customerName:name, contact1:c1, contact2:c2, region, deliveryDate:date, products:prods, qty, amount:amt }
  }, response => {
    if (!response || !response.success) {
      err.textContent='Connection failed'; err.style.display='block'; btn.disabled=false; btn.textContent='Create Order';
      return;
    }
    const data = response.data;
    if (data.error) { err.textContent=data.error; err.style.display='block'; btn.disabled=false; btn.textContent='Create Order'; return; }
    document.getElementById('akmez-body').innerHTML = '<div class="akmez-success"><div class="check">✓</div><h3>Order Created!</h3><p>'+name+'</p><button id="ak-new">New Order</button></div>';
    document.getElementById('ak-new').onclick = () => { cart={}; renderForm(); };
  });
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
      sel.style.left = Math.max(10,r.left)+'px';
      sel.style.top = (r.bottom+8)+'px';
      sel.dataset.text = t;
    } else sel.style.display = 'none';
  }, 10);
});

document.addEventListener('mousedown', e => {
  if (!e.target.closest('#akmez-sel')) setTimeout(()=>sel.style.display='none',100);
});

sel.onclick = async e => {
  const b = e.target.closest('button');
  if (!b) return;
  const t = sel.dataset.text;
  if (t) {
    await navigator.clipboard.writeText(t);
    const inp = document.getElementById('ak-'+b.dataset.f) || document.getElementById('ak-name');
    if (inp) inp.value = t;
    toast('Copied: '+t.substring(0,20));
    sel.style.display = 'none';
    window.getSelection().removeAllRanges();
  }
};
