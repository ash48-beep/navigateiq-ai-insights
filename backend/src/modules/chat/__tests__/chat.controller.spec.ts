import { Test, TestingModule } from '@nestjs/testing';
import { ChatController } from '../chat.controller';
import { ChatService } from '../chat.service';
import { HistoryService } from '../../history/history.service';
import { CognitoAuthGuard } from '../../../auth/cognito.guard';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: Partial<ChatService>;
  let historyService: Partial<HistoryService>;

  const mockReq = { user: { sub: 'user-123' } } as any;

  beforeEach(async () => {
    chatService = {
      processMessage: jest.fn(),
      processMessageStream: jest.fn(),
    };

    historyService = {
      saveQuery:       jest.fn().mockResolvedValue(undefined),
      getUserHistory:  jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService,    useValue: chatService },
        { provide: HistoryService, useValue: historyService },
      ],
    })
      .overrideGuard(CognitoAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ChatController>(ChatController);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── getTopQueries ─────────────────────────────────────────────────────────
  describe('getTopQueries', () => {
    test('returns empty array when user has no history', async () => {
      (historyService.getUserHistory as jest.Mock).mockResolvedValue([]);
      expect(await controller.getTopQueries(mockReq)).toEqual([]);
    });

    test('delegates to historyService.getUserHistory with userId from token', async () => {
      await controller.getTopQueries(mockReq);
      expect(historyService.getUserHistory).toHaveBeenCalledWith('user-123');
    });

    test('returns queries from historyService', async () => {
      const history = ['show leads', 'top accounts', 'pipeline report'];
      (historyService.getUserHistory as jest.Mock).mockResolvedValue(history);
      expect(await controller.getTopQueries(mockReq)).toEqual(history);
    });

    test('returns empty array when req has no user (unauthenticated)', async () => {
      const anonReq = {} as any;
      expect(await controller.getTopQueries(anonReq)).toEqual([]);
      expect(historyService.getUserHistory).not.toHaveBeenCalled();
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
      }, mockReq);

      expect(chatService.processMessage).toHaveBeenCalledWith('show me leads', 'sess-123');
      expect(result).toEqual(expected);
    });

    test('works without sessionId', async () => {
      (chatService.processMessage as jest.Mock).mockResolvedValue({});
      await controller.ask({ message: 'test query', sessionId: undefined }, mockReq);
      expect(chatService.processMessage).toHaveBeenCalledWith('test query', undefined);
    });
  });
});
