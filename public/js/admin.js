// Admin panel JS

let adminToken = localStorage.getItem('adminToken');
let currentChatUserId = null;
let currentChatUsername = '';

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function adminHeaders() {
  return { 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' };
}

function formatTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function adminLogout() {
  localStorage.removeItem('adminToken');
  adminToken = null;
  document.getElementById('adminPanel').style.display = 'none';
  document.getElementById('adminLoginScreen').style.display = 'block';
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

async function adminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('adminUser').value;
  const password = document.getElementById('adminPass').value;
  const errEl = document.getElementById('adminLoginErr');
  errEl.style.display = 'none';

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Signing in…';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    localStorage.setItem('adminToken', data.token);
    adminToken = data.token;
    initAdminPanel();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

function initAdminPanel() {
  document.getElementById('adminLoginScreen').style.display = 'none';
  document.getElementById('adminPanel').style.display = 'flex';
  loadStats();
  loadApplications('pending');
  loadUsers();
  loadUserListForSelect();
  loadAdminAds();
  loadMessageThreads();
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function adminTab(name, btn) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('atab-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
}

// ─── STATS ────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', { headers: adminHeaders() });
    const data = await res.json();
    document.getElementById('stat-pending').textContent = data.pending_applications || 0;
    document.getElementById('stat-users').textContent = data.total_users || 0;
    document.getElementById('stat-msgs').textContent = data.unread_messages || 0;
    document.getElementById('stat-ads').textContent = data.total_ads || 0;

    if (data.pending_applications > 0) {
      const btn = document.getElementById('appTabBtn');
      if (btn) {
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.textContent = data.pending_applications;
        btn.appendChild(badge);
      }
    }
  } catch {}
}

// ─── APPLICATIONS ─────────────────────────────────────────────────────────────

let allApps = [];

async function loadApplications(filter) {
  const el = document.getElementById('appTable');
  el.innerHTML = `<div style="text-align:center;padding:20px;"><div class="spinner" style="margin:0 auto;"></div></div>`;
  try {
    const res = await fetch('/api/admin/applications', { headers: adminHeaders() });
    allApps = await res.json();
    const filtered = filter ? allApps.filter(a => a.status === filter) : allApps;
    renderAppsTable(filtered);
  } catch {
    el.innerHTML = `<div style="color:#ef4444;padding:20px;">Failed to load applications</div>`;
  }
}

function renderAppsTable(apps) {
  const el = document.getElementById('appTable');
  if (!apps.length) { el.innerHTML = `<div style="color:var(--text-secondary);padding:20px;text-align:center;">No applications found</div>`; return; }

  el.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>Name</th><th>Product</th><th>Status</th><th>Date</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${apps.map(a => `
            <tr>
              <td>
                <div style="font-weight:500;">${a.full_name}</div>
                <div style="font-size:11px;color:var(--text-secondary);">${a.email}</div>
              </td>
              <td style="font-size:12px;">${a.nfc_product}</td>
              <td><span class="badge-${a.status}">${a.status}</span></td>
              <td style="font-size:11px;color:var(--text-secondary);">${new Date(a.created_at).toLocaleDateString()}</td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  <button class="action-btn action-view" onclick="viewApp(${a.id})">View</button>
                  ${a.status === 'pending' ? `
                    <button class="action-btn action-approve" onclick="updateApp(${a.id},'approved')">✓</button>
                    <button class="action-btn action-reject" onclick="updateApp(${a.id},'rejected')">✗</button>
                  ` : ''}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function viewApp(id) {
  const app = allApps.find(a => a.id === id);
  if (!app) return;
  document.getElementById('appModalBody').innerHTML = `
    <div class="user-detail-row"><span class="user-detail-label">Name</span><span class="user-detail-value">${app.full_name}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">Email</span><span class="user-detail-value">${app.email}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">Phone</span><span class="user-detail-value">${app.phone}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">WhatsApp</span><span class="user-detail-value">${app.whatsapp || '—'}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">City</span><span class="user-detail-value">${app.city || '—'}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">Product</span><span class="user-detail-value">${app.nfc_product}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">Status</span><span class="user-detail-value"><span class="badge-${app.status}">${app.status}</span></span></div>
    <div class="user-detail-row"><span class="user-detail-label">Notes</span><span class="user-detail-value">${app.notes || '—'}</span></div>
    <div class="user-detail-row"><span class="user-detail-label">Date</span><span class="user-detail-value">${formatTime(app.created_at)}</span></div>
    <div style="display:flex;gap:8px;margin-top:16px;">
      ${app.status === 'pending' ? `
        <button class="action-btn action-approve" style="flex:1;padding:10px;" onclick="updateApp(${app.id},'approved');closeAppModal()">Approve</button>
        <button class="action-btn action-reject" style="flex:1;padding:10px;" onclick="updateApp(${app.id},'rejected');closeAppModal()">Reject</button>
      ` : ''}
      <a href="https://wa.me/${app.whatsapp || app.phone}" target="_blank" style="flex:1;background:#25D366;color:#fff;text-align:center;padding:10px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;">WhatsApp</a>
    </div>`;
  document.getElementById('appModal').style.display = 'flex';
}

function closeAppModal() { document.getElementById('appModal').style.display = 'none'; }

async function updateApp(id, status, notes) {
  try {
    const res = await fetch(`/api/admin/applications/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ status, notes: notes || '' })
    });
    if (!res.ok) throw new Error('Failed');
    showToast(`Application ${status}`, 'success');
    loadApplications('pending');
    loadStats();
  } catch {
    showToast('Update failed', 'error');
  }
}

