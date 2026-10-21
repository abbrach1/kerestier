import './style.css';
import { COMMON, COUNTRIES } from './countries.js';
import { TRIP, MIN_EXPIRY } from './config.js';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// Must match storage.rules.
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

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

// Phone photos are often 3–12 MB. Resize to a size that's still easy to read
// (2400px on the long side) so uploads are quick on mobile data.
const MAX_SIDE = 2400;
async function shrinkImage(file) {
  const { contentType } = fileInfo(file);
  if (!contentType.startsWith('image/')) return null;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && contentType === 'image/jpeg' && file.size < 1.5 * 1024 * 1024) return null;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return blob && blob.size < file.size ? blob : null;
  } catch {
    return null; // e.g. HEIC on browsers that can't decode it; upload the original
  }
}

function startUpload(file) {
  const current = { file, name: '', path: '', percent: 0 };
  upload = current;
  showUploadStatus('progress', 0);
  current.promise = shrinkImage(file).then((small) => {
    if (small && upload === current) showPreview(small);
    const data = small || file;
    const { contentType, ext } = small ? { contentType: 'image/jpeg', ext: 'jpg' } : fileInfo(file);
    if (data.size > MAX_FILE_BYTES) throw new Error('too-big');
    current.name = `passport-${Date.now()}.${ext}`;
    current.path = `passports/${submissionId}/${current.name}`;
    return loadFirebase().then((fb) => ({ fb, data, contentType }));
  }).then(({ fb: { ref, uploadBytesResumable, storage }, data, contentType }) => new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, current.path), data, { contentType });
    task.on('state_changed', (snap) => {
      current.percent = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      if (upload === current) showUploadStatus('progress', current.percent);
    }, reject, resolve);
  })).then(() => {
    if (upload === current) showUploadStatus('done');
  }, (err) => {
    console.error(err);
    current.failed = true;
    if (upload === current) showUploadStatus(err.message === 'too-big' ? 'too-big' : 'failed');
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
  if (state === 'too-big') msg.textContent = 'That file is over 10 MB. Try a photo instead, or a smaller PDF.';
  if (state === 'failed') {
    msg.innerHTML = 'Upload failed. Check your connection and <button type="button" class="link" id="retry-upload">try again</button>.';
    msg.querySelector('#retry-upload').addEventListener('click', () => startUpload(upload.file));
  }
}

function showPreview(blobOrFile) {
  let img = preview.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    img.alt = 'Passport photo preview';
    preview.prepend(img);
    preview.querySelector('.attached')?.remove();
  }
  img.src = URL.createObjectURL(blobOrFile);
}

form.passportFile.addEventListener('change', () => {
  const file = form.passportFile.files[0];
  upload = null;
  preview.innerHTML = '';
  preview.hidden = !file;
  document.getElementById('picker-text').textContent = file ? 'Choose a different photo or file' : 'Take a photo or choose a file';
  if (!file) return;
  const { contentType } = fileInfo(file);
  if (!ALLOWED_TYPES.test(contentType)) {
    preview.innerHTML = '<p>That file type isn\'t supported. Please choose a photo or a PDF.</p>';
    return;
  }
  // Photos get resized before upload, so only PDFs need the size check up front.
  if (!contentType.startsWith('image/') && file.size > MAX_FILE_BYTES) {
    preview.innerHTML = '<p>That PDF is over 10 MB. Try taking a photo of the page instead.</p>';
    return;
  }
  if (contentType.startsWith('image/') && !/heic|heif/.test(contentType)) {
    showPreview(file);
  } else {
    const p = document.createElement('p');
    p.className = 'attached';
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
  for (const el of [f.firstName, f.lastName]) mark(el, !el.value.trim());
  for (const el of [f.nationality, f.passportNumber, f.passportIssued, f.passportExpiry]) mark(el, manual && !el.value.trim());
  if (!f.firstName.value.trim() || !f.lastName.value.trim()) problems.push('your name as it appears on your passport');

  if (manual) {
    const dobBad = !birthDate();
    for (const el of [f.bdayMonth, f.bdayDay, f.bdayYear]) mark(el, dobBad);
    if (dobBad) problems.push('a valid date of birth');
    if (!f.nationality.value) problems.push('your nationality');
    const pn = f.passportNumber.value.replace(/\s/g, '');
    if (!/^[A-Za-z0-9]{5,20}$/.test(pn)) { problems.push('a valid passport number (letters and numbers only)'); mark(f.passportNumber, true); }
    const issued = f.passportIssued.value;
    const today = new Date().toISOString().slice(0, 10);
    if (!issued) problems.push('your passport issue date');
    else if (issued > today || (f.passportExpiry.value && issued >= f.passportExpiry.value)) {
      problems.push('a passport issue date that is in the past and before the expiration date');
      mark(f.passportIssued, true);
    }
    if (!f.passportExpiry.value) problems.push('your passport expiration date');
  } else {
    const file = f.passportFile.files[0];
    if (!file) problems.push('a photo of your passport (or switch to "Type them in")');
    else if (!fileInfo(file).contentType.startsWith('image/') && file.size > MAX_FILE_BYTES) problems.push('a passport PDF under 10 MB');
    else if (!ALLOWED_TYPES.test(fileInfo(file).contentType)) problems.push('an image or PDF of your passport');
  }


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
      birthDate: manual ? birthDate() : '',
      method: manual ? 'manual' : 'photo',
      nationality: manual ? form.nationality.value : '',
      passportNumber: manual ? form.passportNumber.value.replace(/\s/g, '').toUpperCase() : '',
      passportIssued: manual ? form.passportIssued.value : '',
      passportExpiry: manual ? form.passportExpiry.value : '',
      matmidNumber: form.matmidNumber.value.trim(),
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
