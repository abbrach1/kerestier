// Vercel serverless function: emails the organizers about a new registration via Resend.
// The browser only sends the new document's id. We read the submission ourselves
// and record notifiedAt, so each registration triggers at most one email.
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const MIN_EXPIRY = '2027-07-17';

if (!getApps().length) {
  initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = getFirestore();

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const id = req.body?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(id)) return res.status(400).end();

  const docRef = db.collection('tripRegistrations').doc(id);
  let r;
  try {
    r = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists || snap.get('notifiedAt')) return null;
      tx.update(docRef, { notifiedAt: FieldValue.serverTimestamp() });
      return snap.data();
    });
  } catch (err) {
    console.error(err);
    return res.status(500).end();
  }
  if (!r) return res.status(204).end();

  const name = [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ');
  const tooSoon = r.passportExpiry && r.passportExpiry < MIN_EXPIRY;
  const adminUrl = `${process.env.SITE_URL || `https://${req.headers.host}`}/admin`;
  const rows = [
    ['Name', name],
    ['Passport', r.method === 'photo' ? 'Sent a photo' : `${r.nationality}, expires ${r.passportExpiry}`],
    ['El Al Matmid #', r.matmidNumber || '—'],
  ];

  // Passport numbers stay out of email on purpose; open the admin page for those.
  const html = `
    <div style="font-family:Georgia,serif;color:#2f2822;max-width:520px">
      <p style="font-size:18px;margin:0 0 14px">New Kerestir trip registration: <strong>${esc(name)}</strong></p>
      ${tooSoon ? `<p style="background:#f7ecd9;border-left:3px solid #c39553;padding:8px 12px;font-family:Arial,sans-serif;font-size:14px">Passport expires ${esc(r.passportExpiry)}, before the July 17, 2027 cutoff.</p>` : ''}
      <table style="font-family:Arial,sans-serif;font-size:14px;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td style="color:#776b60;padding:4px 16px 4px 0">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}
      </table>
      <p style="font-family:Arial,sans-serif;font-size:14px;margin-top:18px"><a href="${esc(adminUrl)}" style="color:#6e5d4e">View all registrations</a></p>
    </div>`;

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM,
      to: process.env.NOTIFY_TO.split(',').map((s) => s.trim()).filter(Boolean),
      subject: `Kerestir trip registration: ${name}${tooSoon ? ' (passport expires too soon)' : ''}`,
      html,
    }),
  });

  if (!send.ok) {
    console.error('Resend failed', send.status, await send.text());
    // Let a retry try again.
    await docRef.update({ notifiedAt: FieldValue.delete() }).catch(() => {});
    return res.status(502).end();
  }
  return res.status(204).end();
}
