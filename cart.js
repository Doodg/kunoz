/**
 * Kunoz Elfayrouz — shared cart engine (localStorage-based, no backend).
 * Included on every page so the cart persists across navigation.
 */
(function () {
  const CART_KEY = 'kunoz_cart_v1';
  window.WHATSAPP_NUMBER = '201042030926';
  // رسوم توصيل ثابتة حسب المحافظة — لا يوجد شحن مجاني (كل الطلبات بتدفع رسوم توصيل)
  window.SHIPPING_FEES = { cairo: 70, giza: 70, alex: 85, beheira: 85 };

  function getCart() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      const cart = raw ? JSON.parse(raw) : [];
      return Array.isArray(cart) ? cart : [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }

  function cartItemKey(item) {
    return [item.category, item.name].join('|');
  }

  function addToCart(item) {
    const cart = getCart();
    const key = cartItemKey(item);
    const existing = cart.find(i => cartItemKey(i) === key);
    if (existing) {
      existing.qty = Math.min(20, existing.qty + item.qty);
    } else {
      cart.push(item);
    }
    saveCart(cart);
    return cart;
  }

  function removeFromCart(index) {
    const cart = getCart();
    cart.splice(index, 1);
    saveCart(cart);
    return cart;
  }

  function updateCartQty(index, qty) {
    const cart = getCart();
    if (cart[index]) {
      cart[index].qty = Math.max(1, Math.min(20, parseInt(qty) || 1));
    }
    saveCart(cart);
    return cart;
  }

  function clearCart() {
    localStorage.removeItem(CART_KEY);
    updateCartBadge();
  }

  function cartCount() {
    return getCart().reduce((sum, i) => sum + i.qty, 0);
  }

  function cartSubtotal() {
    return getCart().reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
  }

  // بترجع رقم (رسوم الشحن) لو المحافظة معروفة عندنا، أو null لو "أخرى"
  // (يعني الرسوم لسه مش معروفة وهيتم تأكيدها مع العميل بعدين على واتساب).
  // مفيش شحن مجاني خالص مهما كان حجم الطلب.
  function shippingFee(subtotal, govCode) {
    if (subtotal <= 0) return 0;
    if (!(govCode in window.SHIPPING_FEES)) return null;
    return window.SHIPPING_FEES[govCode];
  }

  function formatEGP(n) {
    return Number(n).toFixed(2) + ' جنيه';
  }

  function updateCartBadge() {
    const count = cartCount();
    document.querySelectorAll('.cart-badge').forEach(el => {
      el.textContent = count;
      el.style.display = count > 0 ? 'flex' : 'none';
    });
  }

  function ensureToastStyles() {
    if (document.getElementById('cartToastStyle')) return;
    const style = document.createElement('style');
    style.id = 'cartToastStyle';
    style.textContent = `.cart-toast a { pointer-events: auto; }`;
    document.head.appendChild(style);
  }

  function showToast(message, withCartLink, linkText) {
    ensureToastStyles();
    let toast = document.getElementById('cartToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'cartToast';
      toast.className = 'cart-toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = message + (withCartLink ? ' — <a href="cart.html">' + (linkText || 'اذهب للسلة') + '</a>' : '');
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
    clearTimeout(window.__cartToastTimeout);
    window.__cartToastTimeout = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  function getCookie(name) {
    const match = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
    return match ? decodeURIComponent(match.pop()) : '';
  }

  function getFbParams() {
    const fbp = getCookie('_fbp');
    let fbc = getCookie('_fbc');
    if (!fbc) {
      const fbclid = new URLSearchParams(window.location.search).get('fbclid');
      if (fbclid) fbc = 'fb.1.' + Date.now() + '.' + fbclid;
    }
    return { fbp, fbc };
  }

  function getAdSource() {
    const params = new URLSearchParams(window.location.search);
    const utmId = params.get('utm_id');
    const utmSource = params.get('utm_source');
    const utmCampaign = params.get('utm_campaign');
    if (utmId || utmSource || utmCampaign) {
      return [utmSource, utmCampaign, utmId].filter(Boolean).join(' | ');
    }
    const ref = document.referrer;
    if (!ref || ref.includes(window.location.hostname)) return 'مباشر';
    return ref;
  }

  window.getAdSource = getAdSource;
  window.getFbParams = getFbParams;
  window.getCart = getCart;
  window.addToCart = addToCart;
  window.removeFromCart = removeFromCart;
  window.updateCartQty = updateCartQty;
  window.clearCart = clearCart;
  window.cartCount = cartCount;
  window.cartSubtotal = cartSubtotal;
  window.shippingFee = shippingFee;
  window.formatEGP = formatEGP;
  window.updateCartBadge = updateCartBadge;
  window.showCartToast = showToast;

  document.addEventListener('DOMContentLoaded', updateCartBadge);
})();
