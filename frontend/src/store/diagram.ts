import { create } from 'zustand'
import { ApiError } from '../api/client'
import { aiApi, classesApi, diagramsApi, relationshipsApi } from '../api/endpoints'
import type {
  AiResult,
  AttributeInput,
  ClassInput,
  Diagram,
  DiagramInput,
  DiagramValidation,
  FullDiagram,
  ImageImportResult,
  MethodInput,
  ParameterInput,
  RelationshipInput,
  UmlClassFull,
  UmlMethod,
  UmlRelationship,
  VoiceResult,
} from '../api/types'
import type {
  DiagramChange,
  LockableType,
  LockChanged,
  LockHolder,
  LockState,
  Participant,
} from '../realtime/types'
import { lockKey } from '../realtime/types'

/**
 * CU02 — Estado del editor de diagramas.
 *
 * Cada cambio se manda a la API en el momento: no hay botón de guardar. La
 * barra de estado del editor refleja si hay peticiones en vuelo o si alguna ha
 * fallado, que es lo que el usuario necesita saber.
 */

export type Selection =
  | { kind: 'class'; id: string }
  | { kind: 'relationship'; id: string }
  | null

/**
 * Elemento cuyo nombre se está escribiendo sobre el lienzo.
 *
 * Vive en el store y no en el lienzo porque quien lo enciende no es quien lo
 * dibuja: al crear una entidad o un atributo es la respuesta de la API —que es
 * quien decide el nombre inicial— la que deja el campo abierto para escribir
 * el nombre de verdad.
 */
export type Renaming = { kind: 'class'; id: string } | { kind: 'attribute'; id: string } | null

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** CU03 — Estado de la conexión con la sala del diagrama. */
export type ConnectionStatus = 'offline' | 'connecting' | 'online'

/**
 * Los errores de guardado se avisan con un aviso emergente, y el store no
 * puede usar hooks de React: la página del editor registra aquí su función.
 */
let reportError: (message: string) => void = () => {}

