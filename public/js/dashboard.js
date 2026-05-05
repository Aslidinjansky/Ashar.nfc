// Dashboard JS

const API = '';
let token = localStorage.getItem('token');
let userData = null;
let socialLinks = [];

// Auth check
if (!token) {
  window.location.href = '/login';
}

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');

  if (name === 'notifications') loadNotifications();
  if (name === 'messages') loadMessages();
  if (name === 'ads') loadAds();
}

function formatTime(dt) {
  const d = new Date(dt);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── LOAD USER DATA ──────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const res = await fetch('/api/dashboard', { headers: authHeaders() });
    if (res.status === 401) { logout(); return; }
    const data = await res.json();
    userData = data;
    socialLinks = data.social_links || [];

    // Header
    const headerAvatar = document.getElementById('headerAvatar');
    if (data.avatar) {
      headerAvatar.outerHTML = `<img src="${data.avatar}" class="dash-avatar" id="headerAvatar" alt="">`;
    } else {
      headerAvatar.textContent = (data.full_name || '?').charAt(0).toUpperCase();
    }
    document.getElementById('headerName').textContent = data.username || data.full_name;

    // Profile link
    const profileLink = document.getElementById('profileLink');
    if (profileLink) {
      profileLink.href = '/p/' + data.username;
    }

    // Fill form fields
    document.getElementById('editName').value = data.full_name || '';
    document.getElementById('editBio').value = data.bio || '';
    const bgColorInput = document.getElementById('editBgColor');
    bgColorInput.value = data.background_color || '#0a0a0f';
    document.getElementById('editBgColorVal').textContent = data.background_color || '#0a0a0f';

    // Profile preview card
    const statusClass = data.status === 'active' ? 'status-active' : data.status === 'suspended' ? 'status-suspended' : 'status-pending';
    const avatarHtml = data.avatar
      ? `<img src="${data.avatar}" class="preview-avatar" alt="">`
      : `<div class="preview-avatar-placeholder">${(data.full_name || '?').charAt(0).toUpperCase()}</div>`;
    document.getElementById('profilePreview').innerHTML = `
      <div class="profile-preview">
        ${avatarHtml}
        <div class="preview-info">
          <div class="preview-name">${data.full_name}</div>
          <div class="preview-username">@${data.username}</div>
          <span class="preview-status ${statusClass}">${data.status}</span>
        </div>
      </div>`;

    // Notification badge
    if (data.unread_notifications > 0) {
      const btn = document.getElementById('notifTabBtn');
      if (btn) btn.innerHTML = btn.innerHTML.replace('Notifs', `Notifs <span class="tab-badge">${data.unread_notifications}</span>`);
    }

    // Render links
    renderLinks();

    // Bank card
    if (data.bank_card) {
      document.getElementById('cardHolder').value = data.bank_card.cardholder_name || '';
      document.getElementById('cardLast4').value = data.bank_card.last4 || '';
      renderBankCardPreview(data.bank_card);
    }

    bgColorInput.addEventListener('input', () => {
      document.getElementById('editBgColorVal').textContent = bgColorInput.value;
    });

  } catch (err) {
    showToast('Failed to load dashboard', 'error');
  }
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────

