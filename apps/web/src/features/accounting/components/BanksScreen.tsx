import { useMemo, useState } from 'react';
import { ArrowLeftRight, Landmark, Plus, ScrollText } from 'lucide-react';
import { Button, Card, Input, Modal, Select, Table, type Column } from '@/shared/ui';
import { sar, dateAr } from '@/shared/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { BRANCHES_AR } from '@/lib/funnel';
import {
  useAddBankAccount,
  useBankAccounts,
  useBankTransfer,
  useJournal,
} from '@/features/accounting/hooks/useAccounting';
import type { BankAccount, JournalEntry } from '@/features/accounting/types';

const branchOptions = [
  { value: 'head', label: 'المركز الرئيسي' },
  ...BRANCHES_AR.map((b) => ({ value: b, label: b })),
];
const toBranch = (v: string): string | null => (v === 'head' ? null : v);

/** Net movement (debit − credit) on an account code across the journal. */
function balanceOf(entries: JournalEntry[], code: string): number {
  let bal = 0;
  for (const e of entries)
    for (const l of e.lines) if (l.account_code === code) bal += l.debit - l.credit;
  return Math.round(bal * 100) / 100;
}

export function BanksScreen() {
  const { can } = usePermissions();
  const editable = can('accounting', 'create');
  const { data: accounts = [], isLoading, isError, refetch } = useBankAccounts();
  const { data: entries = [] } = useJournal();
  const [transfer, setTransfer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState<BankAccount | null>(null);

  const withBal = accounts.map((a) => ({ ...a, balance: balanceOf(entries, a.account_code) }));
  const totalCash = withBal.reduce((s, a) => s + a.balance, 0);

  const columns: Column<(typeof withBal)[number]>[] = [
    {
      key: 'name',
      header: 'الحساب',
      cell: (a) => <span className="font-semibold text-navy">{a.name}</span>,
    },
    { key: 'bank', header: 'البنك', cell: (a) => a.bank },
    {
      key: 'iban',
      header: 'الآيبان',
      cell: (a) => <span className="num text-xs">{a.iban ?? '—'}</span>,
    },
    {
      key: 'code',
      header: 'الحساب',
      cell: (a) => <span className="num text-navy-300 text-xs">{a.account_code}</span>,
    },
    {
      key: 'balance',
      header: 'الرصيد',
      cell: (a) => <span className="num font-bold text-navy">{sar(a.balance)} ر.س</span>,
    },
    {
      key: 'actions',
      header: '',
      cell: (a) => (
        <button
          type="button"
          onClick={() => setStatement(a)}
          className="inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2.5 py-1.5 text-xs font-medium text-navy hover:bg-navy-100"
        >
          <ScrollText size={13} /> كشف الحساب
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="عدد الحسابات" value={String(accounts.length)} />
        <Stat label="إجمالي النقدية والبنوك" value={sar(totalCash)} tone="text-gold-600" />
      </div>
      {editable && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setTransfer(true)}>
            <ArrowLeftRight size={16} /> تحويل بين الحسابات
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> إضافة حساب بنكي
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={withBal}
        rowKey={(a) => a.id}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => void refetch()}
        emptyTitle="لا توجد حسابات بنكية"
      />
      <p className="text-xs leading-relaxed text-purple">
        الأرصدة محسوبة من دفتر اليومية مباشرةً (الأرصدة الافتتاحية + التحصيلات + المدفوعات +
        التحويلات). كل حساب مربوط بحساب في دليل الحسابات.
      </p>

      {transfer && <TransferModal accounts={accounts} onClose={() => setTransfer(false)} />}
      {adding && <AddBankModal onClose={() => setAdding(false)} />}
      {statement && (
        <StatementModal account={statement} entries={entries} onClose={() => setStatement(null)} />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'text-navy',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card className="py-4">
      <p className="text-xs text-purple">{label}</p>
      <p className={`num mt-1 text-2xl font-bold ${tone}`}>{value}</p>
    </Card>
  );
}

function TransferModal({ accounts, onClose }: { accounts: BankAccount[]; onClose: () => void }) {
  const transfer = useBankTransfer();
  const [from, setFrom] = useState(accounts[1]?.account_code ?? '1112');
  const [to, setTo] = useState(accounts[0]?.account_code ?? '1111');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState('2026-06-05');
  const [branch, setBranch] = useState('نجران');
  const [note, setNote] = useState('');
  const opts = accounts.map((a) => ({ value: a.account_code, label: a.name }));

  function submit() {
    transfer.mutate(
      { from_code: from, to_code: to, amount, date, branch: toBranch(branch), note },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="تحويل بين الحسابات">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="من حساب"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            options={opts}
          />
          <Select
            label="إلى حساب"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            options={opts}
          />
          <Input
            label="المبلغ"
            type="number"
            min={0}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
          <Input label="ملاحظة" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {from === to && <p className="text-xs text-red-600">لا يمكن التحويل لنفس الحساب.</p>}
        <Button onClick={submit} disabled={amount <= 0 || from === to} className="w-full">
          <ArrowLeftRight size={16} /> ترحيل التحويل
        </Button>
      </div>
    </Modal>
  );
}

function AddBankModal({ onClose }: { onClose: () => void }) {
  const add = useAddBankAccount();
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [iban, setIban] = useState('');
  const [opening, setOpening] = useState(0);
  const [branch, setBranch] = useState('نجران');

  function submit() {
    add.mutate(
      { name, bank, iban, opening_balance: opening, branch: toBranch(branch) },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal open onClose={onClose} title="إضافة حساب بنكي">
      <div className="space-y-3">
        <Input label="اسم الحساب" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="البنك" value={bank} onChange={(e) => setBank(e.target.value)} />
          <Input label="الآيبان" value={iban} onChange={(e) => setIban(e.target.value)} />
          <Input
            label="الرصيد الافتتاحي"
            type="number"
            min={0}
            value={opening}
            onChange={(e) => setOpening(Number(e.target.value))}
          />
          <Select
            label="مركز التكلفة"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            options={branchOptions}
          />
        </div>
        <p className="text-xs text-purple">
          يُنشأ حساب في دليل الحسابات تحت «النقدية والبنوك»، ويُرحَّل الرصيد الافتتاحي إن وُجد.
        </p>
        <Button onClick={submit} disabled={!name.trim()} className="w-full">
          <Landmark size={16} /> إضافة الحساب
        </Button>
      </div>
    </Modal>
  );
}

function StatementModal({
  account,
  entries,
  onClose,
}: {
  account: BankAccount;
  entries: JournalEntry[];
  onClose: () => void;
}) {
  const rows = useMemo(() => {
    const txns: { date: string; desc: string; debit: number; credit: number }[] = [];
    for (const e of [...entries].sort(
      (a, b) => a.entry_date.localeCompare(b.entry_date) || a.entry_no - b.entry_no,
    )) {
      for (const l of e.lines) {
        if (l.account_code === account.account_code) {
          txns.push({ date: e.entry_date, desc: e.description, debit: l.debit, credit: l.credit });
        }
      }
    }
    let bal = 0;
    return txns.map((t) => {
      bal += t.debit - t.credit;
      return { ...t, balance: Math.round(bal * 100) / 100 };
    });
  }, [entries, account.account_code]);

  return (
    <Modal open onClose={onClose} title={`كشف حساب — ${account.name}`}>
      <div className="max-h-[72vh] overflow-y-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-100 text-xs text-purple">
              <th className="py-2 text-right">التاريخ</th>
              <th className="py-2 text-right">البيان</th>
              <th className="py-2 text-left">مدين</th>
              <th className="py-2 text-left">دائن</th>
              <th className="py-2 text-left">الرصيد</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={i} className="border-b border-navy-50">
                <td className="num py-2 text-xs">{dateAr(t.date)}</td>
                <td className="py-2">{t.desc}</td>
                <td className="num py-2 text-left text-green-600">
                  {t.debit > 0 ? sar(t.debit) : '—'}
                </td>
                <td className="num py-2 text-left text-red-600">
                  {t.credit > 0 ? sar(t.credit) : '—'}
                </td>
                <td className="num py-2 text-left font-semibold text-navy">{sar(t.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-purple">لا توجد حركات.</p>
        )}
        <div className="mt-3 flex justify-between border-t border-navy-100 pt-3 text-sm font-bold">
          <span className="text-navy">الرصيد الحالي</span>
          <span className="num text-gold-600">
            {sar(rows.length ? (rows[rows.length - 1]?.balance ?? 0) : 0)} ر.س
          </span>
        </div>
      </div>
    </Modal>
  );
}
