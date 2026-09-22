# case-tool

Herramienta CASE colaborativa para el **diseño de modelos de datos** mediante diagramas de
clases UML: varias personas modelan a la vez sobre el mismo diagrama, un asistente de IA puede
crear y modificar el modelo por instrucciones en texto o voz, un diagrama fotografiado se puede
convertir en modelo, el modelo se importa y exporta como XMI para interoperar con Enterprise
Architect, y desde el modelo terminado se genera un backend Spring Boot + JPA + PostgreSQL
funcional —que compila, arranca y se puede publicar en una dirección pública— más una
aplicación móvil que lo consume, con o sin conexión.

En el editor, cada entidad del lienzo es una futura tabla, cada atributo una columna y cada
relación una relación entre tablas — no se pide elegir "tipo de clase UML": lo que se dibuja es,
por definición, algo que hay que guardar.

## Arquitectura

```
                    DISEÑO MANUAL   ASISTENCIA IA (texto/voz)   FOTO   XMI
                            \              |                     |     /
                             \             |                     |    /
                              v            v                     v   v
                        ┌──────────────────────────────────────────────┐
                        │  MODELO UML  (PostgreSQL — fuente de verdad)  │
                        └──────────────────────────────────────────────┘
                                     |                          |
                                     v                          v
                          frontend (React Flow,             generator (Java)
                          sólo lo dibuja)                         |
                                                                   v
                                                     Spring Boot + JPA + PostgreSQL
                                                       (proyecto generado, .zip)
                                                                   |
                                                          publicado en una EC2
                                                                   |
                                                                   v
                                                        GET /api/_meta  ──>  móvil
```

El modelo UML vive estructurado en PostgreSQL (clases, atributos, métodos, relaciones); el
lienzo de React Flow es sólo su representación visual. Eso es lo que permite que el generador de
backend, el intérprete de IA, la lectura de imágenes y el importador/exportador XMI trabajen
todos sobre el mismo modelo en lugar de sobre el dibujo.

La pieza que cierra el círculo es `/api/_meta`: cada backend generado publica la descripción de
su propio modelo, y la aplicación móvil se arma leyéndola. Por eso hay **una sola** aplicación
móvil escrita a mano y no un generador de código Flutter.

### Las dos IA, que no son la misma

| | Dónde corre | Por qué |
|---|---|---|
| IA de la herramienta (CU04, CU05) | Groq, en la nube | El backend se despliega en una EC2 sin GPU, donde un modelo de visión no cabe. Un modelo por capacidad, porque la cuota de Groq es por modelo. |
| IA de la aplicación móvil (CU09) | En el teléfono | El enunciado exige que funcione sin conexión, y una API no vale en modo avión. |

La consecuencia aceptada: **sin conexión no hay asistente de IA en el editor**. El diseño
manual, la colaboración, el XMI y la generación del backend no la necesitan.

## Estructura del repositorio

| Carpeta | Qué es |
|---|---|
| [`backend/`](backend) | API NestJS + TypeScript + Prisma 8 sobre PostgreSQL. Autenticación, proyectos, diagramas, colaboración en tiempo real (Socket.IO), asistente de IA, importación de imágenes, XMI, el disparador del generador y la publicación de los backends generados. |
| [`frontend/`](frontend) | React + TypeScript + Vite + Tailwind CSS. El editor del diagrama (React Flow), gestión de proyectos y el resto de la interfaz. |
| [`generator/`](generator) | Programa Java 21 + Maven que traduce el modelo UML a un proyecto Spring Boot + JPA completo, usando JavaPoet. Se invoca como un `.jar` ejecutable desde el backend. |
| [`mobile/`](mobile) | Aplicación Flutter que consume cualquier backend generado leyendo su `/api/_meta`. Incluye el asistente por voz que corre en el teléfono y el funcionamiento sin conexión. |
| [`database/`](database) | `db.sql`: el esquema completo de PostgreSQL, desplegado en Supabase. Es la descripción de referencia del esquema; cualquier cambio de columnas se refleja aquí. |
| [`deploy/`](deploy) | `docker-compose.yml` y las instrucciones para poner la herramienta en línea en una instancia EC2 con Traefik y TLS. |

## Casos de uso

| ID | Caso de uso | Estado |
|---|---|---|
| CU01 | Gestionar proyectos | Completo |
| CU02 | Diseñar el modelo de datos mediante diagrama de clases UML | Completo, con clave primaria implícita |
| CU03 | Colaborar en tiempo real sobre el mismo diagrama | Completo: presencia, bloqueo por elemento y difusión de cambios |
| CU04 | Asistir el diseño mediante IA (instrucciones en texto o voz) | Completo, sobre Groq |
| CU05 | Generar modelo a partir de una imagen del diagrama | Completo, sobre Groq |
| CU06 | Intercambiar modelos con Enterprise Architect mediante XMI | Completo en los dos sentidos |
| CU07 | Generar el backend Spring Boot a partir del modelo | Completo: genera, compila y arranca |
| CU08 | Descargar el backend generado | Completo |
| CU09 | Aplicación móvil contra el backend generado | Completo, con asistente por voz en el dispositivo |
| CU10 | Funcionamiento sin conexión y sincronización | Completo, con resolución de conflictos |

