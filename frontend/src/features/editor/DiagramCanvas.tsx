import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, OnSelectionChangeParams } from '@xyflow/react'
import type { UmlClassFull, UmlRelationship } from '../../api/types'
import { cn } from '../../lib/cn'
import { useAuthStore } from '../../store/auth'
import { useDiagramStore } from '../../store/diagram'
import { ASSOCIATION_CLASS_TOOL, isLinkTool, isRelationshipTool } from './tools'
import type { Tool } from './tools'
import {
  ASSOCIATION_CLASS_META,
  RELATIONSHIP_META,
  associationClassLinks,
  autoClassWidth,
} from './uml'
import { DEFAULT_CLASS_HEIGHT, DEFAULT_CLASS_WIDTH, UmlClassNode } from './UmlClassNode'
import type { UmlClassNodeType } from './UmlClassNode'
import { UmlRelationEdge } from './UmlRelationEdge'
import type { UmlEdgeType } from './UmlRelationEdge'

const nodeTypes = { umlClass: UmlClassNode }
const edgeTypes = { uml: UmlRelationEdge }

/** Tamaño de una clase recién colocada, antes de que nadie la redimensione. */
const CLASS_WIDTH = DEFAULT_CLASS_WIDTH
const ESTIMATED_CLASS_HEIGHT = DEFAULT_CLASS_HEIGHT

type Side = 'top' | 'right' | 'bottom' | 'left'

/**
 * Elige por qué lado sale y entra la línea, según dónde estén las dos clases.
 * No se guarda en la base de datos: se recalcula al mover, de modo que el
 * trazado sigue siendo el correcto después de recargar.
 */
function sidesBetween(
  source: { x: number; y: number; width: number; height: number },
  target: { x: number; y: number; width: number; height: number },
): [Side, Side] {
  const dx = target.x + target.width / 2 - (source.x + source.width / 2)
  const dy = target.y + target.height / 2 - (source.y + source.height / 2)

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? ['right', 'left'] : ['left', 'right']
  }
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

/**
 * Dos nodos dicen lo mismo del modelo.
 *
 * Se compara para poder devolver el objeto que ya estaba en lugar de uno nuevo:
 * cualquier cambio en el diagrama reconstruye la lista de clases, y sin esto
 * React Flow daría por modificados todos los nodos —y volvería a medirlos— cada
 * vez que alguien toca un atributo de una sola clase.
 */
function sameNode(a: UmlClassNodeType, b: UmlClassNodeType): boolean {
  return (
    a.data.umlClass === b.data.umlClass &&
    a.selected === b.selected &&
    a.draggable === b.draggable &&
    a.width === b.width &&
    a.height === b.height &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y
  )
}

function toNode(
  umlClass: UmlClassFull,
  selectedId: string | null,
  lockedByOthers: Set<string>,
  movable: boolean,
): UmlClassNodeType {
  return {
    id: umlClass.id,
    type: 'umlClass',
    position: { x: umlClass.pos_x, y: umlClass.pos_y },
    // El ancho siempre fue fijo (antes como constante CSS); el alto, en
    // cambio, sólo se fija cuando alguien la redimensionó a mano — si no,
    // queda `undefined` para que siga creciendo sola según su contenido,
    // igual que hacía antes de poder redimensionarse.
    width: umlClass.width ?? autoClassWidth(umlClass, DEFAULT_CLASS_WIDTH),
    height: umlClass.height ?? undefined,
    data: { umlClass },
    selected: umlClass.id === selectedId,
    // Se mueve sólo con la herramienta de selección y sólo si nadie más la
    // está editando (CU03); en ese caso sí se puede seleccionar para
    // consultarla, pero no arrastrar.
    draggable: movable && !lockedByOthers.has(umlClass.id),
  }
}

interface DiagramCanvasProps {
  tool: Tool
  onToolChange: (tool: Tool) => void
  onRequestDelete: () => void
}

