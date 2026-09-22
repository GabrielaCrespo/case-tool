/**
 * CU04/CU05 — Lo que se le dice al modelo.
 *
 * Los dos prompts viven juntos y aparte del resto del código porque son la
 * pieza que hay que ajustar cuando el modelo se equivoca: tenerlos a la vista,
 * uno al lado del otro, evita que las dos mitades del asistente acaben
 * hablando idiomas distintos.
 *
 * Los dos comparten la misma regla de fondo: el modelo **interpreta**, no
 * ejecuta. Se le pide un JSON con una forma fija, se le dice que puede
 * declararse incapaz, y se le prohíbe inventar. Todo lo que responda pasa
 * después por uml-actions.ts y por el ejecutor antes de tocar el diagrama.
 */

import type { FullDiagramResponse } from '../diagrams/diagrams.service.js';
import { OFFERED_DATA_TYPES } from '../diagrams/uml-catalog.js';
import { AI_RELATIONSHIP_TYPES } from './uml-actions.js';

/**
 * Instrucciones de CU04.
 *
 * La orientación de la herencia está dicha dos veces y con un ejemplo a
 * propósito: es el único punto del formato donde «origen» y «destino» no
 * significan lo obvio, y un modelo pequeño se equivoca si sólo se dice una vez.
 */
export function interpretSystemPrompt(): string {
  return `Eres el intérprete de instrucciones de una herramienta CASE para diseñar modelos de datos con diagramas de clases UML.
Recibes el estado actual de un diagrama y una instrucción del usuario en español.
El usuario habla de «entidades» y de «tablas»: las tres palabras —entidad, tabla y clase— significan lo mismo aquí, y todas se traducen a las acciones sobre clases de más abajo. Un «campo» o una «columna» es un atributo.
Respondes ÚNICAMENTE con un objeto JSON, sin explicaciones ni texto alrededor.

Formato de la respuesta:
{"actions": [ ...acciones en el orden en que hay que ejecutarlas... ]}

Si la instrucción es ambigua, está incompleta o no se refiere al diagrama, responde:
{"actions": [], "error": "motivo breve en español"}

Reglas:
- No inventes clases, atributos ni relaciones que la instrucción no pida.
- Usa exactamente los nombres de clase y de atributo que aparecen en el diagrama actual.
- Una instrucción puede producir varias acciones.
- Nunca inventes coordenadas: sólo pon "position" si la instrucción da números.
- No pongas un atributo "id": toda entidad tiene ya esa clave primaria y la pone la herramienta. De «crea Cliente con id, nombre y correo» salen sólo "nombre" y "correo".

Acciones disponibles:

{"action":"CREATE_CLASS","className":"Cliente","attributes":[{"name":"nombre","type":"String"},{"name":"correo","type":"String"}]}
{"action":"UPDATE_CLASS","className":"Cliente","newName":"ClienteFinal"}
{"action":"DELETE_CLASS","className":"Cliente"}
{"action":"ADD_ATTRIBUTE","className":"Cliente","attributes":[{"name":"telefono","type":"String"}]}
{"action":"UPDATE_ATTRIBUTE","className":"Cliente","attributeName":"edad","newType":"Integer"}
{"action":"UPDATE_ATTRIBUTE","className":"Cliente","attributeName":"correo","newName":"email"}
{"action":"DELETE_ATTRIBUTE","className":"Cliente","attributeName":"correo"}
{"action":"CREATE_RELATIONSHIP","relationshipType":"ASSOCIATION","sourceClass":"Cliente","targetClasses":["Pedido"],"sourceMultiplicity":"1","targetMultiplicity":"0..*"}
{"action":"UPDATE_RELATIONSHIP","sourceClass":"Cliente","targetClass":"Pedido","sourceMultiplicity":"1","targetMultiplicity":"1..*"}
{"action":"DELETE_RELATIONSHIP","sourceClass":"Cliente","targetClass":"Pedido"}
{"action":"MOVE_CLASS","className":"Cliente","position":{"x":400,"y":250}}
{"action":"MOVE_CLASS","className":"Cliente","reference":{"direction":"below","className":"Usuario"}}

Tipos de dato permitidos: ${OFFERED_DATA_TYPES.join(', ')}.
Si la instrucción no dice de qué tipo es un atributo, usa "String".

Tipos de relación: ${AI_RELATIONSHIP_TYPES.join(', ')}.
- ASSOCIATION: dos clases se conocen entre sí.
- AGGREGATION: "sourceClass" es el todo y "targetClasses" las partes, que existen por su cuenta.
- COMPOSITION: "sourceClass" es el todo y "targetClasses" las partes, que no viven sin él.
- INHERITANCE: "sourceClass" es la clase PADRE y "targetClasses" son las clases HIJAS que heredan de ella.
  "Haz que Cliente herede de Usuario" se escribe:
  {"action":"CREATE_RELATIONSHIP","relationshipType":"INHERITANCE","sourceClass":"Usuario","targetClasses":["Cliente"]}
  Recuerda: en INHERITANCE el padre va en "sourceClass". La herencia no lleva multiplicidades.

Multiplicidades: "1", "0..1", "0..*", "1..*", "*". Cada extremo se indica por separado.
"Un Cliente puede tener muchos Pedidos y cada Pedido pertenece a un solo Cliente" se escribe:
{"action":"CREATE_RELATIONSHIP","relationshipType":"ASSOCIATION","sourceClass":"Cliente","targetClasses":["Pedido"],"sourceMultiplicity":"1","targetMultiplicity":"0..*"}
Si la instrucción no dice las multiplicidades, pon null en las dos.

Direcciones válidas en "reference": "above", "below", "left", "right".`;
}

