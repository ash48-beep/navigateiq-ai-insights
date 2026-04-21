
import { useState } from 'react';
import '../styles/paginated-table.css';

const ROWS_PER_PAGE = 10;

const URL_PATTERN = /url|link|href|uri/i;
const isUrlColumn = (colName) => URL_PATTERN.test(colName);

const PaginatedDataTable = ({ data }) => {
  const [currentPage, setCurrentPage] = useState(1);

  if (!data || data.length === 0) return null;

  const columns = Object.keys(data[0]);
  const totalRows = data.length;
  const totalPages = Math.ceil(totalRows / ROWS_PER_PAGE);

  const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
  const endIndex = Math.min(startIndex + ROWS_PER_PAGE, totalRows);
  const currentRows = data.slice(startIndex, endIndex);

  const handlePrev = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const handleNext = () => setCurrentPage((p) => Math.min(p + 1, totalPages));

  return (
    <div className="paginated-table-wrapper">
      
      {/* SCROLL CONTAINER */}
      <div className="paginated-table-scroll">
        <table className="paginated-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {currentRows.map((row, rowIdx) => (
              <tr key={startIndex + rowIdx}>
                {columns.map((col) => {
                  const val = row[col] ?? '—';
                  return <td key={col}>{val}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* FOOTER */}
      <div className="paginated-table-footer">
        <span>
          {totalPages > 1
            ? `Showing ${startIndex + 1}–${endIndex} of ${totalRows} rows`
            : `${totalRows} row${totalRows !== 1 ? 's' : ''}`}
        </span>

        {totalPages > 1 && (
          <div className="paginated-table-controls">
            <button onClick={handlePrev} disabled={currentPage === 1}>
              ← Prev
            </button>
            <span>{currentPage} / {totalPages}</span>
            <button onClick={handleNext} disabled={currentPage === totalPages}>
              Next →
            </button>
          </div>
        )}
      </div>

    </div>
  );
};

export default PaginatedDataTable;