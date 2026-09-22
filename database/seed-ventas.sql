-- ============================================================================
-- Datos de prueba: el diagrama «Sistema de ventas» de la demostración.
--
-- Deja dibujado, en un proyecto nuevo del usuario que se indique, el diagrama
-- que usa DEMO.md: una jerarquía con clase abstracta, un uno-a-muchos, un
-- muchos-a-muchos y una composición. Es a propósito el caso completo, porque
-- es el que ejercita todo lo que el generador tiene que saber resolver.
--
--     PERSONA (abstracta)
--        ├── CLIENTE ──1─────0..*── NOTAVENTA ──0..*───1..*── PRODUCTO
--        └── EMPLEADO                                            │
--                                             CATEGORIA ──1──◆──0..*
--
-- Cómo se ejecuta:
--
--     psql "$DATABASE_URL" -f database/seed-ventas.sql
--
-- El proyecto queda a nombre del primer usuario registrado. Si en la base hay
-- varios y se quiere uno en concreto:
--
--     psql "$DATABASE_URL" -v email=alguien@ejemplo.com -f database/seed-ventas.sql
--
-- Se puede ejecutar varias veces: borra antes el proyecto que hubiera creado.
-- ============================================================================

\set ON_ERROR_STOP on

-- Sin -v email, la variable no existe y se deja vacía.
\if :{?email}
\else
  \set email ''
\endif

SELECT set_config('demo.email', :'email', false);

DO $$
DECLARE
    v_email      TEXT := current_setting('demo.email', true);
    v_user       UUID;
    v_project    UUID;
    v_diagram    UUID;

    c_persona    UUID;
    c_cliente    UUID;
    c_empleado   UUID;
    c_notaventa  UUID;
    c_producto   UUID;
    c_categoria  UUID;
BEGIN
    -- Sin correo se toma el primer usuario, que en una base de demostración es
    -- lo que uno espera; con varios usuarios conviene indicarlo.
    IF v_email IS NULL OR v_email = '' THEN
        SELECT id INTO v_user FROM users ORDER BY created_at LIMIT 1;
    ELSE
        SELECT id INTO v_user FROM users WHERE email = v_email;
    END IF;

    IF v_user IS NULL THEN
        RAISE EXCEPTION 'No hay ningún usuario. Regístrese en la herramienta antes de cargar los datos de prueba.';
    END IF;

    -- Volver a ejecutarlo rehace el proyecto en vez de duplicarlo.
    DELETE FROM projects WHERE owner_id = v_user AND name = 'Demostración';

    INSERT INTO projects (name, description, owner_id)
    VALUES ('Demostración',
            'Proyecto con el diagrama de la demostración.',
            v_user)
    RETURNING id INTO v_project;

    INSERT INTO diagrams (project_id, name, description, created_by)
    VALUES (v_project,
            'Sistema de ventas',
            'Clientes, empleados, notas de venta y productos.',
            v_user)
    RETURNING id INTO v_diagram;

    -- ---------------------------------------------------------------- clases
    -- Las posiciones son las del lienzo; están puestas a mano para que el
    -- diagrama se lea de un vistazo al abrirlo y no haya que recolocarlo
    -- delante del docente.

    INSERT INTO uml_classes (diagram_id, name, is_abstract, pos_x, pos_y)
    VALUES (v_diagram, 'PERSONA', TRUE, 360, 40) RETURNING id INTO c_persona;

    INSERT INTO uml_classes (diagram_id, name, pos_x, pos_y)
    VALUES (v_diagram, 'CLIENTE', 160, 280) RETURNING id INTO c_cliente;

    INSERT INTO uml_classes (diagram_id, name, pos_x, pos_y)
    VALUES (v_diagram, 'EMPLEADO', 580, 280) RETURNING id INTO c_empleado;

    INSERT INTO uml_classes (diagram_id, name, pos_x, pos_y)
    VALUES (v_diagram, 'NOTAVENTA', 160, 540) RETURNING id INTO c_notaventa;

    INSERT INTO uml_classes (diagram_id, name, pos_x, pos_y)
    VALUES (v_diagram, 'PRODUCTO', 620, 540) RETURNING id INTO c_producto;

    INSERT INTO uml_classes (diagram_id, name, pos_x, pos_y)
    VALUES (v_diagram, 'CATEGORIA', 620, 800) RETURNING id INTO c_categoria;

    -- ------------------------------------------------------------- atributos
    -- Ninguna lleva «id»: la clave primaria la pone la herramienta y no se
    -- declara como atributo.

    INSERT INTO uml_attributes (class_id, name, data_type, is_nullable, is_unique, order_index)
    VALUES
        (c_persona,   'nombre',        'String',        FALSE, FALSE, 0),
        (c_persona,   'documento',     'String',        FALSE, TRUE,  1),

        (c_cliente,   'telefono',      'String',        TRUE,  FALSE, 0),
        (c_cliente,   'observaciones', 'Text',          TRUE,  FALSE, 1),

        (c_empleado,  'salario',       'BigDecimal',    FALSE, FALSE, 0),
        (c_empleado,  'ingreso',       'LocalDate',     TRUE,  FALSE, 1),

        (c_notaventa, 'fecha',         'LocalDateTime', FALSE, FALSE, 0),
        (c_notaventa, 'monto',         'BigDecimal',    FALSE, FALSE, 1),

        (c_producto,  'descripcion',   'String',        FALSE, FALSE, 0),
        (c_producto,  'precio',        'BigDecimal',    FALSE, FALSE, 1),
        (c_producto,  'stock',         'Integer',       FALSE, FALSE, 2),

        (c_categoria, 'nombre',        'String',        FALSE, TRUE,  0);

    -- Con valor por defecto, para que se vea que el generador lo traslada.
    INSERT INTO uml_attributes (class_id, name, data_type, is_nullable, default_value, order_index)
    VALUES (c_notaventa, 'anulada', 'Boolean', TRUE, 'false', 2);

    -- ----------------------------------------------------------- relaciones
    -- La convención de las multiplicidades es la de UML: cada una es la
    -- etiqueta de su extremo. «CLIENTE 1 — 0..* NOTAVENTA» se lee «un cliente
    -- tiene muchas notas, y cada nota es de un cliente».

    INSERT INTO uml_relationships
        (diagram_id, source_class_id, target_class_id, relationship_type,
         source_multiplicity, target_multiplicity, name)
    VALUES
        -- La jerarquía: dos clases que heredan de una abstracta.
        (v_diagram, c_cliente,   c_persona,   'INHERITANCE',  NULL,   NULL,   NULL),
        (v_diagram, c_empleado,  c_persona,   'INHERITANCE',  NULL,   NULL,   NULL),

        -- Uno a muchos: la clave foránea acaba en NOTAVENTA.
        (v_diagram, c_cliente,   c_notaventa, 'ASSOCIATION',  '1',    '0..*', 'realiza'),

        -- El que atendió la venta: una segunda relación hacia la jerarquía.
        (v_diagram, c_empleado,  c_notaventa, 'ASSOCIATION',  '1',    '0..*', 'atiende'),

        -- Muchos a muchos: se resuelve con una tabla intermedia.
        (v_diagram, c_notaventa, c_producto,  'ASSOCIATION',  '0..*', '1..*', 'detalle'),

        -- Composición: los productos no viven sin su categoría.
        (v_diagram, c_categoria, c_producto,  'COMPOSITION',  '1',    '0..*', 'agrupa');

    RAISE NOTICE 'Listo: proyecto «Demostración» con el diagrama «Sistema de ventas» (%).', v_diagram;
END $$;
