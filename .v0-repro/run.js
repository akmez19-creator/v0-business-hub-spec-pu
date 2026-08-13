// Reproduce the "region + product dropdowns dead when no ad id" bug by running
// the ACTUAL content.js top-level code in jsdom and watching for a throw and
// for whether the region/product focus listeners get attached.
const fs = require('fs');
const { JSDOM } = require('/vercel/share/v0-project/node_modules/jsdom');

const src = fs.readFileSync('/vercel/share/v0-project/public/extension/content.js', 'utf8');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://www.messenger.com/t/123',
  pretendToBeVisual: true,
});
const { window } = dom;

window.chrome = {
  runtime: {
    sendMessage: (msg, cb) => { if (typeof cb === 'function') setTimeout(() => cb({ success: false }), 0); },
    onMessage: { addListener: () => {} },
    lastError: null,
    getManifest: () => ({ version: '4.60.1' }),
    getURL: (p) => p,
  },
  storage: {
    local: { get: (k, cb) => cb && cb({}), set: () => {} },
    onChanged: { addListener: () => {} },
  },
};
window.fetch = () => Promise.reject(new Error('no network in repro'));

let regionFocusWired = false, prodFocusWired = false;
const realAdd = window.HTMLElement.prototype.addEventListener;
window.HTMLElement.prototype.addEventListener = function (type, fn, opts) {
  if (type === 'focus' && this.id === 'ak-region') regionFocusWired = true;
  if (type === 'focus' && this.id === 'ak-search') prodFocusWired = true;
  return realAdd.call(this, type, fn, opts);
};

// Capture uncaught errors thrown from timers/promises too.
const uncaught = [];
window.addEventListener('error', e => uncaught.push('window.onerror: ' + (e.error && e.error.message)));
process.on('uncaughtException', e => uncaught.push('uncaught: ' + e.message));

let threw = null;
const g = window;
// Capture the internal renderOrdersForm closure so we can drive it directly.
const hookedSrc = src + '\n;window.__reproRenderOrders = (typeof renderOrdersForm==="function") ? renderOrdersForm : null;';
const runner = new Function('window', 'document', 'chrome', 'fetch', 'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'navigator', 'location', 'MutationObserver', hookedSrc);
try {
  runner(g, g.document, g.chrome, g.fetch, g.setTimeout, g.setInterval, g.clearInterval, g.clearTimeout, g.navigator, g.location, g.MutationObserver);
} catch (e) {
  threw = e;
}

// Now render the Orders form in the NO-AD-ID scenario (the reported bug state).
let renderErr = null;
if (g.__reproRenderOrders) {
  // Ensure the panel shell exists.
  if (!g.document.getElementById('akmez-body')) {
    const b = g.document.createElement('div');
    b.id = 'akmez-body';
    (g.document.getElementById('akmez-widget') || g.document.body).appendChild(b);
  }
  try {
    g.__reproRenderOrders();
  } catch (e) {
    renderErr = e;
  }
} else {
  renderErr = new Error('renderOrdersForm not reachable');
}

setTimeout(() => {
  console.log('=== RESULT ===');
  console.log('threw at top-level        :', threw ? (threw.name + ': ' + threw.message) : 'no');
  if (threw && threw.stack) console.log(threw.stack.split('\n').slice(0, 4).join('\n'));
  console.log('renderOrdersForm threw    :', renderErr ? (renderErr.name + ': ' + renderErr.message) : 'no');
  if (renderErr && renderErr.stack) {
    const hint = renderErr.stack.split('\n').slice(1, 4).join('\n');
    console.log(hint);
  }
  console.log('region focus listener set :', regionFocusWired);
  console.log('product focus listener set:', prodFocusWired);
  console.log('ak-region-suggest exists  :', !!g.document.getElementById('ak-region-suggest'));
  console.log('ak-prod-suggest exists    :', !!g.document.getElementById('ak-search'));
  console.log('ak-livead exists          :', !!g.document.getElementById('ak-livead'));
  if (uncaught.length) console.log('async errors              :', uncaught.join(' | '));
  process.exit(0);
}, 300);
