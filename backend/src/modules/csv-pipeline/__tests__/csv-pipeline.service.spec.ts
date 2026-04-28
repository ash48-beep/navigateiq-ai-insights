import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CsvPipelineService } from '../csv-pipeline.service';
import { CsvAnalyzerService } from '../csv-analyzer.service';
import { ClientSnowflakeService } from '../client-snowflake.service';
import { ClientsService } from '../../clients/clients.service';
import { SnowflakeAnalystService } from '../../snowflake-analyst/snowflake-analyst.service';
import { OpenAIService } from '../../openai/openai.service';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

jest.mock('fs');
jest.mock('os', () => ({ tmpdir: () => '/tmp' }));
jest.mock('path', () => ({ join: (...args: string[]) => args.join('/') }));

// ── Mock data ─────────────────────────────────────────────────────────────────

const mockClient = {
  clientSlug:        'alpha',
  name:              'Alpha',
  snowflakeAccount:  'xy12345',
  snowflakeUser:     'USER',
  snowflakePassword: 'pass',
  snowflakeWarehouse:'WH',
  snowflakeDatabase: 'ALPHA_DB',
  snowflakeSchema:   'PUBLIC',
  snowflakeTable:    'ALPHA_DATA',
  snowflakeStageName:'CSV_STAGE',
  idPrefix:          'L-',
  dateColumns:       {},
};

const mockAnalysis = {
  headers:          ['Name', 'Revenue', 'Join Date'],
  sanitizedHeaders: ['NAME', 'REVENUE', 'JOIN_DATE'],
  rowCount:         30,
  columns: [
    { originalName: 'Name',      sanitizedName: 'NAME',      detectedType: 'varchar' as const, confident: true },
    { originalName: 'Revenue',   sanitizedName: 'REVENUE',   detectedType: 'numeric' as const, confident: true },
    { originalName: 'Join Date', sanitizedName: 'JOIN_DATE', detectedType: 'date'    as const, dateFormat: 'YYYY-MM-DD', confident: true },
  ],
};

const mockConn = {};
const csvBuffer = Buffer.from('Name,Revenue,Join Date\nAlpha,5000,2026-01-01');

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAnalyzer: Partial<CsvAnalyzerService> = {
  analyze: jest.fn().mockReturnValue(mockAnalysis),
};

const mockSfExecute = jest.fn();
const mockSfService: Partial<ClientSnowflakeService> = {
  createConnection: jest.fn().mockResolvedValue(mockConn),
  execute:          mockSfExecute,
  destroy:          jest.fn().mockResolvedValue(undefined),
};

const mockClientsService = {
  getClient:    jest.fn().mockResolvedValue(mockClient),
  updateClient: jest.fn().mockResolvedValue(undefined),
};

const mockAnalystService = {
  uploadAndReloadModel: jest.fn().mockResolvedValue(undefined),
};

