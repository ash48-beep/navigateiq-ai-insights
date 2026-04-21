import React, { forwardRef, useState } from 'react';
import { Pie } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend
} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  ChartDataLabels
);

const COLORS = [
  '#6366F1',
  '#22C55E',
  '#F97316',
  '#EF4444',
  '#14B8A6',
  '#0EA5E9',
  '#A855F7',
  '#10B981',
  '#F59E0B',
  '#3B82F6',
  '#9CA3AF'  // "Others" slice — neutral grey, always last
];

const MAX_SLICES = 10;

const DataInsightsPieChart = forwardRef(({ data }, ref) => {
  const [showOthers, setShowOthers] = useState(false);

  if (!Array.isArray(data) || data.length === 0) return null;

  const keys = Object.keys(data[0]);
  const labelKey = keys.find((k) => typeof data[0][k] === 'string');
  const valueKey = keys.find((k) => typeof data[0][k] === 'number');

  if (!labelKey || !valueKey) return null;

  const grouped = {};
  data.forEach((item) => {
    const label = item[labelKey];
    const value = Number(item[valueKey]) || 0;
    grouped[label] = (grouped[label] || 0) + value;
  });

  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES);
  const hasOthers = rest.length > 0;

  if (hasOthers) {
    const othersTotal = rest.reduce((sum, [, v]) => sum + v, 0);
    top.push(['Others', othersTotal]);
  }

  const labels = top.map(([k]) => k);
  const values = top.map(([, v]) => Number(v.toFixed(2)));

  const shouldShowPercentage = /percent|percentage|pct|rate|ratio|share/i.test(valueKey);

  const formatValue = (value) => {
    const num = Number(value) || 0;
    return shouldShowPercentage ? `${num.toFixed(2)}%` : num.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const chartData = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: COLORS,
        borderColor: '#ffffff',
        borderWidth: 2
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '60%',
    onClick: (_, elements) => {
      if (!elements.length) return;
      const clickedLabel = labels[elements[0].index];
      if (clickedLabel === 'Others') {
        setShowOthers(true);
      }
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          boxWidth: 14,
          padding: 12,
          font: { size: 12, weight: '500' }
        }
      },
      tooltip: {
        backgroundColor: '#1f2937',
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (ctx) => {
            const suffix = ctx.label === 'Others' && hasOthers
              ? ` (${rest.length} items — click to view)`
              : '';
            return `${ctx.label}: ${formatValue(ctx.raw)}${suffix}`;
          }
        }
      },
      datalabels: {
        color: '#ffffff',
        font: { size: 12, weight: 'bold' },
        formatter: (value) => formatValue(value)
      }
    }
  };

  // ── Others drill-down panel ──────────────────────────────────────────────
  if (showOthers) {
    return (
      <div style={{ width: '100%' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '10px'
        }}>
          <button
            onClick={() => setShowOthers(false)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: 'none',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              color: '#475569',
              cursor: 'pointer'
            }}
          >
            ← Back to chart
          </button>
          <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b' }}>
            Others — {rest.length} item{rest.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div style={{
          overflowX: 'auto',
          overflowY: 'auto',
          maxHeight: '205px',
          borderRadius: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={thStyle}>{labelKey}</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>{valueKey}</th>
              </tr>
            </thead>
            <tbody>
              {rest.map(([label, value], idx) => (
                <tr
                  key={label}
                  style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8fafc' }}
                >
                  <td style={tdStyle}>{label}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>{formatValue(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Main chart ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {hasOthers && (
        <div style={{
          position: 'absolute',
          bottom: '-24px',
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '12px',
          color: '#9CA3AF',
          whiteSpace: 'nowrap',
          zIndex: 1
        }}>
          Click "Others" slice to see {rest.length} more item{rest.length !== 1 ? 's' : ''}
        </div>
      )}
      <Pie ref={ref} data={chartData} options={options} />
    </div>
  );
});

const thStyle = {
  padding: '9px 14px',
  textAlign: 'left',
  fontWeight: '600',
  fontSize: '12px',
  color: '#475569',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: '1px solid #e2e8f0',
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '8px 14px',
  color: '#334155',
  borderBottom: '1px solid #f1f5f9'
};

export default DataInsightsPieChart;
