// Akmez Quick Order - Extension Popup
const API_BASE = 'https://www.akmez.tech';
const content = document.getElementById('content');

let products = [];
let regions = [];
let cart = {};

// Initialize
async function init() {
  try {
    // Fetch products and regions
    const res = await fetch(`${API_BASE}/api/extension`, {
      credentials: 'include'
    });
    const data = await res.json();
    
    if (!data.success) {
      showLoginRequired();
      return;
    }
    
    products = data.products || [];
    regions = data.regions || [];
    
    // Load saved data from storage
    chrome.storage.local.get(['name', 'c1', 'c2'], (saved) => {
      renderForm(saved);
    });
  } catch (err) {
    console.error('Init error:', err);
    showLoginRequired();
  }
}

function showLoginRequired() {
  content.innerHTML = `
    <div class="login-msg">
      <p>Please login to Akmez first to create orders from this extension.</p>
      <button class="login-btn" id="loginBtn">Open Akmez Login</button>
    </div>
  `;
  document.getElementById('loginBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: `${API_BASE}/auth/sign-in` });
  });
}

function renderForm(saved = {}) {
  content.innerHTML = `
    <div class="user-info">
      <span class="dot"></span>
      Connected to Akmez
    </div>
    
    <div id="errorMsg" class="error-msg" style="display:none;"></div>
    
    <div class="form-group">
      <label>Customer Name <span class="req">*</span></label>
      <div class="input-wrap">
        <input type="text" id="customerName" placeholder="Paste customer name" value="${saved.name || ''}">
        <button class="paste-btn" data-target="customerName">Paste</button>
      </div>
    </div>
    
    <div class="input-row" style="margin-bottom: 12px;">
      <div class="form-group">
        <label>Contact #1 <span class="req">*</span></label>
        <div class="input-wrap">
          <input type="text" id="contact1" placeholder="Phone" value="${saved.c1 || ''}">
          <button class="paste-btn" data-target="contact1">Paste</button>
        </div>
      </div>
      <div class="form-group">
        <label>Contact #2</label>
        <div class="input-wrap">
          <input type="text" id="contact2" placeholder="Optional" value="${saved.c2 || ''}">
          <button class="paste-btn" data-target="contact2">Paste</button>
        </div>
      </div>
    </div>
    
    <div class="input-row" style="margin-bottom: 12px;">
      <div class="form-group">
        <label>Region <span class="req">*</span></label>
        <select id="region">
          <option value="">Select region...</option>
          ${regions.map(r => `<option value="${r}">${r}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Delivery Date</label>
        <input type="date" id="deliveryDate" value="${new Date().toISOString().split('T')[0]}">
      </div>
    </div>
    
    <div class="section-title">Products (click to add)</div>
    <div class="products-grid" id="productsGrid">
      ${products.map(p => `
        <button class="product-btn" data-id="${p.id}" data-name="${p.name}" data-price="${p.price}">
          ${p.name}
          <span class="price">Rs ${p.price}</span>
        </button>
      `).join('')}
    </div>
    
    <div class="cart-summary" id="cartSummary" style="display:none;">
      <span class="items" id="cartItems">0 items</span>
      <span class="total" id="cartTotal">Rs 0</span>
    </div>
    
    <div class="form-group" style="margin-top: 12px;">
      <label>Notes</label>
      <textarea id="notes" placeholder="Optional delivery notes"></textarea>
    </div>
    
    <button class="submit-btn" id="submitBtn" disabled>Create Order</button>
  `;
  
  // Paste buttons
  document.querySelectorAll('.paste-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.target;
      const text = await navigator.clipboard.readText();
      document.getElementById(target).value = text.trim();
      updateSubmitState();
    });
  });
  
  // Product buttons
  document.querySelectorAll('.product-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      const price = parseFloat(btn.dataset.price) || 0;
      
      if (!cart[id]) {
        cart[id] = { name, price, qty: 0 };
      }
      cart[id].qty++;
      
      updateProductButtons();
      updateCartSummary();
      updateSubmitState();
    });
    
    // Right-click to decrease
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
  
  // Form inputs
  document.getElementById('customerName').addEventListener('input', updateSubmitState);
  document.getElementById('contact1').addEventListener('input', updateSubmitState);
  document.getElementById('region').addEventListener('change', updateSubmitState);
  
  // Submit
  document.getElementById('submitBtn').addEventListener('click', submitOrder);
}

function updateProductButtons() {
  document.querySelectorAll('.product-btn').forEach(btn => {
    const id = btn.dataset.id;
    const item = cart[id];
    
    btn.classList.toggle('selected', item && item.qty > 0);
    
    // Remove existing badge
    const existingBadge = btn.querySelector('.qty-badge');
    if (existingBadge) existingBadge.remove();
    
    // Add badge if has quantity
    if (item && item.qty > 0) {
      const badge = document.createElement('span');
      badge.className = 'qty-badge';
      badge.textContent = item.qty;
      btn.appendChild(badge);
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
    document.getElementById('cartItems').textContent = `${totalQty} item${totalQty > 1 ? 's' : ''}`;
    document.getElementById('cartTotal').textContent = `Rs ${totalAmount.toLocaleString()}`;
  } else {
    summary.style.display = 'none';
  }
}

function updateSubmitState() {
  const name = document.getElementById('customerName').value.trim();
  const contact1 = document.getElementById('contact1').value.trim();
  const region = document.getElementById('region').value;
  const hasProducts = Object.values(cart).some(i => i.qty > 0);
  
  const btn = document.getElementById('submitBtn');
  btn.disabled = !name || !contact1 || !region || !hasProducts;
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
    products: Object.values(cart).filter(i => i.qty > 0).map(i => ({
      name: i.name,
      price: i.price,
      qty: i.qty
    }))
  };
  
  try {
    const res = await fetch(`${API_BASE}/api/extension`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
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
    console.error('Submit error:', err);
    errorMsg.textContent = 'Connection error. Please try again.';
    errorMsg.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Create Order';
  }
}

function showSuccess(createdBy) {
  content.innerHTML = `
    <div class="success-msg">
      <div class="checkmark">✓</div>
      <h3>Order Created!</h3>
      <p>Order was successfully created${createdBy ? ` by ${createdBy}` : ''}.</p>
      <button class="new-order-btn" id="newOrderBtn">Create Another Order</button>
    </div>
  `;
  
  // Clear cart
  cart = {};
  
  // Clear saved data
  chrome.storage.local.remove(['name', 'c1', 'c2']);
  
  document.getElementById('newOrderBtn').addEventListener('click', () => {
    renderForm();
  });
}

// Start
init();
