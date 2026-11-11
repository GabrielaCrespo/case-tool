/**
 * Contratos de la API NestJS.
 *
 * Reproducen exactamente las interfaces que exponen los servicios del backend
 * (`auth.service.ts`, `projects.service.ts`, `diagrams.service.ts`), incluido el
 * uso de snake_case: la API responde con los nombres de columna de PostgreSQL.
 */

export interface User {
  id: string
  full_name: string
  email: string
  avatar_url: string | null
  /**
   * CU11 — Puede configurar el servicio de IA. Opcional porque una sesión
   * guardada antes de que existiera no lo trae hasta revalidarse.
   */
  is_admin?: boolean
  created_at: string
  updated_at: string
}

/** CU12/CU13 — Un mensaje del chat del equipo con la IA. */
export interface ChatMessage {
  id: string
  project_id: string
  diagram_id: string | null
  diagram_name: string | null
  /** null es la IA. */
  author: { id: string; full_name: string } | null
  /** En la respuesta de la IA, la pregunta a la que contesta. */
  reply_to: string | null
  content: string
  /** CU15 — Los cambios que propone la IA; `summary` dice qué hará cada uno. */
  proposed_actions: { actions: unknown[]; summary: string[] } | null
  action_status: 'NONE' | 'PROPOSED' | 'APPLIED' | 'REJECTED' | 'FAILED'
  /** Qué se hizo al aplicarlos, o por qué no se pudo. */
  action_result: string | null
  /** Quién los aplicó o los descartó. */
  resolved_by: { id: string; full_name: string } | null
  resolved_at: string | null
  model: string | null
  /** La IA no pudo responder; content lo explica. */
  error_message: string | null
  created_at: string
}

/** CU14 — Qué se guarda en la memoria del proyecto. */
export type MemoryKind = 'DECISION' | 'REQUIREMENT' | 'SUMMARY'

export interface MemoryEntry {
  id: string
  project_id: string
  kind: MemoryKind
  title: string
  content: string
  created_by: { id: string; full_name: string }
  created_at: string
  updated_at: string
}

export interface MemoryEntryInput {
  kind?: MemoryKind
  title?: string
  content?: string
}

/** CU14 — Todo lo que la IA sabe del proyecto. */
export interface ProjectMemory {
  project_id: string
  description: string | null
  /** Sólo el propietario cambia la memoria. */
  can_edit: boolean
  entries: MemoryEntry[]
  /** Los diagramas se leen del modelo en cada pregunta, no se guardan aparte. */
  diagrams: { id: string; name: string; classes: number; relationships: number }[]
}

/** CU11 — De qué variable de entorno sale la llave, y si está puesta. */
export interface ApiKeyStatus {
  env: string
  required: boolean
  configured: boolean
}

/** CU11 — La configuración del modelo del chat (sólo administradores). */
export interface AiSettings {
  provider: 'GEMINI' | 'OPENAI_COMPATIBLE'
  base_url: string
  model: string
  enabled: boolean
  context_budget: number
  max_tokens: number
  api_key: ApiKeyStatus
  /** false mientras se usan los valores por defecto, sin guardar. */
  saved: boolean
  updated_by: string | null
  updated_at: string | null
}

export interface AiSettingsInput {
  provider?: AiSettings['provider']
  base_url?: string
  model?: string
  enabled?: boolean
  context_budget?: number
  max_tokens?: number
}

export interface AiSettingsTest {
  ok: boolean
  provider: AiSettings['provider']
  base_url: string
  model: string
  api_key: ApiKeyStatus
  latency_ms: number | null
  reply: string | null
  message: string
}

/** CU11 — Si al asistente del chat se le puede preguntar ahora. */
export interface AiStatus {
  enabled: boolean
  available: boolean
  provider: 'GEMINI' | 'OPENAI_COMPATIBLE'
  model: string
  /** Por qué no está disponible. */
  reason: string | null
}

export interface AuthResponse {
  access_token: string
  token_type: 'Bearer'
  user: User
}

/**
 * CU15 — Hasta dónde llega la IA del chat en el proyecto: sólo responder,
 * proponer cambios que una persona aplica, o aplicarlos ella misma.
 */
export type AiMode = 'ANSWER' | 'PROPOSE' | 'EXECUTE'

