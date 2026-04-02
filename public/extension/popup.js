// Akmez Quick Order - Extension Popup v2.5.0
const API_BASE = 'https://www.akmez.tech';
const content = document.getElementById('content');

let products = [];
let regions = [];
let cart = {};
let authToken = null;
let settings = { nameSelector: '' };
let currentTab = 'orders';
let clockedIn = false;
let clockInTime = null;
let timerInterval = null;

// Settings button
document.getElementById('settingsBtn').addEventListener('click', showSettings);
document.getElementById('closeBtn').addEventListener('click', () => window.close());

// Tab switching
document.querySelectorAll('.main-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    if (currentTab === 'orders') {
      if (authToken) {
        chrome.storage.local.get(['name', 'c1', 'c2'], (saved) => {
          renderForm(saved);
        });
      } else {
        showLoginRequired();
      }
    } else {
      renderWorktime();
    }
  });
});

// Initialize
async function init() {
  try {
    const stored = await chrome.storage.local.get(['authToken', 'tokenExpiry', 'userName', 'settings']);
    settings = stored.settings || { nameSelector: '' };
    
    if (stored.authToken && stored.tokenExpiry && Date.now() < stored.tokenExpiry * 1000) {
      authToken = stored.authToken;
      
      const res = await fetch(`${API_BASE}/api/extension`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      
      if (!data.authenticated) {
        await chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName']);
        authToken = null;
        showLoginRequired();
        return;
      }
      
      products = data.products || [];
      regions = data.regions || [];
      
      chrome.storage.local.get(['name', 'c1', 'c2'], (saved) => {
        renderForm(saved);
      });
    } else {
      showLoginRequired();
    }
  } catch (err) {
    console.error('Init error:', err);
    showLoginRequired();
  }
}

function showSettings() {
  content.innerHTML = `
    <div style="padding: 10px 0;">
      <h3 style="font-size: 14px; margin-bottom: 16px; color: #f97316;">Extension Settings</h3>
      <div class="form-group">
        <label>Auto-fill CSS Selector (optional)</label>
        <input type="text" id="nameSelector" placeholder=".customer-name" value="${settings.nameSelector || ''}">
        <p style="font-size: 10px; color: #666; margin-top: 4px;">CSS selector to auto-capture customer name from page</p>
      </div>
      <button class="submit-btn" id="saveSettingsBtn" style="background: linear-gradient(135deg, #f97316, #ea580c);">Save Settings</button>
      <button class="submit-btn" id="backBtn" style="background: rgba(255,255,255,0.1); margin-top: 8px;">Back</button>
      <hr style="border-color: rgba(255,255,255,0.1); margin: 20px 0;">
      <button class="submit-btn" id="logoutBtn" style="background: linear-gradient(135deg, #ef4444, #dc2626);">Sign Out</button>
    </div>
  `;
  
  document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
    settings.nameSelector = document.getElementById('nameSelector').value.trim();
    await chrome.storage.local.set({ settings });
    init();
  });
  
  document.getElementById('backBtn').addEventListener('click', () => {
    if (authToken) {
      chrome.storage.local.get(['name', 'c1', 'c2'], (saved) => { renderForm(saved); });
    } else {
      showLoginRequired();
    }
  });
  
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName']);
    authToken = null;
    showLoginRequired();
  });
}