export function DiagramCanvas({ tool, onToolChange, onRequestDelete }: DiagramCanvasProps) {
  const classes = useDiagramStore((state) => state.classes)
  const relationships = useDiagramStore((state) => state.relationships)
  const selection = useDiagramStore((state) => state.selection)
  const select = useDiagramStore((state) => state.select)
  const createClass = useDiagramStore((state) => state.createClass)
  const moveClass = useDiagramStore((state) => state.moveClass)
  const createRelationship = useDiagramStore((state) => state.createRelationship)
  const createAssociationClass = useDiagramStore((state) => state.createAssociationClass)
  const locks = useDiagramStore((state) => state.locks)
  const myUserId = useAuthStore((state) => state.user?.id)

  const { screenToFlowPosition } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState<UmlClassNodeType>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<UmlEdgeType>([])

  /**
   * Clases que el usuario está arrastrando ahora mismo.
   *
   * Sólo mientras dura el arrastre manda la posición del lienzo sobre la del
   * modelo: si se reconstruyera el nodo en ese instante, la clase saltaría de
   * vuelta a su sitio anterior. Antes se saltaba la sincronización entera
   * durante el arrastre, y eso era lo que hacía desaparecer clases: todo lo que
   * llegara mientras tanto —un alta de otro usuario, un borrado— se perdía, y
   * si el arrastre no llegaba a terminar (porque otro eliminó esa clase, por
   * ejemplo) el lienzo dejaba de actualizarse hasta recargar la página.
   */
  const draggingIds = useRef(new Set<string>())

  const selectedClassId = selection?.kind === 'class' ? selection.id : null
  const selectedRelationshipId = selection?.kind === 'relationship' ? selection.id : null

  /** Las clases sólo se arrastran con la herramienta de selección. */
  const movable = tool === 'select'

  // CU03 — Clases tomadas por otro usuario: se ven, pero no se mueven.
  const lockedByOthers = useMemo(() => {
    const ids = new Set<string>()
    for (const [key, holder] of Object.entries(locks)) {
      if (key.startsWith('class:') && holder.user_id !== myUserId) {
        ids.add(key.slice('class:'.length))
      }
    }
    return ids
  }, [locks, myUserId])

  // El lienzo es siempre el reflejo del modelo: la lista de nodos se deriva
  // entera de `classes`, de modo que ninguna operación puede dejarse una clase
  // por el camino. De cada nodo anterior sólo se conservan las dos cosas que
  // pertenecen al lienzo y no al modelo: la medida que React Flow calculó y,
  // mientras dura el arrastre, la posición que el usuario está eligiendo.
  useEffect(() => {
    setNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]))

      // Una clase que ya no está en el modelo no puede seguir «arrastrándose»:
      // si otro usuario la eliminó a media operación, React Flow no llegará a
      // avisar de que el arrastre terminó.
      if (draggingIds.current.size > 0) {
        const alive = new Set(classes.map((umlClass) => umlClass.id))
        for (const id of draggingIds.current) {
          if (!alive.has(id)) draggingIds.current.delete(id)
        }
      }

      const synced = classes.map((umlClass) => {
        const next = toNode(umlClass, selectedClassId, lockedByOthers, movable)
        const existing = previous.get(umlClass.id)
        if (!existing) return next

        const merged: UmlClassNodeType = {
          ...existing,
          ...next,
          measured: existing.measured,
          position: draggingIds.current.has(umlClass.id) ? existing.position : next.position,
        }

        return sameNode(existing, merged) ? existing : merged
      })

      // Un bloqueo ajeno o una selección bastan para volver a pasar por aquí;
      // si nada ha cambiado de verdad, se devuelve la misma lista y el lienzo
      // no se redibuja.
      const unchanged =
        synced.length === current.length && synced.every((node, index) => node === current[index])

      return unchanged ? current : synced
    })
  }, [classes, selectedClassId, lockedByOthers, movable, setNodes])

  // Las aristas se derivan de los nodos, no del store, para que las líneas
  // sigan a la clase mientras se arrastra.
  const derivedEdges = useMemo<UmlEdgeType[]>(() => {
    const boxes = new Map(
      nodes.map((node) => [
        node.id,
        {
          x: node.position.x,
          y: node.position.y,
          width: node.measured?.width ?? node.width ?? CLASS_WIDTH,
          height: node.measured?.height ?? node.height ?? ESTIMATED_CLASS_HEIGHT,
        },
      ]),
    )

    // Las dos líneas de una entidad intermedia se dibujan discontinuas; se
    // calculan sobre el diagrama entero, no relación a relación.
    const hangingLinks = associationClassLinks(relationships)

    return relationships.flatMap((relationship: UmlRelationship) => {
      const source = boxes.get(relationship.source_class_id)
      const target = boxes.get(relationship.target_class_id)
      if (!source || !target) return []

      const [sourceHandle, targetHandle] =
        relationship.source_class_id === relationship.target_class_id
          ? (['top', 'right'] as [Side, Side])
          : sidesBetween(source, target)

      return [
        {
          id: relationship.id,
          type: 'uml' as const,
          source: relationship.source_class_id,
          target: relationship.target_class_id,
          sourceHandle,
          targetHandle,
          data: { relationship, associationClass: hangingLinks.has(relationship.id) },
          selected: relationship.id === selectedRelationshipId,
          zIndex: relationship.id === selectedRelationshipId ? 1 : 0,
        },
      ]
    })
  }, [nodes, relationships, selectedRelationshipId])

  useEffect(() => {
    setEdges(derivedEdges)
  }, [derivedEdges, setEdges])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return

      // La clase de asociación no dibuja una línea: intercala una clase entre
      // las dos y la une con una asociación a cada lado.
      if (tool === ASSOCIATION_CLASS_TOOL) {
        void createAssociationClass(connection.source, connection.target)
        return
      }

      // Con la herramienta de selección activa se asume una asociación, que es
      // la relación más común; con una herramienta de relación, la suya.
      const relationshipType = isRelationshipTool(tool) ? tool : 'ASSOCIATION'

      void createRelationship({
        source_class_id: connection.source,
        target_class_id: connection.target,
        relationship_type: relationshipType,
      })
    },
    [tool, createRelationship, createAssociationClass],
  )

  /** Coloca una entidad centrada bajo el cursor y deja su nombre por escribir. */
  const placeClassAt = useCallback(
    (clientX: number, clientY: number) => {
      const position = screenToFlowPosition({ x: clientX, y: clientY })
      // El clic marca la esquina visual; se centra la caja sobre el cursor.
      void createClass(position.x - CLASS_WIDTH / 2, position.y - 24)
    },
    [screenToFlowPosition, createClass],
  )

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      if (tool === 'class') {
        placeClassAt(event.clientX, event.clientY)
        onToolChange('select')
        return
      }

      select(null)
    },
    [tool, placeClassAt, onToolChange, select],
  )

  /**
   * Doble clic en el fondo: otra entidad, sin pasar por el rail.
   *
   * Es el gesto de Enterprise Architect y de StarUML, y el que convierte
   * dibujar un modelo en una sola sucesión de doble clic y escribir. Se
   * comprueba que el doble clic fuera sobre el fondo y no sobre una caja,
   * porque ahí el doble clic significa otra cosa: cambiar el nombre.
   */
  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // Sólo con la herramienta de selección. Con la de entidad ya crea el
      // primer clic, y el segundo crearía una segunda entidad encima; con una
      // de relación, el fondo no significa «crear» sino «soltar la selección».
      if (tool !== 'select') return

      const target = event.target as HTMLElement | null
      if (!target?.classList.contains('react-flow__pane')) return

      placeClassAt(event.clientX, event.clientY)
    },
    [tool, placeClassAt],
  )

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
      if (selectedNodes.length > 0) {
        select({ kind: 'class', id: selectedNodes[0].id })
      } else if (selectedEdges.length > 0) {
        select({ kind: 'relationship', id: selectedEdges[0].id })
      } else {
        select(null)
      }
    },
    [select],
  )

  // Suprimir borra lo seleccionado, pero siempre pidiendo confirmación: una
  // clase se lleva por delante sus atributos, métodos y relaciones.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable

      if (typing) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        onRequestDelete()
      }
      if (event.key === 'Escape') onToolChange('select')
      if (event.key.toLowerCase() === 'v') onToolChange('select')
      // «E» de entidad; «C» se mantiene por costumbre de quien ya usaba el
      // editor cuando la herramienta se llamaba «clase».
      if (event.key.toLowerCase() === 'e' || event.key.toLowerCase() === 'c') {
        onToolChange('class')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onRequestDelete, onToolChange])

  const connectingColor = isRelationshipTool(tool)
    ? RELATIONSHIP_META[tool].color
    : tool === ASSOCIATION_CLASS_TOOL
      ? ASSOCIATION_CLASS_META.color
      : RELATIONSHIP_META.ASSOCIATION.color

  return (
    <div
      className={cn(
        'relative min-h-0 flex-1',
        // Cada herramienta marca el lienzo con su propia clase: de ahí salen
        // tanto los conectores visibles como el cursor, que React Flow fija en
        // sus propios elementos y no se puede heredar desde aquí.
        isLinkTool(tool) && 'uml-canvas--connecting',
        tool === 'class' && 'uml-canvas--placing',
      )}
      onDoubleClick={onDoubleClick}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={(_event, node) => {
          draggingIds.current.add(node.id)
        }}
        onNodeDragStop={(_event, node) => {
          draggingIds.current.delete(node.id)
          void moveClass(node.id, node.position.x, node.position.y)
        }}
        // El doble clic en el fondo crea una entidad, así que no puede además
        // acercar el lienzo. El zoom sigue en la rueda y en los controles.
        zoomOnDoubleClick={false}
        connectionMode={ConnectionMode.Loose}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionLineStyle={{ stroke: connectingColor, strokeWidth: 1.8 }}
        // Suprimir se gestiona a mano para poder confirmar antes de borrar.
        deleteKeyCode={null}
        multiSelectionKeyCode={null}
        selectionOnDrag={false}
        // El lienzo se mueve con cualquier herramienta activa: las relaciones
        // se dibujan tirando de un conector, no arrastrando sobre el fondo.
        panOnDrag
        // Cada herramienta hace una sola cosa. Con una de relación, arrastrar
        // desde una clase tiene que tirar la línea: si además moviera la caja,
        // el mismo gesto haría dos cosas distintas según dónde se pulsara.
        nodesDraggable={movable}
        minZoom={0.2}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="#cdd6e3"
          bgColor="#eff2f7"
        />
        <Controls
          showInteractive={false}
          className="!bottom-4 !left-4 !shadow-none [&>button]:!border-ink-200"
        />
        <MiniMap
          pannable
          zoomable
          className="!right-4 !bottom-4 !hidden !border !border-ink-200 !bg-white lg:!block"
          maskColor="rgba(20, 29, 46, 0.06)"
          nodeColor="#cdd6e3"
          nodeStrokeColor="#5a6b85"
        />
      </ReactFlow>
    </div>
  )
}
