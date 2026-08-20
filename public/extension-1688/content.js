// Akmez 1688 Guide - content script
// -----------------------------------------------------------------------------
// 1688.com is entirely in Chinese and its markup class names are generated and
// change without notice. So NOTHING here is selector-based: every control is
// located by the Chinese LABEL the user actually sees on screen. That text is
// the stable part of the page, which makes the guide survive redesigns.
// -----------------------------------------------------------------------------

(() => {
  if (window.__akzGuideLoaded) return
  window.__akzGuideLoaded = true

  const APP = 'https://www.akmez.tech'

  // ---------------------------------------------------------------------------
  // Glossary. Longest strings first so "加入进货单" matches before "进货单".
  // ---------------------------------------------------------------------------
  const GLOSSARY = [
    // buying actions
    ['加入进货单', 'Add to purchase cart', 'Like "add to basket" - it does NOT order yet'],
    ['立即订购', 'Order now', 'Goes straight to checkout'],
    ['立即下单', 'Place order now', ''],
    ['提交订单', 'Submit order', 'This confirms the order'],
    ['去下单', 'Go to checkout', ''],
    ['我要订货', 'I want to order', ''],
    ['进货单', 'Purchase cart', ''],
    ['结算', 'Checkout', ''],
    ['去结算', 'Go to checkout', ''],
    ['和我联系', 'Contact supplier', 'Opens Wangwang chat (Chinese only)'],
    ['联系供应商', 'Contact supplier', ''],
    ['联系商家', 'Contact seller', ''],
    ['旺旺', 'Wangwang chat', "1688's built-in chat app"],
    ['收藏', 'Add to favourites', ''],
    ['分享', 'Share', ''],
    ['举报', 'Report listing', ''],

    // price / quantity
    ['起订量', 'Minimum order qty (MOQ)', 'The fewest units the seller will sell'],
    ['最小起订量', 'Minimum order qty (MOQ)', ''],
    ['批发价', 'Wholesale price', ''],
    ['单价', 'Unit price', ''],
    ['价格', 'Price', ''],
    ['数量', 'Quantity', ''],
    ['库存', 'Stock available', ''],
    ['总价', 'Total price', ''],
    ['合计', 'Total', ''],
    ['总计', 'Grand total', ''],
    ['运费', 'Shipping fee', ''],
    ['包邮', 'Free shipping', 'Free only inside mainland China'],
    ['元', 'yuan (CNY)', ''],
    ['件', 'pieces', ''],
    ['个', 'pieces', ''],
    ['台', 'units', ''],
    ['箱', 'cartons', ''],
    ['套', 'sets', ''],

    // product info
    ['商品详情', 'Product details', ''],
    ['产品参数', 'Product specifications', ''],
    ['规格', 'Specification', ''],
    ['颜色分类', 'Colour / variant', ''],
    ['品牌', 'Brand', ''],
    ['型号', 'Model number', ''],
    ['材质', 'Material', ''],
    ['重量', 'Weight', 'Use this for your CBM / import cost estimate'],
    ['尺寸', 'Size / dimensions', ''],
    ['包装', 'Packaging', ''],
    ['产地', 'Place of origin', ''],
    ['发货地', 'Ships from', ''],
    ['交易勋章', 'Trade medal', ''],

    // supplier trust signals
    ['支持定制', 'OEM / custom orders accepted', 'This seller can brand the product for you'],
    ['来样定制', 'Custom to your sample (OEM)', ''],
    ['定制', 'Customisation / OEM', ''],
    ['一件代发', 'Dropshipping available', ''],
    ['混批', 'Mixed batch allowed', ''],
    ['批发', 'Wholesale', ''],
    ['实力工厂', 'Verified factory', 'A real manufacturer, not a reseller'],
    ['超级工厂', 'Super factory', 'Top-tier verified manufacturer'],
    ['工厂', 'Factory', ''],
    ['厂家直销', 'Direct from factory', ''],
    ['生产厂家', 'Manufacturer', ''],
    ['经销批发', 'Trading company', 'A reseller, not the maker'],
    ['回头率', 'Repeat buyer rate', 'High = buyers come back. Strong quality signal'],
    ['复购率', 'Repeat purchase rate', ''],
    ['成交额', 'Transaction volume', ''],
    ['销量', 'Sales volume', ''],
    ['已售', 'Units sold', ''],
    ['成交', 'Transactions', ''],
    ['评价', 'Reviews', ''],
    ['评分', 'Rating', ''],
    ['年', 'years on 1688', 'More years = more established'],
    ['认证', 'Certified', ''],
    ['诚信通', 'Trust-verified member', 'Paid verified supplier status'],
    ['深圳', 'Shenzhen', ''],
    ['广州', 'Guangzhou', ''],
    ['义乌', 'Yiwu', ''],
    ['东莞', 'Dongguan', ''],
    ['宁波', 'Ningbo', ''],
    ['浙江', 'Zhejiang', ''],
    ['广东', 'Guangdong', ''],

    // search page
    ['综合排序', 'Default sort', ''],
    ['销量优先', 'Sort by sales volume', 'Best way to find proven products'],
    ['价格排序', 'Sort by price', ''],
    ['筛选', 'Filters', ''],
    ['全部', 'All', ''],
    ['找相似', 'Find similar items', ''],
    ['以图搜图', 'Search by image', ''],
    ['图片搜索', 'Image search', ''],
    ['搜索', 'Search', ''],
    ['搜本店', 'Search this shop', ''],
    ['商品', 'Products', ''],
    ['店铺', 'Shops', ''],
    ['供应商', 'Suppliers', ''],

    // checkout / account
    ['收货地址', 'Delivery address', 'Use your China forwarder / agent address'],
    ['备注', 'Remarks to seller', ''],
    ['支付方式', 'Payment method', ''],
    ['支付宝', 'Alipay', ''],
    ['物流', 'Logistics', ''],
    ['快递', 'Courier', ''],
    ['登录', 'Log in', ''],
    ['注册', 'Register', ''],
    ['密码', 'Password', ''],
    ['手机号', 'Mobile number', ''],
    ['验证码', 'Verification code', ''],
    ['我的阿里', 'My Alibaba (account)', ''],
    ['已买到的货品', 'My orders', ''],
  ]

  const GLOSSARY_SORTED = [...GLOSSARY].sort((a, b) => b[0].length - a[0].length)

  // Controls worth tagging inline with an English badge, and the badge tone.
  const TAG_TONE = {
    加入进货单: 'go',
    立即订购: 'go',
    立即下单: 'go',
    提交订单: 'warn',
    去结算: 'warn',
    结算: 'warn',
    和我联系: '',
    联系供应商: '',
    支持定制: 'go',
    实力工厂: 'go',
    超级工厂: 'go',
    起订量: '',
    销量优先: 'go',
    以图搜图: '',
    找相似: '',
  }

  // ---------------------------------------------------------------------------
  // Playbooks: what to actually do on each kind of 1688 page.
  // `find` holds the Chinese labels to hunt for when the step is clicked.
  // ---------------------------------------------------------------------------
  const PLAYBOOKS = {
    detail: {
      name: 'Product page',
      steps: [
        {
          title: 'Check the minimum order quantity',
          body: 'Confirm the MOQ before anything else - many sellers will not sell below it.',
          find: ['起订量', '最小起订量'],
        },
        {
          title: 'Read the price tiers',
          body: 'Prices in yuan drop as quantity rises. The cheapest tier is what you quote against.',
          find: ['批发价', '单价', '价格'],
        },
        {
          title: 'Confirm this seller is a factory',
          body: 'A factory can do OEM and own-brand runs. A trading company only resells.',
          find: ['实力工厂', '超级工厂', '生产厂家', '厂家直销', '工厂'],
          note: 'No factory badge means you are likely talking to a middleman.',
        },
        {
          title: 'Check if OEM / branding is offered',
          body: 'Look for the customisation badge if you want your own brand on the product.',
          find: ['支持定制', '来样定制', '定制'],
          note: 'Optional - only present on sellers that accept custom work.',
        },
        {
          title: 'Note weight and packaging',
          body: 'You need these for the CBM, carton count and import cost fields in the PO.',
          find: ['重量', '包装', '尺寸'],
        },
        {
          title: 'Pick the variant you want',
          body: 'Choose colour/size first, or the cart will hold the wrong option.',
          find: ['颜色分类', '规格'],
        },
        {
          title: 'Add to the purchase cart',
          body: 'This is the orange "add to basket" button - it does not place an order yet.',
          find: ['加入进货单', '我要订货'],
        },
        {
          title: 'Message the supplier',
          body: 'Opens Wangwang chat. Write in English, then paste a translation - most sellers use a translator anyway.',
          find: ['和我联系', '联系供应商', '联系商家'],
        },
      ],
    },
    search: {
      name: 'Search results',
      steps: [
        {
          title: 'Sort by sales volume',
          body: 'Sorting by units sold surfaces proven products instead of paid placements.',
          find: ['销量优先', '销量'],
        },
        {
          title: 'Search by image instead of words',
          body: 'The camera icon finds visually identical products - far better than English keywords here.',
          find: ['以图搜图', '图片搜索'],
        },
        {
          title: 'Filter to factories only',
          body: 'Use the filter bar to restrict results to real manufacturers.',
          find: ['筛选', '实力工厂', '工厂'],
        },
        {
          title: 'Compare repeat-buyer rates',
          body: 'A high repeat rate means other buyers reorder - the strongest quality signal on 1688.',
          find: ['回头率', '复购率'],
        },
        {
          title: 'Open a listing',
          body: 'Click a product card, then reopen this guide - it switches to the product-page walkthrough.',
          find: ['找相似'],
        },
      ],
    },
    cart: {
      name: 'Purchase cart',
      steps: [
        {
          title: 'Check quantities against MOQ',
          body: 'Each seller has its own minimum. Lines below it will fail at checkout.',
          find: ['数量', '起订量'],
        },
        {
          title: 'Review the total',
          body: 'The total is in yuan (CNY) and excludes international freight.',
          find: ['合计', '总计', '总价'],
        },
        {
          title: 'Proceed to checkout',
          body: 'Only continue once every line and quantity is correct.',
          find: ['去结算', '结算'],
        },
      ],
    },
    order: {
      name: 'Checkout',
      steps: [
        {
          title: 'Set the delivery address',
          body: 'This must be your China forwarder or agent warehouse, never your home address.',
          find: ['收货地址'],
        },
        {
          title: 'Add remarks for the seller',
          body: 'Note packaging or labelling requirements here so they are on record.',
          find: ['备注'],
        },
        {
          title: 'Check the shipping fee',
          body: 'This is domestic China freight only - your forwarder bills the rest separately.',
          find: ['运费', '物流'],
        },
        {
          title: 'Submit the order',
          body: 'This is the final, committing step. Everything above must be correct first.',
          find: ['提交订单'],
          note: 'Nothing is charged until you pay, but the order is created.',
        },
      ],
    },
    login: {
      name: 'Login page',
      steps: [
        { title: 'Enter your mobile number', body: 'Chinese accounts sign in by phone number.', find: ['手机号'] },
        { title: 'Enter your password', body: '', find: ['密码'] },
        { title: 'Enter the SMS code', body: 'A verification code is sent to your phone.', find: ['验证码'] },
        { title: 'Log in', body: '', find: ['登录'] },
      ],
    },
    home: {
      name: '1688 home',
      steps: [
        {
          title: 'Search by image',
          body: 'The camera icon in the search bar is the most reliable way to find a product.',
          find: ['以图搜图', '图片搜索'],
        },
        { title: 'Or type a search', body: 'English works surprisingly well on 1688.', find: ['搜索'] },
        { title: 'Open your cart', body: '', find: ['进货单'] },
        { title: 'Open your orders', body: '', find: ['已买到的货品', '我的阿里'] },
      ],
    },
  }

  // ---------------------------------------------------------------------------
  // Page detection
  // ---------------------------------------------------------------------------
  /** The built-in Chinese playbooks only make sense on 1688 itself. */
  function on1688() {
    return /(^|\.)1688\.com$/i.test(location.hostname)
  }

  function detectPage() {
    const h = location.hostname
    const p = location.pathname
    const u = location.href
    // Everywhere else there is no hand-written playbook - the AI reads the page
    // instead, so the guide still works on any site.
    if (!on1688()) return 'other'
    if (/login|passport/i.test(h) || /login/i.test(p)) return 'login'
    if (/\/offer\/\d+/.test(p) || /detail\.1688\.com/i.test(h)) return 'detail'
    if (/cart/i.test(h) || /cart/i.test(p)) return 'cart'
    if (/trade|buy|order/i.test(h) || /(submit|buy|order)/i.test(p)) return 'order'
    if (/^s\./i.test(h) || /(\/s\/|search|offer_search|page\/offerlist)/i.test(u)) return 'search'
    if (p === '/' || p === '') return 'home'
    return 'search'
  }

  // ---------------------------------------------------------------------------
  // Element lookup by visible Chinese text
  // ---------------------------------------------------------------------------
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false
    const r = el.getBoundingClientRect()
    if (r.width < 6 || r.height < 6) return false
    if (r.width > window.innerWidth * 1.6) return false
    const s = getComputedStyle(el)
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05
  }

  // Text of the element itself, ignoring deeply nested children, so we land on
  // the actual button rather than a huge wrapper div that also contains it.
  function ownText(el) {
    let t = ''
    for (const n of el.childNodes) {
      if (n.nodeType === 3) t += n.nodeValue
      else if (n.nodeType === 1 && n.children.length === 0) t += n.textContent
    }
    return t.trim()
  }

  function findByLabels(labels) {
    const nodes = document.querySelectorAll(
      'a, button, span, div, label, td, th, dt, dd, li, strong, b, em, i, input[type=submit], input[type=button]',
    )
    let best = null
    for (const el of nodes) {
      if (el.closest('.akz-root, .akz-panel, .akz-call')) continue
      const txt = ownText(el) || (el.value || '')
      if (!txt || txt.length > 26) continue
      for (let i = 0; i < labels.length; i++) {
        if (!txt.includes(labels[i])) continue
        if (!isVisible(el)) continue
        const r = el.getBoundingClientRect()
        // Prefer the earliest-listed label, then the smallest matching element,
        // which is almost always the control itself rather than its container.
        const score = i * 100000 + r.width * r.height
        if (!best || score < best.score) best = { el, score, label: labels[i] }
        break
      }
    }
    return best
  }

  function translate(cn) {
    for (const [zh, en, note] of GLOSSARY_SORTED) if (cn.includes(zh)) return { zh, en, note }
    return null
  }

  // ---------------------------------------------------------------------------
  // Spotlight
  // ---------------------------------------------------------------------------
  let ring = null
  let call = null

  function clearSpot() {
    ring?.remove()
    call?.remove()
    ring = null
    call = null
    document.querySelectorAll('.akz-step.akz-active').forEach(s => s.classList.remove('akz-active'))
  }

  function spotlight(el, step, index) {
    clearSpot()
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })

    // Wait for the smooth scroll to settle before measuring, otherwise the ring
    // is drawn at the pre-scroll position and points at empty space.
    setTimeout(() => {
      const r = el.getBoundingClientRect()
      const top = r.top + window.scrollY
      const left = r.left + window.scrollX

      ring = document.createElement('div')
      ring.className = 'akz-ring akz-root'
      ring.style.top = top - 6 + 'px'
      ring.style.left = left - 6 + 'px'
      ring.style.width = r.width + 12 + 'px'
      ring.style.height = r.height + 12 + 'px'
      document.body.appendChild(ring)

      call = document.createElement('div')
      call.className = 'akz-call akz-root'
      // AI-generated steps carry no Chinese label list, so `find` may be empty.
      // translate(undefined) would throw and no callout would ever appear.
      const labels = Array.isArray(step.find) ? step.find : []
      const hit = labels.find(f => (ownText(el) || '').includes(f)) || labels[0]
      const t = hit ? translate(hit) : null
      call.innerHTML = `
        <div class="akz-call-n">${esc(step.badge || 'Step ' + (index + 1))}</div>
        <div class="akz-call-t">${esc(step.title)}</div>
        ${step.body ? `<div class="akz-call-b">${esc(step.body)}</div>` : ''}
        ${t ? `<div class="akz-call-b">On screen this reads <b style="color:#7dd3fc">${esc(t.zh)}</b> = <b>${esc(t.en)}</b></div>` : ''}
        <button class="akz-call-close">Got it</button>`
      document.body.appendChild(call)

      // Place the callout below the target, flipping above when it would run off
      // the bottom, and clamped so it never sits under the panel.
      const cw = call.offsetWidth
      const ch = call.offsetHeight
      let cl = left + r.width / 2 - cw / 2
      cl = Math.max(window.scrollX + 10, Math.min(cl, window.scrollX + window.innerWidth - cw - 430))
      let ct = top + r.height + 14
      if (r.bottom + ch + 20 > window.innerHeight) ct = top - ch - 14
      call.style.left = Math.max(10, cl) + 'px'
      call.style.top = Math.max(10, ct) + 'px'
      call.querySelector('.akz-call-close').onclick = clearSpot
    }, 320)
  }

  // ---------------------------------------------------------------------------
  // Inline English badges over recognised Chinese controls
  // ---------------------------------------------------------------------------
  let tagsOn = true
  const tagged = new WeakSet()

  function clearTags() {
    document.querySelectorAll('.akz-tag').forEach(t => t.remove())
  }

  function paintTags() {
    clearTags()
    if (!tagsOn) return
    const wanted = Object.keys(TAG_TONE)
    let placed = 0
    for (const label of wanted) {
      if (placed > 40) break
      const hit = findByLabels([label])
      if (!hit) continue
      const t = translate(label)
      if (!t) continue
      const r = hit.el.getBoundingClientRect()
      const tag = document.createElement('div')
      tag.className = 'akz-tag akz-root' + (TAG_TONE[label] ? ' akz-tag-' + TAG_TONE[label] : '')
      tag.textContent = t.en
      tag.style.top = r.top + window.scrollY - 15 + 'px'
      tag.style.left = r.left + window.scrollX + 'px'
      document.body.appendChild(tag)
      tagged.add(hit.el)
      placed++
    }
  }

  // ---------------------------------------------------------------------------
  // Hover translation
  // ---------------------------------------------------------------------------
  let bubble = null
  function onHover(e) {
    const el = e.target
    if (!el || !el.closest || el.closest('.akz-root, .akz-panel, .akz-call')) return
    const txt = (ownText(el) || '').slice(0, 26)
    if (!txt || !/[\u4e00-\u9fa5]/.test(txt)) {
      bubble?.remove()
      bubble = null
      return
    }
    const t = translate(txt)
    if (!t) {
      bubble?.remove()
      bubble = null
      return
    }
    if (!bubble) {
      bubble = document.createElement('div')
      bubble.className = 'akz-hover akz-root'
      document.body.appendChild(bubble)
    }
    bubble.innerHTML = `${esc(t.en)}${t.note ? `<span>${esc(t.note)}</span>` : ''}`
    bubble.style.left = Math.min(e.clientX + 14, window.innerWidth - 300) + 'px'
    bubble.style.top = Math.min(e.clientY + 16, window.innerHeight - 70) + 'px'
  }

  // ---------------------------------------------------------------------------
  // Listing capture
  // ---------------------------------------------------------------------------
  // innerText is undefined on detached/non-rendered nodes, and reading .match
  // straight off it throws and kills the whole capture. Always fall back.
  function readText(el) {
    if (!el) return ''
    return String(el.innerText ?? el.textContent ?? '')
  }

  function textNear(labels) {
    const hit = findByLabels(labels)
    if (!hit) return ''
    const scope = hit.el.parentElement || hit.el
    return readText(scope).replace(/\s+/g, ' ').trim().slice(0, 90)
  }

  function captureListing() {
    const idMatch = location.pathname.match(/offer\/(\d+)/)
    const title =
      readText(document.querySelector('h1')).trim() ||
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title
    const img =
      document.querySelector('meta[property="og:image"]')?.content ||
      [...document.images].filter(i => i.naturalWidth > 220).sort((a, b) => b.naturalWidth - a.naturalWidth)[0]?.src ||
      ''
    const pageText = readText(document.body)
    const priceText = (pageText.match(/¥\s?[\d.,]+/g) || []).slice(0, 4).join('  ')
    return {
      offerId: idMatch ? idMatch[1] : '',
      url: location.href.split('?')[0],
      title: (title || '').slice(0, 160),
      image: img,
      price: priceText,
      moq: textNear(['起订量', '最小起订量']),
      factory: /实力工厂|超级工厂|生产厂家|厂家直销/.test(pageText),
      oem: /支持定制|来样定制/.test(pageText),
      capturedAt: new Date().toISOString(),
    }
  }

  // ---------------------------------------------------------------------------
  // AI co-pilot
  //
  // The model never receives markup or CSS selectors. The content script builds
  // a numbered map of the controls that are actually VISIBLE right now, sends
  // just their text, and the model answers with those numbers. Resolving a
  // number back to a live element makes it impossible for the model to point at
  // something that is not on screen.
  // ---------------------------------------------------------------------------
  let authToken = null
  let authName = ''
  let aiBusy = false
  let aiError = ''
  let AI_MAP = []

  const store = {
    get: keys => new Promise(r => chrome.storage.local.get(keys, r)),
    set: obj => new Promise(r => chrome.storage.local.set(obj, r)),
    del: keys => new Promise(r => chrome.storage.local.remove(keys, r)),
  }

  // ---------------------------------------------------------------------------
  // Persistent chat
  //
  // Everything the user can see used to live in plain module variables, so a
  // refresh or a click through to another page threw away the whole
  // conversation - the content script is destroyed and re-created on every
  // navigation. All durable state now lives in chrome.storage under one key and
  // is reloaded before the first paint.
  //
  // Threads are kept globally rather than per-site, because a purchasing
  // question that starts on 1688 usually finishes on the Akmez dashboard and
  // splitting it in two would lose exactly the context that makes it useful.
  // ---------------------------------------------------------------------------
  const DB_KEY = 'akzChatV2'
  const MAX_CHATS = 40
  const MAX_MSGS = 80

  /**
   * Element indices are only meaningful for the page map that produced them.
   * This token identifies the CURRENT in-memory map: a message carrying a
   * different token was answered against a page that no longer exists, so its
   * indices must not be trusted. Steps also carry the control's visible label,
   * which is what lets them be re-resolved after a refresh.
   */
  let MAP_TOKEN = 'm' + Date.now() + Math.random().toString(36).slice(2, 7)

  const db = {
    chats: [],
    currentId: null,
    open: false,
    tab: 'chat',
    drafts: {},
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  function currentChat() {
    return db.chats.find(c => c.id === db.currentId) || null
  }

  function newChat(makeCurrent = true) {
    const chat = {
      id: uid(),
      title: '',
      host: location.hostname,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    db.chats.unshift(chat)
    if (makeCurrent) db.currentId = chat.id
    trim()
    return chat
  }

  function ensureChat() {
    return currentChat() || newChat()
  }

  /** Keep storage well under the quota; oldest threads and messages go first. */
  function trim() {
    for (const c of db.chats) {
      if (c.messages.length > MAX_MSGS) c.messages = c.messages.slice(-MAX_MSGS)
    }
    if (db.chats.length > MAX_CHATS) db.chats = db.chats.slice(0, MAX_CHATS)
  }

  function addMessage(role, patch) {
    const chat = ensureChat()
    const msg = { id: uid(), role, text: '', ts: Date.now(), url: location.href, ...patch }
    chat.messages.push(msg)
    chat.updatedAt = Date.now()
    // The first thing the user asked makes a far better thread label than any
    // summary we could generate, and costs nothing.
    if (!chat.title && role === 'user') chat.title = (patch.text || '').slice(0, 60)
    trim()
    save()
    return msg
  }

  // Writes are debounced because a streaming answer would otherwise hit storage
  // on every frame, but anything queued is flushed on pagehide so navigating
  // away mid-answer still keeps it.
  let saveTimer = null
  let writing = false
  function save(immediate = false) {
    clearTimeout(saveTimer)
    const flush = async () => {
      writing = true
      try {
        await store.set({ [DB_KEY]: db })
      } catch {
        // Quota exceeded: drop the oldest half and try once more, rather than
        // silently losing every future write.
        db.chats = db.chats.slice(0, Math.max(1, Math.floor(db.chats.length / 2)))
        try {
          await store.set({ [DB_KEY]: db })
        } catch {}
      }
      writing = false
    }
    if (immediate) return flush()
    saveTimer = setTimeout(flush, 250)
  }

  async function loadDb() {
    const s = await store.get([DB_KEY])
    const saved = s[DB_KEY]
    if (saved && Array.isArray(saved.chats)) {
      db.chats = saved.chats
      db.currentId = saved.currentId || saved.chats[0]?.id || null
      db.open = !!saved.open
      db.tab = saved.tab || 'chat'
      db.drafts = saved.drafts || {}
    }
    trim()
  }

  /**
   * Mirror changes made in other tabs. Without this, two open tabs would each
   * hold a stale copy and the last one to write would silently erase the
   * other's conversation.
   */
  chrome.storage.onChanged?.addListener?.((changes, area) => {
    if (area !== 'local' || !changes[DB_KEY] || writing) return
    const next = changes[DB_KEY].newValue
    if (!next || !Array.isArray(next.chats)) return
    db.chats = next.chats
    db.currentId = next.currentId || db.currentId
    db.drafts = next.drafts || {}
    // Never yank the panel open or shut underneath someone, and never re-render
    // over a half-typed question or a request that is still in flight.
    if (!aiBusy && document.activeElement?.dataset?.akz !== 'q') render()
  })

  // A queued save must not be lost when the page is being torn down.
  window.addEventListener('pagehide', () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      try {
        chrome.storage.local.set({ [DB_KEY]: db })
      } catch {}
    }
  })

  /** Best human-readable label for a control, in the order a person would read it. */
  function labelOf(el) {
    const own = ownText(el)
    if (own) return own.slice(0, 70)
    const aria = el.getAttribute?.('aria-label')
    if (aria) return aria.trim().slice(0, 70)
    if (el.value && typeof el.value === 'string' && el.type !== 'password') return el.value.trim().slice(0, 70)
    const alt = el.querySelector?.('img[alt]')?.getAttribute('alt')
    if (alt) return alt.trim().slice(0, 70)
    const title = el.getAttribute?.('title')
    if (title) return title.trim().slice(0, 70)
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70)
  }

  function hintOf(el) {
    const bits = []
    const ph = el.getAttribute?.('placeholder')
    if (ph) bits.push('placeholder: ' + ph.trim())
    if (el.tagName === 'INPUT' && el.type) bits.push('type ' + el.type)
    if (el.tagName === 'A' && el.getAttribute('href')) bits.push('link')
    // A Chinese label is useless to the model on its own, so ship the English
    // meaning alongside it whenever the glossary knows the term.
    const t = translate(labelOf(el))
    if (t) bits.push('means: ' + t.en)
    return bits.join(', ').slice(0, 70)
  }

  function buildPageMap() {
    const nodes = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=menuitem], summary',
    )
    AI_MAP = []
    // Indices from the previous map are now meaningless; a new token marks the
    // boundary so older messages fall back to resolving by label.
    MAP_TOKEN = 'm' + Date.now() + Math.random().toString(36).slice(2, 7)
    const out = []
    const seen = new Set()
    for (const el of nodes) {
      if (el.closest('.akz-root, .akz-panel, .akz-call')) continue
      if (el.disabled) continue
      if (!isVisible(el)) continue
      const r = el.getBoundingClientRect()
      // Only what the user can actually reach on this screen, plus a little
      // above and below - a 20,000px page would otherwise blow the prompt.
      if (r.bottom < -600 || r.top > window.innerHeight + 1200) continue
      const text = labelOf(el)
      const hint = hintOf(el)
      if (!text && !hint) continue
      const key = el.tagName + '|' + text + '|' + Math.round(r.top) + 'x' + Math.round(r.left)
      if (seen.has(key)) continue
      seen.add(key)
      const i = AI_MAP.length
      AI_MAP.push(el)
      out.push({ i, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', text, hint })
      if (AI_MAP.length >= 120) break
    }
    return out
  }

  async function loadAuth() {
    const s = await store.get(['authToken', 'userName'])
    authToken = s.authToken || null
    authName = s.userName || ''
    return authToken
  }

  async function signIn(email, password) {
    const res = await fetch(APP + '/api/extension/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) throw new Error(json.error || 'Sign in failed')
    await store.set({ authToken: json.accessToken, userName: json.user?.name || '', userEmail: email })
    authToken = json.accessToken
    authName = json.user?.name || ''
  }

  async function askAI(question) {
    aiBusy = true
    aiError = ''
    const chat = ensureChat()
    addMessage('user', { text: question })
    // Clear the saved draft now that it has become a real message, or the box
    // would refill with the same question on the next page.
    delete db.drafts[chat.id]
    render(true)

    try {
      const elements = buildPageMap()
      // Everything before this question, so follow-ups like "and then?" or
      // "do that one instead" actually resolve. Trimmed to the last few turns:
      // the model only needs the thread of the conversation, not the whole
      // transcript, and the page context is re-sent fresh every time anyway.
      const history = chat.messages
        .slice(-9, -1)
        .filter(m => m.text && !m.error)
        .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text.slice(0, 700) }))

      const res = await fetch(APP + '/api/extension/guide-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
        body: JSON.stringify({
          question,
          history,
          url: location.href,
          title: document.title,
          pageText: readText(document.body).replace(/\s+/g, ' ').trim().slice(0, 3000),
          elements,
        }),
      })

      // Branch on the STATUS before reading the body: an expired Supabase
      // session and a server error both arrive as JSON with an `error`, and
      // showing "Unauthorized" as an AI failure sends the user hunting for the
      // wrong problem.
      if (res.status === 401) {
        await store.del(['authToken'])
        authToken = null
        aiError = 'Your session expired. Sign in again.'
        addMessage('assistant', { text: aiError, error: true })
        return
      }
      // A 404 is NOT an AI failure: it means the server this build points at has
      // no guide-ai route (normally because the backend has not been deployed).
      // Reporting it as "AI request failed" sends the user rewording the same
      // question forever at an endpoint that can never answer.
      if (res.status === 404) {
        throw new Error(
          'The Akmez AI service is not live on the server yet, so nothing can answer this. Your question is fine.',
        )
      }
      if (res.status === 429) {
        throw new Error('The AI is rate limited right now. Wait a moment, then ask again.')
      }
      if (res.status >= 500) {
        throw new Error('The Akmez AI server hit an error. Try again in a moment.')
      }

      // Only now is a JSON body a fair assumption. An error page is HTML, and
      // res.json() on HTML throws a SyntaxError that the catch below would have
      // displayed as though it were the AI's own reply.
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) throw new Error(json.error || 'AI request failed')

      const answer = json.answer || ''
      // Record each step's visible label alongside its index. The index is only
      // valid for the map built above, but the label lets the step be found
      // again after a refresh, when the indices mean nothing.
      const steps = (Array.isArray(json.steps) ? json.steps : []).map(s => ({
        ...s,
        label: s.target !== null && AI_MAP[Number(s.target)] ? labelOf(AI_MAP[Number(s.target)]) : '',
      }))

      if (!steps.length && !answer) {
        addMessage('assistant', { text: 'The AI had no answer for this page.', error: true })
      } else {
        addMessage('assistant', {
          text: answer,
          steps,
          mapToken: MAP_TOKEN,
          pageTitle: document.title.slice(0, 120),
        })
      }
    } catch (err) {
      // "Failed to fetch" is the browser's own wording for a request that never
      // completed - blocked by CORS, offline, or the host unreachable. Shown raw
      // it reads like the AI rejected the question, so the user retypes it
      // instead of checking their connection. Translate it into the real cause.
      const raw = err?.message || ''
      const networkFail = /failed to fetch|networkerror|load failed|fetch failed/i.test(raw)
      addMessage('assistant', {
        text: networkFail
          ? 'Could not reach the Akmez server. Check your internet connection - and if it is fine, the AI service may not be deployed yet.'
          : raw || 'Could not reach the AI',
        error: true,
      })
    } finally {
      aiBusy = false
      save(true)
      render(true)
    }
  }

  /**
   * Find the live element a stored step refers to.
   *
   * A step answered against the current page map resolves by index. One
   * restored from storage - after a refresh, or asked on another page - has
   * indices that point into a map that no longer exists, so it is re-found by
   * the control's visible label instead. This is what makes a conversation
   * still actionable after the page reloads.
   */
  function resolveStep(msg, step) {
    if (!step) return null
    if (msg.mapToken === MAP_TOKEN && step.target !== null) {
      const el = AI_MAP[Number(step.target)]
      if (el && document.contains(el)) return el
    }
    if (step.label) {
      const hit = findByLabels([step.label])
      if (hit) return hit.el
    }
    return null
  }

  /** Point at the control an AI step refers to. */
  function showAiStep(msg, idx) {
    const step = msg.steps?.[idx]
    const el = resolveStep(msg, step)
    if (!el) {
      toast('That control is not on this page any more', true)
      return false
    }
    spotlight(
      el,
      {
        title: step.title,
        body: step.why || '',
        find: [],
        badge: step.action === 'fill' ? 'Type here' : step.action === 'look' ? 'Look here' : 'Click here',
      },
      idx,
    )
    return true
  }

  /** Actually perform an AI step, so the user does not have to hunt for it. */
  function doAiStep(msg, idx) {
    const step = msg.steps?.[idx]
    const el = resolveStep(msg, step)
    if (!el) {
      toast('That control is not on this page any more', true)
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (step.action === 'fill') {
      el.focus()
      // Set through the native setter so React-style pages actually register
      // the change; assigning .value alone leaves their state empty.
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      if (setter) setter.call(el, step.value || '')
      else el.value = step.value || ''
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      toast('Typed: ' + (step.value || ''))
    } else if (step.action === 'look') {
      showAiStep(msg, idx)
    } else {
      clearSpot()
      el.click()
      toast('Clicked: ' + labelOf(el).slice(0, 40))
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const esc = s =>
    String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

  function toast(msg, bad) {
    const t = document.createElement('div')
    t.className = 'akz-toast akz-root' + (bad ? ' akz-bad' : '')
    t.textContent = msg
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 2600)
  }

  const fab = document.createElement('button')
  fab.className = 'akz-fab akz-root'
  fab.title = 'Akmez Guide - ask the AI about this page (Alt+Z)'
  fab.textContent = 'AI'
  document.body.appendChild(fab)

  const panel = document.createElement('div')
  panel.className = 'akz-panel akz-root'
  document.body.appendChild(panel)

  /** Light formatting: escape first, then allow **bold**, `code` and line breaks. */
  function fmt(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>')
  }

  function timeAgo(ts) {
    const d = Math.max(0, Date.now() - ts)
    const m = Math.floor(d / 60000)
    if (m < 1) return 'just now'
    if (m < 60) return m + 'm ago'
    const h = Math.floor(m / 60)
    if (h < 24) return h + 'h ago'
    return Math.floor(h / 24) + 'd ago'
  }

  const SUGGESTIONS = {
    detail: ['What is this listing?', 'Is this a factory or a reseller?', 'What is the minimum order?'],
    search: ['Sort these by best selling', 'Which of these is cheapest?', 'Filter to factories only'],
    other: ['What is this page?', 'What can I do here?', 'Explain this in English'],
  }

  function stepsHtml(msg) {
    if (!msg.steps?.length) return ''
    // The step is rendered even when it came from another page: resolving it is
    // decided on click, so a stale one reports honestly instead of vanishing.
    const stale = msg.url && msg.url !== location.href
    return `<div class="akz-steps">
      ${msg.steps
        .map(
          (s, i) => `
        <div class="akz-step akz-ai" data-akz="aistep" data-m="${msg.id}" data-i="${i}">
          <div class="akz-num akz-ainum">${i + 1}</div>
          <div class="akz-stxt">
            <div class="akz-sttl">${esc(s.title)}</div>
            ${s.why ? `<div class="akz-sbody">${esc(s.why)}</div>` : ''}
            ${
              s.target !== null || s.label
                ? `<div class="akz-acts">
                     <button class="akz-mini" data-akz="show" data-m="${msg.id}" data-i="${i}">Show me</button>
                     <button class="akz-mini akz-go" data-akz="do" data-m="${msg.id}" data-i="${i}">
                       ${s.action === 'fill' ? 'Type it' : s.action === 'look' ? 'Point at it' : 'Click it'}
                     </button>
                   </div>`
                : ''
            }
          </div>
        </div>`,
        )
        .join('')}
      ${stale ? `<div class="akz-stale">Answered on another page - the controls are matched by name here.</div>` : ''}
    </div>`
  }

  function transcriptHtml() {
    const chat = currentChat()
    const msgs = chat?.messages || []
    if (!msgs.length) {
      const kind = detectPage()
      const picks = SUGGESTIONS[kind] || SUGGESTIONS.other
      return `<div class="akz-welcome">
        <div class="akz-wmark">A</div>
        <div class="akz-wttl">Ask about this page</div>
        <div class="akz-wsub">I can read what is on screen, explain the Chinese, and click things for you.</div>
        <div class="akz-chips">
          ${picks.map(p => `<button class="akz-chip" data-akz="chip">${esc(p)}</button>`).join('')}
        </div>
      </div>`
    }
    return msgs
      .map(m =>
        m.role === 'user'
          ? `<div class="akz-msg akz-me"><div class="akz-bub">${fmt(m.text)}</div></div>`
          : `<div class="akz-msg akz-ai-msg${m.error ? ' akz-msg-err' : ''}">
               <div class="akz-avatar">A</div>
               <div class="akz-bub">
                 ${m.text ? `<div class="akz-answer">${fmt(m.text)}</div>` : ''}
                 ${stepsHtml(m)}
                 <div class="akz-meta">${timeAgo(m.ts)}</div>
               </div>
             </div>`,
      )
      .join('')
  }

  function historyHtml() {
    if (!db.chats.length) return `<div class="akz-empty">No conversations yet.</div>`
    return db.chats
      .map(
        c => `
      <div class="akz-thread${c.id === db.currentId ? ' akz-tcur' : ''}" data-akz="thread" data-id="${c.id}">
        <div class="akz-tmain">
          <div class="akz-tttl">${esc(c.title || 'Untitled conversation')}</div>
          <div class="akz-tmeta">${esc(c.host || '')} · ${c.messages.length} message${c.messages.length === 1 ? '' : 's'} · ${timeAgo(c.updatedAt)}</div>
        </div>
        <button class="akz-tdel" data-akz="delthread" data-id="${c.id}" title="Delete conversation" aria-label="Delete conversation">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8" />
          </svg>
        </button>
      </div>`,
      )
      .join('')
  }

  function render(toEnd) {
    const kind = detectPage()
    // 'other' has no hand-written playbook - that is what the AI is for.
    const book = PLAYBOOKS[kind] || null
    const isDetail = kind === 'detail'
    const cap = isDetail ? captureListing() : null
    const chat = currentChat()

    // Preserve where the user was: innerHTML replaces every node, which would
    // otherwise jump the transcript to the top and drop focus mid-sentence.
    const oldScroll = panel.querySelector('.akz-scroll')
    const keepScroll = oldScroll ? oldScroll.scrollTop : null
    const atBottom = oldScroll ? oldScroll.scrollHeight - oldScroll.scrollTop - oldScroll.clientHeight < 40 : true
    const focused = document.activeElement?.dataset?.akz === 'q'
    const caret = focused ? document.activeElement.selectionStart : null

    const tab = db.tab || 'chat'

    const signedOut = `
      <div class="akz-signin">
        <div class="akz-sitxt">Sign in with your Akmez account to ask the AI about this page.</div>
        <input class="akz-in" data-akz="email" type="email" placeholder="Email" autocomplete="username" />
        <input class="akz-in" data-akz="pass" type="password" placeholder="Password" autocomplete="current-password" />
        <button class="akz-btn" data-akz="signin">Sign in</button>
        ${aiError ? `<div class="akz-err">${esc(aiError)}</div>` : ''}
      </div>`

    const chatTab = !authToken
      ? `<div class="akz-scroll">${signedOut}</div>`
      : `<div class="akz-scroll" data-akz="scroll">
           ${transcriptHtml()}
           ${
             aiBusy
               ? `<div class="akz-msg akz-ai-msg">
                    <div class="akz-avatar">A</div>
                    <div class="akz-bub"><div class="akz-typing"><i></i><i></i><i></i></div></div>
                  </div>`
               : ''
           }
         </div>
         <div class="akz-composer">
           <textarea class="akz-ta" data-akz="q" rows="1" placeholder="Ask anything about this page..."></textarea>
           <button class="akz-send" data-akz="ask" ${aiBusy ? 'disabled' : ''} title="Send (Enter)" aria-label="Send">
             ${
               aiBusy
                 ? `<span class="akz-spin"></span>`
                 : `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg>`
             }
           </button>
         </div>`

    const guideTab = `<div class="akz-scroll">
        ${
          book
            ? `<div class="akz-secttl">Known steps for this page</div>
        ${book.steps
          .map(
            (s, i) => `
          <div class="akz-step" data-akz="step" data-i="${i}">
            <div class="akz-num">${i + 1}</div>
            <div class="akz-stxt">
              <div class="akz-sttl">${esc(s.title)}</div>
              ${s.body ? `<div class="akz-sbody">${esc(s.body)}</div>` : ''}
              <div class="akz-cn">${esc(s.find[0])}</div>
              ${s.note ? `<div class="akz-note">${esc(s.note)}</div>` : ''}
            </div>
          </div>`,
          )
          .join('')}`
            : `<div class="akz-empty">No built-in playbook for this page. Use the Chat tab and the AI will read it for you.</div>`
        }

        ${
          isDetail
            ? `
        <div class="akz-secttl">This listing</div>
        <div class="akz-cap">
          <div class="akz-row"><span class="akz-k">Offer ID</span><span class="akz-v">${esc(cap.offerId || '-')}</span></div>
          <div class="akz-row"><span class="akz-k">Price seen</span><span class="akz-v">${esc(cap.price || '-')}</span></div>
          <div class="akz-row"><span class="akz-k">MOQ</span><span class="akz-v">${esc(cap.moq || '-')}</span></div>
          <div class="akz-row"><span class="akz-k">Factory</span><span class="akz-v">${cap.factory ? 'Yes' : 'Not shown'}</span></div>
          <div class="akz-row"><span class="akz-k">OEM / custom</span><span class="akz-v">${cap.oem ? 'Yes' : 'Not shown'}</span></div>
          <button class="akz-btn" data-akz="copy">Copy listing for a purchase order</button>
          <button class="akz-btn akz-ghost" data-akz="open">Open Akmez purchasing</button>
        </div>`
            : on1688()
              ? `<div class="akz-secttl">Tip</div>
        <div class="akz-empty">Open a product page (a <b>/offer/</b> link) to capture the listing details for a purchase order.</div>`
              : ''
        }

        <div class="akz-secttl">Display</div>
        <button class="akz-btn akz-ghost" data-akz="tags">${tagsOn ? 'Hide' : 'Show'} English labels on buttons</button>
        ${authToken ? `<button class="akz-btn akz-ghost" data-akz="signout">Sign out</button>` : ''}
        <div class="akz-empty">Hover any Chinese text to see what it means. <b>Alt+Z</b> opens this guide, <b>Esc</b> closes it.</div>
      </div>`

    const histTab = `<div class="akz-scroll">
        <div class="akz-secttl">Conversations</div>
        ${historyHtml()}
      </div>`

    panel.innerHTML = `
      <div class="akz-head">
        <div class="akz-logo">A</div>
        <div class="akz-htxt">
          <div class="akz-title">Akmez AI</div>
          <div class="akz-sub">${authName ? esc(authName) : 'Co-pilot for any page'}</div>
        </div>
        <button class="akz-x" data-akz="new" title="New conversation" aria-label="New conversation">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
        </button>
        <button class="akz-x" data-akz="dock" title="Snap back to the right edge" aria-label="Dock panel to the right edge">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <line x1="9.5" y1="2.5" x2="9.5" y2="13.5" />
          </svg>
        </button>
        <button class="akz-x" data-akz="close" title="Close (Esc)">&times;</button>
      </div>

      <div class="akz-tabs">
        <button class="akz-tab${tab === 'chat' ? ' akz-on' : ''}" data-akz="tab" data-t="chat">Chat</button>
        <button class="akz-tab${tab === 'history' ? ' akz-on' : ''}" data-akz="tab" data-t="history">History${db.chats.length ? ` <span class="akz-count">${db.chats.length}</span>` : ''}</button>
        <button class="akz-tab${tab === 'guide' ? ' akz-on' : ''}" data-akz="tab" data-t="guide">Guide</button>
      </div>

      <div class="akz-pagetag">
        <span class="akz-dot"></span>
        ${book ? `Detected: <span class="akz-pagename">${esc(book.name)}</span>` : `On <span class="akz-pagename">${esc(location.hostname)}</span>`}
        ${chat && chat.messages.length ? `<span class="akz-saved">saved</span>` : ''}
      </div>

      <div class="akz-main">${tab === 'chat' ? chatTab : tab === 'history' ? histTab : guideTab}</div>
      <div class="akz-grip" data-akz="grip" title="Drag to resize"></div>`

    panel.querySelector('[data-akz=close]').onclick = () => togglePanel(false)
    panel.querySelector('[data-akz=dock]').onclick = () => dockPanel()
    panel.querySelector('[data-akz=new]').onclick = () => {
      newChat()
      db.tab = 'chat'
      save()
      render(true)
    }
    panel.querySelectorAll('[data-akz=tab]').forEach(b => {
      b.onclick = () => {
        db.tab = b.dataset.t
        save()
        render(b.dataset.t === 'chat')
      }
    })
    panel.querySelectorAll('[data-akz=thread]').forEach(n => {
      n.onclick = () => {
        db.currentId = n.dataset.id
        db.tab = 'chat'
        save()
        render(true)
      }
    })
    panel.querySelectorAll('[data-akz=delthread]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation()
        db.chats = db.chats.filter(c => c.id !== b.dataset.id)
        if (db.currentId === b.dataset.id) db.currentId = db.chats[0]?.id || null
        save()
        render()
      }
    })

    // --- AI handlers ---
    const emailIn = panel.querySelector('[data-akz=email]')
    const passIn = panel.querySelector('[data-akz=pass]')
    const signBtn = panel.querySelector('[data-akz=signin]')
    if (signBtn)
      signBtn.onclick = async () => {
        signBtn.disabled = true
        signBtn.textContent = 'Signing in...'
        try {
          await signIn(emailIn.value.trim(), passIn.value)
          aiError = ''
          toast('Signed in')
        } catch (err) {
          aiError = err?.message || 'Sign in failed'
        }
        render()
      }

    const qBox = panel.querySelector('[data-akz=q]')
    const askBtn = panel.querySelector('[data-akz=ask]')
    const submit = () => {
      const q = (qBox?.value || '').trim()
      if (!q) {
        toast('Type what you want to do first', true)
        return
      }
      qBox.value = ''
      askAI(q)
    }
    if (askBtn) askBtn.onclick = submit
    if (qBox) {
      // Restore the draft for THIS conversation, so switching threads or
      // navigating mid-sentence does not lose what was being typed.
      qBox.value = (chat && db.drafts[chat.id]) || ''
      const grow = () => {
        qBox.style.height = 'auto'
        qBox.style.height = Math.min(140, qBox.scrollHeight) + 'px'
      }
      grow()
      qBox.oninput = () => {
        grow()
        const c = ensureChat()
        if (qBox.value) db.drafts[c.id] = qBox.value
        else delete db.drafts[c.id]
        save()
      }
      // Enter sends, Shift+Enter makes a new line. isComposing guards CJK IMEs,
      // where Enter is confirming the candidate rather than submitting.
      qBox.onkeydown = e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault()
          submit()
        }
      }
    }
    panel.querySelectorAll('[data-akz=chip]').forEach(chip => {
      chip.onclick = () => askAI(chip.textContent.trim())
    })

    const msgById = id => currentChat()?.messages.find(m => m.id === id)
    panel.querySelectorAll('[data-akz=show]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation()
        const m = msgById(b.dataset.m)
        if (m) showAiStep(m, Number(b.dataset.i))
      }
    })
    panel.querySelectorAll('[data-akz=do]').forEach(b => {
      b.onclick = e => {
        e.stopPropagation()
        const m = msgById(b.dataset.m)
        if (m) doAiStep(m, Number(b.dataset.i))
      }
    })
    panel.querySelectorAll('[data-akz=aistep]').forEach(node => {
      node.onclick = () => {
        const m = msgById(node.dataset.m)
        if (m) showAiStep(m, Number(node.dataset.i))
      }
    })

    const outBtn = panel.querySelector('[data-akz=signout]')
    if (outBtn)
      outBtn.onclick = async () => {
        await store.del(['authToken', 'userName', 'userEmail'])
        authToken = null
        authName = ''
        render()
      }

    panel.querySelectorAll('[data-akz=step]').forEach(node => {
      node.onclick = () => {
        const step = book.steps[Number(node.dataset.i)]
        const hit = findByLabels(step.find)
        if (!hit) {
          node.classList.add('akz-missing')
          toast('Not on this page - scroll down or open a product page', true)
          return
        }
        panel.querySelectorAll('.akz-step').forEach(s => s.classList.remove('akz-active'))
        node.classList.add('akz-active')
        spotlight(hit.el, step, Number(node.dataset.i))
      }
    })

    const copyBtn = panel.querySelector('[data-akz=copy]')
    if (copyBtn)
      copyBtn.onclick = async () => {
        const c = captureListing()
        const text = [
          `Product: ${c.title}`,
          `1688 link: ${c.url}`,
          `Offer ID: ${c.offerId}`,
          `Price seen: ${c.price}`,
          `MOQ: ${c.moq}`,
          `Factory: ${c.factory ? 'yes' : 'not shown'}`,
          `OEM/custom: ${c.oem ? 'yes' : 'not shown'}`,
          `Image: ${c.image}`,
        ].join('\n')
        try {
          await navigator.clipboard.writeText(text)
          toast('Listing copied - paste into the new purchase order')
        } catch {
          toast('Copy blocked by the page', true)
        }
      }

    const openBtn = panel.querySelector('[data-akz=open]')
    if (openBtn) openBtn.onclick = () => window.open(APP + '/dashboard/purchasing', '_blank')

    const tagsBtn = panel.querySelector('[data-akz=tags]')
    if (tagsBtn)
      tagsBtn.onclick = () => {
        tagsOn = !tagsOn
        paintTags()
        render()
      }

    // Resize from the bottom-left corner. Width grows leftwards so the panel
    // keeps its right edge when docked.
    const grip = panel.querySelector('[data-akz=grip]')
    if (grip)
      grip.addEventListener('pointerdown', e => {
        e.preventDefault()
        e.stopPropagation()
        const sx = e.clientX
        const sy = e.clientY
        const w0 = panel.offsetWidth
        const h0 = panel.offsetHeight
        const floating = panel.classList.contains('akz-float')
        const move = ev => {
          const w = clamp(w0 - (ev.clientX - sx), 320, Math.min(920, window.innerWidth - 40))
          panel.style.width = w + 'px'
          if (floating) panel.style.height = clamp(h0 + (ev.clientY - sy), 260, window.innerHeight - 40) + 'px'
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          document.body.classList.remove('akz-dragging')
          savePos({ size: { w: panel.offsetWidth, h: floating ? panel.offsetHeight : null } })
        }
        document.body.classList.add('akz-dragging')
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      })

    // Put the user back where they were. A brand-new answer pins to the bottom;
    // otherwise the previous offset is kept so reading older messages is not
    // interrupted by a background re-render.
    const scroller = panel.querySelector('.akz-scroll')
    if (scroller) {
      if (toEnd || atBottom) scroller.scrollTop = scroller.scrollHeight
      else if (keepScroll !== null) scroller.scrollTop = keepScroll
    }
    if (focused) {
      const box = panel.querySelector('[data-akz=q]')
      if (box) {
        box.focus()
        if (caret !== null) {
          const at = Math.min(caret, box.value.length)
          box.setSelectionRange(at, at)
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Dragging
  //
  // Both the button and the panel can be moved anywhere on screen and remember
  // where they were put. Positions are stored per site, because the spot that
  // keeps the panel clear of one page's content covers another's.
  // ---------------------------------------------------------------------------
  const POS_KEY = 'akzPos:' + location.hostname
  let savedPos = {}
  let dragMoved = false

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v))
  }

  /** Keep a moved element on screen after a resize or a zoom change. */
  function clampInto(el, left, top) {
    const w = el.offsetWidth
    const h = el.offsetHeight
    // Allow it to sit partly off the edge, but never so far that there is
    // nothing left to grab.
    return {
      left: clamp(left, 8 - w + 60, window.innerWidth - 60),
      top: clamp(top, 8, Math.max(8, window.innerHeight - 44)),
    }
  }

  function place(el, left, top) {
    const p = clampInto(el, left, top)
    el.style.left = p.left + 'px'
    el.style.top = p.top + 'px'
    el.style.right = 'auto'
    el.style.bottom = 'auto'
    return p
  }

  async function savePos(patch) {
    savedPos = { ...savedPos, ...patch }
    await store.set({ [POS_KEY]: savedPos })
  }

  /**
   * @param handle  element you grab
   * @param target  element that actually moves
   * @param key     where to remember the position
   * @param onStart called once a real drag begins (not a plain click)
   */
  function makeDraggable(handle, target, key, onStart, grip) {
    handle.addEventListener('pointerdown', e => {
      // Left button only.
      if (e.button !== 0) return
      // Never start a drag from a control inside the handle (the close button
      // sits in the panel header) - but the launcher is itself a button, so it
      // must not disqualify itself.
      const ctrl = e.target.closest('button, a, input, textarea, select')
      if (ctrl && ctrl !== handle) return
      // The panel listens on itself (its header is rebuilt on every render), so
      // only a press that landed on the header bar counts. Without this,
      // selecting text in the answer would drag the whole window.
      if (grip && !e.target.closest(grip)) return

      const startX = e.clientX
      const startY = e.clientY
      const r = target.getBoundingClientRect()
      const offX = startX - r.left
      const offY = startY - r.top
      let started = false
      dragMoved = false

      const move = ev => {
        if (!started) {
          // A few pixels of slop so a normal click is never read as a drag.
          if (Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return
          started = true
          dragMoved = true
          document.body.classList.add('akz-dragging')
          target.classList.add('akz-moving')
          onStart?.()
        }
        place(target, ev.clientX - offX, ev.clientY - offY)
      }

      const up = () => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', up)
        if (!started) return
        document.body.classList.remove('akz-dragging')
        target.classList.remove('akz-moving')
        const box = target.getBoundingClientRect()
        savePos({ [key]: { left: box.left, top: box.top } })
        // Let the click that follows this pointerup through only if the user
        // did not actually move anything.
        setTimeout(() => {
          dragMoved = false
        }, 0)
      }

      // Capture keeps the drag alive when the pointer outruns the element or
      // crosses an iframe, which is common on heavy pages.
      try {
        handle.setPointerCapture?.(e.pointerId)
      } catch {
        // Throws when the pointer is no longer active; the move/up listeners
        // below still work, so this must not abort the drag.
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', up)
    })
  }

  /** Detach the panel from the right edge so it can be moved freely. */
  function floatPanel() {
    if (panel.classList.contains('akz-float')) return
    const r = panel.getBoundingClientRect()
    panel.classList.add('akz-float')
    place(panel, r.left, Math.max(8, r.top))
  }

  function dockPanel() {
    panel.classList.remove('akz-float')
    panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = ''
    savePos({ panel: null })
  }

  makeDraggable(fab, fab, 'fab')
  // The header is rebuilt on every render, so listen on the panel and let the
  // event bubble up from whichever header is current.
  makeDraggable(panel, panel, 'panel', floatPanel, '.akz-head')

  async function restorePos() {
    const s = await store.get([POS_KEY])
    savedPos = s[POS_KEY] || {}
    if (savedPos.size?.w) panel.style.width = savedPos.size.w + 'px'
    if (savedPos.fab) place(fab, savedPos.fab.left, savedPos.fab.top)
    if (savedPos.panel) {
      panel.classList.add('akz-float')
      if (savedPos.size?.h) panel.style.height = savedPos.size.h + 'px'
      place(panel, savedPos.panel.left, savedPos.panel.top)
    }
  }

  /**
   * Restore everything before the first paint. The conversation, the open
   * state, the active tab and the panel geometry all come back exactly as the
   * user left them on the previous page.
   */
  async function boot() {
    await Promise.all([restorePos(), loadDb(), loadAuth()])
    if (db.open) {
      // silent: this is restoring the stored state, not a new user decision.
      togglePanel(true, true)
    } else {
      render()
    }
  }
  boot()

  window.addEventListener('resize', () => {
    if (savedPos.fab) place(fab, fab.getBoundingClientRect().left, fab.getBoundingClientRect().top)
    if (panel.classList.contains('akz-float')) {
      place(panel, panel.getBoundingClientRect().left, panel.getBoundingClientRect().top)
    }
  })

  function togglePanel(open, silent) {
    const next = open ?? !panel.classList.contains('akz-open')
    panel.classList.toggle('akz-open', next)
    fab.classList.toggle('akz-hidden', next)
    // Remember it, so the panel is still there after a refresh or a click
    // through to the next page instead of collapsing back to the button.
    if (!silent && db.open !== next) {
      db.open = next
      save()
    }
    if (next) {
      render(true)
      paintTags()
      // Re-read the stored session each time it opens: the user may have signed
      // in or out in another tab, and a stale "signed out" panel would make the
      // AI look broken.
      loadAuth().then(() => render())
      setTimeout(() => panel.querySelector('[data-akz=q]')?.focus(), 60)
    } else {
      clearSpot()
    }
  }

  // A drag ends with a click event, which would otherwise open the panel every
  // time the button is repositioned.
  fab.onclick = () => {
    if (dragMoved) return
    togglePanel(true)
  }
  document.addEventListener('mouseover', onHover, true)
  document.addEventListener('keydown', e => {
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      togglePanel()
    }
    if (e.key === 'Escape') {
      // First Esc dismisses the spotlight, a second one closes the panel, so a
      // highlight can be cleared without losing the conversation.
      if (ring || call) clearSpot()
      else if (panel.classList.contains('akz-open')) togglePanel(false)
    }
  })
  window.addEventListener('scroll', () => {
    if (tagsOn && panel.classList.contains('akz-open')) paintTags()
  })
  chrome.runtime.onMessage.addListener(msg => {
    if (msg?.action === 'toggle') togglePanel()
  })

  // 1688 is a single-page app in places, so re-render when the URL changes.
  let lastUrl = location.href
  setInterval(() => {
    if (location.href === lastUrl) return
    lastUrl = location.href
    clearSpot()
    if (panel.classList.contains('akz-open')) {
      render()
      paintTags()
    }
  }, 1200)
})()
