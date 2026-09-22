/// La descripción del modelo que publica cada backend generado en
/// `GET /api/_meta`.
///
/// Es el contrato entero de esta aplicación. No hay nada aquí que sepa de
/// clientes ni de notas de venta: las pantallas se arman leyendo esto, y por
/// eso una sola aplicación sirve para cualquier diagrama que la herramienta
/// haya generado y publicado.
library;

class ModelMeta {
  const ModelMeta({
    required this.diagram,
    required this.generatedAt,
    required this.entities,
  });

  /// El nombre del diagrama del que salió este backend.
  final String diagram;
  final String generatedAt;
  final List<EntityMeta> entities;

  /// Las que se pueden abrir: una clase abstracta tiene tabla pero no API.
  List<EntityMeta> get usable =>
      entities.where((entity) => !entity.isAbstract).toList();

  EntityMeta? byName(String name) {
    for (final entity in entities) {
      if (entity.name.toLowerCase() == name.toLowerCase()) return entity;
    }
    return null;
  }

  factory ModelMeta.fromJson(Map<String, dynamic> json) => ModelMeta(
        diagram: json['diagram'] as String? ?? 'Modelo',
        generatedAt: json['generated_at'] as String? ?? '',
        entities: (json['entities'] as List<dynamic>? ?? [])
            .map((item) => EntityMeta.fromJson(item as Map<String, dynamic>))
            .toList(),
      );
}

class EntityMeta {
  const EntityMeta({
    required this.name,
    required this.table,
    required this.path,
    required this.isAbstract,
    required this.parent,
    required this.idField,
    required this.versionField,
    required this.fields,
    required this.relations,
  });

  final String name;
  final String table;

  /// La ruta de su API, tal como la sirve el backend: `/api/clientes`.
  final String path;
  final bool isAbstract;

  /// De quién hereda, o null. Sus campos están en la entidad padre.
  final String? parent;

  /// La clave primaria. Nunca se pide en un formulario: la pone el backend.
  final SystemField idField;

  /// El contador de versión, con el que se detectan los conflictos (CU10).
  final SystemField versionField;

  final List<FieldMeta> fields;
  final List<RelationMeta> relations;

  /// Las relaciones que se pueden establecer al guardar: las que este lado
  /// guarda como una referencia y no como una colección. Las colecciones las
  /// devuelve el backend vacías a propósito, así que no hay nada que elegir.
  List<RelationMeta> get editableRelations =>
      relations.where((relation) => relation.isEditable).toList();

  factory EntityMeta.fromJson(Map<String, dynamic> json) => EntityMeta(
        name: json['name'] as String,
        table: json['table'] as String? ?? '',
        path: json['path'] as String,
        isAbstract: json['abstract'] as bool? ?? false,
        parent: json['extends'] as String?,
        idField: SystemField.fromJson(json['id'] as Map<String, dynamic>?),
        versionField:
            SystemField.fromJson(json['version'] as Map<String, dynamic>?),
        fields: (json['fields'] as List<dynamic>? ?? [])
            .map((item) => FieldMeta.fromJson(item as Map<String, dynamic>))
            .toList(),
        relations: (json['relations'] as List<dynamic>? ?? [])
            .map((item) => RelationMeta.fromJson(item as Map<String, dynamic>))
            .toList(),
      );
}

/// Un campo que pone el backend y que nadie escribe: `id` y `version`.
class SystemField {
  const SystemField({required this.name, required this.type});

  final String name;
  final String type;

  factory SystemField.fromJson(Map<String, dynamic>? json) => SystemField(
        name: json?['name'] as String? ?? 'id',
        type: json?['type'] as String? ?? 'Long',
      );
}

class FieldMeta {
  const FieldMeta({
    required this.name,
    required this.type,
    required this.required,
    required this.unique,
    required this.maxLength,
    required this.defaultValue,
  });

  /// El nombre tal como viaja en el JSON, que es el que hay que mandar.
  final String name;

  /// El tipo Java: String, Integer, Long, Double, Float, Boolean, BigDecimal,
  /// LocalDate, LocalDateTime o UUID.
  final String type;
  final bool required;
  final bool unique;

  /// Cuántos caracteres caben, o null si no hay tope (un TEXT).
  final int? maxLength;
  final String? defaultValue;

  /// Con qué teclado y con qué control se pide.
  FieldKind get kind => switch (type) {
        'Boolean' => FieldKind.boolean,
        'Integer' || 'Long' => FieldKind.integer,
        'Double' || 'Float' || 'BigDecimal' => FieldKind.decimal,
        'LocalDate' => FieldKind.date,
        'LocalDateTime' => FieldKind.dateTime,
        _ => FieldKind.text,
      };

  factory FieldMeta.fromJson(Map<String, dynamic> json) => FieldMeta(
        name: json['name'] as String,
        type: json['type'] as String? ?? 'String',
        required: json['required'] as bool? ?? false,
        unique: json['unique'] as bool? ?? false,
        maxLength: json['maxLength'] as int?,
        defaultValue: json['default']?.toString(),
      );
}

enum FieldKind { text, integer, decimal, boolean, date, dateTime }

class RelationMeta {
  const RelationMeta({
    required this.field,
    required this.kind,
    required this.target,
    required this.owner,
    required this.joinColumn,
  });

  /// El nombre del campo en el JSON.
  final String field;

  /// MANY_TO_ONE, ONE_TO_MANY, ONE_TO_ONE o MANY_TO_MANY.
  final String kind;

  /// La entidad del otro extremo.
  final String target;

  /// Si este lado es el que lleva la clave foránea.
  final bool owner;
  final String? joinColumn;

  /// Si se puede elegir en el formulario.
  ///
  /// Sólo las referencias de las que este lado es propietario: son las únicas
  /// que viajan en el JSON y las únicas que el backend sabe guardar desde
  /// aquí. Una colección —las facturas de un cliente— se cambia desde el otro
  /// lado, dando de alta la factura y diciendo de quién es.
  bool get isEditable =>
      owner && (kind == 'MANY_TO_ONE' || kind == 'ONE_TO_ONE');

  factory RelationMeta.fromJson(Map<String, dynamic> json) => RelationMeta(
        field: json['field'] as String,
        kind: json['kind'] as String? ?? 'MANY_TO_ONE',
        target: json['target'] as String,
        owner: json['owner'] as bool? ?? false,
        joinColumn: json['joinColumn'] as String?,
      );
}
