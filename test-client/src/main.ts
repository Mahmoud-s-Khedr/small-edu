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

const auth = getAuth(initializeApp(firebaseConfig));

type FieldType = 'text' | 'number' | 'url' | 'datetime-local' | 'textarea' | 'select';
type Field = {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  value?: string;
  options?: Array<[string, string]>;
  suggestion?: string;
  fullWidth?: boolean;
};
type FileField = { accept: string; label: string; help: string };
type Preset = {
  group: string;
  label: string;
  method: string;
  path: string;
  params?: Field[];
  query?: Field[];
  body?: Field[];
  mcqChoices?: boolean;
  file?: FileField;
  saveIdAs?: string;
  saveObjectKeyAs?: string;
};

const apiBaseInput = document.querySelector<HTMLInputElement>('#api-base-url')!;
const emailInput = document.querySelector<HTMLInputElement>('#email')!;
const passwordInput = document.querySelector<HTMLInputElement>('#password')!;
const identityState = document.querySelector<HTMLElement>('#identity-state')!;
const output = document.querySelector<HTMLElement>('#output')!;
const responseDownload = document.querySelector<HTMLAnchorElement>('#response-download')!;
const endpointPreset = document.querySelector<HTMLSelectElement>('#endpoint-preset')!;
const requestBadge = document.querySelector<HTMLElement>('#request-badge')!;
const requestSummary = document.querySelector<HTMLElement>('#request-summary')!;
const pathFields = document.querySelector<HTMLElement>('#path-fields')!;
const queryFields = document.querySelector<HTMLElement>('#query-fields')!;
const bodyFields = document.querySelector<HTMLElement>('#body-fields')!;
const fileField = document.querySelector<HTMLElement>('#file-field')!;
const activityLog = document.querySelector<HTMLElement>('#activity-log')!;
const sendButton = document.querySelector<HTMLButtonElement>('#send-request')!;
let downloadUrl: string | null = null;
const remembered = new Map<string, string[]>();

apiBaseInput.value = 'https://medly-api.mahmoud-s-khedr-2.workers.dev/api/v1';

const page = (): Field => ({ name: 'page', label: 'Page', type: 'number', placeholder: '1', help: 'Optional; defaults to 1.' });
const pageSize = (): Field => ({ name: 'pageSize', label: 'Page size', type: 'number', placeholder: '20', help: '1–100; defaults to 20.' });
const moduleId = (): Field => ({ name: 'moduleId', label: 'Module ID', placeholder: 'Choose or paste a module UUID', required: true, suggestion: 'moduleId' });
const lectureId = (): Field => ({ name: 'lectureId', label: 'Lecture ID', placeholder: 'Choose or paste a lecture UUID', required: true, suggestion: 'lectureId' });
const materialId = (): Field => ({ name: 'materialId', label: 'Material ID', placeholder: 'Choose or paste a material UUID', required: true, suggestion: 'materialId' });
const flashcardId = (): Field => ({ name: 'flashcardId', label: 'Flashcard ID', placeholder: 'Choose or paste a flashcard UUID', required: true, suggestion: 'flashcardId' });
const mcqId = (): Field => ({ name: 'mcqId', label: 'MCQ ID', placeholder: 'Choose or paste an MCQ UUID', required: true, suggestion: 'mcqId' });
const bookingId = (): Field => ({ name: 'bookingId', label: 'Booking ID', placeholder: 'Choose or paste a booking UUID', required: true, suggestion: 'bookingId' });
const userId = (): Field => ({ name: 'userId', label: 'User ID', placeholder: 'Choose or paste a user UUID', required: true, suggestion: 'userId' });

