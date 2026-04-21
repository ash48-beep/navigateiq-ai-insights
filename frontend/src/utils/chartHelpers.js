import { detectDateKey } from '../components/TimelineChart';

/**
 * Returns true when the data has at least one string column and one numeric column.
 * Used to decide whether to render a Pie chart.
 */
export const shouldShowPieChart = (data) => {
  if (!Array.isArray(data) || data.length === 0) return false;
  const sample = data[0];
  const hasString = Object.values(sample).some((v) => typeof v === 'string');
  const hasNumber = Object.values(sample).some((v) => typeof v === 'number');
  return hasString && hasNumber;
};

// Keywords in the user query that suggest a timeline/trend chart
export const TIMELINE_QUERY_KEYWORDS =
  /timeline|trend|over time|by (date|month|week|day|year|quarter)|history|progression|engagement.*time|time.*engagement|activity.*time|time.*activity/i;

/**
 * Returns true ONLY when:
 * 1. A date/time column exists in the data
 * 2. At least one numeric metric exists
 * 3. There are NO other string columns (if INDUSTRY, ACCOUNT_NAME etc. are present,
 *    those are the real labels → use pie chart instead)
 * 4. The date column has 2+ distinct values (not just metadata boundary dates)
 * 5. The query contains timeline keywords OR the date column is clearly the primary axis
 */
export const shouldShowTimeline = (data, query = '') => {
  if (!Array.isArray(data) || data.length === 0) return false;
  const sample = data[0];
  const dateKey = detectDateKey(sample);
  if (!dateKey) return false;

  const hasMetric = Object.entries(sample).some(
    ([k, v]) => k !== dateKey && typeof v === 'number'
  );
  if (!hasMetric) return false;

  const hasOtherStringCol = Object.entries(sample).some(
    ([k, v]) => k !== dateKey && typeof v === 'string'
  );
  if (hasOtherStringCol) return false;

  const distinctDates = new Set(data.map((r) => r[dateKey])).size;
  if (distinctDates < 2) return false;

  return (
    TIMELINE_QUERY_KEYWORDS.test(query) ||
    distinctDates >= Math.max(3, data.length * 0.5)
  );
};
