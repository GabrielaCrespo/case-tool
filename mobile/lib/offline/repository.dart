import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart';

import '../api/client.dart';
import '../api/meta.dart';
import 'database.dart';

/// CU10 — Lo que hace que la aplicación funcione sin conexión.
///
/// Todo pasa por aquí: las pantallas nunca llaman al backend directamente.
/// Leer devuelve lo que hay guardado y, si hay red, lo refresca. Escribir se
/// aplica en local siempre, y se sube ahora si hay red o más tarde si no la
/// hay. Así la interfaz es la misma con red y sin ella, que es lo que se pide.
///
/// El orden importa al subir: las operaciones se reenvían en el orden en que
/// se hicieron y traduciendo los identificadores locales por los del servidor
/// según van llegando. Es lo que permite crear un cliente sin red y, a
/// continuación, su nota de venta.
class OfflineRepository {
  OfflineRepository({
    required this.database,
    required this.client,
    required this.meta,
  });

  final LocalDatabase database;
  final BackendClient client;
  final ModelMeta meta;

  /// Qué backend es éste. El mismo teléfono puede haberse conectado a varios y
  /// lo guardado de uno no tiene nada que ver con lo del otro.
  String get backend => client.baseUrl;

  /// El prefijo de los identificadores que se inventa el teléfono. Se
  /// distinguen a simple vista de los del servidor, que son números.
  static const String localPrefix = 'local:';

  static bool isLocalId(String id) => id.startsWith(localPrefix);

  // --------------------------------------------------------------- lectura

  /// Los registros de una entidad: los guardados, refrescados si hay red.
  ///
  /// Devuelve siempre algo, aunque la red falle: es justo el caso para el que
  /// existe todo esto.
  Future<CachedList> list(EntityMeta entity) async {
    try {
      final rows = await client.list(entity);
      await _replaceCache(entity, rows);

      return CachedList(
        records: await _readCache(entity),
        fromNetwork: true,
        syncedAt: DateTime.now(),
      );
    } catch (_) {
      // Sin red, o el servidor no contesta: vale lo último que se trajo.
      final records = await _readCache(entity);

      return CachedList(
        records: records,
        fromNetwork: false,
        syncedAt: records.isEmpty
            ? null
            : records
                .map((record) => record.updatedAt)
                .reduce((a, b) => a.isAfter(b) ? a : b),
      );
    }
  }

  /// Lo guardado de una entidad, sin tocar la red.
  Future<List<LocalRecord>> cached(EntityMeta entity) => _readCache(entity);

  // --------------------------------------------------------------- escritura

  /// Da de alta un registro.
  ///
  /// Si hay red se manda y se guarda lo que devolvió el servidor. Si no, se
  /// guarda con un identificador que se inventa el teléfono y se encola; ese
  /// identificador se cambiará por el de verdad cuando la operación suba.
  Future<LocalRecord> create(
    EntityMeta entity,
    Map<String, dynamic> values,
  ) async {
    try {
      final saved = await client.create(entity, values);

      await _putCache(entity, saved, dirty: false);
      return _toRecord(entity, saved, dirty: false);
    } on ValidationFailure {
      rethrow; // Está mal escrito: no se encola, se corrige.
    } on ConflictFailure {
      rethrow;
    } catch (_) {
      final localId = '$localPrefix${DateTime.now().microsecondsSinceEpoch}';
      final pending = {...values, entity.idField.name: localId};

      await _putCache(entity, pending, dirty: true);
      await _enqueue(entity, 'CREATE', values, localId: localId);

      return _toRecord(entity, pending, dirty: true);
    }
  }

  /// Guarda los cambios de un registro.
  ///
  /// El cuerpo lleva la versión que se leyó: es lo que hace que el servidor
  /// pueda decir que alguien lo cambió entretanto.
  Future<LocalRecord> update(
    EntityMeta entity,
    String id,
    Map<String, dynamic> values,
  ) async {
    // Un registro que todavía no existe en el servidor no se puede editar
    // allí: se corrige el alta que está esperando en la cola.
    if (isLocalId(id)) {
      await _amendPendingCreate(entity, id, values);
      await _putCache(entity, {...values, entity.idField.name: id}, dirty: true);

      return _toRecord(entity, {...values, entity.idField.name: id}, dirty: true);
    }

    try {
      final saved = await client.update(entity, id, values);

      await _putCache(entity, saved, dirty: false);
      return _toRecord(entity, saved, dirty: false);
    } on ValidationFailure {
      rethrow;
    } on ConflictFailure {
      // Alguien lo cambió antes. No se mezcla nada: se marca y que decida
      // quien está delante.
      await _markConflict(entity, id, values);
      rethrow;
    } catch (_) {
      await _putCache(entity, {...values, entity.idField.name: id}, dirty: true);
      await _enqueue(entity, 'UPDATE', values, serverId: id);

      return _toRecord(entity, {...values, entity.idField.name: id}, dirty: true);
    }
  }

