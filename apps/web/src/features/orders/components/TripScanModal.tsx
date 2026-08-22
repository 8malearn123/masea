import { Modal } from '@/shared/ui';
import { BarcodeScanner } from '@/features/gps/components/BarcodeScanner';
import { useLogTripScan } from '@/features/gps/hooks/useGps';
import { useAdvanceTrip } from '@/features/orders/hooks/useOrders';
import { nextStep } from '@/features/orders/lib/trip';
import type { Order } from '@/features/orders/types';
import type { Resident } from '@/features/housing/types';

function getPosition(): Promise<{ lat: number | null; lng: number | null }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 4000 },
    );
  });
}

/** Scan the worker's barcode to advance the trip to its next leg. */
export function TripScanModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const log = useLogTripScan();
  const advance = useAdvanceTrip();
  const step = order ? nextStep(order.trip_stage) : null;

  async function handleResolved(worker: Resident) {
    if (!order || !step) return;
    const pos = await getPosition();
    await log.mutateAsync({
      barcode: worker.barcode,
      scanType: step.scan,
      lat: pos.lat,
      lng: pos.lng,
    });
    await advance.mutateAsync({ orderId: order.id, scanType: step.scan, doneLabel: step.done });
    onClose();
  }

  return (
    <Modal open={order !== null && step !== null} onClose={onClose} title={step?.action ?? 'مسح'}>
      {order && step && (
        <div>
          <p className="mb-3 text-sm text-purple">
            الطلب <span className="num font-semibold text-navy">{order.request_no}</span> —{' '}
            {order.customer_name ?? '—'}. امسح باركود العاملة لتأكيد: {step.short}.
          </p>
          <BarcodeScanner onResolved={(w) => void handleResolved(w)} />
        </div>
      )}
    </Modal>
  );
}
