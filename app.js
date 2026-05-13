(function() {
  'use strict';

  // ── Coupe du Monde 2026 (11 juin → 19 juillet) ────────
  (function() {
    const now = new Date();
    const start = new Date('2026-06-11');
    const end   = new Date('2026-07-20'); // exclusif
    const el = document.getElementById('sectionCoupe');
    if (el && now >= start && now < end) el.style.display = '';
  })();

  // ── Constants ──────────────────────────────────────────
  const DELIVERY_ZONES = new Set(['78380','78230','78430','78170','78290','78400','78160','92500','92210']);
  const DELIVERY_FEE = 2.50;
  const FREE_DELIVERY_ZONES = new Set(['78380','78170','78430']); // Bougival, La Celle-Saint-Cloud, Louveciennes
  const MIN_EMPORTER = 12;
  const MIN_LIVRAISON = 20;

  const DRINKS = ['Coca-Cola Original (canette)', 'Coca-Cola Sans Sucres (canette)', 'Orangina (canette)', 'Ice Tea (canette)'];
  const MEAT_OPTS = ['Bœuf', 'Poulet', 'Crevettes'];
  const CHOICES = {
    'Gyoza':           { label: 'Choisissez votre garniture', prefix: 'Garniture', opts: ['Poulet', 'Crevettes'] },
    'Pad Thaï':        { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Panang':          { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Curry Rouge':     { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Curry Vert':      { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Mi Prat':         { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Pad Kapao':       { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Khao Pad':        { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Bobun':           { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
    'Menu Pad Thaï':   { steps: [
      { label: 'Choisissez votre viande', prefix: 'Viande', opts: MEAT_OPTS },
      { label: 'Choisissez votre boisson', prefix: 'Boisson', opts: DRINKS },
    ]},
    'Menu Loc Lak Bœuf':        { label: 'Choisissez votre boisson', prefix: 'Boisson', opts: DRINKS },
    'Menu Rice Chicken Krousty': { label: 'Choisissez votre boisson', prefix: 'Boisson', opts: DRINKS },
  };

  // ── State ──────────────────────────────────────────────
  let cart = (() => { try { return JSON.parse(localStorage.getItem('mythai_cart') || '[]'); } catch { return []; } })();
  let mode = 'emporter'; // 'emporter' | 'livraison'
  let promoEligible = false;

  // ── Nav scroll ─────────────────────────────────────────
  const navEl = document.getElementById('nav');
  window.addEventListener('scroll', () => {
    navEl.classList.toggle('solid', window.scrollY > 50);
  }, { passive: true });

  // ── Tabs ───────────────────────────────────────────────
  document.getElementById('tabsWrap').addEventListener('click', e => {
    const btn = e.target.closest('.t-btn');
    if (!btn) return;
    document.querySelectorAll('.t-btn').forEach(b => b.classList.remove('on'));
    document.querySelectorAll('.t-panel').forEach(p => p.classList.remove('on'));
    btn.classList.add('on');
    document.getElementById('p-' + btn.dataset.tab).classList.add('on');
  });

  // ── Scroll reveal ──────────────────────────────────────
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

  // ── Today highlight ────────────────────────────────────
  const today = new Date().getDay();
  document.querySelectorAll('#hoursBody tr').forEach(row => {
    if (parseInt(row.dataset.day) === today) {
      row.classList.add('today');
      row.querySelector('td').innerHTML += '<span class="today-tag">Aujourd\'hui</span>';
    }
  });

  // ── Open/Closed status (recalculé toutes les minutes) ────
  function updateOpenStatus() {
    const now = new Date(), day = now.getDay(), h = now.getHours() + now.getMinutes()/60;
    const open = day !== 0 && ((h >= 11 && h < 15) || (h >= 18 && h < 23));
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    dot.classList.toggle('closed', !open);
    txt.textContent = open ? 'Ouvert maintenant · Bougival' : 'Fermé — Retrouvez-nous bientôt';
  }
  updateOpenStatus();
  setInterval(updateOpenStatus, 60_000);

  // ── Particles ─────────────────────────────────────────
  (function() {
    const c = document.getElementById('particles');
    for (let i = 0; i < 28; i++) {
      const p = document.createElement('div');
      p.className = 'pt';
      const s = Math.random() * 2.5 + 1;
      p.style.cssText = `left:${Math.random()*100}%;width:${s}px;height:${s}px;animation-duration:${Math.random()*10+8}s;animation-delay:${Math.random()*10}s`;
      c.appendChild(p);
    }
  })();

  // ── Toast ──────────────────────────────────────────────
  let _toastTimer;
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ── Cart helpers ───────────────────────────────────────
  function saveCart() { localStorage.setItem('mythai_cart', JSON.stringify(cart)); }

  function cartTotal() {
    return cart.reduce((s, i) => s + i.price * i.qty, 0);
  }

  function cartCount() {
    return cart.reduce((s, i) => s + i.qty, 0);
  }

  function addToCart(name, price, notes) {
    const idx = cart.findIndex(i => i.name === name && (i.notes||'') === (notes||''));
    if (idx >= 0) { cart[idx].qty++; }
    else { cart.push({ name, price, qty: 1, ...(notes ? { notes } : {}) }); }
    saveCart();
    renderCart();
    showToast(`✓ ${name} ajouté`);
    updateBadges();
  }

  function updateBadges() {
    const count = cartCount();
const show = count > 0;
    // Nav badge
    const nb = document.getElementById('navCartBadge');
    nb.textContent = count;
    nb.classList.toggle('show', show);
    // Fab badge
    const fb = document.getElementById('fabCartBadge');
    fb.textContent = count;
    fb.classList.toggle('show', show);
    const fabCart = document.getElementById('fabCart');
    fabCart.classList.toggle('show', show);
  }

  function renderCart() {
    const itemsEl = document.getElementById('cartItems');
    const emptyEl = document.getElementById('cartEmpty');
    const headCount = document.getElementById('cartHeadCount');
    const subtotalEl = document.getElementById('cartSubtotal');
    const warnEl  = document.getElementById('cartMinWarn');
    const infoEl  = document.getElementById('cartMinInfo');
    const btnCo   = document.getElementById('btnCheckout');

    const count = cartCount();
    const total = cartTotal();
    const min = mode === 'livraison' ? MIN_LIVRAISON : MIN_EMPORTER;

    headCount.textContent = count === 0 ? 'Panier vide' : `${count} article${count > 1 ? 's' : ''}`;
    subtotalEl.textContent = fmt(total);

    if (count === 0) {
      emptyEl.style.display = 'flex';
      itemsEl.innerHTML = '';
      warnEl.style.display = 'none';
      btnCo.disabled = true;
      document.getElementById('stepBtn2').disabled = true;
      return;
    }

    emptyEl.style.display = 'none';

    // Build items HTML
    let html = '';
    cart.forEach((item, idx) => {
      const notesHtml = item.notes ? `<div class="ci-row-notes">${esc(item.notes)}</div>` : '';
      html += `<div class="ci-row">
        <div class="ci-row-name">${esc(item.name)}${notesHtml}</div>
        <div class="ci-row-price">${fmt(item.price * item.qty)}</div>
        <div class="qty-ctrl">
          <button class="qty-btn" data-action="dec" data-idx="${idx}" aria-label="Retirer un">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-btn" data-action="inc" data-idx="${idx}" aria-label="Ajouter un">+</button>
        </div>
      </div>`;
    });
    itemsEl.innerHTML = html;

    // Min info + warn
    const modeLabel = mode === 'livraison' ? 'livraison' : 'à emporter';
    infoEl.textContent = `Minimum ${modeLabel} : ${min} €`;
    // Check minimum on final total (promo may bring it below threshold)
    const effectiveTotal = promoEligible ? Math.round(total * 0.9 * 100) / 100 : total;
    if (effectiveTotal < min) {
      warnEl.textContent = `Encore ${fmt(min - effectiveTotal)} pour atteindre le minimum`;
      warnEl.style.display = 'block';
      btnCo.disabled = true;
      document.getElementById('stepBtn2').disabled = true;
    } else {
      warnEl.style.display = 'none';
      btnCo.disabled = false;
      document.getElementById('stepBtn2').disabled = false;
    }

    updateCheckoutTotals();
  }

  function updateCheckoutTotals() {
    const sub = cartTotal();
    const isLiv = mode === 'livraison';
    const zip = getVal('fZip');
    const delivFee = isLiv ? (FREE_DELIVERY_ZONES.has(zip) ? 0 : DELIVERY_FEE) : 0;
    let total = sub + delivFee;
    let promoDiscount = 0;
    if (promoEligible) { promoDiscount = Math.round(sub * 0.10 * 100) / 100; total -= promoDiscount; }

    document.getElementById('co-subtotal').textContent = fmt(sub);
    const delivRow = document.getElementById('co-deliv-row');
    delivRow.style.display = isLiv ? 'flex' : 'none';
    document.getElementById('co-deliv-val').textContent = delivFee === 0 ? 'Gratuit' : fmt(delivFee);
    const promoRow = document.getElementById('co-promo-row');
    promoRow.style.display = promoEligible ? 'flex' : 'none';
    if (promoEligible) document.getElementById('co-promo-val').textContent = `-${fmt(promoDiscount)}`;
    document.getElementById('co-total').textContent = fmt(total);
  }

  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmt(n) { return n.toFixed(2).replace('.',',') + ' €'; }

  // ── Cart qty controls ──────────────────────────────────
  document.getElementById('cartItems').addEventListener('click', e => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.dataset.action === 'inc') {
      cart[idx].qty++;
    } else {
      cart[idx].qty--;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
    }
    saveCart();
    renderCart();
    updateBadges();
  });

  // ── Open / Close cart ─────────────────────────────────
  function openCart(step = 1) {
    document.getElementById('cartOverlay').classList.add('open');
    document.getElementById('cartPanel').classList.add('open');
    document.body.style.overflow = 'hidden';
    if (step === 1) goStep(1);
    renderCart();
  }
  function closeCart() {
    document.getElementById('cartOverlay').classList.remove('open');
    document.getElementById('cartPanel').classList.remove('open');
    document.body.style.overflow = '';
  }

  document.getElementById('cartOverlay').addEventListener('click', closeCart);
  document.getElementById('cartCloseBtn').addEventListener('click', closeCart);
  document.getElementById('navCartBtn').addEventListener('click', () => openCart(1));
  document.getElementById('fabCart').addEventListener('click', () => openCart(1));
  document.getElementById('mobileOrderBtn').addEventListener('click', () => document.getElementById('menu').scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('heroOrderBtn').addEventListener('click', () => document.getElementById('menu').scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('footOrderLink').addEventListener('click', e => { e.preventDefault(); document.getElementById('menu').scrollIntoView({ behavior: 'smooth' }); });

  // Escape key
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCart(); });

  // ── Steps ─────────────────────────────────────────────
  function goStep(step) {
    document.querySelectorAll('.cart-step-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.step) === step));
    document.querySelectorAll('.cart-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`cartView${step}`).classList.add('active');
    if (step === 2) updateCheckoutTotals();
  }
  document.querySelectorAll('.cart-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.disabled) goStep(parseInt(btn.dataset.step));
    });
  });
  document.getElementById('btnCheckout').addEventListener('click', () => {
    goStep(2);
    document.getElementById('stepBtn2').disabled = false;
  });

  // ── Choice modal ───────────────────────────────────────
  let _choicePending = null;
  let _choiceStep = 0;
  let _choiceSelections = [];

  function _renderChoiceStep() {
    const { name } = _choicePending;
    const config = CHOICES[name];
    const stepConfig = config.steps ? config.steps[_choiceStep] : config;
    document.getElementById('choiceItemTitle').textContent = name;
    document.getElementById('choiceLabel').textContent = stepConfig.label;
    const optsEl = document.getElementById('choiceOptions');
    optsEl.innerHTML = '';
    stepConfig.opts.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'choice-opt' + (i === 0 ? ' selected' : '');
      btn.textContent = opt;
      btn.addEventListener('click', () => {
        optsEl.querySelectorAll('.choice-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      optsEl.appendChild(btn);
    });
  }

  function openChoiceModal(name, price) {
    const config = CHOICES[name];
    if (!config) { addToCart(name, price); return; }
    _choicePending = { name, price };
    _choiceStep = 0;
    _choiceSelections = [];
    _renderChoiceStep();
    document.getElementById('choiceOverlay').classList.add('open');
    document.getElementById('choiceModal').classList.add('open');
  }

  function closeChoiceModal() {
    document.getElementById('choiceOverlay').classList.remove('open');
    document.getElementById('choiceModal').classList.remove('open');
    _choicePending = null;
    _choiceStep = 0;
    _choiceSelections = [];
  }

  document.getElementById('choiceOverlay').addEventListener('click', closeChoiceModal);
  document.getElementById('choiceCancel').addEventListener('click', closeChoiceModal);
  document.getElementById('choiceConfirm').addEventListener('click', () => {
    if (!_choicePending) { closeChoiceModal(); return; }
    const selected = document.querySelector('#choiceOptions .choice-opt.selected');
    if (!selected) return;
    const { name, price } = _choicePending;
    const config = CHOICES[name];
    const stepConfig = config.steps ? config.steps[_choiceStep] : config;
    _choiceSelections.push(`${stepConfig.prefix}: ${selected.textContent}`);
    if (config.steps && _choiceStep < config.steps.length - 1) {
      _choiceStep++;
      _renderChoiceStep();
    } else {
      const notes = _choiceSelections.join(' | ');
      closeChoiceModal();
      addToCart(name, price, notes);
      openCart(1);
    }
  });

  // ── Add to cart buttons ────────────────────────────────
  document.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', e => {
      const item = e.target.closest('.food-item');
      const name = item.dataset.name;
      const price = parseFloat(item.dataset.price);
      if (CHOICES[name]) { openChoiceModal(name, price); }
      else { addToCart(name, price); }
    });
  });
  document.querySelectorAll('.btn-add-deal').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      const price = parseFloat(btn.dataset.price);
      if (CHOICES[name]) { openChoiceModal(name, price); }
      else { addToCart(name, price); }
    });
  });

  // ── Mode toggle ────────────────────────────────────────
  document.getElementById('modeEmporter').addEventListener('click', () => setMode('emporter'));
  document.getElementById('modeLivraison').addEventListener('click', () => setMode('livraison'));
  document.getElementById('fZip').addEventListener('input', () => updateCheckoutTotals());
  function setMode(m) {
    mode = m;
    document.getElementById('modeEmporter').classList.toggle('selected', m === 'emporter');
    document.getElementById('modeLivraison').classList.toggle('selected', m === 'livraison');
    const df = document.getElementById('deliveryFields');
    df.classList.toggle('show', m === 'livraison');
    document.getElementById('livZoneMsg').style.display = m === 'livraison' ? 'block' : 'none';
    renderCart(); // recheck minimum
    updateCheckoutTotals();
  }

  // ── Promo check (on email input, temps réel) ────────────
  let _promoTimer;
  document.getElementById('fEmail').addEventListener('input', async () => {
    const email = document.getElementById('fEmail').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      promoEligible = false;
      document.getElementById('promoBlock').style.display = 'none';
      updateCheckoutTotals();
      return;
    }
    clearTimeout(_promoTimer);
    _promoTimer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/check-promo?email=${encodeURIComponent(email)}`);
        const d = await r.json();
        promoEligible = d.eligible;
        document.getElementById('promoBlock').style.display = promoEligible ? 'block' : 'none';
        updateCheckoutTotals();
      } catch { promoEligible = false; }
    }, 500);
  });

  // ── Form validation ────────────────────────────────────
  function getVal(id) { return document.getElementById(id).value.trim(); }
  function setErr(id, msgId, show) {
    const el = document.getElementById(id);
    const msg = document.getElementById(msgId);
    el.classList.toggle('error', show);
    msg.classList.toggle('show', show);
    return show;
  }
  function clearAllErrors() {
    ['fPrenom','fNom','fPhone','fEmail','fAddress','fZip','fCity'].forEach(id => {
      document.getElementById(id).classList.remove('error');
    });
    document.querySelectorAll('.err-msg').forEach(el => el.classList.remove('show'));
  }

  function validateForm() {
    clearAllErrors();
    let ok = true;
    if (!getVal('fPrenom')) ok = !setErr('fPrenom','errPrenom',true) && ok;
    if (!getVal('fNom'))    ok = !setErr('fNom','errNom',true) && ok;
    if (!getVal('fPhone'))  ok = !setErr('fPhone','errPhone',true) && ok;
    const email = getVal('fEmail');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ok = !setErr('fEmail','errEmail',true) && ok;
    if (mode === 'livraison') {
      if (!getVal('fAddress')) ok = !setErr('fAddress','errAddress',true) && ok;
      const zip = getVal('fZip');
      if (!zip || !DELIVERY_ZONES.has(zip)) ok = !setErr('fZip','errZip',true) && ok;
      if (!getVal('fCity')) ok = !setErr('fCity','errCity',true) && ok;
    }
    const cgv = document.getElementById('cgvCheck');
    const errCgv = document.getElementById('errCgv');
    if (!cgv.checked) { errCgv.classList.add('show'); ok = false; }
    else { errCgv.classList.remove('show'); }
    return ok;
  }

  // ── Pay button ─────────────────────────────────────────
  document.getElementById('btnPay').addEventListener('click', async () => {
    // Block if restaurant is closed (server will also reject, but fail fast client-side)
    const _now = new Date(), _day = _now.getDay(), _hm = _now.getHours() * 60 + _now.getMinutes();
    const _open = _day !== 0 && ((_hm >= 11 * 60 && _hm < 15 * 60) || (_hm >= 18 * 60 && _hm < 23 * 60));
    if (!_open) {
      const errEl = document.getElementById('payErr');
      errEl.textContent = 'Le restaurant est actuellement fermé. Revenez pendant les horaires d\'ouverture.';
      errEl.style.display = 'block';
      document.getElementById('checkoutForm').scrollTop = 0;
      return;
    }
    if (!validateForm()) {
      document.getElementById('checkoutForm').scrollTop = 0;
      return;
    }
    const btn = document.getElementById('btnPay');
    const spinner = document.getElementById('paySpinner');
    const payText = document.getElementById('payText');
    const errEl = document.getElementById('payErr');

    btn.disabled = true;
    payText.style.display = 'none';
    spinner.style.display = 'block';
    errEl.style.display = 'none';

    const delivery = {
      mode,
      firstname: getVal('fPrenom'),
      lastname:  getVal('fNom'),
      phone:     getVal('fPhone'),
    };
    if (mode === 'livraison') {
      delivery.address = getVal('fAddress');
      delivery.zip     = getVal('fZip');
      delivery.city    = getVal('fCity');
      delivery.floor   = getVal('fFloor');
      delivery.code    = getVal('fCode');
      delivery.instructions = getVal('fInstructions');
    }

    const promoEmail = promoEligible ? getVal('fEmail') : '';

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(i => ({ name: i.name, price: i.price, qty: i.qty, ...(i.notes ? { notes: i.notes } : {}) })),
          delivery,
          applyPromo: promoEligible,
          promoEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        errEl.textContent = data.error || 'Erreur lors du paiement.';
        errEl.style.display = 'block';
        btn.disabled = false;
        payText.style.display = 'flex';
        spinner.style.display = 'none';
        return;
      }
      // Clear cart before redirect
      cart = [];
      saveCart();
      updateBadges();
      window.location.href = data.url;
    } catch {
      errEl.textContent = 'Erreur réseau. Veuillez réessayer.';
      errEl.style.display = 'block';
      btn.disabled = false;
      payText.style.display = 'flex';
      spinner.style.display = 'none';
    }
  });

  // ── Google Reviews ─────────────────────────────────────
  async function loadReviews() {
    try {
      const reviews = [
        {
          author: 'Georges Dietrich',
          rating: 5,
          text: "J'y vais depuis un moment. Les plats sont toujours excellents, la qualité est au rendez-vous. On s'en lasse pas. Je recommande vivement.",
          time: 'Il y a une semaine',
          photo: null,
        },
        {
          author: 'Got Hammadi',
          rating: 5,
          text: '',
          time: 'Il y a une semaine',
          photo: null,
        },
        {
          author: 'Mohamed Ali Hajjem',
          rating: 5,
          text: '',
          time: 'Il y a une semaine',
          photo: null,
        },
      ];
      if (!Array.isArray(reviews) || reviews.length === 0) return;

      const grid = document.getElementById('avisGrid');
      grid.innerHTML = reviews.map(r => {
        const stars = Array.from({ length: 5 }, (_, i) =>
          `<i class="fas fa-star${i < r.rating ? '' : '-half-alt'}" style="${i >= r.rating ? 'opacity:.3' : ''}"></i>`
        ).join('');
        const avatar = r.photo
          ? `<img class="avis-avatar" src="${r.photo}" alt="${r.author}" loading="lazy">`
          : `<div class="avis-avatar-placeholder">${r.author.charAt(0).toUpperCase()}</div>`;
        const text = r.text
          ? `<p class="avis-text">${r.text.length > 200 ? r.text.slice(0, 197) + '…' : r.text}</p>`
          : '';
        return `
          <div class="avis-card">
            <div class="avis-top">
              ${avatar}
              <div class="avis-meta">
                <div class="avis-author">${r.author}</div>
                <div class="avis-time">${r.time}</div>
              </div>
            </div>
            <div class="avis-stars">${stars}</div>
            ${text}
          </div>`;
      }).join('');

      document.getElementById('avis').style.display = 'block';
    } catch { /* API non configurée ou indisponible */ }
  }

  // ── Init ───────────────────────────────────────────────
  updateBadges();
  renderCart();
  loadReviews();

})();
