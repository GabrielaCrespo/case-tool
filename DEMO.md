# Guion de la demostración

El orden es el que evalúa el docente, y está pensado para que cada paso deje montado el
siguiente: el diagrama que se dibuja al principio es el que se genera, se publica y se consume
desde el móvil al final.

Dura unos **veinte minutos** sin contar preguntas.

---

## Dónde está todo

La herramienta está en línea en **https://case-tool-gabriela.duckdns.org**. Los backends que se
publiquen quedan bajo `https://case-tool-gabriela.duckdns.org/d/<nombre-del-diagrama>`.

## Antes de empezar

Lo que hay que dejar preparado, porque depender de que salga a la primera en directo es pedirle
demasiado a la suerte:

- [ ] Una cuenta creada en la herramienta y sesión abierta en **dos navegadores distintos** (o
      uno normal y otro de incógnito), con **dos usuarios distintos** invitados al mismo
      proyecto.
- [ ] El diagrama **Sistema de ventas** ya dibujado y guardado (`database/seed-ventas.sql`, o a
      mano: es de cinco entidades).
- [ ] Un **segundo diagrama** ya generado y publicado, por si la publicación en directo se
      atasca: así se puede enseñar el móvil igualmente.
- [ ] El **teléfono** con la aplicación instalada, el reconocimiento de voz en español
      descargado y, si se va a enseñar, el modelo de lenguaje ya bajado.
- [ ] La **foto** de un diagrama de clases a mano, en el teléfono o en el portátil.
- [ ] **Enterprise Architect** abierto y vacío.
- [ ] Cuota de Groq disponible. En el plan gratuito son mil tokens de salida por minuto **y por
      modelo**; encadenar varias importaciones de imagen seguidas topa con el límite. Si la
      defensa lleva varias pruebas de IA, conviene el Dev Tier.
- [ ] **Segundo parcial:** la llave de Gemini en el servidor, un usuario administrador
      (`UPDATE users SET is_admin = TRUE …`) y, en «Servicio de IA», *Probar conexión* en verde
      el mismo día. **Ojo con la cuota gratuita de Gemini**: el 2026-11-07 era de 20 peticiones
      al día para `gemini-3.6-flash`, y ensayar la demo ya la gasta. No ensayar con el modelo que
      se va a usar en la defensa, o elegir uno con más cuota (`gemini-3.5-flash-lite`), o activar
      la facturación.
- [ ] En el proyecto de la demo, la **memoria** con al menos una decisión técnica escrita de
      antemano (por ejemplo: «toda entidad lleva fechaRegistro de tipo LocalDateTime»).

---

## 1. Dos navegadores editando a la vez · CU03 · 3 min

Con el mismo diagrama abierto en las dos ventanas, puestas una al lado de la otra.

1. En la ventana A, arrastrar una entidad. **En la B se mueve sola.**
2. En la A, empezar a editar los atributos de `CLIENTE`. En la B, esa entidad aparece
   **bloqueada y con el nombre de quien la tiene**.
3. Añadir un atributo en la A y verlo aparecer en la B.
4. Señalar los avatares de arriba a la derecha: quién está conectado.

> **Lo que hay que decir:** no es que se refresque cada tanto. Cada cambio se guarda en
> PostgreSQL y se difunde a la sala por Socket.IO; lo que llega a la otra ventana es exactamente
> el recurso que devolvería la API al recargar.

---

## 2. Una instrucción por voz en el lienzo · CU04 · 2 min

En el asistente de IA (botón de la chispa), con el micrófono:

> «Agregá una entidad PRODUCTO con descripción, precio y stock.»

1. Se ve la transcripción.
2. Se ve **lo que entendió antes de aplicarlo**: qué operaciones va a hacer.
3. Confirmar, y las entidades aparecen en el lienzo.
4. En la otra ventana también, porque es un cambio como cualquier otro.

> **Lo que hay que decir:** el modelo propone y el código valida. Lo que devuelve la IA se
> comprueba contra el catálogo de tipos y las reglas del modelo antes de tocar nada; lo que no
> encaja se descarta diciendo por qué.

---

## 3. Una foto convertida en modelo · CU05 · 2 min

En el mismo asistente, pestaña de imagen. Subir la foto del diagrama a mano.

1. Unos dos segundos.
2. Aparecen las entidades leídas, con sus atributos y sus relaciones.

> **Lo que hay que decir:** la imagen **no se guarda en ninguna parte**. Viaja dentro de la
> petición, se le enseña al modelo y se descarta. De la importación queda el registro —quién,
> cuándo, qué archivo y qué modelo se leyó—, no la foto.

---

## 4. Ida y vuelta con Enterprise Architect · CU06 · 3 min

1. **Exportar**: botón «Exportar» → XMI. Se descarga un `.xml`.
2. **Abrirlo en Enterprise Architect**: importar en un paquete nuevo. Se ven las clases con sus
   atributos, sus tipos y las líneas de relación con sus multiplicidades.
