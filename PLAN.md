# Plan del segundo parcial — la IA como miembro del equipo (CU11–CU15)

> **Estado (2026-11-07):** las siete fases implementadas y verificadas en local, también contra
> Gemini de verdad, con sockets reales y en Chrome con dos sesiones a la vez. Backend: 150 pruebas
> en verde (las 47 de antes y 103 nuevas), e2e en verde; frontend: `tsc` y ESLint sin avisos;
> imágenes de producción construidas. **Falta sólo desplegar en AWS** (fase 6), que necesita que
> los cambios estén en GitHub y encender la instancia; los pasos están en `deploy/README.md`,
> «Segundo parcial». El plan del primer parcial sigue más abajo, como registro histórico.
>
> Aprendido en la Fase 5: **el plan gratuito de Gemini da 20 peticiones al día para
> `gemini-3.6-flash`** y se agotó con las pruebas. La cuota es por modelo; `gemini-3.5-flash-lite`
> tenía la suya. El chat ahora distingue la cuota diaria de la de un minuto y dice cuándo vuelve.
> Las pruebas contra el servidor se hacen en una base aparte (`case_tool_test`), no en la de uso.
>
> Arreglado en la Fase 6: el socket del editor no conectaba en producción con la API bajo `/api`
> (iba a `/socket.io` en la raíz del dominio). `socket.ts` separa ahora el prefijo (`path`) del
> espacio de nombres; verificado con un proxy que imita a Traefik y en local.
>
> Arreglado de paso (era anterior a este parcial): el panel de propiedades del editor tenía
> `shrink-0` dentro de una columna flex, así que no hacía scroll y, con relaciones en el
> diagrama, su final tapaba la barra de estado. Ahora es `min-h-0 flex-1`.
>
> Decidido en la Fase 4:
> - El modo de la IA lo elige el propietario **desde el propio chat** (selector en la cabecera
>   del panel); el resto del equipo lo ve con su explicación. El cambio no se difunde: los demás
>   ven el modo nuevo al recargar, pero el servidor usa siempre el vigente al responder.
> - El catálogo de acciones del chat **se recorta del prompt de CU04** (`interpretSystemPrompt`,
>   desde «Acciones disponibles:»), sin copiarlo: lo leen el mismo parser y el mismo ejecutor.
> - Antes de aplicar se miran los bloqueos de CU03 (`lockConflicts`): `apply` ejecuta paso a
>   paso y chocar con un bloqueo a mitad dejaría la propuesta aplicada a medias. Con un bloqueo
>   ajeno, 409 diciendo quién y la propuesta sigue pendiente; si ya no encaja con el diagrama,
>   queda `FAILED` con el motivo. En EXECUTE, un bloqueo la deja como propuesta.
> - En PROPOSE la IA presenta los cambios como propuesta («Propongo…»): sin esa línea decía
>   «He creado…» antes de que nadie los aplicara.
>
> Aprendido en la Fase 2: Google responde a veces `503 «high demand»` aunque la llave y el modelo
> estén bien. `ChatLlmClient` reintenta una vez los 500/502/503 tras 2,5 s y, si persiste, dice
> que el modelo está saturado.

El segundo parcial **extiende** el primero: la IA pasa a ser un integrante más dentro del editor
colaborativo, con un chat compartido en tiempo real por proyecto, memoria persistente del
proyecto y la posibilidad de proponer o ejecutar cambios sobre el diagrama según se configure.

## Restricciones

- Todo lo del primer parcial sigue funcionando: **47 pruebas del backend y 46 del móvil en
  verde** al cerrar cada fase.
- **No se modifican** `backend/src/ai/groq.service.ts`, `prompts.ts`, `uml-actions.ts`,
  `ai-executor.service.ts`, ni nada de `mobile/` o `generator/`. Se usan, no se tocan.
- **Fuera de alcance:** el modelo autoalojado (Ollama, llama.cpp, una EC2 aparte). El cliente del
  chat queda preparado para que agregarlo sea sólo cambiar la configuración de CU11 —proveedor
  `OPENAI_COMPATIBLE`, `base_url` del servidor y modelo—, sin tocar código.

## Decisiones ya tomadas

1. **`ChatLlmClient` propio en `backend/src/assistant/`**, compatible con OpenAI. Preset por
   defecto `GEMINI`: `https://generativelanguage.googleapis.com/v1beta/openai`, llave en
   `GEMINI_API_KEY`. `base_url` y modelo se editan desde CU11 porque Google retira modelos a
   menudo. **CU04, CU05 y el dictado siguen con Groq** (`GroqService`, intacto).
2. **Dos proveedores, y cada uno sabe de qué variable sale su llave**: `GEMINI` →
   `GEMINI_API_KEY` (obligatoria); `OPENAI_COMPATIBLE` → `CHAT_LLM_API_KEY` (opcional: Ollama o
   LM Studio no la piden). No se deja elegir el *nombre* de la variable desde la pantalla: un
   nombre libre permitiría mandar `JWT_SECRET` o `DATABASE_URL` como llave a una URL cualquiera.
3. **Las llaves sólo viven en variables de entorno.** La pantalla de CU11 sólo dice si están
   configuradas. `/ai/settings/test` avisa si falta la variable antes de llamar a nada.
4. **Administrador = `users.is_admin`**, asignado por SQL. No hay pantalla para otorgarlo.
5. **`PATCH /ai/settings`, no `PUT`**: el CORS de `main.ts` sólo admite GET, POST, PATCH y DELETE,
   y el resto de la API ya modifica con PATCH.