export interface Project {
  id: string
  name: string
  description: string | null
  owner_id: string
  ai_mode: AiMode
  created_at: string
  updated_at: string
}

export interface ProjectInput {
  name?: string
  description?: string | null
  ai_mode?: AiMode
}

/** CU03 — Una persona con acceso al proyecto. */
export interface ProjectMember {
  user_id: string
  full_name: string
  email: string
  /** OWNER para el propietario; EDITOR o VIEWER para los invitados. */
  role: string
}

export interface Diagram {
  id: string
  project_id: string
  name: string
  description: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface DiagramInput {
  name?: string
  description?: string | null
}

/** Valores del tipo enumerado `uml_visibility` de PostgreSQL. */
export const VISIBILITIES = ['public', 'private', 'protected', 'package'] as const

export type Visibility = (typeof VISIBILITIES)[number]

/** Estereotipos admitidos; la ausencia de estereotipo se guarda como null. */
export const STEREOTYPES = ['entity', 'interface', 'service', 'enumeration'] as const

export type Stereotype = (typeof STEREOTYPES)[number]

/**
 * Un atributo es una columna de la tabla. No hay ningún campo de clave
 * primaria: la de toda entidad es «id» y la pone la herramienta (PRIMARY_KEY en
 * features/editor/uml.ts).
 */
export interface UmlAttribute {
  id: string
  class_id: string
  name: string
  /** null = el atributo existe pero todavía no se sabe de qué tipo es. */
  data_type: string | null
  visibility: Visibility
  is_nullable: boolean
  is_unique: boolean
  default_value: string | null
  /** UML 2.5: miembro de la clase, no de cada objeto. Se dibuja subrayado. */
  is_static: boolean
  /** UML 2.5: se calcula a partir de otros. Se dibuja con «/» delante. */
  is_derived: boolean
  /** UML 2.5: no cambia una vez asignado. Se dibuja con {readOnly}. */
  is_read_only: boolean
  /** UML 2.5: «[0..*]» tras el tipo. null = [1], que no se escribe. */
  multiplicity: string | null
  order_index: number
  created_at: string
  updated_at: string
}

export interface AttributeInput {
  name?: string
  /** null quita el tipo, dejando el atributo sin determinar. */
  data_type?: string | null
  visibility?: Visibility
  is_nullable?: boolean
  is_unique?: boolean
  default_value?: string | null
  is_static?: boolean
  is_derived?: boolean
  is_read_only?: boolean
  /** null quita la multiplicidad y vuelve a [1]. */
  multiplicity?: string | null
  order_index?: number
}

/** uml_method_parameters no tiene columna updated_at en la base de datos. */
export interface UmlParameter {
  id: string
  method_id: string
  name: string
  data_type: string
  order_index: number
  created_at: string
}

export interface ParameterInput {
  name?: string
  data_type?: string
  order_index?: number
}

/** uml_methods no tiene columna updated_at en la base de datos. */
export interface UmlMethod {
  id: string
  class_id: string
  name: string
  return_type: string
  visibility: Visibility
  /** UML 2.5: operación de la clase. Se dibuja subrayada. */
  is_static: boolean
  /** UML 2.5: sin implementación. Se dibuja en cursiva. */
  is_abstract: boolean
  order_index: number
  created_at: string
  /** Los parámetros viajan siempre con el método: son parte de su firma. */
  parameters: UmlParameter[]
}

export interface MethodInput {
  name?: string
  return_type?: string
  visibility?: Visibility
  is_static?: boolean
  is_abstract?: boolean
  order_index?: number
}

export interface UmlClass {
  id: string
  diagram_id: string
  name: string
  stereotype: string | null
  is_abstract: boolean
  visibility: Visibility
  pos_x: number
  pos_y: number
  /** null = tamaño automático según el contenido. */
  width: number | null
  height: number | null
  created_at: string
  updated_at: string
}

export interface ClassInput {
  name?: string
  stereotype?: string | null
  is_abstract?: boolean
  visibility?: Visibility
  pos_x?: number
  pos_y?: number
  width?: number | null
  height?: number | null
}

/** Una clase con su contenido, tal como la devuelve GET /diagrams/:id. */
export interface UmlClassFull extends UmlClass {
  attributes: UmlAttribute[]
  methods: UmlMethod[]
}

/** Valores del tipo enumerado `relationship_type` de PostgreSQL. */
export const RELATIONSHIP_TYPES = [
  'ASSOCIATION',
  'AGGREGATION',
  'COMPOSITION',
  'INHERITANCE',
  'REALIZATION',
  'DEPENDENCY',
] as const

export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number]