3. **Volver**: en la herramienta, importar ese mismo archivo como diagrama nuevo. Vuelve igual.

> **Lo que hay que decir:** el criterio no fue cumplir el estándar sobre el papel, sino que el
> archivo **abra de verdad en Enterprise Architect**. Es XMI 1.1 sobre UML 1.3, que es lo que
> esa herramienta lee sin quejarse.

---

## 5. Generar el backend · CU07 y CU08 · 4 min

Botón «Backend» → «Generar backend».

1. Se ve el progreso: escribir el proyecto, compilarlo con Maven.
2. Al terminar: cuántas entidades, cuántos endpoints, cuántos archivos.
3. Y dos comprobaciones, no una: **compila** y **arranca** —se ha levantado contra una
   PostgreSQL de verdad y ha respondido.
4. «Descargar .zip» y abrir el proyecto para enseñar una entidad: sus anotaciones JPA, su
   `@ManyToOne` con la clave foránea, su repositorio, su servicio y su controlador REST.

> **Lo que hay que decir:** el backend NestJS no escribe ni una línea de Java. Lee el modelo de
> PostgreSQL y se lo pasa a un programa Java con JavaPoet. Y que compile no se supone: se
> comprueba ejecutando Maven sobre lo generado.

---

## 6. Publicarlo · 3 min

Botón «Publicar» → «Publicar».

1. Construir la imagen, crear su base, arrancar el contenedor.
2. Al terminar: la URL y **un código QR con ella**.
3. Abrir `https://<dominio>/d/<slug>/api/_meta` en el navegador y enseñar el JSON: ahí está el
   modelo entero descrito por el propio backend.

> **Lo que hay que decir:** ese `_meta` es el contrato. Es lo que permite que haya **una sola**
> aplicación móvil y no un generador de código Flutter: la aplicación no sabe nada de este
> diagrama, lo lee.

---

## 7. El móvil, con red · CU09 · 3 min

1. Abrir la aplicación y **escanear el código QR** de la pantalla anterior.
2. Aparece la lista de entidades del diagrama. Ninguna estaba escrita en la aplicación.
3. Entrar en `CLIENTE` → dar de alta uno. El formulario tiene los campos del diagrama, con sus
   tipos y sus obligatorios.
4. **Enseñar un error**: dejar un obligatorio en blanco y guardar. El mensaje sale **debajo del
   campo que falla**, porque el backend generado contesta diciendo cuál es.
5. Dar de alta una `NOTAVENTA` y **elegir el cliente** en el desplegable.
6. Volver al navegador y recargar la lista del backend: ahí está.

---

## 8. El móvil, en modo avión · CU10 · 4 min

**Activar el modo avión delante del docente.** El indicador de arriba se pone naranja: «Sin
conexión».

1. **Leer**: entrar en `CLIENTE`. Los registros siguen ahí, con un aviso de cuándo se trajeron.
2. **Dictar**, todavía en modo avión:

   > «Registrar cliente Pedro y cobrarle 25 pesos.»

   Se ve la transcripción, se ve lo entendido —dos operaciones: el cliente y su nota de venta— y
   se confirma. Los dos registros aparecen marcados como pendientes.
3. **Editar** uno de los registros que ya existían.
4. **Borrar** otro.
5. El indicador dice cuántas operaciones esperan.
6. **Quitar el modo avión.** Suben solas, en orden, y el indicador se pone verde.
7. Volver al navegador, recargar: los cambios están, y la nota de venta de Pedro apunta al Pedro
   que se creó sin red.

> **Lo que hay que decir:** el orden importa. La nota de venta se creó apuntando a un cliente
> que todavía no existía en el servidor; al subir, el identificador que se inventó el teléfono
> se cambia por el que puso PostgreSQL. Y la transcripción y la interpretación de la frase
> ocurrieron **en el teléfono**: en modo avión no hay a quién preguntar.

---

## 9. Un conflicto, resuelto a mano · CU10 · 2 min

1. En el navegador, cambiar el nombre de un cliente.
2. En el teléfono —que todavía tiene la versión vieja— cambiar el mismo cliente y guardar.
3. Sale **409**: el registro cambió. Queda marcado.
4. Entrar en la pantalla de conflictos: las dos versiones, campo por campo, con las diferencias
   marcadas.
5. Elegir una.

> **Lo que hay que decir:** no se mezcla nada automáticamente. Cada entidad generada lleva un
> `@Version`, JPA rechaza la escritura que llega con una versión vieja y el backend contesta
> 409. Mezclar por nuestra cuenta daría un registro que nadie escribió.

---

# Segundo parcial — la IA como integrante del equipo

Unos **doce minutos** más. Se hace con los mismos dos navegadores del punto 1, con el diagrama
**Sistema de ventas** abierto en los dos y el chat abierto en los dos.

## 10. El servicio de IA · CU11 · 2 min

1. Con el administrador, botón **Servicio de IA** en la cabecera.
2. Enseñar que la llave aparece como «configurada» pero no se ve en ninguna parte: vive en una
   variable de entorno del servidor, no en la base.
