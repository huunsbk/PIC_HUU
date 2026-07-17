import { Check, Minus, Plus } from 'lucide-react';
import type { TeamCapacityOption } from '../lib/api/commercial';

export function formatVnd(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

export function QuotaCounter({
  label,
  value,
  unitPrice,
  onChange,
}: {
  label: string;
  value: number;
  unitPrice: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 py-2 last:border-b-0 dark:border-zinc-800">
      <div>
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className="text-xs font-semibold text-zinc-500">+{formatVnd(unitPrice)} / đơn vị</p>
      </div>
      <div className="grid grid-cols-[36px_44px_36px] items-center overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
        <button
          type="button"
          title={`Giảm ${label}`}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="grid h-9 place-items-center bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <Minus size={15} />
        </button>
        <span className="text-center text-sm font-black tabular-nums">{value}</span>
        <button
          type="button"
          title={`Tăng ${label}`}
          onClick={() => onChange(Math.min(100, value + 1))}
          className="grid h-9 place-items-center bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

export function TeamCapacitySelector({
  options,
  value,
  onChange,
  currentLimit,
  upgradeMode = false,
  disableBelowCurrent = false,
}: {
  options: TeamCapacityOption[];
  value: 48 | 64 | 96;
  onChange: (value: 48 | 64 | 96) => void;
  currentLimit?: number;
  upgradeMode?: boolean;
  disableBelowCurrent?: boolean;
}) {
  const currentPrice = options.find((option) => option.limit === currentLimit)?.price_vnd || 0;

  return (
    <section aria-labelledby="team-capacity-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="team-capacity-heading" className="text-base font-black">Sức chứa mỗi nội dung thi đấu</h2>
          <p className="mt-0.5 text-xs font-semibold text-zinc-500">Giới hạn được kiểm tra khi thêm, import và khôi phục đội.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Tối đa 96 đội
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => {
          const selected = option.limit === value;
          const disabled = (upgradeMode || disableBelowCurrent)
            && Boolean(currentLimit && option.limit < currentLimit);
          const displayedPrice = upgradeMode
            ? Math.max(0, Number(option.price_vnd) - currentPrice)
            : Number(option.price_vnd);
          return (
            <button
              key={option.limit}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.limit)}
              className={`min-h-24 rounded-lg border p-3 text-left transition ${
                selected
                  ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200 dark:bg-blue-950/35 dark:ring-blue-900'
                  : 'border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900'
              } disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-lg font-black">{option.limit} đội</span>
                <span className={`grid h-6 w-6 place-items-center rounded-full border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-zinc-300 text-transparent'}`}>
                  <Check size={14} />
                </span>
              </span>
              <span className="mt-2 block text-xs font-bold text-zinc-500">
                {displayedPrice === 0
                  ? (option.limit === currentLimit ? 'Mức hiện tại' : 'Đã bao gồm')
                  : `+${formatVnd(displayedPrice)}`}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
