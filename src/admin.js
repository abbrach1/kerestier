import './style.css';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, db, storage } from './firebase.js';
import { MIN_EXPIRY } from './config.js';

const $ = (id) => document.getElementById(id);
const gate = $('gate');
const app = $('app');
let rows = [];
let unsubscribe = null;

$('sign-in').addEventListener('click', () => {
  signInWithPopup(auth, new GoogleAuthProvider()).catch((err) => {
    if (err.code !== 'auth/popup-closed-by-user') $('gate-msg').textContent = "Couldn't sign in. Try again.";
  });
});
$('sign-out').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  $('who').hidden = !user;
  if (!user) {
    app.hidden = true;
    gate.hidden = false;
    return;
  }
  $('who-email').textContent = user.email;

  const q = query(collection(db, 'tripRegistrations'), orderBy('createdAt', 'desc'));
  unsubscribe = onSnapshot(q, (snap) => {
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    gate.hidden = true;
    app.hidden = false;
    render();
  }, (err) => {
    console.error(err);
    app.hidden = true;
    gate.hidden = false;
    $('gate-msg').textContent = err.code === 'permission-denied'
      ? `${user.email} doesn't have access. Ask the trip organizer to add you.`
      : "Couldn't load registrations. Refresh to try again.";
  });
});

// ---------- list ----------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fullName = (r) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ');
const expiresTooSoon = (r) => r.passportExpiry && r.passportExpiry < MIN_EXPIRY;

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '';
  return ts.toDate().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function visible() {
  const term = $('search').value.trim().toLowerCase();
  const filter = $('filter').value;
  return rows.filter((r) => {
    if (filter === 'expiring' && !expiresTooSoon(r)) return false;
    if (filter === 'photo' && r.method !== 'photo') return false;
    if (filter === 'matmid' && !r.matmidNumber) return false;
    if (!term) return true;
    return [fullName(r), r.email, r.phone, r.passportNumber, r.matmidNumber]
      .some((v) => String(v || '').toLowerCase().includes(term));
  });
}

function render() {
  const list = visible();
  const soon = rows.filter(expiresTooSoon).length;
  const photo = rows.filter((r) => r.method === 'photo').length;
  $('count').textContent = rows.length;
  $('summary').textContent = [
    soon && `${soon} passport${soon === 1 ? '' : 's'} expiring too soon`,
    photo && `${photo} sent a photo only`,
  ].filter(Boolean).join(' · ');

  $('empty').hidden = list.length > 0;
  $('empty').textContent = rows.length ? 'Nothing matches.' : 'No registrations yet.';
  $('rows').innerHTML = list.map((r) => `
    <tr data-id="${esc(r.id)}" tabindex="0">
      <td class="strong">${esc(fullName(r))}<span class="cell-sub">${esc(r.email)}</span></td>
      <td>${r.method === 'photo' ? '<span class="tag">Photo</span>' : esc(r.nationality)}</td>
      <td class="mono">${esc(r.passportNumber) || '<span class="muted">—</span>'}</td>
      <td>${r.passportExpiry ? `<span class="${expiresTooSoon(r) ? 'bad' : ''}">${esc(fmtDate(r.passportExpiry))}</span>` : '<span class="muted">—</span>'}</td>
      <td class="mono">${esc(r.matmidNumber) || '<span class="muted">—</span>'}</td>
      <td class="muted">${esc(fmtTime(r.createdAt))}</td>
    </tr>`).join('');
}

$('search').addEventListener('input', render);
$('filter').addEventListener('change', render);
$('rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr) openDetails(tr.dataset.id);
});
$('rows').addEventListener('keydown', (e) => {
  const tr = e.target.closest('tr[data-id]');
  if (tr && e.key === 'Enter') openDetails(tr.dataset.id);
});

// ---------- details drawer ----------

const drawer = $('drawer');

async function openDetails(id) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  $('d-name').textContent = fullName(r);

  const fields = [
    ['Given name(s)', r.firstName],
    ['Middle name', r.middleName],
    ['Surname', r.lastName],
    ['Email', r.email],
    ['Phone', r.phone],
    ['Nationality', r.nationality],
    ['Passport #', r.passportNumber],
    ['Expires', r.passportExpiry ? fmtDate(r.passportExpiry) + (expiresTooSoon(r) ? ' (too soon, must be valid through Jul 17, 2027)' : '') : ''],
    ['El Al Matmid #', r.matmidNumber],
    ['Submitted', fmtTime(r.createdAt)],
  ];
  $('d-fields').innerHTML = fields.map(([k, v]) => `
    <div>
      <dt>${esc(k)}</dt>
      <dd>${v ? `<span>${esc(v)}</span> <button type="button" class="copy" data-copy="${esc(v)}">Copy</button>` : '<span class="muted">—</span>'}</dd>
    </div>`).join('');

  const box = $('d-passport');
  box.innerHTML = '';
  if (r.passportFilePath) {
    box.innerHTML = '<p class="muted">Loading passport…</p>';
    try {
      const url = await getDownloadURL(ref(storage, r.passportFilePath));
      box.innerHTML = /\.pdf$/i.test(r.passportFilePath)
        ? `<a href="${esc(url)}" target="_blank" rel="noopener">Open passport PDF</a>`
        : `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Passport of ${esc(fullName(r))}" /></a>
           <p class="muted">Click the image to open it full size.${/\.hei[cf]$/i.test(r.passportFilePath) ? ' HEIC files may not show in Chrome. Open the link in Safari or download it.' : ''}</p>`;
    } catch (err) {
      console.error(err);
      box.innerHTML = '<p class="bad">Couldn\'t load the passport file.</p>';
    }
  }

  drawer.hidden = false;
  document.body.style.overflow = 'hidden';
  $('d-close').focus();
}

function closeDetails() {
  drawer.hidden = true;
  document.body.style.overflow = '';
}
$('d-close').addEventListener('click', closeDetails);
drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDetails(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden) closeDetails(); });

$('d-fields').addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  await navigator.clipboard.writeText(btn.dataset.copy);
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
});

// ---------- CSV ----------

$('export').addEventListener('click', () => {
  const cols = [
    ['Given name(s)', 'firstName'], ['Middle name', 'middleName'], ['Surname', 'lastName'],
    ['Email', 'email'], ['Phone', 'phone'], ['Nationality', 'nationality'],
    ['Passport #', 'passportNumber'], ['Passport expiry', 'passportExpiry'],
    ['El Al Matmid #', 'matmidNumber'], ['Sent as', 'method'],
    ['Submitted', (r) => (r.createdAt ? r.createdAt.toDate().toISOString() : '')],
  ];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [cols.map(([h]) => cell(h)).join(',')]
    .concat(visible().map((r) => cols.map(([, k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ytc-trip-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});
