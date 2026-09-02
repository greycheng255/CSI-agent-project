const OPENNOTEBOOK_API_KEY_STORAGE_PREFIX = 'genesis-opennotebook-api-key';

function storageKey(accountId: string) {
  return `${OPENNOTEBOOK_API_KEY_STORAGE_PREFIX}:${accountId}`;
}

export function normalizeOpenNotebookApiKey(value: string) {
  return value.trim().replace(/^Bearer\s+/i, '');
}

export function readOpenNotebookApiKey(accountId: string) {
  if (typeof window === 'undefined') return '';
  return normalizeOpenNotebookApiKey(
    window.localStorage.getItem(storageKey(accountId)) || '',
  );
}

export function saveOpenNotebookApiKey(accountId: string, apiKey: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    storageKey(accountId),
    normalizeOpenNotebookApiKey(apiKey),
  );
}

export function clearOpenNotebookApiKey(accountId: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(accountId));
}

export function openNotebookAuthorization(apiKey: string) {
  const normalized = normalizeOpenNotebookApiKey(apiKey);
  return normalized ? `Bearer ${normalized}` : '';
}

export function maskedOpenNotebookApiKey(apiKey: string) {
  const normalized = normalizeOpenNotebookApiKey(apiKey);
  if (!normalized) return '';
  return `••••${normalized.slice(-6)}`;
}
