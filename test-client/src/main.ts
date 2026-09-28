import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import './style.css';

const firebaseConfig = {
  apiKey: 'AIzaSyDiJ-vWOiOVh_KMiId5Ipe-8DSuFpaDRp4',
  authDomain: 'test-e5d8b.firebaseapp.com',
  projectId: 'test-e5d8b',
  storageBucket: 'test-e5d8b.firebasestorage.app',
  messagingSenderId: '591741515117',
  appId: '1:591741515117:web:d56fd01e595199b1115664',
  measurementId: 'G-E4C3EDS9XE',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const apiBaseInput = document.querySelector<HTMLInputElement>('#api-base-url')!;
const emailInput = document.querySelector<HTMLInputElement>('#email')!;
const passwordInput = document.querySelector<HTMLInputElement>('#password')!;
const identityState = document.querySelector<HTMLElement>('#identity-state')!;
const output = document.querySelector<HTMLElement>('#output')!;

apiBaseInput.value = 'https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1';

function show(value: unknown): void {
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function credentials(): { email: string; password: string } {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) throw new Error('Enter both an email address and password.');
  return { email, password };
}

function apiBase(): string {
  const value = apiBaseInput.value.trim().replace(/\/+$/, '');
  if (!value.startsWith('https://') && !value.startsWith('http://')) {
    throw new Error('Enter a valid Worker API base URL.');
  }
  return value;
}

async function token(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Firebase first.');
  return user.getIdToken();
}

async function api(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await token()}`,
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}\n${JSON.stringify(body, null, 2)}`);
  }
  return body;
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    show({ error: message });
  }
}

document.querySelector<HTMLButtonElement>('#create-account')!.addEventListener('click', () => run(async () => {
  const { email, password } = credentials();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(result.user);
  show({
    message: 'Account created and verification email sent. Verify the address, then sign in or refresh verification status before provisioning the API session.',
    email: result.user.email,
  });
}));

document.querySelector<HTMLButtonElement>('#sign-in')!.addEventListener('click', () => run(async () => {
  const { email, password } = credentials();
  const result = await signInWithEmailAndPassword(auth, email, password);
  show({ message: 'Firebase sign-in succeeded.', email: result.user.email, emailVerified: result.user.emailVerified });
}));

document.querySelector<HTMLButtonElement>('#refresh-verification')!.addEventListener('click', () => run(async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Firebase first.');
  await reload(user);
  await user.getIdToken(true);
  show({ email: user.email, emailVerified: user.emailVerified });
}));

document.querySelector<HTMLButtonElement>('#sign-out')!.addEventListener('click', () => run(async () => {
  await signOut(auth);
  show('Signed out.');
}));

document.querySelector<HTMLButtonElement>('#provision-session')!.addEventListener('click', () => run(async () => {
  show(await api('/auth/session', { method: 'POST' }));
}));

document.querySelector<HTMLButtonElement>('#get-me')!.addEventListener('click', () => run(async () => {
  show(await api('/me'));
}));

document.querySelector<HTMLButtonElement>('#get-modules')!.addEventListener('click', () => run(async () => {
  show(await api('/modules?limit=5'));
}));

document.querySelector<HTMLButtonElement>('#show-token')!.addEventListener('click', () => run(async () => {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to Firebase first.');
  const result = await user.getIdTokenResult();
  show({
    email: user.email,
    emailVerified: user.emailVerified,
    issuedAtTime: result.issuedAtTime,
    expirationTime: result.expirationTime,
    signInProvider: result.signInProvider,
    claims: result.claims,
  });
}));

onAuthStateChanged(auth, (user) => {
  identityState.textContent = user
    ? `Signed in as ${user.email ?? user.uid} (${user.emailVerified ? 'email verified' : 'email not verified'}).`
    : 'No Firebase user is signed in.';
});
