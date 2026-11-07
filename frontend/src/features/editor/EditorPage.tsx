import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { useNavigate, useParams } from 'react-router-dom'
import { ClassBoxIcon } from '../../components/icons'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ErrorState, LoadingState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { cn } from '../../lib/cn'
import { useCollaboration } from '../../realtime/useCollaboration'
import { useChatStore } from '../../store/chat'
import { setDiagramErrorReporter, useDiagramStore } from '../../store/diagram'
import { TeamChatPanel } from '../assistant/TeamChatPanel'
import { DiagramCanvas } from './DiagramCanvas'
import { EditorTopBar } from './EditorTopBar'
import { PropertiesPanel } from './panel/PropertiesPanel'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import type { Tool } from './tools'
import { RELATIONSHIP_META } from './uml'
import { UmlMarkers } from './UmlMarkers'

/**
 * CU02 — Diseñar el modelo de datos mediante un diagrama de clases UML.
 *
 * Lo que se dibuja aquí son los datos: cada entidad será una tabla, cada
 * atributo una columna y cada relación una clave foránea. Por eso el editor no
 * pregunta de qué tipo de clase UML se trata —interfaces, enumeraciones y
 * servicios sólo llegan importados desde Enterprise Architect—: lo que se
 * coloca en el lienzo es, por definición, algo que hay que guardar.
 *
 * La pantalla se reparte como en cualquier herramienta CASE: paleta a la
 * izquierda, lienzo en el centro, propiedades a la derecha y una barra de
 * estado abajo. No hay botón de guardar: cada cambio se manda a la API.
 */
