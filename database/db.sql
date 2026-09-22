-- ============================================================================
-- BASE DE DATOS: Herramienta CASE Colaborativa de Diseño de Datos
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- TIPOS ENUMERADOS
-- ============================================================================

CREATE TYPE project_role AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

CREATE TYPE relationship_type AS ENUM (
    'ASSOCIATION',
    'AGGREGATION',
    'COMPOSITION',
    'INHERITANCE',
    'REALIZATION',
    'DEPENDENCY'
);

-- Visibilidad UML. Se guarda en minúsculas porque son las mismas palabras que
-- usará el backend Spring Boot generado (CU07); 'package' es el acceso por
-- defecto de Java, que no se escribe delante del miembro.
CREATE TYPE uml_visibility AS ENUM ('public', 'private', 'protected', 'package');

CREATE TYPE ai_input_type AS ENUM ('VOICE', 'TEXT');

CREATE TYPE job_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TYPE codegen_status AS ENUM ('PENDING', 'GENERATING', 'COMPILING', 'SUCCESS', 'FAILED');

CREATE TYPE xmi_direction AS ENUM ('IMPORT', 'EXPORT');

-- Qué se tocó en un cambio del diagrama. 'DIAGRAM' es el propio diagrama:
-- cambiarle el nombre o la descripción también se registra.
CREATE TYPE diagram_entity_type AS ENUM
  ('CLASS', 'ATTRIBUTE', 'METHOD', 'RELATIONSHIP', 'DIAGRAM');

-- ============================================================================
-- FUNCIÓN GENÉRICA PARA updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1. USUARIOS
-- ============================================================================

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name       VARCHAR(150) NOT NULL,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    avatar_url      VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 2. PROYECTOS Y COLABORACIÓN
-- ============================================================================

CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(150) NOT NULL,
    description     TEXT,
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE project_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role            project_role NOT NULL DEFAULT 'EDITOR',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id)
);

CREATE INDEX idx_project_members_project ON project_members(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);

-- ============================================================================
-- 3. DIAGRAMAS
--    El modelo UML no vive aquí: vive estructurado en las tablas del punto 4.
--    Esta tabla sólo guarda de qué diagrama se trata y a qué proyecto
--    pertenece.
--
--    Aquí hubo un `crdt_state BYTEA` y una tabla `diagram_versions` con
--    instantáneas de un documento Yjs. Se quitaron: la colaboración de CU03 no
--    usa CRDT —difunde cada cambio ya guardado a la sala— y esas columnas
--    nunca llegaron a escribirse. Un esquema con restos de un diseño que no se
--    llevó a cabo confunde a quien lo lee después.
-- ============================================================================

CREATE TABLE diagrams (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name                VARCHAR(150) NOT NULL,
    description         TEXT,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagrams_project ON diagrams(project_id);

CREATE TRIGGER trg_diagrams_updated_at
    BEFORE UPDATE ON diagrams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 4. MODELO UML RELACIONAL (clases, atributos, métodos, relaciones)
--    Representación consultable del diagrama: la usan el generador de
--    código, el módulo XMI y las validaciones.
-- ============================================================================

CREATE TABLE uml_classes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id      UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    stereotype      VARCHAR(50),        -- entity, interface, service, enumeration
    is_abstract     BOOLEAN NOT NULL DEFAULT FALSE,
    visibility      uml_visibility NOT NULL DEFAULT 'public',
    pos_x           DOUBLE PRECISION NOT NULL DEFAULT 0,
    pos_y           DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- NULL = tamaño automático según el contenido; sólo tiene valor cuando el
    -- usuario redimensiona la clase a mano en el lienzo.
    width           DOUBLE PRECISION,
    height          DOUBLE PRECISION,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (diagram_id, name)
);

CREATE INDEX idx_uml_classes_diagram ON uml_classes(diagram_id);

