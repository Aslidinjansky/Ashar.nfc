const tokenKey = 'ashar_admin_token';

const loginSection = document.getElementById('admin-login');
const dashboardSection = document.getElementById('admin-dashboard');
const loginForm = document.getElementById('admin-login-form');
const profileForm = document.getElementById('admin-profile-form');
const loginStatus = document.getElementById('admin-login-status');
const profileStatus = document.getElementById('admin-profile-status');
const logoutButton = document.getElementById('admin-logout');

const socialFields = ['whatsapp', 'telegram', 'linkedin', 'instagram'];

function setStatus(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('admin-status--error', isError);
}

function setView(isAuthenticated) {
  if (!loginSection || !dashboardSection) return;
  loginSection.classList.toggle('admin-card--hidden', isAuthenticated);
  dashboardSection.classList.toggle('admin-card--hidden', !isAuthenticated);
}

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setToken(token) {
  if (!token) {
    localStorage.removeItem(tokenKey);
  } else {
    localStorage.setItem(tokenKey, token);
  }
}

async function fetchProfile() {
  const token = getToken();
  if (!token) return null;
  const response = await fetch('/api/admin/profile', {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    setToken(null);
    return null;
  }

  return response.json();
}

function fillProfileForm(profile) {
  profileForm.fullName.value = profile.fullName || '';
  profileForm.jobTitle.value = profile.jobTitle || '';
  profileForm.company.value = profile.company || '';
  profileForm.bio.value = profile.bio || '';

  socialFields.forEach((field) => {
    const match = profile.socialLinks?.find((link) => {
      if (typeof link?.type !== 'string') return false;
      return link.type.toLowerCase() === field;
    });
    profileForm[field].value = match?.url || '';
  });
}

function collectProfilePayload() {
  const socialLinks = socialFields
    .map((field) => ({
      type: field,
      url: profileForm[field].value.trim(),
    }))
    .filter((link) => link.url);

  return {
    fullName: profileForm.fullName.value.trim(),
    jobTitle: profileForm.jobTitle.value.trim(),
    company: profileForm.company.value.trim(),
    bio: profileForm.bio.value.trim(),
    socialLinks,
  };
}

async function initializeDashboard() {
  const profile = await fetchProfile();
  if (profile) {
    setView(true);
    fillProfileForm(profile);
  } else {
    setView(false);
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(loginStatus, 'Signing in...');

    const payload = {
      username: loginForm.username.value.trim(),
      password: loginForm.password.value,
    };

    try {
      const response = await fetch('/api/auth/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(loginStatus, data.error || 'Unable to sign in.', true);
        return;
      }

      setToken(data.token);
      setStatus(loginStatus, '');
      await initializeDashboard();
    } catch (error) {
      setStatus(loginStatus, 'Unable to reach the server.', true);
    }
  });
}

if (profileForm) {
  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus(profileStatus, 'Saving updates...');

    const token = getToken();
    const payload = collectProfilePayload();

    try {
      const response = await fetch('/api/admin/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        setStatus(profileStatus, data.error || 'Unable to save updates.', true);
        return;
      }

      setStatus(profileStatus, 'Profile updated.');
    } catch (error) {
      setStatus(profileStatus, 'Unable to reach the server.', true);
    }
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    setToken(null);
    setStatus(profileStatus, '');
    setView(false);
  });
}

initializeDashboard();
