/**
 * Unit tests for ApiService (apiService.js)
 *
 * Strategy: replace the global `fetch` with a jest.fn() before each test so we
 * never hit the network. We verify the URL, method, headers, body, and error
 * handling for every public method.
 */

import apiService from '../apiService';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a mock Response object that resolves to `body` as JSON. */
const mockJsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  json: jest.fn().mockResolvedValue(body),
});

beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

// ─── fetchDashboardData ────────────────────────────────────────────────────────

describe('fetchDashboardData', () => {
  test('calls the correct endpoint with ngrok header', async () => {
    const fakeData = { title: 'Sales', rows: [] };
    global.fetch.mockResolvedValue(mockJsonResponse(fakeData));

    const result = await apiService.fetchDashboardData('dashboard-1');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/dashboard/dashboard-1');
    expect(options.headers['ngrok-skip-browser-warning']).toBe('true');
    expect(result).toEqual(fakeData);
  });

  test('returns parsed JSON from the response', async () => {
    const payload = [{ id: 1 }, { id: 2 }];
    global.fetch.mockResolvedValue(mockJsonResponse(payload));

    const result = await apiService.fetchDashboardData('d2');

    expect(result).toEqual(payload);
  });
});

// ─── queryDashboard ───────────────────────────────────────────────────────────

describe('queryDashboard', () => {
  test('sends POST with correct URL and JSON body', async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({ answer: 'ok' }));

    await apiService.queryDashboard('d3', 'how many leads?');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/dashboard/d3/query');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(options.body);
    expect(body.query).toBe('how many leads?');
  });

  test('includes ngrok bypass header', async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({}));

    await apiService.queryDashboard('d1', 'test');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['ngrok-skip-browser-warning']).toBe('true');
  });
});

// ─── getChatResponse ──────────────────────────────────────────────────────────

describe('getChatResponse', () => {
  test('sends POST to /chat/ask with the message in the body', async () => {
    const reply = { success: true, markdown: '## Result', technical_insights: 'SELECT 1' };
    global.fetch.mockResolvedValue(mockJsonResponse(reply));

    const result = await apiService.getChatResponse('show me top accounts');

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/chat/ask');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.message).toBe('show me top accounts');
    expect(result).toEqual(reply);
  });

  test('includes Content-Type and ngrok headers', async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({}));

    await apiService.getChatResponse('test');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['ngrok-skip-browser-warning']).toBe('true');
  });

  test('throws when the server returns a non-OK status', async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(apiService.getChatResponse('bad query')).rejects.toThrow(
      'HTTP error! status: 500'
    );
  });

  test('throws when fetch rejects (network failure)', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));

    await expect(apiService.getChatResponse('any')).rejects.toThrow('Network error');
  });

  test('throws on 401 Unauthorized', async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({ error: 'Unauthorized' }, 401));

    await expect(apiService.getChatResponse('secure query')).rejects.toThrow(
      'HTTP error! status: 401'
    );
  });

  test('throws on 404 Not Found', async () => {
    global.fetch.mockResolvedValue(mockJsonResponse({}, 404));

    await expect(apiService.getChatResponse('missing')).rejects.toThrow(
      'HTTP error! status: 404'
    );
  });
});
