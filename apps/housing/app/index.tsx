import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { housingStatusOptions } from '../lib/options';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

interface WorkerRow {
  id: string;
  full_name: string;
  status?: string;
}

export default function Home() {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('workers').select('id, full_name').limit(100);
      setWorkers((data as WorkerRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  async function mark(workerId: string, status: string) {
    await supabase.from('housing_attendance').upsert(
      { worker_id: workerId, date: new Date().toISOString().slice(0, 10), status },
      { onConflict: 'worker_id,date' },
    );
    setWorkers((prev) => prev.map((w) => (w.id === workerId ? { ...w, status } : w)));
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>تسجيل حضور اليوم</Text>
      <FlatList
        data={workers}
        keyExtractor={(w) => w.id}
        refreshing={loading}
        onRefresh={() => {}}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.name}>{item.full_name}</Text>
            <View style={styles.actions}>
              {housingStatusOptions.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => mark(item.id, o.value)}
                  style={[styles.chip, item.status === o.value && styles.chipActive]}
                >
                  <Text style={[styles.chipText, item.status === o.value && styles.chipTextActive]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 16 },
  title: { fontSize: 18, fontWeight: '800', color: theme.navy, textAlign: 'right', marginBottom: 12 },
  row: { backgroundColor: theme.white, borderRadius: 14, padding: 14, marginBottom: 10 },
  name: { fontSize: 16, fontWeight: '700', color: theme.navy, textAlign: 'right' },
  actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: theme.bg },
  chipActive: { backgroundColor: theme.navy },
  chipText: { color: theme.purple, fontSize: 13 },
  chipTextActive: { color: '#fff' },
});
