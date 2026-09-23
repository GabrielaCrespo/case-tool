import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/meta.dart';
import '../../app_state.dart';
import '../../widgets/sync_indicator.dart';
import 'grammar.dart';
import 'local_model.dart';
import 'operations.dart';
import 'speech.dart';

/// CU09 — El asistente por voz del teléfono.
///
/// Todo lo de esta pantalla ocurre en el dispositivo: transcribe un modelo de
/// voz que viaja dentro de la aplicación, interpreta un modelo pequeño
/// descargado en el teléfono y, si ése no acierta, una gramática escrita a
/// mano. Ninguna de las tres cosas necesita red, que es justo el requisito.
///
/// Y nada se ejecuta sin confirmar. Lo entendido se enseña primero —qué se va
/// a dar de alta, con qué valores y qué falta—, exactamente igual que el
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

  bool _listening = false;

  /// Ya se cerró el micrófono y se está pasando la voz a texto.
  bool _transcribing = false;
  bool _thinking = false;
  bool _running = false;

  /// El volumen que está entrando por el micrófono, de 0 a 1. Es la prueba de
  /// que se está grabando aunque todavía no se haya entendido una palabra.
  double _level = 0;

  List<PlannedOperation> _planned = [];
  String? _error;
  String? _interpretedBy;

  /// Lo que dijo el reconocedor cuando no pudo, ya redactado.
  SpeechFailure? _speechFailure;

  /// El avance de la descarga del modelo, mientras se esté descargando.
  ModelDownload? _download;
  bool _modelInstalled = false;
  String? _modelError;

  final _tokenController = TextEditingController();
  bool _askingToken = false;

  @override
  void initState() {
    super.initState();
    unawaited(_checkModel());
    // El modelo de voz se carga ya, mientras se lee la pantalla, para que el
    // primer «Dictar» no tenga que esperarlo.
    unawaited(_speech.prepare());
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
    _tokenController.dispose();
    unawaited(_speech.dispose());
    unawaited(_model.close());
    super.dispose();
  }

  // ------------------------------------------------------------------- dictar

  /// Abre el micrófono, o lo cierra si ya estaba abierto: el mismo botón sirve
  /// para «ya terminé de hablar».
  Future<void> _listen() async {
    if (_listening) {
      await _speech.stop();
      return;
    }

    setState(() {
      _error = null;
      _speechFailure = null;
      _planned = [];
      _level = 0;
      _listening = true;
    });

    await _speech.listen(
      onLevel: (level) {
        if (mounted) setState(() => _level = level);
      },
      onTranscribing: () {
        if (!mounted) return;
        setState(() {
          _listening = false;
          _transcribing = true;
        });
      },
      onResult: (text) {
        if (!mounted) return;
        setState(() {
          _transcribing = false;
          _textController.text = text;
        });
        unawaited(_interpret(text));
      },
      onFailure: (failure) {
        if (!mounted) return;
        setState(() {
          _listening = false;
          _transcribing = false;
          _level = 0;
          _speechFailure = failure;
        });
      },
    );
  }

  // -------------------------------------------------------------- interpretar

  /// Primero el modelo, y si no saca nada, la gramática.
  ///
  /// Ese orden y no al revés: el modelo entiende frases que la gramática no, y
  /// la gramática es la red debajo para que nunca se quede sin respuesta.
  Future<void> _interpret(String dictation) async {
    final meta = ref.read(connectionProvider).meta;
    if (meta == null) return;

    if (dictation.trim().isEmpty) {
      setState(() => _error = 'Escriba o dicte una orden primero.');
      return;
    }

    setState(() {
      _thinking = true;
      _error = null;
      _speechFailure = null;
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
      operations =
          validator.validate(GrammarInterpreter(meta).interpret(dictation));
      if (operations.isNotEmpty) source = 'las reglas del teléfono';
    }

    if (!mounted) return;
    setState(() {
      _planned = operations;
      _interpretedBy = source;
      _thinking = false;
      _error = operations.isEmpty ? _cannotUnderstand(meta) : null;
    });
  }

  /// El aviso de «no lo entendí», con un ejemplo construido con una entidad y
  /// un campo que este backend tiene de verdad.
  ///
  /// El ejemplo se arma mirando el modelo y no con un texto fijo: sugerir
  /// «registrar notaventa nombre Juan» a un backend cuya nota de venta no
  /// tiene ningún campo «nombre» es peor que no sugerir nada.
  String _cannotUnderstand(ModelMeta meta) {
    if (meta.usable.isEmpty) return 'No se entendió la orden.';

    // Se prefiere una entidad con algún texto: es la que da un ejemplo que se
    // lee bien.
    final entity = meta.usable.firstWhere(
      (candidate) =>
          candidate.fields.any((field) => field.kind == FieldKind.text),
      orElse: () => meta.usable.first,
    );

    final field = entity.fields.firstWhere(
      (candidate) => candidate.kind == FieldKind.text,
      orElse: () => entity.fields.isEmpty
          ? const FieldMeta(
              name: 'nombre',
              type: 'String',
              required: true,
              unique: false,
              maxLength: null,
              defaultValue: null,
            )
          : entity.fields.first,
    );

    final example = switch (field.kind) {
      FieldKind.integer || FieldKind.decimal => '10',
      FieldKind.boolean => 'sí',
      FieldKind.date || FieldKind.dateTime => 'hoy',
      FieldKind.text => 'Juan',
    };

    return 'No se entendió la orden. Diga el verbo, la entidad y los datos; '
        'por ejemplo: «registrar ${entity.name.toLowerCase()} '
        '${field.name} $example».';
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

          values[entry.key] = {target.idField.name: int.tryParse(id) ?? id};
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
                ? 'Listo: se dio de alta 1 registro.'
                : 'Listo: se dieron de alta $done registros.',
          ),
        ),
      );
      setState(() {
        _planned = [];
        _textController.clear();
      });
    } catch (error) {
      if (mounted) setState(() => _error = 'No se pudo guardar: $error');
    } finally {
      if (mounted) setState(() => _running = false);
    }
  }

  // -------------------------------------------------------------- el modelo

  Future<void> _downloadModel() async {
    setState(() {
      _download = const ModelDownload(received: 0, total: -1);
      _modelError = null;
    });

    try {
      await for (final progress
          in _model.download(token: _tokenController.text)) {
        if (!mounted) return;
        setState(() => _download = progress);
      }
      if (!mounted) return;
      setState(() {
        _download = null;
        _modelInstalled = true;
        _askingToken = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _download = null;
        _modelError = error is LocalModelUnavailable
            ? error.message
            : 'No se pudo descargar el modelo: $error';
        // Si lo que falta es permiso, se enseña la casilla del token en vez de
        // dejar a quien lo pidió sin saber qué hacer.
        _askingToken = _modelError!.contains('restringido');
      });
    }
  }

  void _cancelDownload() {
    _model.cancelDownload();
    setState(() => _download = null);
  }

  // ------------------------------------------------------------------ pintado

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
            download: _download,
            error: _modelError,
            askingToken: _askingToken,
            tokenController: _tokenController,
            onDownload: _downloadModel,
            onCancel: _cancelDownload,
          ),
          const SizedBox(height: 16),

          // Mientras se graba, la caja de texto sobra: lo que hace falta es
          // que se vea que el micrófono está abierto.
          if (_listening)
            _Listening(level: _level, onStop: _listen)
          else ...[
            TextField(
              controller: _textController,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: 'La orden',
                hintText: 'registrar cliente Juan y cobrarle 10 pesos',
                border: const OutlineInputBorder(),
                suffixIcon: IconButton(
                  tooltip: 'Entender la orden',
                  icon: const Icon(Icons.send),
                  onPressed: _thinking || _transcribing
                      ? null
                      : () => _interpret(_textController.text),
                ),
              ),
              onSubmitted: _interpret,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _thinking || _transcribing ? null : () => _listen(),
              icon: const Icon(Icons.mic),
              label: const Text('Dictar'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ],

          if (_speechFailure != null) ...[
            const SizedBox(height: 12),
            _SpeechProblem(
              failure: _speechFailure!,
              onRetry: () => _listen(),
            ),
          ],

          if (_transcribing) ...[
            const SizedBox(height: 24),
            const Center(child: CircularProgressIndicator()),
            const SizedBox(height: 8),
            const Center(child: Text('Pasando la voz a texto…')),
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
            _Understood(
              operations: _planned,
              interpretedBy: _interpretedBy,
              running: _running,
              onDiscard: () => setState(() => _planned = []),
              onConfirm: _run,
            ),
          ],
        ],
      ),
    );
  }
}