// ─── USERS ────────────────────────────────────────────────────────────────────

let allUsers = [];

async function loadUsers() {
  const el = document.getElementById('usersTable');
  try {
    const res = await fetch('/api/admin/users', { headers: adminHeaders() });
    allUsers = await res.json();
    renderUsersTable(allUsers);
  } catch {
    el.innerHTML = `<div style="color:#ef4444;padding:20px;">Failed to load users</div>`;
  }
}

function renderUsersTable(users) {
  const el = document.getElementById('usersTable');
  if (!users.length) { el.innerHTML = `<div style="color:var(--text-secondary);padding:20px;text-align:center;">No users found</div>`; return; }
  el.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>User</th><th>Product</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>
                <div style="font-weight:500;">${u.full_name}</div>
                <div style="font-size:11px;color:var(--text-secondary);">@${u.username}</div>
              </td>
              <td style="font-size:12px;">${u.nfc_product || '—'}</td>
              <td><span class="badge-${u.status}">${u.status}</span></td>
              <td>
                <div style="display:flex;gap:4px;">
                  <button class="action-btn action-view" onclick="viewUser(${u.id})">View</button>
                  ${u.status !== 'suspended' ? `<button class="action-btn action-suspend" onclick="suspendUser(${u.id})">Suspend</button>` : `<button class="action-btn action-approve" onclick="activateUser(${u.id})">Activate</button>`}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

async function viewUser(id) {
  try {
    const res = await fetch(`/api/admin/users/${id}`, { headers: adminHeaders() });
    const u = await res.json();
    document.getElementById('userModalBody').innerHTML = `
      ${u.avatar ? `<div style="text-align:center;margin-bottom:16px;"><img src="${u.avatar}" style="width:80px;height:80px;border-radius:50%;border:2px solid var(--accent-gold);"></div>` : ''}
      <div class="user-detail-row"><span class="user-detail-label">Full Name</span><span class="user-detail-value">${u.full_name}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">Username</span><span class="user-detail-value">@${u.username}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">Email</span><span class="user-detail-value">${u.email}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">Phone</span><span class="user-detail-value">${u.phone || '—'}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">City</span><span class="user-detail-value">${u.city || '—'}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">NFC Product</span><span class="user-detail-value">${u.nfc_product || '—'}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">Status</span><span class="user-detail-value"><span class="badge-${u.status}">${u.status}</span></span></div>
      <div class="user-detail-row"><span class="user-detail-label">Joined</span><span class="user-detail-value">${formatTime(u.created_at)}</span></div>
      <div class="user-detail-row"><span class="user-detail-label">Social Links</span><span class="user-detail-value">${u.social_links.length} links</span></div>
      ${u.bank_card ? `<div class="user-detail-row"><span class="user-detail-label">Bank Card</span><span class="user-detail-value">•••• ${u.bank_card.last4}</span></div>` : ''}
      <div style="display:flex;gap:8px;margin-top:16px;">
        <a href="/p/${u.username}" target="_blank" class="btn-outline" style="flex:1;text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center;padding:10px;font-size:13px;">View Profile</a>
        ${u.status !== 'suspended' ? `<button class="action-btn action-suspend" style="flex:1;padding:10px;" onclick="suspendUser(${u.id});closeUserModal()">Suspend</button>` : `<button class="action-btn action-approve" style="flex:1;padding:10px;" onclick="activateUser(${u.id});closeUserModal()">Activate</button>`}
      </div>`;
    document.getElementById('userModal').style.display = 'flex';
  } catch {
    showToast('Failed to load user', 'error');
  }
}

function closeUserModal() { document.getElementById('userModal').style.display = 'none'; }

async function suspendUser(id) {
  if (!confirm('Suspend this user?')) return;
  try {
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers: adminHeaders() });
    showToast('User suspended', 'success');
    loadUsers();
  } catch { showToast('Failed', 'error'); }
}

