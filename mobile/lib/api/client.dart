import 'package:dio/dio.dart';

import 'meta.dart';

/// El cliente del backend generado.
///
/// Habla con un backend publicado por la herramienta, sea cual sea su
/// diagrama: todo lo que necesita saber se lo dice `/api/_meta`. Las rutas de
/// las entidades salen de ahí, no están escritas aquí.
class BackendClient {
  BackendClient(this.baseUrl)
      : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 10),
            receiveTimeout: const Duration(seconds: 20),
            // Los errores se interpretan aquí abajo, no los lanza Dio: un 400
            // con los campos que fallan es una respuesta útil, no una avería.
            validateStatus: (_) => true,
            headers: {'Content-Type': 'application/json'},
          ),
        );

  /// La dirección del backend, tal como la dio el editor: incluye el prefijo
  /// bajo el que vive (`https://dominio/d/sistema-de-ventas`).
  final String baseUrl;
  final Dio _dio;

  /// La descripción del modelo, tal cual llega.
  ///
  /// Se devuelve el JSON sin interpretar, y no el modelo ya construido, porque
  /// hay que guardarlo entero: es lo que permite abrir la aplicación sin red y
  /// seguir sabiendo qué pantallas tiene este backend.
  Future<Map<String, dynamic>> metaJson() async {
    final response = await _dio.get<dynamic>('/api/_meta');

    _assertOk(response);
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// El modelo ya construido. Es lo primero que se pide al conectar.
  Future<ModelMeta> meta() async => ModelMeta.fromJson(await metaJson());

  /// Los registros de una entidad.
  Future<List<Map<String, dynamic>>> list(EntityMeta entity) async {
    final response = await _dio.get<dynamic>(entity.path);

    _assertOk(response);
    return (response.data as List<dynamic>)
        .map((item) => Map<String, dynamic>.from(item as Map))
        .toList();
  }

  Future<Map<String, dynamic>> create(
    EntityMeta entity,
    Map<String, dynamic> values,
  ) async {
    final response = await _dio.post<dynamic>(entity.path, data: values);

    _assertOk(response);
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Guarda los cambios de un registro.
  ///
  /// El cuerpo lleva la versión que se leyó. Si alguien lo cambió entretanto,
  /// el backend contesta 409 y aquí sale un [ConflictFailure]: es la señal con
  /// la que CU10 detecta un conflicto al sincronizar.
  Future<Map<String, dynamic>> update(
    EntityMeta entity,
    Object id,
    Map<String, dynamic> values,
  ) async {
    final response = await _dio.put<dynamic>('${entity.path}/$id', data: values);

    _assertOk(response);
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<void> delete(EntityMeta entity, Object id) async {
    final response = await _dio.delete<dynamic>('${entity.path}/$id');

    _assertOk(response);
  }

  /// Lee un registro, para saber con qué versión está el servidor cuando hay
  /// que resolver un conflicto.
  Future<Map<String, dynamic>?> findById(EntityMeta entity, Object id) async {
    final response = await _dio.get<dynamic>('${entity.path}/$id');

    if (response.statusCode == 404) return null;
    _assertOk(response);
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Traduce la respuesta a un fallo con nombre, o no hace nada si salió bien.
  void _assertOk(Response<dynamic> response) {
    final status = response.statusCode ?? 0;
    if (status >= 200 && status < 300) return;

    final body = response.data;
    final map = body is Map ? Map<String, dynamic>.from(body) : null;

    if (status == 400 && map?['errors'] is Map) {
      // El formato que escribe ApiErrors en el backend generado: un mensaje
      // por campo, con el nombre tal como viaja en el JSON.
      throw ValidationFailure(
        Map<String, String>.from(
          (map!['errors'] as Map).map(
            (key, value) => MapEntry(key.toString(), value.toString()),
          ),
        ),
      );
    }
    if (status == 409) {
      throw ConflictFailure(map?['message']?.toString() ??
          'El registro cambió mientras lo editaba.');
    }
    if (status == 404) {
      throw const NotFoundFailure();
    }
    throw BackendFailure(
      'El servidor respondió $status.',
      statusCode: status,
    );
  }
}

/// Algo salió mal al hablar con el backend.
class BackendFailure implements Exception {
  const BackendFailure(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Un 400 con los campos que no pasaron la comprobación. Cada clave es el
/// nombre del campo, tal como lo publica `_meta`, así que el formulario puede
/// pintar el mensaje justo debajo de la casilla que falla.
class ValidationFailure implements Exception {
  const ValidationFailure(this.errors);

  final Map<String, String> errors;

  @override
  String toString() => errors.values.join(' ');
}

/// Un 409: el registro cambió entre que se leyó y se intentó guardar.
class ConflictFailure implements Exception {
  const ConflictFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

class NotFoundFailure implements Exception {
  const NotFoundFailure();

  @override
  String toString() => 'Ese registro ya no existe.';
}
