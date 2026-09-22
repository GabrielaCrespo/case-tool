/**
 * CU02 — Deducir el tipo de dato por el nombre del atributo.
 *
 * Un modelo llega muchas veces sin tipos: una foto de pizarra (CU05) los trae
 * en blanco porque nadie los dibujó, y un XMI exportado de otra herramienta
 * (CU06) puede traerlos sólo en algunas tablas. Ponerlos uno a uno en el
 * desplegable es lento y es justo el trabajo que el nombre ya está diciendo:
 * «precio» es un importe, «fecha» es una fecha y «stock» se cuenta.
 *
 * Esto no adivina nada por su cuenta: sólo responde cuando se le pregunta,
 * desde el botón «Deducir tipos», y únicamente para los atributos que están
 * sin tipo. Lo que ya tiene tipo no se toca —puede haberlo elegido una
 * persona— y lo deducido se puede cambiar después en el panel como cualquier
 * otro tipo.
 *
 * Los nombres se reconocen en español y en inglés, y da igual cómo estén
 * escritos: «FechaNacimiento», «fecha_nacimiento» y «FECHA NACIMIENTO» son la
 * misma palabra partida en dos.
 */

/** Tipo con el que se queda un nombre que no dice nada del dato que guarda. */
const FALLBACK = 'String'

/**
 * Palabras del nombre, normalizadas.
 * «precioUnitario» y «PRECIO_UNITARIO» dan los dos ['precio', 'unitario'].
 */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
}

/** Lo que el atributo guarda, según cómo se llama. */
const CLUES: { type: string; words: string[] }[] = [
  {
    type: 'UUID',
    words: ['uuid', 'guid'],
  },
  {
    // Un sí o un no. Los nombres que empiezan por «es», «tiene» o «is» se
    // miran aparte, más abajo: «esActivo», «tieneDescuento».
    type: 'Boolean',
    words: [
      'activo', 'active', 'habilitado', 'enabled', 'vigente', 'disponible',
      'pagado', 'anulado', 'cancelado', 'eliminado', 'borrado', 'confirmado',
      'verificado', 'leido', 'completado',
    ],
  },
  {
    // Dinero. Nunca Double: un importe redondeado mal es un importe mal.
    type: 'BigDecimal',
    words: [
      'precio', 'price', 'monto', 'importe', 'total', 'subtotal', 'costo',
      'coste', 'cost', 'salario', 'sueldo', 'descuento', 'impuesto', 'iva',
      'saldo', 'tarifa', 'amount', 'pago',
    ],
  },
  {
    // Medidas: se miden, no se cuentan, y admiten decimales.
    type: 'Double',
    words: [
      'peso', 'weight', 'altura', 'estatura', 'ancho', 'alto', 'largo',
      'promedio', 'porcentaje', 'latitud', 'longitud', 'nota', 'calificacion',
      'temperatura', 'distancia', 'duracion',
    ],
  },
  {
    // Se cuentan de uno en uno.
    type: 'Integer',
    words: [
      'cantidad', 'quantity', 'stock', 'existencia', 'edad', 'numero', 'nro',
      'num', 'anio', 'ano', 'year', 'orden', 'posicion', 'nivel', 'puntos',
      'count', 'unidades', 'paginas', 'capacidad',
    ],
  },
  {
    type: 'LocalDate',
    words: [
      'fecha', 'date', 'nacimiento', 'vencimiento', 'caducidad', 'emision',
      'ingreso', 'egreso',
    ],
  },
  {
    type: 'LocalDateTime',
    words: ['hora', 'time', 'timestamp', 'datetime', 'momento', 'instante'],
  },
]

/** Nombres que empiezan así y siguen con algo más son un sí o un no. */
const BOOLEAN_PREFIXES = ['es', 'son', 'esta', 'tiene', 'is', 'has', 'can', 'puede']

/**
 * El tipo que le corresponde a un atributo por su nombre.
 *
 * Nunca devuelve nada raro: siempre es uno de los tipos del catálogo, y cuando
 * el nombre no dice de qué se trata —«codigo», «referencia», «observacion»—
 * se queda en String, que es lo que suele ser un nombre así y lo que menos
 * estorba si hay que corregirlo.
 */
export function suggestDataType(attributeName: string): string {
  const parts = words(attributeName)
  if (parts.length === 0) return FALLBACK

  // «clienteId»: la clave de otra fila. El «id» a secas no llega nunca aquí,
  // porque la clave primaria la pone la herramienta y no es un atributo.
  if (parts[parts.length - 1] === 'id') return 'Long'

  if (parts.length > 1 && BOOLEAN_PREFIXES.includes(parts[0])) return 'Boolean'

  // Una fecha con hora se llama de las dos maneras a la vez.
  const date = parts.some((part) => ['fecha', 'date'].includes(part))
  const time = parts.some((part) => ['hora', 'time', 'timestamp'].includes(part))
  if (date && time) return 'LocalDateTime'

  for (const clue of CLUES) {
    if (parts.some((part) => clue.words.includes(part))) return clue.type
  }

  return FALLBACK
}