CREATE TRIGGER trg_uml_classes_updated_at
    BEFORE UPDATE ON uml_classes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE uml_attributes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id        UUID NOT NULL REFERENCES uml_classes(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    -- NULL = el atributo existe pero aún no se sabe de qué tipo es. Ocurre al
    -- importar una imagen (CU05) donde la caja sólo lista nombres, y al
    -- esbozar una clase antes de decidir los tipos.
    data_type       VARCHAR(50),                -- String, Integer, Long, BigDecimal, LocalDate...
    visibility      uml_visibility NOT NULL DEFAULT 'private',
    -- Ya no se usa: la clave primaria de una entidad es siempre «id», la pone
    -- la herramienta y no se declara como atributo. La aplicación no la lee ni
    -- la escribe, y la columna se conserva sólo para no tocar las filas ya
    -- guardadas; puede borrarse cuando convenga.
    is_primary_key  BOOLEAN NOT NULL DEFAULT FALSE,
    is_nullable     BOOLEAN NOT NULL DEFAULT TRUE,
    is_unique       BOOLEAN NOT NULL DEFAULT FALSE,
    default_value   VARCHAR(255),
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (class_id, name)
);

CREATE INDEX idx_uml_attributes_class ON uml_attributes(class_id);

CREATE TRIGGER trg_uml_attributes_updated_at
    BEFORE UPDATE ON uml_attributes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE uml_methods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id        UUID NOT NULL REFERENCES uml_classes(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    -- 150 y no 50: el retorno puede ser una clase del propio diagrama, y
    -- uml_classes.name admite 150 caracteres.
    return_type     VARCHAR(150) NOT NULL DEFAULT 'void',
    visibility      uml_visibility NOT NULL DEFAULT 'public',
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_uml_methods_class ON uml_methods(class_id);

-- Parámetros de un método: «actualizar(nombre : String)». Su tipo puede ser un
-- tipo del catálogo o una clase del diagrama, igual que el de retorno.
CREATE TABLE uml_method_parameters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    method_id       UUID NOT NULL REFERENCES uml_methods(id) ON DELETE CASCADE,
    name            VARCHAR(150) NOT NULL,
    data_type       VARCHAR(150) NOT NULL,
    order_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (method_id, name)
);

CREATE INDEX idx_uml_method_parameters_method ON uml_method_parameters(method_id);

