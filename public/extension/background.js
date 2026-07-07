// Akmez Extension Background Script
// Handles API calls from content script - syncs with popup auth state

const API_BASE = 'https://www.akmez.tech';

// Helper to get auth headers from stored token
async function getAuthHeaders() {
  return new Promise(resolve => {
    chrome.storage.local.get(['authToken', 'refreshToken'], stored => {
      if (stored.authToken) {
        const headers = { 'Authorization': `Bearer ${stored.authToken}`, 'Content-Type': 'application/json' };
        if (stored.refreshToken) headers['X-Refresh-Token'] = stored.refreshToken;
        resolve(headers);
      } else {
        resolve({ 'Content-Type': 'application/json' });
      }
    });
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Handle all actions asynchronously
  (async () => {
    const headers = await getAuthHeaders();
    
    if (request.action === 'fetchData') {
      try {
        const res = await fetch(API_BASE + '/api/extension', { headers });
        const data = await res.json();
        sendResponse({ success: true, data });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }
    
    if (request.action === 'createOrder') {
      try {
        const res = await fetch(API_BASE + '/api/extension', {
          method: 'POST',
          headers,
          body: JSON.stringify(request.data)
        });
        const data = await res.json();
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
    
    if (request.action === 'clockIn' || request.action === 'clockOut') {
      try {
        const res = await fetch(API_BASE + '/api/extension/worktime', {
          method: 'POST',
          headers,
          body: JSON.stringify({ 
            action: request.action === 'clockIn' ? 'clock_in' : 'clock_out',
            pin: request.pin 
          })
        });
        const data = await res.json();
        
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
