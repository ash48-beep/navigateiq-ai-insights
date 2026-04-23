import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'PromptHistory';
const MAX_HISTORY = 50; // max queries returned per user

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);
  private readonly ddb: DynamoDBDocumentClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';

    const client = new DynamoDBClient({ region });
    this.ddb = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Save a user query.
   * Called automatically from the chat controller on every message received.
   */
  async saveQuery(userId: string, query: string): Promise<void> {
    const createdAt = new Date().toISOString();

    // TTL = 90 days from now (Unix timestamp in seconds)
    const ttl = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

    try {
      await this.ddb.send(
        new PutCommand({
          TableName: TABLE_NAME,
          Item: { userId, createdAt, query, ttl },
        }),
      );
    } catch (err) {
      // Log but never throw — a DynamoDB write failure should not break the chat response
      this.logger.error(`Failed to save query for user ${userId}: ${err.message}`);
    }
  }

  /**
   * Return the most-recent unique queries for a user (most recent first).
   */
  async getUserHistory(userId: string): Promise<string[]> {
    try {
      const result = await this.ddb.send(
        new QueryCommand({
          TableName: TABLE_NAME,
          KeyConditionExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': userId },
          ScanIndexForward: false,   // newest first
          Limit: 200,                // fetch enough to deduplicate down to MAX_HISTORY
        }),
      );

      const items = result.Items ?? [];

      // Deduplicate (case-insensitive) and cap at MAX_HISTORY
      const seen = new Set<string>();
      const unique: string[] = [];

      for (const item of items) {
        const q: string = item.query ?? '';
        const key = q.trim().toLowerCase();
        if (key && !seen.has(key) && unique.length < MAX_HISTORY) {
          seen.add(key);
          unique.push(q);
        }
      }

      return unique;
    } catch (err) {
      this.logger.error(`Failed to fetch history for user ${userId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Delete a single query entry (optional — exposed via DELETE endpoint).
   */
  async deleteQuery(userId: string, createdAt: string): Promise<void> {
    await this.ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { userId, createdAt },
      }),
    );
  }
}
