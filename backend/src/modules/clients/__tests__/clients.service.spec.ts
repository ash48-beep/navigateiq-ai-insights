import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ClientsService } from '../clients.service';

import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn() },
  PutCommand:    jest.fn().mockImplementation((input) => ({ input })),
  GetCommand:    jest.fn().mockImplementation((input) => ({ input })),
  ScanCommand:   jest.fn().mockImplementation((input) => ({ input })),
  UpdateCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const alphaClient = {
  clientSlug:        'alpha',
  name:              'Alpha',
  url:               'https://alpha.example.com',
  status:            'active',
  createdAt:         '2026-01-15T10:00:00.000Z',
  cognitoUserPoolId: 'us-east-1_abc',
  cognitoClientId:   'client123',
  cognitoRegion:     'us-east-1',
  primaryColor:      '#2A598F',
  primaryColorLight: '#6895BF',
  bgFrom:            '#0f1419',
  bgTo:              '#1a1d29',
  accentColor:       '#4e9af1',
  logoUrl:           '',
  headerImageUrl:    '',
  faviconUrl:        '',
};

describe('ClientsService', () => {
  let service: ClientsService;
  let mockSend: jest.Mock;

  beforeEach(async () => {
    mockSend = jest.fn();
    (DynamoDBDocumentClient.from as jest.Mock).mockReturnValue({ send: mockSend });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('us-east-1') },
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── listClients ──────────────────────────────────────────────────

  describe('listClients', () => {
    it('returns all items from DynamoDB scan', async () => {
      mockSend.mockResolvedValue({ Items: [alphaClient] });
      const result = await service.listClients();
      expect(result).toEqual([alphaClient]);
      expect(mockSend).toHaveBeenCalledWith(expect.any(Object));
      expect(ScanCommand).toHaveBeenCalledWith(expect.objectContaining({ TableName: 'ClientRegistry' }));
    });

    it('returns empty array when no items exist', async () => {
      mockSend.mockResolvedValue({ Items: undefined });
      const result = await service.listClients();
      expect(result).toEqual([]);
    });
  });

  // ── getClient ────────────────────────────────────────────────────

  describe('getClient', () => {
    it('returns the client record when found', async () => {
      mockSend.mockResolvedValue({ Item: alphaClient });
      const result = await service.getClient('alpha');
      expect(result).toEqual(alphaClient);
      expect(GetCommand).toHaveBeenCalledWith(
        expect.objectContaining({ Key: { clientSlug: 'alpha' } }),
      );
    });

    it('throws NotFoundException when slug does not exist', async () => {
      mockSend.mockResolvedValue({ Item: undefined });
      await expect(service.getClient('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ── createClient ─────────────────────────────────────────────────

  describe('createClient', () => {
    it('inserts record with createdAt timestamp and returns it', async () => {
      mockSend.mockResolvedValue({});
      const { createdAt: _unused, ...input } = alphaClient;
      const result = await service.createClient(input);

      expect(result.clientSlug).toBe('alpha');
      expect(result.createdAt).toBeDefined();
      expect(new Date(result.createdAt).getFullYear()).toBeGreaterThanOrEqual(2026);
      expect(PutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'ClientRegistry',
          ConditionExpression: 'attribute_not_exists(clientSlug)',
        }),
      );
    });
  });

  // ── updateClient ─────────────────────────────────────────────────

  describe('updateClient', () => {
    it('sends UpdateCommand with correct expression for provided fields', async () => {
      mockSend.mockResolvedValue({});
      await service.updateClient('alpha', { status: 'inactive', name: 'Alpha v2' });

      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'ClientRegistry',
          Key: { clientSlug: 'alpha' },
          ConditionExpression: 'attribute_exists(clientSlug)',
        }),
      );
      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      expect(call.UpdateExpression).toContain('SET');
    });

    it('does nothing when updates object is empty', async () => {
      await service.updateClient('alpha', {});
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips undefined values in the update payload', async () => {
      mockSend.mockResolvedValue({});
      await service.updateClient('alpha', { status: 'inactive', name: undefined });

      const call = (UpdateCommand as unknown as jest.Mock).mock.calls[0][0];
      const values = Object.values(call.ExpressionAttributeValues as Record<string, unknown>);
      expect(values).not.toContain(undefined);
    });
  });

  // ── deleteClient ─────────────────────────────────────────────────

  describe('deleteClient', () => {
    it('sends DeleteCommand with the correct key and condition', async () => {
      mockSend.mockResolvedValue({});
      await service.deleteClient('alpha');

      expect(DeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'ClientRegistry',
          Key: { clientSlug: 'alpha' },
          ConditionExpression: 'attribute_exists(clientSlug)',
        }),
      );
    });
  });
});
