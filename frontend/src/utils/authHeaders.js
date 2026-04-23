import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Returns auth + common headers to attach to every API request.
 * If no session exists (user not logged in) the Authorization header is omitted.
 */
export async function getAuthHeaders() {
  try {
    const session = await fetchAuthSession();
    const token   = session?.tokens?.accessToken?.toString();

    return {
      'Content-Type':              'application/json',
      'ngrok-skip-browser-warning':'true',
      'X-Requested-With':          'XMLHttpRequest',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  } catch {
    // Not authenticated — return headers without token
    return {
      'Content-Type':              'application/json',
      'ngrok-skip-browser-warning':'true',
      'X-Requested-With':          'XMLHttpRequest',
    };
  }
}

/**
 * Same as getAuthHeaders but without Content-Type (for GET requests).
 */
export async function getAuthHeadersGet() {
  const headers = await getAuthHeaders();
  const { 'Content-Type': _ct, ...rest } = headers;
  return rest;
}
