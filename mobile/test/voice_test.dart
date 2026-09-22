import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/voice/grammar.dart';
import 'package:mobile/features/voice/operations.dart';

import 'meta_fixture.dart';

/// El asistente de voz, sin voz: se le dan las frases ya transcritas.
///
/// Lo que se comprueba aquí es lo que sostiene la demostración de la fase 3.
/// El modelo de lenguaje del teléfono puede acertar o no; la gramática tiene
/// que acertar siempre, y eso sí se puede probar.
void main() {
  final meta = ventasMeta();
  final grammar = GrammarInterpreter(meta);
  final validator = OperationValidator(meta);

  List<PlannedOperation> understand(String dictation) =>
      validator.validate(grammar.interpret(dictation));

  group('la gramática', () {
    test('entiende un alta con el campo nombrado', () {
      final operations = understand('registrar cliente nombre Juan');

      expect(operations, hasLength(1));
      expect(operations.first.kind, OperationKind.create);
      expect(operations.first.entity.name, 'CLIENTE');
      expect(operations.first.values['nombre'], 'Juan');
    });

    test('entiende varios campos nombrados', () {
      final operations =
          understand('crear cliente nombre Ana telefono 777123');

      expect(operations.first.values['nombre'], 'Ana');
      expect(operations.first.values['telefono'], '777123');
    });

    test('entiende un alta sin nombrar el campo', () {
      // «registrar cliente Juan Pérez»: lo dictado después de la entidad va al
      // primer texto obligatorio, que es como se habla de verdad.
      final operations = understand('registrar cliente Juan Pérez');

      expect(operations.first.values['nombre'], 'Juan Pérez');
    });

    test('no se pierde con las tildes ni con el voseo', () {
      final operations = understand('registrá al cliente nombre Martín');

      expect(operations, hasLength(1));
      expect(operations.first.values['nombre'], 'Martín');
    });

    test('la frase del enunciado: dos operaciones encadenadas', () {
      // «registrá al cliente X y cobrale 10 pesos» es el ejemplo del
      // enunciado, y lo que tiene que salir son dos altas: el cliente y su
      // nota de venta apuntando a él.
      final operations =
          understand('registrar cliente nombre Juan y cobrarle 10 pesos');

      expect(operations, hasLength(2));

      expect(operations[0].entity.name, 'CLIENTE');
      expect(operations[0].values['nombre'], 'Juan');

      expect(operations[1].entity.name, 'NOTAVENTA');
      expect(operations[1].values['monto'], 10);
      // La nota apunta al cliente de la operación anterior.
      expect(operations[1].references['cliente'], 'CLIENTE');
    });

    test('entiende un borrado', () {
      final operations = understand('borrar cliente nombre Juan');

      expect(operations.first.kind, OperationKind.delete);
      expect(operations.first.entity.name, 'CLIENTE');
    });

    test('reconoce la entidad en plural', () {
      final operations = understand('crear clientes nombre Rosa');

      expect(operations.first.entity.name, 'CLIENTE');
    });

    test('no inventa nada cuando no entiende', () {
      expect(understand('qué hora es'), isEmpty);
      expect(understand(''), isEmpty);
    });
  });

  group('la comprobación contra el modelo', () {
    test('descarta una entidad que no existe', () {
      final operations = validator.validate([
        {'op': 'CREATE', 'entity': 'DINOSAURIO', 'values': {}},
      ]);

      expect(operations, isEmpty);
    });

    test('descarta una clase abstracta: no tiene API que llamar', () {
      final operations = validator.validate([
        {'op': 'CREATE', 'entity': 'PERSONA', 'values': {}},
      ]);

      expect(operations, isEmpty);
    });

    test('descarta un campo que la entidad no tiene, y lo dice', () {
      final operations = validator.validate([
        {
          'op': 'CREATE',
          'entity': 'CLIENTE',
          'values': {'nombre': 'Ana', 'color': 'azul'},
        },
      ]);

      expect(operations.first.values.containsKey('color'), isFalse);
      expect(operations.first.values['nombre'], 'Ana');
      expect(
        operations.first.warnings.any((w) => w.contains('color')),
        isTrue,
      );
    });

    test('descarta un valor que no encaja con el tipo', () {
      final operations = validator.validate([
        {
          'op': 'CREATE',
          'entity': 'NOTAVENTA',
          'values': {'monto': 'mucho'},
        },
      ]);

      expect(operations.first.values['monto'], isNull);
      expect(operations.first.warnings, isNotEmpty);
    });

    test('avisa de un obligatorio que falta, pero deja pasar la operación', () {
      // Se manda igual: el 400 del backend señala el campo mejor que cualquier
      // mensaje inventado aquí.
      final operations = validator.validate([
        {'op': 'CREATE', 'entity': 'CLIENTE', 'values': {}},
      ]);

      expect(operations, hasLength(1));
      expect(
        operations.first.warnings.any((w) => w.contains('nombre')),
        isTrue,
      );
    });

    test('una operación que no es CREATE ni DELETE se ignora', () {
      final operations = validator.validate([
        {'op': 'DROP TABLE', 'entity': 'CLIENTE', 'values': {}},
      ]);

      expect(operations, isEmpty);
    });

    test('lo que no es un objeto se ignora sin romperse', () {
      expect(validator.validate(['basura', 42, null]), isEmpty);
    });
  });
}