/// Lo que se ve mientras se graba.
///
/// Es la respuesta a «no sé si me está grabando»: un círculo que crece con el
/// volumen que entra por el micrófono, de modo que se mueve en cuanto uno
/// habla. El texto llega al terminar, cuando se transcribe lo grabado.
class _Listening extends StatelessWidget {
  const _Listening({required this.level, required this.onStop});

  final double level;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 20, horizontal: 16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Column(
        children: [
          SizedBox(
            height: 110,
            child: Center(
              child: Stack(
                alignment: Alignment.center,
                children: [
                  // El halo que late con la voz.
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 120),
                    width: 70 + 40 * level,
                    height: 70 + 40 * level,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withValues(alpha: 0.15 + 0.2 * level),
                    ),
                  ),
                  CircleAvatar(
                    radius: 34,
                    backgroundColor: color,
                    child: const Icon(Icons.mic, color: Colors.white, size: 32),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Escuchando… hable ahora',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Diga algo como «registrar cliente Juan»',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontStyle: FontStyle.italic,
              color: Colors.black54,
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onStop,
            icon: const Icon(Icons.stop),
            label: const Text('Terminé de hablar'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(44),
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Se para solo tras unos segundos de silencio.',
            style: TextStyle(fontSize: 11, color: Colors.black45),
          ),
        ],
      ),
    );
  }
}

