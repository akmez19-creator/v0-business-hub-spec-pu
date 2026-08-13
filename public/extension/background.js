// Akmez Extension Background Script v4.0
// Handles API calls from content script - syncs with popup auth state
// Automatically refreshes expired sessions using the stored refresh token

const API_BASE = 'https://www.akmez.tech';

// Ad picker list, cached in memory for 5 min so opening the dropdown on every
// order does not re-hit the server. { at, ads } or null.
let adsListCache = null;

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

    if (request.action === 'updateOrder') {
      // Agent edits an entry they created (server enforces ownership + status)
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension', {
          method: 'PATCH',
          body: JSON.stringify(request.data)
        });
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'aiReply') {
      // Ask the server (Vercel AI Gateway / ChatGPT) to draft a reply from the
      // conversation the content script scraped via the message selectors.
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension/ai-reply', {
          method: 'POST',
          body: JSON.stringify(request.data)
        });
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'getClientRating') {
      // Instant client rating lookup by phone (indexed point read on the server)
      try {
        const data = await fetchWithAuth(API_BASE + '/api/clients/rating?phone=' + encodeURIComponent(request.phone), {
          method: 'GET'
        });
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'getClientLastDelivered') {
      // Most recent delivered product for a phone (to gate Exchange / Trade In)
      try {
        const data = await fetchWithAuth(API_BASE + '/api/clients/last-delivered?phone=' + encodeURIComponent(request.phone), {
          method: 'GET'
        });
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'getMyStats') {
      // Agent stats: today's totals + 30-day client search (q optional)
      try {
        const qs = request.q ? '?q=' + encodeURIComponent(request.q) : '';
        const data = await fetchWithAuth(API_BASE + '/api/extension/stats' + qs, { method: 'GET' });
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'getWeather') {
      // Live Mauritius forecast from Open-Meteo (free, no API key). Port Louis
      // coordinates; 16-day daily weather code, max/min temp, rain probability.
      try {
        const url = 'https://api.open-meteo.com/v1/forecast'
          + '?latitude=-20.16&longitude=57.50'
          + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
          + '&timezone=Indian%2FMauritius&forecast_days=16';
        const res = await fetch(url);
        const json = await res.json();
        const byDate = {};
        const d = json && json.daily;
        if (d && Array.isArray(d.time)) {
          d.time.forEach((date, i) => {
            byDate[date] = {
              code: d.weather_code ? d.weather_code[i] : null,
              tMax: d.temperature_2m_max ? d.temperature_2m_max[i] : null,
              tMin: d.temperature_2m_min ? d.temperature_2m_min[i] : null,
              rain: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null,
            };
          });
        }
        sendResponse({ success: true, data: { byDate } });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'resolveAdProduct') {
      // Resolve the product linked to a captured Ad ID (ad -> campaign -> product)
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension/resolve-ad?adId=' + encodeURIComponent(request.adId), {
          method: 'GET'
        });
        sendResponse({
          success: !!data.success,
          product: data.product || null,
          campaignId: data.campaignId || null,
          unmapped: !!data.unmapped,
          error: data.error
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'learnAdProduct') {
      // Teach the ad -> campaign -> product link from what the agent actually
      // sold, so the next client on that campaign resolves with no guessing.
      // Fire-and-forget for the caller: failing here must never block an order.
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension/learn-ad-product', {
          method: 'POST',
          body: JSON.stringify({ adId: request.adId, productId: request.productId })
        });
        sendResponse({ success: !!data.success, learned: !!data.learned, error: data.error });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'listAds') {
      // Ads the agent can attribute an order to (served from the ads cache).
      // Cached for the session so reopening the picker is instant.
      try {
        if (adsListCache && Date.now() - adsListCache.at < 5 * 60 * 1000) {
          sendResponse({ success: true, ads: adsListCache.ads });
          return;
        }
        const data = await fetchWithAuth(API_BASE + '/api/extension/list-ads', { method: 'GET' });
        if (data.success) adsListCache = { at: Date.now(), ads: data.ads || [] };
        sendResponse({ success: !!data.success, ads: data.ads || [], error: data.error });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (request.action === 'saveSettings') {
      // Admin-only: push shared extension settings to the server
      try {
        const data = await fetchWithAuth(API_BASE + '/api/extension', {
          method: 'PUT',
          body: JSON.stringify(request.data)
        });
        sendResponse({ success: !!data.success, data, error: data.error });
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
          
          // Auto clock-in: logging in starts the working time
          try {
            await fetchWithAuth(API_BASE + '/api/extension/worktime', {
              method: 'POST',
              body: JSON.stringify({ action: 'clock_in', auto: true })
            });
          } catch (e) {
            // Clock-in failure should not block login
          }
          
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
      // Clock out before clearing the session - logging out ends the working time
      try {
        await fetchWithAuth(API_BASE + '/api/extension/worktime', {
          method: 'POST',
          body: JSON.stringify({ action: 'clock_out', auto: true })
        });
      } catch (e) {
        // Clock-out failure should not block logout
      }
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
            // The agent is already authenticated via email + password, so no
            // PIN is required - clock in/out with a single tap.
            auto: true
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

// ===== Keyboard shortcut: toggle the widget on the active tab =====
// Declared in manifest.json "commands"; user can rebind it at
// chrome://extensions/shortcuts (default Alt+A).
if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-widget') return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { action: 'toggleWidget' });
    } catch (e) {
      // No active tab or content script not injected (e.g. chrome:// pages)
    }
  });
}

// ===== Idle detection: 5 minutes of inactivity = auto clock-out + logout =====
const IDLE_SECONDS = 300; // 5 minutes

if (chrome.idle) {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);

  chrome.idle.onStateChanged.addListener(async (state) => {
    // 'idle' = no mouse/keyboard input for IDLE_SECONDS; 'locked' = screen locked
    if (state !== 'idle' && state !== 'locked') return;

    const stored = await getStoredAuth();
    if (!stored.authToken) return; // Not signed in - nothing to do

    // Clock out first so the shift records the correct end time
    try {
      await fetchWithAuth(API_BASE + '/api/extension/worktime', {
        method: 'POST',
        body: JSON.stringify({ action: 'clock_out', auto: true })
      });
    } catch (e) {
      // Even if clock-out fails (network), still log out for security
    }

    // Log out - clear the session
    await chrome.storage.local.remove(['authToken', 'refreshToken', 'tokenExpiry', 'userName', 'userEmail']);
  });
}
