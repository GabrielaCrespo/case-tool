import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type {
  AttributeInput,
  ClassInput,
  MethodInput,
  ParameterInput,
} from './classes.service.js';
import { ClassesService } from './classes.service.js';
import type {
  AttributeResponse,
  ClassResponse,
  MethodResponse,
  ParameterResponse,
} from './diagrams.service.js';

/** CU02 — Clases del diagrama, con sus atributos, métodos y parámetros. */
@Controller()
@UseGuards(AuthGuard)
export class ClassesController {
  constructor(private readonly classesService: ClassesService) {}

  @Post('diagrams/:diagramId/classes')
  createClass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('diagramId', ParseUUIDPipe) diagramId: string,
    @Body() body: ClassInput,
  ): Promise<ClassResponse> {
    return this.classesService.createClass(user.id, diagramId, body);
  }

  /** También es el endpoint para mover una clase (pos_x, pos_y). */
  @Patch('classes/:id')
  updateClass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ClassInput,
  ): Promise<ClassResponse> {
    return this.classesService.updateClass(user.id, id, body);
  }

  @Delete('classes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeClass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.classesService.removeClass(user.id, id);
  }

  @Post('classes/:classId/attributes')
  createAttribute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() body: AttributeInput,
  ): Promise<AttributeResponse> {
    return this.classesService.createAttribute(user.id, classId, body);
  }

  @Patch('attributes/:id')
  updateAttribute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttributeInput,
  ): Promise<AttributeResponse> {
    return this.classesService.updateAttribute(user.id, id, body);
  }

  @Delete('attributes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAttribute(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.classesService.removeAttribute(user.id, id);
  }

  @Post('classes/:classId/methods')
  createMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() body: MethodInput,
  ): Promise<MethodResponse> {
    return this.classesService.createMethod(user.id, classId, body);
  }

  @Patch('methods/:id')
  updateMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: MethodInput,
  ): Promise<MethodResponse> {
    return this.classesService.updateMethod(user.id, id, body);
  }

  @Delete('methods/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.classesService.removeMethod(user.id, id);
  }

  @Post('methods/:methodId/parameters')
  createParameter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('methodId', ParseUUIDPipe) methodId: string,
    @Body() body: ParameterInput,
  ): Promise<ParameterResponse> {
    return this.classesService.createParameter(user.id, methodId, body);
  }

  @Patch('parameters/:id')
  updateParameter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ParameterInput,
  ): Promise<ParameterResponse> {
    return this.classesService.updateParameter(user.id, id, body);
  }

  @Delete('parameters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeParameter(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.classesService.removeParameter(user.id, id);
  }
}
