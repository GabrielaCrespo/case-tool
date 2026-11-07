import { api } from './client'
import type {
  AiResult,
  AiSettings,
  AiSettingsInput,
  AiSettingsTest,
  AiStatus,
  AssociationClassInput,
  AssociationClassResult,
  AttributeInput,
  AuthResponse,
  ChatMessage,
  ClassInput,
  CodegenJob,
  Deployment,
  Diagram,
  DiagramInput,
  DiagramValidation,
  ExchangeDocument,
  FullDiagram,
  ImageImportResult,
  MemoryEntry,
  MemoryEntryInput,
  MethodInput,
  ParameterInput,
  Project,
  ProjectInput,
  ProjectMember,
  ProjectMemory,
  RelationshipInput,
  UmlAttribute,
  UmlClass,
  UmlMethod,
  UmlParameter,
  UmlRelationship,
  User,
  VoiceResult,
  XmiImportResult,
} from './types'

/** Autenticación: POST /auth/register, POST /auth/login, GET /auth/me. */
export const authApi = {
  register: (body: { full_name: string; email: string; password: string }) =>
    api.post<AuthResponse>('/auth/register', body, true),
  login: (body: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', body, true),
  me: () => api.get<User>('/auth/me'),
}

/** CU01 — Gestionar Proyecto de Diseño. */
export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (body: ProjectInput) => api.post<Project>('/projects', body),
  update: (id: string, body: ProjectInput) => api.patch<Project>(`/projects/${id}`, body),
  remove: (id: string) => api.delete(`/projects/${id}`),
}

/**
 * CU03 — Invitados del proyecto.
 * Sin miembros, un diagrama sólo lo puede abrir su propietario: invitar es lo
 * que hace posible que varias personas trabajen sobre el mismo diagrama.
 */
export const membersApi = {
  list: (projectId: string) => api.get<ProjectMember[]>(`/projects/${projectId}/members`),
  add: (projectId: string, email: string) =>
    api.post<ProjectMember>(`/projects/${projectId}/members`, { email }),
  remove: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
}

/** CU02 — Diseñar Diagrama de Clases UML. */
export const diagramsApi = {
  listByProject: (projectId: string) => api.get<Diagram[]>(`/projects/${projectId}/diagrams`),
  create: (projectId: string, body: DiagramInput) =>
    api.post<Diagram>(`/projects/${projectId}/diagrams`, body),
  /** Diagrama completo: clases con atributos y métodos, más las relaciones. */
  get: (id: string) => api.get<FullDiagram>(`/diagrams/${id}`),
  update: (id: string, body: DiagramInput) => api.patch<Diagram>(`/diagrams/${id}`, body),
  remove: (id: string) => api.delete(`/diagrams/${id}`),
  /** Validación del modelo completo, sobre lo guardado en PostgreSQL. */
  validate: (id: string) => api.get<DiagramValidation>(`/diagrams/${id}/validation`),

  /**
   * El diagrama en el formato de intercambio, para guardarlo como archivo.
   * No tiene nada que ver con CU05: aquí no hay imagen ni IA, sólo el modelo
   * guardado escrito en JSON.
   */
  exportDocument: (id: string) => api.get<ExchangeDocument>(`/diagrams/${id}/export`),

  /** Crea un diagrama nuevo a partir de un archivo exportado antes. */
  importDocument: (projectId: string, document: unknown, name?: string) =>
    api.post<FullDiagram>(`/projects/${projectId}/diagrams/import`, { document, name }),

  /**
   * CU06 — El diagrama como XMI 2.1, para abrirlo en otra herramienta UML.
   * Llega como texto porque es un archivo XML, no una respuesta JSON.
   */
  exportXmi: (id: string) => api.getText(`/diagrams/${id}/xmi`),

  /** CU06 — Crea un diagrama nuevo leyendo un archivo .xmi. */
  importXmi: (projectId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)

    return api.upload<XmiImportResult>(`/projects/${projectId}/diagrams/import-xmi`, form)
  },
}

/**
 * CU07 — Generar Backend y CU08 — Descargar Backend.
 *
 * `generate` no espera al resultado: devuelve el trabajo recién creado, y el
 * estado se sigue con `status` hasta que llega a SUCCESS o a FAILED. Sólo
 * entonces hay algo que descargar.
 */
export const backendApi = {
  generate: (diagramId: string) => api.post<CodegenJob>(`/diagrams/${diagramId}/backend`),
  /** null si a este diagrama nunca se le ha generado el backend. */
  status: (diagramId: string) => api.get<CodegenJob | null>(`/diagrams/${diagramId}/backend`),
  /** CU08 — El proyecto generado, comprimido. */
  download: (diagramId: string) => api.getFile(`/diagrams/${diagramId}/backend/download`),
}

/**
 * Publicar el backend generado: dejarlo respondiendo en una URL pública.
 *
 * Es lo que hace posible CU09, porque la aplicación móvil necesita una
 * dirección a la que llamar. Como construir la imagen tarda, `deploy` devuelve
 * el despliegue en marcha y se consulta `status` hasta que llega a RUNNING.
 */
export const deploymentApi = {
  deploy: (diagramId: string) => api.post<Deployment>(`/diagrams/${diagramId}/deployment`),
  /** null si a este diagrama nunca se le ha publicado el backend. */
  status: (diagramId: string) => api.get<Deployment | null>(`/diagrams/${diagramId}/deployment`),
  /** Las últimas líneas del contenedor: lo que explica un arranque fallido. */
  logs: (diagramId: string) =>
    api.get<{ lines: string }>(`/diagrams/${diagramId}/deployment/logs`),
  /** Da de baja: para el contenedor y borra su base de datos. */
  remove: (diagramId: string) => api.delete<Deployment>(`/diagrams/${diagramId}/deployment`),
}

