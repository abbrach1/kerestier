import './style.css';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { ref, getDownloadURL, deleteObject } from 'firebase/storage';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { app as firebaseApp, db, storage } from './firebase.js';
import { MIN_EXPIRY } from './config.js';

const auth = getAuth(firebaseApp);
const $ = (id) => document.getElementById(id);
const gate = $('gate');
const app = $('app');
let rows = [];
let unsubscribe = null;

$('sign-in').addEventListener('click', async () => {
  // Always show Google's account chooser, so a wrong account can be swapped out.
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  if (auth.currentUser) await signOut(auth);
  signInWithPopup(auth, provider).catch((err) => {
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
    $('gate-msg').textContent = "Organizers only. Sign in with the Google account that's been given access.";
    $('sign-in').textContent = 'Sign in with Google';
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
    $('sign-in').textContent = 'Use a different account';
    if (err.code === 'permission-denied') {
      $('gate-msg').innerHTML = `<strong>${esc(user.email)}</strong> doesn't have access yet.
        To add it, go to Firebase → Firestore → <code>admins</code> collection and create a document
        whose <em>Document ID</em> is exactly <code>${esc(user.email.toLowerCase())}</code>.
        Then refresh this page.`;
    } else {
      $('gate-msg').textContent = "Couldn't load registrations. Refresh to try again.";
    }
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
    return [fullName(r), r.passportNumber, r.matmidNumber]
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
      <td class="strong">${esc(fullName(r))}</td>
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

let openId = null;

async function openDetails(id) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  openId = id;
  $('d-name').textContent = fullName(r);

  const fields = [
    ['First name', r.firstName],
    ['Middle name', r.middleName],
    ['Last name', r.lastName],
    ['Date of birth', r.birthDate ? fmtDate(r.birthDate) : ''],
    ['Nationality', r.nationality],
    ['Passport #', r.passportNumber],
    ['Issued', r.passportIssued ? fmtDate(r.passportIssued) : ''],
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
  openId = null;
  drawer.hidden = true;
  document.body.style.overflow = '';
}
$('d-close').addEventListener('click', closeDetails);
drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDetails(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer.hidden && !confirmDlg.open) closeDetails();
});

// ---------- delete ----------

const confirmDlg = $('confirm-delete');

$('d-delete').addEventListener('click', () => {
  const r = rows.find((x) => x.id === openId);
  if (!r) return;
  $('cd-body').textContent = `This permanently removes ${fullName(r)}'s details`
    + (r.passportFilePath ? ' and passport photo' : '') + ". It can't be undone.";
  $('cd-error').hidden = true;
  $('cd-confirm').disabled = false;
  $('cd-confirm').textContent = 'Delete';
  confirmDlg.showModal();
  $('cd-cancel').focus();
});

$('cd-confirm').addEventListener('click', async () => {
  const r = rows.find((x) => x.id === openId);
  if (!r) { confirmDlg.close(); return; }
  const btn = $('cd-confirm');
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  try {
    // Photo first, so a registration is never left pointing at nothing.
    if (r.passportFilePath) {
      await deleteObject(ref(storage, r.passportFilePath)).catch((err) => {
        if (err.code !== 'storage/object-not-found') throw err;
      });
    }
    await deleteDoc(doc(db, 'tripRegistrations', r.id));
    confirmDlg.close();
    closeDetails();
  } catch (err) {
    console.error(err);
    $('cd-error').textContent = "Couldn't delete it. Check your connection and try again.";
    $('cd-error').hidden = false;
    btn.disabled = false;
    btn.textContent = 'Delete';
  }
});

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
    ['First name', 'firstName'], ['Middle name', 'middleName'], ['Last name', 'lastName'],
    ['Date of birth', 'birthDate'],
    ['Nationality', 'nationality'],
    ['Passport #', 'passportNumber'], ['Passport issued', 'passportIssued'], ['Passport expiry', 'passportExpiry'],
    ['El Al Matmid #', 'matmidNumber'], ['Sent as', 'method'],
    ['Submitted', (r) => (r.createdAt ? r.createdAt.toDate().toISOString() : '')],
  ];
  // Neutralize spreadsheet formulas, e.g. a name typed as =HYPERLINK(...).
  const cell = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
    return `"${t.replace(/"/g, '""')}"`;
  };
  const lines = [cols.map(([h]) => cell(h)).join(',')]
    .concat(visible().map((r) => cols.map(([, k]) => cell(typeof k === 'function' ? k(r) : r[k])).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ytc-kerestir-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});
