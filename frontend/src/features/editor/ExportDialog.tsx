import { useState } from 'react'
import { ApiError } from '../../api/client'
import { diagramsApi } from '../../api/endpoints'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Spinner } from '../../components/ui/Spinner'
import { useToast } from '../../components/ui/toast-context'
import { cn } from '../../lib/cn'
import { useDiagramStore } from '../../store/diagram'

/**
 * Exportar el diagrama a un archivo.
 *
 * Hay dos formatos y no sirven para lo mismo, así que en vez de un botón que
 * elige por el usuario hay un diálogo que explica cada uno en una frase:
 *
 *  - `.case.json` conserva el diagrama entero tal como está aquí, con todo lo
 *    que esta herramienta sabe guardar. Es el formato para llevárselo a otro
 *    proyecto de CASE-Tool sin perder nada.
 *  - `.xmi` es el estándar del OMG con el que hablan las herramientas UML
 *    (CU06). Conserva el subconjunto de UML que las dos entienden, que es
 *    menos, pero lo abre Enterprise Architect.
 *
 * Ninguno de los dos usa IA: los dos escriben el modelo que ya está guardado.
 */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const diagram = useDiagramStore((state) => state.diagram)
  const classes = useDiagramStore((state) => state.classes)
  const relationships = useDiagramStore((state) => state.relationships)

  const [working, setWorking] = useState<'json' | 'xmi' | null>(null)

  function download(contents: string, fileName: string, mimeType: string) {
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }))
    const link = document.createElement('a')

    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  async function run(format: 'json' | 'xmi') {
    if (!diagram || working !== null) return

    setWorking(format)
    try {
      if (format === 'json') {
        const document = await diagramsApi.exportDocument(diagram.id)
        download(
          JSON.stringify(document, null, 2),
          `${fileNameOf(diagram.name)}.case.json`,
          'application/json',
        )
      } else {
        const xmi = await diagramsApi.exportXmi(diagram.id)
        // «.xml» y no «.xmi»: es la extensión con la que Enterprise Architect
        // exporta e importa este formato.
        download(xmi, `${fileNameOf(diagram.name)}.xml`, 'application/xml')
      }

      toast.success('Diagrama exportado.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'No se pudo exportar el diagrama.',
      )
    } finally {
      setWorking(null)
    }
  }

  return (
    <Modal
      open={open}
      title="Exportar el diagrama"
      description={`${classes.length} entidades y ${relationships.length} relaciones.`}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <FormatOption
          title="Archivo de CASE-Tool"
          extension=".case.json"
          description="Conserva el diagrama entero: entidades, atributos con y sin tipo, métodos, relaciones, multiplicidades y posiciones. Es el formato para volver a importarlo aquí sin perder nada."
          busy={working === 'json'}
          disabled={working !== null}
          onClick={() => void run('json')}
        />
        <FormatOption
          title="XMI para Enterprise Architect"
          extension=".xml"
          description="El formato con el que Enterprise Architect intercambia modelos (XMI 1.1 sobre UML 1.3). Conserva entidades, atributos, relaciones, herencia, multiplicidades y las posiciones del diagrama."
          busy={working === 'xmi'}
          disabled={working !== null}
          onClick={() => void run('xmi')}
        />
      </div>
    </Modal>
  )
}

function FormatOption({
  title,
  extension,
  description,
  busy,
  disabled,
  onClick,
}: {
  title: string
  extension: string
  description: string
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex flex-col gap-1 rounded-[3px] border border-ink-200 px-3.5 py-3 text-left transition-colors',
        'hover:border-signal-600 hover:bg-signal-50',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-ink-200 disabled:hover:bg-white',
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-[13.5px] font-semibold text-ink-900">{title}</span>
        <span className="rounded-[2px] bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-600">
          {extension}
        </span>
        {busy && <Spinner className="size-3.5 text-ink-500" />}
      </span>
      <span className="text-[12.5px] leading-relaxed text-ink-500">{description}</span>
    </button>
  )
}

/** «Sistema de Ventas» → «sistema-de-ventas», para nombrar el archivo. */
function fileNameOf(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug.length === 0 ? 'diagrama' : slug
}