function showLoginRequired() {
  content.innerHTML = `
    <div class="login-msg">
      <div class="title">Sign in to Akmez</div>
      <div class="login-error" id="loginError"></div>
      <div class="form-group">
        <input type="email" id="loginEmail" placeholder="Email address" autocomplete="email">
      </div>
      <div class="form-group">
        <input type="password" id="loginPassword" placeholder="Password" autocomplete="current-password">
      </div>
      <button class="login-btn" id="loginBtn">Sign In</button>
      <div class="login-divider"><span>or</span></div>
      <a class="open-login-link" id="openLogin">Open Akmez in browser</a>
    </div>
  `;
  
  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  
  loginBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    
    if (!email || !password) {
      loginError.textContent = 'Please enter email and password';
      loginError.style.display = 'block';
      return;
    }
    
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in...';
    loginError.style.display = 'none';
    
    try {
      const res = await fetch(`${API_BASE}/api/extension/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      
      if (data.success && data.accessToken) {
        await chrome.storage.local.set({
          authToken: data.accessToken,
          tokenExpiry: data.expiresAt,
          userName: data.user?.name || ''
        });
        authToken = data.accessToken;
        init();
      } else {
        loginError.textContent = data.error || 'Invalid email or password';
        loginError.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
      }
    } catch (err) {
      loginError.textContent = 'Connection error. Please try again.';
      loginError.style.display = 'block';
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    }
  });
  
  passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') loginBtn.click(); });
  emailInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
  document.getElementById('openLogin').addEventListener('click', () => { chrome.tabs.create({ url: API_BASE + '/auth/sign-in' }); });
}

function renderWorktime() {
  chrome.storage.local.get(['clockedIn', 'clockInTime', 'worktimeHistory'], (stored) => {
    clockedIn = stored.clockedIn || false;
    clockInTime = stored.clockInTime || null;
    const history = stored.worktimeHistory || [];
    
    content.innerHTML = `
      <div class="worktime-panel">
        <div class="worktime-status ${clockedIn ? '' : 'clocked-out'}">
          <span class="status-dot"></span>
          <span class="status-text">${clockedIn ? 'Currently Working' : 'Not Clocked In'}</span>
        </div>
        <div class="worktime-timer" id="worktimeTimer">${clockedIn ? formatTime(Date.now() - clockInTime) : '00:00:00'}</div>
        <div class="worktime-info">${clockedIn ? 'Started at <span>' + new Date(clockInTime).toLocaleTimeString() + '</span>' : 'Enter PIN to clock in'}</div>
        <div class="pin-input-wrap">
          <input type="password" class="pin-digit" maxlength="1" id="pin1">
          <input type="password" class="pin-digit" maxlength="1" id="pin2">
          <input type="password" class="pin-digit" maxlength="1" id="pin3">
          <input type="password" class="pin-digit" maxlength="1" id="pin4">
        </div>
        <div class="login-error" id="pinError" style="display:none;"></div>
        <button class="clock-btn ${clockedIn ? 'clock-out' : 'clock-in'}" id="clockBtn">${clockedIn ? 'Clock Out' : 'Clock In'}</button>
        ${history.length > 0 ? `
          <div class="worktime-history">
            <h4>Recent Sessions</h4>
            ${history.slice(0, 3).map(h => `<div class="history-item"><span class="date">${h.date}</span><span class="hours">${h.hours}</span></div>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    
    if (clockedIn) { startTimer(); }
    
    const pins = [document.getElementById('pin1'), document.getElementById('pin2'), document.getElementById('pin3'), document.getElementById('pin4')];
    pins.forEach((pin, i) => {
      pin.addEventListener('input', () => {
        if (pin.value.length === 1 && i < 3) pins[i + 1].focus();
      });
      pin.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && pin.value === '' && i > 0) pins[i - 1].focus();
      });
    });
    
    document.getElementById('clockBtn').addEventListener('click', async () => {
      const pin = pins.map(p => p.value).join('');
      const err = document.getElementById('pinError');
      if (pin.length !== 4) { err.textContent = 'Enter 4-digit PIN'; err.style.display = 'block'; return; }
      
      const btn = document.getElementById('clockBtn');
      btn.disabled = true;
      
      try {
        const res = await fetch(API_BASE + '/api/extension/worktime', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
          body: JSON.stringify({ pin, action: clockedIn ? 'clock-out' : 'clock-in' })
        });
        const data = await res.json();
        if (data.success) {
          if (clockedIn) {
            const duration = formatTime(Date.now() - clockInTime);
            const historyEntry = { date: new Date().toLocaleDateString(), hours: duration };
            const newHistory = [historyEntry, ...history].slice(0, 10);
            await chrome.storage.local.set({ clockedIn: false, clockInTime: null, worktimeHistory: newHistory });
            clearInterval(timerInterval);
          } else {
            await chrome.storage.local.set({ clockedIn: true, clockInTime: Date.now() });
          }
          renderWorktime();
        } else {
          err.textContent = data.error || 'Invalid PIN';
          err.style.display = 'block';
          btn.disabled = false;
        }
      } catch (e) {
        err.textContent = 'Connection error';
        err.style.display = 'block';
        btn.disabled = false;
      }
    });
  });
}

function formatTime(ms) {
  const secs = Math.floor(ms / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const timer = document.getElementById('worktimeTimer');
    if (timer && clockInTime) { timer.textContent = formatTime(Date.now() - clockInTime); }
  }, 1000);
}

