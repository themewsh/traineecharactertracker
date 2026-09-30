// firebase-client.js
// Load this with <script type="module" src="firebase-client.js"></script>
// and swap the app's old window.storage-based helpers for these.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc, collection, getDocs,
  query, where
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

// From Firebase console > Project settings > Your apps > SDK config.
// These values are not secret -- they identify your project, access is
// controlled entirely by the security rules, not by hiding this config.
const firebaseConfig = {
  apiKey: "AIzaSyB3gnJa19LAgPdf2OHrP2EptNtdIw-Uy5g",
  authDomain: "trainee-character-manager.firebaseapp.com",
  projectId: "trainee-character-manager",
  storageBucket: "trainee-character-manager.firebasestorage.app",
  messagingSenderId: "387231643619",
  appId: "1:387231643619:web:12208ee24081cc482592d6",
  measurementId: "G-8P1E99YN64"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* ---------------- auth ---------------- */

// Trainee self-registration. Also call setDoc on users/{uid} with role:'trainee'
// right after this succeeds -- Firestore rules only allow role:'trainee' on
// client-side creates, so this is the one path open to the browser.
export async function registerTrainee(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user; // cred.user.uid is the new doc id to use everywhere
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logout() {
  await signOut(auth);
}

// Fires whenever auth state changes (load, login, logout). Use this instead
// of the old in-memory `session` variable to drive your top-level render.
export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

/* ---------------- firestore: users & profiles ----------------
   Same shape as the old dbGet/dbSet/dbDelete/dbList helpers, but backed by
   real collections instead of prefixed keys. Call with (collectionName, uid). */

export async function fsGet(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? snap.data() : null;
}

export async function fsSet(collectionName, id, data) {
  await setDoc(doc(db, collectionName, id), data, { merge: false });
}

export async function fsDelete(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
}

// Returns every document in a collection as [{id, ...data}], e.g. every
// trainee profile for the roster screen, or every account for the admin screen.
export async function fsListAll(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Returns every document in a top-level collection matching a simple where
// clause, e.g. every show a given trainee is booked on:
//   fsQuery('shows', 'participantUids', 'array-contains', uid)
export async function fsQuery(collectionName, field, op, value) {
  const q = query(collection(db, collectionName), where(field, op, value));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Generates a fresh document id in a top-level collection without writing
// anything yet -- use this to mint a showId before the first fsSet('shows', id, ...).
export function newId(collectionName) {
  return doc(collection(db, collectionName)).id;
}

/* ---------------- firestore: shows/{showId}/matches/{matchId} ----------------
   Matches live in a subcollection under their show, so they get their own
   small set of helpers rather than reusing the flat fsGet/fsSet above. */

export async function fsMatchesList(showId) {
  const snap = await getDocs(collection(db, 'shows', showId, 'matches'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function newMatchId(showId) {
  return doc(collection(db, 'shows', showId, 'matches')).id;
}

export async function fsMatchSet(showId, matchId, data) {
  await setDoc(doc(db, 'shows', showId, 'matches', matchId), data, { merge: false });
}

export async function fsMatchDelete(showId, matchId) {
  await deleteDoc(doc(db, 'shows', showId, 'matches', matchId));
}

// Deletes a show and every match underneath it -- Firestore doesn't cascade
// subcollection deletes on its own, so the client has to clean both up.
export async function deleteShowCascade(showId) {
  const matches = await fsMatchesList(showId);
  for (const m of matches) {
    await deleteDoc(doc(db, 'shows', showId, 'matches', m.id));
  }
  await deleteDoc(doc(db, 'shows', showId));
}

/* ---------------- storage: photo + theme song uploads ----------------
   Replaces the old canvas-compression + base64-chunking approach. Upload the
   real File object, store the resulting URL on the profile doc. */

export async function uploadPhoto(uid, file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Photo must be under 5MB.');
  const fileRef = ref(storage, `photos/${uid}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

export async function uploadThemeSong(uid, file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Theme song must be under 10MB.');
  const fileRef = ref(storage, `theme-songs/${uid}/${Date.now()}-${file.name}`);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

/* ---------------- admin: creating coach/admin accounts ----------------
   This can't be done client-side (a client can only ever create its own
   trainee account -- see firestore.rules). It calls the Netlify function,
   which uses the Firebase Admin SDK to do it securely. */

export async function createStaffAccount({ email, password, username, phone, social, role }) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch('/.netlify/functions/create-staff-account', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
    },
    body: JSON.stringify({ email, password, username, phone, social, role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create account.');
  return data;
}