/// Por qué no se pudo dictar, con lo que se puede hacer al respecto.
class _SpeechProblem extends StatelessWidget {
  const _SpeechProblem({required this.failure, required this.onRetry});

  final SpeechFailure failure;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.orange.shade50,
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.orange.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(Icons.mic_off, size: 18, color: Colors.orange.shade900),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  failure.message,
                  style: TextStyle(fontSize: 13, color: Colors.orange.shade900),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('Volver a intentar'),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'O escriba la orden arriba.',
                  style: TextStyle(fontSize: 11),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Lo que se entendió, escrito para que lo lea quien lo dictó.
///
/// La primera versión enseñaba «Dar de alta CATEGORIA · nombre: limpieza», que
/// es correcto pero se lee como un volcado. Aquí se dice en una frase qué va a
/// pasar, se listan los datos en columna y se avisa en ámbar de lo que falta,
/// que es lo que de verdad hay que mirar antes de confirmar.
class _Understood extends StatelessWidget {
  const _Understood({
    required this.operations,
    required this.interpretedBy,
    required this.running,
    required this.onDiscard,
    required this.onConfirm,
  });

  final List<PlannedOperation> operations;
  final String? interpretedBy;
  final bool running;
  final VoidCallback onDiscard;
  final VoidCallback onConfirm;

  @override
  Widget build(BuildContext context) {
    final total = operations.length;
    final withWarnings =
        operations.where((operation) => operation.warnings.isNotEmpty).length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          total == 1 ? 'Se hará esto:' : 'Se harán estas $total cosas, en orden:',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 2),
        Text(
          'Todavía no se ha guardado nada.'
          '${interpretedBy == null ? '' : ' Lo entendió $interpretedBy.'}',
          style: const TextStyle(fontSize: 12, color: Colors.black54),
        ),
        const SizedBox(height: 12),

        for (var i = 0; i < operations.length; i++)
          _OperationCard(
            operation: operations[i],
            position: i + 1,
            total: total,
          ),

        if (withWarnings > 0) ...[
          const SizedBox(height: 4),
          Text(
            withWarnings == 1
                ? 'Hay un aviso: revíselo antes de confirmar.'
                : 'Hay $withWarnings avisos: revíselos antes de confirmar.',
            style: TextStyle(fontSize: 12, color: Colors.orange.shade900),
          ),
        ],

        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: running ? null : onDiscard,
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(46),
                ),
                child: const Text('Descartar'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton.icon(
                onPressed: running ? null : onConfirm,
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(46),
                ),
                icon: running
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check),
                label: Text(running ? 'Guardando…' : 'Confirmar'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Una operación entendida: qué va a pasar, con qué datos y qué falta.
class _OperationCard extends StatelessWidget {
  const _OperationCard({
    required this.operation,
    required this.position,
    required this.total,
  });

  final PlannedOperation operation;
  final int position;
  final int total;

  @override
  Widget build(BuildContext context) {
    final creating = operation.kind == OperationKind.create;
    final color = creating ? Colors.green.shade700 : Colors.red.shade700;
    final hasData = operation.values.values.any((value) => value != null) ||
        operation.references.isNotEmpty;

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                // El número sólo cuando hay varias: con una sola estorba.
                if (total > 1)
                  CircleAvatar(
                    radius: 11,
                    backgroundColor: color.withValues(alpha: 0.15),
                    child: Text(
                      '$position',
                      style: TextStyle(fontSize: 11, color: color),
                    ),
                  )
                else
                  Icon(
                    creating ? Icons.add_circle_outline : Icons.delete_outline,
                    size: 20,
                    color: color,
                  ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    creating
                        ? 'Se creará un ${operation.entity.name}'
                        : 'Se borrará un ${operation.entity.name}',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),

            if (hasData) ...[
              const SizedBox(height: 10),
              for (final entry in operation.values.entries)
                if (entry.value != null)
                  _Dato(field: entry.key, value: '${entry.value}'),
              for (final entry in operation.references.entries)
                _Dato(
                  field: entry.key,
                  value: 'el ${entry.value} que se crea antes',
                  derived: true,
                ),
            ] else ...[
              const SizedBox(height: 8),
              const Text(
                'Sin ningún dato: se creará vacío.',
                style: TextStyle(fontSize: 13, color: Colors.black54),
              ),
            ],

            for (final warning in operation.warnings) ...[
              const SizedBox(height: 8),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.warning_amber_outlined,
                    size: 15,
                    color: Colors.orange.shade800,
                  ),
                  const SizedBox(width: 6),
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
            ],
          ],
        ),
      ),
    );
  }
}

