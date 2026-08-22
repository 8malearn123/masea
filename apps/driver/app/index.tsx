import { Link } from 'expo-router';
import { Text, View, StyleSheet, Pressable } from 'react-native';
import { BRAND } from '@masiat/shared';
import { theme } from '../lib/theme';

const SCAN_STEPS = [
  { type: 'warehouse_out', label: 'خروج من المستودع' },
  { type: 'customer_arrived', label: 'الوصول للعميل' },
  { type: 'service_end', label: 'انتهاء الخدمة' },
  { type: 'warehouse_in', label: 'العودة للمستودع' },
];

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{BRAND.client.nameAr}</Text>
      <Text style={styles.subtitle}>رحلات اليوم · مسح حالة العامل</Text>

      <View style={styles.grid}>
        {SCAN_STEPS.map((s) => (
          <Link key={s.type} href={{ pathname: '/scan', params: { type: s.type } }} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.cardText}>{s.label}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: 20 },
  title: { fontSize: 22, fontWeight: '800', color: theme.navy, textAlign: 'right' },
  subtitle: { fontSize: 14, color: theme.purple, marginTop: 4, textAlign: 'right' },
  grid: { marginTop: 24, gap: 14 },
  card: {
    backgroundColor: theme.white,
    borderRadius: 18,
    padding: 22,
    borderRightWidth: 5,
    borderRightColor: theme.gold,
  },
  cardText: { fontSize: 17, fontWeight: '700', color: theme.navy, textAlign: 'right' },
});
