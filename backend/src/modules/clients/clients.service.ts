import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'ClientRegistry';

export interface ClientRecord {
  clientSlug: string;
  name: string;
  url: string;
  status: string;
  createdAt: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoRegion: string;
  primaryColor: string;
  primaryColorLight: string;
  bgFrom: string;
  bgTo: string;
  accentColor: string;
  logoUrl: string;
  headerImageUrl: string;
  faviconUrl: string;
}

@Injectable()
export class ClientsService {
  private readonly logger = new Logger(ClientsService.name);
  private readonly ddb: DynamoDBDocumentClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const client = new DynamoDBClient({ region });
    this.ddb = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /** List all clients — used by admin dashboard */
  async listClients(): Promise<ClientRecord[]> {
    const result = await this.ddb.send(
      new ScanCommand({ TableName: TABLE_NAME }),
    );
    return (result.Items ?? []) as ClientRecord[];
  }

  /** Get a single client by slug — used by the public /client-config endpoint */
  async getClient(clientSlug: string): Promise<ClientRecord> {
    const result = await this.ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { clientSlug },
      }),
    );

    if (!result.Item) {
      throw new NotFoundException(`Client "${clientSlug}" not found`);
    }

    return result.Item as ClientRecord;
  }

  /** Create a new client record */
  async createClient(data: Omit<ClientRecord, 'createdAt'>): Promise<ClientRecord> {
    const record: ClientRecord = {
      ...data,
      createdAt: new Date().toISOString(),
    };

    await this.ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: record,
        ConditionExpression: 'attribute_not_exists(clientSlug)',
      }),
    );

    return record;
  }

  /** Update an existing client record */
  async updateClient(
    clientSlug: string,
    updates: Partial<Omit<ClientRecord, 'clientSlug' | 'createdAt'>>,
  ): Promise<void> {
    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const updateExpressions = entries.map(([k], i) => `#f${i} = :v${i}`);
    const expressionAttributeNames = Object.fromEntries(
      entries.map(([k], i) => [`#f${i}`, k]),
    );
    const expressionAttributeValues = Object.fromEntries(
      entries.map(([, v], i) => [`:v${i}`, v]),
    );

    await this.ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { clientSlug },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(clientSlug)',
      }),
    );
  }

  /** Delete a client record */
  async deleteClient(clientSlug: string): Promise<void> {
    await this.ddb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { clientSlug },
        ConditionExpression: 'attribute_exists(clientSlug)',
      }),
    );
  }
}
