import { Test, TestingModule } from '@nestjs/testing';
import { ClientSnowflakeService } from '../client-snowflake.service';
import { ClientRecord } from '../../clients/clients.service';

// ── Mock snowflake-sdk ──────────────────────────────────────────────────────

const mockExecute = jest.fn();
const mockDestroy = jest.fn();
const mockConnect = jest.fn();
const mockConn    = { connect: mockConnect, execute: mockExecute, destroy: mockDestroy };

jest.mock('snowflake-sdk', () => ({
  createConnection: jest.fn(() => mockConn),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const alphaClient: Partial<ClientRecord> = {
  clientSlug:        'alpha',
  snowflakeAccount:  'xy12345.us-east-1',
  snowflakeUser:     'ALPHA_USER',
  snowflakePassword: 'secret',
  snowflakeWarehouse:'COMPUTE_WH',
  snowflakeDatabase: 'ALPHA_DB',
  snowflakeSchema:   'PUBLIC',
};

function resolveConnect() {
  mockConnect.mockImplementationOnce((cb: Function) => cb(null));
}

function rejectConnect(msg = 'Auth failed') {
  mockConnect.mockImplementationOnce((cb: Function) => cb(new Error(msg)));
}

function resolveExecute() {
  mockExecute.mockImplementation(({ complete }: any) => complete(null, null, []));
}

function rejectExecute(sql: string, msg: string) {
  mockExecute.mockImplementationOnce(({ sqlText, complete }: any) => {
    if (sqlText.includes(sql)) complete(new Error(msg), null, null);
    else complete(null, null, []);
  });
}

describe('ClientSnowflakeService', () => {
  let service: ClientSnowflakeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClientSnowflakeService],
    }).compile();
    service = module.get<ClientSnowflakeService>(ClientSnowflakeService);
    jest.clearAllMocks();
  });

  // ── createConnection ────────────────────────────────────────────────────────

  describe('createConnection', () => {
    it('resolves with connection after running USE/CREATE statements', async () => {
      resolveConnect();
      resolveExecute();

      const conn = await service.createConnection(alphaClient as ClientRecord);
      expect(conn).toBe(mockConn);
    });

    it('runs USE WAREHOUSE before CREATE DATABASE', async () => {
      resolveConnect();
      resolveExecute();

      await service.createConnection(alphaClient as ClientRecord);

      const sqls: string[] = mockExecute.mock.calls.map((c: any) => c[0].sqlText);
      const whIdx = sqls.findIndex(s => s.includes('USE WAREHOUSE'));
      const dbIdx = sqls.findIndex(s => s.includes('CREATE DATABASE'));
      expect(whIdx).toBeGreaterThanOrEqual(0);
      expect(dbIdx).toBeGreaterThan(whIdx);
    });

    it('creates database with IF NOT EXISTS', async () => {
      resolveConnect();
      resolveExecute();

      await service.createConnection(alphaClient as ClientRecord);

      const sqls: string[] = mockExecute.mock.calls.map((c: any) => c[0].sqlText);
      expect(sqls.some(s => s.includes('CREATE DATABASE IF NOT EXISTS ALPHA_DB'))).toBe(true);
    });

    it('creates schema with IF NOT EXISTS', async () => {
      resolveConnect();
      resolveExecute();

      await service.createConnection(alphaClient as ClientRecord);

      const sqls: string[] = mockExecute.mock.calls.map((c: any) => c[0].sqlText);
      expect(sqls.some(s => s.includes('CREATE SCHEMA IF NOT EXISTS PUBLIC'))).toBe(true);
    });

    it('rejects when snowflake-sdk connect returns an error', async () => {
      rejectConnect('Invalid credentials');
      await expect(service.createConnection(alphaClient as ClientRecord))
        .rejects.toThrow('Invalid credentials');
    });

    it('rejects and destroys connection when a USE statement fails', async () => {
      resolveConnect();
      mockExecute
        .mockImplementationOnce(({ complete }: any) => complete(new Error('No warehouse'), null, null));
      mockDestroy.mockImplementation((cb: Function) => cb(null));

      await expect(service.createConnection(alphaClient as ClientRecord))
        .rejects.toThrow('No warehouse');
    });

    it('skips USE WAREHOUSE when warehouse is not configured', async () => {
      const clientNoWh = { ...alphaClient, snowflakeWarehouse: undefined };
      resolveConnect();
      resolveExecute();

      await service.createConnection(clientNoWh as ClientRecord);

      const sqls: string[] = mockExecute.mock.calls.map((c: any) => c[0].sqlText);
      expect(sqls.some(s => s.includes('USE WAREHOUSE'))).toBe(false);
    });
  });

  // ── execute ─────────────────────────────────────────────────────────────────

  describe('execute', () => {
    it('resolves with rows on success', async () => {
      const rows = [{ CNT: 5 }];
      mockExecute.mockImplementationOnce(({ complete }: any) => complete(null, null, rows));

      const result = await service.execute(mockConn, 'SELECT COUNT(*) AS CNT FROM T');
      expect(result).toEqual(rows);
    });

    it('resolves with empty array when rows is null', async () => {
      mockExecute.mockImplementationOnce(({ complete }: any) => complete(null, null, null));
      const result = await service.execute(mockConn, 'SELECT 1');
      expect(result).toEqual([]);
    });

    it('rejects on SQL error', async () => {
      mockExecute.mockImplementationOnce(({ complete }: any) =>
        complete(new Error('Table not found'), null, null),
      );
      await expect(service.execute(mockConn, 'SELECT * FROM MISSING')).rejects.toThrow('Table not found');
    });
  });

  // ── destroy ─────────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('resolves after closing the connection', async () => {
      mockDestroy.mockImplementationOnce((cb: Function) => cb(null));
      await expect(service.destroy(mockConn)).resolves.toBeUndefined();
    });

    it('resolves even when destroy returns an error (graceful)', async () => {
      mockDestroy.mockImplementationOnce((cb: Function) => cb(new Error('Already closed')));
      await expect(service.destroy(mockConn)).resolves.toBeUndefined();
    });
  });
});
