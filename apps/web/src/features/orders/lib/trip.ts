import type { OrderStatus, TripStage } from '@/features/orders/types';

/**
 * A delivery trip is two legs, each advanced by scanning the worker's barcode:
 *   الرحلة الأولى (ذهاب): السكن → العميل
 *   الرحلة الثانية (إياب): العميل → السكن
 */
export interface TripStep {
  stage: TripStage; // the stage reached AFTER this scan
  scan: string; // scan_type logged
  short: string; // concise label for the stepper
  action: string; // button label before scanning
  done: string; // status shown after scanning
  leg: 1 | 2;
}

export const TRIP_STEPS: TripStep[] = [
  {
    stage: 'picked_up',
    scan: 'warehouse_out',
    short: 'استلام من السكن',
    action: 'مسح: استلام العاملة',
    done: 'العاملة ركبت من السكن',
    leg: 1,
  },
  {
    stage: 'delivered',
    scan: 'customer_arrived',
    short: 'تسليم للعميل',
    action: 'مسح: التسليم للعميل',
    done: 'سُلّمت للعميل',
    leg: 1,
  },
  {
    stage: 'return_picked',
    scan: 'service_end',
    short: 'استلام من العميل',
    action: 'مسح: الاستلام من العميل',
    done: 'ركبت عائدة للسكن',
    leg: 2,
  },
  {
    stage: 'returned',
    scan: 'warehouse_in',
    short: 'إرجاع للسكن',
    action: 'مسح: الإرجاع للسكن',
    done: 'رجعت للسكن',
    leg: 2,
  },
];

export const TRIP_LEGS: { leg: 1 | 2; label: string }[] = [
  { leg: 1, label: 'الرحلة الأولى: السكن ← العميل' },
  { leg: 2, label: 'الرحلة الثانية: العميل ← السكن' },
];

/** Index of the current stage in the step sequence (-1 = nothing scanned yet). */
export function stageIndex(stage: TripStage): number {
  if (stage === 'none') return -1;
  return TRIP_STEPS.findIndex((s) => s.stage === stage);
}

/** The next step to scan, or null when the trip is complete. */
export function nextStep(stage: TripStage): TripStep | null {
  return TRIP_STEPS[stageIndex(stage) + 1] ?? null;
}

/** Order status + trip stage produced by a scan event. */
export function tripScanResult(scan: string): { stage: TripStage; status: OrderStatus } | null {
  const step = TRIP_STEPS.find((s) => s.scan === scan);
  if (!step) return null;
  return { stage: step.stage, status: scan === 'warehouse_in' ? 'completed' : 'in_progress' };
}
