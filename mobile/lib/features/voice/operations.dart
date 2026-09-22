import '../../api/meta.dart';
import '../entities/field_values.dart';

/// CU09 — Lo que el asistente entendió, ya comprobado contra el modelo.
///
/// El patrón es el mismo que funciona en el lienzo (CU04) y funciona por lo
/// mismo: **el modelo propone y el código valida**. Lo que llega del intérprete
/// —sea el modelo de lenguaje del teléfono o la gramática— es una intención, no
/// una orden. Aquí se comprueba contra `/api/_meta` que la entidad exista, que
/// los campos existan y que los valores encajen con su tipo; lo que no encaje
/// se descarta diciendo por qué, en vez de mandarse y fallar en el servidor.

/// La referencia a lo que creó una operación anterior del mismo dictado.
///
/// Es lo que permite «registrá al cliente Juan y cobrale 10 pesos»: la nota de
/// venta apunta al cliente que todavía no existe cuando se interpreta la
/// frase. Al ejecutar, se sustituye por el identificador que acabó teniendo.
const String referenceMarker = '<ref>';

enum OperationKind { create, delete }

/// Una operación pensada pero todavía no ejecutada.
class PlannedOperation {
  PlannedOperation({
    required this.kind,
    required this.entity,
    required this.values,
    this.references = const {},
    this.warnings = const [],
  });

  final OperationKind kind;
  final EntityMeta entity;

  /// Los campos con valor, ya convertidos al tipo que toca.
  final Map<String, Object?> values;

  /// Las relaciones: el campo y a qué entidad apunta. El valor se resuelve al
  /// ejecutar, porque puede ser algo que aún no existe.
  final Map<String, String> references;

  /// Lo que se descartó y por qué. Se enseña: que el asistente ignore medio
  /// dictado en silencio es peor que no entenderlo.
  final List<String> warnings;

  String get title => switch (kind) {
        OperationKind.create => 'Dar de alta ${entity.name}',
        OperationKind.delete => 'Borrar ${entity.name}',
      };

  String get detail {
    final parts = <String>[
      for (final entry in values.entries)
        if (entry.value != null) '${entry.key}: ${entry.value}',
      for (final entry in references.entries)
        '${entry.key}: el ${entry.value} de antes',
    ];

    return parts.isEmpty ? 'sin datos' : parts.join(' · ');
  }
}

/// Comprueba lo que propuso el intérprete contra el modelo.
class OperationValidator {
  const OperationValidator(this.meta);

  final ModelMeta meta;

  /// Convierte el JSON del intérprete en operaciones que se pueden ejecutar.
  ///
  /// Nunca lanza: lo que no se entiende se queda fuera con su motivo. Un
  /// dictado del que se aprovecha la mitad es mejor que uno que se pierde
  /// entero porque una palabra no se reconoció.
  List<PlannedOperation> validate(List<dynamic> proposed) {
    final result = <PlannedOperation>[];

    for (final item in proposed) {
      if (item is! Map) continue;

      final raw = Map<String, dynamic>.from(item);
      final operation = _one(raw);

      if (operation != null) result.add(operation);
    }
    return result;
  }

  PlannedOperation? _one(Map<String, dynamic> raw) {
    final kind = switch (raw['op']?.toString().toUpperCase()) {
      'CREATE' || 'ALTA' || 'INSERT' => OperationKind.create,
      'DELETE' || 'BORRAR' => OperationKind.delete,
      // BUSCAR o UPDATE se reconocerían aquí; por ahora el asistente sólo da
      // de alta y borra, que es lo que la demostración necesita.
      _ => null,
    };
    if (kind == null) return null;

    final entity = meta.byName(raw['entity']?.toString() ?? '');
    if (entity == null || entity.isAbstract) return null;

    final warnings = <String>[];
    final values = <String, Object?>{};
    final references = <String, String>{};

    final proposedValues = raw['values'];
    if (proposedValues is Map) {
      for (final entry in Map<String, dynamic>.from(proposedValues).entries) {
        _assign(entity, entry.key, entry.value, values, references, warnings);
      }
    }

    // Un alta a la que le falta un campo obligatorio se deja pasar igual: el
    // backend contestará con un 400 señalándolo, que es un mensaje mejor que
    // cualquiera que se pudiera inventar aquí.
    for (final field in entity.fields) {
      if (field.required && values[field.name] == null) {
        warnings.add('Falta «${field.name}», que es obligatorio.');
      }
    }

    return PlannedOperation(
      kind: kind,
      entity: entity,
      values: values,
      references: references,
      warnings: warnings,
    );
  }

  /// Coloca un valor donde corresponda, o lo descarta diciendo por qué.
  void _assign(
    EntityMeta entity,
    String name,
    Object? value,
    Map<String, Object?> values,
    Map<String, String> references,
    List<String> warnings,
  ) {
    final field = _field(entity, name);

    if (field != null) {
      final parsed = FieldValues.parse(field, value?.toString() ?? '');

      if (parsed == null && value != null && value.toString().isNotEmpty) {
        warnings.add('«$value» no sirve para ${field.name}.');
        return;
      }
      // Que el tipo encaje: un texto donde va un número no se manda.
      if (parsed != null && !_fits(field, parsed)) {
        warnings.add('«$value» no es un ${field.type} válido para ${field.name}.');
        return;
      }
      values[field.name] = parsed;
      return;
    }

    final relation = _relation(entity, name);
    if (relation != null) {
      references[relation.field] = relation.target;
      return;
    }
    warnings.add('${entity.name} no tiene ningún campo «$name».');
  }

  /// El campo por su nombre, sin distinguir mayúsculas ni tildes: quien dicta
  /// no escribe, y el reconocedor no siempre acentúa igual.
  FieldMeta? _field(EntityMeta entity, String name) {
    final wanted = _normalize(name);

    for (final field in entity.fields) {
      if (_normalize(field.name) == wanted) return field;
    }
    return null;
  }

  RelationMeta? _relation(EntityMeta entity, String name) {
    final wanted = _normalize(name);

    for (final relation in entity.editableRelations) {
      if (_normalize(relation.field) == wanted ||
          _normalize(relation.target) == wanted) {
        return relation;
      }
    }
    return null;
  }

  bool _fits(FieldMeta field, Object value) => switch (field.kind) {
        FieldKind.integer => value is int,
        FieldKind.decimal => value is num,
        FieldKind.boolean => value is bool,
        _ => true,
      };

  static String _normalize(String text) {
    const accents = 'áéíóúüñÁÉÍÓÚÜÑ';
    const plain = 'aeiouunAEIOUUN';

    final buffer = StringBuffer();
    for (final character in text.toLowerCase().runes) {
      final letter = String.fromCharCode(character);
      final index = accents.indexOf(letter);

      buffer.write(index >= 0 ? plain[index] : letter);
    }
    return buffer.toString().replaceAll(RegExp(r'[^a-z0-9]'), '');
  }

  /// Público para que la gramática use la misma normalización y no haya dos
  /// formas distintas de comparar un nombre.
  static String normalize(String text) => _normalize(text);
}
