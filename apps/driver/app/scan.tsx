import { useEffect, useState } from 'react';
import { Text, View, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BarCodeScanner } from 'expo-barcode-scanner';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { theme } from '../lib/theme';

export default function Scan() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const router = useRouter();
  const [permission, setPermission] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      setPermission(status === 'granted');
    })();
  }, []);

  async function onScanned({ data }: { data: string }) {
    if (busy) return;
    setBusy(true);
    try {
      const { data: worker } = await supabase
        .from('workers')
        .select('id')
        .eq('barcode', data)
        .single();

      if (!worker) {
        Alert.alert('غير موجود', `لم يتم العثور على عامل بالباركود ${data}`);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({});
      await supabase.from('scans_log').insert({
        worker_id: worker.id,
        scan_type: type,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });

      Alert.alert('تم', 'تم تسجيل المسح بنجاح', [
        { text: 'حسناً', onPress: () => router.back() },
      ]);
    } finally {
      setBusy(false);
    }
  }

  if (permission === null) return <Centered text="جارٍ طلب الإذن…" />;
  if (!permission) return <Centered text="لا يوجد إذن للكاميرا" />;

  return (
    <View style={styles.container}>
      <BarCodeScanner onBarCodeScanned={busy ? undefined : onScanned} style={StyleSheet.absoluteFill} />
      <View style={styles.overlay}>
        <Text style={styles.hint}>وجّه الكاميرا نحو باركود العامل</Text>
      </View>
    </View>
  );
}

function Centered({ text }: { text: string }) {
  return (
    <View style={styles.centered}>
      <Text style={{ color: theme.navy }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  overlay: { position: 'absolute', bottom: 60, left: 0, right: 0, alignItems: 'center' },
  hint: { color: '#fff', backgroundColor: theme.navy, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
});