async function saveProfile() {
  const body = {
    full_name: document.getElementById('editName').value,
    bio: document.getElementById('editBio').value,
    background_color: document.getElementById('editBgColor').value
  };
  try {
    const res = await fetch('/api/dashboard/profile', { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Profile saved!', 'success');
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function uploadAvatar(input) {
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('avatar', input.files[0]);
  try {
    const res = await fetch('/api/dashboard/avatar', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Avatar updated!', 'success');
    loadDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function uploadBackground(input) {
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('background', input.files[0]);
  try {
    const res = await fetch('/api/dashboard/background', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Background updated!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── LINKS ───────────────────────────────────────────────────────────────────

const LINK_ICONS = {
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 .18h3a2 2 0 012 1.72c.13.96.36 1.9.69 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.09-1.09a2 2 0 012.11-.45c.91.33 1.85.56 2.81.69A2 2 0 0122 16.92z"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`,
  telegram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.96 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.495 6.205a3.007 3.007 0 00-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 00.527 6.205a31.247 31.247 0 00-.522 5.805 31.247 31.247 0 00.522 5.783 3.007 3.007 0 002.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 002.088-2.088 31.247 31.247 0 00.5-5.783 31.247 31.247 0 00-.5-5.805zM9.609 15.601V8.408l6.264 3.602z"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  website: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`,
  email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg>`
};

function renderLinks() {
  const list = document.getElementById('linksList');
  if (!list) return;
  list.innerHTML = socialLinks.map((link, i) => `
    <div class="link-item" data-index="${i}">
      <div class="link-type-icon">${LINK_ICONS[link.type] || LINK_ICONS.website}</div>
      <div class="link-input-wrap">
        <div class="link-type-label">${link.type}</div>
        <input class="link-input" value="${link.url}" onchange="socialLinks[${i}].url=this.value" placeholder="URL or value">
      </div>
      <button class="link-remove" onclick="removeLink(${i})">×</button>
    </div>
  `).join('');
}

function showAddLink() {
  document.getElementById('addLinkForm').style.display = 'block';
  document.getElementById('newLinkUrl').focus();
}

function addLink() {
  const type = document.getElementById('newLinkType').value;
  const url = document.getElementById('newLinkUrl').value.trim();
  if (!url) { showToast('Please enter a URL', 'error'); return; }
  socialLinks.push({ type, url });
  document.getElementById('newLinkUrl').value = '';
  document.getElementById('addLinkForm').style.display = 'none';
  renderLinks();
}

function removeLink(i) {
  socialLinks.splice(i, 1);
  renderLinks();
}

async function saveLinks() {
  try {
    const res = await fetch('/api/dashboard/social-links', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ links: socialLinks })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Links saved!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── BANK CARD ────────────────────────────────────────────────────────────────

function renderBankCardPreview(card) {
  const el = document.getElementById('bankCardPreview');
  if (!el) return;
  el.innerHTML = `
    <div class="bank-card-preview">
      <div class="bank-card-chip"></div>
      <div class="bank-card-num">•••• •••• •••• ${card.last4}</div>
      <div class="bank-card-holder">${card.cardholder_name}</div>
    </div>`;
}

async function saveBankCard() {
  const cardholder_name = document.getElementById('cardHolder').value.trim();
  const last4 = document.getElementById('cardLast4').value.trim();
  if (!cardholder_name || !last4) { showToast('Fill in both fields', 'error'); return; }
  try {
    const res = await fetch('/api/dashboard/bank-card', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ cardholder_name, last4 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast('Card saved!', 'success');
    renderBankCardPreview({ cardholder_name, last4 });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

async function loadNotifications() {
  const el = document.getElementById('notificationsList');
  try {
    const res = await fetch('/api/dashboard/notifications', { headers: authHeaders() });
    const items = await res.json();
    if (!items.length) {
      el.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--text-secondary);">No notifications yet</div>`;
      return;
    }
    el.innerHTML = items.map(n => `
      <div class="notification-item ${n.read ? '' : 'unread'}" id="notif-${n.id}">
        <div class="notification-header">
          <div class="notification-title">${n.title}</div>
          <div class="notification-time">${formatTime(n.created_at)}</div>
        </div>
        <div class="notification-msg">${n.message}</div>
        ${n.media_url && n.media_type === 'image' ? `<img src="${n.media_url}" class="notification-media" alt="">` : ''}
        ${n.media_url && n.media_type === 'video' ? `<video src="${n.media_url}" class="notification-media" controls></video>` : ''}
        ${!n.read ? `<button class="notification-read-btn" onclick="markRead(${n.id})">Mark as read</button>` : ''}
      </div>`).join('');
  } catch (err) {
    el.innerHTML = `<div style="text-align:center;padding:40px 0;color:#ef4444;">Failed to load notifications</div>`;
  }
}

async function markRead(id) {
  await fetch(`/api/dashboard/notifications/${id}/read`, { method: 'PUT', headers: authHeaders() });
  const el = document.getElementById('notif-' + id);
  if (el) {
    el.classList.remove('unread');
    const btn = el.querySelector('.notification-read-btn');
    if (btn) btn.remove();
  }
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

async function loadMessages() {
  const el = document.getElementById('chatMessages');
  try {
    const res = await fetch('/api/dashboard/messages', { headers: authHeaders() });
    const msgs = await res.json();
    el.innerHTML = msgs.length ? msgs.map(m => `
      <div class="chat-bubble ${m.sender}">
        ${m.message}
        <div class="chat-time">${formatTime(m.created_at)}</div>
      </div>`).join('')
      : `<div style="text-align:center;color:var(--text-secondary);font-size:14px;margin-top:40px;">No messages yet. Send us a message!</div>`;
    el.scrollTop = el.scrollHeight;
  } catch {
    el.innerHTML = `<div style="color:#ef4444;font-size:14px;">Failed to load messages</div>`;
  }
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  try {
    const res = await fetch('/api/dashboard/messages', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error('Failed');
    loadMessages();
  } catch {
    showToast('Failed to send message', 'error');
  }
}

// ─── ADS ──────────────────────────────────────────────────────────────────────

async function loadAds() {
  const el = document.getElementById('adsList');
  try {
    const res = await fetch('/api/dashboard/ads', { headers: authHeaders() });
    const ads = await res.json();
    el.innerHTML = ads.length ? ads.map(ad => `
      <div class="ad-card">
        ${ad.media_type === 'image' ? `<img src="${ad.media_url}" class="ad-media" alt="">` : `<video src="${ad.media_url}" class="ad-media" controls></video>`}
        ${ad.caption ? `<div class="ad-caption">${ad.caption}</div>` : ''}
      </div>`).join('')
      : `<div style="text-align:center;padding:40px 0;color:var(--text-secondary);">No ads at the moment</div>`;
  } catch {
    el.innerHTML = `<div style="color:#ef4444;">Failed to load ads</div>`;
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', loadDashboard);