const presets: Preset[] = [
  { group: 'System and identity', label: 'Health check', method: 'GET', path: '/health' },
  { group: 'System and identity', label: 'Provision Firebase session', method: 'POST', path: '/auth/session' },
  { group: 'System and identity', label: 'Current user', method: 'GET', path: '/me', saveIdAs: 'userId' },
  { group: 'Super-admin users', label: 'List users', method: 'GET', path: '/admin/users', saveIdAs: 'userId' },
  { group: 'Super-admin users', label: 'Change user role', method: 'PATCH', path: '/admin/users/:userId/role', params: [userId()], body: [{ name: 'role', label: 'New role', type: 'select', required: true, options: [['ADMIN', 'Admin'], ['USER', 'User']] }] },
  { group: 'Modules', label: 'List modules', method: 'GET', path: '/modules', query: [page(), pageSize(), { name: 'number', label: 'Module number', placeholder: 'e.g. BIO-101' }, { name: 'academicYear', label: 'Academic year', placeholder: 'e.g. 2026' }, { name: 'semester', label: 'Semester', placeholder: 'e.g. Fall' }], saveIdAs: 'moduleId' },
  { group: 'Modules', label: 'Create module', method: 'POST', path: '/modules', saveIdAs: 'moduleId', body: [
    { name: 'title', label: 'Title', required: true, placeholder: 'API test module' },
    { name: 'number', label: 'Module number', required: true, placeholder: 'TEST-101' },
    { name: 'academicYear', label: 'Academic year', required: true, placeholder: '2026' },
    { name: 'semester', label: 'Semester', required: true, placeholder: 'Fall' },
    { name: 'priceCents', label: 'Price (cents)', type: 'number', required: true, placeholder: '1000', help: 'Use 0 for a free module.' },
  ] },
  { group: 'Modules', label: 'Get module', method: 'GET', path: '/modules/:moduleId', params: [moduleId()], saveIdAs: 'moduleId' },
  { group: 'Modules', label: 'Update module', method: 'PATCH', path: '/modules/:moduleId', params: [moduleId()], body: [
    { name: 'title', label: 'Title', placeholder: 'Leave blank to keep unchanged' }, { name: 'number', label: 'Module number' },
    { name: 'academicYear', label: 'Academic year' }, { name: 'semester', label: 'Semester' }, { name: 'priceCents', label: 'Price (cents)', type: 'number' },
  ] },
  { group: 'Modules', label: 'Delete module', method: 'DELETE', path: '/modules/:moduleId', params: [moduleId()] },
  { group: 'Modules', label: 'List module lectures', method: 'GET', path: '/modules/:moduleId/lectures', params: [moduleId()], query: [page(), pageSize(), { name: 'subject', label: 'Subject' }, { name: 'from', label: 'From date', type: 'datetime-local' }, { name: 'to', label: 'To date', type: 'datetime-local' }], saveIdAs: 'lectureId' },
  { group: 'Modules', label: 'Create lecture in module', method: 'POST', path: '/modules/:moduleId/lectures', params: [moduleId()], saveIdAs: 'lectureId', body: [
    { name: 'title', label: 'Title', required: true, placeholder: 'API test lecture' }, { name: 'subject', label: 'Subject', required: true, placeholder: 'Testing' },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true }, { name: 'lectureDate', label: 'Lecture date and time', type: 'datetime-local', required: true },
    { name: 'videoUrl', label: 'Video URL', type: 'url', required: true, placeholder: 'https://example.com/video' },
  ] },
  { group: 'Lectures and materials', label: 'List lectures', method: 'GET', path: '/lectures', query: [page(), pageSize(), { name: 'moduleId', label: 'Module ID', suggestion: 'moduleId' }, { name: 'subject', label: 'Subject' }, { name: 'academicYear', label: 'Academic year' }, { name: 'semester', label: 'Semester' }, { name: 'from', label: 'From date', type: 'datetime-local' }, { name: 'to', label: 'To date', type: 'datetime-local' }], saveIdAs: 'lectureId' },
  { group: 'Lectures and materials', label: 'Get lecture', method: 'GET', path: '/lectures/:lectureId', params: [lectureId()], saveIdAs: 'lectureId' },
  { group: 'Lectures and materials', label: 'Update lecture', method: 'PATCH', path: '/lectures/:lectureId', params: [lectureId()], body: [
    { name: 'title', label: 'Title' }, { name: 'subject', label: 'Subject' }, { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    { name: 'lectureDate', label: 'Lecture date and time', type: 'datetime-local' }, { name: 'videoUrl', label: 'Video URL', type: 'url' },
  ] },
  { group: 'Lectures and materials', label: 'Delete lecture', method: 'DELETE', path: '/lectures/:lectureId', params: [lectureId()] },
  { group: 'Lectures and materials', label: 'List materials', method: 'GET', path: '/lectures/:lectureId/materials', params: [lectureId()], saveIdAs: 'materialId' },
  { group: 'Lectures and materials', label: 'Upload material', method: 'POST', path: '/lectures/:lectureId/materials', params: [lectureId()], file: { label: 'Lecture material', accept: '', help: 'The selected file is sent as raw bytes with its filename and content type.' }, saveIdAs: 'materialId' },
  { group: 'Lectures and materials', label: 'Download material', method: 'GET', path: '/lectures/:lectureId/materials/:materialId/download', params: [lectureId(), materialId()] },
  { group: 'Lectures and materials', label: 'Rename material', method: 'PATCH', path: '/lectures/:lectureId/materials/:materialId', params: [lectureId(), materialId()], body: [{ name: 'originalFilename', label: 'New filename', required: true, placeholder: 'renamed-material.pdf' }] },
  { group: 'Lectures and materials', label: 'Delete material', method: 'DELETE', path: '/lectures/:lectureId/materials/:materialId', params: [lectureId(), materialId()] },
  { group: 'Lectures and materials', label: 'Get unlocked video URL', method: 'GET', path: '/lectures/:lectureId/video', params: [lectureId()] },
  { group: 'Bookings', label: 'Upload receipt', method: 'POST', path: '/bookings/receipt', file: { label: 'Receipt file', accept: '.pdf,image/jpeg,image/png', help: 'Accepted formats: PDF, JPEG, or PNG. The maximum size is 10 MiB.' }, saveObjectKeyAs: 'receiptKey' },
  { group: 'Bookings', label: 'Delete unsubmitted receipt', method: 'DELETE', path: '/bookings/receipt', body: [{ name: 'receiptKey', label: 'Receipt upload key', required: true, suggestion: 'receiptKey' }] },
  { group: 'Bookings', label: 'Create booking request', method: 'POST', path: '/bookings', saveIdAs: 'bookingId', body: [{ ...moduleId(), required: true }, { name: 'receiptKey', label: 'Receipt upload key', required: true, suggestion: 'receiptKey' }] },
  { group: 'Bookings', label: 'List my bookings', method: 'GET', path: '/bookings', saveIdAs: 'bookingId' },
  { group: 'Bookings', label: 'List all bookings', method: 'GET', path: '/admin/bookings', query: [page(), pageSize(), { name: 'status', label: 'Status', type: 'select', options: [['', 'All statuses'], ['PENDING', 'Pending'], ['ACCEPTED', 'Accepted'], ['REJECTED', 'Rejected']] }], saveIdAs: 'bookingId' },
  { group: 'Bookings', label: 'Download booking receipt', method: 'GET', path: '/admin/bookings/:bookingId/receipt', params: [bookingId()] },
  { group: 'Bookings', label: 'Accept or reject booking', method: 'PATCH', path: '/admin/bookings/:bookingId', params: [bookingId()], body: [{ name: 'status', label: 'Decision', type: 'select', required: true, options: [['ACCEPTED', 'Accept'], ['REJECTED', 'Reject']] }] },
  { group: 'Flashcards', label: 'List lecture flashcards', method: 'GET', path: '/lectures/:lectureId/flashcards', params: [lectureId()], saveIdAs: 'flashcardId' },
  { group: 'Flashcards', label: 'Create flashcard', method: 'POST', path: '/lectures/:lectureId/flashcards', params: [lectureId()], saveIdAs: 'flashcardId', body: [
    { name: 'frontText', label: 'Front text', type: 'textarea', fullWidth: true, help: 'Provide text, an image key, or both for each side.' }, { name: 'backText', label: 'Back text', type: 'textarea', fullWidth: true },
    { name: 'frontImageKey', label: 'Front image upload key', suggestion: 'flashcardImageKey' }, { name: 'backImageKey', label: 'Back image upload key', suggestion: 'flashcardImageKey' }, { name: 'ordering', label: 'Order', type: 'number', placeholder: '0' },
  ] },
  { group: 'Flashcards', label: 'Upload flashcard image', method: 'POST', path: '/lectures/:lectureId/flashcards/image', params: [lectureId()], file: { label: 'Flashcard image', accept: 'image/jpeg,image/png,image/webp', help: 'Accepted formats: JPEG, PNG, or WebP. The maximum size is 10 MiB.' }, saveObjectKeyAs: 'flashcardImageKey' },
  { group: 'Flashcards', label: 'Update flashcard', method: 'PATCH', path: '/flashcards/:flashcardId', params: [flashcardId()], body: [
    { name: 'frontText', label: 'Front text', type: 'textarea', fullWidth: true }, { name: 'backText', label: 'Back text', type: 'textarea', fullWidth: true },
    { name: 'frontImageKey', label: 'Front image upload key', suggestion: 'flashcardImageKey' }, { name: 'backImageKey', label: 'Back image upload key', suggestion: 'flashcardImageKey' }, { name: 'ordering', label: 'Order', type: 'number' },
  ] },
  { group: 'Flashcards', label: 'Delete flashcard', method: 'DELETE', path: '/flashcards/:flashcardId', params: [flashcardId()] },
  { group: 'Flashcards', label: 'Set my flashcard state', method: 'PUT', path: '/flashcards/:flashcardId/state', params: [flashcardId()], body: [
    { name: 'knowledge', label: 'Knowledge', type: 'select', options: [['', 'Leave unchanged'], ['KNOWN', 'Known'], ['UNKNOWN', 'Unknown'], ['null', 'Clear knowledge']] },
    { name: 'hidden', label: 'Hide this card?', type: 'select', options: [['', 'Leave unchanged'], ['true', 'Yes'], ['false', 'No']] },
    { name: 'viewed', label: 'Mark as viewed?', type: 'select', options: [['', 'Leave unchanged'], ['true', 'Yes'], ['false', 'No']] },
  ] },
  { group: 'Flashcards', label: 'Get flashcard progress', method: 'GET', path: '/lectures/:lectureId/flashcards/progress', params: [lectureId()] },
  { group: 'Flashcards', label: 'Get flashcard front image', method: 'GET', path: '/flashcards/:flashcardId/image/front', params: [flashcardId()] },
  { group: 'Flashcards', label: 'Get flashcard back image', method: 'GET', path: '/flashcards/:flashcardId/image/back', params: [flashcardId()] },
  { group: 'MCQs', label: 'List lecture MCQs', method: 'GET', path: '/lectures/:lectureId/mcqs', params: [lectureId()], saveIdAs: 'mcqId' },
  { group: 'MCQs', label: 'Create MCQ', method: 'POST', path: '/lectures/:lectureId/mcqs', params: [lectureId()], saveIdAs: 'mcqId', body: [{ name: 'questionText', label: 'Question', type: 'textarea', fullWidth: true, required: true }, { name: 'ordering', label: 'Order', type: 'number', placeholder: '0' }], mcqChoices: true },
  { group: 'MCQs', label: 'Update MCQ', method: 'PATCH', path: '/mcqs/:mcqId', params: [mcqId()], body: [{ name: 'questionText', label: 'Question', type: 'textarea', fullWidth: true }, { name: 'ordering', label: 'Order', type: 'number' }], mcqChoices: true },
  { group: 'MCQs', label: 'Delete MCQ', method: 'DELETE', path: '/mcqs/:mcqId', params: [mcqId()] },
  { group: 'MCQs', label: 'Check MCQ answer', method: 'POST', path: '/mcqs/:mcqId/check-answer', params: [mcqId()], body: [{ name: 'choiceId', label: 'Selected choice ID', required: true, suggestion: 'choiceId' }] },
];

