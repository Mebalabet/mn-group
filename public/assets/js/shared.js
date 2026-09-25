/* ==================================================================
   MN Group — shared frontend module (Phase 1A)

   This consolidates the storefront logic that public/index.html
   already has inline (unchanged behavior, same function names) so the
   new Products/Product/Categories pages can reuse it instead of each
   page re-implementing cart/auth/product-loading from scratch.

   public/index.html itself is NOT migrated to load this file in
   Phase 1A — it keeps its own inline copy of this logic, to avoid any
   risk of regressing the one page that's known to work. The one
   exception is cart persistence (see CART PERSISTENCE below), which
   index.html was given a small additive patch to stay compatible
   with.
   ================================================================== */

/* ================= DATA ================= */
const CATEGORIES = [
  {id:'all', label:'All'}, {id:'software', label:'Software'}, {id:'templates', label:'Templates'},
  {id:'courses', label:'Courses'}, {id:'design', label:'Design assets'}, {id:'services', label:'Services'}, {id:'plugins', label:'Plugins'},
];
const CAT_COLOR = { software:'#4C6FFF', templates:'#FF7A45', courses:'#16A672', design:'#B24BF3', services:'#F5426C', plugins:'#17A8C4' };
const CAT_SEED = { software:'circuit-blue', templates:'paper-grid', courses:'study-desk', design:'paint-studio', services:'handshake-office', plugins:'tech-parts' };
const ICONS = {
  software:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/><path d="M13 5l-2 14"/></svg>',
  templates:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  courses:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none"/></svg>',
  design:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><circle cx="11" cy="11" r="2"/></svg>',
  services:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12a8 8 0 0 1 16 0"/><path d="M4 12v4a2 2 0 0 0 2 2h1v-6H5a1 1 0 0 0-1 1z"/><path d="M20 12v4a2 2 0 0 1-2 2h-1v-6h2a1 1 0 0 1 1 1z"/></svg>',
  plugins:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3v3H6v3H3v4h3l1 1v3h3v3h4v-3h3v-3l1-1h3v-4h-3V6h-3V3H9z"/></svg>',
};
const SERVICE_LINES = [
  { id:'web-development', label:'Web Development', blurb:'Custom websites and web applications built to your spec.' },
  { id:'mobile-development', label:'Mobile Development', blurb:'Native and cross-platform mobile apps for iOS and Android.' },
  { id:'design-branding', label:'Design & Branding', blurb:'Brand identity, UI/UX design, and visual design systems.' },
  { id:'digital-marketing', label:'Digital Marketing', blurb:'SEO, paid campaigns, and growth strategy.' },
  { id:'consulting-strategy', label:'Consulting & Strategy', blurb:'Technical advisory and product strategy engagements.' },
  { id:'managed-support', label:'Managed Support', blurb:'Ongoing maintenance, support, and monitoring.' },
];
function catImg(seed, w, h){ return `https://picsum.photos/seed/${seed}/${w}/${h}`; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function catLabel(catId){ return (CATEGORIES.find(c=>c.id===catId) || {label:'Other'}).label; }
function starRow(rating){
  const full = Math.round(rating);
  return '<span class="stars">' + '★'.repeat(full) + '☆'.repeat(5-full) + '</span>';
}

/* ================= NAV (search toggle used by the shared header) ================= */
function toggleSearch(){ const row=document.getElementById('searchRow'); if(!row) return; row.classList.toggle('open'); const inp=document.getElementById('searchInput'); if(inp) inp.focus(); }

/* ================= AUTH / API ================= */
const MN_AUTH={token:localStorage.getItem('mn_token')||'',user:null};
async function mnApi(path,opts={}){opts.headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(MN_AUTH.token)opts.headers.Authorization='Bearer '+MN_AUTH.token;const r=await fetch(path,opts);const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Request failed');return data;}
function openAuth(mode='login'){const el=document.getElementById('authContent');el.innerHTML=`<h2 class="display" style="font-size:1.25rem;margin-top:10px;">${mode==='login'?'Welcome back':'Create your MN Group account'}</h2><p class="sell-note">${mode==='login'?'Sign in to your account.':'Create a buyer account to purchase or list products.'}</p>${mode==='register'?'<div class="field"><label>Name</label><input id="authName" autocomplete="name"></div>':''}<div class="field"><label>Email</label><input id="authEmail" type="email" autocomplete="email"></div><div class="field"><label>Password</label><input id="authPassword" type="password" minlength="8" autocomplete="current-password"></div><button class="checkout-btn" id="authSubmit">${mode==='login'?'Login':'Register'}</button><p style="margin-top:12px;font-size:.8rem;color:var(--ink-soft);text-align:center;cursor:pointer" onclick="openAuth('${mode==='login'?'register':'login'}')">${mode==='login'?'Need an account? Register':'Already registered? Login'}</p>`;document.getElementById('authSubmit').onclick=async()=>{try{const email=document.getElementById('authEmail').value.trim();const password=document.getElementById('authPassword').value;const body=mode==='register'?{name:document.getElementById('authName').value.trim(),email,password}:{email,password};const data=await mnApi('/api/auth/'+mode,{method:'POST',body:JSON.stringify(body)});MN_AUTH.token=data.token;MN_AUTH.user=data.user;localStorage.setItem('mn_token',data.token);closeAllOverlays();showToast('Welcome, '+data.user.name);updateAuthUI();}catch(e){showToast(e.message);}};showOverlay('authModal');}
async function restoreMNUser(){if(!MN_AUTH.token)return;try{MN_AUTH.user=(await mnApi('/api/auth/me')).user;updateAuthUI();}catch{localStorage.removeItem('mn_token');MN_AUTH.token='';}}
function updateAuthUI(){const btns=document.querySelectorAll('.auth-btn');if(!btns.length)return;if(MN_AUTH.user){btns[0].textContent=MN_AUTH.user.role==='admin'?'Admin':'Account';btns[0].onclick=()=>{if(MN_AUTH.user.role==='admin')location.href='/admin.html';else openMyOrders()};btns[1].textContent='Logout';btns[1].onclick=()=>{localStorage.removeItem('mn_token');MN_AUTH.token='';MN_AUTH.user=null;location.reload();}}}

/* ================= PRODUCTS ================= */
let PRODUCTS = [];
let productsLoaded = false;
let productsLoadError = false;
function normalizeProduct(p){
  return {
    id: p.id, name: p.name, price: p.price,
    cat: p.category || 'other',
    seller: p.sellerName || 'MN Group',
    desc: p.description || '',
    fileName: p.fileName || null, payhipUrl: p.payhipUrl || null,
    rating: 0, reviews: 0, specs: {},
    createdAt: p.createdAt || null,
  };
}
async function loadProducts(){
  try {
    const list = await mnApi('/api/products');
    PRODUCTS = list.map(normalizeProduct);
    productsLoadError = false;
  } catch (err) {
    PRODUCTS = [];
    productsLoadError = true;
    showToast('Could not load products — check your connection and try again');
  }
  productsLoaded = true;
}
function isNewProduct(p){ return p.createdAt && (Date.now() - new Date(p.createdAt).getTime()) < 1000*60*60*24*30; }
function bestsellerIds(){ return PRODUCTS.slice().sort((a,b)=>(b.reviews*b.rating)-(a.reviews*a.rating)).slice(0,3).map(p=>p.id); }

/* ================= GRID (shared by Home's #grid section, and the new
   Products page — both use the same #grid/#resultCount/#searchInput/
   #sortSelect ids and state.cat, so this one implementation serves
   both without change). ================= */
function currentList(){
  let list = PRODUCTS.slice();
  if(state.cat !== 'all') list = list.filter(p=>p.cat===state.cat);
  const searchEl = document.getElementById('searchInput');
  const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
  if(q){ list = list.filter(p=> (p.name+p.desc+p.seller).toLowerCase().includes(q)); }
  const sortEl = document.getElementById('sortSelect');
  const sort = sortEl ? sortEl.value : 'popular';
  if(sort==='price-asc') list.sort((a,b)=>a.price-b.price);
  else if(sort==='price-desc') list.sort((a,b)=>b.price-a.price);
  else if(sort==='new') list.sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
  else list.sort((a,b)=> (b.reviews*b.rating) - (a.reviews*a.rating));
  return list;
}
function renderGrid(){
  const grid = document.getElementById('grid');
  if(!grid) return;
  const list = currentList();
  const countEl = document.getElementById('resultCount');
  if(countEl) countEl.textContent = `${list.length} item${list.length===1?'':'s'}`;
  grid.innerHTML = '';
  if(list.length===0){
    grid.innerHTML = !productsLoaded
      ? `<div class="empty-state"><h3 class="display" style="font-size:1.1rem;">Loading products…</h3><p>Just a moment.</p></div>`
      : productsLoadError
        ? `<div class="empty-state"><h3 class="display" style="font-size:1.1rem;">Couldn't load products</h3><p>Check your connection and refresh the page.</p></div>`
        : `<div class="empty-state"><h3 class="display" style="font-size:1.1rem;">No matches</h3><p>Try a different search term or browse another category.</p></div>`;
    return;
  }
  const best = bestsellerIds();
  list.forEach(p=>{
    const card = document.createElement('div'); card.className='card';
    card.onclick = ()=>openProduct(p.id);
    const inCart = !!state.cart[p.id];
    let ribbon = '';
    if(isNewProduct(p)) ribbon = `<span class="ribbon" style="background:var(--green);">New</span>`;
    else if(best.includes(p.id)) ribbon = `<span class="ribbon" style="background:var(--gold-deep);">Bestseller</span>`;
    card.innerHTML = `
      <div class="thumb">
        <img src="${catImg('p-'+p.id,400,300)}" alt="" loading="lazy" onerror="this.style.display='none'">
        <span class="cat-chip" style="background:${CAT_COLOR[p.cat]||'#6B7280'};">${catLabel(p.cat)}</span>
        ${ribbon}
      </div>
      <div class="body">
        <h3>${p.name}</h3>
        <div class="seller">by ${p.seller}</div>
        <div class="meta-row">
          <span class="price mono">$${p.price}</span>
          <span class="rating">${starRow(p.rating)} ${p.rating}</span>
        </div>
        <div class="add-row">
          <button class="add-btn ${inCart?'added':''}" data-id="${p.id}">${inCart? 'Added ✓' : 'Add to cart'}</button>
        </div>
      </div>
    `;
    card.querySelector('.add-btn').onclick = (e)=>{ e.stopPropagation(); addToCart(p.id); };
    grid.appendChild(card);
  });
}

/* ================= SHARED STATE ================= */
let state = { cat:'all', search:'', cart:{}, overlay:null, activeProduct:null, checkoutStep:1, buyer:{} };

/* ================= CART PERSISTENCE (new in Phase 1A) =================
   The cart was previously purely in-memory (state.cart, reset on every
   page load) because the whole app was one page — that was invisible
   before, since there was never a "navigate away and come back."
   With genuine separate pages, the cart now needs to survive a full
   page load or the drawer would appear to randomly empty itself when
   moving between Home/Products/Product/Categories. This persists the
   same state.cart shape to localStorage under 'mn_cart' and restores
   it on load; nothing about the cart's existing shape, ids, or
   functions changed. */
function loadCartFromStorage(){
  try {
    const raw = localStorage.getItem('mn_cart');
    if(raw) state.cart = JSON.parse(raw) || {};
  } catch { state.cart = {}; }
}
function saveCartToStorage(){
  try { localStorage.setItem('mn_cart', JSON.stringify(state.cart)); } catch {}
}

/* ================= OVERLAYS ================= */
function closeAllOverlays(){
  ['scrim','cartDrawer','pdModal','checkoutModal','sellModal','authModal','ordersModal'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.classList.remove('open');
  });
  document.body.style.overflow=''; state.overlay=null; state.activeProduct=null;
}
function showOverlay(which){
  closeAllOverlays();
  document.getElementById('scrim').classList.add('open');
  document.getElementById(which).classList.add('open');
  document.body.style.overflow='hidden'; state.overlay=which;
}
function closeOnBackdrop(e){ if(e.target===e.currentTarget) closeAllOverlays(); }

/* ================= CART ================= */
function addToCart(id){ state.cart[id] = (state.cart[id]||0)+1; saveCartToStorage(); if(typeof renderGrid==='function') renderGrid(); renderCart(); showToast('Added to cart'); }
function setQty(id, delta){ if(!state.cart[id]) return; state.cart[id]+=delta; if(state.cart[id]<=0) delete state.cart[id]; saveCartToStorage(); renderCart(); if(typeof renderGrid==='function') renderGrid(); }
function removeFromCart(id){ delete state.cart[id]; saveCartToStorage(); renderCart(); if(typeof renderGrid==='function') renderGrid(); }
function cartItems(){ return Object.entries(state.cart).map(([id,qty])=>({p:PRODUCTS.find(p=>p.id===id), qty})).filter(i=>i.p); }
function cartTotal(){ return cartItems().reduce((s,i)=>s+i.p.price*i.qty,0); }
function updateCartCount(){
  const n = Object.values(state.cart).reduce((a,b)=>a+b,0);
  const el = document.getElementById('cartCount');
  if(!el) return;
  if(n>0){ el.style.display='flex'; el.textContent=n; } else { el.style.display='none'; }
}
function renderCart(){
  updateCartCount();
  const body = document.getElementById('cartBody');
  if(!body) return;
  const items = cartItems();
  if(items.length===0){
    body.innerHTML = `<div class="empty-state" style="border:none; padding:50px 10px;"><h3 class="display" style="font-size:1.1rem;">Your cart is empty</h3><p>Add a product to see it here.</p></div>`;
    document.getElementById('cartFoot').style.display='none';
    return;
  }
  document.getElementById('cartFoot').style.display='block';
  body.innerHTML='';
  items.forEach(({p,qty})=>{
    const row = document.createElement('div'); row.className='cart-item';
    row.innerHTML = `
      <div class="cart-thumb"><img src="${catImg('p-'+p.id,120,120)}" alt="" onerror="this.style.display='none'"></div>
      <div class="cart-item-info">
        <h4>${p.name}</h4>
        <div class="seller-sm">${p.seller}</div>
        <div class="qty-row">
          <button class="qty-btn" aria-label="Decrease quantity">−</button>
          <span class="qty-val">${qty}</span>
          <button class="qty-btn" aria-label="Increase quantity">+</button>
          <button class="remove-link">Remove</button>
        </div>
      </div>
      <div class="cart-item-price mono">₹${(p.price*qty).toFixed(2)}</div>
    `;
    const [minus, plus] = row.querySelectorAll('.qty-btn');
    minus.onclick = ()=>setQty(p.id,-1); plus.onclick = ()=>setQty(p.id,1);
    row.querySelector('.remove-link').onclick = ()=>removeFromCart(p.id);
    body.appendChild(row);
  });
  const total = cartTotal();
  document.getElementById('cartSubtotal').textContent = `₹${total.toFixed(2)}`;
  document.getElementById('cartTotal').textContent = `₹${total.toFixed(2)}`;
}
function openCart(e){ if(e) e.preventDefault(); renderCart(); showOverlay('cartDrawer'); return false; }

/* ================= CHECKOUT ================= */
function openCheckout(){
  if(cartItems().length===0){ showToast('Your cart is empty'); return; }
  if(!MN_AUTH.user){ showToast('Please log in to check out'); openAuth('login'); return; }
  state.checkoutStep = 1; renderCheckout(); showOverlay('checkoutModal');
}
function renderCheckout(){
  document.getElementById('stepDot1').classList.toggle('active', state.checkoutStep>=1);
  document.getElementById('stepDot2').classList.toggle('active', state.checkoutStep>=2);
  const el = document.getElementById('checkoutContent');
  const total = cartTotal();
  if(state.checkoutStep===1){
    el.innerHTML = `
      <h2 class="display" style="font-size:1.25rem; margin-top:10px;">Contact & billing</h2>
      <div class="field" id="f-name"><label>Full name</label><input type="text" id="in-name" value="${state.buyer.name||''}"><div class="err-msg">Enter your name</div></div>
      <div class="field" id="f-email"><label>Email — for delivery</label><input type="email" id="in-email" value="${state.buyer.email||''}"><div class="err-msg">Enter a valid email</div></div>
      <div class="field" id="f-country"><label>Country</label>
        <select id="in-country">
          <option ${(!state.buyer.country||state.buyer.country==='United States')?'selected':''}>United States</option>
          <option ${state.buyer.country==='Canada'?'selected':''}>Canada</option>
          <option ${state.buyer.country==='United Kingdom'?'selected':''}>United Kingdom</option>
          <option ${state.buyer.country==='Australia'?'selected':''}>Australia</option>
          <option ${state.buyer.country==='Other'?'selected':''}>Other</option>
        </select>
      </div>
      <div class="order-summary">
        ${cartItems().map(i=>`<div class="line"><span>${i.p.name} × ${i.qty}</span><span class="mono">$${(i.p.price*i.qty).toFixed(2)}</span></div>`).join('')}
        <div class="line" style="font-weight:700; border-top:1px solid var(--line); margin-top:6px; padding-top:8px;"><span>Total due</span><span class="mono">$${total.toFixed(2)}</span></div>
      </div>
      <button class="pay-btn" id="toStep2">Continue to payment</button>
    `;
    document.getElementById('toStep2').onclick = ()=>{
      const name = document.getElementById('in-name').value.trim();
      const email = document.getElementById('in-email').value.trim();
      const country = document.getElementById('in-country').value;
      let ok = true;
      document.getElementById('f-name').classList.toggle('err', !name); if(!name) ok=false;
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      document.getElementById('f-email').classList.toggle('err', !emailOk); if(!emailOk) ok=false;
      if(!ok) return;
      state.buyer = {name, email, country}; state.checkoutStep = 2; renderCheckout();
    };
  } else if(state.checkoutStep===2){
    el.innerHTML = `
      <h2 class="display" style="font-size:1.25rem; margin-top:10px;">Payment</h2>
      <div class="order-summary">
        <div class="line"><span>Billed to</span><span>${state.buyer.name}</span></div>
        <div class="line"><span>Delivery email</span><span>${state.buyer.email}</span></div>
        <div class="line" style="font-weight:700; border-top:1px solid var(--line); margin-top:6px; padding-top:8px;"><span>Total due</span><span class="mono">$${total.toFixed(2)}</span></div>
      </div>
      <div class="secure-note">You'll be redirected to the configured secure payment provider. MN Group does not collect or store your card number, expiry date, or CVC.</div>
      <button class="pay-btn" id="backStep1" style="background:#fff; color:var(--ink); border:1px solid var(--line); margin-top:10px;">Back</button>
      <button class="pay-btn" id="payNow" style="background:var(--gold); color:var(--navy);">Continue to secure payment</button>
    `;
    document.getElementById('backStep1').onclick = ()=>{ state.checkoutStep=1; renderCheckout(); };
    document.getElementById('payNow').onclick = ()=> completeOrder(total);
  } else if(state.checkoutStep===3){
    const order = state.lastOrder;
    el.innerHTML = `
      <div class="confirm-mark">✓</div>
      <h2 class="confirm-title display">Order placed — payment pending</h2>
      <p class="confirm-sub">We'll follow up at ${state.buyer.email} once payment is confirmed. No charge has been made yet.</p>
      <div class="confirm-id">Order ${order.id}</div>
      <div class="confirm-list">
        ${order.items.map(i=>`<div class="pd-spec-row"><span>${i.name} × ${i.qty}</span><span class="mono">₹${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
        <div class="pd-spec-row" style="font-weight:700;"><span>Amount due (pending)</span><span class="mono">$${order.total.toFixed(2)}</span></div>
      </div>
      <button class="done-btn" id="doneBtn">Back to marketplace</button>
    `;
    document.getElementById('doneBtn').onclick = ()=>{ closeAllOverlays(); location.href='/'; };
  }
}
async function completeOrder(total){
  const payBtn = document.getElementById('payNow');
  if(payBtn){ payBtn.disabled = true; payBtn.textContent = 'Preparing secure payment…'; }
  try {
    const items = cartItems().map(({p,qty})=>({id:p.id, qty}));
    const order = await mnApi('/api/orders', {method:'POST', body:JSON.stringify({items})});
    const session = await mnApi('/api/orders/'+encodeURIComponent(order.id)+'/pay', {method:'POST', body:JSON.stringify({})});
    state.lastOrder = order;
    state.cart = {}; saveCartToStorage(); renderCart(); if(typeof renderGrid==='function') renderGrid();
    const form = document.createElement('form');
    form.method = 'POST'; form.action = session.actionUrl; form.style.display = 'none';
    Object.entries(session.fields || {}).forEach(([key,value])=>{
      const input = document.createElement('input'); input.type='hidden'; input.name=key; input.value=value == null ? '' : String(value); form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  } catch (err) {
    showToast(err.message || 'Could not start payment — please try again');
    if(payBtn){ payBtn.disabled = false; payBtn.textContent = 'Continue to secure payment'; }
  }
}

/* ================= MY ORDERS ================= */
async function openMyOrders(){
  document.getElementById('ordersContent').innerHTML = `<h2 class="display" style="font-size:1.25rem; margin-top:10px;">Your orders</h2><p class="sell-note">Loading…</p>`;
  showOverlay('ordersModal');
  try {
    const orders = await mnApi('/api/orders');
    const el = document.getElementById('ordersContent');
    if(!orders.length){
      el.innerHTML = `<h2 class="display" style="font-size:1.25rem; margin-top:10px;">Your orders</h2><p class="sell-note">You haven't placed any orders yet.</p>`;
      return;
    }
    el.innerHTML = `<h2 class="display" style="font-size:1.25rem; margin-top:10px;">Your orders</h2>` + orders.map(o=>`
      <div class="order-summary" style="margin-top:12px;">
        <div class="line" style="font-weight:700;"><span>Order ${o.id.slice(0,8)}</span><span>${o.paymentStatus==='pending'?'Payment pending':o.paymentStatus}</span></div>
        <div class="line"><span>Placed</span><span>${new Date(o.createdAt).toLocaleString()}</span></div>
        ${o.items.map(i=>`<div class="line"><span>${i.name} × ${i.qty}</span><span class="mono">₹${(i.price*i.qty).toFixed(2)}</span></div>`).join('')}
        <div class="line" style="font-weight:700; border-top:1px solid var(--line); margin-top:6px; padding-top:8px;"><span>Total</span><span class="mono">₹${Number(o.total).toFixed(2)}</span></div>
        ${o.paymentStatus==='paid' ? `<div id="downloads-${o.id}" style="margin-top:10px;"><span class="sell-note">Checking downloads…</span></div>` : ''}
      </div>
    `).join('');
    for(const o of orders.filter(x=>x.paymentStatus==='paid')){
      try{
        const files = await mnApi('/api/orders/'+encodeURIComponent(o.id)+'/downloads');
        const d = document.getElementById('downloads-'+o.id);
        if(d) d.innerHTML = files.length ? files.map(f=>`<a class="checkout-btn" style="display:block;text-align:center;text-decoration:none;margin-top:6px;" href="${f.url}">Download ${f.name}</a>`).join('') : `<span class="sell-note">Digital delivery is being prepared.</span>`;
      }catch(e){ const d=document.getElementById('downloads-'+o.id); if(d) d.innerHTML='<span class="sell-note">Downloads unavailable right now.</span>'; }
    }
  } catch(err) {
    document.getElementById('ordersContent').innerHTML = `<h2 class="display" style="font-size:1.25rem; margin-top:10px;">Your orders</h2><p class="sell-note">${err.message || 'Could not load your orders — please try again.'}</p>`;
  }
}

/* ================= SELL MODAL ================= */
function openSell(e, custom){
  if(e) e.preventDefault();
  document.getElementById('sellContent').innerHTML = `
    <h2 class="display" style="font-size:1.25rem; margin-top:10px;">${custom ? 'Request custom work' : 'List a product'}</h2>
    <p class="sell-note">${custom ? "Describe what you need and we'll match you with the right seller." : "Tell us what you're selling. Submit the listing for admin review before it appears publicly."}</p>
    ${custom ? '' : `
    <div class="field"><label>Product name</label><input type="text" id="s-name" placeholder="e.g. Habit tracker template"></div>
    <div class="field"><label>Category</label><select id="s-cat">${CATEGORIES.filter(c=>c.id!=='all').map(c=>`<option value="${c.id}">${c.label}</option>`).join('')}</select></div>
    <div class="field"><label>Price (INR)</label><input type="number" id="s-price" min="1" step="0.01" placeholder="1999"></div>`}
    <div class="field"><label>${custom ? 'What do you need?' : 'Short description'}</label><textarea id="s-desc" rows="3" placeholder="${custom ? 'e.g. A landing page in Framer with copy included' : 'What does a buyer get?'}"></textarea></div>
    <button class="pay-btn" id="submitListing" style="background:var(--gold); color:var(--navy);">${custom ? 'Send request' : 'Submit for review'}</button>
  `;
  document.getElementById('submitListing').onclick = async ()=>{
    if(custom){ closeAllOverlays(); showToast('Please use the service quote form for custom work'); return; }
    if(!MN_AUTH.user){ closeAllOverlays(); openAuth('login'); return; }
    const name=document.getElementById('s-name').value.trim(); const category=document.getElementById('s-cat').value;
    const price=Number(document.getElementById('s-price').value); const description=document.getElementById('s-desc').value.trim();
    if(!name || !description || !Number.isFinite(price) || price<=0){ showToast('Enter a product name, description and valid INR price'); return; }
    const btn=document.getElementById('submitListing'); btn.disabled=true; btn.textContent='Submitting…';
    try {
      await mnApi('/api/products',{method:'POST',body:JSON.stringify({name,description,price,category})});
      closeAllOverlays(); showToast('Listing submitted for admin review');
      await loadProducts();
      if(typeof renderCatGrid==='function') renderCatGrid();
      if(typeof renderTrending==='function') renderTrending();
      if(typeof renderGrid==='function') renderGrid();
    }
    catch(err){ showToast(err.message||'Could not submit listing'); btn.disabled=false; btn.textContent='Submit for review'; }
  };
  showOverlay('sellModal');
  return false;
}

/* ================= SERVICES / QUOTES ================= */
function openServiceDetail(e, serviceId){
  if(e) e.preventDefault();
  const svc = SERVICE_LINES.find(s=>s.id===serviceId) || null;
  const user = MN_AUTH.user;
  document.getElementById('sellContent').innerHTML = `
    <h2 class="display" style="font-size:1.25rem; margin-top:10px;">${svc ? esc(svc.label) : 'Request a quote'}</h2>
    <p class="sell-note">${svc ? esc(svc.blurb) : "Tell us what you need and which of our services fits best — we'll follow up with a quote."}</p>
    <div class="field"><label>Your name</label><input type="text" id="q-name" value="${esc(user?user.name:'')}"></div>
    <div class="field"><label>Email</label><input type="email" id="q-email" value="${esc(user?user.email:'')}"></div>
    <div class="field"><label>Company (optional)</label><input type="text" id="q-company" placeholder="Your company name"></div>
    <div class="field"><label>Service</label><select id="q-service">${SERVICE_LINES.map(s=>`<option value="${s.id}" ${s.id===serviceId?'selected':''}>${esc(s.label)}</option>`).join('')}</select></div>
    <div class="field"><label>Budget</label><select id="q-budget">
      <option value="">Select a range</option>
      <option value="under-1k">Under ₹1,00,000</option>
      <option value="1k-5k">₹1,00,000 – ₹5,00,000</option>
      <option value="5k-15k">₹5,00,000 – ₹15,00,000</option>
      <option value="15k-plus">₹15,00,000+</option>
      <option value="not-sure">Not sure yet</option>
    </select></div>
    <div class="field"><label>Timeline</label><select id="q-timeline">
      <option value="">Select a timeline</option>
      <option value="asap">As soon as possible</option>
      <option value="within-2-weeks">Within 2 weeks</option>
      <option value="within-a-month">Within a month</option>
      <option value="flexible">Flexible</option>
    </select></div>
    <div class="field"><label>Project details</label><textarea id="q-details" rows="4" placeholder="Tell us what you need, your goals, and any constraints"></textarea></div>
    <button class="pay-btn" id="submitQuote" style="background:var(--gold); color:var(--navy);">Request a quote</button>
  `;
  document.getElementById('submitQuote').onclick = submitQuoteRequest;
  showOverlay('sellModal');
  return false;
}
async function submitQuoteRequest(){
  const btn = document.getElementById('submitQuote');
  const name = document.getElementById('q-name').value.trim();
  const email = document.getElementById('q-email').value.trim();
  const company = document.getElementById('q-company').value.trim();
  const serviceLine = document.getElementById('q-service').value;
  const budget = document.getElementById('q-budget').value;
  const timeline = document.getElementById('q-timeline').value;
  const details = document.getElementById('q-details').value.trim();
  if(!name || !email || !details){ showToast('Name, email and project details are required'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await mnApi('/api/quotes', { method:'POST', body: JSON.stringify({ name, email, company, serviceLine, budget, timeline, details }) });
    document.getElementById('sellContent').innerHTML = `
      <div class="confirm-mark">✓</div>
      <h2 class="confirm-title display">Request sent</h2>
      <p class="confirm-sub">We'll follow up at ${esc(email)} with a quote.</p>
      <button class="done-btn" id="doneQuoteBtn">Close</button>
    `;
    document.getElementById('doneQuoteBtn').onclick = closeAllOverlays;
  } catch(err) {
    showToast(err.message || 'Could not send your request — please try again');
    btn.disabled = false; btn.textContent = 'Request a quote';
  }
}

/* ================= PRODUCT DETAIL (quick-view modal, unchanged) ================= */
function openProduct(id){
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  state.activeProduct = id;
  const inCart = !!state.cart[id];
  document.getElementById('pdContent').innerHTML = `
    <div class="pd-swatch"><img src="${catImg('p-'+p.id,900,506)}" alt="" onerror="this.style.display='none'"></div>
    <div class="modal-inner">
      <div class="pd-cat">${catLabel(p.cat)} · sold by ${p.seller}</div>
      <h2 class="pd-title display">${p.name}</h2>
      <div class="pd-seller">${starRow(p.rating)} ${p.rating} rating from ${p.reviews} buyers</div>
      <div class="pd-price mono">₹${Number(p.price).toFixed(2)}</div>
      <div class="pd-desc">${p.desc}</div>
      <div class="pd-specs">${Object.entries(p.specs).map(([k,v])=>`<div class="pd-spec-row"><span>${k}</span><span>${v}</span></div>`).join('')}</div>
      <div class="pd-actions">
        <button class="add-btn ${inCart?'added':''}" id="pdAddBtn" style="padding:13px;">${inCart?'Added ✓':'Add to cart'}</button>
        <button class="add-btn buy-btn" style="padding:13px;" id="pdBuyBtn">${p.payhipUrl?'Buy securely':'Buy now'}</button>
      </div>
      <div class="pd-link-row"><a href="/product/${encodeURIComponent(p.id)}">View full details page →</a></div>
    </div>
  `;
  document.getElementById('pdAddBtn').onclick = ()=>{ addToCart(id); openProduct(id); };
  document.getElementById('pdBuyBtn').onclick = ()=>{ if(p.payhipUrl){ window.location.href=p.payhipUrl; return; } if(!state.cart[id]) addToCart(id); openCheckout(); };
  showOverlay('pdModal');
}

/* ================= TOAST ================= */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeAllOverlays(); } });

/* ================= INIT (common to every page using this module) ================= */
loadCartFromStorage();
restoreMNUser();
const _paymentResult=new URLSearchParams(location.search).get('payment');
if(_paymentResult==='success') showToast('Payment submitted — your order will appear after payment confirmation.');
if(_paymentResult==='failure') showToast('Payment was not completed. Your order remains unpaid.');
document.addEventListener('DOMContentLoaded', updateCartCount);
