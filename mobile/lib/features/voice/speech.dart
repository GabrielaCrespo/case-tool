import 'package:speech_to_text/speech_to_text.dart';

/// CU09 — La transcripción, en el propio teléfono.
///
/// Se le pide expresamente al reconocedor que trabaje **sin conexión**
/// (`onDevice`), y eso es lo que sostiene todo lo demás: en modo avión una API
/// de transcripción no valdría, y el requisito es que el asistente funcione sin
/// red. A cambio, el modelo de español tiene que estar descargado en el
/// teléfono; en Android se baja desde los ajustes de voz de Google.
///
/// Es la única diferencia de fondo con la IA del servidor: allí transcribe
/// Groq, porque hay red y hay cuota; aquí no puede haber nada de eso.
class SpeechRecognizer {
  final SpeechToText _speech = SpeechToText();

  bool _ready = false;
  bool get isListening => _speech.isListening;

  /// Prepara el reconocedor y pide permiso para el micrófono.
  Future<bool> prepare() async {
    if (_ready) return true;

    _ready = await _speech.initialize(
      onError: (_) {},
      onStatus: (_) {},
    );
    return _ready;
  }

  /// Si el teléfono tiene el español descargado para reconocer sin conexión.
  ///
  /// Se pregunta para poder avisar antes de la demostración, no después: sin
  /// el modelo descargado, dictar en modo avión no devuelve nada y parece que
  /// la aplicación está rota.
  Future<bool> hasOfflineSpanish() async {
    if (!await prepare()) return false;

    final locales = await _speech.locales();

    return locales.any(
      (locale) => locale.localeId.toLowerCase().startsWith('es'),
    );
  }

  /// Escucha y va entregando lo que entiende.
  ///
  /// [onResult] se llama con lo provisional mientras se habla y con lo
  /// definitivo al terminar, que es lo que permite enseñar el texto formándose
  /// en pantalla.
  Future<void> listen({
    required void Function(String text, bool finished) onResult,
    String localeId = 'es_ES',
  }) async {
    if (!await prepare()) {
      throw const SpeechUnavailable(
        'Este teléfono no tiene reconocimiento de voz disponible.',
      );
    }

    await _speech.listen(
      onResult: (result) => onResult(result.recognizedWords, result.finalResult),
      listenOptions: SpeechListenOptions(
        localeId: localeId,
        // Lo importante de toda esta pantalla: en el dispositivo, sin red.
        onDevice: true,
        listenMode: ListenMode.dictation,
        partialResults: true,
        cancelOnError: true,
        // Tres segundos de silencio se entienden como «ya terminé de hablar»,
        // y medio minuto es todo lo que se admite de una tirada.
        pauseFor: const Duration(seconds: 3),
        listenFor: const Duration(seconds: 30),
      ),
    );
  }

  Future<void> stop() => _speech.stop();

  Future<void> cancel() => _speech.cancel();
}

class SpeechUnavailable implements Exception {
  const SpeechUnavailable(this.message);

  final String message;

  @override
  String toString() => message;
}