CREATE TABLE uml_relationships (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id              UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    source_class_id         UUID NOT NULL REFERENCES uml_classes(id) ON DELETE CASCADE,
    target_class_id         UUID NOT NULL REFERENCES uml_classes(id) ON DELETE CASCADE,
    relationship_type       relationship_type NOT NULL,
    source_multiplicity     VARCHAR(10),   -- '1', '0..1', '0..*', '1..*'
    target_multiplicity     VARCHAR(10),
    name                    VARCHAR(150),
    source_role             VARCHAR(100),
    target_role             VARCHAR(100),
    is_navigable_source     BOOLEAN NOT NULL DEFAULT TRUE,
    is_navigable_target     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_uml_relationships_diagram ON uml_relationships(diagram_id);
CREATE INDEX idx_uml_relationships_source ON uml_relationships(source_class_id);
CREATE INDEX idx_uml_relationships_target ON uml_relationships(target_class_id);

CREATE TRIGGER trg_uml_relationships_updated_at
    BEFORE UPDATE ON uml_relationships
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- 5. AGENTE DE IA (auditoría de comandos por voz/texto)
-- ============================================================================

CREATE TABLE ai_command_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id          UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    input_type          ai_input_type NOT NULL,
    raw_input           TEXT NOT NULL,
    transcribed_text    TEXT,
    resolved_operation  VARCHAR(50),        -- CREATE_CLASS, ADD_ATTRIBUTE, CREATE_RELATIONSHIP...
    operation_payload   JSONB,
    status              VARCHAR(20) NOT NULL DEFAULT 'SUCCESS'
                        CHECK (status IN ('SUCCESS', 'FAILED', 'REJECTED')),
    error_message       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_command_logs_diagram ON ai_command_logs(diagram_id);

-- ============================================================================
-- 6. IMPORTACIÓN DE DIAGRAMA DESDE FOTO
-- ============================================================================

CREATE TABLE photo_import_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id      UUID REFERENCES diagrams(id) ON DELETE SET NULL,
    user_id         UUID NOT NULL REFERENCES users(id),
    -- De la imagen queda su descripción, nunca la imagen ni una referencia a
    -- ella: se le enseña al modelo en la misma petición en la que llega y se
    -- descarta. Lo que se leyó está en extracted_model.
    original_file_name   VARCHAR(255) NOT NULL,
    mime_type            VARCHAR(100) NOT NULL,
    file_size            INTEGER NOT NULL,
    status          job_status NOT NULL DEFAULT 'PENDING',
    extracted_model JSONB,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_photo_import_jobs_diagram ON photo_import_jobs(diagram_id);

-- ============================================================================
-- 7. INTERCAMBIO XMI CON ENTERPRISE ARCHITECT
-- ============================================================================

-- De un intercambio queda su registro, no el archivo: quién, cuándo, en qué
-- sentido y con qué nombre de archivo. Es la misma regla que en CU05 con las
-- imágenes; el .xmi se genera al vuelo al exportar y se descarta en cuanto se
-- ha leído al importar.
CREATE TABLE xmi_exchange_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id      UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    direction       xmi_direction NOT NULL,
    file_name       VARCHAR(255) NOT NULL,
    status          job_status NOT NULL DEFAULT 'PENDING',
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_xmi_exchange_jobs_diagram ON xmi_exchange_jobs(diagram_id);

-- ============================================================================
-- 8. GENERACIÓN DE CÓDIGO (backend Spring Boot generado)
-- ============================================================================

CREATE TABLE code_generation_jobs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id              UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    requested_by            UUID NOT NULL REFERENCES users(id),
    status                  codegen_status NOT NULL DEFAULT 'PENDING',
    output_artifact_url     VARCHAR(500),   -- ubicación del .zip generado
    compile_check_passed    BOOLEAN,
    -- Además de compilar, el backend generado arrancó contra una PostgreSQL y
    -- contestó. NULL = no se llegó a probarlo: la comprobación necesita una
    -- base de pruebas (SMOKE_DB_URL) y sin ella el paso se salta.
    smoke_check_passed      BOOLEAN,
    error_message           TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ
);

CREATE INDEX idx_code_generation_jobs_diagram ON code_generation_jobs(diagram_id);

-- ============================================================================
-- 8b. PUBLICACIÓN DEL BACKEND GENERADO
--     Un backend generado puesto en marcha y accesible por una URL pública.
--     Publicar no es un caso de uso: es una operación de CU07, el paso que
--     sigue a generarlo y descargarlo.
-- ============================================================================

CREATE TYPE deployment_status AS ENUM
  ('PENDING', 'BUILDING', 'STARTING', 'RUNNING', 'FAILED', 'STOPPED');

CREATE TABLE backend_deployments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id      UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    -- De qué generación salió. Si esa generación se borra el despliegue sigue
    -- en pie: el contenedor está corriendo, sólo se pierde de dónde vino.
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
    -- Un despliegue por diagrama: publicar otra vez reemplaza el anterior.
    UNIQUE (diagram_id)
);

-- ============================================================================
-- 9. BITÁCORA DE CAMBIOS DEL DIAGRAMA (auditoría a nivel de operación)
-- ============================================================================

CREATE TABLE diagram_change_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diagram_id      UUID NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id),
    operation_type  VARCHAR(50) NOT NULL,   -- CREATE, UPDATE, DELETE, MOVE...
    entity_type     diagram_entity_type NOT NULL,
    entity_id       UUID,
    payload         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagram_change_log_diagram ON diagram_change_log(diagram_id);
CREATE INDEX idx_diagram_change_log_created_at ON diagram_change_log(created_at);