/** CU02 — Clases del diagrama y su contenido. */
export const classesApi = {
  create: (diagramId: string, body: ClassInput) =>
    api.post<UmlClass>(`/diagrams/${diagramId}/classes`, body),
  /** También mueve la clase por el lienzo: PATCH con pos_x y pos_y. */
  update: (id: string, body: ClassInput) => api.patch<UmlClass>(`/classes/${id}`, body),
  remove: (id: string) => api.delete(`/classes/${id}`),

  createAttribute: (classId: string, body: AttributeInput) =>
    api.post<UmlAttribute>(`/classes/${classId}/attributes`, body),
  updateAttribute: (id: string, body: AttributeInput) =>
    api.patch<UmlAttribute>(`/attributes/${id}`, body),
  removeAttribute: (id: string) => api.delete(`/attributes/${id}`),

  createMethod: (classId: string, body: MethodInput) =>
    api.post<UmlMethod>(`/classes/${classId}/methods`, body),
  updateMethod: (id: string, body: MethodInput) => api.patch<UmlMethod>(`/methods/${id}`, body),
  removeMethod: (id: string) => api.delete(`/methods/${id}`),

  createParameter: (methodId: string, body: ParameterInput) =>
    api.post<UmlParameter>(`/methods/${methodId}/parameters`, body),
  updateParameter: (id: string, body: ParameterInput) =>
    api.patch<UmlParameter>(`/parameters/${id}`, body),
  removeParameter: (id: string) => api.delete(`/parameters/${id}`),
}

/**
 * CU04 — Asistir el Diseño mediante IA, por texto y por voz.
 * CU05 — Generar Diagrama desde Imagen.
 *
 * Las tres operaciones devuelven el diagrama completo ya actualizado, así que
 * el editor no necesita volver a pedirlo para pintar el resultado.
 */
export const aiApi = {
  interpret: (body: { projectId?: string; diagramId: string; command: string }) =>
    api.post<AiResult>('/ai/interpret', body),

  /**
   * Manda la grabación y recibe la transcripción junto con el resultado: en el
   * servidor, el texto transcrito entra por el mismo sitio que el tecleado.
   */
  voice: (diagramId: string, audio: Blob, fileName: string) => {
    const form = new FormData()
    form.append('diagram_id', diagramId)
    form.append('audio', audio, fileName)

    return api.upload<VoiceResult>('/ai/voice', form)
  },

  imageToUml: (diagramId: string, image: File) => {
    const form = new FormData()
    form.append('diagram_id', diagramId)
    form.append('image', image)

    return api.upload<ImageImportResult>('/ai/image-to-uml', form)
  },
}

/**
 * CU12 y CU13 — El chat del equipo con la IA, uno por proyecto.
 *
 * Preguntar devuelve la pregunta ya guardada; la respuesta de la IA llega
 * después por la sala del proyecto (evento chat:message), como cualquier otro
 * mensaje del chat.
 */
export const chatApi = {
  list: (projectId: string) => api.get<ChatMessage[]>(`/projects/${projectId}/chat`),
  ask: (projectId: string, body: { content: string; diagram_id: string | null }) =>
    api.post<ChatMessage>(`/projects/${projectId}/chat`, body),
  /** CU15 — Aplicar o descartar lo que propuso la IA; vuelve el mensaje ya resuelto. */
  apply: (messageId: string) => api.post<ChatMessage>(`/chat/${messageId}/apply`),
  reject: (messageId: string) => api.post<ChatMessage>(`/chat/${messageId}/reject`),
}

/**
 * CU14 — La memoria del proyecto: lo que la IA del chat tiene en cuenta además
 * de los diagramas. La lee el equipo; la cambia el propietario.
 */
export const memoryApi = {
  get: (projectId: string) => api.get<ProjectMemory>(`/projects/${projectId}/memory`),
  create: (projectId: string, body: MemoryEntryInput) =>
    api.post<MemoryEntry>(`/projects/${projectId}/memory`, body),
  update: (id: string, body: MemoryEntryInput) => api.patch<MemoryEntry>(`/memory/${id}`, body),
  remove: (id: string) => api.delete(`/memory/${id}`),
  /** La IA resume lo nuevo del chat y lo guarda como una entrada más. */
  summarize: (projectId: string) => api.post<MemoryEntry>(`/projects/${projectId}/memory/summary`),
}

/**
 * CU11 — Configurar Servicio de IA. `status` lo usa cualquiera; el resto, sólo
 * un administrador. La prueba de conexión no guarda nada: sirve para probar
 * unos valores antes de guardarlos.
 */
export const assistantApi = {
  status: () => api.get<AiStatus>('/ai/status'),
  settings: () => api.get<AiSettings>('/ai/settings'),
  updateSettings: (body: AiSettingsInput) => api.patch<AiSettings>('/ai/settings', body),
  testSettings: (body: AiSettingsInput) => api.post<AiSettingsTest>('/ai/settings/test', body),
}

/** CU02 — Relaciones entre clases y sus multiplicidades. */
export const relationshipsApi = {
  create: (diagramId: string, body: RelationshipInput) =>
    api.post<UmlRelationship>(`/diagrams/${diagramId}/relationships`, body),
  update: (id: string, body: RelationshipInput) =>
    api.patch<UmlRelationship>(`/relationships/${id}`, body),
  remove: (id: string) => api.delete(`/relationships/${id}`),
  /** Une dos clases con una clase intermedia y sus dos asociaciones 1:0..*. */
  createAssociationClass: (diagramId: string, body: AssociationClassInput) =>
    api.post<AssociationClassResult>(`/diagrams/${diagramId}/association-classes`, body),
}
