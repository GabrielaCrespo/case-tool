import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_state.dart';
import '../offline/sync_controller.dart';

/// CU10 — El indicador permanente: conectado, sin red, o cuántas operaciones
/// esperan.
///
/// Está siempre a la vista, y no sólo cuando hay algo pendiente, porque lo que
/// tiene que quedar claro en todo momento es si lo que se está viendo y
/// escribiendo ha llegado al servidor o no. Una franja que aparece y
/// desaparece se acaba pasando por alto.
class SyncIndicator extends ConsumerWidget {
  const SyncIndicator({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final online = ref.watch(connectivityProvider).value ?? true;
    final pending = ref.watch(pendingCountProvider).value ?? 0;
    final syncing = ref.watch(syncControllerProvider);

    final (color, icon, text) = _state(context, online, pending, syncing);

    return Material(
      color: color,
      child: InkWell(
        // Tocarlo fuerza la sincronización: es lo que uno intenta cuando ve
        // que hay cosas esperando y acaba de recuperar la cobertura.
        onTap: pending > 0 && online && !syncing
            ? () => ref.read(syncControllerProvider.notifier).sync()
            : null,
        child: SizedBox(
          height: 28,
          width: double.infinity,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (syncing)
                const SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              else
                Icon(icon, size: 14, color: Colors.white),
              const SizedBox(width: 6),
              Text(
                text,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  (Color, IconData, String) _state(
    BuildContext context,
    bool online,
    int pending,
    bool syncing,
  ) {
    if (syncing) {
      return (Colors.blueGrey.shade600, Icons.sync, 'Sincronizando…');
    }
    if (!online && pending > 0) {
      return (
        Colors.orange.shade800,
        Icons.cloud_off,
        'Sin conexión · $pending ${pending == 1 ? 'operación' : 'operaciones'} esperando',
      );
    }
    if (!online) {
      return (Colors.orange.shade800, Icons.cloud_off, 'Sin conexión');
    }
    if (pending > 0) {
      return (
        Colors.amber.shade800,
        Icons.cloud_upload_outlined,
        '$pending ${pending == 1 ? 'operación' : 'operaciones'} sin subir · toque para subirlas',
      );
    }
    return (Colors.green.shade700, Icons.cloud_done_outlined, 'Al día');
  }
}