function apiBase(): string {
  const value = apiBaseInput.value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(value)) throw new Error('Enter a valid Worker API base URL.');
  return value;
}

function credentials(): { email: string; password: string } {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) throw new Error('Enter both an email address and password.');
  return { email, password };
}

async function token(): Promise<string> {
  if (!auth.currentUser) throw new Error('Sign in to Firebase first.');
  return auth.currentUser.getIdToken();
}

function format(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function show(value: unknown): void {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = null;
  responseDownload.hidden = true;
  responseDownload.removeAttribute('href');
  output.textContent = format(value);
}

function showFile(response: Response, file: Blob): void {
  show({ status: response.status, statusText: response.statusText, contentType: response.headers.get('Content-Type') ?? file.type ?? 'application/octet-stream', sizeBytes: file.size, message: 'The response is a file. Use the download link above.' });
  downloadUrl = URL.createObjectURL(file);
  const filename = (response.headers.get('Content-Disposition') ?? '').match(/filename="?([^";]+)"?/i)?.[1] ?? 'medly-download';
  responseDownload.href = downloadUrl;
  responseDownload.download = filename;
  responseDownload.hidden = false;
}

type LogStatus = 'pending' | 'success' | 'error' | 'info';
type LogItem = { time: Date; title: string; detail?: string; status: LogStatus };
const logItems: LogItem[] = [];

