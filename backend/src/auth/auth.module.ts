import 'dotenv/config';
import { Module } from '@nestjs/common';
import type { JwtSignOptions } from '@nestjs/jwt';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

/**
 * El secreto de firma no tiene valor por defecto a propósito: sin él,
 * cualquiera podría emitir tokens válidos. Si falta, la aplicación no arranca.
 */
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new Error('Falta la variable de entorno JWT_SECRET (necesaria para firmar los tokens).');
  }

  return secret;
}

@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret(),
      // El tipo de expiresIn es una plantilla ('7d', '24h'...) que no puede
      // comprobarse sobre una variable de entorno leída en tiempo de ejecución.
      signOptions: {
        expiresIn: (process.env.JWT_EXPIRES_IN?.trim() ||
          '7d') as JwtSignOptions['expiresIn'],
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  // ProjectsModule necesita AuthGuard, y AuthGuard necesita JwtService.
  // El gateway de CU03 usa además AuthService para identificar al usuario del
  // token durante el handshake.
  exports: [AuthGuard, AuthService, JwtModule],
})
export class AuthModule {}
