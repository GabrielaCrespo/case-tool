import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_state.dart';
import '../../widgets/sync_indicator.dart';
import 'grammar.dart';
import 'local_model.dart';
import 'operations.dart';
import 'speech.dart';

/// CU09 — El asistente por voz del teléfono.
///
/// Todo lo de esta pantalla ocurre en el dispositivo: transcribe el
/// reconocedor de Android sin conexión, interpreta un modelo pequeño
/// descargado en el teléfono y, si ése no acierta, una gramática escrita a
/// mano. Ninguna de las tres cosas necesita red, que es justo el requisito.
///
/// Y nada se ejecuta sin confirmar. Lo entendido se enseña primero —qué se va
/// a dar de alta, con qué valores y qué se descartó—, exactamente igual que el
/// asistente del lienzo en CU04.
class VoiceScreen extends ConsumerStatefulWidget {
  const VoiceScreen({super.key});

  @override
  ConsumerState<VoiceScreen> createState() => _VoiceScreenState();
}

class _VoiceScreenState extends ConsumerState<VoiceScreen> {
  final _speech = SpeechRecognizer();
  final _model = LocalModel();
  final _textController = TextEditingController();

  String _heard = '';
  bool _listening = false;
  bool _thinking = false;
  bool _running = false;

  List<PlannedOperation> _planned = [];
  String? _error;
  String? _interpretedBy;

  /// El progreso de la descarga del modelo, mientras se esté descargando.
  int? _downloadPercent;
  bool _modelInstalled = false;

  @override
  void initState() {
    super.initState();
    unawaited(_checkModel());
  }