function renderLog(): void {
  activityLog.replaceChildren();
  if (!logItems.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-log';
    empty.textContent = 'No activity yet.';
    activityLog.append(empty);
    return;
  }
  for (const entry of logItems) {
    const item = document.createElement('article');
    item.className = `log-entry ${entry.status}`;
    const top = document.createElement('div');
    top.className = 'log-topline';
    const time = document.createElement('time');
    time.className = 'log-time';
    time.textContent = entry.time.toLocaleTimeString();
    const title = document.createElement('span');
    title.className = 'log-title';
    title.textContent = entry.title;
    top.append(time, title);
    item.append(top);
    if (entry.detail) {
      const detail = document.createElement('div');
      detail.className = 'log-detail';
      detail.textContent = entry.detail;
      item.append(detail);
    }
    activityLog.append(item);
  }
}

function addLog(title: string, detail?: string, status: LogStatus = 'info'): LogItem {
  const entry = { time: new Date(), title, detail, status };
  logItems.unshift(entry);
  renderLog();
  return entry;
}

function updateLog(entry: LogItem, status: LogStatus, detail?: string): void {
  entry.status = status;
  entry.detail = detail;
  renderLog();
}

function remember(key: string, value: unknown): void {
  if (typeof value !== 'string' || !value) return;
  remembered.set(key, [value, ...(remembered.get(key) ?? []).filter((item) => item !== value)].slice(0, 20));
}