async function activateUser(id) {
  try {
    await fetch(`/api/admin/users/${id}`, {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ status: 'active' })
    });
    showToast('User activated', 'success');
    loadUsers();
  } catch { showToast('Failed', 'error'); }
}

// ─── USER SELECTS ─────────────────────────────────────────────────────────────

async function loadUserListForSelect() {
  try {
    const res = await fetch('/api/admin/users', { headers: adminHeaders() });
    const users = await res.json();
    const notifSel = document.getElementById('notifTarget');
    const adSel = document.getElementById('adTarget');
    users.forEach(u => {
      const opt = `<option value="${u.id}">${u.full_name} (@${u.username})</option>`;
      if (notifSel) notifSel.insertAdjacentHTML('beforeend', opt);
      if (adSel) adSel.insertAdjacentHTML('beforeend', opt);
    });
  } catch {}
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

async function sendNotification(e) {
  e.preventDefault();
  const formData = new FormData();
  const uid = document.getElementById('notifTarget').value;
  if (uid) formData.append('user_id', uid);
  formData.append('title', document.getElementById('notifTitle').value);
  formData.append('message', document.getElementById('notifMessage').value);
  const mediaFile = document.getElementById('notifMedia').files[0];
  if (mediaFile) formData.append('media', mediaFile);

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Sending…';

  try {
    const res = await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + adminToken },
      body: formData
    });
    if (!res.ok) throw new Error('Failed');
    showToast('Notification sent!', 'success');
    e.target.reset();
  } catch {
    showToast('Failed to send', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Send Notification';
  }
}

// ─── ADS ──────────────────────────────────────────────────────────────────────

async function createAd(e) {
  e.preventDefault();
  const formData = new FormData();
  const uid = document.getElementById('adTarget').value;
  if (uid) formData.append('user_id', uid);
  formData.append('caption', document.getElementById('adCaption').value);
  const mediaFile = document.getElementById('adMedia').files[0];
  if (!mediaFile) { showToast('Please upload media', 'error'); return; }
  formData.append('media', mediaFile);

  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const res = await fetch('/api/admin/ads', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + adminToken },
      body: formData
    });
    if (!res.ok) throw new Error('Failed');
    showToast('Ad created!', 'success');
    e.target.reset();
    loadAdminAds();
  } catch {
    showToast('Failed to create ad', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Ad';
  }
}

