import type { UmlClassFull, Visibility } from '../../../api/types'
import { PlusIcon, SparkIcon, TrashIcon } from '../../../components/icons'
import { Button } from '../../../components/ui/Button'
import { Checkbox } from '../../../components/ui/Field'
import { useDiagramStore } from '../../../store/diagram'
import { LIMITS, PRIMARY_KEY, VISIBILITY_OPTIONS, identifierProblem, isPersistent } from '../uml'
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
  const inferAttributeTypes = useDiagramStore((state) => state.inferAttributeTypes)

  // uml_classes tiene UNIQUE (diagram_id, name).
  const otherClassNames = classes
    .filter((candidate) => candidate.id !== umlClass.id)
    .map((candidate) => candidate.name)

  // En un diagrama de datos lo que se dibuja es una tabla; las excepciones son
  // las clases que llegan por XMI marcadas como interface, enumeration o
  // service desde Enterprise Architect, que no generan tabla.
  const entity = isPersistent(umlClass)
  // Los atributos sin tipo: los que llegan de una foto (CU05) o de un XMI que
  // no los traía (CU06). Son los que rellena «Deducir tipos».
  const untyped = umlClass.attributes.filter((attribute) => attribute.data_type === null).length

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

          {/* La clave primaria no se elige: se dice cuál es. Está aquí, y no
              entre los atributos, porque no es una columna que su autor pueda
              cambiar —ni renombrar, ni borrar, ni llevar a otro atributo—. */}
          {entity && (
            <div className="pt-1">
              <PanelReadout
                label="Clave primaria"
                value={`${PRIMARY_KEY.name} : ${PRIMARY_KEY.dataType}`}
              />
              <p className="text-[11px] leading-snug text-ink-400">
                La pone la herramienta en toda entidad, autonumerada. No se define como atributo.
              </p>
            </div>
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
          <div className="flex items-center gap-1.5">
            {/* Sólo cuando hay algo que deducir: en una entidad escrita a mano
                todos los atributos nacen con tipo y el botón sobraría. */}
            {untyped > 0 && (
              <Button
                size="sm"
                icon={<SparkIcon className="size-3.5" />}
                title={`Pone un tipo deducido del nombre a los ${untyped} atributos que no tienen ninguno.`}
                onClick={() => void inferAttributeTypes(umlClass.id)}
                className="h-7 px-2 text-[12px]"
              >
                Deducir tipos
              </Button>
            )}
            <Button
              size="sm"
              icon={<PlusIcon className="size-3.5" />}
              onClick={() => void addAttribute(umlClass.id)}
              className="h-7 px-2 text-[12px]"
            >
              Añadir
            </Button>
          </div>
        }
      >
        {umlClass.attributes.length === 0 ? (
          <p className="py-1 text-[12.5px] text-ink-500">
            Sin atributos. Cada atributo será una columna de la tabla, además de la clave
            primaria.
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