  Future<void> delete(EntityMeta entity, String id) async {
    if (isLocalId(id)) {
      // Nunca llegó a existir fuera del teléfono: se quita el alta de la cola
      // y no queda nada que contarle al servidor.
      await _dropPendingFor(entity, id);
      await _removeCache(entity, id);
      return;
    }

    try {
      await client.delete(entity, id);
      await _removeCache(entity, id);
    } on NotFoundFailure {
      await _removeCache(entity, id); // Ya no estaba; el efecto es el mismo.
    } catch (_) {
      await _removeCache(entity, id);
      await _enqueue(entity, 'DELETE', const {}, serverId: id);
    }
  }

  // ---------------------------------------------------------- sincronización

  /// Cuántas operaciones esperan a subir.
  Future<int> pendingCount() async {
    final query = database.select(database.pendingOperations)
      ..where((row) =>
          row.backend.equals(backend) & row.status.isIn(['PENDING', 'FAILED']));

    return (await query.get()).length;
  }

  Stream<int> watchPendingCount() {
    final query = database.select(database.pendingOperations)
      ..where((row) =>
          row.backend.equals(backend) & row.status.isIn(['PENDING', 'FAILED']));

    return query.watch().map((rows) => rows.length);
  }

  /// Sube lo que esté esperando, en orden.
  ///
  /// En orden y no en paralelo, a propósito: una operación puede depender de
  /// otra —la nota de venta del cliente que se acaba de crear— y hasta que la
  /// primera no vuelve con su identificador de verdad, la segunda no se puede
  /// mandar.
  ///
  /// Si una falla por falta de red se para ahí: seguir sólo serviría para
  /// acumular fallos y desordenar lo que queda.
  Future<SyncOutcome> sync() async {
    final query = database.select(database.pendingOperations)
      ..where((row) =>
          row.backend.equals(backend) & row.status.isIn(['PENDING', 'FAILED']))
      ..orderBy([(row) => OrderingTerm.asc(row.id)]);

    final operations = await query.get();
    var sent = 0;
    var conflicts = 0;
    var rejected = 0;

    for (final operation in operations) {
      final entity = meta.byName(operation.entity);
      if (entity == null) {
        await _finish(operation, 'FAILED', 'La entidad ya no existe en el modelo.');
        rejected++;
        continue;
      }

      try {
        await _send(operation, entity);
        await _finish(operation, 'DONE', null);
        sent++;
      } on ValidationFailure catch (failure) {
        // El servidor no lo quiere y reintentarlo daría lo mismo.
        await _finish(operation, 'FAILED', failure.toString());
        rejected++;
      } on ConflictFailure catch (failure) {
        await _finish(operation, 'CONFLICT', failure.toString());
        if (operation.serverId != null) {
          await _markConflict(
            entity,
            operation.serverId!,
            _decode(operation.payloadJson),
          );
        }
        conflicts++;
      } on NotFoundFailure {
        // Alguien lo borró mientras tanto: la operación ya no tiene sentido.
        await _finish(operation, 'DONE', null);
        sent++;
      } catch (_) {
        // Sigue sin haber red. Se deja para la próxima, sin tocar el orden.
        await (database.update(database.pendingOperations)
              ..where((row) => row.id.equals(operation.id)))
            .write(
          PendingOperationsCompanion(
            attempts: Value(operation.attempts + 1),
            lastError: const Value('Sin conexión.'),
          ),
        );
        break;
      }
    }

    return SyncOutcome(sent: sent, conflicts: conflicts, rejected: rejected);
  }