function renderForm(saved = {}) {
  content.innerHTML = `
    <div class="user-info"><span class="dot"></span>Connected${settings.nameSelector ? ' - Auto-fill ON' : ''}</div>
    <div id="errorMsg" class="error-msg" style="display:none;"></div>
    <div class="form-group">
      <label>Name <span class="req">*</span></label>
      <div class="input-wrap">
        <input type="text" id="customerName" placeholder="Customer" value="${saved.name || ''}">
        <button class="paste-btn" data-target="customerName">Paste</button>
      </div>
    </div>
    <div class="input-row" style="margin-bottom:10px">
      <div class="form-group">
        <label>Contact 1 <span class="req">*</span></label>
        <div class="input-wrap">
          <input type="text" id="contact1" placeholder="Phone" value="${saved.c1 || ''}">
          <button class="paste-btn" data-target="contact1">Paste</button>
        </div>
      </div>
      <div class="form-group">
        <label>Contact 2</label>
        <div class="input-wrap">
          <input type="text" id="contact2" placeholder="Phone" value="${saved.c2 || ''}">
          <button class="paste-btn" data-target="contact2">Paste</button>
        </div>
      </div>
    </div>
    <div class="input-row" style="margin-bottom:10px">
      <div class="form-group">
        <label>Region <span class="req">*</span></label>
        <select id="region">
          <option value="">Select</option>
          ${regions.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Date <span class="req">*</span></label>
        <input type="date" id="deliveryDate" value="${new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    <div class="section-title">Products (${products.length})</div>
    <div class="product-search-wrap">
      <input type="text" class="product-search" id="productSearch" placeholder="Search products...">
    </div>
    <div class="category-tabs" id="categoryTabs">
      <button class="category-tab active" data-cat="all">All</button>
      <button class="category-tab" data-cat="a-e">A-E</button>
      <button class="category-tab" data-cat="f-j">F-J</button>
      <button class="category-tab" data-cat="k-o">K-O</button>
      <button class="category-tab" data-cat="p-t">P-T</button>
      <button class="category-tab" data-cat="u-z">U-Z</button>
    </div>
    <div class="products-grid" id="productsGrid">
      ${products.map(p => `
        <button class="product-btn" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}" data-letter="${(p.name.charAt(0).toUpperCase())}">
          <span class="product-name">${p.name}</span>
          <span class="product-price">Rs ${p.price}</span>
        </button>
      `).join('')}
    </div>
    <div class="cart-summary" id="cartSummary" style="display:none;">
      <span class="items" id="cartItems">0</span>
      <span class="total" id="cartTotal">Rs 0</span>
    </div>
    <div class="form-group" style="margin-top:10px">
      <label>Notes</label>
      <textarea id="notes" placeholder="Delivery notes"></textarea>
    </div>
    <button class="submit-btn" id="submitBtn" disabled>Create Order</button>
  `;
  
  // Category tabs
  let activeCategory = 'all';
  function filterProducts() {
    const q = document.getElementById('productSearch').value.toLowerCase();
    let visibleCount = 0;
    document.querySelectorAll('.product-btn').forEach(btn => {
      const matchesSearch = !q || btn.dataset.name.toLowerCase().includes(q);
      const letter = btn.dataset.letter;
      let matchesCategory = activeCategory === 'all';
      if (activeCategory === 'a-e') matchesCategory = 'ABCDE'.includes(letter);
      else if (activeCategory === 'f-j') matchesCategory = 'FGHIJ'.includes(letter);
      else if (activeCategory === 'k-o') matchesCategory = 'KLMNO'.includes(letter);
      else if (activeCategory === 'p-t') matchesCategory = 'PQRST'.includes(letter);
      else if (activeCategory === 'u-z') matchesCategory = 'UVWXYZ'.includes(letter);
      const show = matchesSearch && matchesCategory;
      btn.classList.toggle('hidden', !show);
      if (show) visibleCount++;
    });
    const grid = document.getElementById('productsGrid');
    const noProducts = grid.querySelector('.no-products');
    if (visibleCount === 0 && !noProducts) {
      grid.insertAdjacentHTML('beforeend', '<div class="no-products">No products found</div>');
    } else if (visibleCount > 0 && noProducts) {
      noProducts.remove();
    }
  }
  document.getElementById('productSearch').addEventListener('input', filterProducts);
  document.querySelectorAll('.category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeCategory = tab.dataset.cat;
      filterProducts();
    });
  });
  
  // Paste buttons
  document.querySelectorAll('.paste-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = await navigator.clipboard.readText();
      document.getElementById(btn.dataset.target).value = text.trim();
      updateSubmitState();
    });
  });
  
  // Product buttons
  document.querySelectorAll('.product-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (!cart[id]) cart[id] = { name: btn.dataset.name, price: parseFloat(btn.dataset.price) || 0, qty: 0 };
      cart[id].qty++;
      updateProductButtons();
      updateCartSummary();
      updateSubmitState();
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const id = btn.dataset.id;
      if (cart[id] && cart[id].qty > 0) {
        cart[id].qty--;
        if (cart[id].qty === 0) delete cart[id];
        updateProductButtons();
        updateCartSummary();
        updateSubmitState();
      }
    });
  });
  
  document.getElementById('customerName').addEventListener('input', updateSubmitState);
  document.getElementById('contact1').addEventListener('input', updateSubmitState);
  document.getElementById('region').addEventListener('change', updateSubmitState);
  document.getElementById('submitBtn').addEventListener('click', submitOrder);
  tryAutoFill();
}

