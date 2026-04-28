import { Module } from '@nestjs/common';
import { CsvPipelineController } from './csv-pipeline.controller';
import { CsvPipelineService } from './csv-pipeline.service';
import { CsvAnalyzerService } from './csv-analyzer.service';
import { ClientSnowflakeService } from './client-snowflake.service';
import { ClientsModule } from '../clients/clients.module';
import { AuthModule } from '../../auth/auth.module';
import { SnowflakeAnalystModule } from '../snowflake-analyst/snowflake-analyst.module';
import { OpenAIModule } from '../openai/openai.module';

@Module({
  imports: [ClientsModule, AuthModule, SnowflakeAnalystModule, OpenAIModule],
  controllers: [CsvPipelineController],
  providers: [CsvPipelineService, CsvAnalyzerService, ClientSnowflakeService],
})
export class CsvPipelineModule {}
