import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_state.dart';
import 'repository.dart';

/// CU10 — Quién decide cuándo se sube lo que está esperando.
///
/// Dos disparadores, y los dos hacen falta. El automático es volver a tener
/// red: es el caso de la demostración —modo avión, tres operaciones, se
/// desactiva el modo avión y las tres suben solas—. El manual es tocar el
/// indicador, que es lo que uno intenta cuando ve que hay cosas pendientes y
/// no quiere esperar.
///
/// El estado es sólo «está subiendo o no». Lo que pasó con cada operación
/// queda en la cola, y los conflictos en la lista de conflictos.
class SyncController extends StateNotifier<bool> {
  SyncController(this._ref) : super(false) {
    // Se queda mirando la conectividad: en cuanto vuelve, sube lo que haya.
    _subscription = _ref.listen<AsyncValue<bool>>(
      connectivityProvider,
      (previous, next) {
        final wasOffline = previous?.value == false;
        final isOnline = next.value == true;

        if (wasOffline && isOnline) unawaited(sync());
      },
    );
  }

  final Ref _ref;
  late final ProviderSubscription<AsyncValue<bool>> _subscription;

  /// El resultado de la última sincronización, para poder contarlo.
  SyncOutcome? lastOutcome;

  Future<SyncOutcome?> sync() async {
    if (state) return null; // Ya hay una en marcha.

    final repository = _ref.read(repositoryProvider);
    if (repository == null) return null;

    state = true;
    try {
      final outcome = await repository.sync();
      lastOutcome = outcome;

      return outcome;
    } finally {
      state = false;
    }
  }

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}

final syncControllerProvider =
    StateNotifierProvider<SyncController, bool>(SyncController.new);
