import '../../api/meta.dart';
import 'operations.dart';

/// CU09 — El intérprete determinista.
///
/// Existe porque la demostración no puede depender de que un modelo de mil
/// millones de parámetros acierte a la primera, en un teléfono, delante del
/// docente. Esto no acierta más que el modelo: acierta *siempre lo mismo*, que
/// es lo que hace falta cuando hay que enseñar que funciona.
///
/// Lo que entiende es una frase con forma de orden: un verbo, una entidad, y
/// pares de campo y valor. «registrar cliente nombre Juan teléfono 777».
/// Varias órdenes encadenadas con «y» se reparten en varias operaciones, y un
/// pronombre —«cobrarle», «su»— ata la segunda con lo que creó la primera.
///
/// Devuelve el mismo JSON que devolvería el modelo, de modo que lo de después
/// —comprobar contra `_meta` y ejecutar— es idéntico venga de donde venga.
class GrammarInterpreter {
  const GrammarInterpreter(this.meta);

  final ModelMeta meta;

  /// Verbos que dan de alta.
  static const _create = {
    'registrar', 'registra', 'registrá', 'registro',
    'crear', 'crea', 'creá', 'creo',
    'agregar', 'agrega', 'agregá', 'agrego',
    'añadir', 'añade', 'anadir', 'anade',
    'alta', 'nuevo', 'nueva', 'guardar', 'guarda', 'anotar', 'anota',
    'cargar', 'carga',
  };

  /// Verbos que borran.
  static const _delete = {
    'borrar', 'borra', 'borrá', 'eliminar', 'elimina', 'eliminá',
    'quitar', 'quita', 'sacar', 'saca',
  };

  /// Verbos que cobran: dan de alta algo con un importe. Es el caso del
  /// enunciado —«cobrale 10 pesos»— y por eso se trata aparte: el importe va
  /// pegado al verbo, sin nombrar el campo.
  static const _charge = {
    'cobrar', 'cobra', 'cobrá', 'cobrale', 'cobrarle', 'cobrales', 'facturar',
    'factura', 'vender', 'vende', 'vendé',
  };

  /// Palabras que no aportan y estorban al emparejar campos con valores.
  static const _noise = {
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'al', 'a', 'de',
    'del', 'con', 'y', 'e', 'que', 'su', 'sus', 'le', 'les', 'lo', 'por',
    'para', 'en', 'pesos', 'peso', 'bolivianos', 'boliviano', 'dolares',
    'dólares', 'euros', 'euro',
  };

  /// Interpreta el dictado. Devuelve la misma forma que el modelo local.
  List<Map<String, dynamic>> interpret(String dictation) {
    final operations = <Map<String, dynamic>>[];

    for (final sentence in _split(dictation)) {
      final operation = _one(sentence, operations);

      if (operation != null) operations.add(operation);
    }
    return operations;
  }

  /// Corta el dictado en órdenes. Se parte por «y», por «,» y por «.», que es
  /// como se encadenan de viva voz.
  List<String> _split(String dictation) => dictation
      .split(RegExp(r'\s+y\s+|[,.;]+'))
      .map((part) => part.trim())
      .where((part) => part.isNotEmpty)
      .toList();

  Map<String, dynamic>? _one(String sentence, List<Map<String, dynamic>> before) {
    final words = _words(sentence);
    if (words.isEmpty) return null;

    final verb = _verb(words);
    if (verb == null) return null;

    if (verb == _Verb.charge) return _charged(words, before);

    final entity = _entity(words);
    if (entity == null) return null;

    return {
      'op': verb == _Verb.create ? 'CREATE' : 'DELETE',
      'entity': entity.name,
      'values': _pairs(words, entity),
    };
  }

  /// «cobrale 10 pesos»: dar de alta la entidad que registra importes,
  /// apuntando a lo que se acaba de crear.
  ///
  /// Cuál es esa entidad no se adivina: se busca en el modelo la que tenga un
  /// campo de dinero y una relación con lo anterior. Si el diagrama no tiene
  /// nada así, no se inventa nada y la orden se descarta.
  Map<String, dynamic>? _charged(
    List<String> words,
    List<Map<String, dynamic>> before,
  ) {
    final amount = _firstNumber(words);
    if (amount == null) return null;

    final previous = before.isEmpty ? null : before.last['entity'] as String?;

    final named = _entity(words);
    final entity = named ?? _chargeable(previous);
    if (entity == null) return null;

    final field = _moneyField(entity);
    if (field == null) return null;

    final values = <String, dynamic>{field.name: amount};

    // El enlace con lo anterior: la relación de esta entidad que apunte a lo
    // que se creó justo antes.
    if (previous != null) {
      for (final relation in entity.editableRelations) {
        if (relation.target == previous) {
          values[relation.field] = referenceMarker;
          break;
        }
      }
    }
    return {'op': 'CREATE', 'entity': entity.name, 'values': values};
  }

  /// La entidad que sirve para cobrar: tiene un campo de dinero y, si hay algo
  /// creado antes, una relación con ello.
  EntityMeta? _chargeable(String? previous) {
    EntityMeta? fallback;

    for (final entity in meta.usable) {
      if (_moneyField(entity) == null) continue;

      fallback ??= entity;
      if (previous == null) continue;

      for (final relation in entity.editableRelations) {
        if (relation.target == previous) return entity;
      }
    }
    return fallback;
  }

