import { z } from 'zod';

export const orderStatusSchema = z.enum([
  'new',
  'paid',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const driverStatusSchema = z.enum(['available', 'on_route', 'off_duty']);
export type DriverStatus = z.infer<typeof driverStatusSchema>;

export const orderServiceCodeSchema = z.enum([
  'recruitment',
  'monthly_rental',
  'daily_rental',
  'sponsorship_transfer',
]);
export type OrderServiceCode = z.infer<typeof orderServiceCodeSchema>;

export const driverSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  phone: z.string().nullable(),
  branch: z.string().nullable(),
  status: driverStatusSchema,
  vehicle_no: z.string().nullable(),
  rating: z.number(),
});
export type Driver = z.infer<typeof driverSchema>;

export const tripStageSchema = z.enum([
  'none',
  'picked_up',
  'delivered',
  'return_picked',
  'returned',
]);
export type TripStage = z.infer<typeof tripStageSchema>;

export const orderSchema = z.object({
  id: z.string(),
  request_no: z.string(),
  customer_name: z.string().nullable(),
  service_code: orderServiceCodeSchema,
  branch: z.string().nullable(),
  status: orderStatusSchema,
  driver_id: z.string().nullable(),
  driver_name: z.string().nullable(),
  total_amount: z.number(),
  created_at: z.string(),
  trip_stage: tripStageSchema.default('none'),
  // trip details for the driver's board (optional — not every order has them)
  customer_phone: z.string().nullable().optional(),
  customer_address: z.string().nullable().optional(),
  dropoff_at: z.string().nullable().optional(), // متى تكون عند العميل
  pickup_at: z.string().nullable().optional(), // متى تأخذها من العميل
});
export type Order = z.infer<typeof orderSchema>;
