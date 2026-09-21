import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DiagramsModule } from '../diagrams/diagrams.module.js';
import { CodegenController } from './codegen.controller.js';
import { CodegenService } from './codegen.service.js';

/**
 * CU07 — Generar Backend.
 * CU08 — Descargar Backend.
 *
 * No tiene modelo propio: toma de DiagramsModule el mismo servicio con el que
 * el lienzo lee el diagrama, de modo que el backend generado sale exactamente
 * del modelo que el usuario tiene delante, con los mismos permisos y la misma
 * validación.
 */
@Module({
  imports: [AuthModule, DiagramsModule],
  controllers: [CodegenController],
  providers: [CodegenService],
})
export class CodegenModule {}
