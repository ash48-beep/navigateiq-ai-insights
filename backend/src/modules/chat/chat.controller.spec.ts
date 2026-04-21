import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import * as fs from 'fs';
import * as path from 'path';

// Mock the entire fs module so tests don't touch disk
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: Partial<ChatService>;

  beforeEach(async () => {
    chatService = {
      processMessage: jest.fn(),
      processMessageStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    }).compile();

    controller = module.get<ChatController>(ChatController);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getTopQueries ─────────────────────────────────────────────────────────
  describe('getTopQueries', () => {
    test('returns empty array when queries file does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(controller.getTopQueries()).toEqual([]);
    });

    test('returns empty array when file is empty JSON array', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('[]');
      expect(controller.getTopQueries()).toEqual([]);
    });

    test('returns queries in most-recent-first order', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([
          { query: 'first query', timestamp: '2024-01-01T00:00:00Z' },
          { query: 'second query', timestamp: '2024-01-02T00:00:00Z' },
          { query: 'third query', timestamp: '2024-01-03T00:00:00Z' },
        ])
      );
      const result = controller.getTopQueries();
      expect(result[0]).toBe('third query');
      expect(result[1]).toBe('second query');
      expect(result[2]).toBe('first query');
    });

    test('deduplicates queries — keeps only the most recent occurrence', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([
          { query: 'show leads', timestamp: '2024-01-01T00:00:00Z' },
          { query: 'top accounts', timestamp: '2024-01-02T00:00:00Z' },
          { query: 'show leads', timestamp: '2024-01-03T00:00:00Z' }, // duplicate
        ])
      );
      const result = controller.getTopQueries();
      expect(result.filter((q) => q === 'show leads')).toHaveLength(1);
      expect(result[0]).toBe('show leads'); // most recent version is first
    });

    test('returns at most 10 queries', () => {
      mockFs.existsSync.mockReturnValue(true);
      const entries = Array.from({ length: 15 }, (_, i) => ({
        query: `query ${i + 1}`,
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }));
      mockFs.readFileSync.mockReturnValue(JSON.stringify(entries));
      const result = controller.getTopQueries();
      expect(result.length).toBeLessThanOrEqual(10);
    });

    test('skips entries with missing query field', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([
          { query: 'valid query', timestamp: '2024-01-01T00:00:00Z' },
          { timestamp: '2024-01-02T00:00:00Z' }, // no query field
          { query: '', timestamp: '2024-01-03T00:00:00Z' }, // empty string
        ])
      );
      const result = controller.getTopQueries();
      expect(result).toEqual(['valid query']);
    });
  });

  // ─── ask ───────────────────────────────────────────────────────────────────
  describe('ask', () => {
    test('delegates to chatService.processMessage with message and sessionId', async () => {
      const expected = { success: true, explanation: 'result' };
      (chatService.processMessage as jest.Mock).mockResolvedValue(expected);

      const result = await controller.ask({
        message: 'show me leads',
        sessionId: 'sess-123',
      });

      expect(chatService.processMessage).toHaveBeenCalledWith('show me leads', 'sess-123');
      expect(result).toEqual(expected);
    });

    test('works without sessionId', async () => {
      (chatService.processMessage as jest.Mock).mockResolvedValue({});
      await controller.ask({ message: 'test query', sessionId: undefined });
      expect(chatService.processMessage).toHaveBeenCalledWith('test query', undefined);
    });
  });
});
