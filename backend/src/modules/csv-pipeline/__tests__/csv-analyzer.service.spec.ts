import { Test, TestingModule } from '@nestjs/testing';
import { CsvAnalyzerService } from '../csv-analyzer.service';

function makeCsv(...rows: string[][]): Buffer {
  const header = rows[0].join(',');
  const data   = rows.slice(1).map(r => r.join(',')).join('\n');
  return Buffer.from([header, data].join('\n'), 'utf-8');
}

describe('CsvAnalyzerService', () => {
  let service: CsvAnalyzerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CsvAnalyzerService],
    }).compile();
    service = module.get<CsvAnalyzerService>(CsvAnalyzerService);
  });

  // ── sanitizeColName ─────────────────────────────────────────────────────────

  describe('sanitizeColName', () => {
    it('uppercases and replaces spaces with underscores', () => {
      expect(service.sanitizeColName('lead source')).toBe('LEAD_SOURCE');
    });

    it('strips leading and trailing underscores', () => {
      expect(service.sanitizeColName(' revenue ')).toBe('REVENUE');
    });

    it('collapses consecutive special chars to single underscore', () => {
      expect(service.sanitizeColName('first--name')).toBe('FIRST_NAME');
    });

    it('removes non-alphanumeric characters', () => {
      expect(service.sanitizeColName('cost ($)')).toBe('COST');
    });
  });

  // ── Date detection ──────────────────────────────────────────────────────────

  describe('date detection', () => {
    it('detects YYYY-MM-DD as date with confident flag', () => {
      const csv = makeCsv(
        ['id', 'event_date'],
        ['1', '2026-01-15'],
        ['2', '2026-02-20'],
      );
      const result = service.analyze(csv);
      const col = result.columns.find(c => c.sanitizedName === 'EVENT_DATE')!;
      expect(col.detectedType).toBe('date');
      expect(col.dateFormat).toBe('YYYY-MM-DD');
      expect(col.confident).toBe(true);
    });

    it('detects DD-MM-YYYY as date', () => {
      const csv = makeCsv(
        ['date'],
        ['15-01-2026'],
        ['20-02-2026'],
      );
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('date');
      expect(result.columns[0].dateFormat).toBe('DD-MM-YYYY');
    });

    it('marks ambiguous day/month as not confident when all values ≤ 12', () => {
      const csv = makeCsv(
        ['date'],
        ['01-02-2026'],
        ['03-04-2026'],
      );
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('date');
      expect(result.columns[0].confident).toBe(false);
    });

    it('disambiguates day/month when first segment > 12', () => {
      const csv = makeCsv(
        ['date'],
        ['25-01-2026'],
        ['30-06-2026'],
      );
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('date');
      expect(result.columns[0].confident).toBe(true);
      expect(result.columns[0].dateFormat).toBe('DD-MM-YYYY');
    });

    it('trusts existing date config over auto-detection', () => {
      const csv = makeCsv(
        ['created_at'],
        ['15-01-2026'],
      );
      const result = service.analyze(csv, { CREATED_AT: 'MM-DD-YYYY' });
      expect(result.columns[0].dateFormat).toBe('MM-DD-YYYY');
      expect(result.columns[0].confident).toBe(true);
    });
  });

  // ── Numeric detection ───────────────────────────────────────────────────────

  describe('numeric detection', () => {
    it('detects integer columns as numeric', () => {
      const csv = makeCsv(['revenue'], ['1000'], ['2500'], ['750']);
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('numeric');
    });

    it('detects decimal columns as numeric', () => {
      const csv = makeCsv(['score'], ['1.5'], ['2.75'], ['0.5']);
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('numeric');
    });

    it('detects negative numbers as numeric', () => {
      const csv = makeCsv(['delta'], ['-100'], ['-50'], ['200']);
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('numeric');
    });

    it('falls back to varchar when mixed numeric and text', () => {
      const csv = makeCsv(['value'], ['100'], ['N/A'], ['200']);
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('varchar');
    });
  });

  // ── Varchar detection ───────────────────────────────────────────────────────

  describe('varchar detection', () => {
    it('classifies text columns as varchar', () => {
      const csv = makeCsv(['name'], ['Alice'], ['Bob'], ['Charlie']);
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('varchar');
    });

    it('classifies empty columns as varchar', () => {
      const csv = makeCsv(['notes'], [''], [''], ['']);
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('varchar');
    });
  });

  // ── Full analysis ───────────────────────────────────────────────────────────

  describe('analyze', () => {
    it('returns correct column count and sanitized headers', () => {
      const csv = makeCsv(
        ['Lead ID', 'Revenue', 'Download Date'],
        ['L-001', '5000', '2026-01-15'],
        ['L-002', '3000', '2026-02-20'],
      );
      const result = service.analyze(csv);
      expect(result.columns).toHaveLength(3);
      expect(result.sanitizedHeaders).toEqual(['LEAD_ID', 'REVENUE', 'DOWNLOAD_DATE']);
    });

    it('returns rowCount for sample rows', () => {
      const rows: string[][] = [['id', 'val']];
      for (let i = 0; i < 10; i++) rows.push([String(i), String(i * 10)]);
      const result = service.analyze(makeCsv(...rows));
      expect(result.rowCount).toBe(10);
    });

    it('handles mixed column types correctly', () => {
      const csv = makeCsv(
        ['name', 'score', 'joined'],
        ['Alpha', '95', '2026-01-01'],
        ['Beta',  '80', '2026-02-01'],
      );
      const result = service.analyze(csv);
      expect(result.columns[0].detectedType).toBe('varchar');
      expect(result.columns[1].detectedType).toBe('numeric');
      expect(result.columns[2].detectedType).toBe('date');
    });
  });
});
