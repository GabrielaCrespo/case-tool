# Plan para terminar el proyecto

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