  Future<void> _send(PendingOperation operation, EntityMeta entity) async {
    final values = await _translate(_decode(operation.payloadJson), entity);

    switch (operation.op) {
      case 'CREATE':
        final saved = await client.create(entity, values);
        final serverId = saved[entity.idField.name]?.toString();

        if (operation.localId != null && serverId != null) {
          // La traducción, que es lo que hace que la siguiente operación de la
          // cola pueda apuntar a esto.
          await database.into(database.idMap).insertOnConflictUpdate(
                IdMapCompanion.insert(
                  backend: backend,
                  entity: entity.name,
                  localId: operation.localId!,
                  serverId: serverId,
                ),
              );
          await _removeCache(entity, operation.localId!);
        }
        await _putCache(entity, saved, dirty: false);

      case 'UPDATE':
        final id = await _resolveId(entity, operation.serverId!);
        final saved = await client.update(entity, id, values);

        await _putCache(entity, saved, dirty: false);

      case 'DELETE':
        final id = await _resolveId(entity, operation.serverId!);
        await client.delete(entity, id);
        await _removeCache(entity, id);
    }
  }

  /// Cambia los identificadores locales que haya dentro de los valores por los
  /// que puso el servidor. Es donde se cierra la dependencia entre operaciones.
  Future<Map<String, dynamic>> _translate(
    Map<String, dynamic> values,
    EntityMeta entity,
  ) async {
    final translated = Map<String, dynamic>.from(values);

    for (final relation in entity.editableRelations) {
      final reference = translated[relation.field];
      if (reference is! Map) continue;

      final target = meta.byName(relation.target);
      if (target == null) continue;

      final id = reference[target.idField.name]?.toString();
      if (id == null || !isLocalId(id)) continue;

      final real = await _lookupServerId(relation.target, id);
      if (real == null) {
        throw const BackendFailure(
          'Falta subir el registro al que apunta esta operación.',
        );
      }
      translated[relation.field] = {target.idField.name: _asId(real)};
    }
    return translated;
  }

  Future<String> _resolveId(EntityMeta entity, String id) async {
    if (!isLocalId(id)) return id;

    final real = await _lookupServerId(entity.name, id);
    if (real == null) {
      throw const BackendFailure('Ese registro todavía no está en el servidor.');
    }
    return real;
  }

  Future<String?> _lookupServerId(String entityName, String localId) async {
    final query = database.select(database.idMap)
      ..where((row) =>
          row.backend.equals(backend) &
          row.entity.equals(entityName) &
          row.localId.equals(localId));

    return (await query.getSingleOrNull())?.serverId;
  }

  // ----------------------------------------------------------- conflictos

  /// Los registros que el servidor cambió por debajo y esperan una decisión.
  Future<List<ConflictedRecord>> conflicts() async {
    final query = database.select(database.cachedRecords)
      ..where((row) => row.backend.equals(backend) & row.conflicted.equals(true));

    final rows = await query.get();
    final result = <ConflictedRecord>[];

    for (final row in rows) {
      final entity = meta.byName(row.entity);
      if (entity == null) continue;

      result.add(
        ConflictedRecord(
          entity: entity,
          id: row.recordId,
          mine: _decode(row.payloadJson),
          theirs: row.serverJson == null ? null : _decode(row.serverJson!),
        ),
      );
    }
    return result;
  }

  Stream<int> watchConflictCount() {
    final query = database.select(database.cachedRecords)
      ..where((row) => row.backend.equals(backend) & row.conflicted.equals(true));

    return query.watch().map((rows) => rows.length);
  }

  /// Se queda con lo del servidor: lo local se descarta.
  Future<void> keepTheirs(EntityMeta entity, String id) async {
    final fresh = await client.findById(entity, id);

    if (fresh == null) {
      await _removeCache(entity, id);
      return;
    }
    await _putCache(entity, fresh, dirty: false);
  }

  /// Se queda con lo local: se vuelve a mandar sobre la versión del servidor.
  ///
  /// Se lee antes la versión que hay ahora y se manda con ella, que es lo que
  /// significa «gana lo mío»: no se mezcla nada, se pisa a conciencia.
  Future<void> keepMine(EntityMeta entity, String id) async {
    final query = database.select(database.cachedRecords)
      ..where((row) =>
          row.backend.equals(backend) &
          row.entity.equals(entity.name) &
          row.recordId.equals(id));

    final row = await query.getSingleOrNull();
    if (row == null) return;

    final mine = _decode(row.payloadJson);
    final fresh = await client.findById(entity, id);

    if (fresh == null) {
      await _removeCache(entity, id);
      return;
    }
    mine[entity.versionField.name] = fresh[entity.versionField.name];

    final saved = await client.update(entity, id, mine);
    await _putCache(entity, saved, dirty: false);
  }