const mockOpenaiService = {
  enrichSemanticModel: jest.fn().mockResolvedValue('enriched-yaml-content'),
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('CsvPipelineService', () => {
  let service: CsvPipelineService;

  beforeEach(async () => {
    // Default execute: COUNT returns 30 rows, everything else returns []
    mockSfExecute.mockImplementation((_conn: any, sql: string) => {
      if (sql.includes('COUNT(*)') && sql.includes('STAGING')) {
        return Promise.resolve([{ CNT: 30 }]);
      }
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve([{ CNT: 0 }]);
      }
      return Promise.resolve([]);
    });

    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.unlinkSync   as jest.Mock).mockImplementation(() => {});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CsvPipelineService,
        { provide: CsvAnalyzerService,       useValue: mockAnalyzer       },
        { provide: ClientSnowflakeService,   useValue: mockSfService      },
        { provide: ClientsService,           useValue: mockClientsService  },
        { provide: SnowflakeAnalystService,  useValue: mockAnalystService  },
        { provide: OpenAIService,            useValue: mockOpenaiService   },
      ],
    }).compile();

    service = module.get<CsvPipelineService>(CsvPipelineService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Config validation ───────────────────────────────────────────────────────

  describe('Snowflake config validation', () => {
    it('throws BadRequestException when snowflakeAccount is missing', async () => {
      mockClientsService.getClient.mockResolvedValueOnce({ ...mockClient, snowflakeAccount: undefined });
      await expect(service.uploadAndLoad('alpha', csvBuffer, 'data.csv'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when snowflakeTable is missing', async () => {
      mockClientsService.getClient.mockResolvedValueOnce({ ...mockClient, snowflakeTable: undefined });
      await expect(service.uploadAndLoad('alpha', csvBuffer, 'data.csv'))
        .rejects.toThrow(BadRequestException);
    });

    it('error message lists all missing fields', async () => {
      mockClientsService.getClient.mockResolvedValueOnce({
        ...mockClient,
        snowflakeUser:     undefined,
        snowflakePassword: undefined,
      });
      await expect(service.uploadAndLoad('alpha', csvBuffer, 'data.csv'))
        .rejects.toThrow(/User.*Password|Password.*User/);
    });
  });

  // ── Snowflake execution flow ────────────────────────────────────────────────

  describe('Snowflake execution flow', () => {
    it('connects to client Snowflake', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(mockSfService.createConnection).toHaveBeenCalledWith(mockClient);
    });

    it('creates internal stage IF NOT EXISTS', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      const sqls = mockSfExecute.mock.calls.map((c: any) => c[1] as string);
      expect(sqls.some(s => s.includes('CREATE STAGE IF NOT EXISTS'))).toBe(true);
    });

    it('creates file format', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      const sqls = mockSfExecute.mock.calls.map((c: any) => c[1] as string);
      expect(sqls.some(s => s.includes('CREATE OR REPLACE FILE FORMAT'))).toBe(true);
    });

    it('creates final typed table with CREATE OR REPLACE TABLE', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      const sqls = mockSfExecute.mock.calls.map((c: any) => c[1] as string);
      expect(sqls.some(s => s.includes('CREATE OR REPLACE TABLE ALPHA_DATA'))).toBe(true);
    });

    it('drops the staging table after final table creation', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      const sqls = mockSfExecute.mock.calls.map((c: any) => c[1] as string);
      expect(sqls.some(s => s.includes('DROP TABLE IF EXISTS'))).toBe(true);
    });

    it('destroys the connection in the finally block', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(mockSfService.destroy).toHaveBeenCalledWith(mockConn);
    });

    it('destroys connection even when an execute call throws', async () => {
      mockSfExecute.mockRejectedValueOnce(new Error('Stage error'));
      await expect(service.uploadAndLoad('alpha', csvBuffer, 'data.csv')).rejects.toThrow();
      expect(mockSfService.destroy).toHaveBeenCalled();
    });
  });

  // ── Return value ────────────────────────────────────────────────────────────

  describe('return value', () => {
    it('returns rowsLoaded, tableName, and columnsDetected', async () => {
      const result = await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(result.rowsLoaded).toBe(30);
      expect(result.tableName).toBe('ALPHA_DATA');
      expect(result.columnsDetected).toHaveLength(3);
    });

    it('columnsDetected includes name, type, and format', async () => {
      const result = await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      const dateCol = result.columnsDetected.find(c => c.name === 'JOIN_DATE')!;
      expect(dateCol.type).toBe('date');
      expect(dateCol.format).toBe('YYYY-MM-DD');
    });

    it('returns empty warnings when no nulls in typed columns', async () => {
      const result = await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(result.warnings).toHaveLength(0);
    });

    it('returns a warning when a typed column has nulls', async () => {
      mockSfExecute.mockImplementation((_conn: any, sql: string) => {
        if (sql.includes('COUNT(*)') && sql.includes('STAGING'))  return Promise.resolve([{ CNT: 30 }]);
        if (sql.includes('COUNT(*)') && sql.includes('REVENUE'))  return Promise.resolve([{ CNT: 5 }]);
        if (sql.includes('COUNT(*)') && sql.includes('JOIN_DATE'))return Promise.resolve([{ CNT: 0 }]);
        return Promise.resolve([]);
      });
      const result = await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].column).toBe('REVENUE');
    });
  });

  // ── Date column persistence ─────────────────────────────────────────────────

  describe('date column persistence', () => {
    it('saves detected date formats back to ClientRegistry', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(mockClientsService.updateClient).toHaveBeenCalledWith(
        'alpha',
        expect.objectContaining({ dateColumns: expect.objectContaining({ JOIN_DATE: 'YYYY-MM-DD' }) }),
      );
    });
  });

  // ── Semantic model generation ───────────────────────────────────────────────

  describe('semantic model generation', () => {
    it('calls enrichSemanticModel with column names and types', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(mockOpenaiService.enrichSemanticModel).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([
          expect.objectContaining({ name: 'NAME',      type: 'varchar' }),
          expect.objectContaining({ name: 'REVENUE',   type: 'numeric' }),
          expect.objectContaining({ name: 'JOIN_DATE', type: 'date'    }),
        ]),
        'Alpha',
        'ALPHA_DATA',
        'ALPHA_DB',
        'PUBLIC',
      );
    });

    it('uploads enriched YAML to the analyst stage', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(mockAnalystService.uploadAndReloadModel).toHaveBeenCalledWith(
        'enriched-yaml-content',
        'alpha_semantic_model',
      );
    });

    it('base YAML includes fully-qualified base_table reference', async () => {
      let capturedBaseYaml = '';
      mockOpenaiService.enrichSemanticModel.mockImplementationOnce((baseYaml: string) => {
        capturedBaseYaml = baseYaml;
        return Promise.resolve(baseYaml);
      });

      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');

      const model: any = yaml.load(capturedBaseYaml);
      expect(model.tables[0].base_table).toEqual({
        database: 'ALPHA_DB',
        schema:   'PUBLIC',
        table:    'ALPHA_DATA',
      });
    });

    it('base YAML puts numeric columns in facts and others in dimensions', async () => {
      let capturedBaseYaml = '';
      mockOpenaiService.enrichSemanticModel.mockImplementationOnce((baseYaml: string) => {
        capturedBaseYaml = baseYaml;
        return Promise.resolve(baseYaml);
      });

      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');

      const model: any = yaml.load(capturedBaseYaml);
      const tbl = model.tables[0];
      const dimNames  = (tbl.dimensions || []).map((d: any) => d.name);
      const factNames = (tbl.facts      || []).map((f: any) => f.name);
      expect(dimNames).toContain('name');
      expect(dimNames).toContain('join_date');
      expect(factNames).toContain('revenue');
    });

    it('does not throw when semantic model upload fails (non-fatal)', async () => {
      mockAnalystService.uploadAndReloadModel.mockRejectedValueOnce(new Error('Stage PUT failed'));
      await expect(service.uploadAndLoad('alpha', csvBuffer, 'data.csv')).resolves.toBeDefined();
    });
  });

  // ── Temp file cleanup ───────────────────────────────────────────────────────

  describe('temp file cleanup', () => {
    it('writes temp CSV file before upload', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('csv_alpha_'),
        csvBuffer,
      );
    });

    it('deletes temp file in finally block', async () => {
      await service.uploadAndLoad('alpha', csvBuffer, 'data.csv');
      expect(fs.unlinkSync).toHaveBeenCalled();
    });
  });
});