  Future<void> _checkModel() async {
    try {
      final installed = await _model.isInstalled;
      if (mounted) setState(() => _modelInstalled = installed);
    } catch (_) {
      // El complemento puede no estar disponible en este dispositivo; la
      // gramática funciona igual.
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    unawaited(_speech.cancel());
    unawaited(_model.close());
    super.dispose();
  }

  // ------------------------------------------------------------------- dictar

  Future<void> _listen() async {
    if (_listening) {
      await _speech.stop();
      setState(() => _listening = false);
      return;
    }

    setState(() {
      _error = null;
      _planned = [];
      _heard = '';
    });

    try {
      await _speech.listen(
        onResult: (text, finished) {
          if (!mounted) return;

          setState(() {
            _heard = text;
            _textController.text = text;
            if (finished) _listening = false;
          });
          if (finished && text.trim().isNotEmpty) unawaited(_interpret(text));
        },
      );
      setState(() => _listening = true);
    } on SpeechUnavailable catch (failure) {
      setState(() => _error = '${failure.message} Puede escribir la orden.');
    }
  }

  // -------------------------------------------------------------- interpretar

  /// Primero el modelo, y si no saca nada, la gramática.
  ///
  /// Ese orden y no al revés: el modelo entiende frases que la gramática no, y
  /// la gramática es la red debajo para que nunca se quede sin respuesta.
  Future<void> _interpret(String dictation) async {
    final meta = ref.read(connectionProvider).meta;
    if (meta == null) return;

    setState(() {
      _thinking = true;
      _error = null;
    });

    final validator = OperationValidator(meta);
    var operations = <PlannedOperation>[];
    String? source;

    if (_modelInstalled) {
      try {
        final proposed = await _model.interpret(dictation, meta);
        operations = validator.validate(proposed);
        if (operations.isNotEmpty) source = 'el modelo del teléfono';
      } catch (_) {
        // Da igual por qué falló: hay con qué seguir.
      }
    }

    if (operations.isEmpty) {
      operations = validator.validate(GrammarInterpreter(meta).interpret(dictation));
      if (operations.isNotEmpty) source = 'las reglas del teléfono';
    }

    if (!mounted) return;
    setState(() {
      _planned = operations;
      _interpretedBy = source;
      _thinking = false;
      _error = operations.isEmpty
          ? 'No se entendió la orden. Pruebe con algo como «registrar '
              '${meta.usable.isEmpty ? 'cliente' : meta.usable.first.name} '
              'nombre Juan».'
          : null;
    });
  }

  // ------------------------------------------------------------------ ejecutar

  /// Ejecuta lo confirmado, en orden.
  ///
  /// En orden porque una operación puede apuntar a lo que creó la anterior. Lo
  /// que se creó se va guardando para poder resolver esas referencias, y todo
  /// pasa por el repositorio, de modo que sin red se encola igual que
  /// cualquier otra alta hecha a mano.
  Future<void> _run() async {
    final repository = ref.read(repositoryProvider);
    if (repository == null || _running) return;

    setState(() => _running = true);
    final created = <String, String>{};
    var done = 0;

    try {
      for (final operation in _planned) {
        if (operation.kind != OperationKind.create) continue;

        final values = Map<String, dynamic>.from(operation.values);

        for (final entry in operation.references.entries) {
          final id = created[entry.value];
          if (id == null) continue;

          final target = ref.read(connectionProvider).meta!.byName(entry.value);
          if (target == null) continue;

          values[entry.key] = {
            target.idField.name: int.tryParse(id) ?? id,
          };
        }

        final saved = await repository.create(operation.entity, values);
        created[operation.entity.name] = saved.id;
        done++;
      }

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            done == 1
                ? 'Se dio de alta 1 registro.'
                : 'Se dieron de alta $done registros.',
          ),
        ),
      );
      setState(() {
        _planned = [];
        _heard = '';
        _textController.clear();
      });
    } catch (error) {
      if (mounted) setState(() => _error = 'No se pudo ejecutar: $error');
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  // -------------------------------------------------------------- el modelo

  Future<void> _downloadModel() async {
    setState(() => _downloadPercent = 0);

    try {
      await for (final percent in _model.download()) {
        if (!mounted) return;
        setState(() => _downloadPercent = percent);
      }
      if (!mounted) return;
      setState(() {
        _downloadPercent = null;
        _modelInstalled = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _downloadPercent = null;
        _error = 'No se pudo descargar el modelo: $error. '
            'El asistente sigue funcionando con las reglas del teléfono.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dictar una orden'),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(28),
          child: SyncIndicator(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _ModelBanner(
            installed: _modelInstalled,
            percent: _downloadPercent,
            onDownload: _downloadModel,
          ),
          const SizedBox(height: 16),

          TextField(
            controller: _textController,
            maxLines: 3,
            decoration: InputDecoration(
              labelText: 'Lo que se dictó',
              hintText: 'registrar cliente Juan y cobrarle 10 pesos',
              border: const OutlineInputBorder(),
              suffixIcon: IconButton(
                icon: const Icon(Icons.send),
                onPressed: _thinking
                    ? null
                    : () => _interpret(_textController.text),
              ),
            ),
            onSubmitted: _interpret,
          ),
          const SizedBox(height: 12),

          FilledButton.icon(
            onPressed: _thinking ? null : _listen,
            style: _listening
                ? FilledButton.styleFrom(backgroundColor: Colors.red.shade700)
                : null,
            icon: Icon(_listening ? Icons.stop : Icons.mic),
            label: Text(_listening ? 'Estoy escuchando… toque para parar' : 'Dictar'),
          ),

          if (_listening && _heard.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('“$_heard”', style: const TextStyle(fontStyle: FontStyle.italic)),
          ],

          if (_thinking) ...[
            const SizedBox(height: 24),
            const Center(child: CircularProgressIndicator()),
            const SizedBox(height: 8),
            const Center(child: Text('Entendiendo la orden…')),
          ],

          if (_error != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text(_error!),
            ),
          ],

          if (_planned.isNotEmpty) ...[
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Esto es lo que se entendió',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                if (_interpretedBy != null)
                  Text(
                    'con $_interpretedBy',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
            const SizedBox(height: 4),
            const Text(
              'No se ha guardado nada todavía. Revise y confirme.',
              style: TextStyle(fontSize: 12),
            ),
            const SizedBox(height: 12),

            for (final operation in _planned) _OperationCard(operation: operation),

            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _running
                        ? null
                        : () => setState(() => _planned = []),
                    child: const Text('Descartar'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _running ? null : _run,
                    icon: _running
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.check),
                    label: Text(_running ? 'Guardando…' : 'Confirmar'),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// Una operación entendida, con lo que va a guardar y lo que se descartó.
class _OperationCard extends StatelessWidget {
  const _OperationCard({required this.operation});

  final PlannedOperation operation;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(
          operation.kind == OperationKind.create
              ? Icons.add_circle_outline
              : Icons.remove_circle_outline,
        ),
        title: Text(operation.title),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(operation.detail),
            for (final warning in operation.warnings)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.warning_amber_outlined,
                      size: 14,
                      color: Colors.orange.shade800,
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        warning,
                        style: TextStyle(
                          fontSize: 12,
                          color: Colors.orange.shade900,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// El estado del modelo local: si está, si se está bajando, o cómo bajarlo.
class _ModelBanner extends StatelessWidget {
  const _ModelBanner({
    required this.installed,
    required this.percent,
    required this.onDownload,
  });

  final bool installed;
  final int? percent;
  final VoidCallback onDownload;

  @override
  Widget build(BuildContext context) {
    if (percent != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Descargando el modelo… $percent %'),
          const SizedBox(height: 8),
          LinearProgressIndicator(value: percent! / 100),
        ],
      );
    }

    if (installed) {
      return Row(
        children: [
          Icon(Icons.psychology, size: 16, color: Colors.green.shade700),
          const SizedBox(width: 6),
          const Expanded(
            child: Text(
              'El modelo está en este teléfono: funciona sin conexión.',
              style: TextStyle(fontSize: 12),
            ),
          ),
        ],
      );
    }

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.blue.shade50,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Se puede dictar ya: las reglas del teléfono entienden órdenes '
            'como «registrar cliente Juan». Para frases más libres se puede '
            'descargar un modelo de lenguaje, que ocupa unos cientos de megas '
            'y se queda en el teléfono.',
            style: TextStyle(fontSize: 12),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: onDownload,
            icon: const Icon(Icons.download, size: 16),
            label: const Text('Descargar el modelo'),
          ),
        ],
      ),
    );
  }
}
