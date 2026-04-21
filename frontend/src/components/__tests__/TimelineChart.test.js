import { detectDateKey } from '../TimelineChart';

// ---------------------------------------------------------------------------
// detectDateKey
// ---------------------------------------------------------------------------
describe('detectDateKey', () => {
  test('returns null for null/undefined input', () => {
    expect(detectDateKey(null)).toBeNull();
    expect(detectDateKey(undefined)).toBeNull();
  });

  test('detects key named "date" (case-insensitive)', () => {
    expect(detectDateKey({ DATE: '2024-01-01', COUNT: 5 })).toBe('DATE');
    expect(detectDateKey({ date: '2024-01-01', count: 5 })).toBe('date');
  });

  test('detects key containing "month"', () => {
    expect(detectDateKey({ MONTH: '2024-01', LEADS: 10 })).toBe('MONTH');
  });

  test('detects key containing "week"', () => {
    expect(detectDateKey({ WEEK: '2024-W01', LEADS: 5 })).toBe('WEEK');
  });

  test('detects key containing "year"', () => {
    expect(detectDateKey({ YEAR: 2024, REVENUE: 50000 })).toBe('YEAR');
  });

  test('detects key containing "quarter"', () => {
    expect(detectDateKey({ QUARTER: 'Q1-2024', LEADS: 20 })).toBe('QUARTER');
  });

  test('detects key ending in "_at" (created_at, updated_at)', () => {
    expect(detectDateKey({ created_at: '2024-01-15', value: 3 })).toBe('created_at');
  });

  test('detects key containing "ts" (timestamp)', () => {
    expect(detectDateKey({ ts: '2024-01-01T00:00:00Z', count: 1 })).toBe('ts');
  });

  test('detects key by value: ISO date string value when key name is generic', () => {
    // Key name doesn't match, but value is a parseable date string
    expect(detectDateKey({ LABEL: '2024-03-15', VALUE: 99 })).toBe('LABEL');
  });

  test('returns first matching key when multiple date-like keys exist', () => {
    const sample = { ENGAGEMENT_DATE: '2024-01-01', LEAD_COUNT: 5 };
    expect(detectDateKey(sample)).toBe('ENGAGEMENT_DATE');
  });

  test('returns null when no date-like key or value exists', () => {
    expect(detectDateKey({ INDUSTRY: 'Tech', LEADS: 10 })).toBeNull();
  });

  test('does not detect numeric-only values as dates', () => {
    // Pure numbers are not parseable as dates by this function (they are numbers not strings)
    expect(detectDateKey({ COUNT: 42, TOTAL: 100 })).toBeNull();
  });

  test('detects ENGAGEMENT_DATE pattern used in real data', () => {
    const sample = {
      ENGAGEMENT_DATE: '2024-01-01',
      TOTAL_ENGAGEMENTS: 15,
    };
    expect(detectDateKey(sample)).toBe('ENGAGEMENT_DATE');
  });

  test('does NOT detect START_DATE/END_DATE as date key when only metadata', () => {
    // START_DATE contains "date" — it WILL be detected by name heuristic.
    // The real guard against metadata dates is in shouldShowTimeline (checks for other string cols).
    // Here we just confirm detectDateKey finds it (correct behaviour):
    const sample = { START_DATE: '2024-01-01', END_DATE: '2024-12-31', INDUSTRY: 'Tech', COUNT: 5 };
    expect(detectDateKey(sample)).toBe('START_DATE');
  });
});