export interface UmlRelationship {
  id: string
  diagram_id: string
  source_class_id: string
  target_class_id: string
  relationship_type: RelationshipType
  source_multiplicity: string | null
  target_multiplicity: string | null
  name: string | null
  source_role: string | null
  target_role: string | null
  is_navigable_source: boolean
  is_navigable_target: boolean
  created_at: string
  updated_at: string
}

export interface RelationshipInput {
  source_class_id?: string
  target_class_id?: string
  relationship_type?: RelationshipType
  source_multiplicity?: string | null
  target_multiplicity?: string | null
  name?: string | null
  source_role?: string | null
  target_role?: string | null
  is_navigable_source?: boolean
  is_navigable_target?: boolean
}

/** Diagrama completo: lo que el editor necesita para dibujar el lienzo. */
export interface FullDiagram extends Diagram {
  classes: UmlClassFull[]
  relationships: UmlRelationship[]
}

/** CU02 — Resultado de validar el modelo completo. */
export type IssueSeverity = 'error' | 'warning'

export type IssueElementType =
  | 'DIAGRAM'
  | 'CLASS'
  | 'ATTRIBUTE'
  | 'METHOD'
  | 'PARAMETER'
  | 'RELATIONSHIP'

export interface ValidationIssue {
  severity: IssueSeverity
  code: string
  message: string
  element_type: IssueElementType
  element_id: string | null
  /** Clase a la que llevar al usuario al pulsar el aviso. */
  class_id: string | null
  relationship_id: string | null
}

export interface DiagramValidation {
  diagram_id: string
  valid: boolean
  errors: number
  warnings: number
  /** Válido y con al menos una entidad: listo para el generador (CU07). */
  ready_for_generation: boolean
  issues: ValidationIssue[]
}

/**
 * CU02 — Resultado de unir dos clases con una clase de asociación: la clase
 * intermedia con su clave primaria y las dos asociaciones 1:0..* que la unen a
 * las clases enlazadas.
 */
export interface AssociationClassResult {
  class: UmlClassFull
  relationships: UmlRelationship[]
}

export interface AssociationClassInput {
  source_class_id: string
  target_class_id: string
  name?: string
}

/**
 * CU04/CU05 — Resultado del asistente de IA.
 *
 * Los dos casos de uso responden lo mismo porque hacen lo mismo: interpretar
 * algo —una instrucción o una imagen— y aplicarlo al modelo UML de CU02.
 */
export type AiResultStatus =
  /** Se interpretó, se validó y se aplicó al diagrama. */
  | 'APPLIED'
  /** No se pudo interpretar o no era posible: el diagrama no se tocó. */
  | 'REJECTED'
  /** Se interpretó bien, pero algo falló al guardar. */
  | 'FAILED'

export interface AiResult {
  status: AiResultStatus
  /** Lo que se hizo, frase a frase. */
  applied: string[]
  /** Por qué no se hizo. */
  rejections: string[]
  /** Decisiones que tomó el sistema por su cuenta. */
  warnings: string[]
  /** El diagrama completo ya actualizado: el lienzo se repinta con esto. */
  diagram: FullDiagram
}

/**
 * CU05 — Además, cuánto se leyó de la imagen. La imagen no vuelve ni queda
 * guardada en ninguna parte: se usa una vez, para leerla, y se descarta.
 */
export interface ImageImportResult extends AiResult {
  job_id: string
  classes_created: number
  relationships_created: number
}

/**
 * CU04 por voz — El mismo resultado, más lo que se entendió al dictar.
 * La transcripción llega también cuando la instrucción se rechaza: es lo que
 * permite ver si falló el micrófono o si lo pedido no era posible.
 */
export interface VoiceResult extends AiResult {
  transcription: string
}

/**
 * CU06 — Resultado de importar un archivo XMI.
 *
 * Se cuenta qué entró y qué no: un XMI de otra herramienta puede traer
 * elementos UML que esta no representa, y callarlos haría creer que el
 * diagrama está completo.
 */
