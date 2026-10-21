import './style.css';
import { COMMON, COUNTRIES } from './countries.js';
import { TRIP, MIN_EXPIRY } from './config.js';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const form = document.getElementById('reg');
const submitBtn = document.getElementById('submit');
const formError = document.getElementById('form-error');
const expiryMsg = document.getElementById('expiry-msg');
const preview = document.getElementById('preview');

// Nationality dropdown: common countries first, then everything.
const select = form.nationality;
select.innerHTML =
  '<option value="">Select a country</option>' +
  `<optgroup label="Most common">${COMMON.map(opt).join('')}</optgroup>` +
  `<optgroup label="All countries">${COUNTRIES.map(opt).join('')}</optgroup>`;
function opt(c) { return `<option>${c}</option>`; }

function prettyDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function checkExpiry() {
  const v = form.passportExpiry.value;
  if (!v) { expiryMsg.hidden = true; return true; }
  const ok = v >= MIN_EXPIRY;
  expiryMsg.hidden = false;
  expiryMsg.className = 'field-msg ' + (ok ? 'is-good' : 'is-bad');
  expiryMsg.textContent = ok
    ? 'Good, your passport is valid long enough for this trip.'
    : `Your passport expires ${prettyDate(v)}, which is too soon. You'll need to renew it before we can book your flight. You can still submit this form, but please start the renewal now.`;
  form.passportExpiry.classList.toggle('invalid', !ok);
  return ok;
}
form.passportExpiry.addEventListener('change', checkExpiry);

// Clear a field's error outline as soon as the traveler edits it.
form.addEventListener('input', (e) => {
  if (e.target.name !== 'passportExpiry') e.target.classList.remove('invalid');
});

function method() { return form.method.value; }
for (const radio of form.method) {
  radio.addEventListener('change', () => {
    for (const panel of form.querySelectorAll('.panel')) panel.hidden = panel.dataset.method !== method();
    formError.hidden = true;
  });
}

// Firebase is loaded on first use so the form itself always works, even if it can't start.
let firebase;
function loadFirebase() {
  firebase ||= Promise.all([import('firebase/firestore'), import('firebase/storage'), import('./firebase.js')])
    .then(([firestore, storage, app]) => ({ ...firestore, ...storage, db: app.db, storage: app.storage }));
  return firebase;
}

// One id per visit, so the passport photo can upload as soon as it's picked,
// before the traveler presses Submit.
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const submissionId = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => ID_CHARS[b % 62]).join('');

let upload = null; // { file, name, path, percent, promise, failed }

function startUpload(file) {
  const { contentType, ext } = fileInfo(file);
  const name = `passport-${Date.now()}.${ext}`;
  const current = { file, name, path: `passports/${submissionId}/${name}`, percent: 0 };
  upload = current;
  showUploadStatus('progress', 0);
  current.promise = loadFirebase().then(({ ref, uploadBytesResumable, storage }) => new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, current.path), file, { contentType });
    task.on('state_changed', (snap) => {
      current.percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      if (upload === current) showUploadStatus('progress', current.percent);
    }, reject, resolve);
  })).then(() => {
    if (upload === current) showUploadStatus('done');
  }, (err) => {
    console.error(err);
    current.failed = true;
    if (upload === current) showUploadStatus('failed');
    throw err;
  });
  current.promise.catch(() => {}); // handled on submit
}

function showUploadStatus(state, percent = 0) {
  let box = preview.querySelector('.upload-status');
  if (!box) {
    box = document.createElement('div');
    box.className = 'upload-status';
    box.innerHTML = '<div class="bar"><span></span></div><p></p>';
    preview.append(box);
  }
  box.dataset.state = state;
  box.querySelector('.bar span').style.width = (state === 'done' ? 100 : percent) + '%';
  const msg = box.querySelector('p');
  if (state === 'progress') msg.textContent = `Uploading… ${percent}%. You can keep filling out the form.`;
  if (state === 'done') msg.textContent = 'Uploaded.';
  if (state === 'failed') {
    msg.innerHTML = 'Upload failed. Check your connection and <button type="button" class="link" id="retry-upload">try again</button>.';
    msg.querySelector('#retry-upload').addEventListener('click', () => startUpload(upload.file));
  }
}

form.passportFile.addEventListener('change', () => {
  const file = form.passportFile.files[0];
  upload = null;
  preview.innerHTML = '';
  preview.hidden = !file;
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    preview.innerHTML = '<p>That file is over 10 MB. Try a smaller photo or a screenshot of it.</p>';
    return;
  }
  if (!/^image\/|^application\/pdf$/.test(fileInfo(file).contentType)) {
    preview.innerHTML = '<p>That file type isn\'t supported. Please choose a photo or a PDF.</p>';
    return;
  }
  if (file.type.startsWith('image/') && !/heic|heif/i.test(file.type)) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.alt = 'Passport photo preview';
    preview.append(img);
  } else {
    const p = document.createElement('p');
    p.textContent = `Attached: ${file.name}`;
    preview.append(p);
  }
  startUpload(file);
});

