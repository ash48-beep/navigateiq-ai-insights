import { Test, TestingModule } from '@nestjs/testing';
import { ChatService } from '../chat.service';
import { SnowflakeAnalystService } from '../../snowflake-analyst/snowflake-analyst.service';
import { OpenAIService, EnhanceResult } from '../../openai/openai.service';

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

describe('ChatService', () => {
  let service: ChatService;
  let snowflake: jest.Mocked<SnowflakeAnalystService>;
  let openai: jest.Mocked<OpenAIService>;

  beforeEach(async () => {
    snowflake = { ask: jest.fn() } as any;
    openai    = { enhanceResponse: jest.fn() } as any;

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

      const result = await service.processMessage('show leads by industry', 'sess-1');

      expect(snowflake.ask).toHaveBeenCalledWith('show leads by industry', true, []);
      expect(openai.enhanceResponse).toHaveBeenCalled();
      expect(result).toEqual(enhanced);
    });

    test('returns suggestions response when cortex returns suggestions', async () => {
      snowflake.ask.mockResolvedValue(cortexOk({
        suggestions: ['By industry?', 'By region?'],
        explanation: 'Your question is ambiguous.',
      }));

      const result = await service.processMessage('show me data', 'sess-2') as any;

      expect(result.type).toBe('suggestions');
      expect(result.suggestions).toEqual(['By industry?', 'By region?']);
      expect(openai.enhanceResponse).not.toHaveBeenCalled();
    });

    test('passes conversation history to snowflake on subsequent calls', async () => {
      snowflake.ask.mockResolvedValue(cortexOk({ results: [{ INDUSTRY: 'Tech', COUNT: 5 }] }));
      openai.enhanceResponse.mockResolvedValue(enhanceOk());

      await service.processMessage('first question', 'sess-hist');
      await service.processMessage('follow up question', 'sess-hist');

      const secondCallHistory = snowflake.ask.mock.calls[1][2] as any[];
      expect(secondCallHistory.length).toBeGreaterThan(0);
      expect(secondCallHistory[0].role).toBe('user');
    });

    test('works without a sessionId (stateless mode)', async () => {
      snowflake.ask.mockResolvedValue(cortexOk());
      openai.enhanceResponse.mockResolvedValue(enhanceOk());

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

      await service.processMessage('hello', 'brand-new-session');
      expect(snowflake.ask.mock.calls[0][2]).toEqual([]);
    });

    test('different sessions do not share history', async () => {
      snowflake.ask.mockResolvedValue(cortexOk({ results: [{ V: 1 }] }));
      openai.enhanceResponse.mockResolvedValue(enhanceOk());

      await service.processMessage('session A question', 'session-A');
      await service.processMessage('session B question', 'session-B');

      const sessionBHistory = snowflake.ask.mock.calls[1][2] as any[];
      expect(sessionBHistory).toEqual([]);
    });
  });
});
