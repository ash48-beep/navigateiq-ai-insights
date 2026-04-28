import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { SnowflakeAnalystService } from '../snowflake-analyst/snowflake-analyst.service';
import { OpenAIService } from '../openai/openai.service';

// One history entry = one Cortex Analyst messages-array item
interface ConversationTurn {
  role: 'user' | 'analyst';
  content: { type: string; text?: string; statement?: string }[];
}

interface SessionEntry {
  history: ConversationTurn[];
  lastActive: number;
}

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle → evict
const MAX_HISTORY_TURNS = 10;           // keep last 10 full turns (20 messages) to stay within token limits

@Injectable()
export class ChatService {
  private sessions = new Map<string, SessionEntry>();

  constructor(
    private readonly snowflake: SnowflakeAnalystService,
    private readonly openai: OpenAIService
  ) {
    // Evict stale sessions every 10 minutes
    setInterval(() => this.evictStaleSessions(), 10 * 60 * 1000);
  }

  private evictStaleSessions() {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastActive > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }

  private getHistory(sessionId?: string): ConversationTurn[] {
    if (!sessionId) return [];
    return this.sessions.get(sessionId)?.history ?? [];
  }

  private saveHistory(sessionId: string | undefined, userMessage: string, result: any) {
    if (!sessionId) return;

    const existing = this.sessions.get(sessionId);
    const history: ConversationTurn[] = existing?.history ?? [];

    // Append user turn
    history.push({ role: 'user', content: [{ type: 'text', text: userMessage }] });

    // Append analyst turn (explanation + sql if present)
    const analystContent: ConversationTurn['content'] = [];
    if (result.explanation) analystContent.push({ type: 'text', text: result.explanation });
    if (result.sql)         analystContent.push({ type: 'sql', statement: result.sql });
    if (analystContent.length > 0) history.push({ role: 'analyst', content: analystContent });

    // Trim to last MAX_HISTORY_TURNS full turns (each turn = user + analyst = 2 items)
    const maxItems = MAX_HISTORY_TURNS * 2;
    const trimmed = history.length > maxItems ? history.slice(history.length - maxItems) : history;

    this.sessions.set(sessionId, { history: trimmed, lastActive: Date.now() });
  }

  async processMessage(message: string, sessionId?: string) {
    try {
      
      const history = this.getHistory(sessionId);
      const result = await this.snowflake.ask(message, true, history);


      // Cortex returned suggestions — prompt was ambiguous, skip GPT entirely
      if (result.suggestions && result.suggestions.length > 0) {
        // Save user turn + analyst clarification so roles alternate correctly.
        // Without the analyst turn the next user message (chosen suggestion)
        // would produce two consecutive user roles → "Role must change after every message."
        if (sessionId) {
          const existing = this.sessions.get(sessionId);
          const hist: ConversationTurn[] = existing?.history ?? [];
          hist.push({ role: 'user', content: [{ type: 'text', text: message }] });
          hist.push({ role: 'analyst', content: [{ type: 'text', text: result.explanation || 'Please clarify your question.' }] });
          this.sessions.set(sessionId, { history: hist, lastActive: Date.now() });
        }
        return {
          type: 'suggestions',
          success: true,
          message: result.explanation || 'Your question is ambiguous. Please choose one of the following:',
          suggestions: result.suggestions,
        };
      }

      this.saveHistory(sessionId, message, result);

      const cortexResponse = {
        success: true,
        query: message,
        explanation: result.explanation || null,
        results: result.results || [],
        sql: result.sql || null,
        request_id: result.request_id,
        timestamp: new Date().toISOString()
      };

      return await this.openai.enhanceResponse(cortexResponse, message);
    } catch (error) {
      throw new InternalServerErrorException(error.message || 'Failed to process query');
    }
  }

  async *processMessageStream(message: string, sessionId?: string): AsyncGenerator<any, void, unknown> {
    try {
      const history = this.getHistory(sessionId);
      const result = await this.snowflake.ask(message, true, history);
      
      // Cortex returned suggestions — prompt was ambiguous, skip GPT entirely
      if (result.suggestions && result.suggestions.length > 0) {
        // Save user turn + analyst clarification so roles alternate correctly.
        // Without the analyst turn the next user message (chosen suggestion)
        // would produce two consecutive user roles → "Role must change after every message."
        if (sessionId) {
          const existing = this.sessions.get(sessionId);
          const hist: ConversationTurn[] = existing?.history ?? [];
          hist.push({ role: 'user', content: [{ type: 'text', text: message }] });
          hist.push({ role: 'analyst', content: [{ type: 'text', text: result.explanation || 'Please clarify your question.' }] });
          this.sessions.set(sessionId, { history: hist, lastActive: Date.now() });
        }
        yield {
          type: 'suggestions',
          success: true,
          message: result.explanation || 'Your question is ambiguous. Please choose one of the following:',
          suggestions: result.suggestions,
        };
        return;
      }

      // Persist history immediately after Cortex responds (before streaming starts)
      this.saveHistory(sessionId, message, result);

      const cortexResponse = {
        success: true,
        query: message,
        explanation: result.explanation || null,
        results: result.results || [],
        sql: result.sql || null,
        request_id: result.request_id,
        timestamp: new Date().toISOString()
      };

      for await (const chunk of this.openai.enhanceResponseStream(cortexResponse, message)) {
        yield chunk;
      }
    } catch (error) {
      throw new InternalServerErrorException(error.message || 'Failed to process streaming query');
    }
  }
}
