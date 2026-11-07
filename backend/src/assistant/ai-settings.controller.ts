import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type {
  AiSettingsInput,
  AiSettingsResponse,
  AiSettingsTestResponse,
  AiStatusResponse,
} from './ai-settings.service.js';
import { AiSettingsService } from './ai-settings.service.js';

/**
 * CU11 — Configurar Servicio de IA (Administrador).
 *
 * Las tres primeras operaciones son del administrador (users.is_admin); la
 * comprobación está en el servicio. /ai/status lo consulta cualquier usuario
 * para saber si el asistente del chat está disponible.
 *
 * Se modifica con PATCH, como el resto de la API, y no con PUT: el CORS de
 * main.ts no lo admite.
 */
@Controller('ai')
@UseGuards(AuthGuard)
export class AiSettingsController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get('settings')
  get(@CurrentUser() user: AuthenticatedUser): Promise<AiSettingsResponse> {
    return this.settings.get(user.id);
  }

  @Patch('settings')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AiSettingsInput,
  ): Promise<AiSettingsResponse> {
    return this.settings.update(user.id, body);
  }

  /** Prueba la configuración guardada, o la que llega en el cuerpo, sin guardarla. */
  @Post('settings/test')
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: AiSettingsInput | undefined,
  ): Promise<AiSettingsTestResponse> {
    return this.settings.test(user.id, body);
  }

  @Get('status')
  status(): Promise<AiStatusResponse> {
    return this.settings.status();
  }
}
