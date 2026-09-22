import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/api/meta.dart';

import 'meta_fixture.dart';

/// Que la aplicación lee bien el contrato de `/api/_meta`.
///
/// Es el contrato del que depende todo lo demás: si esto se interpreta mal, las
/// pantallas se arman mal y no hay manera de darse cuenta hasta tener un
/// teléfono delante.
void main() {
  final meta = ventasMeta();

  test('lee el diagrama y sus entidades', () {
    expect(meta.diagram, 'Sistema de ventas');
    expect(meta.entities, hasLength(3));
  });

  test('deja fuera las clases abstractas, que no tienen API que abrir', () {
    expect(meta.usable.map((entity) => entity.name), ['CLIENTE', 'NOTAVENTA']);
  });

  test('encuentra una entidad sin distinguir mayúsculas', () {
    expect(meta.byName('cliente')?.name, 'CLIENTE');
    expect(meta.byName('CLIENTE')?.name, 'CLIENTE');
    expect(meta.byName('inexistente'), isNull);
  });

  test('el tipo de cada campo decide con qué control se pide', () {
    final notaventa = meta.byName('NOTAVENTA')!;

    expect(
      notaventa.fields.firstWhere((field) => field.name == 'monto').kind,
      FieldKind.decimal,
    );
    expect(
      notaventa.fields.firstWhere((field) => field.name == 'anulada').kind,
      FieldKind.boolean,
    );
  });

  test('sólo se puede elegir la relación de la que este lado es dueño', () {
    // NOTAVENTA lleva la clave foránea del cliente: se elige al dar de alta.
    expect(
      meta.byName('NOTAVENTA')!.editableRelations.map((r) => r.field),
      ['cliente'],
    );
    // CLIENTE tiene la colección inversa, que no se toca desde aquí: sus notas
    // se crean dando de alta la nota y diciendo de quién es.
    expect(meta.byName('CLIENTE')!.editableRelations, isEmpty);
  });

  test('conserva las restricciones que puso el diagrama', () {
    final nombre = meta
        .byName('CLIENTE')!
        .fields
        .firstWhere((field) => field.name == 'nombre');

    expect(nombre.required, isTrue);
    expect(nombre.maxLength, 255);
  });

  test('la clave primaria y la versión son campos de sistema', () {
    final cliente = meta.byName('CLIENTE')!;

    expect(cliente.idField.name, 'id');
    expect(cliente.versionField.name, 'version');
    // Y no están entre los campos que se piden en el formulario.
    expect(
      cliente.fields.map((field) => field.name),
      isNot(contains('id')),
    );
  });
}
