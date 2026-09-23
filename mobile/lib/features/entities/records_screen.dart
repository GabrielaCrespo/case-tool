import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/meta.dart';
import '../../app_state.dart';
import '../../offline/repository.dart';
import '../../offline/sync_controller.dart';
import '../../widgets/sync_indicator.dart';
import 'field_values.dart';
import 'record_form.dart';

/// CU09 — Los registros de una entidad.
///
/// Lo que se ve sale de la base local, y se repinta cada vez que ésta cambia.
/// El servidor sólo la refresca por detrás cuando hay red. Por eso la pantalla
/// es la misma con conexión y sin ella; lo único que cambia es la línea que
/// dice de cuándo son los datos, que está ahí para no hacer creer que son de
/// ahora cuando no lo son.
///
/// Antes, al volver del formulario se pedía otra vez la lista entera al
/// servidor y hasta que no llegaba no aparecía el registro nuevo. Ahora
/// aparece en cuanto el formulario lo guarda.
class RecordsScreen extends ConsumerStatefulWidget {
  const RecordsScreen({super.key, required this.entity});

  final EntityMeta entity;

  @override
  ConsumerState<RecordsScreen> createState() => _RecordsScreenState();
}

class _RecordsScreenState extends ConsumerState<RecordsScreen> {
  StreamSubscription<List<LocalRecord>>? _watching;
  List<LocalRecord>? _records;

  /// Lo que dijo el último refresco: si llegó del servidor y de cuándo es.
  bool _fromNetwork = true;
  DateTime? _syncedAt;
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();

    final repository = ref.read(repositoryProvider);
    if (repository == null) return;

    _watching = repository.watch(widget.entity).listen((records) {
      if (mounted) setState(() => _records = records);
    });
    unawaited(_refresh());
  }

  @override
  void dispose() {
    unawaited(_watching?.cancel());
    super.dispose();
  }

  /// Pide la lista al servidor, si hay red. Lo que traiga entra en la base
  /// local, y de ahí a la pantalla.
  Future<void> _refresh() async {
    final repository = ref.read(repositoryProvider);
    if (repository == null) return;

    setState(() => _refreshing = true);
    final list = await repository.list(widget.entity);

    if (!mounted) return;
    setState(() {
      _refreshing = false;
      _fromNetwork = list.fromNetwork;
      _syncedAt = list.syncedAt;
    });
  }

  Future<void> _open(LocalRecord? record) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RecordForm(entity: widget.entity, record: record),
      ),
    );
  }

  Future<void> _delete(LocalRecord record) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Borrar el registro'),
        content: Text(
          '¿Seguro que quiere borrar «${FieldValues.label(widget.entity, record.values)}»? '
          'No se puede deshacer.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    final repository = ref.read(repositoryProvider);
    if (repository == null) return;

    await repository.delete(widget.entity, record.id);
  }

  @override
  Widget build(BuildContext context) {
    // Al terminar una sincronización, lo de esta pantalla ya es del servidor:
    // se refresca para que deje de decir que los datos son de antes.
    ref.listen<bool>(syncControllerProvider, (previous, next) {
      if (previous == true && next == false) unawaited(_refresh());
    });

    final records = _records ?? const <LocalRecord>[];

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.entity.name),
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(28),
          child: SyncIndicator(),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _open(null),
        child: const Icon(Icons.add),
      ),
      body: Column(
        children: [
          if (!_fromNetwork && !_refreshing) _StaleBanner(syncedAt: _syncedAt),
          // Lo guardado ya está en pantalla; esto sólo dice que se está
          // preguntando al servidor si hay algo más nuevo.
          if (_refreshing && _records != null)
            const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: _records == null
                ? const Center(child: CircularProgressIndicator())
                : records.isEmpty
                    ? _Empty(entity: widget.entity)
                    : RefreshIndicator(
                        onRefresh: _refresh,
                        child: ListView.separated(
                          itemCount: records.length,
                          separatorBuilder: (_, _) => const Divider(height: 1),
                          itemBuilder: (context, index) {
                            final record = records[index];

                            return ListTile(
                              title: Text(
                                FieldValues.label(widget.entity, record.values),
                              ),
                              subtitle: Text(
                                FieldValues.summary(
                                  widget.entity,
                                  record.values,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                              leading: _Mark(record: record),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () => _delete(record),
                              ),
                              onTap: () => _open(record),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }
}

/// El distintivo de la izquierda: si el registro está sólo en el teléfono, si
/// tiene cambios sin subir, o si está en conflicto.
class _Mark extends StatelessWidget {
  const _Mark({required this.record});

  final LocalRecord record;

  @override
  Widget build(BuildContext context) {
    if (record.conflicted) {
      return Icon(Icons.merge_type, color: Colors.red.shade700);
    }
    if (record.dirty) {
      return Icon(Icons.cloud_upload_outlined, color: Colors.amber.shade800);
    }
    return const Icon(Icons.circle_outlined, size: 18);
  }
}

/// Lo que se está viendo es de la última vez que hubo red. Se dice con la
/// fecha delante: un dato viejo que parece de ahora es peor que no tener dato.
class _StaleBanner extends StatelessWidget {
  const _StaleBanner({required this.syncedAt});

  final DateTime? syncedAt;

  @override
  Widget build(BuildContext context) {
    final at = syncedAt;

    return Container(
      width: double.infinity,
      color: Colors.orange.shade50,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Icon(Icons.history, size: 16, color: Colors.orange.shade900),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              at == null
                  ? 'Sin conexión: todavía no se ha traído nada de este backend.'
                  : 'Sin conexión: datos del ${_when(at)}.',
              style: TextStyle(fontSize: 12, color: Colors.orange.shade900),
            ),
          ),
        ],
      ),
    );
  }

  static String _when(DateTime at) {
    String two(int value) => value.toString().padLeft(2, '0');

    return '${two(at.day)}/${two(at.month)} a las ${two(at.hour)}:${two(at.minute)}';
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.entity});

  final EntityMeta entity;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          'No hay ningún ${entity.name} todavía. Use el botón de abajo para dar '
          'uno de alta.',
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
