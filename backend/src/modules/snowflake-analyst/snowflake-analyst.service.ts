import { Injectable, OnModuleInit, OnModuleDestroy, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as snowflake from 'snowflake-sdk';
import * as yaml from 'js-yaml';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import config from '../../config/snowflake.config';

@Injectable()
export class SnowflakeAnalystService implements OnModuleInit, OnModuleDestroy {
  private cfg = config().snowflake;
  private connection: any;
  private jwtCache: { token: string; expiresAt: number } | null = null;
  private publicKeyFpCache: string | null = null;
  private semanticModel: any = null;

  async onModuleInit() {
    await this.initializeConnection();
    await this.loadSemanticModel();
  }

  async onModuleDestroy() {
    if (this.connection) {
      await new Promise((resolve) => {
        this.connection.destroy((err) => {
          if (err) console.error('Error closing connection:', err);
          resolve(undefined);
        });
      });
    }
  }

  private isValidModel(model: any): boolean {
    return model && typeof model === 'object' && Array.isArray(model.tables) && model.tables.length > 0;
  }

  private async loadSemanticModel() {
    // 1. Try local file system first
    try {
      const modelPath = `./semantic-models/${this.cfg.model}.yaml`;
      const yamlContent = await fs.readFile(modelPath, 'utf8');
      const model = yaml.load(yamlContent);
      if (this.isValidModel(model)) {
        this.semanticModel = model;
        console.log('[SemanticModel] Loaded from file system.');
        return;
      }
      console.warn('[SemanticModel] File system model missing required "tables" field — skipping.');
    } catch (fsError) {
      console.warn('[SemanticModel] Failed to load from file system:', fsError.message);
    }

    // 2. Try Snowflake stage
    try {
      const model = await this.fetchModelFromStage();
      if (this.isValidModel(model)) {
        this.semanticModel = model;
        console.log('[SemanticModel] Loaded from stage.');
        return;
      }
      console.warn('[SemanticModel] Stage model missing required "tables" field — falling back to semantic_model_file reference.');
    } catch (stageError) {
      console.error('[SemanticModel] Failed to load from stage:', stageError.message);
    }

    // 3. Fall back to null — ask() will use semantic_model_file (stage path reference)
    this.semanticModel = null;
  }

  private async fetchModelFromStage(): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Connection not initialized'));
        return;
      }

      const stagePath = `@${this.cfg.database}.${this.cfg.schema}.${this.cfg.stage}/${this.cfg.model}.yaml`;
      const sqlText = `SELECT $1 FROM ${stagePath}`;

      this.connection.execute({
        sqlText,
        complete: (err, stmt, rows) => {
          if (err) {
            console.error('Failed to fetch model from stage:', err);
            reject(err);
          } else {
            try {
              const yamlContent = rows[0]?.$1 || rows[0]?.['$1'];
              const model = yaml.load(yamlContent);
              resolve(model);
            } catch (parseErr) {
              reject(parseErr);
            }
          }
        }
      });
    });
  }

  private async initializeConnection() {
    return new Promise((resolve, reject) => {
      this.connection = snowflake.createConnection({
        account: this.cfg.account,
        username: this.cfg.user,
        role: this.cfg.role,
        warehouse: this.cfg.warehouse,
        database: this.cfg.database,
        schema: this.cfg.schema,
        authenticator: 'SNOWFLAKE_JWT',
        privateKey: this.cfg.privateKey
      });

      this.connection.connect((err) => {
        if (err) {
          console.error('Failed to initialize Snowflake connection:', err);
          reject(err);
        } else {
          resolve(undefined);
        }
      });
    });
  }

  // ✅ FIXED: Dynamic import of jose (works in CommonJS)
  private async generateJwt() {
    if (this.jwtCache && this.jwtCache.expiresAt > Date.now() + 300000) {
      return this.jwtCache.token;
    }

    if (!this.cfg.privateKey) {
      throw new Error('Private key not found in env');
    }

    const { SignJWT, importPKCS8 } = await import('jose'); // ✔ FIXED

    const pk = await importPKCS8(this.cfg.privateKey, 'RS256');

    const accountIdentifier = this.cfg.account.split('.')[0].toUpperCase();
    const user = this.cfg.user.toUpperCase();
    const qualifiedUsername = `${accountIdentifier}.${user}`;

    const now = Math.floor(Date.now() / 1000);

    const publicKeyFp = await this.getPublicKeyFingerprint();
    const issuer = `${qualifiedUsername}.SHA256:${publicKeyFp}`;

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .setIssuer(issuer)
      .setSubject(qualifiedUsername)
      .sign(pk);

    this.jwtCache = {
      token: jwt,
      expiresAt: Date.now() + 3600000
    };

    return jwt;
  }

  private async getPublicKeyFingerprint(): Promise<string> {
    if (this.publicKeyFpCache) {
      return this.publicKeyFpCache;
    }

    const crypto = await import('crypto');
    
    const privateKeyObject = crypto.createPrivateKey({
      key: this.cfg.privateKey,
      format: 'pem',
    });
    
    const publicKeyDer = crypto.createPublicKey(privateKeyObject).export({
      type: 'spki',
      format: 'der',
    });
    
    const hash = crypto.createHash('sha256');
    hash.update(publicKeyDer);
    this.publicKeyFpCache = hash.digest('base64');
    
    return this.publicKeyFpCache;
  }

  /**
   * Upload a new YAML semantic model to the Snowflake stage and hot-reload it
   * in memory so the next Cortex Analyst call uses the updated schema.
   * Called by CsvPipelineService after every successful CSV upload.
   */
  async uploadAndReloadModel(yamlContent: string, modelName: string): Promise<void> {
    const tmpPath = path.join(os.tmpdir(), `${modelName}.yaml`);
    fsSync.writeFileSync(tmpPath, yamlContent, 'utf8');

    try {
      const stagePath =
        `@${this.cfg.database}.${this.cfg.schema}.${this.cfg.stage}/${modelName}.yaml`;

      await new Promise<void>((resolve, reject) => {
        this.connection.execute({
          sqlText: `PUT file://${tmpPath} ${stagePath} AUTO_COMPRESS=FALSE OVERWRITE=TRUE`,
          complete: (err: any) => (err ? reject(err) : resolve()),
        });
      });

      console.log(`[SemanticModel] Uploaded to stage: ${stagePath}`);

      // Hot-reload in memory so next ask() call picks up the new schema
      const model = yaml.load(yamlContent);
      if (this.isValidModel(model)) {
        this.semanticModel = model;
        console.log(`[SemanticModel] Hot-reloaded in memory: ${modelName}`);
      }
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  async ask(prompt: string, executeQuery: boolean = true, history: any[] = []) {
    try {
      const token = await this.generateJwt();

      const url = `https://${this.cfg.account}.snowflakecomputing.com/api/v2/cortex/analyst/message`;

      const body: any = {
        model: "cortex-analyst",
        // Prepend prior conversation turns so Cortex Analyst has context for follow-up questions
        messages: [
          ...history,
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        session: { mode: "execute", run_sql: executeQuery }
      };

      if (this.semanticModel) {
        body.semantic_model = yaml.dump(this.semanticModel);
      } else {
        body.semantic_model_file = `@${this.cfg.database}.${this.cfg.schema}.${this.cfg.stage}/${this.cfg.model}.yaml`;
      }

      const res = await axios.post(url, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Snowflake-Authorization-Token-Type': 'KEYPAIR_JWT'
        },
      });
      
      const parsedResponse = this.parseAnalystResponse(res.data);
      
      if (executeQuery && parsedResponse.sql) {
        try {
          parsedResponse.results = await this.executeQuery(parsedResponse.sql, 45000);
        } catch (queryError) {
          console.error('Query execution failed:', queryError.message);
          
          if (queryError.message?.includes('connection')) {
            try {
              console.log('Retrying query after connection issue...');
              parsedResponse.results = await this.executeQuery(parsedResponse.sql, 30000);
            } catch (retryError) {
              console.error('Retry also failed:', retryError.message);
              parsedResponse.results = [];
              parsedResponse.queryError = this.formatQueryError(retryError);
            }
          } else {
            parsedResponse.results = [];
            parsedResponse.queryError = this.formatQueryError(queryError);
          }
        }
      }
      
      return parsedResponse;
    } catch (error) {
      const errorMessage = error.response?.data?.message || error.message || 'Cortex Analyst request failed';
      throw new InternalServerErrorException(errorMessage);
    }
  }

  private parseAnalystResponse(data: any) {
    const content = data.message?.content || [];

    let explanation = null;
    let sql = null;
    let suggestions: string[] = [];

    for (const item of content) {
      if (item.type === 'text') {
        explanation = item.text;
      } else if (item.type === 'sql') {
        sql = item.statement;
      } else if (item.type === 'suggestions') {
        // Cortex Analyst returns this when the prompt is ambiguous
        suggestions = item.suggestions || [];
      }
    } 

    console.log({
      explanation,
      sql,
      suggestions,
      results: [] as any[],
      request_id: data.request_id,
      raw: data,
      queryError: null as any
    })

    return {
      explanation,
      sql,
      suggestions,
      results: [] as any[],
      request_id: data.request_id,
      raw: data,
      queryError: null as any
    };
  }

  private formatQueryError(error: any): any {
    const errorInfo = {
      message: error.message || 'Query execution failed',
      type: 'query_execution_error'
    };
    
    if (error.code === '100040' && error.sqlState === '22007') {
      errorInfo.message = 'Invalid date format in query. Please check your date values and try again.';
      errorInfo.type = 'date_format_error';
    } else if (error.code && error.sqlState) {
      errorInfo.message = `Database error (${error.code}): ${error.message}`;
      errorInfo.type = 'database_error';
    }
    
    return errorInfo;
  }

  private async executeQuery(sqlStatement: string, timeoutMs?: number): Promise<any[]> {
    if (!this.connection || !this.isConnectionAlive()) {
      console.log('Connection terminated, attempting to reconnect...');
      try {
        await this.initializeConnection();
      } catch {
        throw new Error('Unable to establish database connection. Please try again later.');
      }
    }

    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;
      let completed = false;

      if (timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          if (!completed) {
            completed = true;
            reject(new Error(`Query execution timeout after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }

      this.connection.execute({
        sqlText: sqlStatement,
        complete: (err, stmt, rows) => {
          if (!completed) {
            completed = true;
            if (timeoutHandle) clearTimeout(timeoutHandle);

            if (err) {
              console.error('Query execution failed:', err);

              if (err.message?.includes('terminated connection')) {
                this.connection = null;
                reject(new Error('Database connection lost. Please retry your query.'));
              } else {
                reject(err);
              }
            } else {
              resolve(rows || []);
            }
          }
        }
      });
    });
  }

  private isConnectionAlive(): boolean {
    try {
      return this.connection && this.connection.isUp && this.connection.isUp();
    } catch {
      return false;
    }
  }
}
