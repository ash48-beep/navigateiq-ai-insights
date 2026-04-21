import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import snowflakeConfig from './config/snowflake.config';
import { SnowflakeAnalystModule } from './modules/snowflake-analyst/snowflake-analyst.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [snowflakeConfig] }),
    SnowflakeAnalystModule,
    ChatModule,
  ],
})
export class AppModule {}
