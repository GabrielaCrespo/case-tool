import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_state.dart';
import '../../offline/repository.dart';
import '../entities/field_values.dart';

/// CU10 — Los registros que cambiaron en el servidor mientras se editaban
/// aquí, esperando a que alguien decida con cuál se queda.
///
/// **No se mezcla nada.** Se enseñan las dos versiones campo por campo, con
/// las diferencias marcadas, y se elige una entera. Mezclar automáticamente
/// daría un registro que nadie escribió y que nadie podría explicar.
class ConflictsScreen extends ConsumerStatefulWidget {
  const ConflictsScreen({super.key});

  @override
  ConsumerState<ConflictsScreen> createState() => _ConflictsScreenState();
}

class _ConflictsScreenState extends ConsumerState<ConflictsScreen> {
  List<ConflictedRecord> _conflicts = [];
  bool _loading = true;
  String? _working;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final repository = ref.read(repositoryProvider);
    if (repository == null) return;

    final conflicts = await repository.conflicts();
    if (!mounted) return;

    setState(() {
      _conflicts = conflicts;
      _loading = false;
    });
  }

  Future<void> _resolve(ConflictedRecord conflict, {required bool mine}) async {
    final repository = ref.read(repositoryProvider);
    if (repository == null) return;

    setState(() => _working = conflict.id);
    try {
      if (mine) {
        await repository.keepMine(conflict.entity, conflict.id);
      } else {
        await repository.keepTheirs(conflict.entity, conflict.id);
      }
      await repository.discardFailed();
      await _load();
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('No se pudo resolver: $error')),
      );
    } finally {
      if (mounted) setState(() => _working = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Conflictos')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _conflicts.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Text(
                      'No hay ningún conflicto: todo lo que se escribió aquí '
                      'está guardado tal cual en el servidor.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: _conflicts.length,
                  itemBuilder: (context, index) => _ConflictCard(
                    conflict: _conflicts[index],
                    busy: _working == _conflicts[index].id,
                    onKeepMine: () =>
                        _resolve(_conflicts[index], mine: true),
                    onKeepTheirs: () =>
                        _resolve(_conflicts[index], mine: false),
                  ),
                ),
    );
  }
}

class _ConflictCard extends StatelessWidget {
  const _ConflictCard({
    required this.conflict,
    required this.busy,
    required this.onKeepMine,
    required this.onKeepTheirs,
  });

  final ConflictedRecord conflict;
  final bool busy;
  final VoidCallback onKeepMine;
  final VoidCallback onKeepTheirs;

  @override
  Widget build(BuildContext context) {
    final entity = conflict.entity;
    final theirs = conflict.theirs;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${entity.name} · ${FieldValues.label(entity, conflict.mine)}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              theirs == null
                  ? 'No se pudo leer la versión del servidor; hace falta red '
                      'para compararlas.'
                  : 'Cambió en el servidor mientras se editaba aquí. Elija con '
                      'cuál se queda: no se mezcla nada.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),

            // Campo por campo, y sólo los que difieren: enseñar los treinta
            // campos iguales escondería los dos que importan.
            for (final field in entity.fields)
              if (theirs == null ||
                  '${conflict.mine[field.name]}' != '${theirs[field.name]}')
                _Difference(
                  name: field.name,
                  mine: FieldValues.display(conflict.mine[field.name]),
                  theirs: theirs == null
                      ? '—'
                      : FieldValues.display(theirs[field.name]),
                ),

            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: busy ? null : onKeepTheirs,
                    child: const Text('Quedarme con la del servidor'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: busy ? null : onKeepMine,
                    child: const Text('Quedarme con la mía'),
                  ),
                ),
              ],
            ),
            if (busy) ...[
              const SizedBox(height: 8),
              const LinearProgressIndicator(),
            ],
          ],
        ),
      ),
    );
  }
}

class _Difference extends StatelessWidget {
  const _Difference({
    required this.name,
    required this.mine,
    required this.theirs,
  });

  final String name;
  final String mine;
  final String theirs;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            name,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: _Side(
                  label: 'Aquí',
                  value: mine,
                  color: Colors.blue.shade50,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Side(
                  label: 'Servidor',
                  value: theirs,
                  color: Colors.orange.shade50,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Side extends StatelessWidget {
  const _Side({required this.label, required this.value, required this.color});

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 10)),
          Text(
            value.isEmpty ? '—' : value,
            style: const TextStyle(fontSize: 13),
          ),
        ],
      ),
    );
  }
}