export function EditorPage() {
  const { diagramId } = useParams<{ diagramId: string }>()
  const navigate = useNavigate()
  const toast = useToast()

  const diagram = useDiagramStore((state) => state.diagram)
  const classes = useDiagramStore((state) => state.classes)
  const relationships = useDiagramStore((state) => state.relationships)
  const selection = useDiagramStore((state) => state.selection)
  const loadStatus = useDiagramStore((state) => state.loadStatus)
  const loadError = useDiagramStore((state) => state.loadError)
  const load = useDiagramStore((state) => state.load)
  const reset = useDiagramStore((state) => state.reset)
  const deleteClass = useDiagramStore((state) => state.deleteClass)
  const deleteRelationship = useDiagramStore((state) => state.deleteRelationship)

  const [tool, setTool] = useState<Tool>('select')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  // Los fallos de guardado del store se avisan con el mismo sistema que el
  // resto de la aplicación.
  useEffect(() => {
    setDiagramErrorReporter(toast.error)
    return () => setDiagramErrorReporter(() => {})
  }, [toast])

  useEffect(() => {
    if (!diagramId) return
    void load(diagramId)
    return () => reset()
  }, [diagramId, load, reset])

  // CU03 — Entra en la sala del diagrama: presencia, bloqueos y cambios de los
  // demás. El guardado sigue haciéndose por la API REST.
  useCollaboration(diagramId)

  // CU13 — El chat es del proyecto: se carga con el primer diagrama que se
  // abre y sigue al pasar a otro del mismo proyecto. Al salir del editor se
  // olvida; los mensajes siguen guardados en el servidor.
  const projectId = diagram?.project_id ?? null
  const chatOpen = useChatStore((state) => state.open)
  const setChatOpen = useChatStore((state) => state.setOpen)
  useEffect(() => {
    if (projectId) void useChatStore.getState().load(projectId)
  }, [projectId])
  useEffect(() => () => useChatStore.getState().reset(), [])

  const selectedClass = useMemo(
    () =>
      selection?.kind === 'class'
        ? (classes.find((umlClass) => umlClass.id === selection.id) ?? null)
        : null,
    [selection, classes],
  )

  const selectedRelationship = useMemo(
    () =>
      selection?.kind === 'relationship'
        ? (relationships.find((relationship) => relationship.id === selection.id) ?? null)
        : null,
    [selection, relationships],
  )

  const requestDelete = useCallback(() => {
    if (!selection) return
    setConfirmingDelete(true)
  }, [selection])

  async function confirmDelete() {
    if (!selection) return

    setDeleting(true)
    if (selection.kind === 'class') {
      await deleteClass(selection.id)
    } else {
      await deleteRelationship(selection.id)
    }
    setDeleting(false)
    setConfirmingDelete(false)
  }

  // Sólo la primera apertura pasa por esta pantalla. Releer un diagrama que ya
  // estaba abierto —lo que ocurre en cada reconexión— mantiene el lienzo en
  // pie: el store deja `loadStatus` en «ready» y marca `reloading`.
  if (loadStatus === 'loading' || loadStatus === 'idle') {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingState label="Abriendo el diagrama…" />
      </div>
    )
  }

  if (loadStatus === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <ErrorState
          message={loadError ?? 'No se pudo cargar el diagrama.'}
          onRetry={() => diagramId && void load(diagramId)}
        />
        <Button onClick={() => navigate('/proyectos')}>Volver a mis proyectos</Button>
      </div>
    )
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <UmlMarkers />
        <EditorTopBar projectId={diagram?.project_id ?? null} />

        {/* `relative` contiene el panel deslizante de móvil dentro de esta fila. */}
        <div className="relative flex min-h-0 flex-1 flex-col lg:flex-row">
          <ToolRail tool={tool} onToolChange={setTool} />

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <DiagramCanvas tool={tool} onToolChange={setTool} onRequestDelete={requestDelete} />

            {/* Lienzo vacío: una invitación a colocar la primera clase. */}
            {classes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                {/* El aviso no intercepta nunca el ratón: tanto el clic que
                    coloca una entidad como el doble clic que la crea tienen que
                    llegar al lienzo, y el aviso ocupa justo el centro, que es
                    donde uno va a hacerlo. Sólo su botón recibe clics. */}
                <div className="pointer-events-none max-w-sm border border-ink-200 bg-white/95 px-6 py-6 text-center">
                  <ClassBoxIcon className="mx-auto size-6 text-ink-400" />
                  <h2 className="mt-3 text-[15px] font-semibold text-ink-900">
                    El lienzo está vacío
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">
                    Haga doble clic en cualquier punto para crear la primera entidad y escriba su
                    nombre. Cada entidad será una tabla; cada atributo, una columna.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    className="pointer-events-auto mt-4"
                    onClick={() => setTool('class')}
                  >
                    Colocar una entidad
                  </Button>
                </div>
              </div>
            )}

            {/* En pantallas pequeñas el panel se abre por encima del lienzo. */}
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="absolute top-3 right-3 rounded-[3px] border border-ink-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-700 shadow-[0_1px_2px_rgba(12,18,32,0.08)] lg:hidden"
            >
              Propiedades
            </button>
          </div>

          <div
            className={cn(
              'absolute inset-y-0 right-0 z-30 w-[86vw] max-w-[320px] bg-white transition-transform lg:static lg:z-auto lg:w-auto lg:max-w-none lg:translate-x-0',
              panelOpen ? 'translate-x-0 shadow-xl' : 'translate-x-full lg:shadow-none',
            )}
          >
            <div className="flex h-full flex-col">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="rule-b px-3 py-2 text-left text-[12.5px] font-medium text-ink-500 lg:hidden"
              >
                Cerrar propiedades
              </button>
              <PropertiesPanel onRequestDelete={requestDelete} />
            </div>
          </div>

          {/* CU12/CU13 — El chat se abre por encima del panel de propiedades,
              sin quitarle sitio al lienzo; se cierra para volver a ellas. */}
          {chatOpen && <TeamChatPanel onClose={() => setChatOpen(false)} />}
        </div>

        <StatusBar tool={tool} />
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={selectedClass ? 'Eliminar entidad' : 'Eliminar relación'}
        message={
          selectedClass
            ? `Se eliminará la entidad «${selectedClass.name}» con sus ${selectedClass.attributes.length} atributos, sus ${selectedClass.methods.length} métodos y las relaciones en las que participa.`
            : selectedRelationship
              ? `Se eliminará la ${RELATIONSHIP_META[
                  selectedRelationship.relationship_type
                ].label.toLowerCase()} entre las dos entidades. Las entidades no se tocan.`
              : ''
        }
        confirmLabel="Eliminar"
        loading={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </ReactFlowProvider>
  )
}
