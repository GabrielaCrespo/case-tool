import { Logger } from '@nestjs/common';
import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service.js';
import { corsOrigins } from '../cors-origins.js';
import { DiagramsService } from '../diagrams/diagrams.service.js';
import { ChatEventsService } from './chat-events.service.js';
import type { LockableType, Participant } from './collaboration-events.js';
import { COLLABORATION_EVENTS } from './collaboration-events.js';
import { DiagramEventsService } from './diagram-events.service.js';
import { LockRegistryService } from './lock-registry.service.js';

/** Datos que el gateway guarda de cada conexión. */
interface SocketSession {
  userId: string;
  fullName: string;
  email: string;
  diagramId: string | null;
  /** CU13 — El proyecto del diagrama abierto, cuya sala de chat se recibe. */
  projectId: string | null;
}

interface JwtPayload {
  sub: string;
  email: string;
}

/** La sala de socket.io que corresponde a un diagrama. */
function roomOf(diagramId: string): string {
  return `diagram:${diagramId}`;
}

/**
 * CU13 — La sala del chat del equipo. Es del proyecto y no del diagrama: quien
 * pregunta desde «Ventas» y quien trabaja en «Inventario» son el mismo equipo
 * y ven la misma conversación.
 */
function projectRoomOf(projectId: string): string {
  return `project:${projectId}`;
}

/**
 * CU03 — Colaborar en el Diseño del Diagrama.
 *
 * Cada diagrama es una sala. El gateway no guarda nada en PostgreSQL: los
 * cambios se siguen escribiendo por la API REST de CU02, que valida y persiste,
 * y desde ahí llegan aquí por DiagramEventsService para difundirse a la sala.
 * Lo que sí gestiona el gateway es lo que sólo existe mientras hay gente
 * conectada: quién está dentro y quién tiene tomado cada elemento.
 */
