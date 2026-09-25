/* ==================================================================
   MN Group — shared layout loader (Phase 1A)
   Injects the shared header/footer/overlays markup into the
   placeholders every new page declares (#site-header, #site-footer,
   #site-overlays), then re-syncs the bits of UI state that depend on
   that markup existing (auth buttons, cart badge) and marks the
   current page's nav link active.
   ================================================================== */
async function loadPartial(url, mountId){
  const mount = document.getElementById(mountId);
  if(!mount) return;
  try {
    const res = await fetch(url);
    mount.innerHTML = await res.text();
  } catch (err) {
    console.error('Could not load layout partial', url, err);
  }
}

function markActiveNav(){
  const path = location.pathname;
  let current = 'home';
  if(path.startsWith('/products')) current = 'products';
  else if(path.startsWith('/product/')) current = 'products';
  else if(path.startsWith('/categories')) current = 'categories';
  document.querySelectorAll('[data-nav]').forEach(a=>{
    a.classList.toggle('active', a.dataset.nav===current);
  });
}

(async function initLayout(){
  await Promise.all([
    loadPartial('/assets/partials/header.html', 'site-header'),
    loadPartial('/assets/partials/footer.html', 'site-footer'),
    loadPartial('/assets/partials/overlays.html', 'site-overlays'),
  ]);
  markActiveNav();
  // Header/overlays markup only exists from this point on — re-run the
  // bits of init from shared.js that touch it (safe no-ops otherwise).
  if(typeof updateAuthUI === 'function') updateAuthUI();
  if(typeof updateCartCount === 'function') updateCartCount();
  document.dispatchEvent(new CustomEvent('mn:layout-ready'));
})();
