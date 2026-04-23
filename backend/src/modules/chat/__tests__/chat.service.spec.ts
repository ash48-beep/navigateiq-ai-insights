import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from './chat.service';
import { SnowflakeAnalystService } from '../snowflake-analyst/snowflake-analyst.service';
import { OpenAIService, EnhanceResult } from '../openai/openai.service';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';

// ─── Typed mock helpers ────────────────────────────────────────────────────
const cortexOk = (overrides: Record<string, any> = {}) => ({
  explanation: 'ok',
  sql: 'SELECT 1',
  suggestions: [] as string[],
  results: [] as any[],
  request_id: 'req-test',
  raw: {},
  queryError: null,
  ...overrides,
});

const enhanceOk = (overrides: Partial<EnhanceResult> = {}): EnhanceResult => ({
  success: true,
  markdown: null,
  technical_insights: null,
  ...overrides,
});

jest.mock('fs');
jest.mock('fs/promises');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockFsPromises = fsPromises as jest.Mocked<typeof fsPromises>;

describe('ChatService', () => {
  let service: ChatService;
  let snowflake: jest.Mocked<SnowflakeAnalystService>;
  let openai: jest.Mocked<OpenAIService>;

  beforeEach(async () => {
    snowflake = {
      ask: jest.fn(),
    } as any;

    openai = {
      enhanceResponse: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: SnowflakeAnalystService, useValue: snowflake },
        { provide: OpenAIService, useValue: openai },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── processMessage ────────────────────────────────────────────────────────
  describe('processMessage', () => {
    test('returns enhanced response when snowflake returns data', async () => {
      const cortexResult = cortexOk({
        explanation: 'Here are the results',
        results: [{ INDUSTRY: 'Tech', COUNT: 10 }],
        sql: 'SELECT * FROM leads',
        request_id: 'req-1',
      });
      const enhanced = enhanceOk({ markdown: 'enhanced result' });

      snowflake.ask.mockResolvedValue(cortexResult);
      openai.enhanceResponse.mockResolvedValue(enhanced);
      // saveQueryToFile uses fs — mock it
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      const result = await service.processMessage('show leads by industry', 'sess-1');

      expect(snowflake.ask).toHaveBeenCalledWith('show leads by industry', true, []);
      expect(openai.enhanceResponse).toHaveBeenCalled();
      expect(result).toEqual(enhanced);
    });

    test('returns suggestions response when cortex returns suggestions', async () => {
      const cortexResult = cortexOk({
        suggestions: ['By industry?', 'By region?'],
        explanation: 'Your question is ambiguous.',
      });
      snowflake.ask.mockResolvedValue(cortexResult);
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      const result = await service.processMessage('show me data', 'sess-2');

      const r = result as any;
      expect(r.type).toBe('suggestions');
      expect(r.suggestions).toEqual(['By industry?', 'By region?']);
      // openai should NOT be called for suggestions
      expect(openai.enhanceResponse).not.toHaveBeenCalled();
    });

    test('passes conversation history to snowflake on subsequent calls', async () => {
      const cortexResult = cortexOk({ results: [{ INDUSTRY: 'Tech', COUNT: 5 }] });
      snowflake.ask.mockResolvedValue(cortexResult);
      openai.enhanceResponse.mockResolvedValue(enhanceOk());
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      // First call — history is empty
      await service.processMessage('first question', 'sess-hist');
      // Second call — should include first turn in history
      await service.processMessage('follow up question', 'sess-hist');

      const secondCallHistory = snowflake.ask.mock.calls[1][2] as any[];
      expect(secondCallHistory.length).toBeGreaterThan(0);
      expect(secondCallHistory[0].role).toBe('user');
    });

    test('works without a sessionId (stateless mode)', async () => {
      snowflake.ask.mockResolvedValue(cortexOk());
      openai.enhanceResponse.mockResolvedValue(enhanceOk());
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      await expect(service.processMessage('test', undefined)).resolves.toMatchObject({ success: true });
      expect(snowflake.ask).toHaveBeenCalledWith('test', true, []);
    });

    test('throws InternalServerErrorException when snowflake throws', async () => {
      snowflake.ask.mockRejectedValue(new Error('Snowflake connection failed'));

      await expect(service.processMessage('query', 'sess-err')).rejects.toThrow(
        'Snowflake connection failed'
      );
    });
  });

  // ─── Session management ────────────────────────────────────────────────────
  describe('session history management', () => {
    test('history is empty for an unknown session', async () => {
      snowflake.ask.mockResolvedValue(cortexOk());
      openai.enhanceResponse.mockResolvedValue(enhanceOk());
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      await service.processMessage('hello', 'brand-new-session');
      // The very first call should pass an empty history array
      expect(snowflake.ask.mock.calls[0][2]).toEqual([]);
    });

    test('different sessions do not share history', async () => {
      snowflake.ask.mockResolvedValue(cortexOk({ results: [{ V: 1 }] }));
      openai.enhanceResponse.mockResolvedValue(enhanceOk());
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      await service.processMessage('session A question', 'session-A');
      await service.processMessage('session B question', 'session-B');

      // Session B's first call should have empty history (no crossover)
      const sessionBHistory = snowflake.ask.mock.calls[1][2] as any[];
      expect(sessionBHistory).toEqual([]);
    });
  });

  // ─── saveQueryToFile ───────────────────────────────────────────────────────
  describe('saveQueryToFile (fire-and-forget)', () => {
    test('writes a new file when no existing log file is present', async () => {
      snowflake.ask.mockResolvedValue(cortexOk());
      openai.enhanceResponse.mockResolvedValue(enhanceOk());
      mockFs.existsSync.mockReturnValue(false);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      await service.processMessage('log this query', 'sess-log');

      // Allow the setImmediate to fire
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve)); // double-flush

      expect(mockFsPromises.writeFile).toHaveBeenCalled();
      // Use the last call — earlier tests may have also triggered fire-and-forget writes
      const lastCall = mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
      const written = JSON.parse(lastCall[1] as string);
      expect(written[written.length - 1].query).toBe('log this query');
    });

    test('appends to existing log and trims when over MAX_ENTRIES', async () => {
      // Simulate existing 1000 entries
      const existing = Array.from({ length: 1000 }, (_, i) => ({
        query: `old query ${i}`,
        sessionId: null,
        timestamp: new Date().toISOString(),
      }));

      snowflake.ask.mockResolvedValue(cortexOk());
      openai.enhanceResponse.mockResolvedValue(enhanceOk());
      mockFs.existsSync.mockReturnValue(true);
      mockFsPromises.readFile.mockResolvedValue(JSON.stringify(existing) as any);
      mockFsPromises.writeFile.mockResolvedValue(undefined);

      await service.processMessage('new query', 'sess-trim');
      await new Promise((resolve) => setImmediate(resolve));

      const written = JSON.parse(
        (mockFsPromises.writeFile.mock.calls[0][1] as string)
      );
      // After adding 1 to 1000 entries → 1001 total → trims to 800
      expect(written.length).toBe(800);
      // The new query should be the last entry
      expect(written[written.length - 1].query).toBe('new query');
    });
  });
});
