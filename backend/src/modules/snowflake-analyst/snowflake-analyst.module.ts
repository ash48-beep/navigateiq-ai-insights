import { Module } from '@nestjs/common';
import { SnowflakeAnalystService } from './snowflake-analyst.service';

@Module({
  providers: [SnowflakeAnalystService],
  exports: [SnowflakeAnalystService],
})
export class SnowflakeAnalystModule {}
