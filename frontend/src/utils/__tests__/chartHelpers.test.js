import { shouldShowPieChart, shouldShowTimeline, TIMELINE_QUERY_KEYWORDS } from '../chartHelpers';

// ---------------------------------------------------------------------------
// shouldShowPieChart
// ---------------------------------------------------------------------------
describe('shouldShowPieChart', () => {
  test('returns false for empty array', () => {
    expect(shouldShowPieChart([])).toBe(false);
  });

  test('returns false for non-array input', () => {
    expect(shouldShowPieChart(null)).toBe(false);
    expect(shouldShowPieChart(undefined)).toBe(false);
    expect(shouldShowPieChart('string')).toBe(false);
  });

  test('returns true when data has both a string and a number column', () => {
    const data = [{ INDUSTRY: 'Technology', LEAD_COUNT: 42 }];
    expect(shouldShowPieChart(data)).toBe(true);
  });

  test('returns false when data has only numeric columns', () => {
    const data = [{ TOTAL: 100, AVG: 25 }];
    expect(shouldShowPieChart(data)).toBe(false);
  });

  test('returns false when data has only string columns', () => {
    const data = [{ NAME: 'Acme', REGION: 'West' }];
    expect(shouldShowPieChart(data)).toBe(false);
  });

  test('returns true for typical industry-count data', () => {
    const data = [
      { INDUSTRY: 'Finance', COUNT: 30 },
      { INDUSTRY: 'Healthcare', COUNT: 20 },
    ];
    expect(shouldShowPieChart(data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldShowTimeline
// ---------------------------------------------------------------------------
describe('shouldShowTimeline', () => {
  const makeTimeSeries = (n = 4) =>
    Array.from({ length: n }, (_, i) => ({
      ENGAGEMENT_DATE: `2024-0${i + 1}-01`,
      LEAD_COUNT: (i + 1) * 10,
    }));

  test('returns false for empty array', () => {
    expect(shouldShowTimeline([])).toBe(false);
  });

  test('returns false for non-array', () => {
    expect(shouldShowTimeline(null)).toBe(false);
  });

  test('returns false when no date column exists', () => {
    const data = [
      { INDUSTRY: 'Tech', COUNT: 10 },
      { INDUSTRY: 'Finance', COUNT: 20 },
    ];
    expect(shouldShowTimeline(data)).toBe(false);
  });

  test('returns false when no numeric metric exists', () => {
    const data = [
      { ENGAGEMENT_DATE: '2024-01-01', STATUS: 'active' },
      { ENGAGEMENT_DATE: '2024-02-01', STATUS: 'active' },
    ];
    expect(shouldShowTimeline(data)).toBe(false);
  });

  test('returns false when another string column is present (categorical data)', () => {
    const data = [
      { START_DATE: '2024-01-01', INDUSTRY: 'Tech', LEADS: 10 },
      { START_DATE: '2024-02-01', INDUSTRY: 'Finance', LEADS: 20 },
    ];
    expect(shouldShowTimeline(data)).toBe(false);
  });

  test('returns false when only 1 distinct date exists', () => {
    const data = [
      { ENGAGEMENT_DATE: '2024-01-01', LEAD_COUNT: 10 },
      { ENGAGEMENT_DATE: '2024-01-01', LEAD_COUNT: 20 },
    ];
    expect(shouldShowTimeline(data)).toBe(false);
  });

  test('returns true for clean time-series with 4+ distinct dates (no keyword needed)', () => {
    expect(shouldShowTimeline(makeTimeSeries(4))).toBe(true);
  });

  test('returns true when query contains timeline keyword even with only 2 dates', () => {
    const data = [
      { ENGAGEMENT_DATE: '2024-01-01', LEAD_COUNT: 10 },
      { ENGAGEMENT_DATE: '2024-02-01', LEAD_COUNT: 20 },
    ];
    expect(shouldShowTimeline(data, 'show me a timeline of engagements')).toBe(true);
  });

  test('returns true for "trend" keyword in query', () => {
    const data = [
      { MONTH: '2024-01', LEADS: 5 },
      { MONTH: '2024-02', LEADS: 8 },
    ];
    expect(shouldShowTimeline(data, 'show lead trend')).toBe(true);
  });

  test('returns false when distinctDates < 50% of rows (sparse date grouping)', () => {
    // 2 dates out of 10 rows = 20%, threshold is max(3, 10*0.5) = 5 → false without keyword
    const data = Array.from({ length: 10 }, (_, i) => ({
      ENGAGEMENT_DATE: i < 5 ? '2024-01-01' : '2024-02-01',
      LEAD_COUNT: i + 1,
    }));
    expect(shouldShowTimeline(data, '')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TIMELINE_QUERY_KEYWORDS regex
// ---------------------------------------------------------------------------
describe('TIMELINE_QUERY_KEYWORDS', () => {
  const matches = [
    'show me a timeline of leads',
    'lead trend over last quarter',
    'show data over time',
    'by month breakdown',
    'by week',
    'history of engagements',
    'progression of leads',
    'engagement time series',
    'activity over time',
  ];

  const nonMatches = [
    'top 10 accounts',
    'which industry has most leads',
    'show me the lead count',
    'total revenue by region',
  ];

  test.each(matches)('matches: %s', (q) => {
    expect(TIMELINE_QUERY_KEYWORDS.test(q)).toBe(true);
  });

  test.each(nonMatches)('does not match: %s', (q) => {
    expect(TIMELINE_QUERY_KEYWORDS.test(q)).toBe(false);
  });
});
