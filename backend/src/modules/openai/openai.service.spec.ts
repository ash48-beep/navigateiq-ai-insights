/**
 * Unit tests for OpenAIService
 *
 * Strategy:
 *  - The OpenAI client is mocked at the module level so no HTTP calls are made.
 *  - Private helper methods (extractResults, buildPayload, sampleResults,
 *    computeInsights, etc.) are exercised indirectly through the two public
 *    entry-points: enhanceResponse() and generateMarkdownResponse().
 *  - A handful of tests exercise the token-guard and no-API-key paths.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OpenAIService } from './openai.service';

// ─── Mock the openai npm package ─────────────────────────────────────────────

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal cortex response with a results array. */
const cortexWith = (results: Record<string, unknown>[], sql = 'SELECT 1') => ({
  results,
  sql,
  explanation: 'Here are your results.',
  request_id: 'req-test',
});

/** Make mockCreate resolve with `content`. */
const gptReturns = (content: string) =>
  mockCreate.mockResolvedValue({
    choices: [{ message: { content } }],
  });

// ─── Module bootstrap ─────────────────────────────────────────────────────────

const buildModule = async (apiKey: string | undefined) => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OpenAIService,
      {
        provide: ConfigService,
        useValue: { get: jest.fn().mockReturnValue(apiKey) },
      },
    ],
  }).compile();

  return module.get<OpenAIService>(OpenAIService);
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpenAIService', () => {
  let service: OpenAIService;

  beforeEach(async () => {
    service = await buildModule('sk-test-key');
    jest.clearAllMocks();
  });

  // ── enhanceResponse ──────────────────────────────────────────────────────

  describe('enhanceResponse', () => {
    test('returns success: true with markdown when GPT responds normally', async () => {
      const gptMarkdown = '### Insights\nTop industry is Tech.';
      gptReturns(gptMarkdown);

      const result = await service.enhanceResponse(
        cortexWith([{ INDUSTRY: 'Tech', COUNT: 42 }]),
        'show leads by industry',
      );

      expect(result.success).toBe(true);
      expect(result.markdown).toBe(gptMarkdown);
      expect(result.technical_insights).toBe('SELECT 1');
    });

    test('includes the cortex SQL as technical_insights', async () => {
      gptReturns('ok');
      const cortex = cortexWith([], 'SELECT * FROM leads');

      const result = await service.enhanceResponse(cortex, 'test');

      expect(result.technical_insights).toBe('SELECT * FROM leads');
    });

    test('returns success: false with error message when GPT throws', async () => {
      mockCreate.mockRejectedValue(new Error('OpenAI rate limit'));

      const result = await service.enhanceResponse(
        cortexWith([{ A: 1 }]),
        'test prompt',
      );

      expect(result.success).toBe(false);
      expect(result.markdown).toBeNull();
      expect(result.error).toContain('rate limit');
    });

    test('handles empty results array gracefully', async () => {
      gptReturns('No data found.');

      const result = await service.enhanceResponse(cortexWith([]), 'empty query');

      expect(result.success).toBe(true);
      expect(result.markdown).toBe('No data found.');
    });

    test('technical_insights is null when cortex has no sql', async () => {
      gptReturns('ok');
      const cortex = { ...cortexWith([]), sql: null };

      const result = await service.enhanceResponse(cortex, 'prompt');

      expect(result.technical_insights).toBeNull();
    });
  });

  // ── generateMarkdownResponse ──────────────────────────────────────────────

  describe('generateMarkdownResponse', () => {
    test('calls GPT with user prompt and returns its response', async () => {
      const expected = '### Result\nSome insight.';
      gptReturns(expected);

      const md = await service.generateMarkdownResponse(
        'how many accounts?',
        cortexWith([{ ACCOUNT: 'Acme', COUNT: 5 }]),
      );

      expect(md).toBe(expected);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.model).toBe('gpt-4o-mini');
      expect(call.messages[1].content).toContain('how many accounts?');
    });

    test('throws when GPT returns context-length error', async () => {
      mockCreate.mockRejectedValue(
        new Error('This model has a maximum context length exceeded'),
      );

      await expect(
        service.generateMarkdownResponse('big query', cortexWith([])),
      ).rejects.toThrow('Payload too large');
    });

    test('throws descriptive message when GPT throws other errors', async () => {
      mockCreate.mockRejectedValue(new Error('503 Service Unavailable'));

      await expect(
        service.generateMarkdownResponse('test', cortexWith([])),
      ).rejects.toThrow('Failed to generate markdown response');
    });

    test('falls back to default text when GPT returns empty choices', async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: null } }] });

      const md = await service.generateMarkdownResponse('test', cortexWith([]));

      expect(md).toBe('Unable to generate response.');
    });
  });

  // ── No API key configured ─────────────────────────────────────────────────

  describe('when OPENAI_API_KEY is not set', () => {
    let noKeyService: OpenAIService;

    beforeEach(async () => {
      noKeyService = await buildModule(undefined);
    });

    test('enhanceResponse returns success: false with config error', async () => {
      const result = await noKeyService.enhanceResponse(cortexWith([]), 'test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not configured');
    });

    test('generateMarkdownResponse throws immediately', async () => {
      await expect(
        noKeyService.generateMarkdownResponse('test', cortexWith([])),
      ).rejects.toThrow('not configured');
    });
  });

  // ── extractResults — result shape normalisation ───────────────────────────

  describe('result shape normalisation (via enhanceResponse)', () => {
    test('handles { results: [...] } shape', async () => {
      gptReturns('ok');

      const result = await service.enhanceResponse(
        { results: [{ X: 1 }], sql: null },
        'prompt',
      );

      // If extraction worked, GPT was called — GPT returning 'ok' means success
      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      // The payload passed to GPT should reference 1 total row
      expect(userMsg).toContain('"total_rows": 1');
    });

    test('handles { data: [...] } shape', async () => {
      gptReturns('ok');
      await service.enhanceResponse({ data: [{ Y: 2 }], sql: null }, 'p');
      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      expect(userMsg).toContain('"total_rows": 1');
    });

    test('handles { rows: [...] } shape', async () => {
      gptReturns('ok');
      await service.enhanceResponse({ rows: [{ Z: 3 }], sql: null }, 'p');
      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      expect(userMsg).toContain('"total_rows": 1');
    });

    test('handles columnar { columns, data } shape', async () => {
      gptReturns('ok');
      const cortex = {
        columns: ['NAME', 'SCORE'],
        data: [
          ['Alice', 90],
          ['Bob', 85],
        ],
        sql: null,
      };

      await service.enhanceResponse(cortex, 'p');
      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      expect(userMsg).toContain('"total_rows": 2');
    });

    test('handles an empty cortex response object without throwing', async () => {
      gptReturns('ok');
      // Empty object — extractResults should return [] (no results field present)
      const result = await service.enhanceResponse({}, 'test');
      expect(result.success).toBe(true);
    });

    test('handles message-wrapped shape { message: { results: [...] } }', async () => {
      gptReturns('ok');
      const cortex = {
        message: { results: [{ COL: 'val' }] },
        sql: null,
      };
      await service.enhanceResponse(cortex, 'p');
      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      expect(userMsg).toContain('"total_rows": 1');
    });
  });

  // ── sampleResults ─────────────────────────────────────────────────────────

  describe('sampleResults behaviour (via generateMarkdownResponse)', () => {
    /**
     * When a dataset has > 50 rows (SMALL_DATASET_THRESHOLD), the service
     * should send sample_rows instead of all_rows.  We verify by checking
     * that the GPT payload contains "sample_rows" and NOT "all_rows" for
     * a 60-row dataset.
     */
    test('sends sample_rows for large datasets (>50 rows)', async () => {
      gptReturns('ok');
      const bigResults = Array.from({ length: 60 }, (_, i) => ({ ID: i, VAL: i * 10 }));

      await service.generateMarkdownResponse('big data', cortexWith(bigResults));

      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      const payload = JSON.parse(
        userMsg.slice(userMsg.indexOf('{'), userMsg.lastIndexOf('}') + 1),
      );

      expect(payload).toHaveProperty('sample_rows');
      expect(payload).not.toHaveProperty('all_rows');
      // sample_rows should be at most 50 entries
      expect(payload.sample_rows.length).toBeLessThanOrEqual(50);
      // But total_rows in insights should still reflect the full 60
      expect(payload.insights.total_rows).toBe(60);
    });

    /**
     * For small datasets (≤50 rows) the service sends all_rows instead of
     * sample_rows to give GPT access to every value.
     */
    test('sends all_rows for small datasets (≤50 rows)', async () => {
      gptReturns('ok');
      const smallResults = Array.from({ length: 10 }, (_, i) => ({ ID: i }));

      await service.generateMarkdownResponse('small data', cortexWith(smallResults));

      const userMsg = mockCreate.mock.calls[0][0].messages[1].content;
      const payload = JSON.parse(
        userMsg.slice(userMsg.indexOf('{'), userMsg.lastIndexOf('}') + 1),
      );

      expect(payload).toHaveProperty('all_rows');
      expect(payload.all_rows.length).toBe(10);
      // sample_rows is [] for small datasets (no duplication)
      expect(payload.sample_rows).toEqual([]);
    });
  });

  // ── Token guard ───────────────────────────────────────────────────────────

  describe('token safety guard', () => {
    test('throws "Payload too large" when estimated tokens exceed limit', async () => {
      // 60 000 token limit ≈ 210 000 characters.
      // Create a dataset where the serialised payload blows past that.
      const hugeCols: Record<string, unknown> = {};
      for (let i = 0; i < 2000; i++) {
        hugeCols[`col_${i}`] = 'x'.repeat(100);
      }
      const hugeResults = Array.from({ length: 5 }, () => ({ ...hugeCols }));

      await expect(
        service.generateMarkdownResponse('any', cortexWith(hugeResults)),
      ).rejects.toThrow('Payload too large');
    });
  });
});