function tryAutoFill() {
  if (settings.nameSelector) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: (sel) => document.querySelector(sel)?.textContent?.trim() || '',
          args: [settings.nameSelector]
        }).then(results => {
          if (results?.[0]?.result) {
            document.getElementById('customerName').value = results[0].result;
            updateSubmitState();
          }
        }).catch(() => {});
      }
    });
  }
}

function updateProductButtons() {
  document.querySelectorAll('.product-btn').forEach(btn => {
    const id = btn.dataset.id;
    const item = cart[id];
    btn.classList.toggle('selected', item && item.qty > 0);
    const badge = btn.querySelector('.qty-badge');
    if (badge) badge.remove();
    if (item && item.qty > 0) {
      const newBadge = document.createElement('span');
      newBadge.className = 'qty-badge';
      newBadge.textContent = item.qty;
      btn.appendChild(newBadge);
    }
  });
}

function updateCartSummary() {
  const summary = document.getElementById('cartSummary');
  const items = Object.values(cart);
  const totalQty = items.reduce((sum, i) => sum + i.qty, 0);
  const totalAmount = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
  if (totalQty > 0) {
    summary.style.display = 'flex';
    document.getElementById('cartItems').textContent = totalQty + ' item' + (totalQty > 1 ? 's' : '');
    document.getElementById('cartTotal').textContent = 'Rs ' + totalAmount.toLocaleString();
  } else {
    summary.style.display = 'none';
  }
}

function updateSubmitState() {
  const name = document.getElementById('customerName').value.trim();
  const contact1 = document.getElementById('contact1').value.trim();
  const region = document.getElementById('region').value;
  const hasProducts = Object.values(cart).some(i => i.qty > 0);
  document.getElementById('submitBtn').disabled = !name || !contact1 || !region || !hasProducts;
}

async function submitOrder() {
  const btn = document.getElementById('submitBtn');
  const errorMsg = document.getElementById('errorMsg');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  errorMsg.style.display = 'none';
  
  const orderData = {
    customerName: document.getElementById('customerName').value.trim(),
    contact1: document.getElementById('contact1').value.trim(),
    contact2: document.getElementById('contact2').value.trim(),
    region: document.getElementById('region').value,
    deliveryDate: document.getElementById('deliveryDate').value,
    notes: document.getElementById('notes').value.trim(),
    products: Object.values(cart).filter(i => i.qty > 0).map(i => ({ name: i.name, price: i.price, qty: i.qty }))
  };
  
  try {
    const res = await fetch(`${API_BASE}/api/extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify(orderData)
    });
    const data = await res.json();
    if (data.success) {
      showSuccess(data.createdBy);
    } else {
      errorMsg.textContent = data.error || 'Failed to create order';
      errorMsg.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Order';
    }
  } catch (err) {
    errorMsg.textContent = 'Connection error. Please try again.';
    errorMsg.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Create Order';
  }
}

function showSuccess(createdBy) {
  content.innerHTML = `
    <div class="success-msg" style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:12px;padding:24px;text-align:center;">
      <div style="font-size:48px;margin-bottom:12px;">✓</div>
      <h3 style="color:#10b981;margin-bottom:8px;font-size:16px;">Order Created!</h3>
      <p style="color:#6ee7b7;font-size:12px;margin-bottom:16px;">Order was successfully created${createdBy ? ` by ${createdBy}` : ''}.</p>
      <button class="submit-btn" id="newOrderBtn" style="background:rgba(16,185,129,0.2);color:#10b981;">Create Another Order</button>
    </div>
  `;
  cart = {};
  chrome.storage.local.remove(['name', 'c1', 'c2']);
  document.getElementById('newOrderBtn').addEventListener('click', () => { renderForm(); });
}

// Start
init();
