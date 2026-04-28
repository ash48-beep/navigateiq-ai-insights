import { Injectable, Logger } from '@nestjs/common';
import * as snowflake from 'snowflake-sdk';
import { ClientRecord } from '../clients/clients.service';

/**
 * Creates and manages per-client Snowflake connections using
 * username/password authentication (simpler than JWT for client configs).
 */
@Injectable()
export class ClientSnowflakeService {
  private readonly logger = new Logger(ClientSnowflakeService.name);

  /** Open a new Snowflake connection for the given client record */
  async createConnection(client: ClientRecord): Promise<any> {
    return new Promise((resolve, reject) => {
      const conn = (snowflake as any).createConnection({
        account:   client.snowflakeAccount,
        username:  client.snowflakeUser,
        password:  client.snowflakePassword,
        warehouse: client.snowflakeWarehouse,
        database:  client.snowflakeDatabase,
        schema:    client.snowflakeSchema,
      });

      conn.connect(async (err: any) => {
        if (err) {
          this.logger.error(
            `Snowflake connect failed for client "${client.clientSlug}": ${err.message}`,
          );
          reject(err);
          return;
        }

        try {
          // Set warehouse first — needed before DDL
          if (client.snowflakeWarehouse) {
            await this.execute(conn, `USE WAREHOUSE ${client.snowflakeWarehouse}`);
          }
          // Create database and schema if they don't exist yet, then set context
          if (client.snowflakeDatabase) {
            await this.execute(conn, `CREATE DATABASE IF NOT EXISTS ${client.snowflakeDatabase}`);
            await this.execute(conn, `USE DATABASE ${client.snowflakeDatabase}`);
          }
          if (client.snowflakeSchema) {
            await this.execute(conn, `CREATE SCHEMA IF NOT EXISTS ${client.snowflakeSchema}`);
            await this.execute(conn, `USE SCHEMA ${client.snowflakeSchema}`);
          }
          this.logger.log(`Snowflake connected for client "${client.clientSlug}"`);
          resolve(conn);
        } catch (setupErr: any) {
          this.logger.error(
            `Snowflake session setup failed for "${client.clientSlug}": ${setupErr.message}`,
          );
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
            this.logger.error(`SQL error: ${err.message}\nSQL: ${sqlText.slice(0, 200)}`);
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
