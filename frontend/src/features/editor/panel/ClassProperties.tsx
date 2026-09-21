import type { UmlClassFull, Visibility } from '../../../api/types'
import { PlusIcon, TrashIcon } from '../../../components/icons'
import { Button } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/Field'
import { useDiagramStore } from '../../../store/diagram'
import { LIMITS, VISIBILITY_OPTIONS, identifierProblem, isPersistent } from '../uml'
import { AttributeRow } from './AttributeRow'
import { MethodRow } from './MethodRow'
import { CommitInput } from './CommitInput'
import { PanelField, PanelReadout, PanelSection, PanelSelect } from './PanelBits'

const VISIBILITY_CHOICES = VISIBILITY_OPTIONS.map((option) => ({
  value: option.value,
  label: `${option.symbol}  ${option.label}`,
}))

interface ClassPropertiesProps {
  umlClass: UmlClassFull
  onRequestDelete: () => void
}

export function ClassProperties({ umlClass, onRequestDelete }: ClassPropertiesProps) {
  const classes = useDiagramStore((state) => state.classes)
  const updateClass = useDiagramStore((state) => state.updateClass)
  const addAttribute = useDiagramStore((state) => state.addAttribute)
  const addMethod = useDiagramStore((state) => state.addMethod)

  // uml_classes tiene UNIQUE (diagram_id, name).
  const otherClassNames = classes
    .filter((candidate) => candidate.id !== umlClass.id)
    .map((candidate) => candidate.name)

  // En un diagrama de datos lo que se dibuja es una tabla; las excepciones son
  // las clases que llegan por XMI marcadas como interface, enumeration o
  // service desde Enterprise Architect, que no generan tabla.
  const entity = isPersistent(umlClass)
  const missingKey =
    entity &&
    !umlClass.is_abstract &&
    !umlClass.attributes.some((attribute) => attribute.is_primary_key)
  const namedId = umlClass.attributes.find((attribute) => attribute.name.toLowerCase() === 'id')

  return (
    <>
      <PanelSection title={entity ? 'Entidad' : `Clase «${umlClass.stereotype}»`}>
        <div className="flex flex-col gap-2.5">
          <PanelField label="Nombre">
            <CommitInput
              value={umlClass.name}
              ariaLabel="Nombre de la entidad"
              maxLength={LIMITS.className}
              validate={(value) => {
                if (value.length === 0) return 'El nombre no puede estar vacío.'
                if (value.length > LIMITS.className) return `Máximo ${LIMITS.className} caracteres.`
                if (otherClassNames.includes(value)) {
                  return 'Ya existe una entidad con ese nombre en el diagrama.'
                }
                // El nombre será el de una clase Java y el de una tabla.
                return identifierProblem(value)
              }}
              onCommit={(name) => void updateClass(umlClass.id, { name })}
            />
          </PanelField>

          <PanelField label="Visibilidad">
            <PanelSelect
              value={umlClass.visibility}
              ariaLabel="Visibilidad de la entidad"
              options={VISIBILITY_CHOICES}
              onChange={(value) =>
                void updateClass(umlClass.id, { visibility: value as Visibility })
              }
            />
          </PanelField>

          <Checkbox
            label="Abstracta — sólo para heredar de ella"
            checked={umlClass.is_abstract}
            onChange={(event) =>
              void updateClass(umlClass.id, { is_abstract: event.target.checked })
            }
          />

          {/* No es un error: el generador sabe salir del paso. Pero que la
              tabla acabe teniendo una columna que nadie escribió tiene que
              verse aquí, antes de generar, y no descubrirse en el código. */}
          {missingKey && (
            <p className="border border-pending-600/40 bg-pending-100 px-2 py-1.5 text-[11.5px] leading-snug text-pending-700">
              {namedId ? (
                <>
                  Ningún atributo está marcado como clave primaria. Se usará{' '}
                  <span className="font-mono">{namedId.name}</span> por llamarse así.
                </>
              ) : (
                <>
                  Sin clave primaria. Al generar se añadirá una columna{' '}
                  <span className="font-mono">id</span> de tipo{' '}
                  <span className="font-mono">Long</span> autogenerada.
                </>
              )}
            </p>
          )}

          <div className="pt-1">
            <PanelReadout
              label="Posición"
              value={`${Math.round(umlClass.pos_x)}, ${Math.round(umlClass.pos_y)}`}
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection
        title="Atributos"
        count={umlClass.attributes.length}
        action={
          <Button
            size="sm"
            icon={<PlusIcon className="size-3.5" />}
            onClick={() => void addAttribute(umlClass.id)}
            className="h-7 px-2 text-[12px]"
          >
            Añadir
          </Button>
        }
      >
        {umlClass.attributes.length === 0 ? (
          <p className="py-1 text-[12.5px] text-ink-500">
            Sin atributos. Cada atributo será una columna de la tabla.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {umlClass.attributes.map((attribute, index) => (
              <AttributeRow
                key={attribute.id}
                attribute={attribute}
                index={index}
                total={umlClass.attributes.length}
                siblingNames={umlClass.attributes
                  .filter((candidate) => candidate.id !== attribute.id)
                  .map((candidate) => candidate.name)}
              />
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection
        title="Métodos"
        count={umlClass.methods.length}
        action={
          <Button
            size="sm"
            icon={<PlusIcon className="size-3.5" />}
            onClick={() => void addMethod(umlClass.id)}
            className="h-7 px-2 text-[12px]"
          >
            Añadir
          </Button>
        }
      >
        {umlClass.methods.length === 0 ? (
          <p className="py-1 text-[12.5px] text-ink-500">
            Sin métodos. No hacen falta para generar la tabla; descríbalos sólo si quiere
            documentar qué sabe hacer la entidad.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {umlClass.methods.map((method, index) => (
              <MethodRow
                key={method.id}
                method={method}
                index={index}
                total={umlClass.methods.length}
              />
            ))}
          </ul>
        )}
      </PanelSection>

      <div className="p-3">
        <Button
          variant="danger"
          size="sm"
          icon={<TrashIcon className="size-4" />}
          onClick={onRequestDelete}
          className="w-full"
        >
          Eliminar entidad
        </Button>
      </div>
    </>
  )
}