6. **Sólo parámetros estándar en la petición**: `model`, `messages` y `max_tokens`. Nada de
   `temperature` (Gemini 3 recomienda dejar la suya), `response_format` (Gemini no documenta
   `json_object` y LM Studio lo rechaza) ni `reasoning_effort` (cada familia admite valores
   distintos). El JSON se recupera del texto.
7. **El `toJson` de `GroqService` es privado** y ese archivo no se toca, así que su lógica se
   replica tal cual en `assistant/model-json.ts` (función pura, con prueba), más **un reintento
   de reparación**: si el modelo devuelve JSON malformado, se le devuelve su respuesta pidiéndole
   sólo el objeto, una vez.
8. **Modelo por defecto `gemini-3.6-flash`**, el Flash marcado *Stable* en la documentación de
   Google al 2026-11-07 (`gemini-2.5-flash` está obsoleto y se redirige desde el 2026-12-01).
9. **`ai_settings` tiene una sola fila.** Si todavía no existe, se usan los valores por defecto
   sin guardarlos; el primer `PATCH` la crea.
10. **Chat por proyecto** (sala `project:<id>`); cada mensaje guarda desde qué diagrama se envió.
11. **`projects.ai_mode`**: `ANSWER`, `PROPOSE` (por defecto) y `EXECUTE`. La IA responde
    `{reply, actions}`; las acciones se muestran como tarjeta *Aplicar / Descartar* y al aplicar
    se **vuelven a validar** con `plan/apply` contra el diagrama de ese momento. Si alguien tiene
    tomado un elemento, falla y dice quién. El propietario cambia el modo con `PATCH /projects/:id`.
12. **Contexto en orden estable**: instrucciones, memoria del proyecto, `projects.description`,
    diagrama actual, una línea por cada otro diagrama, últimos 8 mensajes, pregunta.
    `context_budget` y `max_tokens` se configuran en CU11.
13. **Una pregunta a la vez por proyecto** (cola en memoria): el plan gratuito de Gemini admite
    pocas peticiones por minuto.
14. **Escrituras por REST, avisos por Socket.IO**, como en CU02/CU03: `chat:message`,
    `chat:updated` y `ai:status`.

## Esquema (Fase 1)

Sólo agregados. Se aplica con el flujo del apéndice A y queda reflejado en `database/db.sql`.

| Objeto | Qué es |
|---|---|
| `users.is_admin BOOLEAN NOT NULL DEFAULT FALSE` | Actor Administrador de CU11 |
| `projects.ai_mode ai_mode NOT NULL DEFAULT 'PROPOSE'` | Qué puede hacer la IA en ese proyecto (CU15) |
| `ai_provider` (`GEMINI`, `OPENAI_COMPATIBLE`) | Tipo enumerado |
| `ai_mode` (`ANSWER`, `PROPOSE`, `EXECUTE`) | Tipo enumerado |
| `memory_kind` (`DECISION`, `REQUIREMENT`, `SUMMARY`) | Tipo enumerado |
| `chat_action_status` (`NONE`, `PROPOSED`, `APPLIED`, `REJECTED`, `FAILED`) | Tipo enumerado |
| `ai_settings` | `provider`, `base_url`, `model`, `enabled`, `context_budget`, `max_tokens`, `updated_by`, fechas |
| `project_memory_entries` | `project_id`, `kind`, `title`, `content`, `created_by`, fechas |
| `chat_messages` | `project_id`, `diagram_id`, `author_id` (NULL = la IA), `reply_to`, `content`, `proposed_actions`, `action_status`, `action_result`, `resolved_by`, `resolved_at`, `model`, `error_message`, `created_at` |

La descripción del proyecto ya existe (`projects.description`) y los diagramas se leen de su
tabla: la memoria de CU14 no los duplica.

## Archivos por caso de uso

### CU11 — Configurar Servicio de IA (Administrador)

| Capa | Archivo | Qué |
|---|---|---|
| BD | `contract.prisma`, `db.sql` | `ai_settings`, `users.is_admin`, `ai_provider` |
| Backend | `assistant/chat-llm-client.ts` (+ `.spec.ts`) | **Nuevo.** Cliente OpenAI-compatible: errores en castellano, un reintento corto ante 429, reparación de JSON |
| Backend | `assistant/model-json.ts` (+ `.spec.ts`) | **Nuevo.** Recuperar el JSON del texto del modelo |
| Backend | `assistant/ai-settings.service.ts` (+ `.spec.ts`) | **Nuevo.** Leer, validar y guardar la configuración; comprobar el administrador; probar la conexión |
| Backend | `assistant/ai-settings.controller.ts` | **Nuevo.** `GET`/`PATCH /ai/settings`, `POST /ai/settings/test`, `GET /ai/status` |
| Backend | `assistant/assistant.module.ts`, `app.module.ts` | **Nuevo** módulo y su registro |
| Backend | `auth/auth.service.ts` | `/auth/me` devuelve `is_admin` |
| Backend | `.env.example` | `GEMINI_API_KEY`, `CHAT_LLM_API_KEY` |
| Frontend (F6) | `features/admin/AiSettingsPage.tsx`, `App.tsx`, `components/AppHeader.tsx`, `api/endpoints.ts`, `api/types.ts` | Pantalla, ruta y enlace sólo para administradores |
| Despliegue (F6) | `deploy/.env.example`, `deploy/docker-compose.yml` | Pasar `GEMINI_API_KEY` al servicio `api`; migrar la base de la instancia |

