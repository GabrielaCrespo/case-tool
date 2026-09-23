import 'dart:async';
import 'dart:io';
import 'dart:isolate';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/services.dart' show rootBundle;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import 'package:sherpa_onnx/sherpa_onnx.dart' as sherpa;

/// CU09 — La transcripción, en el propio teléfono y sin red.
///
/// La primera versión se la pedía al reconocedor de Android con `onDevice`, y
/// eso sólo funciona si el teléfono tiene descargado el paquete de español de
/// Google. Sin él, Android contesta `error_language_unavailable`; el reintento
/// dejándole usar la red da `error_network`, porque justamente no hay red. Es
/// lo que se veía en modo avión, y no había nada que la aplicación pudiera
/// hacer al respecto: el modelo era del sistema, no suyo.
///
/// Ahora el modelo viaja dentro del APK (`assets/voz`): Moonshine base en
/// español para transcribir y Silero para saber cuándo se está hablando. No
/// depende del teléfono, ni de Google, ni de la red; funciona igual la primera
/// vez que se abre la aplicación en modo avión que con cobertura.
///
/// Se graba mientras se habla y se transcribe al terminar. Moonshine no va
/// soltando texto provisional como hacía el reconocedor de Android, pero una
/// orden son dos o tres segundos de voz y transcribirla tarda algo parecido.
class SpeechRecognizer {
  static const int sampleRate = 16000;

  /// Cuánto silencio después de haber hablado se entiende como «ya terminé».
  /// Silero tarda medio segundo en dar la voz por acabada; esto va encima, y
  /// entre los dos dejan hacer una pausa corta en mitad de la orden.
  static const Duration _endOfSpeech = Duration(milliseconds: 1000);

  /// Si en este tiempo no ha hablado nadie, se deja de grabar.
  static const Duration _nobodySpoke = Duration(seconds: 7);

  /// Lo más largo que se graba de una tirada.
  static const Duration _longest = Duration(seconds: 20);

  /// Lo que se conserva de antes de que Silero detecte la voz. Tarda un
  /// cuarto de segundo en decidir que alguien habla, y sin este margen la
  /// primera sílaba —casi siempre la del verbo— se perdería.
  static const int _lead = sampleRate * 3 ~/ 4;

  final AudioRecorder _recorder = AudioRecorder();

  /// El detector de voz y el transcriptor, que tardan en cargar. Se preparan
  /// una vez por pantalla y se reutilizan en cada dictado.
  Future<_Engine>? _engine;

  StreamSubscription<Uint8List>? _audio;
  final List<Float32List> _chunks = [];
  int _length = 0;

  /// Desde qué muestra hay voz, y cuándo se oyó por última vez.
  int? _voiceFrom;
  DateTime? _lastVoice;
  DateTime? _startedAt;

  bool _listening = false;
  bool _disposed = false;

  void Function(double level)? _onLevel;
  void Function()? _onTranscribing;
  void Function(String text)? _onResult;
  void Function(SpeechFailure failure)? _onFailure;

  bool get isListening => _listening;

  /// Deja el modelo cargado antes de que se pulse «Dictar», para que el
  /// primer dictado no espere a que se cargue.
  Future<void> prepare() async {
    try {
      await _prepared();
    } catch (_) {
      // Se volverá a intentar al dictar, y allí se explicará qué pasa.
    }
  }

  Future<_Engine> _prepared() {
    final engine = _engine ??= _Engine.start();

    // Si falla, se olvida, para que el siguiente intento empiece de cero y no
    // repita para siempre el mismo error.
    return engine.catchError((Object error) {
      if (identical(_engine, engine)) _engine = null;
      throw error;
    });
  }

