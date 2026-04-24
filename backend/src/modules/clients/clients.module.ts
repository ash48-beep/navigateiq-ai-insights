import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { ClientConfigController, AdminClientsController } from './clients.controller';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ClientConfigController, AdminClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