**Publicar no es un caso de uso.** La numeración es CU01–CU10; dejar un backend generado
respondiendo en una dirección pública es una operación de la herramienta —el paso que sigue a
generarlo y descargarlo— y se documenta como tal, en [`deploy/`](deploy).

## Puesta en marcha

Hacen falta: Node.js 22, PostgreSQL (el esquema en `database/db.sql`, pensado para Supabase),
Java 21 + Maven, y Flutter si se va a tocar la aplicación móvil. Una clave de Groq es opcional:
sin ella funciona todo menos el asistente de IA.

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env      # y completar las variables (ver el propio archivo)
npm run start:dev
```

El backend usa Prisma 8 con su flujo de "contrato" (`src/prisma/contract.prisma` →
`contract.json`/`contract.d.ts`/`db.ts`), no el `schema.prisma` clásico. Antes de escribir
consultas nuevas conviene revisar `src/prisma/contract.d.ts` para ver la API que realmente
genera esta versión. Para cambiar el esquema, el orden importa:

```bash
# 1. editar backend/src/prisma/contract.prisma
npx prisma contract emit
npx prisma db update --dry-run     # leer el plan antes de aplicarlo
npx prisma db update               # lo destructivo pide confirmación
# 4. reflejar el cambio en database/db.sql
```

`db update` compara la base contra el contrato **emitido**, no contra el `.prisma`: sin emitir
antes, el plan sale vacío y parece que no hubiera nada que cambiar.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env      # VITE_API_URL apuntando al backend
npm run dev
```

### 3. Generador de backend (CU07) — se compila una sola vez

```bash
mvn -f generator/pom.xml package
```

Deja `generator/target/generator.jar`, que es lo que el backend invoca como subproceso al pedir
"Generar backend" desde el editor. Más detalle de cómo traduce el modelo en
[`generator/README.md`](generator/README.md).

### 4. Aplicación móvil (CU09, CU10)

```bash
cd mobile
flutter pub get
flutter run
```

Al abrirla se le da la dirección de un backend publicado, o se escanea el código QR que enseña
el editor al publicarlo. A partir de ahí la aplicación se arma sola con lo que diga
`/api/_meta`.

Dos cosas del teléfono que conviene comprobar antes de una demostración:

- el **reconocimiento de voz sin conexión** en español tiene que estar descargado (en Android,
  en los ajustes de voz de Google). Sin él, dictar en modo avión no devuelve nada;
- el **modelo de lenguaje** se descarga desde la propia pantalla del asistente, la primera vez.
  No va dentro del APK. Sin él se puede dictar igual: las reglas del teléfono entienden órdenes
  como «registrar cliente Juan y cobrarle 10 pesos».

### 5. En línea

La herramienta está desplegada en **https://case-tool-gabriela.duckdns.org**, y cada backend
que se publique responde bajo `https://case-tool-gabriela.duckdns.org/d/<slug>`.

En [`deploy/README.md`](deploy/README.md) están los pasos exactos y los datos de la instancia:
una EC2 con Docker, Traefik resolviendo el TLS, y la herramienta y los backends generados
conviviendo bajo el mismo dominio.

## Comprobaciones

```bash
# backend
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint

# banco de IA: sólo al tocar prompts o cambiar de modelo (llama a la API de verdad)
$env:AI_BANK=1; npx vitest run src/ai/ai-bank.spec.ts

# frontend
cd frontend && npx tsc -b && npx eslint src --max-warnings=0

# generador
mvn -f generator/pom.xml package

# móvil
cd mobile && flutter analyze && flutter test
```

## Variables de entorno

Cada `.env` real queda fuera del repositorio (`.gitignore`); los `.env.example` de `backend/`,
`frontend/` y `deploy/` son las plantillas con todas las variables documentadas. **Ninguna
credencial se escribe en el código ni entra en una imagen de Docker.**

## Lo que esta herramienta no guarda

Ni las imágenes de CU05, ni los audios de CU04, ni los archivos XMI de CU06. De cada uno queda
su registro —quién, cuándo, qué archivo y qué se leyó de él—, pero el contenido se usa en la
petición en la que llega y se descarta. No hay disco, ni binarios en PostgreSQL, ni servicio de
almacenamiento.