export function setDiagramErrorReporter(reporter: (message: string) => void): void {
  reportError = reporter
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

interface DiagramStore {
  diagram: Diagram | null
  classes: UmlClassFull[]
  relationships: UmlRelationship[]

  loadStatus: LoadStatus
  loadError: string | null
  /**
   * Se está releyendo un diagrama que ya estaba abierto (por ejemplo tras
   * reconectar). Es distinto de `loadStatus === 'loading'`: el lienzo sigue
   * en pie con lo que ya tenía, y sólo se avisa en la barra de estado.
   */
  reloading: boolean
  /** Peticiones de guardado en vuelo. */
  pending: number
  saveError: string | null

  selection: Selection
  /** CU02 — Nombre que se está escribiendo sobre el lienzo, si hay alguno. */
  renaming: Renaming

  /** Último informe de validación del modelo completo, si se pidió alguno. */
  validation: DiagramValidation | null
  validating: boolean
  /** El modelo cambió desde que se validó: el informe ya no es de fiar. */
  validationStale: boolean

  // ---------------------------------------------------------------- CU03
  /** Usuarios conectados a la sala de este diagrama. */
  participants: Participant[]
  /** Elementos tomados por alguien, indexados por `tipo:id`. */
  locks: Record<string, LockHolder>
  /** Los que tengo tomados yo; sirven para no aplicar mi propio eco. */
  heldLocks: string[]
  connection: ConnectionStatus

  load: (diagramId: string, options?: { preserveSelection?: boolean }) => Promise<void>
  reset: () => void
  select: (selection: Selection) => void
  /** Abre —o cierra, con null— el campo de nombre sobre el lienzo. */
  startRenaming: (renaming: Renaming) => void

  updateDiagram: (input: DiagramInput) => Promise<void>

  createClass: (posX: number, posY: number) => Promise<string | null>
  updateClass: (classId: string, input: ClassInput) => Promise<boolean>
  moveClass: (classId: string, posX: number, posY: number) => Promise<void>
  /**
   * CU02 — Redimensionar una clase en el lienzo; el tamaño se conserva.
   * Llevan también la posición porque arrastrar la esquina superior o el lado
   * izquierdo mueve la caja además de estirarla.
   */
  resizeClass: (
    classId: string,
    width: number,
    height: number,
    posX: number,
    posY: number,
  ) => Promise<void>
  deleteClass: (classId: string) => Promise<void>

  /**
   * `rename` deja el nombre del atributo nuevo abierto para escribirlo: lo pide
   * el «＋» de la caja del lienzo, no el del panel, donde el foco ya está.
   */
  addAttribute: (classId: string, options?: { rename?: boolean }) => Promise<void>
  updateAttribute: (attributeId: string, input: AttributeInput) => Promise<boolean>
  deleteAttribute: (attributeId: string) => Promise<void>
  reorderAttribute: (classId: string, attributeId: string, direction: -1 | 1) => Promise<void>

  addMethod: (classId: string) => Promise<void>
  updateMethod: (methodId: string, input: MethodInput) => Promise<boolean>
  deleteMethod: (methodId: string) => Promise<void>
  reorderMethod: (classId: string, methodId: string, direction: -1 | 1) => Promise<void>

  addParameter: (methodId: string) => Promise<void>
  updateParameter: (parameterId: string, input: ParameterInput) => Promise<boolean>
  deleteParameter: (parameterId: string) => Promise<void>

  createRelationship: (input: RelationshipInput) => Promise<void>
  updateRelationship: (relationshipId: string, input: RelationshipInput) => Promise<boolean>
  deleteRelationship: (relationshipId: string) => Promise<void>
  /** CU02 — Une dos clases con una clase intermedia y sus dos asociaciones. */
  createAssociationClass: (sourceClassId: string, targetClassId: string) => Promise<void>

  /** CU02 — Valida el modelo completo contra lo guardado en la API. */
  validate: () => Promise<void>
  clearValidation: () => void

  /**
   * CU04 — Ejecuta una instrucción en lenguaje natural sobre este diagrama.
   * Devuelve el resultado para poder enseñarlo; el lienzo ya queda repintado.
   */
  runAiCommand: (command: string) => Promise<AiResult | null>
  /**
   * CU04 — Lo mismo, dictado. La API transcribe y sigue por el mismo camino,
   * así que aquí sólo cambia lo que se envía: audio en vez de texto.
   */
  runAiVoice: (audio: Blob, fileName: string) => Promise<VoiceResult | null>
  /** CU05 — Convierte la imagen de un diagrama en clases y relaciones. */
  importFromImage: (image: File) => Promise<ImageImportResult | null>

  // ---------------------------------------------------------------- CU03
  setConnection: (connection: ConnectionStatus) => void
  setParticipants: (participants: Participant[]) => void
  setLocks: (locks: LockState[]) => void
  applyLockChange: (change: LockChanged) => void
  /** Registra que este cliente tomó o soltó un elemento. */
  setHeldLock: (elementType: LockableType, elementId: string, held: boolean) => void
  /** Al perder la conexión, el servidor suelta todo lo que tuviera este cliente. */
  clearHeldLocks: () => void
  /** Aplica un cambio que otro usuario ya guardó. */
  applyRemoteChange: (change: DiagramChange) => void
}

export const useDiagramStore = create<DiagramStore>((set, get) => {
  /** Ejecuta una operación contra la API llevando la cuenta del guardado. */
  async function run<T>(operation: () => Promise<T>, fallback: string): Promise<T | null> {
    set((state) => ({ pending: state.pending + 1 }))
    try {
      const result = await operation()
      // Cualquier cambio deja obsoleto el informe de validación anterior.
      set((state) => ({
        pending: state.pending - 1,
        saveError: null,
        validationStale: state.validation !== null,
      }))
      return result
    } catch (error) {
      const message = messageOf(error, fallback)
      set((state) => ({ pending: state.pending - 1, saveError: message }))
      reportError(message)
      return null
    }
  }

  /** Reemplaza una clase conservando sus atributos y métodos ya cargados. */
  function patchClass(classId: string, changes: Partial<UmlClassFull>) {
    set((state) => ({
      classes: state.classes.map((umlClass) =>
        umlClass.id === classId ? { ...umlClass, ...changes } : umlClass,
      ),
    }))
  }

  /**
   * Añade un elemento creado por este cliente a una lista, salvo que ya esté.
   *
   * El servidor difunde cada alta por WebSocket a toda la sala, incluido quien
   * la hizo: si ese aviso llega antes de que la petición REST que la originó
   * resuelva (ambos van al mismo servidor, así que la carrera es real, no
   * teórica), el elemento ya está en la lista cuando este código se ejecuta.
   * Añadirlo igualmente crearía un id duplicado, y React Flow pierde la cuenta
   * de qué nodo es cuál cuando dos entradas comparten `id`.
   */
  function addUnique<T extends { id: string }>(list: T[], item: T): T[] {
    return list.some((existing) => existing.id === item.id) ? list : [...list, item]
  }

  /**
   * Renumera `order_index` a 0, 1, 2... después de quitar un elemento.
   *
   * La API hace lo mismo sobre PostgreSQL al recibir el borrado; esto sólo
   * mantiene la copia local diciendo lo mismo, para que el siguiente alta no
   * dependa de unos índices con huecos.
   */
  function renumber<T extends { order_index: number }>(list: T[]): T[] {
    return list.map((item, index) =>
      item.order_index === index ? item : { ...item, order_index: index },
    )
  }

  /** Aplica un cambio sobre el método al que pertenece un parámetro. */
  function patchMethod(methodId: string, update: (method: UmlMethod) => UmlMethod) {
    set((state) => ({
      classes: state.classes.map((umlClass) =>
        umlClass.methods.some((method) => method.id === methodId)
          ? {
              ...umlClass,
              methods: umlClass.methods.map((method) =>
                method.id === methodId ? update(method) : method,
              ),
            }
          : umlClass,
      ),
    }))
  }

  /**
   * Reemplaza el modelo con el que devuelve la API.
   *
   * Lo usan CU04 y CU05: sus operaciones pueden crear, cambiar y borrar varias
   * cosas a la vez —una clase con sus atributos y dos relaciones—, así que en
   * lugar de remendar la copia local pieza a pieza se toma entera la que
   * responde el servidor, que es justo lo que hay en PostgreSQL.
   */
  function replaceModel(full: FullDiagram) {
    const { classes, relationships, ...diagram } = full

    set((state) => ({
      diagram,
      classes,
      relationships,
      // Lo seleccionado puede haber dejado de existir: la instrucción pudo
      // ser precisamente «elimina la clase Cliente».
      selection:
        state.selection === null ||
        (state.selection.kind === 'class'
          ? classes.some((umlClass) => umlClass.id === state.selection?.id)
          : relationships.some((relationship) => relationship.id === state.selection?.id))
          ? state.selection
          : null,
      // Una instrucción de CU04 o una foto de CU05 reescriben el modelo entero:
      // lo que se estuviera escribiendo ya no tiene a qué referirse.
      renaming: null,
      validation: null,
      validationStale: false,
    }))
  }

  /** El método al que pertenece un parámetro ya cargado. */
  function methodOfParameter(parameterId: string): UmlMethod | null {
    for (const umlClass of get().classes) {
      for (const method of umlClass.methods) {
        if (method.parameters.some((parameter) => parameter.id === parameterId)) {
          return method
        }
      }
    }
    return null
  }

  return {
    diagram: null,
    classes: [],
    relationships: [],
    loadStatus: 'idle',
    loadError: null,
    reloading: false,
    pending: 0,
    saveError: null,
    selection: null,
    renaming: null,
    validation: null,
    validating: false,
    validationStale: false,
    participants: [],
    locks: {},
    heldLocks: [],
    connection: 'offline',

    /**
     * Lee el diagrama completo de la API.
     *
     * Hay dos casos distintos y no pueden tratarse igual. Abrir el diagrama por
     * primera vez sí deja la pantalla en «cargando», porque todavía no hay nada
     * que enseñar. Releerlo cuando ya estaba abierto —lo que ocurre en cada
     * reconexión del socket, y basta un microcorte de red para provocarla— no
     * puede hacerlo: pasar por «cargando» desmonta el lienzo entero, así que el
     * usuario veía desaparecer sus clases y perdía el encuadre cada vez que la
     * red parpadeaba. En ese caso el lienzo se queda en pie y sólo se marca
     * `reloading`.
     */
    async load(diagramId, options) {
      const state = get()
      const isReload = state.loadStatus === 'ready' && state.diagram?.id === diagramId
      // Al reconectar se recarga el diagrama para recuperar lo ocurrido
      // mientras no había conexión, y ahí conviene no perder la selección.
      const keepSelection = options?.preserveSelection === true

      set({
        ...(isReload ? { reloading: true } : { loadStatus: 'loading' as const }),
        loadError: null,
        // Lo que se estuviera escribiendo se refiere a un elemento que la
        // relectura puede traer cambiado o no traer: se cierra el campo.
        renaming: null,
        ...(keepSelection ? {} : { selection: null }),
      })

      try {
        const full = await diagramsApi.get(diagramId)
        const { classes, relationships, ...diagram } = full
        set({
          diagram,
          classes,
          relationships,
          loadStatus: 'ready',
          loadError: null,
          reloading: false,
          // Acabamos de leer el modelo guardado: lo que se ve en pantalla es
          // exactamente lo que hay en PostgreSQL, así que ya no hay nada por
          // guardar aunque antes fallara algo.
          saveError: null,
          validation: null,
          validationStale: false,
        })
      } catch (error) {
        const message = messageOf(error, 'No se pudo cargar el diagrama.')

        // Si sólo era una relectura, lo que hay en pantalla sigue siendo válido:
        // se avisa del fallo, pero no se tira el lienzo.
        if (isReload) {
          set({ reloading: false, saveError: message })
          reportError(message)
          return
        }
        set({ loadStatus: 'error', loadError: message, reloading: false })
      }
    },

    reset() {
      set({
        diagram: null,
        classes: [],
        relationships: [],
        loadStatus: 'idle',
        loadError: null,
        reloading: false,
        pending: 0,
        saveError: null,
        selection: null,
        renaming: null,
        validation: null,
        validating: false,
        validationStale: false,
        participants: [],
        locks: {},
        heldLocks: [],
        connection: 'offline',
      })
    },

    select(selection) {
      set({ selection })
    },

    startRenaming(renaming) {
      set({ renaming })
    },

    async updateDiagram(input) {
      const diagram = get().diagram
      if (!diagram) return

      const updated = await run(
        () => diagramsApi.update(diagram.id, input),
        'No se pudo guardar el diagrama.',
      )
      if (updated) set({ diagram: updated })
    },

    async createClass(posX, posY) {
      const diagram = get().diagram
      if (!diagram) return null

      // El nombre lo pone la API: uml_classes tiene UNIQUE (diagram_id, name) y
      // desde aquí sólo se ve lo que hay en pantalla, así que dos altas seguidas
      // —o dos personas a la vez— elegirían el mismo número y una se perdería.
      const created = await run(
        () =>
          classesApi.create(diagram.id, {
            pos_x: Math.round(posX),
            pos_y: Math.round(posY),
          }),
        'No se pudo crear la entidad.',
      )
      if (!created) return null

      set((state) => ({
        classes: addUnique(state.classes, { ...created, attributes: [], methods: [] }),
        selection: { kind: 'class', id: created.id },
        // Nace con el nombre que le tocaba de la serie («Entidad1») y con ese
        // nombre seleccionado: colocar la entidad y llamarla «Cliente» es un
        // solo gesto, sin pasar por el panel de la derecha.
        renaming: { kind: 'class', id: created.id },
      }))
      return created.id
    },

    async updateClass(classId, input) {
      const updated = await run(
        () => classesApi.update(classId, input),
        'No se pudo guardar la entidad.',
      )
      if (!updated) return false

      patchClass(classId, updated)
      return true
    },

    async moveClass(classId, posX, posY) {
      // La posición se aplica ya en el lienzo; la API sólo la confirma.
      patchClass(classId, { pos_x: posX, pos_y: posY })
      await run(
        () => classesApi.update(classId, { pos_x: Math.round(posX), pos_y: Math.round(posY) }),
        'No se pudo guardar la posición de la entidad.',
      )
    },

    async resizeClass(classId, width, height, posX, posY) {
      // Igual que moveClass: el lienzo ya aplicó el tamaño mientras se
      // arrastraba la esquina; la API sólo lo confirma. La posición va con él
      // porque tirar del borde superior o del izquierdo mueve la caja: sin
      // guardarla, la clase volvía de un salto a su sitio anterior en cuanto el
      // lienzo se redibujaba desde el modelo.
      patchClass(classId, { width, height, pos_x: posX, pos_y: posY })
      await run(
        () =>
          classesApi.update(classId, {
            width: Math.round(width),
            height: Math.round(height),
            pos_x: Math.round(posX),
            pos_y: Math.round(posY),
          }),
        'No se pudo guardar el tamaño de la entidad.',
      )
    },

    async deleteClass(classId) {
      const done = await run(() => classesApi.remove(classId), 'No se pudo eliminar la entidad.')
      if (done === null) return

      // La base borra en cascada las relaciones donde participa la clase.
      set((state) => ({
        classes: state.classes.filter((umlClass) => umlClass.id !== classId),
        relationships: state.relationships.filter(
          (relationship) =>
            relationship.source_class_id !== classId && relationship.target_class_id !== classId,
        ),
        selection: state.selection?.kind === 'class' && state.selection.id === classId
          ? null
          : state.selection,
      }))
    },

    async addAttribute(classId, options) {
      const umlClass = get().classes.find((candidate) => candidate.id === classId)
      if (!umlClass) return

      // El nombre y el orden los pone la API, que los decide contra lo guardado
      // en PostgreSQL y no contra lo que este cliente tenga en pantalla.
      const created = await run(
        () => classesApi.createAttribute(classId, { data_type: 'String' }),
        'No se pudo añadir el atributo.',
      )
      if (!created) return

      // Se relee el estado actual, no `umlClass`: en lo que tardó la petición
      // pudo llegar por WebSocket el eco de este mismo alta u otro cambio.
      const current = get().classes.find((candidate) => candidate.id === classId)
      if (current) patchClass(classId, { attributes: addUnique(current.attributes, created) })

      if (options?.rename === true) {
        set({ renaming: { kind: 'attribute', id: created.id } })
      }
    },

    async updateAttribute(attributeId, input) {
      const updated = await run(
        () => classesApi.updateAttribute(attributeId, input),
        'No se pudo guardar el atributo.',
      )
      if (!updated) return false

      set((state) => ({
        classes: state.classes.map((umlClass) =>
          umlClass.id === updated.class_id
            ? {
                ...umlClass,
                attributes: umlClass.attributes.map((attribute) =>
                  attribute.id === updated.id ? updated : attribute,
                ),
              }
            : umlClass,
        ),
      }))
      return true
    },

    async deleteAttribute(attributeId) {
      const done = await run(
        () => classesApi.removeAttribute(attributeId),
        'No se pudo eliminar el atributo.',
      )
      if (done === null) return

      set((state) => ({
        classes: state.classes.map((umlClass) =>
          umlClass.attributes.some((attribute) => attribute.id === attributeId)
            ? {
                ...umlClass,
                attributes: renumber(
                  umlClass.attributes.filter((attribute) => attribute.id !== attributeId),
                ),
              }
            : umlClass,
        ),
      }))
    },

    async reorderAttribute(classId, attributeId, direction) {
      const umlClass = get().classes.find((candidate) => candidate.id === classId)
      if (!umlClass) return

      const from = umlClass.attributes.findIndex((attribute) => attribute.id === attributeId)
      const to = from + direction
      if (from < 0 || to < 0 || to >= umlClass.attributes.length) return

      const reordered = [...umlClass.attributes]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved)

      // order_index es lo que ordena la lista en la API; se renumera entera.
      const renumbered = reordered.map((attribute, index) => ({ ...attribute, order_index: index }))
      patchClass(classId, { attributes: renumbered })

      await run(
        () =>
          Promise.all(
            renumbered.map((attribute) =>
              classesApi.updateAttribute(attribute.id, { order_index: attribute.order_index }),
            ),
          ),
        'No se pudo reordenar los atributos.',
      )
    },

    async addMethod(classId) {
      const umlClass = get().classes.find((candidate) => candidate.id === classId)
      if (!umlClass) return

      const created = await run(
        () => classesApi.createMethod(classId, { return_type: 'void' }),
        'No se pudo añadir el método.',
      )
      if (!created) return

      const current = get().classes.find((candidate) => candidate.id === classId)
      if (current) patchClass(classId, { methods: addUnique(current.methods, created) })
    },

    async updateMethod(methodId, input) {
      const updated = await run(
        () => classesApi.updateMethod(methodId, input),
        'No se pudo guardar el método.',
      )
      if (!updated) return false

      set((state) => ({
        classes: state.classes.map((umlClass) =>
          umlClass.id === updated.class_id
            ? {
                ...umlClass,
                methods: umlClass.methods.map((method) =>
                  method.id === updated.id ? updated : method,
                ),
              }
            : umlClass,
        ),
      }))
      return true
    },

    async deleteMethod(methodId) {
      const done = await run(
        () => classesApi.removeMethod(methodId),
        'No se pudo eliminar el método.',
      )
      if (done === null) return

      set((state) => ({
        classes: state.classes.map((umlClass) =>
          umlClass.methods.some((method) => method.id === methodId)
            ? {
                ...umlClass,
                methods: renumber(umlClass.methods.filter((method) => method.id !== methodId)),
              }
            : umlClass,
        ),
      }))
    },

    async reorderMethod(classId, methodId, direction) {
      const umlClass = get().classes.find((candidate) => candidate.id === classId)
      if (!umlClass) return

      const from = umlClass.methods.findIndex((method) => method.id === methodId)
      const to = from + direction
      if (from < 0 || to < 0 || to >= umlClass.methods.length) return

      const reordered = [...umlClass.methods]
      const [moved] = reordered.splice(from, 1)
      reordered.splice(to, 0, moved)

      const renumbered = reordered.map((method, index) => ({ ...method, order_index: index }))
      patchClass(classId, { methods: renumbered })

      await run(
        () =>
          Promise.all(
            renumbered.map((method) =>
              classesApi.updateMethod(method.id, { order_index: method.order_index }),
            ),
          ),
        'No se pudo reordenar los métodos.',
      )
    },

    async addParameter(methodId) {
      const method = get()
        .classes.flatMap((umlClass) => umlClass.methods)
        .find((candidate) => candidate.id === methodId)
      if (!method) return

      const created = await run(
        () => classesApi.createParameter(methodId, { data_type: 'String' }),
        'No se pudo añadir el parámetro.',
      )
      if (!created) return

      patchMethod(methodId, (current) => ({
        ...current,
        parameters: addUnique(current.parameters, created),
      }))
    },

    async updateParameter(parameterId, input) {
      const method = methodOfParameter(parameterId)
      if (!method) return false

      const updated = await run(
        () => classesApi.updateParameter(parameterId, input),
        'No se pudo guardar el parámetro.',
      )
      if (!updated) return false

      patchMethod(method.id, (current) => ({
        ...current,
        parameters: current.parameters.map((parameter) =>
          parameter.id === updated.id ? updated : parameter,
        ),
      }))
      return true
    },

    async deleteParameter(parameterId) {
      const method = methodOfParameter(parameterId)
      if (!method) return

      const done = await run(
        () => classesApi.removeParameter(parameterId),
        'No se pudo eliminar el parámetro.',
      )
      if (done === null) return

      patchMethod(method.id, (current) => ({
        ...current,
        parameters: renumber(
          current.parameters.filter((parameter) => parameter.id !== parameterId),
        ),
      }))
    },

    async createRelationship(input) {
      const diagram = get().diagram
      if (!diagram) return

      const created = await run(
        () => relationshipsApi.create(diagram.id, input),
        'No se pudo crear la relación.',
      )
      if (!created) return

      set((state) => ({
        relationships: addUnique(state.relationships, created),
        selection: { kind: 'relationship', id: created.id },
      }))
    },

    async updateRelationship(relationshipId, input) {
      const updated = await run(
        () => relationshipsApi.update(relationshipId, input),
        'No se pudo guardar la relación.',
      )
      if (!updated) return false

      set((state) => ({
        relationships: state.relationships.map((relationship: UmlRelationship) =>
          relationship.id === relationshipId ? updated : relationship,
        ),
      }))
      return true
    },

    async deleteRelationship(relationshipId) {
      const done = await run(
        () => relationshipsApi.remove(relationshipId),
        'No se pudo eliminar la relación.',
      )
      if (done === null) return

      set((state) => ({
        relationships: state.relationships.filter(
          (relationship) => relationship.id !== relationshipId,
        ),
        selection:
          state.selection?.kind === 'relationship' && state.selection.id === relationshipId
            ? null
            : state.selection,
      }))
    },

    /**
     * Une «Estudiante» y «Materia» a través de «EstudianteMateria»: la clase
     * intermedia nace con su clave primaria y con una asociación 1 : 0..* desde
     * cada una de las dos. El cambio lo hace la API sobre el modelo guardado;
     * aquí sólo se refleja el resultado en el lienzo.
     */
    async createAssociationClass(sourceClassId, targetClassId) {
      const diagram = get().diagram
      if (!diagram) return

      const result = await run(
        () =>
          relationshipsApi.createAssociationClass(diagram.id, {
            source_class_id: sourceClassId,
            target_class_id: targetClassId,
          }),
        'No se pudo crear la entidad intermedia.',
      )
      if (!result) return

      set((state) => {
        const relationships = [...state.relationships]
        for (const relationship of result.relationships) {
          if (!relationships.some((existing) => existing.id === relationship.id)) {
            relationships.push(relationship)
          }
        }
        return {
          classes: addUnique(state.classes, result.class),
          relationships,
          // Se deja seleccionada la clase nueva: es lo que el usuario va a
          // describir a continuación, con sus propios atributos.
          selection: { kind: 'class', id: result.class.id },
        }
      })
    },

    async validate() {
      const diagram = get().diagram
      if (!diagram) return

      set({ validating: true })
      try {
        const validation = await diagramsApi.validate(diagram.id)
        set({ validation, validating: false, validationStale: false })
      } catch (error) {
        const message = messageOf(error, 'No se pudo validar el diagrama.')
        set({ validating: false, saveError: message })
        reportError(message)
      }
    },

    clearValidation() {
      set({ validation: null, validationStale: false })
    },

    // ------------------------------------------------------------ CU04/CU05

    /**
     * La API interpreta, valida y ejecuta; aquí sólo se refleja el resultado.
     *
     * Si la instrucción se rechaza, el diagrama que responde la API es el
     * mismo que ya había —no se tocó nada—, así que se aplica igualmente: es
     * la forma más simple de que el lienzo no se quede desfasado.
     */
    async runAiCommand(command) {
      const diagram = get().diagram
      if (!diagram) return null

      const result = await run(
        () =>
          aiApi.interpret({
            projectId: diagram.project_id,
            diagramId: diagram.id,
            command,
          }),
        'No se pudo ejecutar la instrucción.',
      )
      if (!result) return null

      replaceModel(result.diagram)
      return result
    },

    async runAiVoice(audio, fileName) {
      const diagram = get().diagram
      if (!diagram) return null

      const result = await run(
        () => aiApi.voice(diagram.id, audio, fileName),
        'No se pudo procesar el audio.',
      )
      if (!result) return null

      replaceModel(result.diagram)
      return result
    },

    async importFromImage(image) {
      const diagram = get().diagram
      if (!diagram) return null

      const result = await run(
        () => aiApi.imageToUml(diagram.id, image),
        'No se pudo procesar la imagen.',
      )
      if (!result) return null

      replaceModel(result.diagram)
      return result
    },

    // ------------------------------------------------------------------ CU03

    setConnection(connection) {
      set({ connection })
    },

    setParticipants(participants) {
      set({ participants })
    },

    setLocks(locks) {
      const next: Record<string, LockHolder> = {}
      for (const lock of locks) {
        next[lockKey(lock.element_type, lock.element_id)] = lock.holder
      }
      set({ locks: next })
    },

    applyLockChange(change) {
      set((state) => {
        const key = lockKey(change.element_type, change.element_id)
        const next = { ...state.locks }

        if (change.holder) {
          next[key] = change.holder
        } else {
          delete next[key]
        }
        return { locks: next }
      })
    },

    setHeldLock(elementType, elementId, held) {
      set((state) => {
        const key = lockKey(elementType, elementId)
        const heldLocks = state.heldLocks.filter((candidate) => candidate !== key)

        return { heldLocks: held ? [...heldLocks, key] : heldLocks }
      })
    },

    /**
     * Al caerse la conexión el servidor suelta los bloqueos de este cliente, de
     * modo que conservarlos aquí sería mentir: `applyRemoteChange` ignora los
     * cambios de los elementos que cree tener tomados, así que unas claves
     * caducadas hacen que los cambios de los demás sobre esa clase no vuelvan a
     * aplicarse nunca —y el lienzo se queda mostrando algo que ya no existe.
     */
    clearHeldLocks() {
      set({ heldLocks: [], locks: {} })
    },

    /**
     * Aplica un cambio que otro usuario ya guardó en PostgreSQL.
     *
     * Es idempotente a propósito: el servidor difunde a toda la sala, así que
     * un cliente puede recibir el eco de su propio cambio. Las altas comprueban
     * si el elemento ya está, y las modificaciones se ignoran cuando este
     * cliente tiene tomado el elemento, porque entonces el aviso sólo puede ser
     * suyo y volver a aplicarlo pisaría lo que está editando.
     */
    applyRemoteChange(change) {
      const held = (elementType: LockableType, elementId: string) =>
        get().heldLocks.includes(lockKey(elementType, elementId))

      switch (change.kind) {
        case 'diagram.updated': {
          set({ diagram: change.payload })
          break
        }

        case 'diagram.deleted': {
          set({
            loadStatus: 'error',
            loadError: 'Otro usuario eliminó este diagrama.',
          })
          break
        }

        case 'class.created': {
          set((state) =>
            state.classes.some((umlClass) => umlClass.id === change.payload.id)
              ? {}
              : { classes: [...state.classes, { ...change.payload, attributes: [], methods: [] }] },
          )
          break
        }

        case 'class.updated': {
          if (held('class', change.payload.id)) break
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.id ? { ...umlClass, ...change.payload } : umlClass,
            ),
          }))
          break
        }

        case 'class.deleted': {
          // La base borra en cascada las relaciones de la clase.
          set((state) => ({
            classes: state.classes.filter((umlClass) => umlClass.id !== change.payload.id),
            relationships: state.relationships.filter(
              (relationship) =>
                relationship.source_class_id !== change.payload.id &&
                relationship.target_class_id !== change.payload.id,
            ),
            selection:
              state.selection?.kind === 'class' && state.selection.id === change.payload.id
                ? null
                : state.selection,
          }))
          break
        }

        case 'attribute.created': {
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.class_id &&
              !umlClass.attributes.some((attribute) => attribute.id === change.payload.id)
                ? { ...umlClass, attributes: [...umlClass.attributes, change.payload] }
                : umlClass,
            ),
          }))
          break
        }

        case 'attribute.updated': {
          if (held('class', change.payload.class_id)) break
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.class_id
                ? {
                    ...umlClass,
                    attributes: umlClass.attributes.map((attribute) =>
                      attribute.id === change.payload.id ? change.payload : attribute,
                    ),
                  }
                : umlClass,
            ),
          }))
          break
        }

        case 'attribute.deleted': {
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.class_id
                ? {
                    ...umlClass,
                    attributes: umlClass.attributes.filter(
                      (attribute) => attribute.id !== change.payload.id,
                    ),
                  }
                : umlClass,
            ),
          }))
          break
        }

        case 'method.created': {
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.class_id &&
              !umlClass.methods.some((method) => method.id === change.payload.id)
                ? { ...umlClass, methods: [...umlClass.methods, change.payload] }
                : umlClass,
            ),
          }))
          break
        }

        case 'method.updated': {
          if (held('class', change.payload.class_id)) break
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.class_id
                ? {
                    ...umlClass,
                    methods: umlClass.methods.map((method) =>
                      method.id === change.payload.id ? change.payload : method,
                    ),
                  }
                : umlClass,
            ),
          }))
          break
        }

        case 'method.deleted': {
          set((state) => ({
            classes: state.classes.map((umlClass) =>
              umlClass.id === change.payload.class_id
                ? {
                    ...umlClass,
                    methods: umlClass.methods.filter((method) => method.id !== change.payload.id),
                  }
                : umlClass,
            ),
          }))
          break
        }

        case 'relationship.created': {
          set((state) =>
            state.relationships.some((relationship) => relationship.id === change.payload.id)
              ? {}
              : { relationships: [...state.relationships, change.payload] },
          )
          break
        }

        case 'relationship.updated': {
          if (held('relationship', change.payload.id)) break
          set((state) => ({
            relationships: state.relationships.map((relationship) =>
              relationship.id === change.payload.id ? change.payload : relationship,
            ),
          }))
          break
        }

        case 'relationship.deleted': {
          set((state) => ({
            relationships: state.relationships.filter(
              (relationship) => relationship.id !== change.payload.id,
            ),
            selection:
              state.selection?.kind === 'relationship' && state.selection.id === change.payload.id
                ? null
                : state.selection,
          }))
          break
        }
      }
    },
  }
})
