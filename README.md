# Wrestling Trainee Character Manager — real backend setup

This turns the prototype (which fakes a backend using the artifact's built-in
storage) into a real app: Firebase for auth/data/files, Netlify for hosting
and the one privileged serverless action.

## What changes from the prototype

| Prototype | Real version |
|---|---|
| `window.storage` (fake, shared with anyone who opens the artifact) | Firestore, access controlled by security rules |
| Hand-rolled password hash | Firebase Authentication |
| Login by username | Login by email (simpler with Firebase Auth; keep username as a display field) |
| Photo/theme song as base64, theme song split into chunks | Real file upload to Firebase Storage, a URL stored on the profile |
| "Admin creates trainer account" done directly from the browser | Done via a Netlify function using the Firebase Admin SDK, so a browser can never grant itself a role |

## 1. Create the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) → **Add project**.
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (start in production mode — the rules file below handles access).
4. **Build → Storage → Get started** (also production mode).
5. **Project settings → General → Your apps → Add app → Web**. Copy the `firebaseConfig` object into `firebase-client.js`.
6. **Project settings → Service accounts → Generate new private key.** This downloads a JSON file — you'll paste its contents into a Netlify environment variable, never into the frontend.

## 2. Deploy the security rules

Install the Firebase CLI once: `npm install -g firebase-tools`, then from this folder:

```bash
firebase login
firebase init firestore storage   # point it at this project, keep the existing rules files
firebase deploy --only firestore:rules,storage:rules
```

This publishes `firestore.rules` and `storage.rules`, which are what actually
enforce "a trainee only sees their own profile" and "trainers/admins see
everyone's" — not the app's UI logic.

## 3. Wire up the frontend

1. Add Firebase to `index.html`: change the existing `<script>` tag that
   wraps the app's logic to `<script type="module">`, and add
   `<script type="module" src="firebase-client.js"></script>` above it.
2. Replace the old helpers:
   - `dbGet('users:'+u, true)` → `fsGet('users', uid)`
   - `dbSet('users:'+u, obj, true)` → `fsSet('users', uid, obj)`
   - `dbList('profiles:', true)` → `fsListAll('profiles')`
   - `dbDelete(...)` → `fsDelete(...)`
   - `simpleHash` / manual login+register → `login()` / `registerTrainee()` from `firebase-client.js`
   - photo `compressImage()` + base64 storage → `uploadPhoto(uid, file)`, store the returned URL as `profile.photoUrl`
   - theme song chunking (`storeThemeSongChunks` etc.) → `uploadThemeSong(uid, file)`, store the returned URL as `profile.themeSongUrl`, and just render `<audio src="...">` directly — no more reassembly needed
3. Everywhere the app used `session.username` as the identity key, switch to
   `auth.currentUser.uid`. Keep `username` as a field on the `users` doc for
   display, not as the lookup key.
4. Trainee self-registration becomes two calls: `registerTrainee(email, password)`,
   then `fsSet('users', user.uid, { username, email, phone, social, role: 'trainee', createdAt: Date.now() })`.
5. Admin creating a trainer/admin account becomes one call:
   `createStaffAccount({ email, password, username, phone, social, role })`.
   Note this hits the Netlify function, not Firestore directly.
6. Drive your top-level screen with `watchAuthState(user => { ... })` instead
   of the in-memory `session` variable, so a page refresh keeps the user logged in.

## 4. Set up Netlify

1. Push this project to a Git repo (GitHub/GitLab/Bitbucket).
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
   Build settings are already in `netlify.toml` (publish `.`, functions in `netlify/functions`).
3. **Site settings → Environment variables**, add:
   - `FIREBASE_SERVICE_ACCOUNT` — paste the *entire contents* of the service
     account JSON file from step 1, as one line.
4. Deploy. Netlify installs `firebase-admin` from `package.json` automatically
   for the function.

## 5. Try it

- Register a trainee → confirm they only ever see their own profile.
- Log in as the first admin (you'll need to create this one by hand: register
  a normal account, then manually edit its Firestore doc's `role` field to
  `"admin"` in the Firebase console — after that, all further admins/trainers
  go through the in-app flow).
- As admin, create a trainer account, log in as that trainer, confirm they
  can browse the roster but can't create accounts or edit trainee profiles.
- Upload a photo over 5MB and a theme song over 10MB — both should be
  rejected by the Storage rules even if the client-side check were bypassed.

## Costs

Firebase Auth, Firestore, and Storage all have generous free tiers (Spark
plan) that easily cover a training center's roster. Netlify's free tier
covers hosting and function calls at this scale too. Nothing here requires a
paid plan.