### CU12 — Consultar al Asistente de IA

| Capa | Archivo | Qué |
|---|---|---|
| BD | `chat_messages` | Pregunta y respuesta |
| Backend | `assistant/assistant-context.ts` (+ `.spec.ts`) | **Nuevo.** Instrucciones y armado del contexto, puro y con presupuesto |
| Backend | `assistant/project-queue.ts` (+ `.spec.ts`) | **Nuevo.** Una pregunta a la vez por proyecto, como mucho 5 esperando |
| Backend | `assistant/assistant.service.ts` | **Nuevo.** Guarda la pregunta, encola, arma el contexto, llama al modelo, guarda la respuesta (o un mensaje de la IA que explica por qué no pudo) |
| Backend | `assistant/assistant.controller.ts` | **Nuevo.** `GET`/`POST /projects/:id/chat` |
| Reutiliza | `DiagramsService.findOneFull`, `validate`, `assertProjectAccess`; `diagramContext()` de `prompts.ts` (sólo lectura) | |

### CU13 — Visualizar Conversaciones del Equipo

| Capa | Archivo | Qué |
|---|---|---|
| Backend | `collaboration/chat-events.service.ts` | **Nuevo.** Canal interno como `DiagramEventsService`, registrado en `realtime-state.module.ts` |
| Backend | `collaboration/collaboration-events.ts`, `collaboration.gateway.ts` | Sala `project:<id>` (se entra en el mismo `diagram:join`); eventos nuevos |
| Frontend | `realtime/types.ts`, `realtime/useCollaboration.ts`, `store/chat.ts` | Recibir y guardar los mensajes (por identificador: la pregunta propia llega dos veces); recargar al reconectar |
| Frontend | `features/assistant/TeamChatPanel.tsx`, `features/editor/EditorTopBar.tsx`, `EditorPage.tsx`, `api/endpoints.ts`, `api/types.ts`, `components/icons.tsx` | Panel lateral sobre las propiedades, botón «Chat» con contador de no leídos, «La IA está respondiendo…» / «En cola» |
| Frontend (recortable) | `features/editor/Presence.tsx` | La IA como participante |

### CU14 — Gestionar Memoria del Proyecto (Propietario)

| Capa | Archivo | Qué |
|---|---|---|
| BD | `project_memory_entries` | Decisiones, requisitos y resúmenes |
| Backend | `assistant/project-memory.service.ts`, `project-memory.controller.ts` | **Nuevos.** CRUD (sólo el propietario escribe) y `POST /projects/:id/memory/summary` |
| Frontend | `features/projects/ProjectMemoryPanel.tsx`, `ProjectDetail.tsx` | Panel de memoria y descripción (el modo de la IA ya se elige en el chat, Fase 4) |

### CU15 — Delegar Ejecución de Tareas a la IA

| Capa | Archivo | Qué |
|---|---|---|
| BD | `projects.ai_mode`, columnas de acción de `chat_messages` | |
| Backend | `ai/ai.module.ts` | Exportar `AiExecutorService` (el servicio no se toca) |
| Backend | `assistant/proposal.ts` (+ `.spec.ts`) | **Nuevo.** Leer las acciones, guardar la propuesta y detectar bloqueos ajenos antes de aplicar |
| Backend | `assistant/assistant-context.ts` | Instrucciones según el modo y catálogo de acciones de CU04 |
| Backend | `assistant/assistant.service.ts`, `assistant.controller.ts` | `parseActions` + `plan` al recibir; `POST /chat/:messageId/apply` y `/reject` revalidan y aplican |
| Backend | `projects/projects.service.ts` | `PATCH /projects/:id` acepta `ai_mode` (sólo el propietario) |
| Frontend | `features/assistant/TeamChatPanel.tsx` (`ProposalCard`, `ModeBar`), `store/chat.ts`, `api/` | Tarjeta *Aplicar / Descartar* con el resultado y selector del modo para el propietario |

## API y eventos nuevos

| Método | Ruta | CU | Quién |
|---|---|---|---|
| GET | `/ai/settings` | CU11 | Administrador |
| PATCH | `/ai/settings` | CU11 | Administrador |
| POST | `/ai/settings/test` | CU11 | Administrador |
| GET | `/ai/status` | CU11 | Cualquier usuario autenticado |
| GET / POST | `/projects/:id/chat` | CU12, CU13 | Miembros del proyecto |
| GET / POST | `/projects/:id/memory` | CU14 | Lee cualquier miembro; escribe el propietario |
| PATCH / DELETE | `/memory/:id` | CU14 | Propietario |
| POST | `/projects/:id/memory/summary` | CU14 | Propietario |
| POST | `/chat/:messageId/apply` · `/reject` | CU15 | Miembros del proyecto |

| Evento (servidor → sala `project:<id>`) | Cuándo |
|---|---|
| `chat:message` | Se guardó un mensaje, de una persona o de la IA |
| `chat:updated` | Cambió el estado de una propuesta |
| `ai:status` | La IA empieza o termina de responder, y a quién |

## Fases