/// Un par campo–valor, alineado para que se lean en columna.
class _Dato extends StatelessWidget {
  const _Dato({
    required this.field,
    required this.value,
    this.derived = false,
  });

  final String field;
  final String value;

  /// No se dictó: se deduce de otra operación de la misma frase.
  final bool derived;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 96,
            child: Text(
              field,
              style: const TextStyle(fontSize: 13, color: Colors.black54),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 14,
                fontWeight: derived ? FontWeight.normal : FontWeight.w500,
                fontStyle: derived ? FontStyle.italic : FontStyle.normal,
                color: derived ? Colors.black54 : Colors.black87,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// El estado del modelo local: si está, si se está bajando, qué falló, o cómo
/// bajarlo.
///
/// Enseña los megas y no sólo el porcentaje porque son cientos, y quien lo
/// pulsa merece saber en qué se está metiendo. Y enseña el error tal cual: la
/// primera versión se quedaba callada en «0 %» cuando el servidor contestaba
/// que el modelo estaba restringido, que es justo cuando más falta hace
/// explicarse.
class _ModelBanner extends StatelessWidget {
  const _ModelBanner({
    required this.installed,
    required this.download,
    required this.error,
    required this.askingToken,
    required this.tokenController,
    required this.onDownload,
    required this.onCancel,
  });

  final bool installed;
  final ModelDownload? download;
  final String? error;
  final bool askingToken;
  final TextEditingController tokenController;
  final VoidCallback onDownload;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    if (download != null) return _descargando(context);
    if (installed) return _instalado(context);

    return _porDescargar(context);
  }

  Widget _descargando(BuildContext context) {
    final progress = download!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                progress.total > 0
                    ? 'Descargando el modelo… ${progress.percent} % · ${progress.readable}'
                    : 'Empezando la descarga…',
                style: const TextStyle(fontSize: 13),
              ),
            ),
            TextButton(onPressed: onCancel, child: const Text('Cancelar')),
          ],
        ),
        const SizedBox(height: 4),
        // Sin valor mientras no se sepa el tamaño: una barra parada en cero
        // parece que no está pasando nada, y una indeterminada dice «espere».
        LinearProgressIndicator(value: progress.fraction),
        const SizedBox(height: 4),
        const Text(
          'Puede seguir usando el asistente con las reglas del teléfono '
          'mientras tanto.',
          style: TextStyle(fontSize: 11),
        ),
      ],
    );
  }

  Widget _instalado(BuildContext context) {
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

  Widget _porDescargar(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: error == null ? Colors.blue.shade50 : Colors.orange.shade50,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (error != null) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.warning_amber_outlined,
                  size: 16,
                  color: Colors.orange.shade900,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    error!,
                    style:
                        TextStyle(fontSize: 12, color: Colors.orange.shade900),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
          ] else
            const Text(
              'Se puede dictar ya: las reglas del teléfono entienden órdenes '
              'como «registrar cliente Juan». Para frases más libres se puede '
              'descargar un modelo de lenguaje, que ocupa unos 500 MB y se '
              'queda en el teléfono.',
              style: TextStyle(fontSize: 12),
            ),

          // La casilla del token sólo aparece cuando hace falta, que es cuando
          // el modelo elegido tiene licencia restringida.
          if (askingToken) ...[
            const SizedBox(height: 8),
            TextField(
              controller: tokenController,
              decoration: const InputDecoration(
                labelText: 'Token de HuggingFace',
                hintText: 'hf_…',
                helperText: 'Se guarda sólo en este teléfono.',
                helperMaxLines: 2,
                border: OutlineInputBorder(),
                isDense: true,
              ),
            ),
          ],

          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: onDownload,
            icon: const Icon(Icons.download, size: 16),
            label: Text(error == null ? 'Descargar el modelo' : 'Reintentar'),
          ),
        ],
      ),
    );
  }
}
