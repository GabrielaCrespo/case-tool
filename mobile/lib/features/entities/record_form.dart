import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/client.dart';
import '../../api/meta.dart';
import '../../app_state.dart';
import '../../offline/repository.dart';
import 'field_values.dart';

/// CU09 — El formulario de un registro, armado desde `/api/_meta`.
///
/// No hay una sola línea aquí que sepa de clientes ni de facturas: cada
/// casilla sale de un campo del modelo, con el control que le toca por su tipo
/// y las restricciones que el diagrama le puso. La clave primaria no se pide
/// nunca, porque la pone el backend.
///
/// Cuando el backend rechaza el cuerpo, su 400 trae un mensaje por campo con
/// el nombre tal como viaja en el JSON; eso es lo que permite pintar el error
/// justo debajo de la casilla que falla en lugar de un aviso suelto.
class RecordForm extends ConsumerStatefulWidget {
  const RecordForm({super.key, required this.entity, this.record});

  final EntityMeta entity;

  /// El registro que se edita, o null para dar uno de alta.
  final LocalRecord? record;

  @override
  ConsumerState<RecordForm> createState() => _RecordFormState();
}

class _RecordFormState extends ConsumerState<RecordForm> {
  final _formKey = GlobalKey<FormState>();
  final _controllers = <String, TextEditingController>{};
  final _booleans = <String, bool>{};
  final _references = <String, String?>{};

  /// Los catálogos de las entidades relacionadas, para los desplegables.
  final _catalogs = <String, List<LocalRecord>>{};

  /// Lo que dijo el backend que estaba mal, por campo.
  Map<String, String> _serverErrors = {};

  bool _saving = false;
  String? _generalError;

  bool get _isNew => widget.record == null;

  @override
  void initState() {
    super.initState();

    final values = widget.record?.values ?? const <String, dynamic>{};

    for (final field in widget.entity.fields) {
      if (field.kind == FieldKind.boolean) {
        _booleans[field.name] =
            values[field.name] as bool? ?? field.defaultValue == 'true';
        continue;
      }
      _controllers[field.name] = TextEditingController(
        text: values.containsKey(field.name)
            ? FieldValues.display(values[field.name])
            : (_isNew ? field.defaultValue ?? '' : ''),
      );
    }

    for (final relation in widget.entity.editableRelations) {
      _references[relation.field] = FieldValues.referenceId(
        ref.read(connectionProvider).meta!,
        relation,
        values,
      );
    }
    unawaited(_loadCatalogs());
  }

  /// Los registros de las entidades con las que ésta se relaciona.
  ///
  /// Primero lo guardado, que está al instante y es lo único que hay sin red;
  /// después, si hay red, lo del servidor. Antes se esperaba al servidor una
  /// relación detrás de otra, y el formulario se quedaba en «Buscando…» todo
  /// ese tiempo.
  Future<void> _loadCatalogs() async {
    final repository = ref.read(repositoryProvider);
    final meta = ref.read(connectionProvider).meta;
    if (repository == null || meta == null) return;

    // Por el nombre con que la relación nombra a la otra entidad, que es con
    // el que se buscan después al pintar el desplegable.
    final targets = <String, EntityMeta>{
      for (final relation in widget.entity.editableRelations)
        relation.target: ?meta.byName(relation.target),
    };

    for (final MapEntry(key: name, value: target) in targets.entries) {
      final cached = await repository.cached(target);
      if (!mounted) return;
      setState(() => _catalogs[name] = cached);
    }

    await Future.wait([
      for (final MapEntry(key: name, value: target) in targets.entries)
        repository.list(target).then((list) {
          if (mounted) setState(() => _catalogs[name] = list.records);
        }),
    ]);
  }