| # | Trabajo | Criterio de aceptación |
|---|---|---|
| 1 | Esquema + `ChatLlmClient` + backend de CU11 | `prisma db update --dry-run` sólo agrega; `/ai/settings/test` avisa si falta la llave; pruebas en verde |
| 2 | CU12 | La respuesta nombra clases reales del diagrama y respeta el orden del contexto |
| 3 | CU13 | Dos navegadores con usuarios distintos ven la misma conversación al instante |
| 4 | CU15 | Una propuesta aplicada aparece en el lienzo de ambos; una propuesta vieja o bloqueada falla con motivo |
| 5 | CU14 | Una decisión guardada cambia la respuesta de la IA |
| 6 | Pantalla de CU11 + despliegue en AWS con `GEMINI_API_KEY` | Cambiar el modelo desde la pantalla sin reiniciar |
| 7 | Pruebas, README y DEMO | Todo en verde y documentación al día |

**Recortes si falta tiempo, en este orden:** resumen automático de CU14 → la IA en la lista de
presencia → listado de modelos en CU11 → modo `EXECUTE`.

**Cómo se comprueba cada fase sin romper lo anterior:** `npx tsc --noEmit && npx vitest run` en
`backend/` (las 47 de siempre más las nuevas), `npx tsc -b && npx eslint src --max-warnings=0` en
`frontend/` cuando la fase lo toca, y `flutter test` en `mobile/` al cerrar la fase 7.

## Correcciones pendientes del README (Fase 7)

- Rol `VIEWER`: existe en el tipo enumerado, pero la invitación no permite elegirlo y ningún
  servicio lo lee; **todos los invitados son editores**.
- CU04/CU05: la IA del editor **aplica sin pedir confirmación** si todo pasa la validación.
- Son **15 tablas** (18 después de la Fase 1), no 14.
- Pruebas del móvil ejecutadas (46), historial de commits, cabecera «accesible» con la instancia
  apagada, textos residuales de `AiAssistant.tsx`.
- Documentar CU11–CU15, el actor Administrador y las tablas nuevas.

---

# Primer parcial — Plan para terminar el proyecto (histórico)

> **Las seis fases están implementadas.** Este documento se conserva como lo que fue —el plan
> con el que se trabajó y las decisiones que se cerraron antes de empezar—, no como la
> descripción del proyecto terminado. Para eso está [`README.md`](README.md); para ejecutarlo
> delante del docente, [`DEMO.md`](DEMO.md); y para ponerlo en línea,
> [`deploy/README.md`](deploy/README.md).
>
> Lo único que cambió respecto de lo previsto: la instancia es una `c7i-flex.large` y no una
> `t3.medium`. Tiene las mismas 2 vCPU y los mismos 4 GB —que es lo que el plan pedía de
> verdad—, pero sí es elegible para el plan gratuito de AWS, que rechaza la `t3.medium`.

Este documento existe para que la próxima sesión sea **sólo implementación**: las decisiones ya
están tomadas y no hay que volver a discutirlas. Cada fase dice qué archivos se tocan, qué hay
que escribir, cómo se comprueba que quedó bien y qué trampas tiene. Al terminar la fase 1 el
proyecto queda desplegado en AWS.

Lo que está en «Decisiones ya tomadas» se da por cerrado. Si algo de ahí se cambia, hay que
repasar las fases que dependen de ello, porque están escritas dando eso por hecho.

---

## Estado actual

### Terminado y verificado

| Caso de uso | Estado |
|---|---|
| CU01 Gestionar proyectos | Completo |
| CU02 Diseñar el modelo de datos | Completo, con clave primaria implícita |
| CU03 Colaborar en tiempo real | Completo: presencia, bloqueo por elemento y difusión de cambios |
| CU04 Asistir mediante IA (texto y voz) | Completo, sobre Groq |
| CU05 Generar modelo desde imagen | Completo, sobre Groq; 2,2 s por diagrama |
| CU06 Intercambio XMI con Enterprise Architect | Completo en los dos sentidos |
| CU07 Generar backend Spring Boot | Genera y **compila**; falta que se compruebe que arranca |
| CU08 Descargar el backend | Completo |

Comprobaciones que hoy pasan: 47 tests del backend, 6 del banco de IA contra la API real,
typecheck y lint del frontend, `mvn compile` del generador, y un proyecto generado que compila
con Maven.

### Lo que falta

| Requisito | Fase |
|---|---|
| Que el backend generado se pueda ejecutar y probar de verdad | 0 |
| Desplegar en AWS la herramienta y los backends generados | 1 |
| CU09 — App móvil Flutter contra el backend generado | 2 |
| Voz e IA local en el móvil | 3 |
| CU10 — Funcionamiento sin conexión y sincronización | 4 |
| Guion de demostración y cierre | 5 |

---

## Decisiones ya tomadas

1. **La clave primaria es implícita.** Toda entidad tiene `id` de tipo `Long` autogenerado, lo
   pone la herramienta y nadie lo declara como atributo. El nombre `id` está reservado en el
   editor, en la API, en las importaciones y en el generador. Ya está implementado.
2. **La IA del servidor es Groq, sin alternativa local.** Un modelo por capacidad:
   `openai/gpt-oss-20b` para el texto, `qwen/qwen3.8-27b` para las imágenes y
   `whisper-large-v3-turbo` para el dictado. Modelos separados porque **la cuota es por modelo**.
   Ya está implementado.
3. **La IA del móvil corre en el dispositivo.** Es lo que exige el enunciado y lo que sostiene el
   funcionamiento sin conexión. No se mezcla con la anterior.
4. **Ni imágenes ni audios se guardan.** Se usan en la petición en la que llegan y se descartan.
5. **La app móvil es una sola app genérica** guiada por `/api/_meta`, no código Flutter generado
   por diagrama.
