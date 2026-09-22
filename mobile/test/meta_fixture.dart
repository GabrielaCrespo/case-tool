import 'package:mobile/api/meta.dart';

/// El `/api/_meta` de un backend generado del diagrama de ventas.
///
/// Es una copia de lo que devuelve de verdad un backend publicado, con los
/// nombres en mayúsculas que salen de un diagrama escrito así. Sirve para
/// probar la interpretación de órdenes y la comprobación contra el modelo sin
/// levantar nada.
ModelMeta ventasMeta() => ModelMeta.fromJson({
      'diagram': 'Sistema de ventas',
      'generated_at': '2026-09-22T00:00:00Z',
      'entities': [
        {
          'name': 'PERSONA',
          'table': 'persona',
          'path': '/api/personas',
          'abstract': true,
          'extends': null,
          'id': {'name': 'id', 'type': 'Long'},
          'version': {'name': 'version', 'type': 'Long'},
          'fields': [
            {
              'name': 'nombre',
              'type': 'String',
              'required': true,
              'unique': false,
              'maxLength': 255,
              'default': null,
            },
          ],
          'relations': [],
        },
        {
          'name': 'CLIENTE',
          'table': 'cliente',
          'path': '/api/clientes',
          'abstract': false,
          'extends': 'PERSONA',
          'id': {'name': 'id', 'type': 'Long'},
          'version': {'name': 'version', 'type': 'Long'},
          'fields': [
            {
              'name': 'nombre',
              'type': 'String',
              'required': true,
              'unique': false,
              'maxLength': 255,
              'default': null,
            },
            {
              'name': 'telefono',
              'type': 'String',
              'required': false,
              'unique': false,
              'maxLength': 255,
              'default': null,
            },
          ],
          'relations': [
            {
              'field': 'notaventas',
              'kind': 'ONE_TO_MANY',
              'target': 'NOTAVENTA',
              'owner': false,
              'joinColumn': null,
            },
          ],
        },
        {
          'name': 'NOTAVENTA',
          'table': 'notaventa',
          'path': '/api/notaventas',
          'abstract': false,
          'extends': null,
          'id': {'name': 'id', 'type': 'Long'},
          'version': {'name': 'version', 'type': 'Long'},
          'fields': [
            {
              'name': 'monto',
              'type': 'BigDecimal',
              'required': true,
              'unique': false,
              'maxLength': null,
              'default': null,
            },
            {
              'name': 'anulada',
              'type': 'Boolean',
              'required': false,
              'unique': false,
              'maxLength': null,
              'default': 'false',
            },
          ],
          'relations': [
            {
              'field': 'cliente',
              'kind': 'MANY_TO_ONE',
              'target': 'CLIENTE',
              'owner': true,
              'joinColumn': 'cliente_id',
            },
          ],
        },
      ],
    });
