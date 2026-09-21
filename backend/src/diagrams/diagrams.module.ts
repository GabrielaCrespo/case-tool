import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ClassesController } from './classes.controller.js';
import { ClassesService } from './classes.service.js';
import { DiagramExchangeService } from './diagram-exchange.service.js';
import { DiagramsController } from './diagrams.controller.js';
import { DiagramsService } from './diagrams.service.js';
import { RelationshipsController } from './relationships.controller.js';
import { RelationshipsService } from './relationships.service.js';

/** CU02 — Diseñar Diagrama de Clases UML. */
@Module({
  // AuthModule aporta el AuthGuard que protege estas rutas.
  imports: [AuthModule],
  controllers: [DiagramsController, ClassesController, RelationshipsController],
  providers: [DiagramsService, ClassesService, RelationshipsService, DiagramExchangeService],
  // El gateway de CU03 comprueba con DiagramsService quién puede entrar a la
  // sala, y el asistente de IA (CU04/CU05) ejecuta sus acciones con estos tres
  // servicios: así no hay una segunda forma de escribir en el modelo UML.
  exports: [DiagramsService, ClassesService, RelationshipsService],
})
export class DiagramsModule {}
