// Akmez Quick Order - Extension Popup v4.0.0
// This popup shows CONNECTION STATUS ONLY. All login and features are in the floating button (content.js).

const content = document.getElementById('content');

// Check authentication status on load
checkAuth();

// Update status live if auth changes (e.g. signed in/out via the floating button)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.authToken || changes.userName)) {
    checkAuth();
  }
});

async function checkAuth() {
  content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Loading...</p></div>';

  chrome.storage.local.get(['authToken', 'userName', 'userEmail'], (stored) => {
    if (!stored.authToken) {
      renderDisconnected();
      return;
    }
    // Verify via background script - it auto-refreshes expired sessions
    chrome.runtime.sendMessage({ action: 'fetchData' }, (response) => {
      if (response && response.success && response.data && response.data.authenticated) {
        renderConnected(stored.userName || 'User', stored.userEmail || '');
      } else if (response && !response.success) {
        // Network error - show connected optimistically since a token exists
        renderConnected(stored.userName || 'User', stored.userEmail || '');
      } else {
        renderDisconnected();
      }
    });
  });
}

function renderConnected(name, email) {
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
    chrome.runtime.sendMessage({ action: 'logout' }, () => {
      renderDisconnected();
    });
  };
}

function renderDisconnected() {
  content.innerHTML = `
    <div class="disconnected">
      <div class="status-icon">!</div>
      <div class="user-name">Not Signed In</div>
      <div class="info-text">
        Click the <strong>floating A button</strong> on any page to sign in and start creating orders.
      </div>
      <button class="refresh-btn" id="refresh-btn">Refresh Status</button>
    </div>
  `;

  document.getElementById('refresh-btn').onclick = () => checkAuth();
}