  /// Graba hasta que se deja de hablar y entrega lo que se dijo.
  ///
  /// [onLevel] da el volumen que entra, de 0 a 1, para enseñar que el
  /// micrófono está abierto. [onTranscribing] avisa de que ya se cerró el
  /// micrófono y se está pasando a texto. Después llega [onResult] con el
  /// texto, o [onFailure] con lo que haya salido mal.
  Future<void> listen({
    required void Function(double level) onLevel,
    required void Function() onTranscribing,
    required void Function(String text) onResult,
    required void Function(SpeechFailure failure) onFailure,
  }) async {
    if (_listening || _disposed) return;

    final _Engine engine;
    try {
      engine = await _prepared();
    } catch (error) {
      onFailure(
        SpeechFailure(
          kind: SpeechFailureKind.unavailable,
          message: 'No se pudo cargar el modelo de voz del teléfono ($error).',
        ),
      );
      return;
    }

    if (!await _recorder.hasPermission()) {
      onFailure(
        const SpeechFailure(
          kind: SpeechFailureKind.unavailable,
          message: 'Falta permiso para el micrófono. Se concede en Ajustes → '
              'Aplicaciones → CASE Tool → Permisos → Micrófono.',
        ),
      );
      return;
    }

    final Stream<Uint8List> stream;
    try {
      stream = await _recorder.startStream(
        const RecordConfig(
          encoder: AudioEncoder.pcm16bits,
          sampleRate: sampleRate,
          numChannels: 1,
          // Quien dicta lejos del teléfono llega muy flojo, y Silero no lo
          // distinguiría del ruido.
          autoGain: true,
          androidConfig: AndroidRecordConfig(
            // La fuente que Android prepara para reconocer voz.
            audioSource: AndroidAudioSource.voiceRecognition,
          ),
        ),
      );
    } catch (error) {
      onFailure(
        SpeechFailure(
          kind: SpeechFailureKind.unavailable,
          message: 'No se pudo abrir el micrófono. Puede que otra aplicación '
              'lo esté usando. ($error)',
        ),
      );
      return;
    }

    engine.vad.reset();
    _chunks.clear();
    _length = 0;
    _voiceFrom = null;
    _lastVoice = null;
    _startedAt = DateTime.now();

    _onLevel = onLevel;
    _onTranscribing = onTranscribing;
    _onResult = onResult;
    _onFailure = onFailure;
    _listening = true;

    _audio = stream.listen(
      (bytes) => _hear(engine, bytes),
      onError: (Object error) => _finish(
        transcribe: false,
        failure: SpeechFailure(
          kind: SpeechFailureKind.other,
          message: 'Se cortó la grabación ($error).',
        ),
      ),
    );
  }

  /// Termina de grabar y transcribe lo grabado. Es lo que hace el botón
  /// «Terminé de hablar».
  Future<void> stop() => _finish(transcribe: true);

  /// Termina de grabar y lo descarta.
  Future<void> cancel() => _finish(transcribe: false);

  Future<void> dispose() async {
    _disposed = true;
    await cancel();
    await _recorder.dispose();

    final engine = _engine;
    _engine = null;
    try {
      (await engine)?.close();
    } catch (_) {
      // No llegó a cargarse: no hay nada que cerrar.
    }
  }

  // ------------------------------------------------------------ la grabación

  void _hear(_Engine engine, Uint8List bytes) {
    if (!_listening) return;

    final samples = pcm16ToFloat(bytes);
    if (samples.isEmpty) return;

    _chunks.add(samples);
    _length += samples.length;
    _onLevel?.call(levelOf(samples));

    engine.vad.acceptWaveform(samples);
    // Los trozos de voz que va cortando Silero no se usan: sólo interesa si
    // ahora mismo alguien está hablando. Se sacan para que no se acumulen.
    while (!engine.vad.isEmpty()) {
      engine.vad.pop();
    }

    final now = DateTime.now();

    if (engine.vad.isDetected()) {
      _voiceFrom ??= math.max(0, _length - samples.length - _lead);
      _lastVoice = now;
    }

    if (_lastVoice != null && now.difference(_lastVoice!) > _endOfSpeech) {
      unawaited(_finish(transcribe: true));
    } else if (_lastVoice == null &&
        now.difference(_startedAt!) > _nobodySpoke) {
      unawaited(
        _finish(
          transcribe: false,
          failure: const SpeechFailure(
            kind: SpeechFailureKind.silence,
            message: 'No se oyó a nadie. Compruebe que el micrófono no está '
                'tapado y hable cerca del teléfono.',
          ),
        ),
      );
    } else if (now.difference(_startedAt!) > _longest) {
      unawaited(_finish(transcribe: true));
    }
  }

