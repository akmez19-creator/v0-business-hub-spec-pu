// Akmez Quick Order - Extension Popup v3.0.0
// This popup handles login/logout only. All features are in the floating button (content.js).

const API_BASE = 'https://www.akmez.tech';
const content = document.getElementById('content');

// Check authentication status on load
checkAuth();

async function checkAuth() {
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';
  
  // Check stored auth
  chrome.storage.local.get(['authToken', 'tokenExpiry', 'userName', 'userEmail'], async (stored) => {
    const isLoggedIn = stored.authToken && stored.tokenExpiry && Date.now() < stored.tokenExpiry * 1000;
    
    if (isLoggedIn) {
      // Verify token is still valid with server
      try {
        const res = await fetch(`${API_BASE}/api/extension`, {
          headers: { 'Authorization': `Bearer ${stored.authToken}` }
        });
        const data = await res.json();
        
        if (data.authenticated) {
          renderLoggedIn(stored.userName || 'User', stored.userEmail || '');
        } else {
          // Token invalid, clear and show login
          chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName', 'userEmail']);
          renderLogin();
        }
      } catch (err) {
        // Network error, but show logged in state if token exists
        renderLoggedIn(stored.userName || 'User', stored.userEmail || '');
      }
    } else {
      renderLogin();
    }
  });
}

function renderLoggedIn(name, email) {
  const initial = name.charAt(0).toUpperCase();
  content.innerHTML = `
    <div class="logged-in">
      <div class="user-avatar">${initial}</div>
      <div class="user-name">${name}</div>
      <div class="user-email">${email}</div>
      <div class="status-badge">
        <span class="dot"></span>
        Connected
      </div>
      <div class="info-text">
        Click the <strong>floating A button</strong> on any page to create orders and manage working time.
      </div>
      <button class="logout-btn" id="logout-btn">Sign Out</button>
    </div>
  `;
  
  document.getElementById('logout-btn').onclick = () => {
    chrome.storage.local.remove(['authToken', 'tokenExpiry', 'userName', 'userEmail']);
    renderLogin();
  };
}

function renderLogin(error) {
  content.innerHTML = `
    <div class="login-form">
      <div class="login-title">Sign in to Akmez</div>
      <div class="error-msg" id="error-msg">${error || ''}</div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="email" placeholder="your@email.com" autocomplete="email" />
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="password" placeholder="Enter password" autocomplete="current-password" />
      </div>
      <button class="login-btn" id="login-btn">Sign In</button>
    </div>
  `;
  
  if (error) {
    document.getElementById('error-msg').style.display = 'block';
  }
  
  // Enter key to submit
  document.getElementById('email').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('password').focus();
  });
  document.getElementById('password').addEventListener('keypress', e => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });
  
  document.getElementById('login-btn').onclick = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const btn = document.getElementById('login-btn');
    const errEl = document.getElementById('error-msg');
    
    errEl.style.display = 'none';
    
    if (!email || !password) {
      errEl.textContent = 'Please enter email and password';
      errEl.style.display = 'block';
      return;
    }
    
    btn.disabled = true;
    btn.textContent = 'Signing in...';
    
    try {
      const res = await fetch(`${API_BASE}/api/extension/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      const data = await res.json();
      
      if (data.success && data.accessToken) {
        // Store auth info (shared with content.js)
        await chrome.storage.local.set({
          authToken: data.accessToken,
          tokenExpiry: data.expiresAt,
          userName: data.user?.name || email.split('@')[0],
          userEmail: email
        });
        renderLoggedIn(data.user?.name || email.split('@')[0], email);
      } else {
        errEl.textContent = data.error || 'Invalid email or password';
        errEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    } catch (err) {
      errEl.textContent = 'Connection error. Please try again.';
      errEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  };
}
