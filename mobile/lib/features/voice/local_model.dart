import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_gemma/core/model.dart';
import 'package:flutter_gemma/flutter_gemma.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../api/meta.dart';

/// CU09 — El intérprete de lenguaje natural que corre en el teléfono.
///
/// Es la otra mitad de la separación que exige el enunciado: la IA del
/// servidor está en la nube (Groq) porque allí hay red y hay cuota, y ésta
/// tiene que estar aquí porque tiene que funcionar en modo avión.
///
/// El modelo **no viaja dentro del APK**. Son cientos de megas, y meterlos en
/// el instalador haría inútil la aplicación para quien sólo quiere dar de alta
/// un cliente. Se descarga la primera vez que alguien lo pide, con su barra de
/// progreso, y a partir de ahí ya está.
///
/// Lo que se le pide es un JSON de operaciones de un conjunto cerrado. Lo que
/// devuelva es una propuesta: quien decide si vale es [OperationValidator],
/// comprobándolo contra `_meta`.
class LocalModel {
  LocalModel();

  /// De dónde se baja.
  ///
  /// Es un Qwen2.5 de 0,5B en el formato `.task` que espera MediaPipe, y no el
  /// Gemma que se había previsto, por una razón práctica: **el repositorio de
  /// Gemma en HuggingFace está restringido**. Devuelve 401 con
  /// `X-Error-Code: GatedRepo` a quien no haya aceptado su licencia y no mande
  /// un token, y como el descargador no sabía de cabeceras, la barra se
  /// quedaba en 0 % para siempre sin decir por qué.
  ///
  /// Quien quiera usar Gemma igualmente puede: hay que aceptar la licencia en
  /// HuggingFace y pegar un token en la pantalla del asistente.
  static const String defaultModelUrl =
      'https://huggingface.co/litert-community/Qwen2.5-0.5B-Instruct/resolve/main/'
      'Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task';

  /// Dónde se guarda el archivo, y con qué token se pidió.
  static const _prefsPathKey = 'modelo_local_ruta';
  static const _prefsTokenKey = 'modelo_local_token';

  final Dio _dio = Dio();

  InferenceModel? _model;
  CancelToken? _download;

  // ------------------------------------------------------------ el archivo

  /// El archivo del modelo en este teléfono, si está descargado entero.
  Future<File?> installedFile() async {
    final preferences = await SharedPreferences.getInstance();
    final path = preferences.getString(_prefsPathKey);

    if (path == null) return null;

    final file = File(path);
    return await file.exists() ? file : null;
  }

  Future<bool> get isInstalled async => await installedFile() != null;

  /// Cuánto ocupa lo descargado, para poder decirlo en pantalla.
  Future<int> installedBytes() async => (await installedFile())?.length() ?? 0;

  /// Borra el modelo descargado.
  Future<void> remove() async {
    final file = await installedFile();
    await file?.delete();

    final preferences = await SharedPreferences.getInstance();
    await preferences.remove(_prefsPathKey);

    await close();
  }

  // ----------------------------------------------------------- la descarga

  /// Descarga el modelo, informando del avance.
  ///
  /// Se hace aquí y no con el descargador que trae la librería porque aquél no
  /// sabe mandar cabeceras —imprescindible para un repositorio restringido— y
  /// porque ante un 401 se quedaba callado en el 0 % en vez de decir que no
  /// tenía permiso.
  ///
  /// Se baja a un archivo temporal y sólo al final se pone en su sitio: así
  /// una descarga cortada a la mitad no queda registrada como un modelo
  /// completo que después no se puede cargar.
  Stream<ModelDownload> download({String? url, String? token}) async* {
    final target = url ?? defaultModelUrl;
    final directory = await getApplicationSupportDirectory();
    final file = File(p.join(directory.path, p.basename(Uri.parse(target).path)));
    final partial = File('${file.path}.parcial');

    final progress = StreamController<ModelDownload>();
    _download = CancelToken();

    unawaited(
      _dio
          .download(
        target,
        partial.path,
        cancelToken: _download,
        options: Options(
          headers: {
            if (token != null && token.trim().isNotEmpty)
              'Authorization': 'Bearer ${token.trim()}',
          },
          followRedirects: true,
          receiveTimeout: const Duration(minutes: 30),
        ),
        onReceiveProgress: (received, total) {
          progress.add(ModelDownload(received: received, total: total));
        },
      )
          .then((_) async {
        if (await file.exists()) await file.delete();
        await partial.rename(file.path);

        final preferences = await SharedPreferences.getInstance();
        await preferences.setString(_prefsPathKey, file.path);
        if (token != null && token.trim().isNotEmpty) {
          await preferences.setString(_prefsTokenKey, token.trim());
        }

        progress.add(ModelDownload(received: 1, total: 1, finished: true));
        await progress.close();
      }).catchError((Object error) async {
        await partial.delete().catchError((_) => partial);
        progress.addError(_explain(error));
        await progress.close();
      }),
    );

    yield* progress.stream;
  }

  void cancelDownload() {
    _download?.cancel('cancelado por quien lo pidió');
    _download = null;
  }

  /// Traduce el fallo de la descarga a algo que se pueda leer en pantalla.
  ///
  /// El caso que más se da es el 401: casi todos los modelos buenos están tras
  /// una licencia que hay que aceptar, y sin decirlo la pantalla sólo enseña
  /// una barra que no avanza.
  LocalModelUnavailable _explain(Object error) {
    if (error is DioException) {
      final code = error.response?.statusCode;

      if (code == 401 || code == 403) {
        return const LocalModelUnavailable(
          'Ese modelo está restringido: hay que aceptar su licencia en '
          'HuggingFace y pegar aquí un token de acceso. El asistente funciona '
          'igual sin él, con las reglas del teléfono.',
        );
      }
      if (code == 404) {
        return const LocalModelUnavailable('Esa dirección no existe.');
      }
      if (error.type == DioExceptionType.cancel) {
        return const LocalModelUnavailable('Descarga cancelada.');
      }
      return LocalModelUnavailable(
        'No se pudo descargar: ${error.message ?? 'sin conexión'}.',
      );
    }
    return LocalModelUnavailable('No se pudo descargar: $error');
  }