6. **El despliegue es una EC2 con Docker y Traefik**, con la herramienta CASE y los backends
   generados en la misma instancia, y un PostgreSQL en contenedor para las bases de los backends
   generados. La base de la propia herramienta sigue en Supabase.
7. **El despliegue no es un caso de uso.** La numeración sigue siendo CU01–CU10; publicar es una
   operación de la herramienta y se documenta como tal.
8. **No se hacen**: DTOs en el backend generado, autenticación en el backend generado, Yjs para
   la colaboración, ni un generador de código Flutter.

---

## Fase 0 — Cerrar CU07: que el backend generado se ejecute

**Por qué primero:** todo lo demás se apoya en esto. Sin `/api/_meta` no hay app móvil, sin
`Dockerfile` no hay despliegue y sin `@Version` no hay detección de conflictos en la fase 4.

### 0.1 `GET /api/_meta` en el proyecto generado

Archivo nuevo: `generator/src/main/java/com/casese/generator/emit/MetaWriter.java`, registrado en
`ProjectGenerator.java` junto a los demás escritores.

Genera un `MetaController` con la descripción del modelo **incrustada como constante** en el
propio código generado (con `$S` de JavaPoet, que escapa bien). No se calcula en tiempo de
ejecución ni se consulta a la herramienta: el backend generado es autónomo.

Forma exacta de la respuesta, que es el contrato que consumen las fases 2, 3 y 4:

```json
{
  "diagram": "Sistema de ventas",
  "generated_at": "2026-09-22T00:00:00Z",
  "entities": [
    {
      "name": "CLIENTE",
      "table": "cliente",
      "path": "/api/clientes",
      "abstract": false,
      "id": { "name": "id", "type": "Long" },
      "fields": [
        {
          "name": "nombre",
          "type": "String",
          "required": true,
          "unique": false,
          "maxLength": 255,
          "default": null
        }
      ],
      "relations": [
        {
          "field": "notaventas",
          "kind": "ONE_TO_MANY",
          "target": "NOTAVENTA",
          "owner": false,
          "joinColumn": null
        },
        {
          "field": "cliente",
          "kind": "MANY_TO_ONE",
          "target": "CLIENTE",
          "owner": true,
          "joinColumn": "cliente_id"
        }
      ]
    }
  ]
}
```

De dónde sale cada dato: `Blueprint.entities()` da los `EntityPlan`; el nombre y si es abstracta,
de `plan.umlClass()`; la tabla y la ruta, de `Names.sqlIdentifier` y `Names.restPath`; los campos,
de `plan.columns()` (`required` es `!isNullable()`, `maxLength` sólo para `String`); las
relaciones, de `plan.links()` (`kind`, `other().name()`, `field()`, `joinColumn()`). El `id`
siempre es `EntityPlan.ID_NAME` / `ID_TYPE`.

### 0.2 Validación en el proyecto generado

- `EntityWriter`: `@NotNull` cuando el atributo no admite nulos y `@Size(max = …)` en los `String`.
  Las constantes nuevas van en `Jpa.java`.
- `CrudWriter`: `@Valid` en los `@RequestBody` de POST y PUT.
- `SupportWriter`: un `@RestControllerAdvice` que convierta `MethodArgumentNotValidException` en un
  400 con `{ "errors": { "campo": "mensaje" } }`. **Este formato lo consume el formulario del
  móvil en la fase 2**, así que no se cambia después.
- `ResourceWriter`: añadir `spring-boot-starter-validation` al pom.

### 0.3 Control de concurrencia

Un campo `@Version private Long version;` en cada entidad (`EntityWriter`), incluido en `_meta`
como un campo más de sistema. Parece prematuro y no lo es: es la señal con la que la fase 4
detecta conflictos, y añadirlo después obliga a migrar las tablas de los backends ya desplegados.
Con él, una escritura sobre una versión vieja responde 409.

### 0.4 Configuración para vivir detrás de un proxy

En `ResourceWriter`, en `application.properties`:

```properties
server.servlet.context-path=${CONTEXT_PATH:}
server.port=${PORT:8080}
management.endpoints.web.exposure.include=health
```

Y una clase de configuración CORS con los orígenes en `${CORS_ORIGINS:*}`. Añadir
`spring-boot-starter-actuator` al pom.

`CONTEXT_PATH` es lo que permite que varios backends convivan tras el mismo dominio en la fase 1:
cada uno responde bajo `/d/<slug>` y lo sabe, así que no hay que reescribir rutas en el proxy.

### 0.5 Dockerfile generado

`ResourceWriter` escribe también `Dockerfile` y `.dockerignore`:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q package -DskipTests
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

El `.dockerignore` excluye `target/` y `*.zip`.

### 0.6 Comprobación de arranque en CU07

En `backend/src/codegen/codegen.service.ts`, tras el paso de compilación:

1. Levantar el jar con `DB_URL` apuntando a una PostgreSQL de pruebas (variable
   `SMOKE_DB_URL`; si no está definida, el paso se salta diciéndolo, no falla).
2. Esperar a que `/actuator/health` responda `UP`, con tope de 60 s.
3. Un `GET` a la ruta de la primera entidad; esperar 200.
4. Apagar el proceso y guardar el resultado.

Columna nueva `smoke_check_passed BOOLEAN` en `code_generation_jobs`, por el flujo de Prisma 8 (ver
apéndice A). Mostrarlo en `GenerateBackendDialog.tsx` junto al resultado de compilación.

### Criterio de aceptación de la fase 0

Generar desde un diagrama con herencia y un muchos a muchos resuelto, y comprobar que:

- el proyecto compila y arranca, y `/actuator/health` responde;
- `GET /api/_meta` describe todas las entidades con sus campos y relaciones;
- un POST inválido responde 400 con el campo señalado;
- `docker build` produce una imagen que arranca con `DB_URL`, `PORT` y `CONTEXT_PATH`;
- los 47 tests del backend siguen pasando.

### Trampas conocidas

- JavaPoet escapa con `$S`; el JSON de `_meta` lleva comillas y llaves, y con `$L` se rompe.
- `@Version` en una jerarquía con `@Inheritance(JOINED)` va sólo en la raíz, como el `@Id`.

---

## Fase 1 — Desplegar en AWS

Al terminar esta fase el proyecto está en línea: la herramienta en una URL pública y cada backend
generado en la suya.

### 1.1 La instancia

- EC2 `t3.medium` (4 GB; con 2 GB no entra construir con Maven), Amazon Linux 2023, disco 30 GB.
- Docker y Docker Compose instalados; rol IAM con SSM para entrar sin abrir SSH.
- Grupo de seguridad: 80 y 443 abiertos, 22 cerrado (se entra por SSM), 5432 sólo interno.
- Un dominio apuntando a la IP elástica. Hace falta de verdad: **Android bloquea el tráfico HTTP
  en claro**, y sin TLS la app de la fase 2 no puede hablar con el backend sin parches.

### 1.2 La base

Carpeta nueva `deploy/` con `docker-compose.yml` y un `README.md` con los pasos exactos. Servicios:

- **traefik**: puertos 80 y 443, resolución automática de certificados con Let's Encrypt,
  descubrimiento por etiquetas de Docker.
- **postgres**: imagen `postgres:16` con volumen propio. Es la base **de los backends generados**;
  la de la herramienta sigue en Supabase.
- **case-tool-api**: la imagen de `backend/` (Dockerfile nuevo, ver 1.3).
- **case-tool-web**: los estáticos de `frontend/` servidos por Traefik.

### 1.3 Contenedores de la propia herramienta

- `backend/Dockerfile`: dos etapas, `node:22-alpine`, `npm ci` y `npm run build`, y el arranque
  con `node dist/main.js`. Monta dos cosas: el volumen donde viven los proyectos generados
  (`GENERATED_DIR`) y **el socket de Docker**.
- `frontend/Dockerfile` o build en el momento del despliegue; lo que se publica es `dist/`.

Sobre el socket de Docker: es lo que permite que la herramienta construya y arranque los backends
generados sin SSH ni SSM, porque corre en la misma máquina. La contrapartida hay que escribirla en
el README de `deploy/`: montar ese socket equivale a dar root del host al contenedor. Es aceptable
en un proyecto de parcial y no debe quedar escondido.

### 1.4 Tabla `backend_deployments`

Por el flujo del apéndice A. Tipo nuevo y tabla:

```sql
CREATE TYPE deployment_status AS ENUM
  ('PENDING', 'BUILDING', 'STARTING', 'RUNNING', 'FAILED', 'STOPPED');

CREATE TABLE backend_deployments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id      UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    job_id          UUID REFERENCES code_generation_jobs(id) ON DELETE SET NULL,
    requested_by    UUID NOT NULL REFERENCES users(id),
    status          deployment_status NOT NULL DEFAULT 'PENDING',
    slug            VARCHAR(100) NOT NULL,
    api_url         VARCHAR(500),
    container_name  VARCHAR(100),
    database_name   VARCHAR(63),
    image_tag       VARCHAR(200),
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deployed_at     TIMESTAMPTZ,
    UNIQUE (diagram_id)
);
```

`UNIQUE (diagram_id)`: un despliegue por diagrama. Publicar otra vez reemplaza el anterior.

### 1.5 Módulo `deployments/`

Tres archivos, como el resto del proyecto: `deployments.module.ts`, `deployments.controller.ts`,
`deployments.service.ts`.

El servicio, por pasos, escribiendo el estado en cada uno:

1. Comprobar que el diagrama tiene una generación con `status = SUCCESS`; si no, 400 diciendo que
   primero hay que generar.
2. Calcular el slug a partir del nombre del diagrama (ya existe esa función en
   `codegen.service.ts`, reutilizarla).
3. `BUILDING`: `docker build -t case-tool/<slug>:<jobId> <carpeta del proyecto generado>`.
4. Crear la base del despliegue si no existe: `CREATE DATABASE <slug>` en el contenedor de
   PostgreSQL.
5. `STARTING`: parar y borrar el contenedor anterior si lo hay, y arrancar el nuevo con las
   variables `DB_URL`, `DB_USER`, `DB_PASSWORD`, `CONTEXT_PATH=/d/<slug>`, `CORS_ORIGINS` y las
   etiquetas de Traefik:

   ```
   traefik.enable=true
   traefik.http.routers.<slug>.rule=Host(`<dominio>`) && PathPrefix(`/d/<slug>`)
   traefik.http.routers.<slug>.tls.certresolver=le
   traefik.http.services.<slug>.loadbalancer.server.port=8080
   ```

   No se quita el prefijo en el proxy: lo conoce la aplicación por `CONTEXT_PATH`, y así las
   rutas que devuelve son correctas.
6. Esperar a `https://<dominio>/d/<slug>/actuator/health`, con tope de 120 s.
7. `RUNNING`, guardar `api_url` y `deployed_at`.

Operaciones del controller:

| Método | Ruta | Qué hace |
|---|---|---|
| POST | `/diagrams/:id/deployment` | Publica; devuelve el despliegue en curso |
| GET | `/diagrams/:id/deployment` | Estado actual, para consultar periódicamente |
| GET | `/diagrams/:id/deployment/logs` | Últimas líneas del contenedor |
| DELETE | `/diagrams/:id/deployment` | Para el contenedor y borra su base, preguntando antes |

Tope de despliegues activos en una variable de entorno (`MAX_DEPLOYMENTS`, por defecto 3): cada
backend Spring Boot ocupa entre 250 y 400 MB y la instancia tiene 4 GB.

### 1.6 En el editor

Un diálogo de publicación junto al de generación (`DeployDialog.tsx`), con el mismo patrón de
consulta periódica que ya usa `GenerateBackendDialog.tsx`: estado, la URL copiable, un QR con esa
URL —que es como se conecta la app de la fase 2— y un botón para republicar.

### Criterio de aceptación de la fase 1

- La herramienta responde en `https://<dominio>` y se puede usar desde otro equipo.
- Publicar dos diagramas distintos y consumir los dos por su URL desde fuera de la red, cada uno
  con sus tablas en su propia base.
- Republicar un diagrama reemplaza el contenedor sin dejar el anterior colgando.
- Dar de baja borra contenedor y base.

### Trampas conocidas

- El primer `docker build` de cada backend descarga medio Maven. Montar un volumen con la caché
  (`/root/.m2`) compartido entre construcciones.
- La imagen del frontend necesita `VITE_API_URL` en tiempo de construcción, no de ejecución.
- Traefik no recarga certificados si el dominio aún no resuelve: primero el DNS, después el
  primer arranque.

---

## Fase 2 — CU09: la app Flutter genérica

Una sola app, escrita a mano una vez, que sirve para cualquier backend generado porque lee su
`/api/_meta`.

### 2.1 Estructura

```
mobile/lib/
  main.dart
  api/            cliente HTTP (dio) y el modelo de _meta
  features/
    connect/      pegar la URL o escanear el QR
    entities/     lista de entidades, lista de registros, formulario
    voice/        (fase 3)
  offline/        (fase 4)
```

Paquetes: `dio`, `flutter_riverpod`, `mobile_scanner`, `drift` + `sqlite3_flutter_libs` +
`path_provider` (fase 4), `flutter_gemma` y el de reconocimiento de voz (fase 3). Comprobar las
versiones al instalar; algunos de los de IA cambian de nombre a menudo.

### 2.2 Pantallas

1. **Conectar**: pegar la URL del despliegue o escanear el QR del editor. Se guarda y se recuerda.
2. **Entidades**: la lista que devuelve `_meta`.
3. **Registros**: `GET` de la ruta de la entidad, con paginado.
4. **Formulario**: los campos salen de `_meta`.
   - `String` → texto; `Integer`, `Long`, `BigDecimal`, `Double` → numérico;
   - `Boolean` → interruptor; `LocalDate`, `LocalDateTime` → selector de fecha;
   - relación `MANY_TO_ONE` → selector alimentado por el catálogo de la otra entidad;
   - `required` marca el campo obligatorio y `maxLength` limita la entrada;
   - la clave primaria no se pide nunca;
   - un 400 del backend se pinta en el campo que señala (formato de 0.2).
5. **Borrado** con confirmación.

### Criterio de aceptación de la fase 2

Contra un backend generado y desplegado de un diagrama con dos entidades relacionadas: dar de alta
un registro de cada una, relacionarlas, editarlas y borrarlas, sin una línea de código específica
para ese diagrama.

---

## Fase 3 — Voz e IA local en el móvil

Requisitos 8 y 10 del enunciado: un asistente que entiende «registrá al cliente X y cobrale 10
pesos», corriendo en el teléfono.

### 3.1 Transcripción en el dispositivo

Reconocimiento de voz sin conexión, con su modelo en español descargado con la app. Es lo que
permite que funcione en modo avión; una API de transcripción no valdría.

**Decidido e implementado:** Moonshine base en español (cuantizado, ~65 MB) con `sherpa_onnx`,
más Silero VAD para saber cuándo se deja de hablar, **dentro del APK** en `mobile/assets/voz`. Se
graba con `record` y se transcribe en un isolate aparte al terminar la frase. Se descartó el
reconocedor de Android (`speech_to_text` con `onDevice`): sin el paquete de español de Google
descargado en el teléfono falla en modo avión, y eso no lo controla la aplicación. La licencia
del modelo en español (Moonshine Community License) permite el uso académico.

Trampas conocidas:
- El APK se construye con `flutter build apk --release --split-per-abi`. `--target-platform` no
  filtra las librerías nativas de los plugins (ONNX Runtime, MediaPipe) y el APK único pasa de
  200 MB; el de `arm64-v8a` queda en ~134 MB.
- Para probar el transcriptor con `flutter test` en Windows hay que cargar antes el
  `onnxruntime.dll` de `sherpa_onnx_windows`: Windows trae el suyo (1.17) en System32 y se carga
  ése, que no sirve.

### 3.2 Intérprete local

Un modelo pequeño (Gemma 1B por `flutter_gemma`), **descargado en el primer arranque, no dentro
del APK**. Se le pasa un resumen de `_meta` —entidades y campos— y se le pide un JSON de
operaciones de un conjunto cerrado:

```json
{"operations":[
  {"op":"CREATE","entity":"CLIENTE","values":{"nombre":"Juan","telefono":"777"}},
  {"op":"CREATE","entity":"NOTAVENTA","values":{"monto":10,"cliente":"<ref>"}}
]}
```