function updateSuggestions(): void {
  document.querySelectorAll<HTMLDataListElement>('datalist[data-suggestion]').forEach((list) => {
    const values = remembered.get(list.dataset.suggestion ?? '') ?? [];
    list.replaceChildren(...values.map((value) => new Option(value)));
  });
}

function rememberResponse(preset: Preset, payload: unknown): void {
  const data = (payload && typeof payload === 'object' && 'data' in payload)
    ? (payload as { data: unknown }).data
    : payload;
  const topLevelItems = Array.isArray(data) ? data : [data];
  for (const item of topLevelItems) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (preset.saveIdAs) remember(preset.saveIdAs, record.id);
    if (preset.saveObjectKeyAs) remember(preset.saveObjectKeyAs, record.objectKey);
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if ('mcqId' in item && 'choiceText' in item) remember('choiceId', item.id);
    for (const [key, nested] of Object.entries(item)) {
      if (key === 'moduleId' || key === 'lectureId' || key === 'flashcardId' || key === 'mcqId' || key === 'bookingId' || key === 'userId' || key === 'materialId' || key === 'choiceId') remember(key, nested);
      visit(nested);
    }
  };
  visit(data);
  updateSuggestions();
}

async function sendApiRequest(method: string, path: string, body?: BodyInit, file?: File, preset?: Preset): Promise<unknown> {
  const started = performance.now();
  let entry: LogItem | undefined;
  try {
    const base = apiBase();
    entry = addLog(`${method} ${path}`, `Sending request to ${base}${path}`, 'pending');
    const headers = new Headers();
    if (path !== '/health') headers.set('Authorization', `Bearer ${await token()}`);
    if (file) {
      headers.set('Content-Type', file.type || 'application/octet-stream');
      headers.set('X-Filename', file.name);
    } else if (body) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${base}${path}`, { method, headers, body });
    const elapsed = Math.round(performance.now() - started);
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.json().catch(() => null);
      show({ status: response.status, statusText: response.statusText, body: payload });
      if (response.ok) rememberResponse(preset ?? { group: '', label: '', method, path }, payload);
      updateLog(entry, response.ok ? 'success' : 'error', `${response.status} ${response.statusText || 'Response'} · ${elapsed} ms`);
      return payload;
    }
    if (response.status === 204) {
      show({ status: response.status, statusText: response.statusText, body: null });
      updateLog(entry, 'success', `204 No Content · ${elapsed} ms`);
      return null;
    }
    const blob = await response.blob();
    showFile(response, blob);
    updateLog(entry, response.ok ? 'success' : 'error', `${response.status} ${response.statusText || 'File response'} · ${elapsed} ms · ${blob.size} bytes`);
    return blob;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    show({ error: message });
    if (entry) updateLog(entry, 'error', message);
    else addLog(`${method} ${path}`, message, 'error');
    return undefined;
  }
}

async function runIdentity(label: string, action: () => Promise<void>): Promise<void> {
  const entry = addLog(label, 'Working…', 'pending');
  try {
    await action();
    updateLog(entry, 'success', 'Completed successfully.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    show({ error: message });
    updateLog(entry, 'error', message);
  }
}

function currentPreset(): Preset {
  return presets[Number(endpointPreset.value)] ?? presets[0];
}

function fieldId(scope: string, field: Field): string {
  return `${scope}-${field.name}`;
}

function renderField(container: HTMLElement, field: Field, scope: string): void {
  const label = document.createElement('label');
  if (field.fullWidth) label.classList.add('full-width');
  label.htmlFor = fieldId(scope, field);
  const text = document.createElement('span');
  text.textContent = `${field.label}${field.required ? ' *' : ''}`;
  label.append(text);
  let control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (field.type === 'textarea') {
    control = document.createElement('textarea');
    control.rows = 3;
  } else if (field.type === 'select') {
    control = document.createElement('select');
    for (const [value, optionLabel] of field.options ?? []) control.add(new Option(optionLabel, value));
  } else {
    control = document.createElement('input');
    control.type = field.type ?? 'text';
  }
  control.id = fieldId(scope, field);
  control.dataset.field = field.name;
  control.dataset.scope = scope;
  if (field.required) control.required = true;
  if (field.placeholder && 'placeholder' in control) control.placeholder = field.placeholder;
  if (field.value) control.value = field.value;
  if (field.suggestion && control instanceof HTMLInputElement) {
    const listId = `suggestions-${field.suggestion}`;
    control.setAttribute('list', listId);
    let list = document.querySelector<HTMLDataListElement>(`#${listId}`);
    if (!list) {
      list = document.createElement('datalist');
      list.id = listId;
      list.dataset.suggestion = field.suggestion;
      document.body.append(list);
    }
  }
  label.append(control);
  if (field.help) {
    const help = document.createElement('span');
    help.className = 'field-help';
    help.textContent = field.help;
    label.append(help);
  }
  container.append(label);
}

