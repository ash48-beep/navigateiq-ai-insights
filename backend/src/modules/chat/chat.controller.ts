import { Controller, Post,Get, Body, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ChatDto } from './dto/chat.dto';
import { ApiTags, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';

@ApiTags('Chat')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('ask')
  @ApiResponse({ 
    status: 200, 
    description: 'Successful query response with SQL and data' 
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad Request - Invalid input data' 
  })
  async ask(@Body() body: ChatDto) {
    return this.chatService.processMessage(body.message, body.sessionId);
  }

  @Post('ask/stream')
  // @ApiExcludeEndpoint()
  async askStream(@Body() body: ChatDto, @Res() response: Response) {
    // Set SSE headers for streaming
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    
    let streamActive = true;
    
    // Handle client disconnect
    const cleanup = () => {
      streamActive = false;
    };
    
    response.on('close', cleanup);
    response.on('error', cleanup);
    
    try {
      // Process with streaming
      const streamGenerator = this.chatService.processMessageStream(body.message, body.sessionId);
      
      // Send each chunk as Server-Sent Event
      for await (const chunk of streamGenerator) {
        // Check if client is still connected
        if (!streamActive || response.destroyed) {
          console.log('Client disconnected, stopping stream');
          break;
        }
        
        try {
          const data = `data: ${JSON.stringify(chunk)}\n\n`;
          response.write(data);
        } catch (writeError) {
          console.error('Error writing to response stream:', writeError.message);
          break;
        }
      }
      
      // Send completion signal only if stream is still active
      if (streamActive && !response.destroyed) {
        response.write('data: [DONE]\n\n');
        response.end();
      }
    } catch (error) {
      console.error('Streaming error:', error);
      
      // Send error as SSE only if connection is still active
      if (streamActive && !response.destroyed) {
        try {
          const errorData = {
            type: 'error',
            error: error.message || 'An error occurred during streaming',
            timestamp: new Date().toISOString()
          };
          response.write(`data: ${JSON.stringify(errorData)}\n\n`);
          response.write('data: [DONE]\n\n');
          response.end();
        } catch (writeError) {
          console.error('Failed to send error response:', writeError.message);
          // Force close the response if we can't write to it
          if (!response.destroyed) {
            response.destroy();
          }
        }
      }
    } finally {
      // Cleanup
      response.removeListener('close', cleanup);
      response.removeListener('error', cleanup);
    }
  }

  @Get('top-queries')
  getTopQueries() {
    const filePath = path.join(process.cwd(), 'logs', 'queries.json');

    if (!fs.existsSync(filePath)) return [];

    const raw = fs.readFileSync(filePath, 'utf-8') || '[]';
    const data: { query: string }[] = JSON.parse(raw);

    // Return last 5 unique queries, most-recent first (deduplicated)
    const MAX_RECENT = 10; // developer-configurable
    const seen = new Set<string>();
    const recent: string[] = [];

    for (let i = data.length - 1; i >= 0 && recent.length < MAX_RECENT; i--) {
      const q = data[i]?.query;
      if (q && !seen.has(q)) {
        seen.add(q);
        recent.push(q);
      }
    }

    return recent;
  }

}
