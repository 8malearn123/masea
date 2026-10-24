import { Suspense, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  BarChart3,
  CalendarCheck,
  ChevronDown,
  GitCommitHorizontal,
  LayoutDashboard,
  LogOut,
  MapPin,
  ScanLine,
  Smartphone,
  Target,
} from 'lucide-react';
import { BRAND } from '@masiat/shared';
import { useAuth } from '@/store/auth';
import { usePermissions } from '@/hooks/usePermissions';
import { ErrorBoundary } from '@/app/ErrorBoundary';
import { Spinner } from '@/shared/ui';
import { MODULE_GROUPS, type ModuleCode, type ModuleNav } from '@/lib/permissions';
import { MODULE_ICON } from '@/lib/moduleIcons';
import { HR_SECTIONS } from '@/features/hr/sections';

const COLLAPSED_KEY = 'masea_nav_collapsed';

const navItemCls = (isActive: boolean) =>
  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
    isActive ? 'bg-white/15 font-semibold text-white' : 'text-navy-100/90 hover:bg-white/10'
  }`;

const subItemCls = (isActive: boolean) =>
  `flex items-center gap-2.5 rounded-lg py-2 pe-3 ps-9 text-[13px] transition ${
    isActive ? 'bg-white/15 font-semibold text-white' : 'text-navy-100/80 hover:bg-white/10'
  }`;

export default function Layout() {
  const { signOut } = useAuth();
  const { fullName, meta, modules, branchLabel, can } = usePermissions();
  const mobilePreferred = Boolean(meta && !meta.webAccess);
  // Surface the housing supervisor's key actions as clear sidebar links
  // (not buried inside the housing tabs). Shown to anyone with housing access.
  const canScan = can('housing', 'edit') || can('housing', 'create');

  // Collapsible sidebar groups — the long flat module list is grouped into
  // domains (sales, operations, HR, finance, system). Collapse state persists.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — collapse is best-effort */
      }
      return next;
    });

  const byCode = new Map<ModuleCode, ModuleNav>(modules.map((m) => [m.module, m]));

  const renderModule = (m: ModuleNav) => {
    const Icon = MODULE_ICON[m.module];
    return (
      <div key={m.module}>
        <NavLink
          to={m.to}
          end={m.module === 'housing' || m.module === 'hr'}
          className={({ isActive }) => navItemCls(isActive)}
        >
          <Icon size={18} strokeWidth={1.8} />
          <span>{m.label}</span>
        </NavLink>
        {m.module === 'hr' && (
          <div className="mt-1 space-y-1">
            {HR_SECTIONS.filter((s) => s.slug).map((s) => (
              <NavLink
                key={s.key}
                to={`/hr/${s.slug}`}
                className={({ isActive }) => subItemCls(isActive)}
              >
                <s.icon size={16} strokeWidth={1.8} />
                <span>{s.label}</span>
              </NavLink>
            ))}
          </div>
        )}
        {m.module === 'housing' && (
          <div className="mt-1 space-y-1">
            {canScan && (
              <NavLink to="/housing/attendance" className={({ isActive }) => subItemCls(isActive)}>
                <CalendarCheck size={16} strokeWidth={1.8} />
                <span>التحضير</span>
              </NavLink>
            )}
            {canScan && (
              <NavLink to="/housing/scan" className={({ isActive }) => subItemCls(isActive)}>
                <ScanLine size={16} strokeWidth={1.8} />
                <span>مسح الباركود</span>
              </NavLink>
            )}
            <NavLink to="/housing/report" className={({ isActive }) => subItemCls(isActive)}>
              <BarChart3 size={16} strokeWidth={1.8} />
              <span>تقرير السكن</span>
            </NavLink>
            <NavLink to="/housing/targets" className={({ isActive }) => subItemCls(isActive)}>
              <Target size={16} strokeWidth={1.8} />
              <span>مستهدفاتي</span>
            </NavLink>
          </div>
        )}
      </div>
    );
  };

  return (
    <div dir="rtl" className="flex min-h-screen bg-navy-50">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-navy text-white md:flex">
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gold font-bold text-white ring-1 ring-white/20">
            م
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">{BRAND.client.nameAr}</div>
            <div className="text-[11px] text-navy-100/70">نظام إدارة الموارد</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
          <NavLink to="/" end className={({ isActive }) => navItemCls(isActive)}>
            <LayoutDashboard size={18} strokeWidth={1.8} />
            <span>لوحة التحكم</span>
          </NavLink>

          {MODULE_GROUPS.map((group) => {
            const items = group.modules
              .map((code) => byCode.get(code))
              .filter((m): m is ModuleNav => Boolean(m));
            if (items.length === 0) return null;
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key} className="pt-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-navy-100/50 transition hover:text-navy-100/80"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`transition-transform ${isCollapsed ? 'rotate-90' : ''}`}
                  />
                </button>
                {!isCollapsed && <div className="mt-1 space-y-1">{items.map(renderModule)}</div>}
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-3.5 text-[11px] text-navy-100/60">
          {BRAND.vendor.nameAr} · {BRAND.contract}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-navy-100 bg-white px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-navy-50 text-sm font-bold text-navy">
              {fullName.charAt(0)}
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-navy">{fullName}</p>
              {meta && <p className="text-[11px] text-purple">{meta.label}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 text-xs font-bold text-white"
              title={`نسخة البناء ${__BUILD_SHA__} · ${new Date(__BUILD_TIME__).toLocaleString('ar-SA')}`}
            >
              <GitCommitHorizontal size={13} />
              <span className="num">{__BUILD_SHA__}</span>
            </span>
            {branchLabel && (
              <span className="hidden items-center gap-1.5 rounded-full bg-navy-50 px-3 py-1.5 text-xs font-medium text-navy sm:inline-flex">
                <MapPin size={13} className="text-gold-600" /> {branchLabel}
              </span>
            )}
            <button
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-purple transition hover:bg-navy-50 hover:text-navy"
            >
              <LogOut size={15} /> خروج
            </button>
          </div>
        </header>

        {mobilePreferred && (
          <div className="flex items-center justify-center gap-2 border-b border-gold-100 bg-gold-100/60 px-6 py-2.5 text-center text-xs font-semibold text-gold-600">
            <Smartphone size={15} />
            تجربة أفضل عبر تطبيق الجوال — هذه نسخة ويب مبسّطة مخصّصة لدورك.
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
            <Suspense
              fallback={
                <div className="grid min-h-[40vh] place-items-center text-navy">
                  <Spinner className="h-6 w-6" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