function renderMcqChoices(container: HTMLElement): void {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'choice-editor';
  const legend = document.createElement('legend');
  legend.textContent = 'Four answer choices *';
  fieldset.append(legend);
  for (let index = 0; index < 4; index += 1) {
    const row = document.createElement('label');
    row.className = 'choice-row';
    const correct = document.createElement('input');
    correct.type = 'radio';
    correct.name = 'correct-choice';
    correct.value = String(index);
    correct.checked = index === 0;
    correct.title = 'Mark as the correct answer';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `choice-${index}`;
    input.placeholder = `Choice ${index + 1}`;
    input.required = true;
    row.append(correct, input);
    fieldset.append(row);
  }
  const help = document.createElement('p');
  help.className = 'field-help';
  help.textContent = 'Select the radio button beside the one correct answer.';
  fieldset.append(help);
  container.append(fieldset);
}

function renderPreset(): void {
  const preset = currentPreset();
  pathFields.replaceChildren();
  queryFields.replaceChildren();
  bodyFields.replaceChildren();
  fileField.replaceChildren();
  requestBadge.textContent = preset.method;
  requestBadge.dataset.method = preset.method;
  requestSummary.textContent = `${preset.method} ${preset.path}${preset.method !== 'GET' && preset.path !== '/health' ? '  •  Firebase token included automatically' : ''}`;
  (preset.params ?? []).forEach((field) => renderField(pathFields, field, 'path'));
  (preset.query ?? []).forEach((field) => renderField(queryFields, field, 'query'));
  (preset.body ?? []).forEach((field) => renderField(bodyFields, field, 'body'));
  if (preset.mcqChoices) renderMcqChoices(bodyFields);
  if (preset.file) {
    const label = document.createElement('label');
    label.className = 'file-box';
    label.textContent = `${preset.file.label} *`;
    const input = document.createElement('input');
    input.id = 'request-file';
    input.type = 'file';
    input.accept = preset.file.accept;
    input.required = true;
    const help = document.createElement('span');
    help.className = 'field-help';
    help.textContent = preset.file.help;
    label.append(input, help);
    fileField.append(label);
  }
  updateSuggestions();
}

