# YTC Kerestir Trip Registration

Passport-detail collection form for the Kerestir trip from the Yeshiva Toras Chaim campaign (departing Jan 17, 2027).
Collects legal name and contact info, then either a photo of the passport page **or** typed
passport details (nationality, number, expiration), plus an optional El Al Matmid number. It warns anyone whose passport expires
before **July 17, 2027** (six months after departure).

Built with Vite and plain JS. Data goes to Firebase (Firestore and Storage), and the site is hosted on Vercel.

## Logo

The YTC seal is `public/logo.png`. Replace that file to change it everywhere.

## Firebase setup

1. Create a project at https://console.firebase.google.com.
2. Enable **Firestore Database** and **Storage**.
3. Add a **Web app** (Project settings → Your apps) and copy its config values.
4. Deploy the security rules in this repo:
   ```
   npm i -g firebase-tools
   firebase login
   firebase use --add          # pick your project
   firebase deploy --only firestore:rules,storage
   ```
   These rules let the public form **create** submissions and upload passport images.
   Only admins can read them, and nobody can change or delete anything from the browser.
5. Turn on **Authentication → Sign-in method → Google**, and add your Vercel domain under
   Authentication → Settings → Authorized domains.

## Admin page (`/admin`)

Sign in with Google to see every registration live. You can search, filter (expiring too soon,
photo only, has Matmid), open a traveler to see everything plus the passport image with copy
buttons, and export a CSV.

**Giving someone access:** in Firestore, create a collection called `admins` and add a document
whose **ID is their Google email address** (e.g. `rabbi@ytchaim.com`). It needs no fields.
Remove the document to revoke access.

## Email alerts (Resend)

Each new registration emails the addresses in `NOTIFY_TO`. The email has the traveler's name,
contact info, whether they sent a photo, their Matmid number and an expiry warning when needed.
Passport numbers are left out of email on purpose; open `/admin` for those.
It runs as a Vercel function (`api/notify.js`) and sends at most one email per registration.

1. Create a Resend account and verify your sending domain (e.g. ytchaim.com).
2. Add the server-only env vars from `.env.example` in Vercel: `RESEND_API_KEY`,
   `NOTIFY_FROM`, `NOTIFY_TO`, `FIREBASE_SERVICE_ACCOUNT` (and optionally `SITE_URL`).

## Local dev

```
cp .env.example .env.local   # fill in the Firebase values
npm install
npm run dev
```

## Deploy to Vercel

1. Import this repo in Vercel. It detects Vite automatically (build `npm run build`, output `dist`).
2. In Project → Settings → Environment Variables, add every key from `.env.example`.
3. Deploy.

## Changing the trip

The cutoff date is set in `src/config.js` and `api/notify.js` (`MIN_EXPIRY`). The copy in `index.html` mentions the dates too.
