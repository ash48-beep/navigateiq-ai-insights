import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import snowflakeConfig from './config/snowflake.config';
import { SnowflakeAnalystModule } from './modules/snowflake-analyst/snowflake-analyst.module';
import { ChatModule } from './modules/chat/chat.module';
import { AuthModule } from './auth/auth.module';
import { HistoryModule } from './modules/history/history.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CsvPipelineModule } from './modules/csv-pipeline/csv-pipeline.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [snowflakeConfig] }),
    AuthModule,
    SnowflakeAnalystModule,
    ChatModule,
    HistoryModule,
    ClientsModule,
    CsvPipelineModule,
  ],
})
export class AppModule {}
