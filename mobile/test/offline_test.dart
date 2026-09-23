// Drift trae su propio `isNotNull` para construir condiciones SQL, que choca
// con el de las comprobaciones. Aquí sólo hace falta la base en memoria.
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/api/client.dart';
import 'package:mobile/api/meta.dart';
import 'package:mobile/offline/database.dart';
import 'package:mobile/offline/repository.dart';

import 'meta_fixture.dart';

/// CU10 — Que lo que se escribe sin red acabe en el servidor, y en orden.
///
/// Es el criterio de aceptación de la fase 4 probado sin teléfono: se apaga la
/// red del cliente falso, se hacen operaciones, se vuelve a encender y se mira
/// qué llegó. La parte que más importa es que una operación pueda depender de
/// otra —la nota de venta del cliente que se acaba de crear—, porque es lo que
/// obliga a traducir el identificador local por el de verdad.

/// Un backend de mentira: guarda en un mapa y se puede «desenchufar».
class FakeBackend extends BackendClient {
  FakeBackend() : super('https://ejemplo/d/ventas');

  /// Cuando está apagado, todo falla como si no hubiera red.
  bool online = true;

  /// Lo guardado, por entidad.
  final Map<String, List<Map<String, dynamic>>> rows = {};

  /// Lo que se pidió, en orden: es lo que se comprueba al final.
  final List<String> calls = [];

  int _nextId = 1;

  void _assertOnline() {
    if (!online) {
      throw const BackendFailure('Sin conexión.');
    }
  }

  @override
  Future<List<Map<String, dynamic>>> list(EntityMeta entity) async {
    _assertOnline();
    return List.of(rows[entity.name] ?? const []);
  }

  @override
  Future<Map<String, dynamic>> create(
    EntityMeta entity,
    Map<String, dynamic> values,
  ) async {
    _assertOnline();
    calls.add('CREATE ${entity.name}');

    final saved = {...values, entity.idField.name: _nextId++, 'version': 0};
    rows.putIfAbsent(entity.name, () => []).add(saved);

    return saved;
  }

  @override
  Future<Map<String, dynamic>> update(
    EntityMeta entity,
    Object id,
    Map<String, dynamic> values,
  ) async {
    _assertOnline();
    calls.add('UPDATE ${entity.name} $id');

    final list = rows[entity.name] ?? [];
    final index = list.indexWhere(
      (row) => row[entity.idField.name].toString() == id.toString(),
    );
    if (index < 0) throw const NotFoundFailure();

    final current = list[index];
    final incoming = values['version'];

    // El bloqueo optimista del backend generado: una versión vieja es un 409.
    if (incoming != null && incoming != current['version']) {
      throw const ConflictFailure('Lo cambió otra persona.');
    }
    final saved = {
      ...values,
      entity.idField.name: current[entity.idField.name],
      'version': (current['version'] as int) + 1,
    };
    list[index] = saved;

    return saved;
  }

  @override
  Future<void> delete(EntityMeta entity, Object id) async {
    _assertOnline();
    calls.add('DELETE ${entity.name} $id');

    (rows[entity.name] ?? []).removeWhere(
      (row) => row[entity.idField.name].toString() == id.toString(),
    );
  }

  @override
  Future<Map<String, dynamic>?> findById(EntityMeta entity, Object id) async {
    _assertOnline();

    for (final row in rows[entity.name] ?? const <Map<String, dynamic>>[]) {
      if (row[entity.idField.name].toString() == id.toString()) return row;
    }
    return null;
  }
}