  Future<void> _markConflict(
    EntityMeta entity,
    String id,
    Map<String, dynamic> mine,
  ) async {
    Map<String, dynamic>? theirs;
    try {
      theirs = await client.findById(entity, id);
    } catch (_) {
      // Se marca igual; la versión del servidor se leerá al resolverlo.
    }

    await database.into(database.cachedRecords).insertOnConflictUpdate(
          CachedRecordsCompanion.insert(
            backend: backend,
            entity: entity.name,
            recordId: id,
            payloadJson: jsonEncode({...mine, entity.idField.name: _asId(id)}),
            updatedAt: DateTime.now(),
            dirty: const Value(true),
            conflicted: const Value(true),
            serverJson:
                theirs == null ? const Value.absent() : Value(jsonEncode(theirs)),
          ),
        );
  }

  // ------------------------------------------------------------------ la cola

  Future<void> _enqueue(
    EntityMeta entity,
    String op,
    Map<String, dynamic> values, {
    String? localId,
    String? serverId,
  }) async {
    await database.into(database.pendingOperations).insert(
          PendingOperationsCompanion.insert(
            backend: backend,
            entity: entity.name,
            op: op,
            payloadJson: jsonEncode(values),
            localId: Value(localId),
            serverId: Value(serverId),
            createdAt: DateTime.now(),
          ),
        );
  }

  /// Editar algo que aún no subió es cambiar el alta que espera en la cola, no
  /// añadir una edición detrás: al servidor le llegará una sola operación.
  Future<void> _amendPendingCreate(
    EntityMeta entity,
    String localId,
    Map<String, dynamic> values,
  ) async {
    final query = database.select(database.pendingOperations)
      ..where((row) =>
          row.backend.equals(backend) &
          row.localId.equals(localId) &
          row.op.equals('CREATE') &
          row.status.isIn(['PENDING', 'FAILED']));

    final existing = await query.getSingleOrNull();

    if (existing == null) {
      await _enqueue(entity, 'CREATE', values, localId: localId);
      return;
    }
    await (database.update(database.pendingOperations)
          ..where((row) => row.id.equals(existing.id)))
        .write(
      PendingOperationsCompanion(
        payloadJson: Value(jsonEncode(values)),
        status: const Value('PENDING'),
        lastError: const Value(null),
      ),
    );
  }

  Future<void> _dropPendingFor(EntityMeta entity, String localId) async {
    await (database.delete(database.pendingOperations)
          ..where((row) =>
              row.backend.equals(backend) & row.localId.equals(localId)))
        .go();
  }

  Future<void> _finish(
    PendingOperation operation,
    String status,
    String? error,
  ) async {
    if (status == 'DONE') {
      await (database.delete(database.pendingOperations)
            ..where((row) => row.id.equals(operation.id)))
          .go();
      return;
    }
    await (database.update(database.pendingOperations)
          ..where((row) => row.id.equals(operation.id)))
        .write(
      PendingOperationsCompanion(
        status: Value(status),
        attempts: Value(operation.attempts + 1),
        lastError: Value(error),
      ),
    );
  }

  /// Descarta las operaciones que el servidor rechazó y no se van a arreglar
  /// solas, para que la cola no crezca sin fin.
  Future<void> discardFailed() async {
    await (database.delete(database.pendingOperations)
          ..where((row) =>
              row.backend.equals(backend) &
              row.status.isIn(['FAILED', 'CONFLICT'])))
        .go();
  }

  // -------------------------------------------------------------- lo guardado