  @override
  void dispose() {
    for (final controller in _controllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving) return;
    setState(() {
      _serverErrors = {};
      _generalError = null;
    });

    if (!_formKey.currentState!.validate()) return;

    final repository = ref.read(repositoryProvider);
    final meta = ref.read(connectionProvider).meta;
    if (repository == null || meta == null) return;

    setState(() => _saving = true);
    try {
      final values = _collect(meta);

      if (_isNew) {
        await repository.create(widget.entity, values);
      } else {
        await repository.update(widget.entity, widget.record!.id, values);
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ValidationFailure catch (failure) {
      setState(() => _serverErrors = failure.errors);
      _formKey.currentState!.validate();
    } on ConflictFailure catch (failure) {
      setState(
        () => _generalError =
            '${failure.message} Quedó marcado como conflicto: elija en la '
            'pantalla de conflictos con cuál versión se queda.',
      );
    } on BackendFailure catch (failure) {
      setState(() => _generalError = failure.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Lo que se manda: los campos escritos y las relaciones elegidas.
  ///
  /// La versión del registro viaja también cuando se está editando, y es lo
  /// que permite al backend darse cuenta de que alguien lo cambió mientras
  /// tanto.
  Map<String, dynamic> _collect(ModelMeta meta) {
    final values = <String, dynamic>{};

    for (final field in widget.entity.fields) {
      if (field.kind == FieldKind.boolean) {
        values[field.name] = _booleans[field.name];
        continue;
      }
      values[field.name] =
          FieldValues.parse(field, _controllers[field.name]!.text);
    }

    for (final relation in widget.entity.editableRelations) {
      final target = meta.byName(relation.target);
      if (target == null) continue;

      values[relation.field] =
          FieldValues.reference(target, _references[relation.field]);
    }

    if (!_isNew) {
      final record = widget.record!;
      values[widget.entity.versionField.name] =
          record.values[widget.entity.versionField.name];
    }
    return values;
  }

  @override
  Widget build(BuildContext context) {
    final meta = ref.watch(connectionProvider).meta;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _isNew ? 'Nuevo ${widget.entity.name}' : 'Editar ${widget.entity.name}',
        ),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_generalError != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(_generalError!),
              ),
              const SizedBox(height: 16),
            ],

            for (final field in widget.entity.fields) ...[
              _field(field),
              const SizedBox(height: 16),
            ],

            if (meta != null)
              for (final relation in widget.entity.editableRelations) ...[
                _relation(meta, relation),
                const SizedBox(height: 16),
              ],

            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined),
              label: Text(_saving ? 'Guardando…' : 'Guardar'),
            ),
          ],
        ),
      ),
    );
  }

  /// El control de un campo, elegido por su tipo.
  Widget _field(FieldMeta field) {
    if (field.kind == FieldKind.boolean) {
      return SwitchListTile(
        title: Text(field.name),
        subtitle: _serverErrors[field.name] == null
            ? null
            : Text(
                _serverErrors[field.name]!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
        value: _booleans[field.name] ?? false,
        onChanged: (value) => setState(() => _booleans[field.name] = value),
      );
    }

    final controller = _controllers[field.name]!;
    final isDate =
        field.kind == FieldKind.date || field.kind == FieldKind.dateTime;

    return TextFormField(
      controller: controller,
      readOnly: isDate,
      keyboardType: switch (field.kind) {
        FieldKind.integer => TextInputType.number,
        FieldKind.decimal =>
          const TextInputType.numberWithOptions(decimal: true),
        _ => TextInputType.text,
      },
      inputFormatters: [
        if (field.kind == FieldKind.integer)
          FilteringTextInputFormatter.allow(RegExp(r'[0-9-]')),
        if (field.kind == FieldKind.decimal)
          FilteringTextInputFormatter.allow(RegExp(r'[0-9.,-]')),
        // El diagrama dijo cuántos caracteres caben; se impide pasarse en vez
        // de dejar escribir y rechazarlo después.
        if (field.maxLength != null)
          LengthLimitingTextInputFormatter(field.maxLength),
      ],
      decoration: InputDecoration(
        labelText: field.required ? '${field.name} *' : field.name,
        border: const OutlineInputBorder(),
        helperText: _helper(field),
        errorText: _serverErrors[field.name],
        suffixIcon: isDate
            ? IconButton(
                icon: const Icon(Icons.calendar_today, size: 18),
                onPressed: () => _pickDate(field, controller),
              )
            : null,
      ),
      onTap: isDate ? () => _pickDate(field, controller) : null,
      validator: (value) {
        if (field.required && (value == null || value.trim().isEmpty)) {
          return 'Hace falta un valor.';
        }
        return _serverErrors[field.name];
      },
    );
  }

  String? _helper(FieldMeta field) {
    final parts = <String>[field.type];

    if (field.unique) parts.add('no se puede repetir');
    if (field.maxLength != null) parts.add('máx. ${field.maxLength}');

    return parts.join(' · ');
  }

  Future<void> _pickDate(
    FieldMeta field,
    TextEditingController controller,
  ) async {
    final now = DateTime.now();
    final current = DateTime.tryParse(controller.text) ?? now;

    final date = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(now.year - 100),
      lastDate: DateTime(now.year + 100),
    );
    if (date == null || !mounted) return;

    if (field.kind == FieldKind.date) {
      controller.text = date.toIso8601String().substring(0, 10);
      return;
    }

    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(current),
    );
    final chosen = DateTime(
      date.year,
      date.month,
      date.day,
      time?.hour ?? 0,
      time?.minute ?? 0,
    );
    // Sin zona ni milisegundos: es lo que LocalDateTime sabe leer.
    controller.text = chosen.toIso8601String().substring(0, 19);
  }

  /// Un desplegable con los registros de la otra entidad.
  Widget _relation(ModelMeta meta, RelationMeta relation) {
    final target = meta.byName(relation.target);
    if (target == null) return const SizedBox.shrink();

    final catalog = _catalogs[relation.target];
    final error = _serverErrors[relation.field];
    final chosen = _references[relation.field];

    if (catalog == null) {
      return InputDecorator(
        decoration: InputDecoration(
          labelText: relation.field,
          border: const OutlineInputBorder(),
          helperText: 'Buscando ${relation.target}…',
        ),
        child: const LinearProgressIndicator(),
      );
    }

    return DropdownButtonFormField<String?>(
      initialValue: _references[relation.field],
      isExpanded: true,
      decoration: InputDecoration(
        labelText: relation.field,
        border: const OutlineInputBorder(),
        helperText: '${relation.target} · ${relation.kind.toLowerCase()}',
        errorText: error,
      ),
      items: [
        const DropdownMenuItem<String?>(
          value: null,
          child: Text('— sin asignar —'),
        ),
        for (final record in catalog)
          DropdownMenuItem<String?>(
            value: record.id,
            child: Text(
              FieldValues.label(target, record.values) +
                  (record.isLocalOnly ? ' (sin subir)' : ''),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        // Lo elegido tiene que estar entre las opciones aunque todavía no se
        // haya traído: el desplegable no admite un valor que no ofrece.
        if (chosen != null && !catalog.any((record) => record.id == chosen))
          DropdownMenuItem<String?>(
            value: chosen,
            child: Text('${relation.target} $chosen'),
          ),
      ],
      onChanged: (value) => setState(() => _references[relation.field] = value),
    );
  }
}
