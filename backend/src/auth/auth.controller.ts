import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import type { AuthenticatedUser } from './auth.guard.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthResponse, LoginInput, RegisterInput, UserResponse } from './auth.service.js';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';

/** Registro, inicio de sesión y consulta del usuario autenticado. */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterInput): Promise<AuthResponse> {
    return this.authService.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginInput): Promise<AuthResponse> {
    return this.authService.login(body);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserResponse> {
    return this.authService.findById(user.id);
  }
}