Es el mismo patrón que ya funciona en CU04, y funciona por lo mismo: **el modelo propone y el
código valida**. Contra `_meta` se comprueba que la entidad exista, que los campos existan y que
los tipos encajen; lo que no encaje se descarta con su motivo.

### 3.3 Respaldo determinista

Cuando el modelo no acierte o el teléfono sea flojo: una gramática con verbos (registrar, crear,
agregar, cobrar, borrar, buscar), la entidad por nombre o sinónimo, y pares campo-valor. La
demostración no puede depender de que un modelo de 1B acierte a la primera.

### 3.4 Confirmación

Lo entendido se enseña en pantalla y se ejecuta al confirmar, igual que el asistente del lienzo.

### Criterio de aceptación de la fase 3

En modo avión, dictar dos frases encadenadas y ver las dos operaciones correctas en la cola, con
su confirmación.

---

## Fase 4 — CU10: sin conexión y sincronización

### 4.1 Base local (Drift)

```
cached_records(entity, server_id, payload_json, updated_at, dirty)
pending_operations(id, entity, op, payload_json, local_id, server_id,
                   status, attempts, last_error, created_at)
id_map(local_id, entity, server_id)
```

### 4.2 Reglas

- **Lectura sin red**: lo último sincronizado, con la fecha a la vista para no hacer creer que es
  de ahora.
- **Escritura sin red**: se aplica en local marcada como pendiente y se encola.
- **Al volver la conexión**: reenvío en orden y por entidad, traduciendo el identificador local al
  real con `id_map`. Es imprescindible cuando una operación depende de otra —crear un cliente y
  después su nota de venta—.
- **Conflictos**: el `@Version` de la fase 0 hace que el backend responda 409 si el registro
  cambió entre medias. Ese 409 marca el registro en conflicto y se pregunta cuál se queda, el
  local o el del servidor. **Sin mezclas automáticas.**
- **Indicador permanente**: conectado, sin red, o cuántas operaciones esperan.
- **Sin red no se pregunta al servidor**: el repositorio consulta la conectividad antes de cada
  operación. Intentarlo siempre hacía que un alta en modo avión esperara el plazo de la conexión.
- **Al conectar y al sincronizar se traen todas las entidades** (`refreshAll`), para que sin red
  esté todo y no sólo lo que se abrió antes.
- **La lista de registros observa la base local** (Drift `watch`), no la respuesta del servidor.

### Criterio de aceptación de la fase 4

Modo avión, tres operaciones —un alta, una edición y un borrado—, volver la red y ver las tres
aplicadas; y un conflicto provocado a mano que se resuelve eligiendo.

---

## Fase 5 — Cierre

1. **Guion de demostración**, en el orden que evalúa el docente: dos navegadores editando a la
   vez, una instrucción por voz en el lienzo, una foto convertida en modelo, ida y vuelta con
   Enterprise Architect, generar y publicar, y el móvil contra esa URL, primero con red y luego en
   modo avión.
2. **Datos de prueba** preparados: un diagrama de ventas completo y su backend ya publicado, para
   no depender de que todo salga a la primera en directo.
3. **README actualizado**: arquitectura final, requisitos reales y cómo se levanta cada pieza.
4. **Cabos sueltos**: decidir qué pasa con `xmi_exchange_jobs`, `diagram_change_log` y
   `diagram_versions`, que están en el esquema y nadie escribe. O se usan o se quitan.
5. Añadir CU10 a la tabla de casos de uso del README.

---

## Apéndice A — Cambiar el esquema

El orden importa, porque `db update` compara la base contra el contrato **emitido**, no contra el
`.prisma`:

```bash
# 1. editar backend/src/prisma/contract.prisma
npx prisma contract emit
npx prisma db update --dry-run     # leer el plan antes de aplicarlo
npx prisma db update               # destructivo: pide confirmación
# 4. reflejar el cambio en database/db.sql
```

En una sesión no interactiva, una operación destructiva se confirma con
`--no-interactive --confirm <nombre de la base>`.

## Apéndice B — Comprobaciones

```bash
# backend
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run

# banco de IA: sólo al tocar prompts o cambiar de modelo (llama a la API de verdad)
$env:AI_BANK=1; npx vitest run src/ai/ai-bank.spec.ts

# frontend
cd frontend && npx tsc -b && npx eslint src --max-warnings=0

# generador
mvn -f generator/pom.xml package
```

## Apéndice C — Riesgos que ya conocemos

- **Los prompts son frágiles.** Al pedirle al lector de imágenes que se saltara la columna `id`,
  dejó de reconocer la entidad intermedia. Cualquier cambio en `src/ai/prompts.ts` o de modelo
  obliga a pasar el banco antes de darlo por bueno.
- **La cuota de Groq es por modelo**: mil tokens de salida por minuto en el plan gratuito, y una
  instrucción se estima en unos 770. Encadenar varias importaciones de imagen en la demostración
  topa con el límite; el Dev Tier lo quita por poco dinero. Decidirlo antes de la defensa.
- **Sin conexión no hay asistente de IA.** Es una consecuencia aceptada de quitar el modelo local.
  El diseño manual, la colaboración, el XMI y la generación no la necesitan.
- **Android y el tráfico en claro**: sin dominio con TLS, la app no habla con el backend.
- **Memoria de la instancia**: cada backend desplegado ocupa entre 250 y 400 MB.
