import '../../api/meta.dart';

/// La traducción entre lo que se escribe en un formulario y lo que viaja en el
/// JSON.
///
/// Está aparte de las pantallas porque lo usan tres: el formulario al guardar,
/// la lista al resumir un registro y el asistente de voz al comprobar que lo
/// que entendió encaja con el modelo.
class FieldValues {
  const FieldValues._();

  /// Convierte el texto escrito al tipo que espera el backend.
  ///
  /// Devuelve null cuando la casilla está vacía, que es lo que el backend
  /// entiende por «sin valor». Si el texto no se puede convertir se devuelve
  /// tal cual: será el backend quien lo rechace con su 400, y es mejor que el
  /// mensaje venga de quien manda que inventarse uno aquí.
  static Object? parse(FieldMeta field, String text) {
    final value = text.trim();
    if (value.isEmpty) return null;

    return switch (field.kind) {
      FieldKind.integer => int.tryParse(value) ?? value,
      FieldKind.decimal => num.tryParse(value.replaceAll(',', '.')) ?? value,
      FieldKind.boolean => value.toLowerCase() == 'true' || value == '1',
      _ => value,
    };
  }

  /// Lo que se pinta en la casilla cuando se abre un registro para editarlo.
  static String display(Object? value) {
    if (value == null) return '';
    if (value is bool) return value ? 'true' : 'false';

    return value.toString();
  }

  /// El texto con el que se reconoce un registro en una lista.
  ///
  /// El modelo no dice cuál de los campos es «el nombre», así que se toma el
  /// primer texto que tenga valor, que en la práctica es como se llama la cosa
  /// —nombre, descripción, razón social—. Si no hay ninguno, queda el
  /// identificador, que al menos distingue una fila de otra.
  static String label(EntityMeta entity, Map<String, dynamic> values) {
    for (final field in entity.fields) {
      if (field.kind != FieldKind.text) continue;

      final value = values[field.name];
      if (value != null && value.toString().trim().isNotEmpty) {
        return value.toString();
      }
    }

    for (final field in entity.fields) {
      final value = values[field.name];
      if (value != null && value.toString().trim().isNotEmpty) {
        return '${field.name}: $value';
      }
    }
    return '#${values[entity.idField.name] ?? '—'}';
  }

  /// La segunda línea de la lista: los demás campos, resumidos.
  static String summary(EntityMeta entity, Map<String, dynamic> values) {
    final parts = <String>[];

    for (final field in entity.fields) {
      final value = values[field.name];
      if (value == null || value.toString().trim().isEmpty) continue;

      parts.add('${field.name}: $value');
      if (parts.length == 3) break;
    }
    return parts.join(' · ');
  }

  /// El identificador de la entidad relacionada, sacado del objeto anidado que
  /// devuelve el backend: `{"cliente": {"id": 3, ...}}`.
  static String? referenceId(
    ModelMeta meta,
    RelationMeta relation,
    Map<String, dynamic> values,
  ) {
    final reference = values[relation.field];
    if (reference is! Map) return null;

    final target = meta.byName(relation.target);
    final id = reference[target?.idField.name ?? 'id'];

    return id?.toString();
  }

  /// Cómo se manda una relación al guardar: el objeto con sólo el
  /// identificador dentro, que es lo que el backend generado sabe resolver.
  static Map<String, Object>? reference(EntityMeta target, String? id) {
    if (id == null || id.isEmpty) return null;

    return {target.idField.name: int.tryParse(id) ?? id};
  }
}