  Future<void> _finish({required bool transcribe, SpeechFailure? failure}) async {
    if (!_listening) return;
    _listening = false;

    final onTranscribing = _onTranscribing;
    final onResult = _onResult;
    final onFailure = _onFailure;
    _onLevel = null;
    _onTranscribing = null;
    _onResult = null;
    _onFailure = null;

    await _audio?.cancel();
    _audio = null;
    try {
      await _recorder.stop();
    } catch (_) {
      // Ya estaba parado.
    }

    if (failure != null) {
      onFailure?.call(failure);
      return;
    }
    if (!transcribe || _disposed) return;

    // Si Silero no detectó voz pero quien dicta dice que ya terminó, se
    // transcribe todo igual: puede haber hablado bajito, y es mejor intentar
    // que dar por hecho que no dijo nada.
    final audio = _collect(from: _voiceFrom ?? 0);
    if (audio.length < sampleRate ~/ 4) {
      onFailure?.call(
        const SpeechFailure(
          kind: SpeechFailureKind.silence,
          message: 'No dio tiempo a oír nada. Pulse «Dictar» y hable.',
        ),
      );
      return;
    }

    onTranscribing?.call();
    try {
      final engine = await _prepared();
      final text = (await engine.transcriber.transcribe(audio)).trim();

      if (text.isEmpty) {
        onFailure?.call(
          const SpeechFailure(
            kind: SpeechFailureKind.noMatch,
            message: 'No se entendió lo que se dijo. Inténtelo otra vez, más '
                'despacio y cerca del micrófono.',
          ),
        );
        return;
      }
      onResult?.call(text);
    } catch (error) {
      onFailure?.call(
        SpeechFailure(
          kind: SpeechFailureKind.other,
          message: 'No se pudo pasar a texto ($error). Puede escribir la orden.',
        ),
      );
    }
  }

  Float32List _collect({required int from}) {
    final audio = Float32List(math.max(0, _length - from));
    var position = 0;
    var offset = 0;

    for (final chunk in _chunks) {
      final end = position + chunk.length;
      if (end > from) {
        final start = math.max(0, from - position);
        audio.setRange(offset, offset + chunk.length - start, chunk, start);
        offset += chunk.length - start;
      }
      position = end;
    }
    return audio;
  }

  // ---------------------------------------------------------------- utilidades

  /// El micrófono entrega enteros de 16 bits; el modelo quiere de -1 a 1.
  static Float32List pcm16ToFloat(Uint8List bytes) {
    final data = ByteData.sublistView(bytes);
    final samples = Float32List(bytes.length ~/ 2);

    for (var i = 0; i < samples.length; i++) {
      samples[i] = data.getInt16(i * 2, Endian.little) / 32768.0;
    }
    return samples;
  }

  /// El volumen de un trozo, de 0 a 1, para el círculo que late en pantalla.
  ///
  /// En decibelios y no en amplitud, porque así lo oye el oído: con la
  /// amplitud tal cual, hablar normal apenas movería el círculo.
  static double levelOf(Float32List samples) {
    if (samples.isEmpty) return 0;

    var sum = 0.0;
    for (final sample in samples) {
      sum += sample * sample;
    }
    final rms = math.sqrt(sum / samples.length);
    if (rms <= 0) return 0;

    final decibels = 20 * math.log(rms) / math.ln10;
    return ((decibels + 55) / 40).clamp(0.0, 1.0);
  }
}

/// El detector de voz, en el hilo principal porque es ligero y hay que
/// consultarlo con cada trozo que llega, y el transcriptor, en su propio
/// isolate porque pasar a texto tarda un par de segundos y congelaría la
/// pantalla.
class _Engine {
  _Engine(this.vad, this.transcriber);

  final sherpa.VoiceActivityDetector vad;
  final Transcriber transcriber;

  static Future<_Engine> start() async {
    final files = await VoiceModelFiles.install();

    sherpa.initBindings();
    final vad = sherpa.VoiceActivityDetector(
      config: sherpa.VadModelConfig(
        sileroVad: sherpa.SileroVadModelConfig(
          model: files.vad,
          minSilenceDuration: 0.5,
          minSpeechDuration: 0.25,
          maxSpeechDuration: 20,
        ),
        sampleRate: SpeechRecognizer.sampleRate,
        debug: false,
      ),
      bufferSizeInSeconds: 30,
    );

    try {
      return _Engine(vad, await Transcriber.start(files));
    } catch (_) {
      vad.free();
      rethrow;
    }
  }

  void close() {
    vad.free();
    transcriber.close();
  }
}

/// Moonshine, cargado en un isolate aparte y listo para transcribir.
///
/// Se carga una vez y atiende todos los dictados de la pantalla: cargar el
/// modelo lleva casi tanto como transcribir una orden, y hacerlo cada vez
/// doblaría la espera.
class Transcriber {
  Transcriber._(this._requests);

  final SendPort _requests;

