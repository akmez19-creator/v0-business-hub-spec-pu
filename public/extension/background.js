// Akmez Extension Background Script v4.0
// Handles API calls from content script - syncs with popup auth state
// Automatically refreshes expired sessions using the stored refresh token

const API_BASE = 'https://www.akmez.tech';

// Read stored auth state
function getStoredAuth() {
  return new Promise(resolve => {
    chrome.storage.local.get(['authToken', 'refreshToken'], stored => resolve(stored));
  });
}

// Build headers from a token
function buildHeaders(token, refreshToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (refreshToken) headers['X-Refresh-Token'] = refreshToken;
  return headers;
}

// Try to refresh the session. Returns new access token or null.
async function tryRefreshSession() {
  const stored = await getStoredAuth();
  if (!stored.refreshToken) return null;

  try {
    const res = await fetch(API_BASE + '/api/extension/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken })
    });
    const data = await res.json();

    if (data.success && data.accessToken) {
      await chrome.storage.local.set({
        authToken: data.accessToken,
        refreshToken: data.refreshToken || stored.refreshToken,
        tokenExpiry: data.expiresAt
      });
      return data.accessToken;
    }
  } catch (e) {
    // Network error - do not clear tokens, might be temporary
    return null;
  }

  // Refresh token is invalid - clear session
  await chrome.storage.local.remove(['authToken', 'refreshToken', 'tokenExpiry', 'userName', 'userEmail']);
  return null;
}

// Fetch with automatic session refresh on auth failure (retries once)
async function fetchWithAuth(url, options = {}) {
  const stored = await getStoredAuth();
  let res = await fetch(url, { ...options, headers: buildHeaders(stored.authToken, stored.refreshToken) });
  let data = await res.json();

  // If the session is invalid/expired, try refreshing once and retry
  const authFailed = res.status === 401 || data.authenticated === false;
  if (authFailed && stored.refreshToken) {
    const newToken = await tryRefreshSession();
    if (newToken) {
      const freshStored = await getStoredAuth();
      res = await fetch(url, { ...options, headers: buildHeaders(newToken, freshStored.refreshToken) });
      data = await res.json();
    }
  }

  return data;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.action === 'fetchData') {
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension');
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'createOrder') {
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension', {
          method: 'POST',
          body: JSON.stringify(request.data)
        });
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'login') {
      try {
        const res = await fetch(API_BASE + '/api/extension/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: request.email, password: request.password })
        });
        const data = await res.json();

        if (data.success && data.accessToken) {
          // Store auth info (shared between popup and content script)
          await chrome.storage.local.set({
            authToken: data.accessToken,
            refreshToken: data.refreshToken || '',
            tokenExpiry: data.expiresAt,
            userName: data.user?.name || request.email.split('@')[0],
            userEmail: request.email
          });
          sendResponse({ success: true, data });
        } else {
          sendResponse({ success: false, error: data.error || 'Login failed' });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'logout') {
      await chrome.storage.local.remove(['authToken', 'refreshToken', 'tokenExpiry', 'userName', 'userEmail']);
      sendResponse({ success: true });
      return;
    }

    if (request.action === 'clockIn' || request.action === 'clockOut') {
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension/worktime', {
          method: 'POST',
          body: JSON.stringify({
            action: request.action === 'clockIn' ? 'clock_in' : 'clock_out',
            pin: request.pin
          })
        });

        if (data.error) {
          sendResponse({ success: false, error: data.error });
        } else {
          sendResponse({ success: true, data });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    // Unknown action
    sendResponse({ success: false, error: 'Unknown action' });
  })();

  return true; // Keep channel open for async response
});