  /// Un campo donde cabe un importe: decimal, y a ser posible con nombre de
  /// dinero.
  FieldMeta? _moneyField(EntityMeta entity) {
    const names = {'monto', 'importe', 'total', 'precio', 'valor', 'cantidad'};

    for (final field in entity.fields) {
      if (field.kind != FieldKind.decimal) continue;
      if (names.contains(OperationValidator.normalize(field.name))) return field;
    }
    for (final field in entity.fields) {
      if (field.kind == FieldKind.decimal) return field;
    }
    return null;
  }

  _Verb? _verb(List<String> words) {
    for (final word in words) {
      final plain = OperationValidator.normalize(word);

      if (_charge.any((verb) => OperationValidator.normalize(verb) == plain)) {
        return _Verb.charge;
      }
      if (_create.any((verb) => OperationValidator.normalize(verb) == plain)) {
        return _Verb.create;
      }
      if (_delete.any((verb) => OperationValidator.normalize(verb) == plain)) {
        return _Verb.delete;
      }
    }
    // Sin verbo reconocible, si nombra una entidad se entiende que da de alta:
    // «cliente Juan teléfono 777» es una orden perfectamente clara.
    return _entity(words) == null ? null : _Verb.create;
  }

  /// La entidad nombrada, por su nombre o por su plural.
  EntityMeta? _entity(List<String> words) {
    for (final word in words) {
      final plain = OperationValidator.normalize(word);
      if (plain.isEmpty) continue;

      for (final entity in meta.usable) {
        final name = OperationValidator.normalize(entity.name);

        if (name == plain || _plural(name) == plain || name == _singular(plain)) {
          return entity;
        }
      }
    }
    return null;
  }

  /// Los pares campo-valor: una palabra que es el nombre de un campo, y lo que
  /// viene detrás hasta el siguiente nombre de campo.
  Map<String, dynamic> _pairs(List<String> words, EntityMeta entity) {
    final values = <String, dynamic>{};
    int? firstNamed;

    var index = 0;
    while (index < words.length) {
      final field = _fieldNamed(entity, words[index]);

      if (field == null) {
        index++;
        continue;
      }
      firstNamed ??= index;

      final value = <String>[];
      var next = index + 1;

      while (next < words.length && _fieldNamed(entity, words[next]) == null) {
        final word = words[next];

        if (!_noise.contains(OperationValidator.normalize(word))) {
          value.add(word);
        }
        next++;
      }

      if (value.isNotEmpty) values[field.name] = value.join(' ');
      index = next;
    }

    // Lo que se dictó entre la entidad y el primer campo nombrado —o hasta el
    // final, si no se nombró ninguno— es el valor del texto obligatorio. Es lo
    // que hace que «registrar cliente Juan» funcione sin decir «nombre».
    //
    // Antes sólo se miraba cuando no se había nombrado ningún campo, y en
    // «registrar cliente Juan con teléfono 777» el Juan se perdía. Es justo
    // como se habla, y como lo escribe el modelo de voz.
    final loose = _loose(words.sublist(0, firstNamed ?? words.length), entity);
    if (loose != null) {
      for (final MapEntry(:key, :value) in loose.entries) {
        values.putIfAbsent(key, () => value);
      }
    }
    return values;
  }

  /// «registrar cliente Juan Pérez»: lo que queda después de quitar el verbo,
  /// la entidad y el ruido, puesto en el primer campo de texto obligatorio.
  Map<String, dynamic>? _loose(List<String> words, EntityMeta entity) {
    FieldMeta? target;
    for (final field in entity.fields) {
      if (field.kind == FieldKind.text && field.required) {
        target = field;
        break;
      }
    }
    target ??= entity.fields
        .where((field) => field.kind == FieldKind.text)
        .firstOrNull;
    if (target == null) return null;

    final rest = <String>[];
    var seenEntity = false;

    for (final word in words) {
      final plain = OperationValidator.normalize(word);
      if (plain.isEmpty) continue;

      if (!seenEntity) {
        if (plain == OperationValidator.normalize(entity.name) ||
            _plural(OperationValidator.normalize(entity.name)) == plain) {
          seenEntity = true;
        }
        continue;
      }
      if (_noise.contains(plain)) continue;
      if (_isVerb(plain)) continue;
      if (RegExp(r'^\d+$').hasMatch(word)) continue;

      rest.add(word);
    }
    return rest.isEmpty ? null : {target.name: rest.join(' ')};
  }

  bool _isVerb(String plain) =>
      _create.any((verb) => OperationValidator.normalize(verb) == plain) ||
      _delete.any((verb) => OperationValidator.normalize(verb) == plain) ||
      _charge.any((verb) => OperationValidator.normalize(verb) == plain);

  FieldMeta? _fieldNamed(EntityMeta entity, String word) {
    final plain = OperationValidator.normalize(word);
    if (plain.isEmpty) return null;

    for (final field in entity.fields) {
      if (OperationValidator.normalize(field.name) == plain) return field;
    }
    return null;
  }

  num? _firstNumber(List<String> words) {
    for (final word in words) {
      final value = num.tryParse(word.replaceAll(',', '.'));
      if (value != null) return value;
    }
    return null;
  }

  List<String> _words(String sentence) => sentence
      .split(RegExp(r'\s+'))
      .map((word) => word.trim())
      .where((word) => word.isNotEmpty)
      .toList();

  static String _plural(String word) {
    if (word.isEmpty) return word;
    final last = word[word.length - 1];

    if ('aeiou'.contains(last)) return '${word}s';
    return '${word}es';
  }

  static String _singular(String word) {
    if (word.endsWith('es') && word.length > 3) {
      return word.substring(0, word.length - 2);
    }
    if (word.endsWith('s') && word.length > 2) {
      return word.substring(0, word.length - 1);
    }
    return word;
  }
}

enum _Verb { create, delete, charge }