  static Future<Transcriber> start(VoiceModelFiles files) async {
    final ready = ReceivePort();
    final isolate = await Isolate.spawn(
      _work,
      (ready.sendPort, files.encoder, files.decoder, files.tokens),
    );

    final answer = await ready.first;
    if (answer is SendPort) return Transcriber._(answer);

    isolate.kill();
    throw StateError('$answer');
  }

  /// Pasa a texto unas muestras a 16 kHz.
  Future<String> transcribe(Float32List samples) async {
    final reply = ReceivePort();
    _requests.send((samples, reply.sendPort));

    final (text, error) = await reply.first as (String, String?);
    if (error != null) throw StateError(error);

    return text;
  }

  /// Libera el modelo y termina el isolate.
  void close() => _requests.send(null);

  static void _work((SendPort, String, String, String) setup) {
    final (ready, encoder, decoder, tokens) = setup;
    final sherpa.OfflineRecognizer recognizer;

    try {
      sherpa.initBindings();
      recognizer = sherpa.OfflineRecognizer(
        sherpa.OfflineRecognizerConfig(
          model: sherpa.OfflineModelConfig(
            moonshine: sherpa.OfflineMoonshineModelConfig(
              encoder: encoder,
              mergedDecoder: decoder,
            ),
            tokens: tokens,
            numThreads: 2,
            debug: false,
          ),
        ),
      );
    } catch (error) {
      ready.send('$error');
      return;
    }

    final requests = ReceivePort();
    ready.send(requests.sendPort);

    requests.listen((message) {
      if (message == null) {
        recognizer.free();
        requests.close();
        return;
      }

      final (samples, reply) = message as (Float32List, SendPort);
      final stream = recognizer.createStream();
      try {
        stream.acceptWaveform(
          samples: samples,
          sampleRate: SpeechRecognizer.sampleRate,
        );
        recognizer.decode(stream);
        reply.send((recognizer.getResult(stream).text, null));
      } catch (error) {
        reply.send(('', '$error'));
      } finally {
        stream.free();
      }
    });
  }
}

/// Los archivos del modelo de voz, ya en el disco del teléfono.
///
/// sherpa-onnx lee de rutas, no de los assets del APK, así que la primera vez
/// se copian a la carpeta de la aplicación. Se copian a una carpeta con la
/// versión del modelo en el nombre y se marca al final: una copia cortada a
/// la mitad no se da por buena, y cambiar de modelo no reutiliza el viejo.
class VoiceModelFiles {
  const VoiceModelFiles({
    required this.encoder,
    required this.decoder,
    required this.tokens,
    required this.vad,
  });

  final String encoder;
  final String decoder;
  final String tokens;
  final String vad;

  static const String _version = 'moonshine-base-es-2026-02-27';

  static const List<String> _assets = [
    'encoder_model.ort',
    'decoder_model_merged.ort',
    'tokens.txt',
    'silero_vad.onnx',
  ];

  static Future<VoiceModelFiles> install() async {
    final base = await getApplicationSupportDirectory();
    final directory = Directory(p.join(base.path, 'voz', _version));
    final done = File(p.join(directory.path, '.completo'));

    if (!await done.exists()) {
      await directory.create(recursive: true);

      for (final name in _assets) {
        final data = await rootBundle.load('assets/voz/$name');
        final partial = File(p.join(directory.path, '$name.parcial'));

        await partial.writeAsBytes(
          data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes),
          flush: true,
        );
        await partial.rename(p.join(directory.path, name));
      }
      await done.writeAsString(_version, flush: true);
    }

    return VoiceModelFiles.at(directory.path);
  }

  /// Los archivos de una carpeta que ya los tiene. Sirve también para
  /// probarlos fuera del teléfono.
  factory VoiceModelFiles.at(String directory) => VoiceModelFiles(
        encoder: p.join(directory, 'encoder_model.ort'),
        decoder: p.join(directory, 'decoder_model_merged.ort'),
        tokens: p.join(directory, 'tokens.txt'),
        vad: p.join(directory, 'silero_vad.onnx'),
      );
}

/// Por qué no se pudo dictar, en términos que se puedan enseñar.
enum SpeechFailureKind {
  /// No hay micrófono, no hay permiso o no se pudo cargar el modelo.
  unavailable,

  /// Se escuchó, pero no salió ningún texto.
  noMatch,

  /// Nadie habló.
  silence,

  /// Cualquier otra cosa.
  other,
}

class SpeechFailure {
  const SpeechFailure({required this.kind, required this.message});

  final SpeechFailureKind kind;

  /// Ya redactado para enseñarlo tal cual.
  final String message;
}
