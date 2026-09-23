import 'dart:async';

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
///
/// El control se crea a mano y no se deja al widget por dos razones: para poder
/// encenderlo y apagarlo con la pantalla —si no, la cámara queda tomada al
/// volver atrás—, y para poder contar qué pasó cuando no arranca. La versión
/// anterior dejaba el marcador por defecto de la librería, que es un signo de
/// admiración sobre negro y no dice nada: ni si falta el permiso, ni si el
/// aparato no lo admite.
class _ScannerScreen extends StatefulWidget {
  const _ScannerScreen();

  @override
  State<_ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<_ScannerScreen> with WidgetsBindingObserver {
  final _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    formats: const [BarcodeFormat.qrCode],
  );

  bool _handled = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_controller.start());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Al irse a segundo plano Android quita la cámara; hay que volver a
    // pedirla al regresar o la vista se queda en negro.
    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(_controller.start());
      case AppLifecycleState.inactive:
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        unawaited(_controller.stop());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_controller.dispose());
    super.dispose();
  }

  void _found(BarcodeCapture capture) {
    if (_handled) return;

    for (final code in capture.barcodes) {
      final value = code.rawValue;
      if (value == null || value.isEmpty) continue;

      _handled = true;
      Navigator.of(context).pop(value);
      return;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Escanear el código'),
        actions: [
          IconButton(
            tooltip: 'Linterna',
            icon: const Icon(Icons.flashlight_on),
            onPressed: () => unawaited(_controller.toggleTorch()),
          ),
        ],
      ),
      body: MobileScanner(
        controller: _controller,
        onDetect: _found,
        errorBuilder: (context, error, child) => _ScannerError(error: error),
      ),
    );
  }
}

/// Qué ha pasado con la cámara, dicho de forma que se pueda arreglar.
class _ScannerError extends StatelessWidget {
  const _ScannerError({required this.error});

  final MobileScannerException error;

  @override
  Widget build(BuildContext context) {
    final (titulo, explicacion) = _describir();

    return ColoredBox(
      color: Colors.black,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.no_photography_outlined,
                  size: 48, color: Colors.white70),
              const SizedBox(height: 16),
              Text(
                titulo,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                explicacion,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white70, fontSize: 13),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).pop(),
                icon: const Icon(Icons.keyboard),
                label: const Text('Escribir la dirección a mano'),
              ),
              const SizedBox(height: 16),
              // El detalle técnico, para cuando lo de arriba no baste.
              Text(
                'Detalle: ${error.errorCode.name}'
                '${error.errorDetails?.message == null ? '' : ' — ${error.errorDetails!.message}'}',
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white38, fontSize: 11),
              ),
            ],
          ),
        ),
      ),
    );
  }

  (String, String) _describir() => switch (error.errorCode) {
        MobileScannerErrorCode.permissionDenied => (
            'Falta permiso para la cámara',
            'Android no deja abrirla sin permiso. Se concede en Ajustes → '
                'Aplicaciones → CASE Tool → Permisos → Cámara.',
          ),
        MobileScannerErrorCode.unsupported => (
            'Este teléfono no admite el escáner',
            'Puede escribir la dirección del backend a mano; el resto de la '
                'aplicación funciona igual.',
          ),
        _ => (
            'No se pudo abrir la cámara',
            'Puede que otra aplicación la esté usando. Cierre las demás e '
                'inténtelo otra vez, o escriba la dirección a mano.',
          ),
      };
}
