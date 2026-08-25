export const API_BASE_URL = process.env.REACT_APP_API_BASE_URL || '/api';

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || 'Request failed.';
    throw new Error(message);
  }
  return payload;
}
