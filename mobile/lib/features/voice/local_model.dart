import 'dart:async';
import 'dart:convert';

import 'package:flutter_gemma/core/model.dart';
import 'package:flutter_gemma/flutter_gemma.dart';

import '../../api/meta.dart';

/// CU09 — El intérprete de lenguaje natural que corre en el teléfono.
///
/// Es la otra mitad de la separación que exige el enunciado: la IA del
/// servidor está en la nube (Groq) porque allí hay red y hay cuota, y ésta
/// tiene que estar aquí porque tiene que funcionar en modo avión.
///
/// El modelo **no viaja dentro del APK**. Un Gemma de mil millones de
/// parámetros son cientos de megas, y meterlos en el instalador haría inútil
/// la aplicación para quien sólo quiere dar de alta un cliente. Se descarga la
/// primera vez que alguien usa el asistente, con su barra de progreso, y a
/// partir de ahí ya está.
///
/// Lo que se le pide es un JSON de operaciones de un conjunto cerrado. Lo que
/// devuelva es una propuesta: quien decide si vale es
/// [OperationValidator], comprobándolo contra `_meta`.
class LocalModel {
  LocalModel();

  /// De dónde se baja. Es la variante instruida de Gemma 3 de 1B en el formato
  /// que espera MediaPipe, publicada por Google en LiteRT.
  static const String modelUrl =
      'https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/gemma3-1b-it-int4.task';

  InferenceModel? _model;

  /// Si el modelo ya está descargado en este teléfono.
  Future<bool> get isInstalled =>
      FlutterGemmaPlugin.instance.modelManager.isModelInstalled;

  /// Lo descarga, informando del porcentaje para poder enseñarlo.
  Stream<int> download() => FlutterGemmaPlugin.instance.modelManager
      .downloadModelFromNetworkWithProgress(modelUrl);

  Future<void> _ensureLoaded() async {
    if (_model != null) return;

    if (!await isInstalled) {
      throw const LocalModelUnavailable(
        'El modelo todavía no está descargado en este teléfono.',
      );
    }
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

class LocalModelUnavailable implements Exception {
  const LocalModelUnavailable(this.message);

  final String message;

  @override
  String toString() => message;
}
