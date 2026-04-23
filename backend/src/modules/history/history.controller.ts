import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { HistoryService } from './history.service';
import { CognitoAuthGuard } from '../../auth/cognito.guard';

@ApiTags('History')
@ApiBearerAuth()
@UseGuards(CognitoAuthGuard)
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  /**
   * GET /api/v1/history
   * Returns the authenticated user's recent query history (newest first, deduplicated).
   */
  @Get()
  @ApiOperation({ summary: 'Get current user query history' })
  @ApiResponse({ status: 200, description: 'Array of query strings, most recent first' })
  async getHistory(@Req() req: Request): Promise<string[]> {
    const userId: string = (req as any).user?.sub;
    return this.historyService.getUserHistory(userId);
  }
}
