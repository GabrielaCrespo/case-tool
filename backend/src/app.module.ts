import { Module } from '@nestjs/common';
import { AiModule } from './ai/ai.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { CodegenModule } from './codegen/codegen.module.js';
import { CollaborationModule } from './collaboration/collaboration.module.js';
import { RealtimeStateModule } from './collaboration/realtime-state.module.js';
import { DiagramsModule } from './diagrams/diagrams.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { XmiModule } from './xmi/xmi.module.js';

@Module({
  imports: [
    RealtimeStateModule,
    AuthModule,
    ProjectsModule,
    DiagramsModule,
    CollaborationModule,
    AiModule,
    XmiModule,
    CodegenModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
