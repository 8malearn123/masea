/** المرحلة د — الحضور (مرآة 0072): الطرق والصلاحيات من الإعدادات، الرمز والموقع، اليدوي، إغلاق اليوم. */
import { afterEach, describe, expect, it } from 'vitest';
import { useAuth } from '@/store/auth';
import { clearDemo, DEMO_ACCOUNTS, demoProfile, saveDemo } from '@/lib/demo';
import {
  attendanceCheck,
  closeAttendanceDay,
  getAttendanceConfig,
  getMyEmployee,
  listAttendance,
  listBranchAttendance,
  listHolidays,
  manualAttendance,
  saveAttendanceConfig,
} from '@/features/hr/api/hr.api';
import {
  DEFAULT_ATTENDANCE_CONFIG,
  distanceM,
  isWorkday,
  lateMinutes,
  methodsFor,
  qrPayload,
  tokenFromQr,
} from '@/features/hr/lib/attendanceEngine';

function loginAs(role: string) {
  const acc = DEMO_ACCOUNTS.find((a) => a.role === role)!;
  saveDemo(acc);
  useAuth.setState({ profile: demoProfile(acc) });
}
afterEach(async () => {
  clearDemo();
  useAuth.setState({ profile: null });
  await saveAttendanceConfig({ ...DEFAULT_ATTENDANCE_CONFIG });
});

describe('rules (same numbers as SQL test 99)', () => {
  it('distance, lateness, workdays and holidays', async () => {
    expect(distanceM(17.5656, 44.2289, 17.566, 44.2289)).toBe(44);
    expect(distanceM(17.5656, 44.2289, 17.6156, 44.2289)).toBeGreaterThan(5000);
    expect(lateMinutes('08:40', 8, 15)).toBe(25);
    expect(lateMinutes('08:10', 8, 15)).toBe(0);
    const holidays = await listHolidays();
    expect(isWorkday('2026-11-06', DEFAULT_ATTENDANCE_CONFIG, holidays)).toBe(false); // Friday
    expect(isWorkday('2026-09-23', DEFAULT_ATTENDANCE_CONFIG, holidays)).toBe(false); // National Day
    expect(isWorkday('2026-11-03', DEFAULT_ATTENDANCE_CONFIG, holidays)).toBe(true);
  });
  it('QR payload round-trips and methods follow role + switch', () => {
    expect(tokenFromQr(qrPayload('abc123'))).toBe('abc123');
    expect(methodsFor('sales', DEFAULT_ATTENDANCE_CONFIG)).toEqual({
      qr: true,
      gps: true,
      manual: false,
    });
    expect(methodsFor('hr', DEFAULT_ATTENDANCE_CONFIG).manual).toBe(true);
    expect(methodsFor('driver', DEFAULT_ATTENDANCE_CONFIG)).toEqual({
      qr: false,
      gps: false,
      manual: false,
    });
  });
});

describe('self check-in (demo mirror of attendance_check)', () => {
  it('location: too far refused, near → in, then out, then done', async () => {
    loginAs('call_center'); // ريم الزهراني — فرع حبونا (checked in, not out)
    const me = (await getMyEmployee())!;
    expect(me.full_name).toBe('ريم الزهراني');
    const home = (await listBranchAttendance()).find((b) => b.city === me.branch)!;
    // today's seed already has her check-in → the next check is her check-out
    const before = (await listAttendance()).find((a) => a.employee_id === me.id);
    expect(before?.check_in).toBeTruthy();
    await expect(
      attendanceCheck('gps', { lat: home.latitude! + 0.05, lng: home.longitude! }),
    ).rejects.toThrow('على بُعد');
    const r = await attendanceCheck('gps', { lat: home.latitude! + 0.0003, lng: home.longitude! });
    expect(r.action).toBe('out');
    expect(r.distance_m).toBeLessThan(50);
    await expect(
      attendanceCheck('gps', { lat: home.latitude!, lng: home.longitude! }),
    ).rejects.toThrow('وانصرافك');
  });

  it('QR: wrong token / other branch refused; switches and roles enforced', async () => {
    loginAs('branch_manager'); // سعد آل مريح — جازان (already checked in & out in the seed)
    const branches = await listBranchAttendance();
    await expect(attendanceCheck('qr', { token: 'wrong' })).rejects.toThrow('غير صحيح');
    const najran = branches.find((b) => b.city === 'نجران')!;
    await expect(
      attendanceCheck('qr', { token: qrPayload(najran.attendance_token) }),
    ).rejects.toThrow('فرعك مختلف');
    const cfg = await getAttendanceConfig();
    await saveAttendanceConfig({ ...cfg, qr_roles: ['admin', 'hr'], gps_enabled: false });
    await expect(attendanceCheck('qr', { token: 'x' })).rejects.toThrow('دورك لا يسمح');
    await expect(attendanceCheck('gps', { lat: 1, lng: 1 })).rejects.toThrow('غير مفعّل');
  });

  it('an account without an employee file cannot check in', async () => {
    loginAs('external_office');
    await expect(attendanceCheck('gps', { lat: 1, lng: 1 })).rejects.toThrow('غير مرتبط');
  });
});

describe('manual correction and closing a day', () => {
  it('manual needs the role + a note; late minutes computed', async () => {
    loginAs('sales');
    await expect(
      manualAttendance({
        employee_id: 'e3',
        date: '2026-11-02',
        status: 'present',
        check_in: '08:00',
        check_out: null,
        note: 'x',
      }),
    ).rejects.toThrow('غير مسموح');
    loginAs('hr');
    await expect(
      manualAttendance({
        employee_id: 'e3',
        date: '2026-11-02',
        status: 'present',
        check_in: '08:40',
        check_out: '16:00',
        note: '',
      }),
    ).rejects.toThrow('سبب التعديل');
    await manualAttendance({
      employee_id: 'e3',
      date: '2026-11-02',
      status: 'present',
      check_in: '08:40',
      check_out: '16:00',
      note: 'نسيت التسجيل',
    });
    const r = (await listAttendance('2026-11-02')).find((a) => a.employee_id === 'e3')!;
    expect(r).toMatchObject({ status: 'late', late_minutes: 25, check_in_method: 'manual' });
  });

  it('closing a past workday marks no-shows absent; weekends change nothing', async () => {
    loginAs('hr');
    expect((await closeAttendanceDay('2026-11-06')).workday).toBe(false); // Friday
    const res = await closeAttendanceDay('2026-11-03');
    expect(res.workday).toBe(true);
    expect(res.absent).toBeGreaterThan(0);
    const day = await listAttendance('2026-11-03');
    expect(day.every((a) => a.status === 'absent' || a.status === 'leave')).toBe(true);
    await expect(closeAttendanceDay('2999-01-01')).rejects.toThrow('بعد انتهائه');
  });
});