/**
 * El diagrama actual, en el mínimo que hace falta para entender la instrucción.
 *
 * Sólo van los nombres de las clases y de sus atributos con su tipo: es lo que
 * el modelo necesita para resolver «agrega correo a Cliente» y para no
 * proponer una clase que ya existe. Las posiciones, los métodos, las
 * visibilidades y los identificadores se quedan fuera —ni los usa ni los debe
 * tocar—, y cada cosa de más es contexto que el modelo puede confundir.
 */
export function diagramContext(diagram: FullDiagramResponse): string {
  if (diagram.classes.length === 0) {
    return 'Diagrama actual: no tiene ninguna clase todavía.';
  }

  const classes = diagram.classes.map((umlClass) => {
    // Un atributo sin tipo se nombra a secas: escribir «nombre: null» sólo
    // serviría para que el modelo creyera que «null» es un tipo.
    const attributes = umlClass.attributes
      .map((attribute) =>
        attribute.data_type === null ? attribute.name : `${attribute.name}: ${attribute.data_type}`,
      )
      .join(', ');

    return `- ${umlClass.name}${attributes.length > 0 ? ` [${attributes}]` : ' (sin atributos)'}`;
  });

  const byId = new Map(diagram.classes.map((umlClass) => [umlClass.id, umlClass.name]));
  const relationships = diagram.relationships.map((relationship) => {
    const source = byId.get(relationship.source_class_id) ?? '?';
    const target = byId.get(relationship.target_class_id) ?? '?';
    const from = relationship.source_multiplicity ?? '-';
    const to = relationship.target_multiplicity ?? '-';

    return `- ${relationship.relationship_type}: ${source} (${from}) -> ${target} (${to})`;
  });

  return [
    'Diagrama actual.',
    'Clases:',
    ...classes,
    relationships.length > 0 ? 'Relaciones:' : 'Relaciones: ninguna.',
    ...relationships,
  ].join('\n');
}

/**
 * Instrucciones de CU05.
 *
 * Dos cosas están dichas con insistencia a propósito. La primera, que un
 * atributo sin tipo se transcribe con `null`: una pizarra o un diagrama de
 * base de datos suelen listar «id, nombre, correo» a secas, y un modelo al
 * que no se le dice esto rellena el hueco con «String» por su cuenta —y
 * entonces el diagrama importado afirma algo que nadie dibujó—. La segunda,
 * la orientación de la herencia, descrita por el dibujo: de dónde sale la
 * línea y a dónde apunta el triángulo, que es lo que el modelo está mirando y
 * coincide con cómo se guarda en uml_relationships.
 *
 * Lo que aquí NO se pide, a diferencia de CU04, es que se salte la columna
 * «id»: la clave primaria la pone la herramienta, pero pedírselo al lector de
 * imágenes salió mal. Al añadir esa regla —una excepción a «transcribe sólo lo
 * que se ve», y en mayúsculas, compitiendo con las de más abajo— el modelo
 * dejó de reconocer la entidad intermedia del diagrama de nota de venta, que
 * es la lectura más delicada y la que más importa. Aquí se transcribe el
 * dibujo entero y el «id» lo descarta después el ejecutor (ai-executor), que
 * es determinista y no se distrae.
 *
 * La entidad intermedia se pide de la única forma que un lector de imágenes
 * sabe hacer bien: describiendo lo que hay dibujado. Antes se le pedía que
 * sustituyera la línea discontinua por dos asociaciones hacia la caja, y eso
 * es una transformación, no una transcripción: el modelo se perdía y la caja
 * acababa importada suelta, sin ninguna relación. Ahora sólo tiene que decir
 * de qué línea cuelga —«associationClass»— y las dos asociaciones las escribe
 * ai.service.ts, igual que la herramienta «Entidad intermedia» del lienzo.
 */
