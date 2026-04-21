import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { SnowflakeAnalystModule } from '../snowflake-analyst/snowflake-analyst.module';
import { OpenAIModule } from '../openai/openai.module';

@Module({
  imports: [SnowflakeAnalystModule, OpenAIModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
