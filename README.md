# case-tool

**Plataforma colaborativa para el diseño de datos mediante UML, asistencia con inteligencia
artificial y generación automática de backend**

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-8_(rc)-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Java](https://img.shields.io/badge/Java-21-ED8B00?logo=openjdk&logoColor=white)
![Spring Boot](https://img.shields.io/badge/Spring_Boot-3.4-6DB33F?logo=springboot&logoColor=white)
![Flutter](https://img.shields.io/badge/Flutter-3.13+-02569B?logo=flutter&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Groq](https://img.shields.io/badge/IA-Groq-F55036)
![Tests](https://img.shields.io/badge/backend_tests-47_passed-success)

> **Estado del proyecto:** los diez casos de uso (CU01–CU10) están implementados y verificados
> contra el código. La herramienta está desplegada y accesible en
> **https://case-tool-gabriela.duckdns.org**. No existe pipeline de CI/CD ni archivo de licencia
> (ver [Roadmap, pendientes y limitaciones](#21-roadmap-pendientes-y-limitaciones)).

> **Sobre este documento:** fue redactado inspeccionando el repositorio real —`package.json`,
> `prisma.config.ts`, `src/prisma/contract.prisma`, `src/`, `generator/src/`, `mobile/lib/`,
> `database/db.sql`, `deploy/docker-compose.yml`, `pubspec.yaml`— y **no** a partir del documento
> teórico ni de `PLAN.md`. Todo lo que no aparece en el código está marcado como **pendiente**,
> **TODO** o **no implementado aún**. Las diferencias encontradas entre la teoría y el código se
> listan en [Discrepancias detectadas](#24-discrepancias-detectadas).

---

## 2. Tabla de contenidos

1. [Título, descripción y estado](#case-tool)
2. [Tabla de contenidos](#2-tabla-de-contenidos)
3. [Contexto académico](#3-contexto-académico)
4. [Resumen del proyecto](#4-resumen-del-proyecto)
5. [Marco teórico resumido](#5-marco-teórico-resumido)
6. [Arquitectura general](#6-arquitectura-general)
7. [Stack tecnológico real](#7-stack-tecnológico-real)
8. [Módulos funcionales](#8-módulos-funcionales)
9. [Modelo UML y PUDS](#9-modelo-uml-y-puds)
10. [Modelo de datos](#10-modelo-de-datos)
11. [API de la herramienta](#11-api-de-la-herramienta)
12. [Generación de backend](#12-generación-de-backend)
13. [Aplicación móvil](#13-aplicación-móvil)
14. [Inteligencia artificial](#14-inteligencia-artificial)
15. [Interoperabilidad XMI](#15-interoperabilidad-xmi)
16. [Instalación y ejecución local](#16-instalación-y-ejecución-local)
17. [Uso paso a paso](#17-uso-paso-a-paso)
18. [Despliegue](#18-despliegue)
19. [Pruebas](#19-pruebas)
20. [Estructura de carpetas real](#20-estructura-de-carpetas-real)
21. [Roadmap, pendientes y limitaciones](#21-roadmap-pendientes-y-limitaciones)
22. [Referencias bibliográficas](#22-referencias-bibliográficas)
23. [Créditos y licencia](#23-créditos-y-licencia)
24. [Discrepancias detectadas](#24-discrepancias-detectadas)
25. [Checklist de verificación](#25-checklist-de-verificación)

---

## 3. Contexto académico

| Dato | Valor | Procedencia |
|---|---|---|
| Materia | Ingeniería de Software I | Ruta del repositorio (`…/IngenieriaSoftwareI/…`) |
| Período | Semestre 2-2026 | Ruta del repositorio (`…/Semetre_2-2026/…`) |
| Evaluación | Primer Parcial | Ruta del repositorio (`…/PrimerParcial/…`) |
| Estudiante | Gabriela Belén Crespo Cárdenas | Configuración de Git del repositorio |
| Docente | **TODO — no consta en el repositorio** | — |
| Universidad / carrera | **TODO — no consta en el repositorio** | — |
| Fecha de la última entrega | 2026-09-22 (último artefacto compilado: `generator/target/generator.jar`) | Marca de tiempo del `.jar` |

> Los campos marcados **TODO** deben completarse a mano: no hay ningún archivo en el repositorio
> que los contenga, y este documento no los inventa.

Documentos de acompañamiento que ya existen en el repositorio:

| Archivo | Para qué sirve |
|---|---|
| [`PLAN.md`](PLAN.md) | Plan de trabajo histórico y registro de decisiones cerradas. **No** describe el estado actual (ver [Discrepancias](#24-discrepancias-detectadas)). |
| [`DEMO.md`](DEMO.md) | Guion de la defensa: los diez casos de uso en el orden en que se demuestran, con tiempos y plan B por si algo falla en directo. |
| [`deploy/README.md`](deploy/README.md) | Puesta en producción paso a paso: instancia, Docker, Traefik, TLS y gestión de secretos. |
| [`generator/README.md`](generator/README.md) | Detalle de cómo el generador traduce el modelo UML a código Java. |

---

## 4. Resumen del proyecto

### 4.1 Problema

En un proyecto de software con base de datos, el modelo se diseña en una herramienta UML y
después **alguien lo traduce a mano** a entidades JPA, repositorios, servicios y controladores
REST. Ese paso manual es lento, propenso a errores y hace que el diagrama y el código diverjan en
cuanto el modelo cambia. Además, las herramientas de modelado tradicionales son de escritorio y de
un solo usuario: dos personas no pueden diseñar el mismo diagrama a la vez sin pisarse el trabajo.

### 4.2 Solución

Una plataforma web colaborativa donde el modelo de datos **vive estructurado en PostgreSQL**
(clases, atributos, métodos, relaciones como filas), no como un dibujo. El lienzo de React Flow es
únicamente su representación visual. Esa decisión es la que permite que cuatro entradas distintas
—diseño manual, asistente de IA, fotografía de un diagrama, importación XMI— escriban sobre la
misma fuente de verdad, y que desde ella se genere código Java compilable.

```mermaid
flowchart TD
    A[Diseño manual<br/>React Flow] --> M
    B[IA: texto y voz<br/>Groq] --> M
    C[Fotografía de un<br/>diagrama a mano] --> M
    D[Importación XMI<br/>Enterprise Architect] --> M
    M[(MODELO UML<br/>PostgreSQL — fuente de verdad)]
    M --> G[Generador Java<br/>JavaPoet]
    G --> S[Backend Spring Boot + JPA<br/>compilado y verificado]
    S --> P[Publicación en contenedor<br/>Docker + Traefik + TLS]
    P --> Q[URL pública + código QR]
    Q --> F[App móvil Flutter<br/>genérica, offline-first]
```

### 4.3 Alcance

**Incluido y verificado en el código:**

- Gestión de proyectos, miembros y roles (`OWNER` / `EDITOR` / `VIEWER`).
- Editor visual de diagramas de clases UML con seis tipos de relación y clave primaria implícita.
- Colaboración en tiempo real con presencia y bloqueo exclusivo por elemento (Socket.IO).
- Asistente de IA en la nube (Groq) para instrucciones de texto, dictado por voz y lectura de
  imágenes.
- Intercambio XMI 2.1 / UML 2.1 en ambos sentidos con Enterprise Architect.
- Generación de un backend Spring Boot 3.4 completo, con compilación real (Maven) y arranque de
  humo condicional.
- Descarga del proyecto generado en `.zip`.
- Publicación del backend generado en un contenedor propio, con base de datos dedicada, TLS
  automático y código QR de conexión.
- Aplicación móvil Flutter única, dirigida por el contrato `/api/_meta` del backend generado.
- Modo sin conexión con base local, cola ordenada de operaciones, traducción de identificadores y
  resolución manual de conflictos.
- Asistente por voz **en el dispositivo** (reconocimiento de voz on-device + modelo de lenguaje
  local Gemma 3 1B), con gramática determinista de respaldo.

**Explícitamente fuera de alcance** (decisiones cerradas, documentadas en `PLAN.md` §"Decisiones ya
tomadas"):

| Fuera de alcance | Motivo registrado |
|---|---|
| DTOs en el backend generado | Simplicidad: los controladores trabajan sobre las entidades JPA, con `@JsonIgnore` en los extremos inversos. |
| Autenticación en el backend generado | Responsabilidad de quien lo despliega; el generado es un CRUD abierto. |
| Yjs / CRDT para la colaboración | Se optó por difundir cambios ya persistidos vía Socket.IO y bloqueo por elemento. |
| Generador de código Flutter por diagrama | Hay **una sola** app genérica dirigida por `/api/_meta`. |
| IA local en el editor web | El backend corre en una instancia sin GPU; se acepta que sin conexión no hay asistente en el lienzo. |

### 4.4 Objetivos

**Objetivo general.** Permitir que un equipo diseñe colaborativamente un modelo de datos mediante
diagramas de clases UML y obtenga, sin escribir código a mano, un backend REST funcional y
publicado, más una aplicación móvil capaz de consumirlo con o sin conexión.

**Objetivos específicos:**

| # | Objetivo | CU |
|---|---|---|
| 1 | Gestionar proyectos de diseño y sus colaboradores. | CU01 |
| 2 | Editar diagramas de clases UML de forma visual. | CU02 |
| 3 | Permitir edición simultánea sin conflictos destructivos. | CU03 |
| 4 | Asistir el modelado con lenguaje natural (texto y voz). | CU04 |
| 5 | Reconstruir un modelo a partir de la fotografía de un diagrama. | CU05 |
| 6 | Interoperar con Enterprise Architect mediante XMI. | CU06 |
| 7 | Generar, compilar, verificar y descargar un backend Spring Boot. | CU07 |
| 8 | Publicar ese backend en una URL pública accesible. | CU08 |
| 9 | Consumir cualquier backend publicado desde una app móvil genérica. | CU09 |
| 10 | Operar sin conexión y sincronizar con resolución de conflictos. | CU10 |

---

## 5. Marco teórico resumido

| Concepto | Qué es | Cómo se materializa en este proyecto |
|---|---|---|
| **UML** (Unified Modeling Language) | Lenguaje de modelado estándar de la OMG. Este proyecto usa el **diagrama de clases** como artefacto central. | Clases, atributos, métodos, parámetros y seis tipos de relación (asociación, agregación, composición, herencia, realización, dependencia) persistidos en tablas relacionales. Ver [`database/db.sql`](database/db.sql) §4. |
| **PUDS** (Proceso Unificado de Desarrollo de Software) | Proceso iterativo e incremental, dirigido por casos de uso y centrado en la arquitectura. | Los diez casos de uso CU01–CU10 son la unidad de planificación, implementación y demostración del proyecto; cada uno se cierra antes de pasar al siguiente. Ver [§9](#9-modelo-uml-y-puds). |
| **MDE / MDA** (Model-Driven Engineering) | El modelo es el artefacto primario; el código se deriva de él por transformación. | El modelo UML en PostgreSQL es la fuente de verdad; `generator/` es la transformación M2T (modelo a texto) que produce Java con JavaPoet. Ver [§12](#12-generación-de-backend). |
| **Herramienta CASE** | Software que asiste las fases de análisis, diseño e implementación. | Esta plataforma cubre diseño (CU02), asistencia (CU04, CU05), intercambio (CU06) y construcción (CU07, CU08). |
| **IA generativa aplicada a modelado** | Uso de LLM para proponer artefactos de diseño a partir de lenguaje natural o imágenes. | Groq con tres modelos separados (texto, visión, audio). Principio rector: **el modelo propone y el código valida** — nada se aplica sin pasar por el validador y sin confirmación del usuario. Ver [§14](#14-inteligencia-artificial). |
| **XMI** (XML Metadata Interchange) | Estándar OMG de serialización de modelos UML para intercambio entre herramientas. | XMI 2.1 sobre UML 2.1, con identificadores en formato `EAID_<UUID>` para que Enterprise Architect reconozca los elementos en el viaje de vuelta. Ver [§15](#15-interoperabilidad-xmi). |
| **Colaboración en tiempo real** | Edición concurrente de un mismo artefacto. Dos familias: CRDT/OT (fusión automática) y bloqueo (exclusión mutua). | Se eligió **bloqueo por elemento + difusión de cambios ya persistidos**, no CRDT. Ver [§11.2](#112-websocket--socketio). |
| **Offline-first** | La aplicación funciona sin red como estado normal, no como excepción; la red es una optimización. | Base local Drift/SQLite, cola de operaciones pendientes, tabla de traducción de identificadores y sincronización disparada por conectividad. Ver [§13](#13-aplicación-móvil). |
| **Concurrencia optimista** | Se permite el acceso concurrente y se detecta el conflicto al escribir, mediante versionado de filas. | El backend **generado** incluye `@Version` en cada entidad; una escritura sobre una versión vieja responde **409**, que es la señal que dispara la pantalla de conflictos del móvil. |

---

## 6. Arquitectura general

### 6.1 Diagrama de componentes

```mermaid
flowchart TB
    subgraph CLIENTES
        WEB["Editor web<br/>React 19 + React Flow<br/>frontend/"]
        MOV["App móvil<br/>Flutter + Drift<br/>mobile/"]
    end

    subgraph HERRAMIENTA["Herramienta CASE (backend/)"]
        API["API REST NestJS 12<br/>auth · projects · diagrams · ai · xmi · codegen · deployments"]
        WS["Gateway Socket.IO<br/>namespace /collaboration"]
    end

    subgraph DATOS
        SUPA[("PostgreSQL — Supabase<br/>modelo UML + auditoría<br/>database/db.sql")]
        PGDEP[("PostgreSQL — contenedor<br/>una base por backend publicado")]
    end

    subgraph GENERACION
        GEN["Generador Java 21<br/>JavaPoet · generator/"]
        SB["Backend generado<br/>Spring Boot 3.4 + JPA"]
    end

    subgraph EXTERNOS
        GROQ["Groq API<br/>texto · visión · audio"]
        EA["Enterprise Architect<br/>XMI 2.1"]
        TRAEFIK["Traefik v3<br/>TLS · enrutado"]
    end

    WEB -- "REST /api" --> API
    WEB -- "WebSocket" --> WS
    API <--> SUPA
    WS --> SUPA
    API -- "HTTPS" --> GROQ
    API -- "importar / exportar" --> EA
    API -- "java -jar (subproceso)" --> GEN
    GEN -- "escribe proyecto" --> SB
    API -- "docker build/run/exec<br/>(socket de Docker)" --> SB
    SB <--> PGDEP
    TRAEFIK --> API
    TRAEFIK --> WEB
    TRAEFIK --> SB
    MOV -- "REST + /api/_meta" --> SB
```

### 6.2 Arquitectura cliente-servidor

Hay **dos relaciones cliente-servidor distintas**, y no deben confundirse:

| Cliente | Servidor | Protocolo | Autenticación |
|---|---|---|---|
| Editor web (`frontend/`) | Herramienta CASE (`backend/`) | REST + WebSocket | JWT propio (`Authorization: Bearer`) y token en el *handshake* del socket |
| App móvil (`mobile/`) | **Backend generado** (`generator/` → contenedor) | REST puro | Ninguna — el backend generado no lleva autenticación (fuera de alcance) |

La app móvil **no habla nunca** con la herramienta CASE ni con su base de datos: sólo con el
backend publicado, y se configura leyendo el `/api/_meta` de éste.

### 6.3 Arquitectura en capas

```mermaid
flowchart TB
    subgraph L1["Capa de presentación"]
        P1["React 19 · React Flow · Tailwind 4<br/>frontend/src/features/"]
        P2["Flutter widgets · formularios dinámicos<br/>mobile/lib/features/"]
    end
    subgraph L2["Capa de aplicación / estado"]
        A1["Zustand: auth.ts, diagram.ts<br/>frontend/src/store/"]
        A2["Riverpod + SyncController<br/>mobile/lib/offline/"]
    end
    subgraph L3["Capa de comunicación"]
        C1["Cliente REST · frontend/src/api/"]
        C2["Cliente Socket.IO · frontend/src/realtime/"]
        C3["dio + BackendClient · mobile/lib/api/"]
    end
    subgraph L4["Capa de servicios (backend NestJS)"]
        S1["Controllers: rutas y validación de entrada"]
        S2["Services: reglas de negocio, validación del modelo"]
        S3["Gateway: presencia, bloqueos, difusión"]
    end
    subgraph L5["Capa de persistencia"]
        D1["Prisma 8 (contract) · src/prisma/db.ts"]
        D2["PostgreSQL / Supabase"]
        D3["Drift/SQLite local (móvil)"]
    end
    subgraph L6["Capa de transformación"]
        T1["Generador Java · JavaPoet"]
        T2["Orquestación Docker · deployments.service.ts"]
    end

    L1 --> L2 --> L3 --> L4 --> L5
    L4 --> L6
```

### 6.4 Separación entre backend de la herramienta y backend generado

Es la distinción arquitectónica más importante del proyecto:

| | **Backend de la herramienta** | **Backend generado** |
|---|---|---|
| Ubicación | [`backend/`](backend) | Producido por [`generator/`](generator) en tiempo de ejecución |
| Tecnología | NestJS 12 + TypeScript + Prisma 8 | Spring Boot 3.4 + Java 21 + JPA/Hibernate |
| Base de datos | PostgreSQL en Supabase (esquema fijo, [`database/db.sql`](database/db.sql)) | PostgreSQL en contenedor, **una base por despliegue**, tablas creadas por Hibernate (`ddl-auto=update`) |
| Qué modela | Diagramas, clases, atributos, relaciones, usuarios, trabajos | El dominio que el usuario dibujó (CLIENTE, NOTAVENTA, …) |
| Quién lo consume | El editor web | La app móvil, vía `/api/_meta` |
| Autenticación | JWT propio | Ninguna |
| Se escribe a mano | Sí | **No**: ni una línea de Java se escribe a mano |

---

## 7. Stack tecnológico real

> Versiones tomadas de [`backend/package.json`](backend/package.json),
> [`frontend/package.json`](frontend/package.json), [`generator/pom.xml`](generator/pom.xml) y
> [`mobile/pubspec.yaml`](mobile/pubspec.yaml).

### 7.1 Frontend web — [`frontend/`](frontend)

| Dependencia | Versión | Para qué se usa |
|---|---|---|
| `react` / `react-dom` | ^19.2.8 | Interfaz completa del editor. |
| `typescript` | ~6.0.2 | Tipado estático. |
| `@xyflow/react` (React Flow) | ^12.11.6 | Lienzo del diagrama: nodos `umlClass` y aristas `uml` personalizados. |
| `zustand` | ^5.0.15 | Estado global: `store/auth.ts` y `store/diagram.ts`. |
| `react-router-dom` | ^7.18.4 | Rutas: login, registro, proyectos, editor. |
| `socket.io-client` | ^4.8.3 | Colaboración en tiempo real (CU03). |
| `tailwindcss` + `@tailwindcss/vite` | ^4.3.3 | Estilos. No se usa ninguna librería de componentes: el kit de UI está escrito en `src/components/ui/`. |
| `qrcode` | ^1.5.4 | QR de la URL de publicación (CU08). |
| `vite` | ^8.3.0 | Build y servidor de desarrollo (puerto por defecto **5173**). |
| `eslint` + `typescript-eslint` | ^10.10.0 / ^8.69.0 | Análisis estático. |

### 7.2 Backend de la herramienta — [`backend/`](backend)

| Dependencia | Versión | Para qué se usa |
|---|---|---|
| `@nestjs/common` / `core` | ^12.0.1 | Módulos, controladores, servicios, guardas. |
| `@nestjs/jwt` | ^12.0.2 | Emisión y verificación del JWT propio. |
| `@nestjs/platform-socket.io` / `websockets` | ^12.0.3 | Gateway de colaboración. |
| `socket.io` | ^4.8.3 | Servidor WebSocket, namespace `/collaboration`. |
| `@prisma/orm-postgres` + `prisma` | ^8.0.0-rc.11 / ^8.0.0-rc.15 | ORM con el **flujo de contrato** de Prisma 8 (ver [§10.3](#103-esquema-prisma-8--postgresql)). |
| `bcryptjs` | ^3.0.3 | Hash de contraseñas (10 rondas). |
| `fast-xml-parser` | ^5.11.1 | Generación y parseo de XMI (CU06). |
| `archiver` | ^8.0.0 | Empaquetado `.zip` del backend generado (CU07). |
| `rxjs` | ^7.8.1 | Flujo `changes$` que conecta los servicios REST con el gateway. |
| `vitest` + `supertest` | ^4.1.2 / ^7.0.0 | Pruebas unitarias y e2e. |
| `oxlint` | ^1.58.0 | Linter (`npm run lint`). |

> **Nota:** el cliente de Groq **no usa SDK**. `src/ai/groq.service.ts` llama por `fetch` directo a
> la API compatible con OpenAI de Groq. No hay dependencia `groq-sdk` ni `openai` en el
> `package.json`.

### 7.3 Generador de backend — [`generator/`](generator)

| Elemento | Valor |
|---|---|
| Lenguaje | Java 21 |
| Build | Maven (`spring-boot-maven-plugin`, `finalName=generator`) |
| Padre | `spring-boot-starter-parent` 3.4.1 |
| Dependencia clave | **JavaPoet 1.13.0** — construcción programática del código Java |
| Otras | `spring-boot-starter`, `spring-boot-starter-json` (Jackson), `spring-boot-starter-test` |
| Forma de ejecución | Aplicación de consola (`web-application-type=none`) invocada como `java -jar generator.jar modelo.json <carpeta-salida> informe.json` |
| Artefacto | `generator/target/generator.jar` (15,6 MB) |

**Tecnologías del proyecto que produce:** Spring Boot 3.4, Spring Data JPA, Bean Validation,
Spring Boot Actuator, PostgreSQL, Maven, Docker (multi-stage: `maven:3.9-eclipse-temurin-21` →
`eclipse-temurin:21-jre`).

### 7.4 Aplicación móvil — [`mobile/`](mobile)

| Dependencia | Versión | Para qué se usa |
|---|---|---|
| Flutter SDK | ^3.13.3 (Dart) | Framework de la app. |
| `dio` | ^5.7.0 | Cliente HTTP genérico contra el backend generado. |
| `flutter_riverpod` | ^2.6.1 | Estado: `app_state.dart`, `sync_controller.dart`. |
| `mobile_scanner` | ^5.2.3 | Escaneo del QR de publicación. |
| `shared_preferences` | ^2.3.3 | Recordar el último backend conectado. |
| `drift` + `sqlite3_flutter_libs` + `path_provider` | ^2.21.0 / ^0.5.26 / ^2.1.5 | Base local del modo offline (CU10). |
| `connectivity_plus` | ^6.1.0 | Detección de red para disparar la sincronización. |
| `sherpa_onnx` | ^1.13.8 | Dictado sin red: Moonshine base en español y detector de voz Silero, con el modelo **dentro del APK** (`assets/voz`, ~66 MB). |
| `record` | ^7.1.1 | Micrófono en crudo (PCM 16 kHz) para el reconocedor de arriba. |
| `flutter_gemma` | ^0.9.0 | Modelo **Gemma 3 1B** local; se descarga en el primer uso, no va dentro del APK. |
| `drift_dev` + `build_runner` | ^2.21.0 / ^2.4.13 | Generación de `database.g.dart`. |

### 7.5 IA e interoperabilidad

| Capacidad | Proveedor / formato | Modelo o versión | Variable de entorno |
|---|---|---|---|
| Interpretación de texto (CU04) | Groq | `openai/gpt-oss-20b` | `GROQ_TEXT_MODEL` |
| Visión — imagen a modelo (CU05) | Groq | `qwen/qwen3.8-27b` | `GROQ_VISION_MODEL` |
| Transcripción de audio (CU04 por voz) | Groq | `whisper-large-v3-turbo` | `GROQ_AUDIO_MODEL` |
| IA local del móvil (CU09) | En el dispositivo | Gemma 3 1B (`flutter_gemma`) | — (descarga en primer uso) |
| Reconocimiento de voz del móvil | En el dispositivo (`sherpa_onnx`) | Moonshine base `es` cuantizado + Silero VAD, dentro del APK | — |
| Intercambio de modelos (CU06) | XMI **2.1** sobre UML **2.1** | Dialecto de Enterprise Architect, IDs `EAID_<UUID>` | — |

### 7.6 Infraestructura

| Elemento | Versión | Rol |
|---|---|---|
| Docker + Docker Compose | — | Empaquetado de la herramienta y de cada backend publicado. |
| Traefik | v3.3 | Proxy inverso, TLS automático (Let's Encrypt), enrutado por `Host` + `PathPrefix`. |
| PostgreSQL | 16 (contenedor) / Supabase (herramienta) | Persistencia. |
| Amazon EC2 | `c7i-flex.large` (2 vCPU, 4 GB) | Instancia de producción, `us-east-1`. |

---

## 8. Módulos funcionales

```mermaid
flowchart LR
    M1["MÓDULO I<br/>Diseño y colaboración<br/>CU01 · CU02 · CU03"]
    M2["MÓDULO II<br/>IA e interoperabilidad<br/>CU04 · CU05 · CU06"]
    M3["MÓDULO III<br/>Generación de software<br/>CU07 · CU08"]
    M4["MÓDULO IV<br/>Móvil, IA local y offline<br/>CU09 · CU10"]
    M1 --> M2 --> M3 --> M4
```

### Módulo I — Diseño de modelos de datos y colaboración

| Aspecto | Detalle |
|---|---|
| Casos de uso | CU01, CU02, CU03 |
| Código | [`backend/src/projects/`](backend/src/projects), [`backend/src/diagrams/`](backend/src/diagrams), [`backend/src/collaboration/`](backend/src/collaboration), [`frontend/src/features/editor/`](frontend/src/features/editor), [`frontend/src/realtime/`](frontend/src/realtime) |
| Qué resuelve | Proyectos y miembros; edición visual de clases, atributos, métodos, parámetros y relaciones; edición simultánea con presencia y bloqueo exclusivo. |
| Reglas propias | La clave primaria `id` es implícita y reservada; el modelo se valida (`diagram-validator.ts`) antes de exportar o generar. |
| Estado | **Implementado** |

### Módulo II — Inteligencia artificial e interoperabilidad

| Aspecto | Detalle |
|---|---|
| Casos de uso | CU04, CU05, CU06 |
| Código | [`backend/src/ai/`](backend/src/ai), [`backend/src/xmi/`](backend/src/xmi), [`frontend/src/features/editor/AiAssistant.tsx`](frontend/src/features/editor/AiAssistant.tsx), [`frontend/src/features/editor/ExportDialog.tsx`](frontend/src/features/editor/ExportDialog.tsx) |
| Qué resuelve | Instrucciones en lenguaje natural (escritas o dictadas); lectura de un diagrama fotografiado; importación y exportación XMI compatible con Enterprise Architect. |
| Reglas propias | *El modelo propone, el código valida*: todo lo que devuelve la IA pasa por el validador y por una confirmación explícita. Ni imágenes, ni audios, ni archivos XMI se persisten. |
| Estado | **Implementado** |

### Módulo III — Generación automática de software

| Aspecto | Detalle |
|---|---|
| Casos de uso | CU07, CU08 |
| Código | [`backend/src/codegen/`](backend/src/codegen), [`backend/src/deployments/`](backend/src/deployments), [`generator/src/main/java/com/casese/generator/`](generator/src/main/java/com/casese/generator), [`frontend/src/features/editor/GenerateBackendDialog.tsx`](frontend/src/features/editor/GenerateBackendDialog.tsx), [`frontend/src/features/editor/DeployDialog.tsx`](frontend/src/features/editor/DeployDialog.tsx) |
| Qué resuelve | Transformación modelo→código, compilación real con Maven, arranque de humo, empaquetado `.zip` y publicación en contenedor con URL pública y QR. |
| Reglas propias | Un despliegue activo por diagrama; tope `MAX_DEPLOYMENTS` (3 por defecto); el `CONTEXT_PATH` **no** se recorta en el proxy para que las rutas devueltas sean correctas. |
| Estado | **Implementado** |

### Módulo IV — Aplicación móvil, IA local y funcionamiento offline

| Aspecto | Detalle |
|---|---|
| Casos de uso | CU09, CU10 |
| Código | [`mobile/lib/api/`](mobile/lib/api), [`mobile/lib/features/`](mobile/lib/features), [`mobile/lib/offline/`](mobile/lib/offline), generador: [`MetaWriter.java`](generator/src/main/java/com/casese/generator/emit/MetaWriter.java) |
| Qué resuelve | Una sola app para cualquier backend generado; formularios construidos desde `_meta`; dictado e interpretación en el dispositivo; lectura y escritura sin red con sincronización posterior. |
| Reglas propias | La clave primaria nunca se pide en el formulario; sin fusión automática de conflictos; el modelo de lenguaje se descarga aparte, no viaja en el APK. |
| Estado | **Implementado** |

---

## 9. Modelo UML y PUDS

### 9.1 Actores

| ID | Actor | Descripción | Evidencia |
|---|---|---|---|
| **A01** | **Usuario** | Persona que se registra, gestiona proyectos, diseña diagramas, colabora, usa la IA, intercambia XMI, genera y publica backends. Se especializa en tres roles: `OWNER`, `EDITOR` y `VIEWER`. | [`backend/src/auth/`](backend/src/auth), tipo `project_role` en [`database/db.sql`](database/db.sql) |
| **A02** | **Usuario Móvil** | Persona que opera los datos de un backend publicado desde el teléfono, con o sin conexión. No necesita cuenta en la herramienta: el backend generado no tiene autenticación. | [`mobile/lib/`](mobile/lib) |

Actores de apoyo (sistemas externos, no humanos):

| Actor externo | Rol | Evidencia |
|---|---|---|
| Groq | Interpreta texto, lee imágenes y transcribe audio; **propone**, nunca aplica. | [`backend/src/ai/groq.service.ts`](backend/src/ai/groq.service.ts) |
| Enterprise Architect | Origen y destino de los archivos XMI. | [`backend/src/xmi/xmi-format.ts`](backend/src/xmi/xmi-format.ts) |
| Docker / Traefik | Ejecutan y exponen los backends publicados. | [`backend/src/deployments/deployments.service.ts`](backend/src/deployments/deployments.service.ts), [`deploy/docker-compose.yml`](deploy/docker-compose.yml) |

> **Sobre el rol `VIEWER`:** existe en el esquema y en el tipo enumerado, pero **no se verificó
> servicio por servicio** que todas las rutas de escritura lo rechacen. Marcado como
> [pendiente de verificación](#21-roadmap-pendientes-y-limitaciones).

### 9.2 Casos de uso CU01–CU10

> Las columnas **Ciclo**, **Prioridad** y **Riesgo** no se extraen del código: son una
> clasificación PUDS derivada del orden de fases de [`PLAN.md`](PLAN.md) y de su
> «Apéndice C — Riesgos que ya conocemos». Se marcan como *derivadas* para no presentarlas como
> dato del repositorio. Las columnas **Actor** y **Estado** sí están verificadas contra el código.

| ID | Nombre | Descripción | Actor | Ciclo *(derivado)* | Prioridad *(derivada)* | Riesgo *(derivado)* | Estado |
|---|---|---|---|---|---|---|---|
| **CU01** | Gestionar Proyecto de Diseño | Crear, editar y eliminar proyectos; invitar miembros y asignarles rol. | A01 | Elaboración | Alta | Bajo | ✅ Implementado |
| **CU02** | Diseñar Diagrama de Clases UML | Modelar clases, atributos, métodos, parámetros y relaciones sobre el lienzo, con `id` implícito. | A01 | Elaboración | Alta | Medio | ✅ Implementado |
| **CU03** | Colaborar en el Diseño del Diagrama | Edición simultánea con presencia, bloqueo exclusivo por elemento y difusión de cambios. | A01 (≥2) | Construcción I | Alta | Medio | ✅ Implementado |
| **CU04** | Asistir el Diseño mediante IA | Crear o modificar el modelo dictando o escribiendo una instrucción en lenguaje natural. | A01 + Groq | Construcción I | Alta | **Alto** — prompts frágiles y cuota por modelo | ✅ Implementado |
| **CU05** | Generar Diagrama desde Imagen | Convertir la fotografía de un diagrama a mano en un modelo editable. | A01 + Groq | Construcción I | Media | **Alto** — misma fragilidad de prompts | ✅ Implementado |
| **CU06** | Gestionar Intercambio de Diagramas mediante XMI | Exportar a XMI abrible en Enterprise Architect e importar XMI como diagrama nuevo. | A01 + EA | Construcción II | Media | Medio — dialecto real de EA | ✅ Implementado |
| **CU07** | Generar Backend desde el Diagrama UML | Producir, compilar, verificar y descargar un proyecto Spring Boot + JPA a partir del modelo. | A01 | Construcción II | **Crítica** | Medio | ✅ Implementado *(arranque de humo condicional a `SMOKE_DB_URL`)* |
| **CU08** | Publicar Backend Generado | Dejar el backend generado corriendo en una URL pública con TLS y QR de conexión. | A01 + Docker/Traefik | Construcción III | Alta | **Alto** — memoria de la instancia, socket de Docker | ✅ Implementado |
| **CU09** | Utilizar Aplicación Móvil | Consumir cualquier backend publicado desde una app genérica dirigida por `/api/_meta`, con asistente de voz local. | A02 | Construcción III | Alta | Medio — acierto del modelo de 1B | ✅ Implementado |
| **CU10** | Trabajar sin Conexión y Sincronizar Información | Operar sin red, encolar cambios, sincronizar en orden y resolver conflictos a mano. | A02 | Transición | Alta | **Alto** — orden y traducción de IDs | ✅ Implementado |

### 9.3 Paquetes

| Paquete | Casos de uso | Componentes del repositorio |
|---|---|---|
| **P1 · Gestión y Diseño** | CU01, CU02, CU03 | `backend/src/projects/`, `backend/src/diagrams/`, `backend/src/collaboration/`, `frontend/src/features/projects/`, `frontend/src/features/editor/`, `frontend/src/realtime/` |
| **P2 · Asistencia e Interoperabilidad** | CU04, CU05, CU06 | `backend/src/ai/`, `backend/src/xmi/`, `frontend/src/features/editor/AiAssistant.tsx`, `ExportDialog.tsx` |
| **P3 · Generación de Software** | CU07, CU08 | `backend/src/codegen/`, `backend/src/deployments/`, `generator/`, `GenerateBackendDialog.tsx`, `DeployDialog.tsx` |
| **P4 · Aplicación Móvil y Offline** | CU09, CU10 | `mobile/lib/api/`, `mobile/lib/features/`, `mobile/lib/offline/`, `generator/…/MetaWriter.java` |

#### Diagrama de paquetes

```mermaid
flowchart TB
    P1["P1 · Gestión y Diseño<br/>CU01 CU02 CU03"]
    P2["P2 · Asistencia e Interoperabilidad<br/>CU04 CU05 CU06"]
    P3["P3 · Generación de Software<br/>CU07 CU08"]
    P4["P4 · Aplicación Móvil y Offline<br/>CU09 CU10"]
    MODELO[("Modelo UML<br/>PostgreSQL")]

    P1 -->|escribe y lee| MODELO
    P2 -->|escribe y lee| MODELO
    P3 -->|lee| MODELO
    P3 -->|publica contrato /api/_meta| P4
    P2 -.->|reutiliza servicios de| P1
```

> **Dependencia clave:** P2 **no** escribe en la base por su cuenta — reutiliza los servicios de P1
> (`ClassesService`, `RelationshipsService`), de modo que la IA hereda gratis la validación, las
> cascadas, los bloqueos y la difusión por WebSocket.

### 9.4 Diagrama de casos de uso

```mermaid
flowchart LR
    A01(("A01<br/>Usuario"))
    A02(("A02<br/>Usuario Móvil"))
    GROQ(("Groq"))
    EA(("Enterprise<br/>Architect"))
    DOCKER(("Docker /<br/>Traefik"))

    subgraph P1["P1 · Gestión y Diseño"]
        CU01["CU01 Gestionar Proyecto de Diseño"]
        CU02["CU02 Diseñar Diagrama de Clases UML"]
        CU03["CU03 Colaborar en el Diseño del Diagrama"]
    end
    subgraph P2["P2 · Asistencia e Interoperabilidad"]
        CU04["CU04 Asistir el Diseño mediante IA"]
        CU05["CU05 Generar Diagrama desde Imagen"]
        CU06["CU06 Gestionar Intercambio mediante XMI"]
    end
    subgraph P3["P3 · Generación de Software"]
        CU07["CU07 Generar Backend desde el Diagrama UML"]
        CU08["CU08 Publicar Backend Generado"]
    end
    subgraph P4["P4 · Aplicación Móvil y Offline"]
        CU09["CU09 Utilizar Aplicación Móvil"]
        CU10["CU10 Trabajar sin Conexión y Sincronizar"]
    end

    A01 --- CU01
    A01 --- CU02
    A01 --- CU03
    A01 --- CU04
    A01 --- CU05
    A01 --- CU06
    A01 --- CU07
    A01 --- CU08
    A02 --- CU09
    A02 --- CU10

    CU04 -.->|usa| GROQ
    CU05 -.->|usa| GROQ
    CU06 -.->|intercambia con| EA
    CU08 -.->|usa| DOCKER
    CU02 -.->|«include»| CU01
    CU03 -.->|«extend»| CU02
    CU04 -.->|«include»| CU02
    CU05 -.->|«include»| CU02
    CU08 -.->|«include»| CU07
    CU10 -.->|«extend»| CU09
```

### 9.5 Diagrama de clases (dominio de la herramienta)

```mermaid
classDiagram
    class Users {
        +UUID id
        +String fullName
        +String email
        +String passwordHash
        +String avatarUrl
    }
    class Projects {
        +UUID id
        +String name
        +String description
        +UUID ownerId
    }
    class ProjectMembers {
        +UUID id
        +ProjectRole role
        +DateTime joinedAt
    }
    class Diagrams {
        +UUID id
        +String name
        +String description
        +UUID createdBy
    }
    class UmlClasses {
        +UUID id
        +String name
        +String stereotype
        +Boolean isAbstract
        +UmlVisibility visibility
        +Double posX
        +Double posY
        +Double width
        +Double height
    }
    class UmlAttributes {
        +UUID id
        +String name
        +String dataType
        +UmlVisibility visibility
        +Boolean isNullable
        +Boolean isUnique
        +String defaultValue
        +Integer orderIndex
    }
    class UmlMethods {
        +UUID id
        +String name
        +String returnType
        +UmlVisibility visibility
        +Integer orderIndex
    }
    class UmlMethodParameters {
        +UUID id
        +String name
        +String dataType
        +Integer orderIndex
    }
    class UmlRelationships {
        +UUID id
        +RelationshipType relationshipType
        +String sourceMultiplicity
        +String targetMultiplicity
        +String sourceRole
        +String targetRole
        +Boolean isNavigableSource
        +Boolean isNavigableTarget
    }
    class CodeGenerationJobs {
        +UUID id
        +CodegenStatus status
        +Boolean compileCheckPassed
        +Boolean smokeCheckPassed
        +String outputArtifactUrl
    }
    class BackendDeployments {
        +UUID id
        +DeploymentStatus status
        +String slug
        +String apiUrl
        +String containerName
        +String databaseName
    }

    Users "1" --> "0..*" Projects : posee
    Projects "1" --> "0..*" ProjectMembers
    Users "1" --> "0..*" ProjectMembers
    Projects "1" --> "0..*" Diagrams
    Diagrams "1" *-- "0..*" UmlClasses
    UmlClasses "1" *-- "0..*" UmlAttributes
    UmlClasses "1" *-- "0..*" UmlMethods
    UmlMethods "1" *-- "0..*" UmlMethodParameters
    Diagrams "1" *-- "0..*" UmlRelationships
    UmlRelationships "1" --> "1" UmlClasses : source
    UmlRelationships "1" --> "1" UmlClasses : target
    Diagrams "1" --> "0..*" CodeGenerationJobs
    Diagrams "1" --> "0..1" BackendDeployments
    CodeGenerationJobs "1" --> "0..1" BackendDeployments
```

> Se omiten del diagrama las tablas puramente de auditoría (`AiCommandLogs`, `PhotoImportJobs`,
> `XmiExchangeJobs`, `DiagramChangeLog`); se describen en [§10](#10-modelo-de-datos).

### 9.6 Diagramas de secuencia

#### CU03 — Colaboración: persistir primero, difundir después

```mermaid
sequenceDiagram
    actor U1 as Usuario A (A01)
    actor U2 as Usuario B (A01)
    participant FE as Editor web
    participant API as ClassesService (REST)
    participant DB as PostgreSQL
    participant EV as DiagramEventsService
    participant WS as Gateway /collaboration

    U1->>FE: selecciona la clase CLIENTE
    FE->>WS: lock:acquire(class, id)
    WS->>WS: LockRegistry (memoria)
    WS-->>U2: lock:changed(holder = Usuario A)
    U1->>FE: agrega atributo "telefono"
    FE->>API: POST /classes/:id/attributes
    API->>DB: INSERT uml_attributes
    DB-->>API: fila creada
    API->>EV: emite cambio
    EV->>WS: changes$
    WS-->>U2: diagram:changed(attribute.created)
    API-->>FE: 201 Created
    U1->>FE: deselecciona
    FE->>WS: lock:release
    WS-->>U2: lock:changed(holder = null)
```

#### CU04 — Asistencia por IA: el modelo propone, el código valida

```mermaid
sequenceDiagram
    actor U as Usuario (A01)
    participant FE as AiAssistant.tsx
    participant AI as AiService
    participant GQ as Groq
    participant EX as AiExecutorService
    participant CS as ClassesService
    participant DB as PostgreSQL

    U->>FE: dicta «agregá PRODUCTO con precio y stock»
    FE->>AI: POST /ai/voice (multipart)
    AI->>GQ: whisper-large-v3-turbo (transcribir)
    GQ-->>AI: texto transcrito
    AI->>GQ: openai/gpt-oss-20b (interpretar)
    GQ-->>AI: acciones UML propuestas (JSON)
    AI->>EX: normaliza (uml-actions.ts) y planifica
    EX->>EX: valida contra catálogo de tipos y estado real
    EX-->>FE: plan: aplicables + rechazadas con motivo
    U->>FE: confirma
    FE->>EX: apply (todo o nada)
    EX->>CS: usa los mismos servicios de CU02
    CS->>DB: INSERT/UPDATE
    CS-->>FE: difundido también por CU03
    AI->>DB: INSERT ai_command_logs (auditoría)
```

#### CU07 + CU08 — Generación y publicación

```mermaid
sequenceDiagram
    actor U as Usuario (A01)
    participant FE as GenerateBackendDialog / DeployDialog
    participant CG as CodegenService
    participant GEN as generator.jar (Java)
    participant MVN as Maven
    participant DEP as DeploymentsService
    participant DK as Docker
    participant TR as Traefik

    U->>FE: «Generar backend»
    FE->>CG: POST /diagrams/:id/backend
    CG->>CG: valida el diagrama
    CG->>CG: escribe modelo.json — estado GENERATING
    CG->>GEN: java -jar generator.jar modelo.json salida/
    GEN-->>CG: proyecto Spring Boot + informe.json
    CG->>MVN: mvn -B -q compile — estado COMPILING
    MVN-->>CG: compile_check_passed = true
    opt SMOKE_DB_URL configurada
        CG->>MVN: mvn package
        CG->>CG: levanta el jar, espera /actuator/health = UP
        CG->>CG: GET /api/_meta y primera entidad
        CG-->>CG: smoke_check_passed = true
    end
    CG-->>FE: SUCCESS (entidades, endpoints, archivos)
    U->>FE: «Descargar .zip»
    FE->>CG: GET /diagrams/:id/backend/download
    U->>FE: «Publicar»
    FE->>DEP: POST /diagrams/:id/deployment
    DEP->>DK: docker build -t case-tool/slug — BUILDING
    DEP->>DK: docker exec psql → CREATE DATABASE slug
    DEP->>DK: docker run (labels Traefik, CONTEXT_PATH) — STARTING
    DK->>TR: registra el router /d/slug
    DEP->>TR: espera /d/slug/actuator/health
    DEP-->>FE: RUNNING + api_url + QR
```

#### CU10 — Sincronización offline con traducción de identificadores

```mermaid
sequenceDiagram
    actor U as Usuario Móvil (A02)
    participant APP as App Flutter
    participant LOC as Drift / SQLite
    participant NET as connectivity_plus
    participant SB as Backend generado

    Note over U,SB: Modo avión
    U->>APP: crea CLIENTE «Pedro»
    APP->>LOC: cached_records (dirty) + pending_operations(CREATE)
    APP->>LOC: asigna local_id temporal
    U->>APP: crea NOTAVENTA ligada a «Pedro»
    APP->>LOC: pending_operations(CREATE, ref = local_id)
    Note over U,SB: Vuelve la red
    NET-->>APP: online
    APP->>SB: POST /api/clientes (op 1)
    SB-->>APP: 201 { id: 42 }
    APP->>LOC: id_map(local_id → 42)
    APP->>SB: POST /api/notaventas (cliente_id = 42)
    SB-->>APP: 201
    APP->>LOC: marca operaciones como DONE
    Note over U,SB: Caso de conflicto
    APP->>SB: PUT /api/clientes/7 (version vieja)
    SB-->>APP: 409 Conflict (@Version)
    APP->>LOC: marca el registro conflicted + serverJson
    U->>APP: elige «la mía» o «la del servidor»
```

### 9.7 Diagrama de despliegue

```mermaid
flowchart TB
    subgraph DEV["Dispositivos de usuario"]
        NAV["Navegador<br/>(editor web)"]
        TEL["Teléfono Android<br/>(app Flutter + Gemma 3 1B)"]
    end

    subgraph EC2["EC2 c7i-flex.large · us-east-1 · Amazon Linux 2023"]
        direction TB
        TR["traefik:v3.3<br/>:80 · :443 · Let's Encrypt"]
        WEBC["case-tool/web<br/>estáticos Vite + nginx"]
        APIC["case-tool/api<br/>NestJS :3000<br/>monta /var/run/docker.sock"]
        PG[("postgres:16<br/>case-tool-postgres<br/>una base por despliegue")]
        D1["case-backend-slug1<br/>Spring Boot :8080"]
        D2["case-backend-slug2<br/>Spring Boot :8080"]
        VOL[("volúmenes<br/>traefik-certs · postgres-data<br/>generated · maven-cache")]
    end

    SUPA[("Supabase<br/>PostgreSQL de la herramienta")]
    GROQ["Groq API"]

    NAV -->|HTTPS| TR
    TEL -->|HTTPS /d/slug| TR
    TR --> WEBC
    TR --> APIC
    TR --> D1
    TR --> D2
    APIC --> SUPA
    APIC --> GROQ
    APIC -.->|docker build/run/exec| D1
    APIC -.-> D2
    D1 --> PG
    D2 --> PG
    APIC --- VOL
```

**Reparto del dominio** (`deploy/README.md`):

| Ruta | Quién responde |
|---|---|
| `https://<dominio>/` | Editor React (`case-tool/web`) |
| `https://<dominio>/api/...` | Backend NestJS — Traefik le quita el prefijo `/api` |
| `https://<dominio>/d/<slug>/...` | Un backend generado y publicado — el prefijo **no** se recorta |

### 9.8 Matriz de trazabilidad

> CU → clases/servicios → endpoints → tablas → componentes.

| CU | Clases y servicios principales | Endpoints / eventos | Tablas | Componente |
|---|---|---|---|---|
| **CU01** | `ProjectsService`, `ProjectsController`, `AuthService`, `AuthGuard` | `POST/GET/PATCH/DELETE /projects`, `/projects/:id/members`, `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | `users`, `projects`, `project_members` | `backend/src/projects/`, `backend/src/auth/`, `frontend/src/features/projects/` |
| **CU02** | `DiagramsService`, `ClassesService`, `RelationshipsService`, `diagram-validator.ts`, `uml-catalog.ts` | `POST/GET/PATCH/DELETE /diagrams/:id`, `/classes`, `/attributes`, `/methods`, `/parameters`, `/relationships`, `POST /diagrams/:id/association-classes`, `GET /diagrams/:id/validation` | `diagrams`, `uml_classes`, `uml_attributes`, `uml_methods`, `uml_method_parameters`, `uml_relationships`, `diagram_change_log` | `backend/src/diagrams/`, `frontend/src/features/editor/` |
| **CU03** | `CollaborationGateway`, `LockRegistryService`, `DiagramEventsService`, `useCollaboration.ts` | WS `/collaboration`: `diagram:join`, `diagram:leave`, `presence:state`, `lock:acquire`, `lock:release`, `lock:changed`, `diagram:changed` | *(ninguna propia — presencia y bloqueos en memoria)* | `backend/src/collaboration/`, `frontend/src/realtime/` |
| **CU04** | `AiService`, `GroqService`, `AiExecutorService`, `uml-actions.ts`, `prompts.ts`, `layout.ts` | `POST /ai/interpret`, `POST /ai/voice` | `ai_command_logs` (+ escribe en las del modelo vía CU02) | `backend/src/ai/`, `AiAssistant.tsx` |
| **CU05** | `AiService`, `GroqService` (visión), `AiExecutorService` | `POST /ai/image-to-uml` | `photo_import_jobs` (+ las del modelo) | `backend/src/ai/`, `AiAssistant.tsx` |
| **CU06** | `XmiService`, `xmi-generator.ts`, `xmi-parser.ts`, `xmi-format.ts` | `GET /diagrams/:id/xmi`, `POST /projects/:projectId/diagrams/import-xmi` | `xmi_exchange_jobs` (+ las del modelo) | `backend/src/xmi/`, `ExportDialog.tsx`, `ProjectDetail.tsx` |
| **CU07** | `CodegenService`, `ProjectGenerator`, `EntityWriter`, `CrudWriter`, `MetaWriter`, `SupportWriter`, `ResourceWriter`, `Blueprint`, `EntityPlan` | `POST/GET /diagrams/:id/backend`, `GET /diagrams/:id/backend/download` | `code_generation_jobs` | `backend/src/codegen/`, `generator/`, `GenerateBackendDialog.tsx` |
| **CU08** | `DeploymentsService`, `DeploymentsController` | `POST/GET/DELETE /diagrams/:id/deployment`, `GET /diagrams/:id/deployment/logs` | `backend_deployments` | `backend/src/deployments/`, `DeployDialog.tsx`, `deploy/docker-compose.yml` |
| **CU09** | `BackendClient`, `ModelMeta`, `EntityMeta`, `FieldMeta`, `RecordForm`, `SpeechService`, `LocalModel`, `GrammarInterpreter`, `OperationValidator` | Consumidos: `GET /api/_meta`, CRUD de cada entidad del backend generado | *(las del backend generado)* | `mobile/lib/api/`, `mobile/lib/features/` |
| **CU10** | `LocalDatabase`, `OfflineRepository`, `SyncController`, `ConflictsScreen` | Reenvío de las mismas rutas CRUD; conflicto por `409` | `cached_records`, `pending_operations`, `id_map` *(locales del teléfono)* | `mobile/lib/offline/`, `mobile/lib/features/conflicts/` |

### 9.9 Flujos de trabajo PUDS

#### Captura de requisitos

| Artefacto | Dónde está |
|---|---|
| Modelo de casos de uso (CU01–CU10) | [§9.2](#92-casos-de-uso-cu01cu10) de este documento |
| Actores A01 y A02 | [§9.1](#91-actores) |
| Glosario de dominio | El vocabulario está fijado en el propio producto: *entidad* = clase = futura tabla; *atributo* = columna; la clave primaria `id` es implícita. Ver [`backend/src/diagrams/uml-catalog.ts`](backend/src/diagrams/uml-catalog.ts) |
| Guion de aceptación | [`DEMO.md`](DEMO.md) — funciona como escenario de aceptación ejecutable ante el docente |
| Requisitos no funcionales | Seguridad (JWT, bcrypt), no persistencia de contenido sensible (imágenes, audios, XMI), disponibilidad con TLS, límite de memoria (`MAX_DEPLOYMENTS`) |

#### Análisis

| Artefacto | Dónde está |
|---|---|
| Clases de análisis | Las entidades del dominio de la herramienta: `Users`, `Projects`, `Diagrams`, `UmlClasses`, `UmlAttributes`, `UmlMethods`, `UmlMethodParameters`, `UmlRelationships` |
| Paquetes de análisis | P1–P4, ver [§9.3](#93-paquetes) |
| Realización de casos de uso | Los diagramas de secuencia de [§9.6](#96-diagramas-de-secuencia) |
| Reglas de negocio identificadas | `id` implícito y reservado; un despliegue por diagrama; la IA propone y el código valida; sin fusión automática de conflictos |

#### Diseño

| Artefacto | Dónde está |
|---|---|
| Arquitectura en capas | [§6.3](#63-arquitectura-en-capas) |
| Diagrama de componentes | [§6.1](#61-diagrama-de-componentes) |
| Diagrama de despliegue | [§9.7](#97-diagrama-de-despliegue) |
| Modelo de datos de diseño | [`database/db.sql`](database/db.sql) y [`backend/src/prisma/contract.prisma`](backend/src/prisma/contract.prisma) |
| Decisiones arquitectónicas registradas | [`PLAN.md`](PLAN.md) §«Decisiones ya tomadas»: sin CRDT, sin DTOs, sin generador Flutter, IA única en la nube para el servidor y local para el móvil |
| Contrato de integración | `GET /api/_meta` del backend generado — es lo que desacopla P3 de P4 |

#### Implementación

| Artefacto | Dónde está |
|---|---|
| Componentes ejecutables | `backend/dist/`, `frontend/dist/`, `generator/target/generator.jar`, imágenes `case-tool/api` y `case-tool/web` |
| Subsistemas de implementación | Las carpetas de primer nivel: `backend/`, `frontend/`, `generator/`, `mobile/`, `deploy/` |
| Modelo de despliegue | [`deploy/docker-compose.yml`](deploy/docker-compose.yml) |
| Pruebas | [§19](#19-pruebas) — 47 pruebas del backend en verde |
| Integración continua | ❌ **No implementado** — no existe `.github/workflows/` ni equivalente |

---

## 10. Modelo de datos

### 10.1 Regla del `id` implícito

Es la regla que atraviesa todo el proyecto:

> **Toda entidad tiene una clave primaria `id` de tipo `Long` autogenerada. La pone la herramienta
> y nadie la declara como atributo.** El nombre `id` está reservado en el editor, en la API, en las
> importaciones (XMI e imagen) y en el generador.

Consecuencias verificables en el código:

- `uml_attributes.is_primary_key` **existe pero está en desuso**: la aplicación no la lee ni la
  escribe. Se conserva para no tocar filas ya guardadas
  ([`database/db.sql`](database/db.sql) §4).
- El generador la emite siempre: `EntityPlan.ID_NAME` / `ID_TYPE` en
  [`EntityWriter.java`](generator/src/main/java/com/casese/generator/emit/EntityWriter.java).
- El formulario del móvil **nunca pide** la clave primaria
  ([`mobile/lib/features/entities/record_form.dart`](mobile/lib/features/entities/record_form.dart)).

### 10.2 Entidades, atributos y relaciones

| Tabla | Propósito | Cascadas y restricciones |
|---|---|---|
| `users` | Cuentas: nombre, email único, hash bcrypt, avatar. | `email UNIQUE` |
| `projects` | Proyecto de diseño con su dueño. | `owner_id → users ON DELETE CASCADE` |
| `project_members` | Usuario ↔ proyecto con rol. | `UNIQUE(project_id, user_id)`; ambas FK `ON DELETE CASCADE` |
| `diagrams` | Diagrama dentro de un proyecto. **Sólo metadatos**: el modelo vive en las tablas siguientes. | `project_id → projects ON DELETE CASCADE` |
| `uml_classes` | Entidad del diagrama: nombre, estereotipo, abstracción, visibilidad, posición y tamaño en el lienzo. | `UNIQUE(diagram_id, name)`; `ON DELETE CASCADE`. `width`/`height` `NULL` = tamaño automático |
| `uml_attributes` | Columna futura: tipo (**anulable**, para cuando aún no se decide o viene de una imagen), nulabilidad, unicidad, valor por defecto, orden. | `UNIQUE(class_id, name)`; `ON DELETE CASCADE` |
| `uml_methods` | Operación de la clase: tipo de retorno, visibilidad, orden. | `ON DELETE CASCADE`. `return_type VARCHAR(150)` porque puede ser una clase del diagrama |
| `uml_method_parameters` | Parámetros de un método con su tipo. | `UNIQUE(method_id, name)`; `ON DELETE CASCADE` |
| `uml_relationships` | Relación entre dos clases: tipo, multiplicidades, roles, navegabilidad por extremo. | Tres FK `ON DELETE CASCADE` (diagrama, origen, destino) |
| `ai_command_logs` | Auditoría CU04: entrada cruda, transcripción, operación resuelta, payload, estado (`SUCCESS`/`FAILED`/`REJECTED`). | `ON DELETE CASCADE` sobre el diagrama |
| `photo_import_jobs` | Auditoría CU05: nombre de archivo, MIME, tamaño y modelo extraído. **Nunca la imagen.** | `diagram_id … ON DELETE SET NULL` |
| `xmi_exchange_jobs` | Auditoría CU06: dirección (`IMPORT`/`EXPORT`), nombre de archivo, estado. **Nunca el archivo.** | `ON DELETE CASCADE` |
| `code_generation_jobs` | CU07: estado, `compile_check_passed`, `smoke_check_passed` (`NULL` = no se llegó a comprobar), URL del artefacto. | `ON DELETE CASCADE` |
| `backend_deployments` | CU08: estado, slug, URL pública, contenedor y base asociados. | **`UNIQUE(diagram_id)`** — un despliegue por diagrama; `job_id … ON DELETE SET NULL` |
| `diagram_change_log` | Bitácora de auditoría de cada cambio del modelo (quién, operación, tipo de entidad, payload). | `ON DELETE CASCADE`; escrita desde `diagrams.service.ts` |

**Tipos enumerados** (`database/db.sql` §Tipos):

| Enum | Valores |
|---|---|
| `project_role` | `OWNER`, `EDITOR`, `VIEWER` |
| `relationship_type` | `ASSOCIATION`, `AGGREGATION`, `COMPOSITION`, `INHERITANCE`, `REALIZATION`, `DEPENDENCY` |
| `uml_visibility` | `public`, `private`, `protected`, `package` *(en minúsculas: son las palabras del Java generado)* |
| `ai_input_type` | `VOICE`, `TEXT` |
| `job_status` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `codegen_status` | `PENDING`, `GENERATING`, `COMPILING`, `SUCCESS`, `FAILED` |
| `deployment_status` | `PENDING`, `BUILDING`, `STARTING`, `RUNNING`, `FAILED`, `STOPPED` |
| `xmi_direction` | `IMPORT`, `EXPORT` |
| `diagram_entity_type` | `CLASS`, `ATTRIBUTE`, `METHOD`, `RELATIONSHIP`, `DIAGRAM` |

**Triggers:** función genérica `set_updated_at()` aplicada a `users`, `projects`, `diagrams`,
`uml_classes`, `uml_attributes` y `uml_relationships`.

### 10.3 Esquema Prisma 8 / PostgreSQL

> ⚠️ **No existe `prisma/schema.prisma`.** Este proyecto usa la estructura nueva de **Prisma 8**,
> basada en un *contrato*. Ver [Discrepancias](#24-discrepancias-detectadas).

| Archivo | Rol |
|---|---|
| [`backend/prisma.config.ts`](backend/prisma.config.ts) | Configuración: apunta a `./src/prisma/contract.prisma` y a `DATABASE_URL` |
| [`backend/src/prisma/contract.prisma`](backend/src/prisma/contract.prisma) | El contrato — 14 modelos, con `@@rls` y `@map` a las columnas snake_case |
| `backend/src/prisma/contract.json` | Contrato emitido que consume el motor |
| `backend/src/prisma/contract.d.ts` | Tipos generados — **es lo que hay que leer antes de escribir consultas nuevas** |
| `backend/src/prisma/db.ts` | Instancia usada en los servicios: `db.orm.public.<Modelo>` |
| `backend/migrations/` | `app/refs/db.json` + `snapshots/` (historial de migraciones de Prisma 8) |

Los 14 modelos del contrato corresponden **1:1** con las 14 tablas de `database/db.sql`
(PascalCase en Prisma, snake_case en PostgreSQL): `Users`, `Projects`, `ProjectMembers`,
`Diagrams`, `UmlClasses`, `UmlAttributes`, `UmlMethods`, `UmlMethodParameters`,
`UmlRelationships`, `AiCommandLogs`, `PhotoImportJobs`, `XmiExchangeJobs`, `CodeGenerationJobs`,
`BackendDeployments`, `DiagramChangeLog`.

**Procedimiento para cambiar el esquema** (el orden importa: `db update` compara la base contra el
contrato **emitido**, no contra el `.prisma`):

```bash
# 1. editar backend/src/prisma/contract.prisma
npx prisma contract emit
npx prisma db update --dry-run     # leer el plan antes de aplicarlo
npx prisma db update               # lo destructivo pide confirmación
# 4. reflejar el cambio en database/db.sql
```

### 10.4 Mapeo UML → tablas → Java generado

| Concepto UML | Tabla de la herramienta | Java generado |
|---|---|---|
| Clase / entidad | `uml_classes` | `@Entity class X` + tabla física por Hibernate |
| *(implícito)* | — | `@Id @GeneratedValue Long id` |
| *(implícito)* | — | `@Version Long version` |
| Atributo | `uml_attributes` | Campo con `@Column`, `@NotNull` si no admite nulos, `@Size(max=…)` en `String` |
| Método | `uml_methods` + `uml_method_parameters` | Se emite en interfaces y clases de soporte (`SupportWriter`) |
| Herencia | `uml_relationships` (`INHERITANCE`) | `extends` + `@Inheritance` (el `@Id` y el `@Version` sólo en la raíz) |
| Asociación 1..* | `uml_relationships` (`ASSOCIATION`) | `@ManyToOne` + `@JoinColumn` en el propietario; `@OneToMany(mappedBy)` + `@JsonIgnore` en el inverso |
| Agregación / composición | `uml_relationships` | Igual que la asociación, con la semántica reflejada en el informe |
| Multiplicidad | `source_multiplicity` / `target_multiplicity` | Determina la cardinalidad JPA elegida |
| Clase asociativa (N:M con atributos) | Clase + dos relaciones, vía `POST /diagrams/:id/association-classes` | Entidad intermedia con dos `@ManyToOne` |

---

## 11. API de la herramienta

**Base URL local:** `http://localhost:3000` — **en producción:** `https://<dominio>/api`
(Traefik retira el prefijo `/api` antes de entregar la petición al backend).

**Autenticación:** JWT propio en `Authorization: Bearer <token>`. Todos los endpoints exigen token
(`AuthGuard`) **salvo** `POST /auth/register` y `POST /auth/login`.

**CORS** ([`backend/src/main.ts`](backend/src/main.ts)): orígenes desde `CORS_ORIGINS`, métodos
`GET, POST, PATCH, DELETE, OPTIONS`, cabeceras `Content-Type` y `Authorization`,
`credentials: true`.

### 11.1 Endpoints REST

#### Autenticación — `backend/src/auth/auth.controller.ts`

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| `POST` | `/auth/register` | Alta de usuario; devuelve JWT. | ❌ |
| `POST` | `/auth/login` | Inicio de sesión; devuelve JWT (responde 200). | ❌ |
| `GET` | `/auth/me` | Usuario de la sesión actual. | ✅ |

#### CU01 — Proyectos y miembros

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/projects` | Crear proyecto. |
| `GET` | `/projects` | Listar proyectos del usuario. |
| `GET` | `/projects/:id` | Detalle de un proyecto. |
| `PATCH` | `/projects/:id` | Renombrar / editar descripción. |
| `DELETE` | `/projects/:id` | Eliminar proyecto (arrastra diagramas por cascada). |
| `GET` | `/projects/:id/members` | Listar miembros y roles. |
| `POST` | `/projects/:id/members` | Invitar a un usuario con un rol. |
| `DELETE` | `/projects/:id/members/:userId` | Quitar a un miembro. |

#### CU02 — Diagramas y modelo UML

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/projects/:projectId/diagrams` | Crear diagrama. |
| `GET` | `/projects/:projectId/diagrams` | Listar diagramas del proyecto. |
| `GET` | `/diagrams/:id` | **Diagrama completo** con clases, atributos, métodos y relaciones. Es la forma que consume el generador. |
| `PATCH` | `/diagrams/:id` | Editar nombre / descripción. |
| `DELETE` | `/diagrams/:id` | Eliminar diagrama y su modelo. |
| `GET` | `/diagrams/:id/validation` | Validar el modelo (bloquea generación y exportación si hay errores). |
| `GET` | `/diagrams/:id/export` | Exportar en formato propio `.case.json`. |
| `POST` | `/projects/:projectId/diagrams/import` | Importar un `.case.json` como diagrama nuevo. |
| `POST` `GET` `PATCH` `DELETE` | `/diagrams/:diagramId/classes` · `/classes/:id` | CRUD de clases (incluye posición y tamaño). |
| `POST` `PATCH` `DELETE` | `/classes/:classId/attributes` · `/attributes/:id` | CRUD de atributos. |
| `POST` `PATCH` `DELETE` | `/classes/:classId/methods` · `/methods/:id` | CRUD de métodos. |
| `POST` `PATCH` `DELETE` | `/methods/:methodId/parameters` · `/parameters/:id` | CRUD de parámetros. |
| `POST` `PATCH` `DELETE` | `/diagrams/:diagramId/relationships` · `/relationships/:id` | CRUD de relaciones. |
| `POST` | `/diagrams/:diagramId/association-classes` | Ayudante: crea una clase asociativa con sus dos relaciones. |

#### CU04 y CU05 — Asistencia por IA

| Método | Ruta | Cuerpo | Descripción |
|---|---|---|---|
| `POST` | `/ai/interpret` | JSON | Instrucción escrita → operaciones validadas sobre el modelo. |
| `POST` | `/ai/voice` | `multipart` (audio) | Transcribe con Whisper y aplica el mismo flujo que `interpret`. |
| `POST` | `/ai/image-to-uml` | `multipart` (imagen) | Lee un diagrama fotografiado y devuelve el modelo leído. |

#### CU06 — XMI

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/diagrams/:id/xmi` | Exporta el diagrama como XMI 2.1 (cabeceras de descarga). |
| `POST` | `/projects/:projectId/diagrams/import-xmi` | Importa un `.xmi`/`.xml` como diagrama nuevo. |

#### CU07 — Generación y descarga

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/diagrams/:id/backend` | Lanza la generación (asíncrona); devuelve el trabajo. |
| `GET` | `/diagrams/:id/backend` | Estado del último trabajo (el diálogo consulta cada 1,5 s). |
| `GET` | `/diagrams/:id/backend/download` | Descarga el `.zip` del proyecto generado. |

#### CU08 — Publicación

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/diagrams/:id/deployment` | Publica el backend generado; devuelve el despliegue en curso. |
| `GET` | `/diagrams/:id/deployment` | Estado actual (el diálogo consulta cada 2 s). |
| `GET` | `/diagrams/:id/deployment/logs` | Últimas líneas del contenedor. |
| `DELETE` | `/diagrams/:id/deployment` | Da de baja: para el contenedor y borra su base. |

### 11.2 WebSocket / Socket.IO

**Namespace:** `/collaboration` · **Autenticación:** el mismo JWT, en `auth.token` del *handshake*
(o `?token=`) · **Salas:** una por diagrama, `diagram:<id>`.

| Evento | Sentido | Payload | Qué hace |
|---|---|---|---|
| `diagram:join` | cliente → servidor | `{ diagramId }` | Une el socket a la sala; responde con presencia y `locks:state`. |
| `diagram:leave` | cliente → servidor | `{ diagramId }` | Sale de la sala y libera sus bloqueos. |
| `presence:state` | servidor → sala | lista de participantes | Quién está conectado, deduplicado por usuario (varias pestañas = una entrada con contador). |
| `locks:state` | servidor → cliente | bloqueos vigentes | Estado inicial al entrar. |
| `lock:acquire` | cliente → servidor | `{ elementType, elementId }` | Pide bloqueo exclusivo sobre una **clase** o **relación**. Primero que llega, se lo queda. |
| `lock:release` | cliente → servidor | `{ elementType, elementId }` | Libera el bloqueo. |
| `lock:changed` | servidor → sala | `{ …, holder }` | Notifica quién tiene (o dejó de tener) un elemento. `holder: null` = libre. |
| `diagram:changed` | servidor → sala | unión etiquetada de cambios REST | Difunde un cambio **ya guardado**: `class.created`, `attribute.updated`, `relationship.deleted`, `diagram.updated`… |

### 11.3 Estrategia de persistencia antes de difusión

```mermaid
flowchart LR
    E["Edición en el editor"] --> R["REST (CU02)<br/>valida y guarda"]
    R --> DB[("PostgreSQL")]
    DB --> EV["DiagramEventsService<br/>changes$ (RxJS)"]
    EV --> GW["CollaborationGateway"]
    GW --> S["Sala diagram:id<br/>diagram:changed"]
```

Decisiones de diseño, verificadas en el código:

1. **Nunca se difunde algo que no esté guardado.** Lo que llega a los demás clientes es exactamente
   el recurso que devolvería la API si recargaran la página.
2. **No hay CRDT ni OT.** La concurrencia se resuelve por **exclusión mutua** (bloqueo por
   elemento), no por fusión automática. No existe Yjs ni Hocuspocus en ninguna de las dos
   `package.json`.
3. **Presencia y bloqueos viven en memoria del proceso**, no en la base de datos. Se pierden si el
   backend se reinicia; es una limitación asumida y documentada.
4. **Al reconectar, el cliente recarga el diagrama completo** por REST en lugar de confiar en
   eventos perdidos, y vuelve a pedir el bloqueo que tenía.
5. **No se transmite la posición del cursor**: la presencia se limita a la lista de participantes y
   al estado de conexión.

---

## 12. Generación de backend

### 12.1 Flujo UML → Java → Spring Boot

```mermaid
flowchart LR
    DB[("Modelo UML<br/>PostgreSQL")] -->|GET /diagrams/:id| CG["CodegenService<br/>(NestJS)"]
    CG -->|modelo.json| JAR["generator.jar<br/>(Java 21)"]
    JAR --> BP["Blueprint / EntityPlan / Link<br/>(planificación)"]
    BP --> W["Writers (JavaPoet)"]
    W --> PRJ["Proyecto Spring Boot"]
    PRJ -->|mvn compile| OK{"¿compila?"}
    OK -->|sí + SMOKE_DB_URL| SMOKE["Arranque de humo<br/>/actuator/health · /api/_meta"]
    OK -->|sí| ZIP["archiver → .zip (CU07)"]
    SMOKE --> DEPLOY["Publicación (CU08)"]
```

> **Dato que conviene subrayar:** el backend NestJS **no escribe ni una línea de Java**. Lee el
> modelo de PostgreSQL, lo serializa a `modelo.json` y delega en un programa Java independiente.

### 12.2 Transformación modelo → código

Orquestador: [`ProjectGenerator.java`](generator/src/main/java/com/casese/generator/emit/ProjectGenerator.java).

| Escritor | Qué emite |
|---|---|
| `EntityWriter` | `@Entity` por clase: `@Id @GeneratedValue Long id` implícito, `@Version Long version`, campos con `@Column`, `@NotNull` cuando el atributo no admite nulos, `@Size(max=…)` en los `String`, relaciones `@ManyToOne`/`@OneToMany` con `@JoinColumn` y `@JsonIgnore` en los extremos inversos. En jerarquías, `@Id` y `@Version` van **sólo en la raíz**. |
| `CrudWriter` | Por entidad **no abstracta**: repositorio Spring Data, servicio transaccional y controlador REST con 5 endpoints (listar, obtener, crear, editar, borrar). `@Valid` en los `@RequestBody` de POST y PUT. **Sin DTOs.** |
| `MetaWriter` | `MetaController` con `GET /api/_meta`: el modelo completo serializado con Jackson **en tiempo de generación** e incrustado como constante `static final String` (con `$S` de JavaPoet, que escapa comillas y llaves). El backend generado es autónomo: no consulta a la herramienta. |
| `SupportWriter` | `Application.java`, `CorsConfiguration.java`, `UnknownReference.java` e `ApiErrors` (`@RestControllerAdvice`). |
| `ResourceWriter` | `pom.xml`, `application.properties`, `README.md`, `Dockerfile` y `.dockerignore`. |
| `Defaults`, `Jpa`, `JavaTypes`, `Names` | Constantes de anotaciones, catálogo de tipos y reglas de nombres (`Names.sqlIdentifier`, `Names.restPath`). |

**Manejo de errores generado** (`ApiErrors`):

| Excepción | Respuesta |
|---|---|
| `MethodArgumentNotValidException` | `400` con `{ "errors": { "campo": "mensaje" } }` — **este formato lo consume el formulario del móvil** |
| `ObjectOptimisticLockingFailureException` | `409` — dispara la pantalla de conflictos de CU10 |
| `UnknownReference` | `400` señalando el campo de la referencia inexistente |
| `DataIntegrityViolationException` | `409` |

**Estructura del proyecto generado:**

```
<slug>/
├── pom.xml
├── Dockerfile                      (multi-stage: maven:3.9-eclipse-temurin-21 → eclipse-temurin:21-jre)
├── .dockerignore
├── README.md
└── src/main/
    ├── java/com/casetool/generated/
    │   ├── Application.java
    │   ├── CorsConfiguration.java
    │   ├── ApiErrors.java
    │   ├── UnknownReference.java
    │   ├── MetaController.java          ← GET /api/_meta
    │   └── <Entidad>.java               ← + Repository, Service, Controller por entidad
    └── resources/
        └── application.properties       ← DB_URL, PORT, CONTEXT_PATH, CORS_ORIGINS, actuator
```

**`application.properties` generado** — parametrizado por entorno:

```properties
server.servlet.context-path=${CONTEXT_PATH:}
server.port=${PORT:8080}
management.endpoints.web.exposure.include=health
# datasource por DB_URL / DB_USER / DB_PASSWORD
# spring.jpa.hibernate.ddl-auto=update, open-in-view=false
```

### 12.3 Validación, compilación y empaquetado

[`backend/src/codegen/codegen.service.ts`](backend/src/codegen/codegen.service.ts), por pasos:

| Paso | Estado persistido | Qué ocurre |
|---|---|---|
| 0 | — | Valida el diagrama con `validateDiagram`. Si falla, no se crea el trabajo. |
| 1 | `GENERATING` | Escribe `modelo.json` y ejecuta `java -jar generator.jar modelo.json <dir> informe.json`. |
| 2 | `COMPILING` | Ejecuta `mvn -B -q compile` → `compile_check_passed`. |
| 3 | *(opcional)* | Si hay `SMOKE_DB_URL`: `mvn package`, levanta el jar en un puerto libre, espera `/actuator/health` = `UP` (tope 60 s), consulta `/api/_meta` y la primera entidad, y apaga el proceso → `smoke_check_passed`. **Sin esa variable el paso se salta y el campo queda `NULL` («no comprobado»), no `false`.** |
| 4 | `SUCCESS` / `FAILED` | Guarda el resultado y el informe. |
| 5 | — | Descarga: verifica `pom.xml`, `README.md` y `application.properties`, comprime con `archiver` excluyendo `target/` y cachea el `.zip`. |

### 12.4 Publicación (CU08)

[`backend/src/deployments/deployments.service.ts`](backend/src/deployments/deployments.service.ts):

| Paso | Estado | Orden ejecutada |
|---|---|---|
| 1 | — | Comprueba que exista una generación `SUCCESS`; si no, `400`. |
| 2 | `BUILDING` | `docker build -t case-tool/<slug>:<jobId> <dir del proyecto>` |
| 3 | `BUILDING` | `docker exec case-tool-postgres psql …` → `CREATE DATABASE <slug>` si no existe |
| 4 | `STARTING` | Para y borra el contenedor anterior del diagrama, y `docker run` el nuevo con `DB_URL`, `DB_USER`, `DB_PASSWORD`, `CONTEXT_PATH=/d/<slug>`, `CORS_ORIGINS` |
| 5 | `STARTING` | Etiquetas de Traefik en el `docker run`: `traefik.enable=true`, `Host(<dominio>) && PathPrefix(/d/<slug>)`, `entrypoints=websecure`, `tls.certresolver=le`, puerto `8080` |
| 6 | `STARTING` | Espera `https://<dominio>/d/<slug>/actuator/health` |
| 7 | `RUNNING` | Guarda `api_url` y `deployed_at`; el diálogo muestra la URL y el **QR** |

**Restricciones reales:**

- `UNIQUE(diagram_id)` en `backend_deployments` → **un despliegue por diagrama**; volver a
  publicar reemplaza el contenedor anterior sin dejarlo huérfano.
- `MAX_DEPLOYMENTS` (3 por defecto): cada backend ocupa entre 250 y 400 MB y la instancia tiene
  4 GB.
- El prefijo `/d/<slug>` **no se recorta** en el proxy: lo conoce la aplicación por `CONTEXT_PATH`,
  de modo que las URL que devuelve son correctas vistas desde fuera.

---

## 13. Aplicación móvil

### 13.1 Arquitectura

```
mobile/lib/
├── main.dart                    punto de entrada
├── app_state.dart               estado global (Riverpod) y backend recordado
├── api/
│   ├── client.dart              BackendClient (dio): _meta + CRUD genérico
│   └── meta.dart                ModelMeta · EntityMeta · FieldMeta · RelationMeta · SystemField
├── features/
│   ├── connect/                 pegar URL o escanear QR
│   ├── entities/                entities_screen · records_screen · record_form · field_values
│   ├── voice/                   speech · local_model · grammar · operations · voice_screen
│   └── conflicts/               conflicts_screen (resolución manual)
├── offline/
│   ├── database.dart / .g.dart  Drift: cached_records · pending_operations · id_map
│   ├── repository.dart          OfflineRepository (~700 líneas)
│   └── sync_controller.dart     disparo por conectividad
└── widgets/sync_indicator.dart  indicador permanente de estado
```

### 13.2 Una sola app para cualquier backend (CU09)

Nada del dominio está escrito en la aplicación. Todo sale de `GET /api/_meta`:

| Tipo en `_meta` | Control del formulario |
|---|---|
| `String` | `TextFormField` con `maxLength` |
| `Integer`, `Long` | Campo numérico con formateador entero |
| `BigDecimal`, `Double` | Campo numérico decimal |
| `Boolean` | `SwitchListTile` |
| `LocalDate`, `LocalDateTime` | Selector de fecha / fecha y hora |
| Relación `MANY_TO_ONE` / `ONE_TO_ONE` editable | Desplegable alimentado por el catálogo de la otra entidad |
| Campo `required` | Marcado obligatorio; se valida antes de enviar |
| Clave primaria (`id`) y `version` | **Nunca se piden** |

Traducción de errores HTTP en `client.dart`: `400` → `ValidationFailure` (con errores por campo,
pintados bajo el control que falla), `409` → `ConflictFailure`, `404` → `NotFoundFailure`.

### 13.3 Offline-first y sincronización (CU10)

**Base local (Drift/SQLite)** — `mobile/lib/offline/database.dart`:

| Tabla local | Contenido |
|---|---|
| `cached_records` | Última copia sincronizada por backend/entidad/registro, con banderas `dirty` y `conflicted` y el `serverJson` del conflicto. |
| `pending_operations` | Cola ordenada de `CREATE`/`UPDATE`/`DELETE` con `status` (`PENDING`, `SENDING`, `DONE`, `CONFLICT`, `FAILED`), `localId`, `serverId`, `attempts` y `lastError`. |
| `id_map` | Traducción `local_id → server_id` por entidad. |

**Reglas de funcionamiento:**

1. **Lectura sin red:** se sirve lo último sincronizado, con la fecha a la vista para no hacer
   creer que el dato es de ahora. Al conectarse y tras cada sincronización se traen **todas** las
   entidades (`refreshAll`), no sólo la que se abrió: sin eso, en modo avión sólo se veía lo que
   se hubiera abierto antes con red, y los desplegables de las relaciones salían vacíos.
2. **Escritura sin red:** se aplica en local marcada como pendiente y se encola. Si el sistema
   dice que no hay red, **ni se intenta** hablar con el servidor: antes se intentaba siempre y el
   alta esperaba a que venciera el plazo de la conexión antes de guardarse en el teléfono.
3. **La lista observa la base local** (`OfflineRepository.watch`): un alta aparece en cuanto se
   guarda, sin esperar a que el servidor devuelva la lista entera, y cuando la sincronización
   cambia un identificador local por el del servidor, la pantalla se entera.
4. **Al volver la conexión** —y al conectarse a un backend—: `SyncController` reenvía **en orden
   y secuencialmente**, resolviendo antes las referencias con `id_map`. Es imprescindible cuando
   una operación depende de otra creada también sin red. Dos ediciones sin red del mismo registro
   se funden en una sola operación: encoladas por separado llevarían la misma versión y la
   segunda daría un `409` que nadie provocó.
5. **Conflictos:** un `409` del backend generado (por `@Version`) marca el registro como
   `conflicted`. `conflicts_screen.dart` muestra **sólo los campos que difieren**, lado a lado, y
   ofrece dos acciones: *quedarme con la mía* (reenvía con la versión fresca del servidor) o
   *quedarme con la del servidor* (descarta el cambio local). **Nunca hay fusión automática.**
6. **Indicador permanente:** conectado / sin red / cuántas operaciones esperan
   (`widgets/sync_indicator.dart`).

### 13.4 IA local e interacción por voz

Cadena completa, toda dentro del teléfono:

```mermaid
flowchart LR
    V["Dictado<br/>micrófono → Silero → Moonshine (sherpa_onnx)"] --> T["Texto"]
    T --> M{"¿Modelo Gemma<br/>descargado?"}
    M -->|sí| G["flutter_gemma · Gemma 3 1B<br/>prompt construido desde _meta"]
    M -->|no / falla / vacío| GR["GrammarInterpreter<br/>reglas deterministas en español"]
    G --> OP["Operaciones propuestas (JSON)"]
    GR --> OP
    OP --> VAL["OperationValidator<br/>valida contra _meta"]
    VAL --> CONF["Tarjetas de confirmación"]
    CONF -->|usuario confirma| EXE["OfflineRepository.create<br/>(también encola si no hay red)"]
```

- **Reconocimiento de voz:** el modelo viaja **dentro del APK** (`mobile/assets/voz`): Moonshine
  base en español, cuantizado, lo pasa a texto con `sherpa_onnx`, y Silero detecta cuándo se
  empieza y se deja de hablar. Se graba con `record` y se transcribe al terminar la frase, en un
  isolate aparte para no congelar la pantalla. No depende del reconocedor de Android: la primera
  versión usaba `speech_to_text` con `onDevice: true`, y sin el paquete de español de Google
  descargado en el teléfono fallaba en modo avión (`error_language_unavailable`, y el reintento con
  red, `error_network`). El modelo de Moonshine para español se publica con la *Moonshine Community
  License*, que permite el uso académico y no comercial (`assets/voz/LICENSE-moonshine.txt`).
- **Modelo de lenguaje:** Gemma 3 1B vía `flutter_gemma`, descargado desde Hugging Face **en el
  primer uso**, no incluido en el APK.
- **Respaldo determinista:** `grammar.dart` implementa un analizador de órdenes en español con
  tabla de verbos (registrar/crear/agregar, cobrar, borrar, buscar), coincidencia de entidad por
  nombre o plural, pares campo-valor y enlace con la entidad anterior (por ejemplo «cobrale 10
  pesos» tras crear un cliente). La demostración no depende de que un modelo de 1B acierte a la
  primera.
- **Validación previa:** venga del modelo o de la gramática, `OperationValidator` comprueba contra
  `_meta` que la entidad exista, que los campos existan y que los tipos encajen, y descarta lo que
  no encaje indicando el motivo.

---

## 14. Inteligencia artificial

### 14.1 Proveedor y modelos

**Groq**, como proveedor **único** de la IA del servidor: no hay alternativa local ni variable para
elegir otro proveedor. Se llama por `fetch` directo a `https://api.groq.com/openai/v1` (API
compatible con OpenAI), **sin SDK**.

| Capacidad | Modelo por defecto | Variable | Razonamiento |
|---|---|---|---|
| Texto (CU04) | `openai/gpt-oss-20b` | `GROQ_TEXT_MODEL` | `GROQ_TEXT_REASONING=low` |
| Visión (CU05) | `qwen/qwen3.8-27b` | `GROQ_VISION_MODEL` | `GROQ_VISION_REASONING=none` |
| Audio (CU04 por voz) | `whisper-large-v3-turbo` | `GROQ_AUDIO_MODEL` | — (`GROQ_AUDIO_LANGUAGE=es`) |

**Por qué tres modelos separados y no uno multimodal:** en el plan gratuito de Groq la cuota es de
**mil tokens de salida por minuto y por modelo**. Con un solo modelo para todo, leer una imagen
dejaba sin cuota a la instrucción siguiente.

**Por qué la nube y no un modelo local:** el backend se despliega en una EC2 sin GPU donde un
modelo de visión de 4B no cabe, y en las mediciones registradas leer una imagen tardaba 83 s a
1280 px en un diagrama simple y unos cinco minutos con ocho clases. La migración está narrada en
el encabezado de [`groq.service.ts`](backend/src/ai/groq.service.ts).

### 14.2 Flujo común: el modelo propone, el código valida

```mermaid
flowchart TB
    IN["Entrada: texto · audio · imagen"] --> GQ["Groq (modelo por capacidad)"]
    GQ --> RAW["Acciones crudas (JSON)"]
    RAW --> NORM["uml-actions.ts — normalización"]
    NORM --> PLAN["AiExecutorService.plan()<br/>valida contra catálogo de tipos<br/>y contra el estado real del diagrama"]
    PLAN --> REP["Informe: aplicables · rechazadas con motivo"]
    REP --> USER{"¿El usuario confirma?"}
    USER -->|no| FIN["No se toca nada"]
    USER -->|sí| APPLY["apply() — todo o nada<br/>vía ClassesService / RelationshipsService"]
    APPLY --> DB[("PostgreSQL")]
    APPLY --> WS["Se difunde por CU03"]
    APPLY --> LOG["ai_command_logs (auditoría)"]
```

Puntos verificados en el código:

- La ejecución es en **dos pasos** (`plan` → `apply`) y **todo o nada**.
- La IA **no escribe directamente en la base**: usa los mismos servicios que la edición manual, y
  por eso hereda validación, cascadas, bloqueos y difusión por WebSocket.
- El usuario **siempre ve lo que se entendió antes de aplicarlo**.
- `layout.ts` coloca las clases nuevas en el lienzo sin solaparlas.

### 14.3 Qué no se guarda

| Contenido | Qué queda |
|---|---|
| Imagen de CU05 | Sólo `photo_import_jobs`: nombre de archivo, MIME, tamaño y modelo extraído. La imagen viaja codificada dentro de la petición a Groq y se descarta. **No hay disco, ni binarios en PostgreSQL, ni servicio de almacenamiento.** |
| Audio de CU04 | Sólo la transcripción, dentro de `ai_command_logs`. |
| Archivo XMI de CU06 | Sólo `xmi_exchange_jobs`: dirección, nombre de archivo, estado. |

### 14.4 Riesgos conocidos

| Riesgo | Detalle | Mitigación en el repositorio |
|---|---|---|
| **Prompts frágiles** | Al pedirle al lector de imágenes que se saltara la columna `id`, dejó de reconocer la entidad intermedia. Cualquier cambio en `prompts.ts` o de modelo puede degradar el resultado. | Banco de pruebas contra la API real: `AI_BANK=1 npx vitest run src/ai/ai-bank.spec.ts` (6 pruebas, omitidas por defecto). |
| **Cuota por modelo** | Encadenar varias importaciones de imagen topa con el límite del plan gratuito. | Modelos separados por capacidad; `DEMO.md` prevé el caso y ofrece plan B. |
| **Sin conexión no hay asistente** | Consecuencia aceptada de quitar el modelo local. | El diseño manual, la colaboración, el XMI y la generación no la necesitan. La IA del **móvil** sí es local. |

---

## 15. Interoperabilidad XMI

**Formato:** XMI **2.1** sobre UML **2.1**
([`backend/src/xmi/xmi-format.ts`](backend/src/xmi/xmi-format.ts)).

> **Criterio de aceptación adoptado:** que el archivo **abra de verdad en Enterprise Architect**,
> no que cumpla el estándar sobre el papel. Es la prueba documentada en `DEMO.md` §4.

### 15.1 Exportación — `GET /diagrams/:id/xmi`

- Genera el XML a partir del modelo relacional (no del dibujo).
- Los identificadores se escriben en el formato **`EAID_<UUID en mayúsculas con guiones bajos>`**,
  que es la convención interna de Enterprise Architect. Usarla permite que, al reimportar, EA
  **reconozca** los elementos en vez de duplicarlos.
- Mapea los seis tipos de relación a sus equivalentes UML (`Association`, `Generalization`,
  `Realization`, `Dependency`, y agregación/composición como asociaciones con su semántica).
- Separa las multiplicidades por extremo (`source_multiplicity` / `target_multiplicity`).
- Se entrega con cabeceras de descarga; desde el editor, `ExportDialog.tsx` ofrece además el
  formato propio `.case.json`.

### 15.2 Importación — `POST /projects/:projectId/diagrams/import-xmi`

- Parseo con `fast-xml-parser` en [`xmi-parser.ts`](backend/src/xmi/xmi-parser.ts).
- Crea un **diagrama nuevo** dentro del proyecto con las clases, atributos y relaciones leídas.
- En la interfaz, el control está en `ProjectDetail.tsx` y acepta `.xmi`, `.xml` y también
  `.case.json` (detecta el formato por extensión).
- El archivo **no se guarda**: queda su registro en `xmi_exchange_jobs`.

### 15.3 Viaje de ida y vuelta verificado

```mermaid
sequenceDiagram
    participant CT as case-tool
    participant EA as Enterprise Architect
    CT->>CT: GET /diagrams/:id/xmi
    CT-->>EA: archivo .xml (XMI 2.1, IDs EAID_)
    EA->>EA: importar en un paquete nuevo
    Note over EA: clases, atributos, tipos y<br/>líneas con multiplicidades
    EA-->>CT: exportar XMI desde EA
    CT->>CT: POST /projects/:id/diagrams/import-xmi
    Note over CT: vuelve como diagrama nuevo
```

---

## 16. Instalación y ejecución local

### 16.1 Requisitos previos

| Requisito | Versión | Necesario para |
|---|---|---|
| Node.js | 22 | `backend/` y `frontend/` |
| PostgreSQL | ≥ 15 (16 recomendado) | Base de la herramienta; el proyecto usa Supabase, pero sirve cualquiera |
| Java | 21 | Compilar el generador y compilar/probar lo generado |
| Maven | 3.9+ | Build del generador |
| Flutter | SDK Dart ^3.13.3 | Sólo si se va a tocar la app móvil |
| Docker + Docker Compose | — | Sólo para publicar backends (CU08) o desplegar la herramienta |
| Clave de Groq | — | **Opcional**: sin ella funciona todo salvo CU04 y CU05 |

> **Gestor de paquetes:** el repositorio usa **npm** (`package-lock.json`). No hay
> `pnpm-lock.yaml`.

### 16.2 Base de datos

```bash
# Crear la base y aplicar el esquema
psql "$DATABASE_URL" -f database/db.sql

# (opcional) datos de prueba: el diagrama «Sistema de ventas» de la demo
psql "$DATABASE_URL" -f database/seed-ventas.sql
```

### 16.3 Backend de la herramienta

```bash
cd backend
npm install
cp .env.example .env      # completar: DATABASE_URL, JWT_SECRET, CORS_ORIGINS, GROQ_API_KEY…
npm run start:dev         # http://localhost:3000
```

### 16.4 Frontend

```bash
cd frontend
npm install
cp .env.example .env      # VITE_API_URL=http://localhost:3000
npm run dev               # http://localhost:5173
```

### 16.5 Generador (se compila una sola vez)

```bash
mvn -f generator/pom.xml package
# deja generator/target/generator.jar, que el backend invoca como subproceso
```

### 16.6 Aplicación móvil

```bash
cd mobile
flutter pub get
flutter run
```

Al abrirla se pega la URL de un backend publicado o se escanea el QR del editor.

> Antes de una demostración conviene comprobar dos cosas del teléfono: que el **reconocimiento de
> voz en español sin conexión** esté descargado (ajustes de voz de Google, en Android) y, si se va
> a enseñar, que el **modelo de lenguaje** ya esté bajado desde la propia pantalla del asistente.

### 16.7 Puertos

| Servicio | Puerto local | En producción |
|---|---|---|
| Backend NestJS | `3000` (`PORT`) | Interno; expuesto por Traefik en `/api` |
| Frontend Vite | `5173` | Servido como estáticos por Traefik en `/` |
| Backend generado | `8080` (`PORT`) | Interno; expuesto por Traefik en `/d/<slug>` |
| PostgreSQL de despliegues | `5432` | **Sin `ports` publicados**: sólo accesible desde la red de Docker |

### 16.8 Variables de entorno

**`backend/.env`** (plantilla completa y comentada en
[`backend/.env.example`](backend/.env.example)):

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | ✅ | Conexión a PostgreSQL de la herramienta. |
| `JWT_SECRET` | ✅ | Firma de los tokens. |
| `JWT_EXPIRES_IN` | — | Validez del token (por defecto `7d`). |
| `CORS_ORIGINS` | ✅ | Orígenes autorizados, separados por comas. |
| `GROQ_API_KEY` | — | CU04 y CU05. Sin ella el asistente no funciona; el resto sí. |
| `GROQ_TEXT_MODEL` · `GROQ_VISION_MODEL` · `GROQ_AUDIO_MODEL` | — | Un modelo por capacidad (traen valor por defecto). |
| `GROQ_AUDIO_LANGUAGE` | — | Idioma del dictado (`es`). |
| `GROQ_TEXT_REASONING` · `GROQ_VISION_REASONING` | — | Esfuerzo de razonamiento por familia de modelo. |
| `GENERATOR_JAR` | — | Ruta al `.jar` (por defecto `../generator/target/generator.jar`). |
| `GENERATED_DIR` | — | Dónde quedan los proyectos generados (`./generated`). |
| `GENERATED_PACKAGE` | — | Paquete base del backend generado (`com.casetool.generated`). |
| `GENERATOR_TIMEOUT_MS` | — | Tope por paso (`600000`). |
| `SMOKE_DB_URL` · `SMOKE_DB_USER` · `SMOKE_DB_PASSWORD` | — | Base **de usar y tirar** para el arranque de humo. Sin ella el paso se salta. |
| `DEPLOY_DOMAIN` | Para CU08 | Dominio bajo el que responden los backends publicados. |
| `DEPLOY_NETWORK` | Para CU08 | Red Docker compartida (`case-tool`). |
| `DEPLOY_DB_HOST` | Para CU08 | **Alias de red**, va en la URL JDBC. |
| `DEPLOY_DB_CONTAINER` | Para CU08 | **Nombre del contenedor**, lo usa `docker exec`. No es intercambiable con el anterior. |
| `DEPLOY_DB_USER` · `DEPLOY_DB_PASSWORD` | Para CU08 | Credenciales del PostgreSQL de despliegues. |
| `MAX_DEPLOYMENTS` | — | Backends publicados simultáneos (por defecto `3`). |

**`frontend/.env`:** `VITE_API_URL` — URL de la API. Debe figurar en `CORS_ORIGINS` del backend.
Se incrusta **en tiempo de construcción**: cambiar de dominio obliga a reconstruir la imagen.

**`deploy/.env`** ([plantilla](deploy/.env.example)): `DOMAIN`, `ACME_EMAIL`, `DATABASE_URL`,
`JWT_SECRET`, `JWT_EXPIRES_IN`, `GROQ_API_KEY`, `DEPLOY_DB_USER`, `DEPLOY_DB_PASSWORD`,
`MAX_DEPLOYMENTS`.

> **Ninguna credencial se escribe en el código ni entra en una imagen de Docker.** En producción,
> `deploy/.env` se arma en la propia instancia leyendo AWS SSM Parameter Store (`SecureString`).

### 16.9 Migraciones

El proyecto usa el flujo de contrato de Prisma 8 (ver [§10.3](#103-esquema-prisma-8--postgresql)).
El historial vive en `backend/migrations/` (`app/refs/db.json` y `snapshots/`).

```bash
cd backend
npx prisma contract emit           # SIEMPRE antes de comparar
npx prisma db update --dry-run     # plan
npx prisma db update               # aplicar (lo destructivo pide confirmación)
```

> En sesión no interactiva, una operación destructiva se confirma con
> `--no-interactive --confirm <nombre de la base>`.

### 16.10 Comandos de verificación

```bash
# backend: tipos + pruebas + lint
cd backend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint

# banco de IA (llama a la API real; sólo al tocar prompts o cambiar de modelo)
cd backend && AI_BANK=1 npx vitest run src/ai/ai-bank.spec.ts
#   PowerShell:  $env:AI_BANK=1; npx vitest run src/ai/ai-bank.spec.ts

# frontend: tipos + lint
cd frontend && npx tsc -b && npx eslint src --max-warnings=0

# generador
mvn -f generator/pom.xml package

# móvil
cd mobile && flutter analyze && flutter test
```

---

## 17. Uso paso a paso

> El recorrido completo, con tiempos y plan B para la defensa, está en [`DEMO.md`](DEMO.md).

### 1. Crear un proyecto (CU01)

Registrarse o iniciar sesión → **Proyectos** → *Nuevo proyecto* → nombre y descripción. Dentro del
proyecto, *Compartir* invita a otros usuarios con rol `OWNER`, `EDITOR` o `VIEWER`.

### 2. Diseñar el diagrama (CU02)

Crear un diagrama dentro del proyecto y abrirlo. En el lienzo:

- Barra lateral izquierda (`ToolRail`): herramienta de selección, creación de entidad y los seis
  tipos de relación.
- Doble clic en una entidad para renombrarla; panel derecho para atributos (tipo, obligatorio,
  único, valor por defecto), métodos y parámetros.
- **No se declara la clave primaria**: `id` es implícito.
- Para una relación N:M con atributos propios, usar el ayudante de **clase asociativa**.
- El botón de deducción de tipos propone un tipo a partir del nombre del atributo, **sólo cuando se
  pulsa** y **sólo sobre los que están vacíos**.

### 3. Colaborar (CU03)

Abrir el mismo diagrama en dos navegadores con dos usuarios del mismo proyecto:

- Mover una entidad en una ventana → se mueve en la otra.
- Empezar a editar una entidad → en la otra ventana aparece **bloqueada, con el nombre de quien la
  tiene**.
- Arriba a la derecha, los avatares de quién está conectado.

### 4. Usar la IA (CU04 y CU05)

Botón de la chispa → asistente:

- **Pestaña «Instrucción»:** escribir o dictar («agregá una entidad PRODUCTO con descripción,
  precio y stock»). Se ve la transcripción, después **lo que se entendió**, y se aplica al
  confirmar.
- **Pestaña «Desde una imagen»:** subir la foto de un diagrama a mano (PNG/JPEG/WEBP, hasta 8 MB).
  Aparecen las entidades leídas con sus atributos y relaciones para confirmar.

### 5. Intercambiar con Enterprise Architect (CU06)

*Exportar* → **XMI** descarga un `.xml` que se abre en Enterprise Architect. Desde la pantalla del
proyecto, el control de importación acepta ese mismo archivo de vuelta y crea un diagrama nuevo.

### 6. Generar el backend (CU07)

Botón **Backend** → *Generar backend*. Se ve el progreso (escribir el proyecto → compilar con
Maven) y, al terminar, cuántas entidades, endpoints y archivos, más **dos comprobaciones**:
compila y —si hay `SMOKE_DB_URL`— arranca. *Descargar .zip* entrega el código fuente.

### 7. Publicar el backend (CU08)

Botón **Publicar** → *Publicar*. Construye la imagen, crea su base y arranca el contenedor. Al
terminar muestra la **URL pública** y un **código QR**. Abrir
`https://<dominio>/d/<slug>/api/_meta` enseña el contrato que describe el modelo entero.

### 8. Usar la app móvil (CU09)

Abrir la aplicación → **escanear el QR** → aparece la lista de entidades del diagrama (ninguna
estaba escrita en la app). Entrar en una entidad, dar de alta un registro: el formulario tiene los
campos del diagrama con sus tipos y obligatorios; un error se pinta **bajo el campo que falla**.
Las relaciones se eligen en un desplegable.

### 9. Trabajar sin conexión (CU10)

Activar el modo avión: el indicador se pone naranja. Leer sigue funcionando (con la fecha del
último sincronizado), y las altas, ediciones y bajas quedan **pendientes** en la cola —incluidas
las dictadas por voz, porque la transcripción y la interpretación ocurren en el teléfono—. Al
quitar el modo avión suben solas y en orden. Si un registro cambió mientras tanto, el `409` lo
marca y se resuelve eligiendo versión en la pantalla de conflictos.

---

## 18. Despliegue

### 18.1 Servicios de `deploy/docker-compose.yml`

| Servicio | Imagen | Rol |
|---|---|---|
| `traefik` | `traefik:v3.3` | Puertos 80/443, TLS con Let's Encrypt (`httpchallenge`), descubrimiento por etiquetas. `exposedbydefault=false`: nada sale a internet si no lo pide. Monta el socket de Docker **en sólo lectura**. |
| `postgres` | `postgres:16` | Base **de los backends publicados** (la de la herramienta sigue en Supabase). `container_name: case-tool-postgres` fijo, porque `docker exec` necesita el nombre. Sin `ports`. |
| `api` | `case-tool/api` (build desde la raíz con `backend/Dockerfile`) | El backend NestJS. Monta el **socket de Docker**, el volumen `generated` y la caché de Maven. |
| `web` | `case-tool/web` (build con `frontend/Dockerfile`) | Los estáticos de Vite. Recibe `VITE_API_URL` como *build arg*. |

**Volúmenes:** `traefik-certs` (certificados), `postgres-data`, `generated` (proyectos de CU07),
`maven-cache` (`/root/.m2`, compartida entre construcciones).

**Red:** `case-tool`, con **nombre fijo** para que los contenedores creados en tiempo de ejecución
(los backends publicados) puedan unirse a ella desde fuera del `compose`.

### 18.2 Puesta en marcha

```bash
# en la instancia
git clone <repositorio> case-tool
cd case-tool/deploy
cp .env.example .env
nano .env                          # dominio, correo, Supabase, JWT, Groq, clave de PostgreSQL

docker compose up -d --build
docker compose logs -f traefik     # hasta ver el certificado emitido
```

```bash
# comprobar
curl -I https://<dominio>            # el editor
curl  https://<dominio>/api          # el backend
```

### 18.3 Despliegue actual del proyecto

| | |
|---|---|
| Dominio | `case-tool-gabriela.duckdns.org` |
| IP elástica | `3.226.42.207` |
| Instancia | `i-07342b49e34f874c0` · `c7i-flex.large` (2 vCPU, 4 GB) · `us-east-1` |
| Sistema | Amazon Linux 2023, disco 30 GB |
| Certificado | Let's Encrypt, renovación automática |
| Ruta en la instancia | `/opt/case-tool` |
| Acceso | AWS SSM (`aws ssm start-session --target i-07342b49e34f874c0 …`); el puerto 22 está cerrado |
| Secretos | AWS SSM Parameter Store, bajo `/case-tool/` como `SecureString` |

### 18.4 Riesgo documentado: el socket de Docker

El contenedor `api` monta `/var/run/docker.sock` con permiso de escritura. Es lo que le permite
construir y arrancar los backends generados sin entrar a la máquina.

> **Montar ese socket equivale a dar root del anfitrión a ese contenedor.** No hay forma de
> matizarlo: es así por cómo funciona el demonio de Docker. Se acepta a sabiendas, en un proyecto
> académico y en una instancia dedicada. En un sistema real se resolvería con un servicio
> intermediario que sólo admita las órdenes concretas necesarias, o construyendo las imágenes
> fuera.

Queda escrito a propósito en [`deploy/README.md`](deploy/README.md): lo que no se puede es
esconderlo.

### 18.5 Redespliegue y baja

```bash
git pull
docker compose up -d --build     # los backends ya publicados no se tocan

# dar de baja todo
docker rm -f $(docker ps -aq --filter "name=case-backend-")
docker compose down              # conserva volúmenes
docker compose down -v           # borra también bases y certificados
```

### 18.6 CI/CD

❌ **No implementado.** No existe `.github/workflows/`, `.gitlab-ci.yml` ni `Jenkinsfile`. El
despliegue es manual (`git pull` + `docker compose up -d --build`). Ver
[Roadmap](#21-roadmap-pendientes-y-limitaciones).

---

## 19. Pruebas

### 19.1 Estado real, ejecutado

```
$ cd backend && npx vitest run

 Test Files  6 passed | 1 skipped (7)
      Tests  47 passed | 6 skipped (53)
   Duration  9.10s
```

| Archivo | Tipo | Qué cubre |
|---|---|---|
| [`src/diagrams/diagram-validator.spec.ts`](backend/src/diagrams/diagram-validator.spec.ts) | Unitaria | Reglas de validación del modelo UML. |
| [`src/xmi/xmi.spec.ts`](backend/src/xmi/xmi.spec.ts) | Unitaria | Generación y parseo XMI (ida y vuelta). |
| [`src/ai/ai-executor.spec.ts`](backend/src/ai/ai-executor.spec.ts) | Unitaria | Planificación y validación de las acciones propuestas por la IA. |
| [`src/ai/association-class.spec.ts`](backend/src/ai/association-class.spec.ts) | Unitaria | Ayudante de clase asociativa. |
| [`src/ai/layout.spec.ts`](backend/src/ai/layout.spec.ts) | Unitaria | Colocación de clases nuevas en el lienzo. |
| [`src/app.controller.spec.ts`](backend/src/app.controller.spec.ts) | Unitaria | Controlador raíz. |
| [`src/ai/ai-bank.spec.ts`](backend/src/ai/ai-bank.spec.ts) | **Integración real** | 6 pruebas contra la **API real de Groq**. Omitidas salvo `AI_BANK=1`, porque cuestan cuota. |
| [`test/app.e2e-spec.ts`](backend/test/app.e2e-spec.ts) | E2E | Arranque de la aplicación con Supertest (`npm run test:e2e`). |

| Componente | Marco | Archivos | Estado |
|---|---|---|---|
| Backend | Vitest + Supertest | 7 unitarios + 1 e2e | ✅ **47 pruebas en verde** |
| Móvil | `flutter_test` | [`meta_test.dart`](mobile/test/meta_test.dart), [`offline_test.dart`](mobile/test/offline_test.dart) (334 líneas), [`voice_test.dart`](mobile/test/voice_test.dart), `meta_fixture.dart` | ✅ Existen y cubren parseo de `_meta`, repositorio offline (alta/edición/borrado online y offline, orden de sincronización, traducción de IDs, marcado de conflictos) y gramática de voz. **No ejecutadas en esta revisión.** |
| Generador | `spring-boot-starter-test` declarado | `generator/src/test/java/com/casese/generator/` **está vacío** | ❌ **Sin pruebas** |
| Frontend | — | ninguno | ❌ **Sin pruebas**; la verificación es `tsc -b` + ESLint |

### 19.2 Cobertura

Configurada (`@vitest/coverage-v8`, `npm run test:cov`) pero **sin umbral definido ni informe
versionado**. No hay medición de cobertura para móvil, generador ni frontend.

```bash
cd backend && npm run test:cov
```

---

## 20. Estructura de carpetas real

```
case-tool/
├── README.md                    este documento
├── PLAN.md                      plan histórico y decisiones cerradas (no es el estado actual)
├── DEMO.md                      guion de la defensa, CU por CU
├── .dockerignore
│
├── backend/                     ── HERRAMIENTA: API NestJS 12 + Prisma 8
│   ├── src/
│   │   ├── main.ts              bootstrap, CORS, puerto
│   │   ├── app.module.ts
│   │   ├── cors-origins.ts
│   │   ├── auth/                register · login · me · AuthGuard · current-user.decorator
│   │   ├── projects/            CU01 — proyectos y miembros
│   │   ├── diagrams/            CU02 — diagrams · classes · relationships · validator ·
│   │   │                        uml-catalog · diagram-exchange (.case.json)
│   │   ├── collaboration/       CU03 — gateway · lock-registry · diagram-events · events
│   │   ├── ai/                  CU04/CU05 — ai.service · groq.service · ai-executor ·
│   │   │                        prompts · uml-actions · layout (+ 4 .spec.ts)
│   │   ├── xmi/                 CU06 — generator · parser · format (+ xmi.spec.ts)
│   │   ├── codegen/             CU07 — invoca generator.jar, Maven, humo y .zip
│   │   ├── deployments/         CU08 — docker build/run/exec + etiquetas Traefik
│   │   └── prisma/              contract.prisma · contract.json · contract.d.ts · db.ts
│   ├── test/app.e2e-spec.ts
│   ├── migrations/              app/refs/db.json + snapshots/  (Prisma 8)
│   ├── generated/               proyectos generados, uno por trabajo (no versionado)
│   ├── Dockerfile
│   ├── prisma.config.ts
│   ├── vitest.config.ts · vitest.config.e2e.ts
│   └── .env.example
│
├── frontend/                    ── EDITOR: React 19 + Vite 8 + Tailwind 4
│   ├── src/
│   │   ├── api/                 client · endpoints (agrupados por CU) · session · types
│   │   ├── components/          AppHeader · Logo · icons · ui/ (kit propio)
│   │   ├── features/
│   │   │   ├── auth/            LoginPage · RegisterPage · AuthLayout · validation
│   │   │   ├── projects/        ProjectsPage · ProjectDetail · modales
│   │   │   └── editor/          DiagramCanvas · UmlClassNode · UmlRelationEdge · ToolRail ·
│   │   │                        panel/ · AiAssistant · ExportDialog ·
│   │   │                        GenerateBackendDialog · DeployDialog · QrCode · ShareDialog
│   │   ├── realtime/            socket · useCollaboration · useLock · types
│   │   ├── store/               auth.ts · diagram.ts (Zustand)
│   │   └── lib/                 cn · format · useResource
│   ├── Dockerfile · nginx.conf
│   └── .env.example
│
├── generator/                   ── GENERADOR: Java 21 + Maven + JavaPoet
│   ├── src/main/java/com/casese/generator/
│   │   ├── GeneratorApplication.java · GenerationReport.java
│   │   ├── emit/    ProjectGenerator · EntityWriter · CrudWriter · MetaWriter ·
│   │   │            SupportWriter · ResourceWriter · Jpa · Defaults
│   │   ├── plan/    Blueprint · EntityPlan · Link
│   │   ├── model/   UmlModel · UmlClass · UmlAttribute · UmlMethod · UmlParameter ·
│   │   │            UmlRelationship · GenerationRequest
│   │   └── java/    JavaTypes · Names
│   ├── src/test/java/com/casese/generator/    ← VACÍO (sin pruebas)
│   ├── target/generator.jar
│   └── pom.xml
│
├── mobile/                      ── APP: Flutter + Drift + Gemma 3 1B
│   ├── lib/                     main · app_state · api/ · features/ · offline/ · widgets/
│   ├── test/                    meta_test · offline_test · voice_test · meta_fixture
│   └── pubspec.yaml
│
├── database/
│   ├── db.sql                   esquema completo y comentado (14 tablas + 9 enums + triggers)
│   └── seed-ventas.sql          diagrama «Sistema de ventas» para la demostración
│
├── deploy/
│   ├── docker-compose.yml       traefik · postgres · api · web
│   ├── README.md                instancia, SSM, secretos, riesgo del socket de Docker
│   └── .env.example
│
└── whisper-env/                 ⚠️ RESIDUO — venv de Python (~283 MB) del diseño anterior
                                 con Whisper local. Sin referencias en el código actual.
```

---

## 21. Roadmap, pendientes y limitaciones

### 21.1 Pendientes de limpieza

| # | Pendiente | Detalle | Impacto |
|---|---|---|---|
| 1 | **Eliminar `whisper-env/`** | Entorno virtual de Python (~283 MB) con `faster-whisper`, `ctranslate2` y `onnxruntime`, resto del diseño anterior con IA local. Ningún archivo de `backend/src` lo referencia. | Peso del repositorio; contradice la convención «Groq, sin alternativa local». |
| 2 | **Corregir textos de `AiAssistant.tsx`** | La pestaña de imagen aún dice que «se guardará también la imagen original» y que «el modelo lee la imagen en este ordenador». Ambas frases describen el diseño anterior y **contradicen el comportamiento real**. | Confunde al usuario y al evaluador. No afecta la funcionalidad. |
| 3 | **Decidir sobre `uml_attributes.is_primary_key`** | Columna en desuso, conservada para no tocar filas guardadas. Puede borrarse. | Ruido en el esquema. |
| 4 | **Actualizar `PLAN.md` o marcarlo como histórico** | Su tabla «Lo que falta» lista CU09, CU10 y el despliegue como pendientes, cuando están implementados. | Induce a error sobre el estado del proyecto. |

### 21.2 No implementado aún

| # | Elemento | Estado |
|---|---|---|
| 1 | **CI/CD** | ❌ No existe `.github/workflows/` ni equivalente. Despliegue manual. |
| 2 | **Pruebas del generador Java** | ❌ `generator/src/test/java/com/casese/generator/` está vacío pese a declarar `spring-boot-starter-test`. |
| 3 | **Pruebas del frontend** | ❌ No hay ningún `.test.tsx` / `.spec.tsx`. Sólo `tsc -b` + ESLint. |
| 4 | **Archivo `LICENSE`** | ❌ No existe. `backend/package.json` declara `"license": "UNLICENSED"`. |
| 5 | **Umbrales de cobertura** | ❌ `@vitest/coverage-v8` instalado, sin umbral ni informe versionado. |
| 6 | **Verificación del rol `VIEWER`** | ⚠️ Definido en el esquema; no se comprobó servicio por servicio que rechace toda escritura. |
| 7 | **Autenticación en el backend generado** | Fuera de alcance por decisión; el CRUD generado es abierto. |

### 21.3 Limitaciones conocidas y asumidas

| Limitación | Consecuencia | Por qué se acepta |
|---|---|---|
| Sin conexión no hay asistente de IA en el editor | CU04 y CU05 requieren internet | El diseño manual, CU03, CU06, CU07 y CU08 no la necesitan; la IA del móvil sí es local |
| Presencia y bloqueos viven en memoria | Se pierden si el backend se reinicia | Simplicidad; el cliente recarga el diagrama al reconectar |
| Sin CRDT/OT | Dos personas no editan **el mismo** elemento a la vez | El bloqueo exclusivo evita el conflicto en origen |
| Cuota de Groq por modelo | Encadenar importaciones de imagen topa con el límite del plan gratuito | Modelos separados por capacidad; el Dev Tier lo resuelve |
| `MAX_DEPLOYMENTS = 3` | No más de tres backends publicados a la vez | Cada uno ocupa 250–400 MB y la instancia tiene 4 GB |
| Socket de Docker montado con escritura | Root del anfitrión para el contenedor `api` | Documentado explícitamente; aceptable en instancia dedicada |
| Android bloquea HTTP en claro | Hace falta dominio con TLS de verdad, no una IP | Traefik + Let's Encrypt ya resuelven el caso |
| El arranque de humo es condicional | Sin `SMOKE_DB_URL` queda «no comprobado» | Un portátil sin base de pruebas no debe ver el trabajo como fallido |

### 21.4 Roadmap propuesto

1. Cerrar los cuatro puntos de limpieza de [§21.1](#211-pendientes-de-limpieza).
2. Añadir un flujo de CI (typecheck + pruebas de backend + `flutter analyze`) en GitHub Actions.
3. Escribir pruebas del generador: dado un `modelo.json` con herencia y una N:M resuelta,
   comprobar que el proyecto emitido compila.
4. Cubrir el frontend con pruebas de componente para el lienzo y los diálogos.
5. Verificar y documentar formalmente el comportamiento del rol `VIEWER`.
6. Añadir `LICENSE` y umbrales de cobertura.

---

## 22. Referencias bibliográficas

> ⚠️ **Pendiente:** la bibliografía del documento académico del primer parcial **no está en el
> repositorio**. Debe pegarse aquí desde ese documento. Lo que sigue son las fuentes normativas y
> técnicas que el código **sí** usa de forma verificable.

**Estándares y proceso**

- Object Management Group. *Unified Modeling Language (UML) Specification, v2.1*. OMG.
  — Base del metamodelo usado en `database/db.sql` §4 y en la exportación XMI.
- Object Management Group. *XML Metadata Interchange (XMI) Specification, v2.1*. OMG.
  — Formato implementado en `backend/src/xmi/`.
- Jacobson, I., Booch, G. y Rumbaugh, J. *El Proceso Unificado de Desarrollo de Software*.
  Addison-Wesley. — Marco de los flujos de trabajo de [§9.9](#99-flujos-de-trabajo-puds).
- Booch, G., Rumbaugh, J. y Jacobson, I. *El Lenguaje Unificado de Modelado*. Addison-Wesley.

**Documentación técnica de las tecnologías empleadas**

- NestJS — https://docs.nestjs.com
- Prisma (v8, flujo de contrato) — https://www.prisma.io/docs · y `backend/prisma-8.md` en este
  repositorio
- React y React Flow (`@xyflow/react`) — https://react.dev · https://reactflow.dev
- Socket.IO — https://socket.io/docs
- Spring Boot 3.4 y Spring Data JPA — https://docs.spring.io/spring-boot/
- JavaPoet — https://github.com/square/javapoet
- Flutter y Drift — https://docs.flutter.dev · https://drift.simonbinder.eu
- Traefik v3 — https://doc.traefik.io/traefik/
- Groq API (compatible con OpenAI) — https://console.groq.com/docs

---

## 23. Créditos y licencia

**Autoría.** Gabriela Belén Crespo Cárdenas — Ingeniería de Software I, Semestre 2-2026, Primer
Parcial.

**Historial del repositorio** (3 commits):

| Commit | Mensaje |
|---|---|
| `badfb78` | Commit inicial: herramienta CASE colaborativa de diseño de datos |
| `a5e4d96` | Casos de uso finales |
| `5a4c901` | Arreglos en la app movil |

**Licencia.** ⚠️ **No hay archivo `LICENSE` en el repositorio.**
[`backend/package.json`](backend/package.json) declara `"license": "UNLICENSED"` y
`"private": true`; [`mobile/pubspec.yaml`](mobile/pubspec.yaml) declara `publish_to: 'none'`. A
efectos prácticos es un proyecto académico privado, sin licencia de distribución. **Pendiente:**
añadir un `LICENSE` si se va a publicar.

**Servicios de terceros utilizados:** Groq (inferencia), Supabase (PostgreSQL gestionado), Amazon
Web Services (EC2, SSM Parameter Store), Let's Encrypt (certificados), Hugging Face (descarga del
modelo Gemma 3 1B en el dispositivo), DuckDNS (subdominio).

---

## 24. Discrepancias detectadas

Diferencias entre lo que suponen los documentos previos (o el enunciado del propio encargo de este
README) y lo que dice el código. **El código es la fuente de verdad.**

| # | Discrepancia | Qué se supuso | Qué dice el código | Resolución |
|---|---|---|---|---|
| 1 | **Gestor de paquetes** | Se esperaba `pnpm-lock.yaml`. | Existen `backend/package-lock.json` y `frontend/package-lock.json`. **No hay pnpm.** | Documentado con **npm** en [§16](#16-instalación-y-ejecución-local). |
| 2 | **Esquema de Prisma** | Se esperaba `prisma/schema.prisma`. | No existe. Se usa el flujo de contrato de **Prisma 8**: `prisma.config.ts` + `src/prisma/contract.prisma` + `contract.json` + `contract.d.ts` + `db.ts`. | Documentado en [§10.3](#103-esquema-prisma-8--postgresql). |
| 3 | **Estado de CU09 y CU10 en `PLAN.md`** | Su tabla «Lo que falta» lista la app móvil, la voz/IA local y el modo offline como **pendientes**… | …pero su propia nota introductoria dice que «las seis fases están implementadas», y el código los implementa por completo (`mobile/lib/offline/`, `mobile/lib/features/voice/`, con pruebas). **`PLAN.md` se contradice a sí mismo.** | Se documentan como **implementados**. `PLAN.md` queda como registro histórico. |
| 4 | **Despliegue en `PLAN.md`** | Listado como pendiente. | `backend/src/deployments/` ejecuta Docker de verdad y `deploy/README.md` documenta una instancia en marcha con dominio e IP. | Implementado (**CU08**). |
| 5 | **Tipo de instancia** | `PLAN.md` §1.1 y `deploy/README.md` §«Lo que hace falta» piden una `t3.medium`. | La instancia real es una **`c7i-flex.large`** (mismas 2 vCPU y 4 GB), porque la cuenta está en plan gratuito y rechaza la `t3.medium`. | El propio `deploy/README.md` lo aclara más abajo. Documentado en [§18.3](#183-despliegue-actual-del-proyecto). |
| 6 | **Tablas «que nadie escribe»** | `database/db.sql` y `PLAN.md` §Fase 5 dicen que `diagram_change_log` y `xmi_exchange_jobs` están en el esquema sin que nadie las escriba. | **Ambas se escriben:** `diagram_change_log` desde `diagrams.service.ts` (método `log`, en cada alta/edición/borrado) y `xmi_exchange_jobs` desde `xmi.service.ts`. | Comentario desactualizado. Documentadas como activas en [§10.2](#102-entidades-atributos-y-relaciones). |
| 7 | **Textos de la interfaz de IA** | `AiAssistant.tsx` dice «se guardará también la imagen original» y «el modelo lee la imagen en este ordenador». | La imagen **no se guarda** (sólo metadatos en `photo_import_jobs`) y el modelo corre **en Groq**, no en local. | Texto residual del diseño con Ollama. Pendiente de corregir ([§21.1](#211-pendientes-de-limpieza) #2). |
| 8 | **`whisper-env/`** | Su presencia sugiere transcripción local con Faster-Whisper. | Ningún archivo de `backend/src` lo referencia; no hay carpeta `speech/`. La transcripción la hace `whisper-large-v3-turbo` **en Groq**. | Residuo. Pendiente de eliminar. |
| 9 | **Pruebas del generador** | `generator/pom.xml` declara `spring-boot-starter-test`, y una versión anterior de este README afirmaba que `mvn package` ejecutaba pruebas Java. | `generator/src/test/java/com/casese/generator/` **está vacío**: no hay ni una prueba. | Corregido en [§19](#19-pruebas): el generador figura **sin pruebas**. |
| 10 | **Yjs / CRDT** | El planteamiento inicial del proyecto contemplaba Yjs y Hocuspocus, y `database/db.sql` conserva la nota de que existieron un `crdt_state BYTEA` y una tabla `diagram_versions`. | Ninguna de las dos `package.json` incluye Yjs ni Hocuspocus; la colaboración es Socket.IO con bloqueo por elemento. Las columnas se eliminaron. | Documentado en [§11.3](#113-estrategia-de-persistencia-antes-de-difusión). |
| 11 | **Alcance de CU08** | Una versión anterior de este README documentaba «publicar» como *operación* y no como caso de uso, y numeraba CU08 = «Descargar el backend generado». | El catálogo oficial de casos de uso define **CU08 = Publicar Backend Generado**. | La descarga se documenta dentro de **CU07**; CU08 es la publicación. |
| 12 | **`uml_attributes.is_primary_key`** | La columna sugiere que la clave primaria se declara por atributo. | Está **en desuso**: la aplicación no la lee ni la escribe. La clave primaria es siempre `id`, implícita. | Documentado en [§10.1](#101-regla-del-id-implícito). |
| 13 | **Número de pruebas** | `PLAN.md` afirma «47 tests del backend». | **Verificado ejecutándolas:** 47 pasan, 6 se omiten (banco de IA), en 7 archivos. La cifra es correcta. | Confirmado en [§19.1](#191-estado-real-ejecutado). |

---

## 25. Checklist de verificación

Marque cada punto al revisar este README contra el repositorio.

### Contenido obligatorio

- [x] Título, descripción, badges y estado del proyecto
- [x] Tabla de contenidos navegable
- [x] Contexto académico *(con los campos no disponibles marcados como TODO)*
- [x] Resumen: problema, solución, alcance y objetivos
- [x] Marco teórico resumido (UML, PUDS, MDE, CASE, IA generativa, XMI, offline-first)
- [x] Arquitectura general: componentes, cliente-servidor, capas, y separación herramienta ↔ backend generado
- [x] Stack tecnológico real con versiones tomadas de los manifiestos
- [x] Los cuatro módulos funcionales (I a IV)
- [x] Actores A01 y A02
- [x] Tabla de CU01–CU10 con ID, nombre, descripción, actor, ciclo, prioridad, riesgo y estado
- [x] Paquetes y su relación con los casos de uso
- [x] Diagramas Mermaid: componentes, capas, paquetes, casos de uso, clases, secuencia (×4), despliegue
- [x] Matriz de trazabilidad CU → clases → endpoints → tablas → componentes
- [x] Flujos PUDS: captura de requisitos, análisis, diseño e implementación
- [x] Modelo de datos: entidades, relaciones, enums, triggers y regla del `id` implícito
- [x] Esquema Prisma 8 / PostgreSQL y procedimiento de migración
- [x] Mapeo UML → tablas → Java generado
- [x] API REST completa, endpoint por endpoint
- [x] WebSocket: namespace, salas, eventos y estrategia de persistencia antes de difusión
- [x] Generación de backend: flujo, transformación, validación, compilación, empaquetado
- [x] Publicación: Docker, Traefik, URL pública y QR
- [x] Aplicación móvil: `_meta`, offline-first, cola, sincronización, conflictos, IA local y voz
- [x] Inteligencia artificial: modelos, flujo, validación y qué no se guarda
- [x] Interoperabilidad XMI y compatibilidad con Enterprise Architect (`EAID_<UUID>`)
- [x] Instalación: requisitos, variables, comandos, puertos, migraciones y pruebas
- [x] Uso paso a paso de los nueve escenarios
- [x] Despliegue: Compose, Traefik, instancia real y riesgo del socket de Docker
- [x] Pruebas: inventario real y resultado ejecutado
- [x] Estructura de carpetas real
- [x] Roadmap, pendientes y limitaciones
- [x] Referencias bibliográficas *(las del documento académico quedan pendientes de pegar)*
- [x] Créditos y licencia *(sin `LICENSE`: señalado)*
- [x] Discrepancias detectadas (13 registradas)
- [x] Este checklist

### Verificaciones de exactitud

- [x] Ningún endpoint documentado que no exista en un controlador
- [x] Ninguna tabla documentada que no esté en `database/db.sql`
- [x] Versiones tomadas de `package.json`, `pom.xml` y `pubspec.yaml`, no de memoria
- [x] Cifra de pruebas obtenida **ejecutando** `npx vitest run`, no citando `PLAN.md`
- [x] Ausencia de CI/CD, `LICENSE`, pruebas del generador y pruebas del frontend verificada con búsqueda en disco
- [x] Nombres oficiales de CU01–CU10 respetados
- [x] Lo no implementado marcado como ❌ / ⚠️ / TODO, no omitido ni disimulado
- [x] No se modificó ningún archivo de código: sólo este `README.md`

### Pendiente de completar a mano

- [ ] Nombre del docente y de la universidad/carrera ([§3](#3-contexto-académico))
- [ ] Bibliografía del documento académico del parcial ([§22](#22-referencias-bibliográficas))
- [ ] Decidir y añadir `LICENSE` ([§23](#23-créditos-y-licencia))