function readField(field: Field, scope: string): unknown {
  const control = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${fieldId(scope, field)}`)!;
  const raw = control.value.trim();
  if (!raw) {
    if (field.required) throw new Error(`${field.label} is required.`);
    return undefined;
  }
  if (field.type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${field.label} must be a number.`);
    return value;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  return raw;
}

function buildPath(preset: Preset): string {
  let path = preset.path;
  for (const field of preset.params ?? []) {
    const value = readField(field, 'path');
    path = path.replace(`:${field.name}`, encodeURIComponent(String(value)));
  }
  const query = new URLSearchParams();
  for (const field of preset.query ?? []) {
    const value = readField(field, 'query');
    if (value !== undefined) query.set(field.name, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function buildBody(preset: Preset): BodyInit | undefined {
  const values: Record<string, unknown> = {};
  for (const field of preset.body ?? []) {
    const value = readField(field, 'body');
    if (value !== undefined) values[field.name] = value;
  }
  if (preset.mcqChoices) {
    const choices = Array.from({ length: 4 }, (_, index) => {
      const input = document.querySelector<HTMLInputElement>(`#choice-${index}`)!;
      const text = input.value.trim();
      if (!text) throw new Error(`Choice ${index + 1} is required.`);
      return { text, isCorrect: document.querySelector<HTMLInputElement>('input[name="correct-choice"]:checked')?.value === String(index) };
    });
    values.choices = choices;
  }
  return Object.keys(values).length ? JSON.stringify(values) : undefined;
}

function populatePresets(): void {
  for (const group of [...new Set(presets.map((preset) => preset.group))]) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group;
    presets.forEach((preset, index) => {
      if (preset.group === group) optgroup.append(new Option(`${preset.method} — ${preset.label}`, String(index)));
    });
    endpointPreset.append(optgroup);
  }
  endpointPreset.value = '0';
  renderPreset();
}

document.querySelector<HTMLButtonElement>('#create-account')!.addEventListener('click', () => void runIdentity('Create Firebase account', async () => {
  const { email, password } = credentials();
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(result.user);
  show({ message: 'Account created and verification email sent. Verify the email, then refresh verification status.', email: result.user.email });
}));
document.querySelector<HTMLButtonElement>('#sign-in')!.addEventListener('click', () => void runIdentity('Firebase sign-in', async () => {
  const { email, password } = credentials();
  const result = await signInWithEmailAndPassword(auth, email, password);
  show({ message: 'Firebase sign-in succeeded.', email: result.user.email, emailVerified: result.user.emailVerified });
}));
document.querySelector<HTMLButtonElement>('#refresh-verification')!.addEventListener('click', () => void runIdentity('Refresh email verification', async () => {
  if (!auth.currentUser) throw new Error('Sign in to Firebase first.');
  await reload(auth.currentUser);
  await auth.currentUser.getIdToken(true);
  show({ email: auth.currentUser.email, emailVerified: auth.currentUser.emailVerified });
}));
document.querySelector<HTMLButtonElement>('#sign-out')!.addEventListener('click', () => void runIdentity('Firebase sign-out', async () => {
  await signOut(auth);
  show('Signed out.');
}));
document.querySelector<HTMLButtonElement>('#provision-session')!.addEventListener('click', () => void sendApiRequest('POST', '/auth/session'));
document.querySelector<HTMLButtonElement>('#get-me')!.addEventListener('click', () => void sendApiRequest('GET', '/me', undefined, undefined, { group: '', label: '', method: 'GET', path: '/me', saveIdAs: 'userId' }));
document.querySelector<HTMLButtonElement>('#get-modules')!.addEventListener('click', () => void sendApiRequest('GET', '/modules?page=1&pageSize=5', undefined, undefined, { group: '', label: '', method: 'GET', path: '/modules', saveIdAs: 'moduleId' }));
document.querySelector<HTMLButtonElement>('#show-token')!.addEventListener('click', () => void runIdentity('Read token metadata', async () => {
  if (!auth.currentUser) throw new Error('Sign in to Firebase first.');
  const result = await auth.currentUser.getIdTokenResult();
  show({ email: auth.currentUser.email, emailVerified: auth.currentUser.emailVerified, issuedAtTime: result.issuedAtTime, expirationTime: result.expirationTime, signInProvider: result.signInProvider, claims: result.claims });
}));

endpointPreset.addEventListener('change', renderPreset);
document.querySelector<HTMLButtonElement>('#reset-request')!.addEventListener('click', renderPreset);
document.querySelector<HTMLButtonElement>('#clear-log')!.addEventListener('click', () => {
  logItems.length = 0;
  renderLog();
});
sendButton.addEventListener('click', async () => {
  const preset = currentPreset();
  sendButton.disabled = true;
  try {
    const path = buildPath(preset);
    const file = document.querySelector<HTMLInputElement>('#request-file')?.files?.[0];
    if (preset.file && !file) throw new Error(`${preset.file.label} is required.`);
    const body = file ? file : buildBody(preset);
    await sendApiRequest(preset.method, path, body, file, preset);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    show({ error: message });
    addLog(`${preset.method} ${preset.path}`, message, 'error');
  } finally {
    sendButton.disabled = false;
  }
});

onAuthStateChanged(auth, (user) => {
  identityState.textContent = user
    ? `Signed in as ${user.email ?? user.uid} (${user.emailVerified ? 'email verified' : 'email not verified'}).`
    : 'No Firebase user is signed in.';
});

populatePresets();
renderLog();
addLog('Test console ready', 'Choose an operation to begin. Form values are sent as JSON automatically when required; you never need to write JSON.', 'info');
