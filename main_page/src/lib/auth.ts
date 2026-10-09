/**
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTH SERVICE — real Firebase Authentication
 *
 * Google sign-in uses `signInWithPopup` → opens the real Google consent
 * screen (accounts.google.com). Email/password uses Firebase's built-in
 * `createUserWithEmailAndPassword` / `signInWithEmailAndPassword`.
 *
 * Components consume only the `AuthUser` shape — nothing else changes
 * if the provider is swapped later (Supabase, Auth0, etc.).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { auth } from "./firebase";

export interface AuthUser {
  name: string;
  email: string;
  provider: "password" | "google";
}

export class AuthError extends Error {}

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export const MIN_PASSWORD = 6;

// ─── Helpers ────────────────────────────────────────────────────────────────

function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  if (!local) return "User";
  return local
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Map Firebase User to our App AuthUser shape */
export function mapFirebaseUser(u: User): AuthUser {
  return {
    name: u.displayName || nameFromEmail(u.email || "user@example.com"),
    email: u.email || "",
    // We check providerId to see if it's google.com
    provider: u.providerData.some((p) => p.providerId === "google.com") ? "google" : "password",
  };
}

function friendlyError(code: string): string {
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn't look right.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
      return "No account found with that email.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password. Please try again.";
    case "auth/email-already-in-use":
      return "An account with that email already exists.";
    case "auth/weak-password":
      return `Password is too weak (min ${MIN_PASSWORD} characters).`;
    case "auth/popup-closed-by-user":
      return "Sign-in window closed. Please try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

// ─── Core Logic ─────────────────────────────────────────────────────────────

export async function signInWithPassword(email: string, password: string): Promise<AuthUser> {
  try {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return mapFirebaseUser(cred.user);
  } catch (e: unknown) {
    throw new AuthError(friendlyError((e as { code?: string }).code || ""));
  }
}

export async function createAccount(name: string, email: string, password: string): Promise<AuthUser> {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    return mapFirebaseUser(cred.user);
  } catch (e: unknown) {
    throw new AuthError(friendlyError((e as { code?: string }).code || ""));
  }
}

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("profile");
googleProvider.addScope("email");

/**
 * Opens the real Google sign-in popup (accounts.google.com).
 * The user picks their Google account → popup closes → App.tsx detects the user.
 */
export async function continueWithGoogle(): Promise<void> {
  try {
    // Using Popup as it matches the desired UX and is more reliable in many environments
    await signInWithPopup(auth, googleProvider);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code || "";
    // If it's a domain error, provide a very specific instruction
    if (code === "auth/unauthorized-domain") {
      throw new AuthError("This domain is not authorized in Firebase. Please add this URL to 'Authorized Domains' in the Firebase Console.");
    }
    throw new AuthError(friendlyError(code));
  }
}

export async function signOutUser(): Promise<void> {
  await firebaseSignOut(auth);
}

export { onAuthStateChanged };

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "RS";
}
