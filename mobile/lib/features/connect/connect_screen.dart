import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app_state.dart';

/// CU09 — Conectarse a un backend publicado.
///
/// Es la única pantalla que existe antes de saber a qué backend se habla. La
/// dirección se puede pegar a mano, pero lo normal es escanear el código QR
/// que enseña el editor al publicar: ahí está escrita entera y no hay que
/// teclear nada.
class ConnectScreen extends ConsumerStatefulWidget {
  const ConnectScreen({super.key});

  @override
  ConsumerState<ConnectScreen> createState() => _ConnectScreenState();
}

class _ConnectScreenState extends ConsumerState<ConnectScreen> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _scan() async {
    final scanned = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _ScannerScreen()),
    );

    if (scanned == null || !mounted) return;
    _controller.text = scanned;
    await _connect();
  }

  Future<void> _connect() async {
    await ref.read(connectionProvider.notifier).connect(_controller.text);
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final connecting = connection.status == ConnectionStatus.connecting;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(
                    Icons.dns_outlined,
                    size: 56,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Conectar con un backend',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Escanee el código que enseña el editor al publicar, o '
                    'escriba la dirección del backend.',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _controller,
                    enabled: !connecting,
                    keyboardType: TextInputType.url,
                    autocorrect: false,
                    decoration: const InputDecoration(
                      labelText: 'Dirección',
                      hintText: 'https://midominio/d/sistema-de-ventas',
                      border: OutlineInputBorder(),
                    ),
                    onSubmitted: (_) => _connect(),
                  ),
                  if (connection.message != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      connection.message!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        fontSize: 13,
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: connecting ? null : _connect,
                    icon: connecting
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.link),
                    label: Text(connecting ? 'Conectando…' : 'Conectar'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: connecting ? null : _scan,
                    icon: const Icon(Icons.qr_code_scanner),
                    label: const Text('Escanear el código'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// La cámara leyendo el código. Devuelve lo que hay escrito dentro y se cierra
/// al primer acierto: no tiene sentido seguir leyendo el mismo código.
class _ScannerScreen extends StatefulWidget {
  const _ScannerScreen();

  @override
  State<_ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<_ScannerScreen> {
  bool _handled = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Escanear el código')),
      body: MobileScanner(
        onDetect: (capture) {
          if (_handled) return;

          for (final code in capture.barcodes) {
            final value = code.rawValue;
            if (value == null || value.isEmpty) continue;

            _handled = true;
            Navigator.of(context).pop(value);
            return;
          }
        },
      ),
    );
  }
}
