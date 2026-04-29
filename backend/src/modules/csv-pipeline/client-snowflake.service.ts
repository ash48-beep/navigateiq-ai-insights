import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as snowflake from 'snowflake-sdk';
import { ClientRecord } from '../clients/clients.service';

/**
 * Creates per-client Snowflake connections using the GLOBAL credentials
 * from environment variables (JWT / private-key auth — same as SnowflakeAnalystService).
 * Only database and schema are taken from the per-client ClientRecord.
 */
@Injectable()
export class ClientSnowflakeService {
  private readonly logger = new Logger(ClientSnowflakeService.name);

  constructor(private readonly configService: ConfigService) {}

  /** Open a new Snowflake connection scoped to the given client's DB/schema */
  async createConnection(client: ClientRecord): Promise<any> {
    const cfg = this.configService.get<any>('snowflake');

    const usePerClientCreds =
      client.snowflakeAccount && client.snowflakeUser && client.snowflakePassword;

    const connOptions: any = usePerClientCreds
      ? {
          account:   client.snowflakeAccount,
          username:  client.snowflakeUser,
          password:  client.snowflakePassword,
          warehouse: client.snowflakeWarehouse || cfg.warehouse,
          database:  client.snowflakeDatabase,
          schema:    client.snowflakeSchema,
        }
      : {
          account:       cfg.account,
          username:      cfg.user,
          role:          cfg.role,
          warehouse:     cfg.warehouse,
          database:      client.snowflakeDatabase,
          schema:        client.snowflakeSchema,
          authenticator: 'SNOWFLAKE_JWT',
          privateKey:    cfg.privateKey,
        };

    return new Promise((resolve, reject) => {
      const conn = (snowflake as any).createConnection(connOptions);

      conn.connect(async (err: any) => {
        if (err) {
          this.logger.error(
            `Snowflake connect failed for client "${client.clientSlug}": ${err.message}`,
          );
          reject(err);
          return;
        }

        try {
          // Ensure warehouse is active
          const warehouse = client.snowflakeWarehouse || cfg.warehouse;
          await this.execute(conn, `USE WAREHOUSE ${warehouse}`);

          // Create database / schema if they don't exist, then set context
          if (client.snowflakeDatabase) {
            await this.execute(conn, `CREATE DATABASE IF NOT EXISTS ${client.snowflakeDatabase}`);
            await this.execute(conn, `USE DATABASE ${client.snowflakeDatabase}`);
          }
          if (client.snowflakeSchema) {
            await this.execute(conn, `CREATE SCHEMA IF NOT EXISTS ${client.snowflakeSchema}`);
            await this.execute(conn, `USE SCHEMA ${client.snowflakeSchema}`);
          }

          this.logger.log(`Snowflake connected for client "${client.clientSlug}" (${client.snowflakeDatabase}.${client.snowflakeSchema})`);
          resolve(conn);
        } catch (setupErr: any) {
          this.logger.error(`Session setup failed for "${client.clientSlug}": ${setupErr.message}`);
          conn.destroy(() => {});
          reject(setupErr);
        }
      });
    });
  }

  /** Execute a SQL statement and return rows */
  execute(connection: any, sqlText: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      connection.execute({
        sqlText,
        complete: (err: any, _stmt: any, rows: any[]) => {
          if (err) {
            this.logger.error(`SQL error: ${err.message}\nSQL: ${sqlText.slice(0, 300)}`);
            reject(err);
          } else {
            resolve(rows || []);
          }
        },
      });
    });
  }

  /** Gracefully close a connection */
  destroy(connection: any): Promise<void> {
    return new Promise(resolve => {
      connection.destroy((err: any) => {
        if (err) this.logger.warn(`Error closing Snowflake connection: ${err.message}`);
        resolve();
      });
    });
  }
}
