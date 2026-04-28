import { Injectable } from '@nestjs/common';

export interface ColumnAnalysis {
  originalName: string;
  sanitizedName: string;
  detectedType: 'date' | 'numeric' | 'varchar';
  dateFormat?: string;  // Snowflake format string e.g. 'DD-MM-YYYY'
  confident: boolean;   // false = ambiguous day/month order
}

export interface CsvAnalysisResult {
  headers: string[];
  sanitizedHeaders: string[];
  rowCount: number;
  columns: ColumnAnalysis[];
}

const DATE_PATTERNS: { regex: RegExp; format: string; ambiguous: boolean }[] = [
  // Unambiguous — year first
  { regex: /^\d{4}-\d{2}-\d{2}$/, format: 'YYYY-MM-DD', ambiguous: false },
  { regex: /^\d{4}\/\d{2}\/\d{2}$/, format: 'YYYY/MM/DD', ambiguous: false },
  { regex: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, format: 'YYYY-MM-DD HH24:MI:SS', ambiguous: false },
  { regex: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, format: 'YYYY-MM-DD"T"HH24:MI:SS', ambiguous: false },
  // Ambiguous — day/month could be swapped
  { regex: /^\d{2}-\d{2}-\d{4}$/, format: 'DD-MM-YYYY', ambiguous: true },
  { regex: /^\d{2}\/\d{2}\/\d{4}$/, format: 'DD/MM/YYYY', ambiguous: true },
  { regex: /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/, format: 'DD-MM-YYYY HH24:MI:SS', ambiguous: true },
  { regex: /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/, format: 'DD/MM/YYYY HH24:MI:SS', ambiguous: true },
];

@Injectable()
export class CsvAnalyzerService {

  /**
   * Analyze a CSV buffer: detect headers, column types, and date formats.
   * @param buffer        Raw CSV file content
   * @param existingConfig Saved dateColumns config from ClientRegistry (overrides auto-detect)
   */
  analyze(buffer: Buffer, existingConfig: Record<string, string> = {}): CsvAnalysisResult {
    const { headers, rows } = this.parseCSV(buffer);
    const sanitizedHeaders = headers.map(h => this.sanitizeColName(h));

    const columns: ColumnAnalysis[] = headers.map((header, colIdx) => {
      const sanitized = sanitizedHeaders[colIdx];

      // If admin has already confirmed the format for this column, trust it
      if (existingConfig[sanitized]) {
        return {
          originalName: header,
          sanitizedName: sanitized,
          detectedType: 'date',
          dateFormat: existingConfig[sanitized],
          confident: true,
        };
      }

      // Collect non-null values from sample rows
      const values = rows
        .map(row => row[colIdx]?.trim())
        .filter(v => v && v !== '' && v.toLowerCase() !== 'null');

      if (values.length === 0) {
        return { originalName: header, sanitizedName: sanitized, detectedType: 'varchar', confident: true };
      }

      // Try date detection first
      const dateResult = this.detectDateFormat(values);
      if (dateResult) {
        return {
          originalName: header,
          sanitizedName: sanitized,
          detectedType: 'date',
          dateFormat: dateResult.format,
          confident: dateResult.confident,
        };
      }

      // Try numeric detection
      if (this.isNumeric(values)) {
        return { originalName: header, sanitizedName: sanitized, detectedType: 'numeric', confident: true };
      }

      return { originalName: header, sanitizedName: sanitized, detectedType: 'varchar', confident: true };
    });

    return { headers, sanitizedHeaders, rowCount: rows.length, columns };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private detectDateFormat(values: string[]): { format: string; confident: boolean } | null {
    for (const pattern of DATE_PATTERNS) {
      if (values.every(v => pattern.regex.test(v))) {
        if (!pattern.ambiguous) {
          return { format: pattern.format, confident: true };
        }
        return this.disambiguateDayMonth(values, pattern.format);
      }
    }
    return null;
  }

  private disambiguateDayMonth(
    values: string[],
    defaultFormat: string,
  ): { format: string; confident: boolean } {
    for (const val of values) {
      const parts = val.split(/[-\/]/);
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);

      if (first > 12) {
        // First segment > 12 → can only be a day → DD-MM-YYYY confirmed
        return { format: defaultFormat, confident: true };
      }
      if (second > 12) {
        // Second segment > 12 → can only be a day → MM-DD format
        const mmddFormat = defaultFormat
          .replace('DD-MM', 'MM-DD')
          .replace('DD/MM', 'MM/DD');
        return { format: mmddFormat, confident: true };
      }
    }
    // Both segments always ≤ 12 — can't determine, default to DD-MM (mark unconfident)
    return { format: defaultFormat, confident: false };
  }

  private isNumeric(values: string[]): boolean {
    return values.every(v => /^-?\d+(\.\d+)?$/.test(v));
  }

  /** Convert any CSV header to a safe Snowflake identifier */
  sanitizeColName(name: string): string {
    return name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Minimal CSV parser — handles quoted fields and escaped quotes.
   * Reads headers + first 100 data rows (enough for type detection).
   */
  parseCSV(buffer: Buffer): { headers: string[]; rows: string[][] } {
    const text = buffer.toString('utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());

    const parseLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };

    if (lines.length === 0) return { headers: [], rows: [] };

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1, 101).map(parseLine);
    return { headers, rows };
  }
}
