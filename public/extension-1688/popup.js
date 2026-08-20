// Akmez 1688 Guide - popup
// The guide itself lives in the page (content.js); this popup is just an entry
// point, so it only needs to get the user onto a 1688 page.

document.getElementById('open').onclick = () => {
  chrome.tabs.create({ url: 'https://s.1688.com/selloffer/offer_search.htm' })
  window.close()
}