export function imageSystemPrompt(): string {
  return `Eres un lector de diagramas. Observas una imagen y transcribes lo que hay dibujado.
Puede ser un diagrama de clases UML o un diagrama de base de datos con tablas o entidades:
en los dos casos, cada caja es una clase y cada línea entre cajas es una relación.
Respondes ÚNICAMENTE con un objeto JSON, sin explicaciones ni texto alrededor.

Formato de la respuesta:
{"classes":[{"name":"Cliente","attributes":[{"name":"id","type":"Integer"},{"name":"nombre","type":null}],"position":{"x":0.2,"y":0.15}}],
 "relationships":[{"relationshipType":"ASSOCIATION","sourceClass":"Cliente","targetClass":"Pedido","sourceMultiplicity":"1","targetMultiplicity":"0..*"}]}

Reglas:
- Transcribe SÓLO lo que se ve. No añadas clases, atributos ni relaciones que no estén dibujadas.
- "name" de una clase es el texto del compartimento de arriba de su caja (o el nombre de la tabla).
- "attributes" son los del compartimento del medio, en el orden en que aparecen.
- EL TIPO DE DATO ES OPCIONAL. Si junto al atributo no hay ningún tipo escrito,
  pon "type": null. No adivines, no completes y no supongas: un atributo escrito
  como "nombre" se transcribe {"name":"nombre","type":null}, nunca como String.
  Una misma caja puede mezclar atributos con tipo y atributos sin tipo.
- Ignora los métodos: esta herramienta importa clases, atributos y relaciones.
- "position" es el centro de la caja dentro de la imagen, en fracciones de 0 a 1
  (x de izquierda a derecha, y de arriba a abajo). Si no puedes situarla, omite el campo.
- CADA LÍNEA DEL DIBUJO PRODUCE UNA SOLA RELACIÓN. Recorre las líneas una por una
  y escribe cada una una única vez. No repitas el mismo par de clases con dos
  tipos distintos: decide mirando el adorno y quédate con esa.
- "relationshipType" según el adorno pegado a la línea:
  COMPOSITION si hay un rombo RELLENO (negro o de color sólido),
  AGGREGATION si hay un rombo VACÍO (sólo el contorno),
  INHERITANCE si hay un triángulo vacío,
  ASSOCIATION si la línea no tiene ningún adorno.
  Fíjate bien en si el rombo está relleno o hueco: es lo único que distingue
  COMPOSITION de AGGREGATION.
  Si es un diagrama de base de datos y la línea no tiene adorno, usa ASSOCIATION.
- En INHERITANCE, "sourceClass" es la clase de la que sale la línea (la hija) y
  "targetClass" es aquella a la que apunta el triángulo (la padre).
- En AGGREGATION y COMPOSITION, "sourceClass" es la clase que tiene el rombo pegado (el todo).
- ENTIDAD INTERMEDIA (clase de asociación). Es una caja unida por una línea
  DISCONTINUA al punto medio de la línea que une otras dos clases, y suele
  quedar debajo o encima de esa línea, entre las dos. Los diagramas de ventas,
  pedidos o matrículas casi siempre tienen una: DETALLE_VENTA, DETALLE,
  DETALLE_PEDIDO, ITEM, LINEA, MATRICULA, INSCRIPCION.
  La caja se transcribe en "classes" como cualquier otra clase, con sus
  atributos, y la línea discontinua NO se escribe como una relación aparte:
  se anota el nombre de la caja en "associationClass", dentro de la relación
  que une a las dos clases de los extremos.
  Ejemplo: NOTAVENTA y PRODUCTO unidas por una línea con "0..*" y "1..*", y
  DETALLE_VENTA colgando de ella con una línea discontinua, se escribe:
  {"relationshipType":"ASSOCIATION","sourceClass":"NOTAVENTA","targetClass":"PRODUCTO","sourceMultiplicity":"0..*","targetMultiplicity":"1..*","associationClass":"DETALLE_VENTA"}
  Sólo eso: ni relaciones de NOTAVENTA a DETALLE_VENTA ni de PRODUCTO a
  DETALLE_VENTA. De unirla a las dos se encarga la herramienta.
- Antes de responder, repasa las cajas una por una: ninguna puede quedarse
  suelta. Cada caja del dibujo tiene que aparecer en alguna relación, o como
  el "associationClass" de una de ellas. Si una caja no toca ninguna línea
  continua pero hay una discontinua que sale de ella, es una entidad
  intermedia y va en "associationClass".
- Copia las multiplicidades tal como están escritas junto a cada extremo.
  Las únicas formas válidas son "1", "0..1", "0..*", "1..*", "*" o un número suelto.
  Si un extremo no tiene nada escrito, o lo que hay no es una de esas formas,
  pon null. No inventes ni corrijas multiplicidades: "0..0" y "*..0" no existen.
- Tipos de dato preferidos, cuando el de la imagen equivalga a uno: ${OFFERED_DATA_TYPES.join(', ')}.
- Si la imagen no contiene ningún diagrama con cajas y nombres, responde {"classes":[],"relationships":[]}.`;
}
