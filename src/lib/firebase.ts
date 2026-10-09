import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

type FirebaseServices = { auth: Auth; db: Firestore };
const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'] as const;
let services: Promise<FirebaseServices | null> | null = null;

export function isFirebaseConfigured(): boolean { return required.every((key) => Boolean(import.meta.env[key]?.trim())); }
export function getFirebaseServices(): Promise<FirebaseServices | null> {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  services ??= Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/firestore')]).then(([appModule, authModule, firestoreModule]) => {
    const app = appModule.initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID });
    return { auth: authModule.getAuth(app), db: firestoreModule.getFirestore(app) };
  });
  return services;
}
export async function ensureAnonymousSession(): Promise<string | null> {
  const value = await getFirebaseServices();
  if (!value) return null;
  if (value.auth.currentUser) return value.auth.currentUser.uid;
  const { signInAnonymously } = await import('firebase/auth');
  return (await signInAnonymously(value.auth)).user.uid;
}
