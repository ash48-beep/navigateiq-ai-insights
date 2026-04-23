import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HistoryService } from '../history.service';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn() },
  PutCommand:    jest.fn().mockImplementation((input) => ({ input })),
  QueryCommand:  jest.fn().mockImplementation((input) => ({ input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('HistoryService', () => {
  let service: HistoryService;
  let mockSend: jest.Mock;

  beforeEach(async () => {
    mockSend = jest.fn();
    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({ send: mockSend });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoryService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('ap-south-1') },
        },
      ],
    }).compile();

    service = module.get<HistoryService>(HistoryService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── saveQuery ─────────────────────────────────────────────────────────────
  describe('saveQuery', () => {
    test('sends PutCommand with correct userId, query, createdAt and ttl', async () => {
      mockSend.mockResolvedValue({});
      const before = Math.floor(Date.now() / 1000);

      await service.saveQuery('user-abc', 'show me leads');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const { input } = mockSend.mock.calls[0][0];
      expect(input.TableName).toBe('PromptHistory');
      expect(input.Item.userId).toBe('user-abc');
      expect(input.Item.query).toBe('show me leads');
      expect(typeof input.Item.createdAt).toBe('string');
      expect(input.Item.ttl).toBeGreaterThanOrEqual(before + 90 * 24 * 60 * 60);
    });

    test('does not throw when DynamoDB write fails', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB unavailable'));
      await expect(service.saveQuery('user-1', 'query')).resolves.toBeUndefined();
    });
  });

  // ─── getUserHistory ────────────────────────────────────────────────────────
  describe('getUserHistory', () => {
    test('returns queries newest-first with duplicates removed', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { userId: 'u1', createdAt: '2024-01-03T00:00:00Z', query: 'show leads' },
          { userId: 'u1', createdAt: '2024-01-02T00:00:00Z', query: 'top accounts' },
          { userId: 'u1', createdAt: '2024-01-01T00:00:00Z', query: 'show leads' }, // duplicate
        ],
      });

      const result = await service.getUserHistory('u1');

      expect(result).toEqual(['show leads', 'top accounts']);
    });

    test('deduplication is case-insensitive', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { userId: 'u1', createdAt: '2024-01-02T00:00:00Z', query: 'Show Leads' },
          { userId: 'u1', createdAt: '2024-01-01T00:00:00Z', query: 'show leads' },
        ],
      });

      const result = await service.getUserHistory('u1');

      expect(result).toHaveLength(1);
      expect(result[0]).toBe('Show Leads');
    });

    test('returns empty array when there are no items', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      expect(await service.getUserHistory('u1')).toEqual([]);
    });

    test('returns empty array when Items is undefined', async () => {
      mockSend.mockResolvedValue({});
      expect(await service.getUserHistory('u1')).toEqual([]);
    });

    test('skips items with missing or empty query field', async () => {
      mockSend.mockResolvedValue({
        Items: [
          { userId: 'u1', createdAt: '2024-01-03T00:00:00Z', query: 'valid query' },
          { userId: 'u1', createdAt: '2024-01-02T00:00:00Z' },         // no query
          { userId: 'u1', createdAt: '2024-01-01T00:00:00Z', query: '' }, // empty
        ],
      });

      expect(await service.getUserHistory('u1')).toEqual(['valid query']);
    });

    test('returns empty array when DynamoDB throws', async () => {
      mockSend.mockRejectedValue(new Error('connection refused'));
      expect(await service.getUserHistory('u1')).toEqual([]);
    });

    test('queries DynamoDB with ScanIndexForward false (newest first)', async () => {
      mockSend.mockResolvedValue({ Items: [] });
      await service.getUserHistory('user-xyz');

      const { input } = mockSend.mock.calls[0][0];
      expect(input.ScanIndexForward).toBe(false);
      expect(input.KeyConditionExpression).toContain(':uid');
      expect(input.ExpressionAttributeValues[':uid']).toBe('user-xyz');
    });
  });

  // ─── deleteQuery ───────────────────────────────────────────────────────────
  describe('deleteQuery', () => {
    test('sends DeleteCommand with correct composite key', async () => {
      mockSend.mockResolvedValue({});

      await service.deleteQuery('user-1', '2024-01-15T10:00:00.000Z');

      const { input } = mockSend.mock.calls[0][0];
      expect(input.TableName).toBe('PromptHistory');
      expect(input.Key).toEqual({
        userId: 'user-1',
        createdAt: '2024-01-15T10:00:00.000Z',
      });
    });
  });
});