  Future<void> _replaceCache(
    EntityMeta entity,
    List<Map<String, dynamic>> rows,
  ) async {
    await database.transaction(() async {
      // Lo que tenga cambios sin subir no se toca: sobrescribirlo con lo del
      // servidor sería perder lo que la persona escribió sin red.
      final keep = await (database.select(database.cachedRecords)
            ..where((row) =>
                row.backend.equals(backend) &
                row.entity.equals(entity.name) &
                (row.dirty.equals(true) | row.conflicted.equals(true))))
          .get();

      final protected = keep.map((row) => row.recordId).toSet();

      await (database.delete(database.cachedRecords)
            ..where((row) =>
                row.backend.equals(backend) &
                row.entity.equals(entity.name) &
                row.dirty.equals(false) &
                row.conflicted.equals(false)))
          .go();

      for (final row in rows) {
        final id = row[entity.idField.name]?.toString();
        if (id == null || protected.contains(id)) continue;

        await database.into(database.cachedRecords).insertOnConflictUpdate(
              CachedRecordsCompanion.insert(
                backend: backend,
                entity: entity.name,
                recordId: id,
                payloadJson: jsonEncode(row),
                updatedAt: DateTime.now(),
              ),
            );
      }
    });
  }

  Future<void> _putCache(
    EntityMeta entity,
    Map<String, dynamic> row, {
    required bool dirty,
  }) async {
    final id = row[entity.idField.name]?.toString();
    if (id == null) return;

    await database.into(database.cachedRecords).insertOnConflictUpdate(
          CachedRecordsCompanion.insert(
            backend: backend,
            entity: entity.name,
            recordId: id,
            payloadJson: jsonEncode(row),
            updatedAt: DateTime.now(),
            dirty: Value(dirty),
            conflicted: const Value(false),
            serverJson: const Value(null),
          ),
        );
  }

  Future<void> _removeCache(EntityMeta entity, String id) async {
    await (database.delete(database.cachedRecords)
          ..where((row) =>
              row.backend.equals(backend) &
              row.entity.equals(entity.name) &
              row.recordId.equals(id)))
        .go();
  }

  Future<List<LocalRecord>> _readCache(EntityMeta entity) async {
    final query = database.select(database.cachedRecords)
      ..where((row) =>
          row.backend.equals(backend) & row.entity.equals(entity.name))
      ..orderBy([(row) => OrderingTerm.asc(row.recordId)]);

    return (await query.get())
        .map(
          (row) => LocalRecord(
            id: row.recordId,
            values: _decode(row.payloadJson),
            dirty: row.dirty,
            conflicted: row.conflicted,
            updatedAt: row.updatedAt,
          ),
        )
        .toList();
  }

  LocalRecord _toRecord(
    EntityMeta entity,
    Map<String, dynamic> values, {
    required bool dirty,
  }) =>
      LocalRecord(
        id: values[entity.idField.name].toString(),
        values: values,
        dirty: dirty,
        conflicted: false,
        updatedAt: DateTime.now(),
      );

  Map<String, dynamic> _decode(String json) =>
      Map<String, dynamic>.from(jsonDecode(json) as Map);

  /// Los identificadores del servidor son números; los del teléfono, texto.
  static Object _asId(String id) => int.tryParse(id) ?? id;
}

/// Un registro tal como lo tiene el teléfono.
class LocalRecord {
  const LocalRecord({
    required this.id,
    required this.values,
    required this.dirty,
    required this.conflicted,
    required this.updatedAt,
  });

  final String id;
  final Map<String, dynamic> values;

  /// Tiene cambios que todavía no han llegado al servidor.
  final bool dirty;

  /// El servidor lo cambió por debajo y hay que elegir con cuál quedarse.
  final bool conflicted;
  final DateTime updatedAt;

  bool get isLocalOnly => OfflineRepository.isLocalId(id);
}

/// Una lista, diciendo si es de ahora o de la última vez que hubo red.
class CachedList {
  const CachedList({
    required this.records,
    required this.fromNetwork,
    required this.syncedAt,
  });

  final List<LocalRecord> records;
  final bool fromNetwork;
  final DateTime? syncedAt;
}

class SyncOutcome {
  const SyncOutcome({
    required this.sent,
    required this.conflicts,
    required this.rejected,
  });

  final int sent;
  final int conflicts;
  final int rejected;

  bool get quiet => sent == 0 && conflicts == 0 && rejected == 0;
}

/// Un registro en conflicto, con las dos versiones para poder elegir.
class ConflictedRecord {
  const ConflictedRecord({
    required this.entity,
    required this.id,
    required this.mine,
    required this.theirs,
  });

  final EntityMeta entity;
  final String id;
  final Map<String, dynamic> mine;
  final Map<String, dynamic>? theirs;
}