void main() {
  late LocalDatabase database;
  late FakeBackend backend;
  late OfflineRepository repository;
  late ModelMeta meta;

  late EntityMeta cliente;
  late EntityMeta notaventa;

  setUp(() {
    database = LocalDatabase.forTesting(NativeDatabase.memory());
    backend = FakeBackend();
    meta = ventasMeta();
    repository = OfflineRepository(
      database: database,
      client: backend,
      meta: meta,
    );

    cliente = meta.byName('CLIENTE')!;
    notaventa = meta.byName('NOTAVENTA')!;
  });

  tearDown(() => database.close());

  test('con red, un alta va directa al servidor y no encola nada', () async {
    final saved = await repository.create(cliente, {'nombre': 'Juan'});

    expect(saved.dirty, isFalse);
    expect(saved.id, '1');
    expect(await repository.pendingCount(), 0);
    expect(backend.calls, ['CREATE CLIENTE']);
  });

  test('sin red, se guarda en local y se encola', () async {
    backend.online = false;

    final saved = await repository.create(cliente, {'nombre': 'Ana'});

    expect(saved.dirty, isTrue);
    expect(saved.isLocalOnly, isTrue);
    expect(await repository.pendingCount(), 1);
    expect(backend.calls, isEmpty);
  });

  test('sin red se puede leer lo último que se trajo', () async {
    await repository.create(cliente, {'nombre': 'Juan'});

    backend.online = false;
    final list = await repository.list(cliente);

    expect(list.fromNetwork, isFalse);
    expect(list.records, hasLength(1));
    expect(list.syncedAt, isNotNull);
  });

  test('el criterio de la fase 4: alta, edición y borrado sin red suben al volver',
      () async {
    // Un registro que ya existe en el servidor, para poder editarlo y borrarlo.
    final existente = await repository.create(cliente, {'nombre': 'Rosa'});
    final borrable = await repository.create(cliente, {'nombre': 'Pedro'});
    backend.calls.clear();

    backend.online = false;
    await repository.create(cliente, {'nombre': 'Nuevo'});
    await repository.update(cliente, existente.id, {'nombre': 'Rosa Editada'});
    await repository.delete(cliente, borrable.id);

    expect(await repository.pendingCount(), 3);

    backend.online = true;
    final outcome = await repository.sync();

    expect(outcome.sent, 3);
    expect(outcome.conflicts, 0);
    expect(await repository.pendingCount(), 0);

    final names = backend.rows['CLIENTE']!
        .map((row) => row['nombre'])
        .toList();
    expect(names, containsAll(['Rosa Editada', 'Nuevo']));
    expect(names, isNot(contains('Pedro')));
  });

  test('una operación que depende de otra: el id local se traduce', () async {
    backend.online = false;

    // Lo que sale de «registrá al cliente Juan y cobrale 10 pesos».
    final nuevo = await repository.create(cliente, {'nombre': 'Juan'});
    await repository.create(notaventa, {
      'monto': 10,
      'cliente': {'id': nuevo.id},
    });

    expect(nuevo.isLocalOnly, isTrue);
    expect(await repository.pendingCount(), 2);

    backend.online = true;
    final outcome = await repository.sync();

    expect(outcome.sent, 2);
    // El orden importa: primero el cliente, después su nota.
    expect(backend.calls, ['CREATE CLIENTE', 'CREATE NOTAVENTA']);

    // Y la nota apunta al identificador que puso el servidor, no al local.
    final nota = backend.rows['NOTAVENTA']!.single;
    expect(nota['cliente'], {'id': 1});
  });

  test('editar algo que aún no subió corrige el alta, no añade otra operación',
      () async {
    backend.online = false;

    final nuevo = await repository.create(cliente, {'nombre': 'Mal'});
    await repository.update(cliente, nuevo.id, {'nombre': 'Bien'});

    expect(await repository.pendingCount(), 1);

    backend.online = true;
    await repository.sync();

    expect(backend.calls, ['CREATE CLIENTE']);
    expect(backend.rows['CLIENTE']!.single['nombre'], 'Bien');
  });

  test('borrar algo que nunca subió no le llega al servidor', () async {
    backend.online = false;
    final nuevo = await repository.create(cliente, {'nombre': 'Efímero'});
    await repository.delete(cliente, nuevo.id);

    expect(await repository.pendingCount(), 0);

    backend.online = true;
    await repository.sync();

    expect(backend.calls, isEmpty);
  });

  test('un conflicto se marca y espera a que alguien elija', () async {
    final registro = await repository.create(cliente, {'nombre': 'Original'});

    // Otra persona lo cambia: sube a la versión 1.
    await backend.update(cliente, registro.id, {
      'nombre': 'De otro',
      'version': 0,
    });

    // Aquí se guarda con la versión vieja.
    await expectLater(
      repository.update(cliente, registro.id, {
        'nombre': 'El mío',
        'version': 0,
      }),
      throwsA(isA<ConflictFailure>()),
    );

    final conflicts = await repository.conflicts();
    expect(conflicts, hasLength(1));
    expect(conflicts.first.mine['nombre'], 'El mío');
    expect(conflicts.first.theirs?['nombre'], 'De otro');
  });

  test('resolver un conflicto quedándose con el del servidor', () async {
    final registro = await repository.create(cliente, {'nombre': 'Original'});
    await backend.update(cliente, registro.id, {
      'nombre': 'De otro',
      'version': 0,
    });
    await repository
        .update(cliente, registro.id, {'nombre': 'El mío', 'version': 0})
        .catchError((_) => throw const ConflictFailure(''))
        .then((_) {}, onError: (_) {});

    await repository.keepTheirs(cliente, registro.id);

    expect(await repository.conflicts(), isEmpty);
    expect(backend.rows['CLIENTE']!.single['nombre'], 'De otro');
  });

  test('resolver un conflicto quedándose con el propio pisa al servidor',
      () async {
    final registro = await repository.create(cliente, {'nombre': 'Original'});
    await backend.update(cliente, registro.id, {
      'nombre': 'De otro',
      'version': 0,
    });
    await repository
        .update(cliente, registro.id, {'nombre': 'El mío', 'version': 0})
        .then((_) {}, onError: (_) {});

    await repository.keepMine(cliente, registro.id);

    expect(await repository.conflicts(), isEmpty);
    expect(backend.rows['CLIENTE']!.single['nombre'], 'El mío');
  });

  test('refrescar del servidor no pisa lo que aún no ha subido', () async {
    backend.online = false;
    await repository.create(cliente, {'nombre': 'Sin subir'});

    backend.online = true;
    // El servidor tiene otra cosa; al traerla, lo pendiente sigue ahí.
    await backend.create(cliente, {'nombre': 'Del servidor'});

    final list = await repository.list(cliente);
    final names = list.records.map((r) => r.values['nombre']).toList();

    expect(names, containsAll(['Sin subir', 'Del servidor']));
  });

  test('sin red, la cola se queda quieta y no se desordena', () async {
    backend.online = false;
    await repository.create(cliente, {'nombre': 'Uno'});
    await repository.create(cliente, {'nombre': 'Dos'});

    final outcome = await repository.sync();

    expect(outcome.sent, 0);
    expect(await repository.pendingCount(), 2);
  });

  group('cuando el teléfono sabe que no hay red', () {
    // El repositorio de la aplicación pregunta al sistema si hay red. Aquí se
    // le contesta con el interruptor del backend falso.
    late OfflineRepository offline;
    var hasNetwork = true;

    setUp(() {
      hasNetwork = true;
      offline = OfflineRepository(
        database: database,
        client: backend,
        meta: meta,
        isOnline: () => hasNetwork,
      );
    });

    test('un alta no intenta hablar con el servidor', () async {
      // El servidor contestaría, pero el sistema dice que no hay red: no se le
      // pregunta. Es lo que hace que dar de alta en modo avión sea inmediato
      // en vez de esperar a que venza el plazo de la conexión.
      hasNetwork = false;

      final saved = await offline.create(cliente, {'nombre': 'Ana'});

      expect(saved.isLocalOnly, isTrue);
      expect(backend.calls, isEmpty);
      expect(await offline.pendingCount(), 1);
    });

    test('sincronizar sin red ni lo intenta', () async {
      hasNetwork = false;
      await offline.create(cliente, {'nombre': 'Ana'});

      final outcome = await offline.sync();

      expect(outcome.stoppedOffline, isTrue);
      expect(backend.calls, isEmpty);
    });

    test('dos ediciones sin red del mismo registro no dan un conflicto falso',
        () async {
      final rosa = await offline.create(cliente, {'nombre': 'Rosa'});
      backend.calls.clear();

      hasNetwork = false;
      await offline.update(cliente, rosa.id, {'nombre': 'Rosa 1', 'version': 0});
      await offline.update(cliente, rosa.id, {'nombre': 'Rosa 2', 'version': 0});

      // Una sola edición en la cola, con lo último que se escribió.
      expect(await offline.pendingCount(), 1);

      hasNetwork = true;
      final outcome = await offline.sync();

      expect(outcome.conflicts, 0);
      expect(backend.calls, ['UPDATE CLIENTE 1']);
      expect(backend.rows['CLIENTE']!.single['nombre'], 'Rosa 2');
    });

    test('con red, una edición no adelanta a la que espera en la cola',
        () async {
      final rosa = await offline.create(cliente, {'nombre': 'Rosa'});
      backend.calls.clear();

      hasNetwork = false;
      await offline.update(cliente, rosa.id, {'nombre': 'Sin red', 'version': 0});

      // Vuelve la red, pero la cola aún no ha subido cuando se edita otra vez.
      hasNetwork = true;
      await offline.update(cliente, rosa.id, {'nombre': 'Con red', 'version': 0});

      expect(backend.calls, isEmpty);
      final outcome = await offline.sync();

      expect(outcome.conflicts, 0);
      expect(backend.rows['CLIENTE']!.single['nombre'], 'Con red');
    });

    test('borrar un registro editado sin red no manda la edición', () async {
      final rosa = await offline.create(cliente, {'nombre': 'Rosa'});
      backend.calls.clear();

      hasNetwork = false;
      await offline.update(cliente, rosa.id, {'nombre': 'Rosa 1', 'version': 0});
      await offline.delete(cliente, rosa.id);

      expect(await offline.pendingCount(), 1);

      hasNetwork = true;
      await offline.sync();

      expect(backend.calls, ['DELETE CLIENTE 1']);
      expect(backend.rows['CLIENTE'], isEmpty);
    });

    test('al sincronizar se traen todas las entidades, no sólo la abierta',
        () async {
      await backend.create(cliente, {'nombre': 'Juan'});
      await backend.create(notaventa, {'monto': 10});

      expect(await offline.refreshAll(), isTrue);

      // Sin red, las dos están, aunque nunca se abrió ninguna lista.
      hasNetwork = false;
      expect((await offline.list(cliente)).records, hasLength(1));
      expect((await offline.list(notaventa)).records, hasLength(1));
    });

    test('la lista se entera de un alta en cuanto se guarda', () async {
      hasNetwork = false;
      final seen = <int>[];
      final subscription =
          offline.watch(cliente).listen((records) => seen.add(records.length));

      await offline.create(cliente, {'nombre': 'Ana'});
      await pumpEventQueue();

      expect(seen.last, 1);
      await subscription.cancel();
    });
  });
}
