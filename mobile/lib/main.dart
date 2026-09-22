import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_state.dart';
import 'features/connect/connect_screen.dart';
import 'features/entities/entities_screen.dart';
import 'offline/sync_controller.dart';

/// CU09 — Aplicación móvil de la herramienta CASE.
/// CU10 — Funcionamiento sin conexión y sincronización.
///
/// Es **una sola aplicación genérica**, escrita a mano una vez, que sirve para
/// cualquier backend que la herramienta haya generado y publicado. No hay
/// código Flutter generado por diagrama: al conectarse, lee `/api/_meta` del
/// backend y arma con eso sus listas y sus formularios.
///
/// Lo que ocurre en el teléfono se queda en el teléfono cuando no hay red: lo
/// leído se guarda para poder consultarlo, lo escrito se encola y sube solo en
/// cuanto vuelve la conexión.
void main() {
  runApp(const ProviderScope(child: CaseToolApp()));
}

class CaseToolApp extends ConsumerWidget {
  const CaseToolApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Se instancia aquí, y no donde se usa, para que esté escuchando la
    // conectividad desde que arranca la aplicación: es lo que hace que la cola
    // suba sola en cuanto vuelve la red, sin que nadie abra ninguna pantalla.
    ref.watch(syncControllerProvider);

    final connection = ref.watch(connectionProvider);

    return MaterialApp(
      title: 'CASE Tool',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF1F5FA9)),
        useMaterial3: true,
      ),
      home: switch (connection.status) {
        ConnectionStatus.loading =>
          const Scaffold(body: Center(child: CircularProgressIndicator())),
        ConnectionStatus.connected => const EntitiesScreen(),
        _ => const ConnectScreen(),
      },
    );
  }
}
