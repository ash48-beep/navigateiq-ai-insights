import React, { useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Detect which key in a data row looks like a date/time.
 * Exported so Chatbot.js can reuse it for detection.
 */
export const detectDateKey = (sample) => {
  if (!sample) return null;
  const DATE_KEYWORDS = /date|time|month|week|day|year|period|quarter|ts|created|updated|_at$/i;

  // 1. Key name heuristic
  for (const k of Object.keys(sample)) {
    if (DATE_KEYWORDS.test(k)) return k;
  }
  // 2. Value looks like a date string
  for (const [k, v] of Object.entries(sample)) {
    if (typeof v === 'string' && !isNaN(Date.parse(v))) return k;
  }
  return null;
};

const detectMetricKeys = (sample, dateKey) =>
  Object.keys(sample).filter((k) => k !== dateKey && typeof sample[k] === 'number');

const formatDateLabel = (raw) => {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return String(raw);
  const s = String(raw);
  // Year-Month only  e.g. "2024-01"
  if (/^\d{4}-\d{2}$/.test(s.trim())) {
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ─── Palette ────────────────────────────────────────────────────────────────
const PALETTE = [
  { line: '#2A598F', fill: 'rgba(42,89,143,0.15)' },
  { line: '#22C55E', fill: 'rgba(34,197,94,0.15)' },
  { line: '#F97316', fill: 'rgba(249,115,22,0.15)' },
  { line: '#A855F7', fill: 'rgba(168,85,247,0.15)' },
  { line: '#EF4444', fill: 'rgba(239,68,68,0.15)' },
  { line: '#14B8A6', fill: 'rgba(20,184,166,0.15)' },
];

// ─── Main Component ──────────────────────────────────────────────────────────
const TimelineChart = ({ data }) => {
  const [hiddenKeys, setHiddenKeys] = useState({});

  if (!Array.isArray(data) || data.length === 0) return null;

  const sample = data[0];
  const dateKey = detectDateKey(sample);
  const metricKeys = detectMetricKeys(sample, dateKey);

  if (!dateKey || metricKeys.length === 0) return null;

  // Sort ascending by date
  const sorted = [...data].sort((a, b) => {
    const da = new Date(a[dateKey]);
    const db = new Date(b[dateKey]);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    return String(a[dateKey]).localeCompare(String(b[dateKey]));
  });

  const labels = sorted.map((row) => formatDateLabel(row[dateKey]));

  const datasets = metricKeys
    .filter((k) => !hiddenKeys[k])
    .map((k, i) => ({
      label: k,
      data: sorted.map((row) => Number(row[k]) || 0),
      borderColor: PALETTE[i % PALETTE.length].line,
      backgroundColor: PALETTE[i % PALETTE.length].fill,
      pointBackgroundColor: PALETTE[i % PALETTE.length].line,
      pointRadius: 4,
      pointHoverRadius: 6,
      borderWidth: 2,
      fill: true,
      tension: 0.35,
    }));

  const chartData = { labels, datasets };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: metricKeys.length > 1,
        position: 'top',
        labels: {
          boxWidth: 12,
          padding: 10,
          font: { size: 12, weight: '500' },
        },
      },
      tooltip: {
        backgroundColor: '#1f2937',
        padding: 10,
        cornerRadius: 6,
        titleFont: { size: 12, weight: 'bold' },
        bodyFont: { size: 12 },
        callbacks: {
          label: (ctx) =>
            ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: '#f3f4f6' },
        ticks: {
          font: { size: 11 },
          color: '#6b7280',
          maxRotation: 35,
          autoSkip: true,
          maxTicksLimit: 10,
        },
      },
      y: {
        grid: { color: '#f3f4f6' },
        ticks: {
          font: { size: 11 },
          color: '#6b7280',
          callback: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v),
        },
        beginAtZero: true,
      },
    },
  };

  const toggleKey = (k) => setHiddenKeys((prev) => ({ ...prev, [k]: !prev[k] }));

  return (
    <div style={{ width: '100%', marginTop: '12px' }}>
      {/* Metric toggle pills (only shown when multiple metrics) */}
      {metricKeys.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
          {metricKeys.map((k, i) => {
            const color = PALETTE[i % PALETTE.length].line;
            const hidden = !!hiddenKeys[k];
            return (
              <button
                key={k}
                onClick={() => toggleKey(k)}
                style={{
                  padding: '3px 11px',
                  borderRadius: '999px',
                  border: `1.5px solid ${color}`,
                  background: hidden ? 'transparent' : color,
                  color: hidden ? color : '#fff',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.18s',
                }}
              >
                {k}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ height: '220px', width: '100%' }}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
};

export default TimelineChart;
