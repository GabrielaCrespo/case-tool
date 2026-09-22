import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'database.g.dart';

/// CU10 — La base local del teléfono.
///
/// Tres tablas, y cada una está por una razón distinta:
///
/// - [CachedRecords] guarda lo último que se trajo del servidor, para poder
///   enseñar algo cuando no hay red.
/// - [PendingOperations] guarda lo que se hizo sin red y todavía no se ha
///   subido, en orden.
/// - [IdMap] traduce el identificador que se inventó el teléfono por el que
///   acabó poniendo el servidor. Sin esto no se puede crear un cliente sin red
///   y a continuación su nota de venta: la nota apuntaría a un cliente que en
///   el servidor no existe.

/// Lo último que se sincronizó de cada registro.
@DataClassName('CachedRecord')
class CachedRecords extends Table {
  /// A qué backend pertenece: el mismo teléfono puede conectarse a varios.
  TextColumn get backend => text()();
  TextColumn get entity => text()();

  /// El identificador del servidor, o el local mientras no se haya subido.
  TextColumn get recordId => text()();
  TextColumn get payloadJson => text()();
  DateTimeColumn get updatedAt => dateTime()();

  /// Tiene cambios locales sin subir.
  BoolColumn get dirty => boolean().withDefault(const Constant(false))();

  /// El servidor lo cambió por debajo y hay que preguntar con cuál quedarse.
  BoolColumn get conflicted => boolean().withDefault(const Constant(false))();

  /// Cómo quedó en el servidor, mientras haya conflicto.
  TextColumn get serverJson => text().nullable()();

  @override
  Set<Column> get primaryKey => {backend, entity, recordId};
}

/// Lo que falta por subir, en el orden en que se hizo.
@DataClassName('PendingOperation')
class PendingOperations extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get backend => text()();
  TextColumn get entity => text()();

  /// CREATE, UPDATE o DELETE.
  TextColumn get op => text()();
  TextColumn get payloadJson => text()();

  /// El identificador provisional que se inventó el teléfono, en un alta.
  TextColumn get localId => text().nullable()();

  /// El identificador del servidor, en una edición o un borrado.
  TextColumn get serverId => text().nullable()();

  /// PENDING, SENDING, DONE, CONFLICT o FAILED.
  TextColumn get status => text().withDefault(const Constant('PENDING'))();
  IntColumn get attempts => integer().withDefault(const Constant(0))();
  TextColumn get lastError => text().nullable()();
  DateTimeColumn get createdAt => dateTime()();
}

/// La traducción entre el identificador local y el del servidor.
@DataClassName('IdMapping')
class IdMap extends Table {
  TextColumn get backend => text()();
  TextColumn get entity => text()();
  TextColumn get localId => text()();
  TextColumn get serverId => text()();

  @override
  Set<Column> get primaryKey => {backend, entity, localId};
}

@DriftDatabase(tables: [CachedRecords, PendingOperations, IdMap])
class LocalDatabase extends _$LocalDatabase {
  LocalDatabase() : super(_open());

  /// Para las pruebas: una base en memoria, que no toca el disco.
  LocalDatabase.forTesting(super.executor);

  @override
  int get schemaVersion => 1;

  static QueryExecutor _open() {
    return LazyDatabase(() async {
      final directory = await getApplicationDocumentsDirectory();

      return NativeDatabase.createInBackground(
        File(p.join(directory.path, 'case_tool_offline.sqlite')),
      );
    });
  }
}
