# YTC Trip Registration

Passport-detail collection form for the Yeshiva Toras Chaim winter trip (departing Jan 17, 2027).
Collects legal name, contact info, nationality, passport number and expiration, a photo of the
passport page, and an optional El Al Matmid number. It warns anyone whose passport expires
before **July 17, 2027** (six months after departure).

Built with Vite and plain JS. Data goes to Firebase (Firestore and Storage), and the site is hosted on Vercel.

## Logo

Put the YTC seal at `public/logo.png` (a square PNG works best). Until you do, the header shows a simple placeholder (`public/logo.svg`).

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
   Nobody can read, change or delete anything from the browser.

## Viewing submissions

- Firestore → `tripRegistrations` collection: one document per traveler.
- Storage → `passports/<submission id>/passport.<ext>`: the passport image for that document.

## Local dev

```
cp .env.example .env.local   # fill in the Firebase values
npm install
npm run dev
```

## Deploy to Vercel

1. Import this repo in Vercel. It detects Vite automatically (build `npm run build`, output `dist`).
2. In Project → Settings → Environment Variables, add every `VITE_FIREBASE_*` key from `.env.example`.
3. Deploy.

## Changing the trip

The departure and cutoff dates are set in `src/main.js` (`MIN_EXPIRY`) and in the copy in `index.html`.
