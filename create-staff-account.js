// netlify/functions/create-staff-account.js
//
// Called from the client when an admin creates a coach or admin account.
// Runs server-side with Firebase Admin privileges, so it can:
//   1. verify the caller is really signed in and really an admin
//   2. create the new Auth user + Firestore user doc + role claim
// without ever exposing admin credentials to the browser.

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const authHeader = event.headers.authorization || '';
    const idToken = authHeader.replace('Bearer ', '');
    if (!idToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing auth token' }) };
    }

    // Confirm the caller is a real, currently signed-in Firebase user.
    const decoded = await admin.auth().verifyIdToken(idToken);

    // Confirm the caller is an admin, per Firestore -- not per anything the client claims.
    const callerDoc = await admin.firestore().collection('users').doc(decoded.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      return { statusCode: 403, body: JSON.stringify({ error: 'Only admins can create staff accounts' }) };
    }

    const { email, password, username, phone, social, role } = JSON.parse(event.body || '{}');

    if (!['coach', 'admin'].includes(role)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'role must be coach or admin' }) };
    }
    if (!email || !password || !username) {
      return { statusCode: 400, body: JSON.stringify({ error: 'email, password, and username are required' }) };
    }

    const userRecord = await admin.auth().createUser({ email, password, displayName: username });

    await admin.firestore().collection('users').doc(userRecord.uid).set({
      username,
      email,
      phone: phone || '',
      social: Array.isArray(social) ? social.slice(0, 3) : [],
      role,
      createdAt: Date.now(),
    });

    // Optional: also stamp the role as a custom claim, useful if you want to check
    // roles from security rules via request.auth.token.role instead of a Firestore read.
    await admin.auth().setCustomUserClaims(userRecord.uid, { role });

    return { statusCode: 200, body: JSON.stringify({ uid: userRecord.uid }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
