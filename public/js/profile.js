const saveButton = document.getElementById('save-contact');
const nameEl = document.getElementById('profile-name');
const roleEl = document.getElementById('profile-role');
const bioEl = document.getElementById('profile-bio');
const avatarInitialsEl = document.getElementById('profile-avatar-initials');
const socialGrid = document.getElementById('profile-social-grid');

const socialIconMap = {
  whatsapp: 'WA',
  telegram: 'TG',
  linkedin: 'in',
  instagram: 'IG',
  facebook: 'FB',
  youtube: 'YT',
  x: 'X',
  twitter: 'X',
};

let currentProfile = {
  fullName: 'Ashar NFC',
  jobTitle: '',
  company: '',
  bio: '',
  socialLinks: [],
};

function getInitials(name) {
  if (!name) return 'AN';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function formatRole(jobTitle, company) {
  if (jobTitle && company) return `${jobTitle} · ${company}`;
  return jobTitle || company || '';
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

function renderProfile(profile) {
  const roleText = formatRole(profile.jobTitle, profile.company);
  nameEl.textContent = profile.fullName || 'Ashar NFC';
  avatarInitialsEl.textContent = getInitials(profile.fullName || 'Ashar NFC');
  roleEl.textContent = roleText;
  roleEl.style.display = roleText ? 'block' : 'none';
  bioEl.textContent = profile.bio || '';
  bioEl.style.display = profile.bio ? 'block' : 'none';

  socialGrid.innerHTML = '';
  if (!profile.socialLinks.length) {
    const empty = document.createElement('p');
    empty.className = 'profile-social__empty';
    empty.textContent = 'No social links yet.';
    socialGrid.appendChild(empty);
    return;
  }

  profile.socialLinks.forEach((link) => {
    if (!link?.url) return;
    const type = (link.type || 'link').toLowerCase();
    const anchor = document.createElement('a');
    anchor.className = 'social-link';
    anchor.href = normalizeUrl(link.url);
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';

    const icon = document.createElement('span');
    icon.className = 'social-icon';
    icon.textContent = socialIconMap[type] || type.slice(0, 2).toUpperCase();

    const text = document.createElement('span');
    text.className = 'social-text';
    text.textContent = type.charAt(0).toUpperCase() + type.slice(1);

    anchor.append(icon, text);
    socialGrid.appendChild(anchor);
  });
}

async function loadProfile() {
  try {
    const response = await fetch('/api/profile');
    if (!response.ok) return;
    const data = await response.json();
    currentProfile = {
      fullName: data.fullName || 'Ashar NFC',
      jobTitle: data.jobTitle || '',
      company: data.company || '',
      bio: data.bio || '',
      socialLinks: Array.isArray(data.socialLinks) ? data.socialLinks : [],
    };
    renderProfile(currentProfile);
  } catch (error) {
    console.error('Failed to load profile', error);
  }
}

if (saveButton) {
  saveButton.addEventListener('click', () => {
    const vcardLines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${currentProfile.fullName || 'Ashar NFC'}`,
    ];

    if (currentProfile.company) vcardLines.push(`ORG:${currentProfile.company}`);
    if (currentProfile.jobTitle) vcardLines.push(`TITLE:${currentProfile.jobTitle}`);
    vcardLines.push('END:VCARD');

    const blob = new Blob([vcardLines.join('\n')], { type: 'text/vcard' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'Ashar-Contact.vcf';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

loadProfile();