  // ------------------------------------------------------------- el modelo

  Future<void> _ensureLoaded() async {
    if (_model != null) return;

    final file = await installedFile();
    if (file == null) {
      throw const LocalModelUnavailable(
        'El modelo todavía no está descargado en este teléfono.',
      );
    }

    // La librería guarda el suyo en una carpeta propia; aquí se le dice dónde
    // está el que se bajó, que es lo que permite haberlo descargado aparte.
    await FlutterGemmaPlugin.instance.modelManager.setModelPath(file.path);

    _model = await FlutterGemmaPlugin.instance.createModel(
      modelType: ModelType.gemmaIt,
      maxTokens: 1024,
    );
  }

  /// Interpreta un dictado y devuelve las operaciones que propone.
  ///
  /// Devuelve una lista vacía si no entendió nada o si lo que devolvió no era
  /// JSON. No es un fallo del que haya que avisar: es la señal de que hay que
  /// probar con la gramática, que siempre contesta lo mismo.
  Future<List<Map<String, dynamic>>> interpret(
    String dictation,
    ModelMeta meta,
  ) async {
    await _ensureLoaded();

    final session = await _model!.createSession(
      // Lo más determinista que admite: aquí no se quiere creatividad, se
      // quiere el mismo JSON siempre que se diga la misma frase.
      temperature: 0.1,
      topK: 1,
    );

    try {
      await session.addQueryChunk(Message.text(text: _prompt(dictation, meta)));
      final answer = await session.getResponse();

      return _parse(answer);
    } finally {
      await session.close();
    }
  }

  /// Lo que se le enseña al modelo: el resumen del modelo de datos y la orden.
  ///
  /// El resumen es de `_meta` y no del diagrama: es lo único que esta
  /// aplicación conoce, y es lo que hace que el mismo prompt valga para
  /// cualquier backend generado.
  String _prompt(String dictation, ModelMeta meta) {
    final buffer = StringBuffer()
      ..writeln(
        'Eres un asistente que convierte órdenes en español a operaciones '
        'sobre una base de datos. Responde ÚNICAMENTE con JSON, sin explicar '
        'nada y sin marcas de código.',
      )
      ..writeln()
      ..writeln('Entidades disponibles:');

    for (final entity in meta.usable) {
      final fields = entity.fields
          .map((field) => '${field.name}:${field.type}'
              '${field.required ? '(obligatorio)' : ''}')
          .join(', ');

      buffer.writeln('- ${entity.name}: $fields');

      for (final relation in entity.editableRelations) {
        buffer.writeln('    relación ${relation.field} -> ${relation.target}');
      }
    }

    buffer
      ..writeln()
      ..writeln('Formato de la respuesta:')
      ..writeln(
        '{"operations":[{"op":"CREATE","entity":"NOMBRE","values":{"campo":"valor"}}]}',
      )
      ..writeln()
      ..writeln(
        'Para apuntar a algo creado en una operación anterior de la misma '
        'frase, usa el valor "$_reference" en el campo de la relación.',
      )
      ..writeln('«op» sólo puede ser CREATE o DELETE.')
      ..writeln('No inventes campos que no estén en la lista.')
      ..writeln()
      ..writeln('Orden: $dictation');

    return buffer.toString();
  }

  static const String _reference = '<ref>';

  /// Saca el JSON de lo que contestó el modelo.
  ///
  /// Un modelo de este tamaño se salta la instrucción de no explicar nada más
  /// a menudo de lo que uno querría, así que en vez de exigir que la respuesta
  /// entera sea JSON se busca el objeto dentro. Es el mismo criterio que en
  /// CU04: lo que haya que filtrar se filtra en el código, no añadiendo reglas
  /// al prompt.
  List<Map<String, dynamic>> _parse(String answer) {
    final start = answer.indexOf('{');
    final end = answer.lastIndexOf('}');

    if (start < 0 || end <= start) return const [];

    try {
      final decoded = jsonDecode(answer.substring(start, end + 1));
      if (decoded is! Map) return const [];

      final operations = decoded['operations'];
      if (operations is! List) return const [];

      return operations
          .whereType<Map>()
          .map(Map<String, dynamic>.from)
          .toList();
    } catch (_) {
      return const [];
    }
  }

  Future<void> close() async {
    await _model?.close();
    _model = null;
  }
}

/// El avance de la descarga.
class ModelDownload {
  const ModelDownload({
    required this.received,
    required this.total,
    this.finished = false,
  });

  final int received;

  /// Cuánto ocupa en total, o -1 si el servidor no lo dijo.
  final int total;
  final bool finished;

  /// De 0 a 1, o null si no se sabe cuánto falta.
  double? get fraction => total > 0 ? received / total : null;

  int get percent => total > 0 ? (received * 100 ~/ total) : 0;

  String get readable {
    String mb(int bytes) => '${(bytes / 1048576).toStringAsFixed(0)} MB';

    return total > 0 ? '${mb(received)} de ${mb(total)}' : mb(received);
  }
}

class LocalModelUnavailable implements Exception {
  const LocalModelUnavailable(this.message);

  final String message;

  @override
  String toString() => message;
}
