import { Module } from '@nestjs/common';
import { HistoryService } from './history.service';
import { HistoryController } from './history.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController],
  providers: [HistoryService],
  exports: [HistoryService],   // exported so ChatModule can inject it
})
export class HistoryModule {}
