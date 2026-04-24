import { Test, TestingModule } from '@nestjs/testing';
import { ClientConfigController, AdminClientsController } from '../clients.controller';
import { ClientsService, ClientRecord } from '../clients.service';
import { AdminCognitoAuthGuard } from '../../../auth/admin-cognito.guard';

const alphaRecord: ClientRecord = {
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
  logoUrl:           'https://s3.example.com/logo.png',
  headerImageUrl:    'https://s3.example.com/header.png',
  faviconUrl:        'https://s3.example.com/favicon.ico',
};

const betaRecord: ClientRecord = {
  ...alphaRecord,
  clientSlug: 'beta',
  name:       'Beta',
  url:        'https://beta.example.com',
  status:     'inactive',
};

const mockClientsService = {
  getClient:    jest.fn(),
  listClients:  jest.fn(),
  createClient: jest.fn(),
  updateClient: jest.fn(),
  deleteClient: jest.fn(),
};

// ── ClientConfigController (public) ────────────────────────────────────────

describe('ClientConfigController', () => {
  let controller: ClientConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientConfigController],
      providers: [{ provide: ClientsService, useValue: mockClientsService }],
    }).compile();

    controller = module.get<ClientConfigController>(ClientConfigController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns shaped config (no internal fields) for a valid slug', async () => {
    mockClientsService.getClient.mockResolvedValue(alphaRecord);

    const result = await controller.getClientConfig('alpha');

    expect(result).toEqual({
      name: 'Alpha',
      cognito: {
        userPoolId: 'us-east-1_abc',
        clientId:   'client123',
        region:     'us-east-1',
      },
      theme: {
        primaryColor:      '#2A598F',
        primaryColorLight: '#6895BF',
        bgFrom:            '#0f1419',
        bgTo:              '#1a1d29',
        accentColor:       '#4e9af1',
        logoUrl:           'https://s3.example.com/logo.png',
        headerImageUrl:    'https://s3.example.com/header.png',
        faviconUrl:        'https://s3.example.com/favicon.ico',
      },
    });
    expect(mockClientsService.getClient).toHaveBeenCalledWith('alpha');
  });

  it('does not expose clientSlug, createdAt, or raw Cognito fields in response', async () => {
    mockClientsService.getClient.mockResolvedValue(alphaRecord);
    const result = await controller.getClientConfig('alpha') as any;

    expect(result.clientSlug).toBeUndefined();
    expect(result.createdAt).toBeUndefined();
    expect(result.cognitoUserPoolId).toBeUndefined();
  });
});

// ── AdminClientsController (admin JWT protected) ────────────────────────────

describe('AdminClientsController', () => {
  let controller: AdminClientsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminClientsController],
      providers: [{ provide: ClientsService, useValue: mockClientsService }],
    })
      .overrideGuard(AdminCognitoAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminClientsController>(AdminClientsController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('listClients', () => {
    it('returns all client records', async () => {
      mockClientsService.listClients.mockResolvedValue([alphaRecord, betaRecord]);
      const result = await controller.listClients();
      expect(result).toHaveLength(2);
      expect(result[0].clientSlug).toBe('alpha');
      expect(result[1].clientSlug).toBe('beta');
    });
  });

  describe('createClient', () => {
    it('delegates to service and returns created record', async () => {
      mockClientsService.createClient.mockResolvedValue(alphaRecord);
      const { createdAt: _unused, ...body } = alphaRecord;
      const result = await controller.createClient(body);
      expect(result).toEqual(alphaRecord);
      expect(mockClientsService.createClient).toHaveBeenCalledWith(body);
    });
  });

  describe('updateClient', () => {
    it('calls service updateClient and returns { success: true }', async () => {
      mockClientsService.updateClient.mockResolvedValue(undefined);
      const result = await controller.updateClient('alpha', { status: 'inactive' });
      expect(result).toEqual({ success: true });
      expect(mockClientsService.updateClient).toHaveBeenCalledWith('alpha', { status: 'inactive' });
    });
  });

  describe('deleteClient', () => {
    it('calls service deleteClient and returns { success: true }', async () => {
      mockClientsService.deleteClient.mockResolvedValue(undefined);
      const result = await controller.deleteClient('beta');
      expect(result).toEqual({ success: true });
      expect(mockClientsService.deleteClient).toHaveBeenCalledWith('beta');
    });
  });
});