@WebSocketGateway({
  namespace: '/collaboration',
  cors: { origin: corsOrigins(), credentials: true },
})
export class CollaborationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CollaborationGateway.name);
  private readonly sessions = new Map<string, SocketSession>();

  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly diagramsService: DiagramsService,
    private readonly diagramEvents: DiagramEventsService,
    private readonly locks: LockRegistryService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  afterInit(): void {
    // La autenticación va en un middleware, no en handleConnection: el cliente
    // emite `diagram:join` en cuanto el socket queda establecido, y si la
    // identificación (que consulta el token y la base) todavía no ha terminado,
    // la petición llegaría sin sesión. El middleware se ejecuta antes de dar la
    // conexión por buena, así que cuando el cliente puede hablar ya está
    // identificado.
    this.server.use((client, next) => {
      void this.authenticate(client, next);
    });

    // Difunde a la sala cada cambio que los servicios de CU02 ya guardaron.
    this.diagramEvents.changes$.subscribe((change) => {
      this.server.to(roomOf(change.diagram_id)).emit(COLLABORATION_EVENTS.changed, change);
    });

    // CU13 — Y cada mensaje del chat del equipo, a la sala del proyecto.
    this.chatEvents.events$.subscribe((event) => {
      this.server.to(projectRoomOf(event.project_id)).emit(event.kind, event.payload);
    });
  }

  /**
   * El token viaja en el handshake. Una conexión sin token válido se rechaza:
   * por WebSocket no pasa nada que no pase por autenticación.
   */
  private async authenticate(client: Socket, next: (error?: Error) => void): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      next(new Error('Falta el token de acceso.'));
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      const user = await this.authService.findById(payload.sub);

      this.sessions.set(client.id, {
        userId: user.id,
        fullName: user.full_name,
        email: user.email,
        diagramId: null,
        projectId: null,
      });
      next();
    } catch {
      next(new Error('El token de acceso no es válido o ha caducado.'));
    }
  }

  handleConnection(client: Socket): void {
    const session = this.sessions.get(client.id);

    if (session) {
      this.logger.log(`${session.email} conectado`);
    }
  }

  /**
   * Al desconectarse (cierre de pestaña, pérdida de red o recarga) se sueltan
   * sus bloqueos y se avisa a la sala, para que nadie quede bloqueado por
   * alguien que ya no está.
   */
  handleDisconnect(client: Socket): void {
    const session = this.sessions.get(client.id);
    this.sessions.delete(client.id);

    for (const lock of this.locks.releaseAllFor(client.id)) {
      this.server.to(roomOf(lock.diagram_id)).emit(COLLABORATION_EVENTS.lockChanged, {
        element_type: lock.element_type,
        element_id: lock.element_id,
        holder: null,
      });
    }

    if (session?.diagramId) {
      this.broadcastPresence(session.diagramId);
    }
  }

  /**
   * Unirse a la sala del diagrama. Se comprueban los permisos de CU01/CU02: sólo
   * entra quien puede abrir ese diagrama por la API.
   */
  @SubscribeMessage(COLLABORATION_EVENTS.join)
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { diagram_id?: unknown },
  ): Promise<{ ok: true; participants: Participant[]; locks: unknown[] } | { ok: false; message: string }> {
    const session = this.sessions.get(client.id);
    const diagramId = typeof body?.diagram_id === 'string' ? body.diagram_id : null;

    if (!session || !diagramId) {
      return { ok: false, message: 'Petición de acceso a la sala incompleta.' };
    }

    let projectId: string;
    try {
      projectId = (await this.diagramsService.assertDiagramAccess(session.userId, diagramId)).projectId;
    } catch {
      return { ok: false, message: 'No tiene acceso a este diagrama.' };
    }

    // Al reconectar o cambiar de diagrama se abandona la sala anterior.
    if (session.diagramId && session.diagramId !== diagramId) {
      await this.leaveRoom(client, session);
    }

    session.diagramId = diagramId;
    session.projectId = projectId;
    await client.join(roomOf(diagramId));
    // CU13 — Con el diagrama llega el chat de su proyecto. Los permisos son
    // los mismos: quien puede abrir el diagrama es del equipo.
    await client.join(projectRoomOf(projectId));
    this.broadcastPresence(diagramId);

    this.logger.log(`${session.email} entró al diagrama ${diagramId}`);

    return {
      ok: true,
      participants: this.participantsOf(diagramId),
      locks: this.locks.listByDiagram(diagramId),
    };
  }

  @SubscribeMessage(COLLABORATION_EVENTS.leave)
  async handleLeave(@ConnectedSocket() client: Socket): Promise<{ ok: true }> {
    const session = this.sessions.get(client.id);

    if (session?.diagramId) {
      await this.leaveRoom(client, session);
    }

    return { ok: true };
  }

  /** Tomar una clase o una relación para editarla en exclusiva. */
  @SubscribeMessage(COLLABORATION_EVENTS.lockAcquire)
  handleLockAcquire(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { element_type?: unknown; element_id?: unknown },
  ): { granted: boolean; holder?: unknown; message?: string } {
    const session = this.sessions.get(client.id);
    const elementType = this.readLockableType(body?.element_type);
    const elementId = typeof body?.element_id === 'string' ? body.element_id : null;

    if (!session?.diagramId || !elementType || !elementId) {
      return { granted: false, message: 'Petición de bloqueo incompleta.' };
    }

    const { granted, lock } = this.locks.acquire(session.diagramId, elementType, elementId, {
      user_id: session.userId,
      full_name: session.fullName,
      socket_id: client.id,
    });

    if (granted) {
      // Sólo al resto: quien lo pide ya recibe la respuesta de esta llamada.
      client.to(roomOf(session.diagramId)).emit(COLLABORATION_EVENTS.lockChanged, {
        element_type: elementType,
        element_id: elementId,
        holder: lock.holder,
      });
    }

    return { granted, holder: lock.holder };
  }

  @SubscribeMessage(COLLABORATION_EVENTS.lockRelease)
  handleLockRelease(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { element_type?: unknown; element_id?: unknown },
  ): { ok: true } {
    const session = this.sessions.get(client.id);
    const elementType = this.readLockableType(body?.element_type);
    const elementId = typeof body?.element_id === 'string' ? body.element_id : null;

    if (session?.diagramId && elementType && elementId) {
      const released = this.locks.release(elementType, elementId, client.id);

      if (released) {
        this.server.to(roomOf(session.diagramId)).emit(COLLABORATION_EVENTS.lockChanged, {
          element_type: elementType,
          element_id: elementId,
          holder: null,
        });
      }
    }

    return { ok: true };
  }

  private async leaveRoom(client: Socket, session: SocketSession): Promise<void> {
    const diagramId = session.diagramId;
    if (!diagramId) return;

    for (const lock of this.locks.releaseAllFor(client.id)) {
      this.server.to(roomOf(diagramId)).emit(COLLABORATION_EVENTS.lockChanged, {
        element_type: lock.element_type,
        element_id: lock.element_id,
        holder: null,
      });
    }

    await client.leave(roomOf(diagramId));
    if (session.projectId) {
      await client.leave(projectRoomOf(session.projectId));
    }
    session.diagramId = null;
    session.projectId = null;
    this.broadcastPresence(diagramId);
  }

  private broadcastPresence(diagramId: string): void {
    this.server
      .to(roomOf(diagramId))
      .emit(COLLABORATION_EVENTS.presence, { participants: this.participantsOf(diagramId) });
  }

  /** Un usuario con varias pestañas abiertas se muestra una sola vez. */
  private participantsOf(diagramId: string): Participant[] {
    const byUser = new Map<string, Participant>();

    for (const session of this.sessions.values()) {
      if (session.diagramId !== diagramId) continue;

      const existing = byUser.get(session.userId);
      if (existing) {
        existing.sockets += 1;
        continue;
      }
      byUser.set(session.userId, {
        user_id: session.userId,
        full_name: session.fullName,
        email: session.email,
        sockets: 1,
      });
    }

    return [...byUser.values()];
  }

  private readLockableType(value: unknown): LockableType | null {
    return value === 'class' || value === 'relationship' ? value : null;
  }

  /** socket.io admite el token en `auth` y, como respaldo, en la query. */
  private extractToken(client: Socket): string | null {
    const fromAuth = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth.length > 0) {
      return fromAuth;
    }

    const fromQuery = client.handshake.query.token;
    return typeof fromQuery === 'string' && fromQuery.length > 0 ? fromQuery : null;
  }
}