3. *Probar conexión*: dice qué modelo contestó y cuánto tardó.
4. Desmarcar «Asistente de IA disponible» y *Guardar*: en el chat del editor aparece «IA no
   disponible» con el motivo. Volver a marcarlo.

> **Lo que hay que decir:** el servidor y el modelo se cambian aquí, sin tocar código. Un modelo
> autoalojado (Ollama, LM Studio) es elegir «Servidor compatible con OpenAI» y poner su dirección.

## 11. Una pregunta que ve todo el equipo · CU12 y CU13 · 3 min

1. En el navegador A: «¿Qué le falta a este diagrama para registrar qué productos se venden en
   cada nota de venta?».
2. En el navegador B, **sin tocar nada**: el botón Chat cuenta un mensaje nuevo; al abrirlo se ve
   la pregunta de A y «La IA está respondiendo…».
3. Llega la respuesta a los dos a la vez. Nombra **NOTAVENTA** y **PRODUCTO**: no es una respuesta
   de manual, es sobre este diagrama.
4. En el navegador B, seguir la conversación: «¿Y qué multiplicidades tendrían esas relaciones?».
   Responde apoyándose en lo que dijo antes.

> **Lo que hay que decir:** cada pregunta lleva el proyecto entero —memoria, descripción, el
> diagrama con su validación, los demás diagramas y los últimos mensajes—. Las preguntas se
> responden de una en una por proyecto, y lo dice: «En cola».

## 12. La memoria del proyecto · CU14 · 3 min

1. Pantalla del proyecto → pestaña **Memoria del proyecto**: descripción, la decisión técnica
   preparada, requisitos y diagramas.
2. En el chat: «¿Qué atributos le faltan a CLIENTE según las decisiones del proyecto?». Responde
   con la decisión guardada (fechaRegistro).
3. Volver a la memoria → *Resumir conversación*: la IA guarda un resumen de lo hablado, que queda
   como una entrada más y se puede corregir.
4. Con el otro usuario, enseñar que la ve pero no la puede cambiar: sólo el propietario.

## 13. Delegar un cambio · CU15 · 4 min

1. En la cabecera del chat, el propietario deja el modo en **Propone cambios**.
2. En el navegador B: «Crea la entidad DETALLENOTA con cantidad Integer y relaciónala con
   NOTAVENTA (1 a 1..*) y con PRODUCTO (1 a 0..*)». La IA contesta «Propongo…» y aparece una
   tarjeta con los tres pasos y *Aplicar* / *Descartar*. El lienzo **no** ha cambiado.
3. En el navegador A, *Aplicar*: DETALLENOTA aparece en el lienzo de los dos, y la tarjeta dice
   «Aplicado por …».
4. En el navegador B: «Agrega a CLIENTE el atributo telefono de tipo String». Llega otra
   tarjeta. Antes de aplicarla, en el navegador A **seleccionar CLIENTE** en el lienzo (queda
   tomado). Desde B, *Aplicar*: dice que A está editando CLIENTE y **no aplica nada**; la
   propuesta sigue pendiente. Quitar la selección en A y volver a *Aplicar* desde B: ahora sí.
5. Cambiar el modo a **Aplica cambios** y pedir «Agrega a NOTAVENTA el atributo observacion de
   tipo String»: se aplica al responder. Pedir una opinión, en cambio, no toca nada.

> **Lo que hay que decir:** lo que propone la IA pasa por el mismo validador y los mismos
> servicios que una edición a mano —por eso respeta los bloqueos y llega al lienzo de todos—, y
> se vuelve a validar al aplicarlo: si entretanto alguien cambió el diagrama, no se aplica a
> ciegas.

---

## Si algo falla en directo

| Qué falla | Qué hacer |
|---|---|
| La IA no responde | Se acabó la cuota de Groq por este minuto. Esperar un minuto o pasar al siguiente punto; se retoma después. |
| La publicación tarda demasiado | Usar el segundo diagrama, ya publicado de antes. |
| El móvil no reconoce la voz | Escribir la orden en la misma casilla: la interpreta igual. |
| El modelo de lenguaje no acierta | Usar una frase con la forma «registrar `<entidad>` `<campo>` `<valor>`»: eso lo entienden las reglas del teléfono, que aciertan siempre. |
| No hay red en la sala | Todo el punto 8 funciona igual. Los puntos 1 a 7 no: necesitan el servidor. |
| El chat dice que se agotó la cuota diaria | Con el administrador, «Servicio de IA» → otro modelo (`gemini-3.5-flash-lite`) → *Probar conexión* → *Guardar*. Cada modelo tiene su propia cuota. |
| El chat dice que el modelo está saturado | Es Google (`503 high demand`); el servidor ya reintentó una vez. Volver a preguntar en unos segundos. |
| La IA no propone acciones en el punto 13 | Pedirlo en imperativo y con los nombres exactos («Crea la entidad…», «Agrega a CLIENTE…»). |
