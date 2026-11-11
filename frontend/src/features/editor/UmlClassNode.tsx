import { Handle, NodeResizer, Position } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import { useDiagramStore } from '../../store/diagram'
import type { UmlAttribute, UmlClassFull } from '../../api/types'
import { cn } from '../../lib/cn'
import { useLockedByOther } from '../../realtime/useLock'
import { initials } from '../../lib/format'
import { InlineName } from './InlineName'
import {
  LIMITS,
  PRIMARY_KEY,
  attributeNameProblem,
  attributeSuffix,
  identifierProblem,
  isPersistent,
  isPrimaryKeyName,
  visibilitySymbol,
} from './uml'

export type UmlClassNodeData = {
  umlClass: UmlClassFull
}

export type UmlClassNodeType = Node<UmlClassNodeData, 'umlClass'>

/** Los cuatro lados por los que se puede enganchar una relación. */
const HANDLES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
] as const

/** Tamaño de una entidad recién creada, antes de que nadie la redimensione. */
export const DEFAULT_CLASS_WIDTH = 224
export const DEFAULT_CLASS_HEIGHT = 120
const MIN_CLASS_WIDTH = 160
const MIN_CLASS_HEIGHT = 80

/**
 * Una entidad: rectángulo con tres compartimentos — nombre, atributos y
 * métodos. Es el objeto central de la herramienta, así que se dibuja con la
 * notación UML de siempre y no como una tarjeta genérica.
 *
 * Se escribe dentro. El nombre de la entidad y el de cada atributo se editan
 * aquí mismo —al crearlos, o con doble clic—, porque el panel de la derecha
 * sirve para describir un elemento con detalle, no para ponerle nombre: tener
 * que cruzar la pantalla para bautizar cada caja es lo que convierte un lienzo
 * de modelado en un formulario.
 *
 * El tamaño se puede arrastrar desde las esquinas (NodeResizer) y se guarda,
 * igual que la posición: si el contenido no cabe en el tamaño elegido, los
 * compartimentos de atributos y métodos se desplazan con su propio scroll en
 * vez de estirar la entidad más de lo que su usuario pidió.
 */