export interface XmiImportResult {
  diagram: FullDiagram
  summary: {
    classes: number
    attributes: number
    methods: number
    relationships: number
    /** Elementos UML reconocidos que esta herramienta no representa. */
    skipped: string[]
    /** Ajustes que hubo que hacer para poder guardar lo leído. */
    warnings: string[]
  }
}

/**
 * Formato de intercambio: el diagrama guardado como archivo.
 *
 * No confundirlo con CU05. Allí se sube una imagen y una IA adivina qué hay
 * dibujado; esto es un archivo que escribió la propia herramienta, así que al
 * importarlo no hay nada que interpretar. Los atributos sin tipo viajan con
 * `type: null` y vuelven igual: exportar e importar no rellena huecos.
 */
export interface ExchangeDocument {
  format: 'CASE-TOOL'
  version: string
  diagram: { name: string; description: string | null }
  nodes: {
    id: string
    type: 'class'
    position: { x: number; y: number }
    size: { width: number; height: number } | null
    data: {
      name: string
      stereotype: string | null
      is_abstract: boolean
      visibility: string
      attributes: {
        id: string
        name: string
        type: string | null
        visibility: string
        is_nullable: boolean
        is_unique: boolean
        default_value: string | null
        is_static?: boolean
        is_derived?: boolean
        is_read_only?: boolean
        multiplicity?: string | null
        order_index: number
      }[]
      methods: {
        id: string
        name: string
        return_type: string
        visibility: string
        is_static?: boolean
        is_abstract?: boolean
        order_index: number
        parameters: { name: string; type: string; order_index: number }[]
      }[]
    }
  }[]
  edges: {
    id: string
    source: string
    target: string
    type: string
    data: {
      sourceMultiplicity: string | null
      targetMultiplicity: string | null
      name: string | null
      sourceRole: string | null
      targetRole: string | null
      isNavigableSource: boolean
      isNavigableTarget: boolean
    }
  }[]
}

/**
 * CU07 — Un trabajo de generación del backend Spring Boot.
 *
 * Generar lleva su tiempo —se compila el proyecto con Maven—, así que la API
 * devuelve el trabajo en marcha y el estado se consulta después. Los estados
 * son los de la columna `codegen_status`: PENDING mientras no ha empezado,
 * GENERATING mientras el generador Java escribe el proyecto, COMPILING
 * mientras Maven lo compila, y SUCCESS o FAILED al terminar.
 */
export type CodegenStatus = 'PENDING' | 'GENERATING' | 'COMPILING' | 'SUCCESS' | 'FAILED'

/** Resumen de lo que el generador escribió, tal como lo dejó en su informe. */
export interface CodegenSummary {
  project_name: string
  base_package: string
  classes: number
  entities: number
  endpoints: number
  files: string[]
  /** Decisiones que el generador tomó por su cuenta y conviene revisar. */
  notes: string[]
}

export interface CodegenJob {
  id: string
  diagram_id: string
  status: CodegenStatus
  /** null mientras no se haya llegado a compilar. */
  compile_check_passed: boolean | null
  /**
   * Si además de compilar arrancó contra una PostgreSQL y contestó. null
   * cuando no se llegó a probarlo, que es lo normal si el servidor no tiene
   * configurada una base de pruebas.
   */
  smoke_check_passed: boolean | null
  download_url: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
  summary: CodegenSummary | null
}

/**
 * En qué anda la publicación del backend generado.
 *
 * Publicar no es un caso de uso: es lo que sigue a generar y a descargar, y
 * deja el backend respondiendo en una URL pública. Los estados son los pasos
 * por los que pasa: construir la imagen, crear su base y arrancar el
 * contenedor.
 */
export type DeploymentStatus =
  | 'PENDING'
  | 'BUILDING'
  | 'STARTING'
  | 'RUNNING'
  | 'FAILED'
  | 'STOPPED'

export interface Deployment {
  id: string
  diagram_id: string
  status: DeploymentStatus
  /** Lo que identifica al backend dentro del dominio: /d/<slug>. */
  slug: string
  /** La URL pública; sólo cuando el backend llegó a responder. */
  api_url: string | null
  error_message: string | null
  created_at: string
  updated_at: string
  deployed_at: string | null
}
