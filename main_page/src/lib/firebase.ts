/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FIREBASE INIT — single source of truth
 *
 * This file initialises the Firebase app and exports the Auth instance.
 * Every other module imports `auth` from here — nothing else touches the
 * raw config.
 *
 * When deploying to Vercel, move the values to env vars:
 *   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, etc.
 * and read them with `import.meta.env.VITE_FIREBASE_API_KEY`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCaWVISSqYVvOG1vBFnuHkK3rT6by2c1eg",
  authDomain: "blackspot-risk-engine.firebaseapp.com",
  projectId: "blackspot-risk-engine",
  storageBucket: "blackspot-risk-engine.firebasestorage.app",
  messagingSenderId: "983146963512",
  appId: "1:983146963512:web:682f88845e5e3fda797ccd",
  measurementId: "G-N8DG6G27L7",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export default app;
