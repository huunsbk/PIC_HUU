import React from 'react';
import { CircleAlert, LoaderCircle, X } from 'lucide-react';

export default function CommercialOrderCancelDialog({
  open,
  orderCode,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  orderCode?: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, pending]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] grid place-items-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-order-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            <CircleAlert size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="cancel-order-title" className="text-lg font-black">Hủy đơn đang chờ thanh toán?</h2>
            <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
              Đơn {orderCode || ''} sẽ chuyển sang trạng thái đã hủy. Bạn có thể chọn lại gói và tạo đơn mới ngay sau đó.
            </p>
          </div>
          <button type="button" title="Đóng" onClick={onClose} disabled={pending} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800">
            <X size={18} />
          </button>
        </div>
        <p className="mt-4 rounded-md bg-zinc-100 p-3 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          Nếu payOS đã ghi nhận tiền, backend sẽ từ chối hủy và giữ nguyên giao dịch để đối soát.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-black hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Giữ đơn
          </button>
          <button type="button" onClick={onConfirm} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-black text-white hover:bg-red-700 disabled:opacity-50">
            {pending ? <LoaderCircle size={16} className="animate-spin" /> : null}
            Xác nhận hủy
          </button>
        </div>
      </div>
    </div>
  );
}