export function UmlClassNode({ id, data, selected }: NodeProps<UmlClassNodeType>) {
  const { umlClass } = data
  const renaming = useDiagramStore((state) => state.renaming)
  const startRenaming = useDiagramStore((state) => state.startRenaming)
  const resizeClass = useDiagramStore((state) => state.resizeClass)
  const updateClass = useDiagramStore((state) => state.updateClass)
  const addAttribute = useDiagramStore((state) => state.addAttribute)
  const updateAttribute = useDiagramStore((state) => state.updateAttribute)
  // CU03 — Otro usuario la tiene tomada para editarla.
  const lockedBy = useLockedByOther('class', umlClass.id)

  /** Mientras otro la edita se mira, pero no se escribe. */
  const editable = lockedBy === null
  const renamingClass = renaming?.kind === 'class' && renaming.id === umlClass.id

  // uml_classes tiene UNIQUE (diagram_id, name). La lista de hermanas se lee
  // en el momento de comprobar, y no suscribiéndose a ella: cada caja del
  // lienzo es uno de estos componentes, y suscribirlas todas a `classes` haría
  // que tocar un atributo de una sola entidad redibujara el diagrama entero.
  function validateClassName(value: string): string | null {
    if (value.length === 0) return 'El nombre no puede estar vacío.'
    if (value.length > LIMITS.className) return `Máximo ${LIMITS.className} caracteres.`
    if (
      useDiagramStore
        .getState()
        .classes.some((candidate) => candidate.id !== umlClass.id && candidate.name === value)
    ) {
      return 'Ya existe una entidad con ese nombre en el diagrama.'
    }
    // El nombre será el de una clase Java y el de una tabla en el backend.
    return identifierProblem(value)
  }

  return (
    <div
      className={cn(
        'group relative flex h-full w-full flex-col border bg-white transition-shadow',
        lockedBy
          ? 'border-dashed border-pending-600 shadow-[0_0_0_2px_var(--color-pending-100)]'
          : selected
            ? 'border-signal-600 shadow-[0_0_0_2px_var(--color-signal-200)]'
            : 'border-ink-700',
      )}
    >
      <NodeResizer
        nodeId={id}
        isVisible={selected && editable}
        minWidth={MIN_CLASS_WIDTH}
        minHeight={MIN_CLASS_HEIGHT}
        lineClassName="!border-signal-600"
        handleClassName="!size-2.5 !rounded-[2px] !border-signal-600 !bg-white"
        // Tirar del borde superior o del izquierdo estira la caja y además la
        // mueve, así que se guardan las dos cosas: si sólo se guardara el
        // tamaño, la entidad volvía de un salto a su posición anterior en
        // cuanto el lienzo se redibujaba desde el modelo.
        onResizeEnd={(_event, params) => {
          void resizeClass(umlClass.id, params.width, params.height, params.x, params.y)
        }}
      />

      {lockedBy && (
        <span
          title={`${lockedBy.full_name} está editando esta entidad`}
          className="absolute -top-2.5 -right-2.5 z-10 flex size-6 items-center justify-center rounded-full border border-pending-600 bg-pending-100 text-[9.5px] font-bold text-pending-700"
        >
          {initials(lockedBy.full_name)}
        </span>
      )}

      {HANDLES.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={handle.position}
          isConnectableStart
          isConnectableEnd
        />
      ))}

      {/* Compartimento 1 — nombre */}
      <div
        className={cn(
          'shrink-0 border-b px-3 py-2 text-center',
          selected ? 'border-b-signal-600 bg-signal-50' : 'border-b-ink-700 bg-ink-50',
        )}
      >
        {/* El estereotipo sólo se escribe cuando dice algo que el dibujo no
            dice ya: aquí todo lo que se modela es una tabla, así que anotar
            «entity» en todas las cajas sería repetir el fondo del diagrama.
            Una interfaz o una enumeración llegadas por XMI sí se marcan. */}
        {!isPersistent(umlClass) && (
          <div className="font-mono text-[10.5px] leading-tight text-ink-500">
            «{umlClass.stereotype}»
          </div>
        )}

        {renamingClass && editable ? (
          <InlineName
            value={umlClass.name}
            ariaLabel="Nombre de la entidad"
            className="text-center text-[14px] font-semibold"
            validate={validateClassName}
            onCancel={() => startRenaming(null)}
            onCommit={(name) => {
              startRenaming(null)
              void updateClass(umlClass.id, { name })
            }}
          />
        ) : (
          <div
            onDoubleClick={() => editable && startRenaming({ kind: 'class', id: umlClass.id })}
            title={editable ? 'Doble clic para cambiar el nombre' : undefined}
            className={cn(
              'text-[14px] leading-tight font-semibold tracking-tight text-ink-950',
              // En UML el nombre de una clase abstracta va en cursiva.
              umlClass.is_abstract && 'italic',
            )}
          >
            {umlClass.name}
          </div>
        )}
      </div>

      {/* Compartimento 2 — atributos. `flex-auto`: ocupa su alto natural si hay
          sitio, y si la entidad se redujo por debajo de eso, se reparte el
          espacio con el de métodos y desplaza el resto con scroll propio. */}
      <div className="flex min-h-0 flex-auto flex-col border-b border-b-ink-200">
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {/* La clave primaria encabeza el compartimento, como en cualquier
              diseño de tablas, aunque no sea un atributo del modelo: la pone
              la herramienta en toda entidad y no se puede editar. */}
          {isPersistent(umlClass) && <PrimaryKeyLine />}

          {umlClass.attributes.length === 0 ? (
            !isPersistent(umlClass) && (
              <p className="px-1 py-0.5 text-[11.5px] text-ink-400 italic">sin atributos</p>
            )
          ) : (
            <ul className="flex flex-col">
              {umlClass.attributes.map((attribute) => (
                <AttributeLine
                  key={attribute.id}
                  attribute={attribute}
                  literal={umlClass.stereotype === 'enumeration'}
                  siblings={umlClass.attributes}
                  editable={editable}
                  renaming={renaming?.kind === 'attribute' && renaming.id === attribute.id}
                  onStartRenaming={() =>
                    startRenaming({ kind: 'attribute', id: attribute.id })
                  }
                  onStopRenaming={() => startRenaming(null)}
                  onRename={(name) => {
                    startRenaming(null)
                    void updateAttribute(attribute.id, { name })
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Añadir un atributo sin salir de la entidad. Aparece al pasar por
            encima o al seleccionarla: en reposo la caja tiene que seguir
            leyéndose como un diagrama, no como una barra de herramientas. */}
        {editable && (
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => void addAttribute(umlClass.id, { rename: true })}
            title="Añadir un atributo"
            className={cn(
              'nodrag flex shrink-0 items-center gap-1 px-3 py-0.5 text-left font-mono text-[11px] text-ink-400 transition-colors hover:bg-signal-50 hover:text-signal-700',
              selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <span aria-hidden="true" className="text-[13px] leading-none">
              ＋
            </span>
            atributo
          </button>
        )}
      </div>

      {/* Compartimento 3 — métodos */}
      <div className="min-h-0 flex-auto overflow-y-auto px-2 py-1.5">
        {umlClass.methods.length === 0 ? (
          <p className="px-1 py-0.5 text-[11.5px] text-ink-400 italic">sin métodos</p>
        ) : (
          <ul className="flex flex-col">
            {umlClass.methods.map((method) => (
              <li
                key={method.id}
                title={
                  [method.is_static && 'Estático', method.is_abstract && 'Abstracto']
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
                className={cn(
                  'truncate px-1 py-[1px] pl-[25px] font-mono text-[11.5px] leading-[1.45] text-ink-800',
                  // UML 2.5: una operación estática va subrayada y una
                  // abstracta, en cursiva.
                  method.is_static && 'underline decoration-ink-500 underline-offset-2',
                  method.is_abstract && 'italic',
                )}
              >
                <span className="text-ink-500">{visibilitySymbol(method.visibility)} </span>
                {method.name}(
                {method.parameters
                  .map((parameter) => `${parameter.name}: ${parameter.data_type}`)
                  .join(', ')}
                )<span className="text-ink-400">: </span>
                <span className="text-ink-600">{method.return_type}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * La clave primaria dibujada: «PK id : Long».
 *
 * Se lee igual que un atributo pero en gris y sin doble clic, porque no hay
 * nada que cambiarle: no está en el modelo, la pone la herramienta en toda
 * entidad, y es lo que evita las claves primarias escritas a mano que después
 * impedían generar la base de datos.
 */
function PrimaryKeyLine() {
  return (
    <div
      title="Clave primaria de la tabla. La pone la herramienta y no se edita."
      className="flex items-baseline gap-1.5 px-1 py-[1px] font-mono text-[11.5px] leading-[1.45]"
    >
      <span className="flex w-[18px] shrink-0 justify-end">
        <span className="rounded-[2px] bg-signal-100 px-1 text-[9px] font-bold text-signal-700">
          PK
        </span>
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-500">
        {PRIMARY_KEY.name}
        <span className="text-ink-400">: </span>
        {PRIMARY_KEY.dataType}
      </span>
    </div>
  )
}

interface AttributeLineProps {
  attribute: UmlAttribute
  /**
   * La clase es una «enumeration»: sus atributos son literales y UML los
   * escribe solos, sin visibilidad ni tipo.
   */
  literal: boolean
  /** Los de la misma entidad: uml_attributes tiene UNIQUE (class_id, name). */
  siblings: UmlAttribute[]
  editable: boolean
  renaming: boolean
  onStartRenaming: () => void
  onStopRenaming: () => void
  onRename: (name: string) => void
}

/** Un atributo tal como se lee en el diagrama: «＋ nombre : String». */
function AttributeLine({
  attribute,
  literal,
  siblings,
  editable,
  renaming,
  onStartRenaming,
  onStopRenaming,
  onRename,
}: AttributeLineProps) {
  function validate(value: string): string | null {
    if (value.length === 0) return 'El nombre no puede estar vacío.'
    if (value.length > LIMITS.attributeName) return `Máximo ${LIMITS.attributeName} caracteres.`
    if (
      siblings.some((candidate) => candidate.id !== attribute.id && candidate.name === value)
    ) {
      return 'Ya existe un atributo con ese nombre.'
    }
    // El nombre será el de un campo Java y el de una columna, y no puede ser
    // el de la clave primaria que la herramienta pone en toda entidad.
    return attributeNameProblem(value)
  }

  /*
   * Un atributo llamado «id» sólo puede venir de un diagrama guardado antes de
   * que la clave primaria la pusiera la herramienta. Se dibuja tachado, porque
   * la fila «PK id» de arriba es la que va a ser columna y ésta se omitirá al
   * generar: verlas iguales, las dos en negro, haría creer que la tabla tendrá
   * dos. Se sigue viendo —y se puede borrar desde el panel— en lugar de
   * esconderla, que sería hacer desaparecer algo que su autor escribió.
   */
  const ignored = isPrimaryKeyName(attribute.name)

  return (
    <li className="flex items-baseline gap-1.5 px-1 py-[1px] font-mono text-[11.5px] leading-[1.45]">
      <span className="flex w-[18px] shrink-0 justify-end">
        {attribute.is_unique && !ignored && (
          <span
            title="Valor único"
            className="rounded-[2px] bg-ink-100 px-1 text-[9px] font-bold text-ink-600"
          >
            U
          </span>
        )}
      </span>

      {renaming && editable ? (
        <InlineName
          value={attribute.name}
          ariaLabel="Nombre del atributo"
          className="font-mono text-[11.5px]"
          validate={validate}
          onCancel={onStopRenaming}
          onCommit={onRename}
        />
      ) : (
        <span
          onDoubleClick={() => editable && onStartRenaming()}
          title={
            ignored
              ? 'Se omitirá al generar: la clave primaria de la entidad es la de arriba. Puede borrar este atributo.'
              : editable
                ? 'Doble clic para cambiar el nombre'
                : undefined
          }
          className={cn(
            'min-w-0 flex-1 truncate',
            ignored ? 'text-ink-400 line-through decoration-ink-300' : 'text-ink-800',
            // UML 2.5: un atributo estático va subrayado.
            !ignored &&
              attribute.is_static &&
              'underline decoration-ink-500 underline-offset-2',
          )}
        >
          {literal ? (
            attribute.name
          ) : (
            <>
              <span className="text-ink-500">{visibilitySymbol(attribute.visibility)} </span>
              {/* UML 2.5: «/» delante del nombre de un atributo derivado. */}
              {attribute.is_derived && <span className="text-ink-600">/</span>}
              {attribute.name}
              {/* Un atributo aún sin tipo se dibuja a secas, como está en la
                  pizarra de la que salió: escribir «: null» sería afirmar algo
                  que nadie decidió todavía. */}
              {attribute.data_type !== null && (
                <>
                  <span className="text-ink-400">: </span>
                  <span className="text-ink-600">{attribute.data_type}</span>
                </>
              )}
              {attributeSuffix(attribute) !== '' && (
                <span className="text-ink-500">{attributeSuffix(attribute)}</span>
              )}
              {!attribute.is_nullable && <span className="text-danger-600"> *</span>}
            </>
          )}
        </span>
      )}
    </li>
  )
}