async function loadAdminAds() {
  const el = document.getElementById('adminAdsList');
  if (!el) return;
  try {
    const res = await fetch('/api/admin/ads', { headers: adminHeaders() });
    const ads = await res.json();
    el.innerHTML = ads.length ? ads.map(ad => `
      <div class="admin-ad-card">
        ${ad.media_type === 'image' ? `<img src="${ad.media_url}" class="admin-ad-media" alt="">` : `<video src="${ad.media_url}" class="admin-ad-media" controls></video>`}
        <div class="admin-ad-body">
          <div class="admin-ad-caption">${ad.caption || 'No caption'}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${ad.username ? `→ @${ad.username}` : '→ All users'} · ${new Date(ad.created_at).toLocaleDateString()} · ${ad.active ? '🟢 Active' : '🔴 Inactive'}</div>
          <div class="admin-ad-actions">
            <button class="action-btn ${ad.active ? 'action-reject' : 'action-approve'}" onclick="toggleAd(${ad.id}, ${ad.active})">${ad.active ? 'Deactivate' : 'Activate'}</button>
            <button class="action-btn action-reject" onclick="deleteAd(${ad.id})">Delete</button>
          </div>
        </div>
      </div>`).join('')
      : `<div style="color:var(--text-secondary);padding:20px;text-align:center;">No ads yet</div>`;
  } catch {}
}

async function toggleAd(id, active) {
  await fetch(`/api/admin/ads/${id}`, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ active: !active }) });
  loadAdminAds();
}

async function deleteAd(id) {
  if (!confirm('Delete this ad?')) return;
  await fetch(`/api/admin/ads/${id}`, { method: 'DELETE', headers: adminHeaders() });
  loadAdminAds();
  showToast('Ad deleted', 'success');
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

async function loadMessageThreads() {
  const el = document.getElementById('messageThreads');
  if (!el) return;
  try {
    const res = await fetch('/api/admin/messages', { headers: adminHeaders() });
    const threads = await res.json();
    el.innerHTML = threads.length ? threads.map(t => `
      <button class="message-thread-btn" onclick="openChatModal(${t.id}, '${t.full_name}', '@${t.username}')">
        <div class="thread-avatar">${(t.full_name || 'U').charAt(0).toUpperCase()}</div>
        <div class="thread-info">
          <div class="thread-name">${t.full_name} <span style="font-size:11px;color:var(--text-secondary);">@${t.username}</span></div>
          <div class="thread-preview">${t.last_message || 'No messages'}</div>
        </div>
        <div style="font-size:11px;color:var(--text-secondary);flex-shrink:0;">${t.last_at ? new Date(t.last_at).toLocaleDateString() : ''}</div>
      </button>`).join('')
      : `<div style="color:var(--text-secondary);padding:40px;text-align:center;">No message threads</div>`;
  } catch {}
}

async function openChatModal(userId, name, username) {
  currentChatUserId = userId;
  currentChatUsername = name;
  document.getElementById('chatModalUser').textContent = name + ' ' + username;
  document.getElementById('messageThreads').style.display = 'none';
  document.getElementById('chatModal').style.display = 'block';
  await loadAdminChat();
}

function closeChatModal() {
  document.getElementById('chatModal').style.display = 'none';
  document.getElementById('messageThreads').style.display = 'block';
  currentChatUserId = null;
}

async function loadAdminChat() {
  const el = document.getElementById('adminChatMsgs');
  try {
    const res = await fetch(`/api/admin/messages/${currentChatUserId}`, { headers: adminHeaders() });
    const msgs = await res.json();
    el.innerHTML = msgs.map(m => `
      <div class="admin-chat-bubble ${m.sender === 'user' ? 'user-msg' : 'admin-msg'}">
        ${m.message}
        <div class="chat-time" style="font-size:10px;opacity:0.6;margin-top:3px;">${formatTime(m.created_at)}</div>
      </div>`).join('');
    el.scrollTop = el.scrollHeight;
  } catch {}
}

async function sendAdminReply() {
  const input = document.getElementById('adminChatInput');
  const message = input.value.trim();
  if (!message || !currentChatUserId) return;
  input.value = '';
  try {
    const res = await fetch(`/api/admin/messages/${currentChatUserId}`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ message })
    });
    if (!res.ok) throw new Error('Failed');
    loadAdminChat();
  } catch {
    showToast('Failed to send', 'error');
  }
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    initAdminPanel();
  }
});
