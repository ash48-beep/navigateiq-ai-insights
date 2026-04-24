import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ClientsService, ClientRecord } from './clients.service';
import { AdminCognitoAuthGuard } from '../../auth/admin-cognito.guard';

// ── Public endpoint (no auth) ──────────────────────────────────────────────

@ApiTags('Client Config')
@Controller('client-config')
export class ClientConfigController {
  constructor(private readonly clientsService: ClientsService) {}

  /**
   * GET /api/v1/client-config/:slug
   * Public — no auth required.
   * Returns Cognito config + theme for the given client slug.
   * Called by the React app on startup to configure itself.
   */
  @Get(':slug')
  @ApiOperation({ summary: 'Get public client config by slug' })
  async getClientConfig(@Param('slug') slug: string) {
    const client = await this.clientsService.getClient(slug);

    // Return only what the frontend needs — never expose internal fields
    return {
      name:             client.name,
      cognito: {
        userPoolId: client.cognitoUserPoolId,
        clientId:   client.cognitoClientId,
        region:     client.cognitoRegion,
      },
      theme: {
        primaryColor:      client.primaryColor,
        primaryColorLight: client.primaryColorLight,
        bgFrom:            client.bgFrom,
        bgTo:              client.bgTo,
        accentColor:       client.accentColor,
        logoUrl:           client.logoUrl,
        headerImageUrl:    client.headerImageUrl,
        faviconUrl:        client.faviconUrl,
      },
    };
  }
}

// ── Admin endpoints (admin JWT required) ──────────────────────────────────

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(AdminCognitoAuthGuard)
@Controller('admin/clients')
export class AdminClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  /** GET /api/v1/admin/clients — list all clients */
  @Get()
  @ApiOperation({ summary: 'List all clients' })
  listClients(): Promise<ClientRecord[]> {
    return this.clientsService.listClients();
  }

  /** POST /api/v1/admin/clients — create a new client */
  @Post()
  @ApiOperation({ summary: 'Create a new client' })
  createClient(@Body() body: Omit<ClientRecord, 'createdAt'>): Promise<ClientRecord> {
    return this.clientsService.createClient(body);
  }

  /** PATCH /api/v1/admin/clients/:slug — update client details */
  @Patch(':slug')
  @ApiOperation({ summary: 'Update client details' })
  async updateClient(
    @Param('slug') slug: string,
    @Body() body: Partial<Omit<ClientRecord, 'clientSlug' | 'createdAt'>>,
  ): Promise<{ success: boolean }> {
    await this.clientsService.updateClient(slug, body);
    return { success: true };
  }

  /** DELETE /api/v1/admin/clients/:slug — delete a client */
  @Delete(':slug')
  @ApiOperation({ summary: 'Delete a client' })
  async deleteClient(
    @Param('slug') slug: string,
  ): Promise<{ success: boolean }> {
    await this.clientsService.deleteClient(slug);
    return { success: true };
  }
}
