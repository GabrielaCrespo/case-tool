import 'dart:async';
import 'dart:convert';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api/client.dart';
import 'api/meta.dart';
import 'offline/database.dart';
import 'offline/repository.dart';

/// El estado de la aplicación: a qué backend está conectada, qué modelo
/// implementa ese backend y si hay red.
///
/// Todo cuelga de la conexión. Mientras no haya una, lo único que se puede
/// hacer es conectarse; en cuanto la hay, `_meta` dice qué pantallas existen.

/// La base local. Se abre una vez y vive lo que viva la aplicación.
final databaseProvider = Provider<LocalDatabase>((ref) {
  final database = LocalDatabase();
  ref.onDispose(database.close);

  return database;
});

/// A qué backend se conectó la última vez. Se recuerda para no tener que
/// escanear el código cada vez que se abre la aplicación.
class ConnectionController extends StateNotifier<ConnectionState> {
  ConnectionController(this._ref) : super(const ConnectionState.initial()) {
    unawaited(_restore());
  }

  final Ref _ref;

  static const _key = 'backend_url';

  Future<void> _restore() async {
    final preferences = await SharedPreferences.getInstance();
    final saved = preferences.getString(_key);

    if (saved == null || saved.isEmpty) {
      state = const ConnectionState.disconnected();
      return;
    }
    await connect(saved, remember: false);
  }

  /// Se conecta a un backend publicado y lee su modelo.
  ///
  /// Si no hay red pero ese backend ya se había visitado, se entra igual con
  /// el modelo guardado: es lo que permite abrir la aplicación en modo avión y
  /// seguir trabajando.
  Future<void> connect(String url, {bool remember = true}) async {
    final clean = _normalize(url);
    if (clean.isEmpty) {
      state = const ConnectionState.failed('Escriba la dirección del backend.');
      return;
    }

    state = const ConnectionState.connecting();
    final client = BackendClient(clean);

    // Sin red no se pregunta al servidor: se entra ya con el modelo guardado,
    // en vez de dejar la pantalla de carga hasta que venza el plazo.
    if (!await _hasNetwork()) {
      final cached = await _cachedMeta(clean);

      if (cached != null) {
        state = ConnectionState.connected(
          client: client,
          meta: cached,
          offline: true,
        );
        return;
      }
    }

    try {
      final raw = await client.metaJson();
      final meta = ModelMeta.fromJson(raw);

      if (remember) await _remember(clean, raw);
      state = ConnectionState.connected(client: client, meta: meta);
    } catch (_) {
      final cached = await _cachedMeta(clean);

      if (cached != null) {
        state = ConnectionState.connected(
          client: client,
          meta: cached,
          offline: true,
        );
        return;
      }
      state = const ConnectionState.failed(
        'No se pudo hablar con ese backend. Compruebe la dirección y que haya '
        'conexión; la primera vez hace falta red para conocer el modelo.',
      );
    }
  }

  static Future<bool> _hasNetwork() async {
    try {
      final results = await Connectivity().checkConnectivity();
      return results.any((result) => result != ConnectivityResult.none);
    } catch (_) {
      return true; // Si no se sabe, se intenta.
    }
  }

  Future<void> disconnect() async {
    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_key);

    state = const ConnectionState.disconnected();
  }

  Future<void> _remember(String url, Map<String, dynamic> meta) async {
    final preferences = await SharedPreferences.getInstance();

    await preferences.setString(_key, url);
    // El modelo también: sin él no se puede arrancar sin red, porque las
    // pantallas no sabrían qué pintar.
    await preferences.setString('meta:$url', jsonEncode(meta));
  }

  Future<ModelMeta?> _cachedMeta(String url) async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString('meta:$url');

    if (raw == null) return null;

    try {
      return ModelMeta.fromJson(Map<String, dynamic>.from(jsonDecode(raw) as Map));
    } catch (_) {
      // Guardado por una versión anterior y ya no se entiende; se pide otra vez.
      return null;
    }
  }

  /// La dirección puede llegar de un código QR o escrita a mano. Se le quita
  /// la barra final y se le pone https si no trae esquema: Android no habla
  /// por http en claro, así que suponer https es lo correcto.
  static String _normalize(String url) {
    var clean = url.trim();
    if (clean.isEmpty) return '';

    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'https://$clean';
    }
    while (clean.endsWith('/')) {
      clean = clean.substring(0, clean.length - 1);
    }
    return clean;
  }

  @override
  void dispose() {
    _ref.invalidate(repositoryProvider);
    super.dispose();
  }
}

final connectionProvider =
    StateNotifierProvider<ConnectionController, ConnectionState>(
  ConnectionController.new,
);

/// Lo que sabe la aplicación de su backend.
class ConnectionState {
  const ConnectionState._({
    required this.status,
    this.client,
    this.meta,
    this.message,
    this.offline = false,
  });

  const ConnectionState.initial() : this._(status: ConnectionStatus.loading);
  const ConnectionState.disconnected()
      : this._(status: ConnectionStatus.disconnected);
  const ConnectionState.connecting()
      : this._(status: ConnectionStatus.connecting);
  const ConnectionState.failed(String message)
      : this._(status: ConnectionStatus.disconnected, message: message);
  const ConnectionState.connected({
    required BackendClient client,
    required ModelMeta meta,
    bool offline = false,
  }) : this._(
          status: ConnectionStatus.connected,
          client: client,
          meta: meta,
          offline: offline,
        );

  final ConnectionStatus status;
  final BackendClient? client;
  final ModelMeta? meta;
  final String? message;

  /// Se entró con el modelo guardado porque no había red.
  final bool offline;

  bool get isConnected => status == ConnectionStatus.connected;
}

enum ConnectionStatus { loading, disconnected, connecting, connected }

/// El repositorio del backend conectado. Es por donde pasan todas las
/// pantallas: ninguna habla con el cliente HTTP directamente.
final repositoryProvider = Provider<OfflineRepository?>((ref) {
  final connection = ref.watch(connectionProvider);

  if (!connection.isConnected) return null;

  return OfflineRepository(
    database: ref.watch(databaseProvider),
    client: connection.client!,
    meta: connection.meta!,
    // Se lee en el momento de cada operación, no al crear el repositorio: la
    // red va y viene mientras la aplicación está abierta.
    isOnline: () => ref.read(connectivityProvider).value ?? true,
  );
});

/// Si hay red. No dice que el backend conteste —eso sólo se sabe llamándolo—,
/// pero sirve para el indicador y para disparar la sincronización en cuanto
/// vuelve la conexión.
final connectivityProvider = StreamProvider<bool>((ref) async* {
  final connectivity = Connectivity();

  bool online(List<ConnectivityResult> results) =>
      results.any((result) => result != ConnectivityResult.none);

  yield online(await connectivity.checkConnectivity());
  yield* connectivity.onConnectivityChanged.map(online);
});

/// Cuántas operaciones esperan a subir.
final pendingCountProvider = StreamProvider<int>((ref) {
  final repository = ref.watch(repositoryProvider);

  return repository == null ? Stream.value(0) : repository.watchPendingCount();
});

/// Cuántos registros esperan a que alguien decida qué versión se queda.
final conflictCountProvider = StreamProvider<int>((ref) {
  final repository = ref.watch(repositoryProvider);

  return repository == null ? Stream.value(0) : repository.watchConflictCount();
});
