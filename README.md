# case-tool

Herramienta CASE colaborativa para el **diseño de modelos de datos** mediante diagramas de
clases UML: varias personas modelan a la vez sobre el mismo diagrama, un asistente de IA local
puede crear y modificar el modelo por instrucciones en texto o voz, un diagrama fotografiado se
puede convertir en modelo, el modelo se importa y exporta como XMI para interoperar con
Enterprise Architect, y desde el modelo terminado se genera un backend Spring Boot + JPA +
PostgreSQL funcional y compilado, listo para descargar.

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
                        │   MODELO UML  (PostgreSQL — fuente de verdad) │
                        └──────────────────────────────────────────────┘
                                     |                          |
                                     v                          v
                          frontend (React Flow,             generator (Java)
                          sólo lo dibuja)                         |
                                                                   v
                                                     Spring Boot + JPA + PostgreSQL
                                                        (proyecto generado, .zip)
```

El modelo UML vive estructurado en PostgreSQL (clases, atributos, métodos, relaciones); el
lienzo de React Flow es sólo su representación visual. Eso es lo que permite que el generador de
backend, el intérprete de IA, la lectura de imágenes y el importador/exportador XMI trabajen
todos sobre el mismo modelo en lugar de sobre el dibujo.

## Estructura del repositorio

| Carpeta | Qué es |
|---|---|
| [`backend/`](backend) | API NestJS + TypeScript + Prisma 8 sobre PostgreSQL. Autenticación, proyectos, diagramas, colaboración en tiempo real (Socket.IO), asistente de IA, importación de imágenes, XMI y el disparador del generador de backend. |
| [`frontend/`](frontend) | React + TypeScript + Vite + Tailwind CSS. El editor del diagrama (React Flow), gestión de proyectos y el resto de la interfaz. |
| [`generator/`](generator) | Programa Java 21 + Maven que traduce el modelo UML a un proyecto Spring Boot + JPA completo, usando JavaPoet. Se invoca como un `.jar` ejecutable desde el backend. |
| [`database/`](database) | `db.sql`: el esquema completo de PostgreSQL, desplegado en Supabase. Es la descripción de referencia del esquema; cualquier cambio de columnas se refleja aquí. |
| [`speech/`](speech) | Servicio local en Python (Faster-Whisper) que transcribe el audio del asistente de IA a texto. Corre aparte, en el entorno virtual `whisper-env/` (no versionado; ver más abajo). |
| [`mobile/`](mobile) | App Flutter para el acceso desde el móvil. **Aún no iniciada**: por ahora es el scaffold por defecto de `flutter create`. |

## Casos de uso

| ID | Caso de uso |
|---|---|
| CU01 | Gestionar proyectos |
| CU02 | Diseñar el modelo de datos mediante diagrama de clases UML |
| CU03 | Colaborar en tiempo real sobre el mismo diagrama |
| CU04 | Asistir el diseño mediante IA (instrucciones en texto o voz) |
| CU05 | Generar modelo a partir de una imagen del diagrama |
| CU06 | Intercambiar modelos con Enterprise Architect mediante XMI |
| CU07 | Generar el backend Spring Boot a partir del modelo |
| CU08 | Descargar el backend generado |
| CU09 | Acceso desde móvil — **no iniciado** |

## Puesta en marcha

Hacen falta: Node.js, una base de datos PostgreSQL (el esquema en `database/db.sql`, pensado
para Supabase), Java 21 + Maven, y opcionalmente Ollama (IA) y Python (transcripción por voz).

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
genera esta versión.

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

### 4. Transcripción de voz (CU04, opcional)

El entorno virtual `whisper-env/` no se versiona porque es un artefacto local y pesado (incluye
NumPy, ONNX Runtime, CTranslate2...); se recrea con un solo comando. Instrucciones completas en
[`speech/README.md`](speech/README.md):

```bash
python -m venv whisper-env
whisper-env/Scripts/python.exe -m pip install faster-whisper
whisper-env/Scripts/python.exe speech/transcribe_server.py
```

Sin este servicio en marcha, el asistente de IA sigue funcionando por texto e imagen; sólo el
dictado por voz queda desactivado.

### 5. IA local (CU04/CU05, opcional)

Requiere [Ollama](https://ollama.com) en marcha con el modelo de visión que interpreta tanto las
instrucciones de texto como las imágenes de diagramas:

```bash
ollama pull qwen3-vl:4b-instruct
```

## Variables de entorno

Cada `.env` real queda fuera del repositorio (`.gitignore`); los `.env.example` de `backend/` y
`frontend/` son las plantillas con todas las variables documentadas, incluidas las credenciales
de PostgreSQL/Supabase, Cloudinary (CU05) y Ollama.