// Date of birth as YYYY-MM-DD, or '' if it isn't a real past date.
function birthDate() {
  const m = form.bdayMonth.value;
  const d = form.bdayDay.value.trim().padStart(2, '0');
  const y = form.bdayYear.value.trim();
  if (!m || !/^\d{2}$/.test(d) || !/^\d{4}$/.test(y)) return '';
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return '';
  if (Number(y) < 1900 || date > new Date()) return '';
  return `${y}-${m}-${d}`;
}

function fileInfo(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const byExt = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', pdf: 'application/pdf' };
  const contentType = file.type || byExt[ext] || '';
  return { contentType, ext: /^[a-z0-9]{2,5}$/.test(ext) ? ext : 'jpg' };
}

function validate() {
  const f = form;
  const problems = [];
  const mark = (el, bad) => el.classList.toggle('invalid', bad);

  const manual = method() === 'manual';
  for (const el of [f.firstName, f.lastName, f.email, f.phone]) mark(el, !el.value.trim());
  for (const el of [f.nationality, f.passportNumber, f.passportExpiry]) mark(el, manual && !el.value.trim());
  if (!f.firstName.value.trim() || !f.lastName.value.trim()) problems.push('your name as it appears on your passport');
  const dobBad = !birthDate();
  for (const el of [f.bdayMonth, f.bdayDay, f.bdayYear]) mark(el, dobBad);
  if (dobBad) problems.push('a valid date of birth');
  if (!/^\S+@\S+\.\S+$/.test(f.email.value.trim())) { problems.push('a valid email'); mark(f.email, true); }
  if (f.phone.value.replace(/\D/g, '').length < 7) { problems.push('a phone number'); mark(f.phone, true); }

  if (manual) {
    if (!f.nationality.value) problems.push('your nationality');
    const pn = f.passportNumber.value.replace(/\s/g, '');
    if (!/^[A-Za-z0-9]{5,20}$/.test(pn)) { problems.push('a valid passport number (letters and numbers only)'); mark(f.passportNumber, true); }
    if (!f.passportExpiry.value) problems.push('your passport expiration date');
  } else {
    const file = f.passportFile.files[0];
    if (!file) problems.push('a photo of your passport (or switch to "Type them in")');
    else if (file.size > MAX_FILE_BYTES) problems.push('a passport photo under 10 MB');
    else if (!/^image\/|^application\/pdf$/.test(fileInfo(file).contentType)) problems.push('an image or PDF of your passport');
  }

  const matmid = f.matmidNumber.value.replace(/\s/g, '');
  if (matmid && !/^\d{5,12}$/.test(matmid)) { problems.push('a Matmid number with digits only (or leave it blank)'); mark(f.matmidNumber, true); }
  else mark(f.matmidNumber, false);

  if (!f.confirm.checked) problems.push('the box confirming your details match your passport');
  return problems;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError.hidden = true;
  if (method() === 'manual') checkExpiry();

  const problems = validate();
  if (problems.length) {
    formError.textContent = 'Please add ' + problems.join(', ') + '.';
    formError.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  const label = submitBtn.textContent;
  try {
    const { doc, setDoc, serverTimestamp, db } = await loadFirebase();
    const docRef = doc(db, 'tripRegistrations', submissionId);
    const manual = method() === 'manual';
    let path = '';
    let name = '';

    if (!manual) {
      const file = form.passportFile.files[0];
      if (!upload || upload.file !== file || upload.failed) startUpload(file);
      const current = upload;
      // Usually finished already; if not, show progress on the button while it completes.
      const tick = setInterval(() => { submitBtn.textContent = `Finishing upload… ${current.percent}%`; }, 200);
      try {
        await current.promise;
      } finally {
        clearInterval(tick);
      }
      ({ name, path } = current);
    }

    submitBtn.textContent = 'Saving…';
    await setDoc(docRef, {
      firstName: form.firstName.value.trim(),
      middleName: form.middleName.value.trim(),
      lastName: form.lastName.value.trim(),
      birthDate: birthDate(),
      email: form.email.value.trim().toLowerCase(),
      phone: form.phone.value.trim(),
      method: manual ? 'manual' : 'photo',
      nationality: manual ? form.nationality.value : '',
      passportNumber: manual ? form.passportNumber.value.replace(/\s/g, '').toUpperCase() : '',
      passportExpiry: manual ? form.passportExpiry.value : '',
      matmidNumber: form.matmidNumber.value.replace(/\s/g, ''),
      passportFilePath: path,
      passportFileName: name,
      trip: TRIP,
      createdAt: serverTimestamp(),
    });

    // Email the organizers. Never block the traveler on this.
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: submissionId }),
      keepalive: true,
    }).catch(() => {});

    form.hidden = true;
    document.getElementById('done').hidden = false;
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.error(err);
    formError.textContent = "Something went wrong and your registration wasn't saved. Check your connection and try again.";
    formError.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = label;
  }
});
