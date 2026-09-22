import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app_state.dart';
import '../../widgets/sync_indicator.dart';
import '../conflicts/conflicts_screen.dart';
import '../voice/voice_screen.dart';
import 'records_screen.dart';

/// CU09 — Las entidades que tiene este backend.
///
/// Sale entera de `/api/_meta`. Las clases abstractas no aparecen: tienen
/// tabla, pero no controlador, así que no hay ninguna lista que abrir.
class EntitiesScreen extends ConsumerWidget {
  const EntitiesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);
    final meta = connection.meta;

    if (meta == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final entities = meta.usable;
    final conflicts = ref.watch(conflictCountProvider).value ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: Text(meta.diagram),
        actions: [
          if (conflicts > 0)
            IconButton(
              tooltip: 'Registros en conflicto',
              icon: Badge.count(
                count: conflicts,
                child: const Icon(Icons.merge_type),
              ),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ConflictsScreen()),
              ),
            ),
          IconButton(
            tooltip: 'Desconectar de este backend',
            icon: const Icon(Icons.logout),
            onPressed: () =>
                ref.read(connectionProvider.notifier).disconnect(),
          ),
        ],
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(28),
          child: SyncIndicator(),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const VoiceScreen()),
        ),
        icon: const Icon(Icons.mic),
        label: const Text('Dictar'),
      ),
      body: entities.isEmpty
          ? const _Empty()
          : ListView.separated(
              itemCount: entities.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final entity = entities[index];

                return ListTile(
                  leading: const Icon(Icons.table_rows_outlined),
                  title: Text(entity.name),
                  subtitle: Text(
                    '${entity.fields.length} campos'
                    '${entity.editableRelations.isEmpty ? '' : ' · ${entity.editableRelations.length} relaciones'}'
                    '${entity.parent == null ? '' : ' · hereda de ${entity.parent}'}',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => RecordsScreen(entity: entity),
                    ),
                  ),
                );
              },
            ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: Text(
          'Este backend no tiene ninguna entidad que se pueda abrir. Puede que '
          'el diagrama sólo tenga clases abstractas.',
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
