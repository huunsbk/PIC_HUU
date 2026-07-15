import React from 'react';
import { CheckCircle2, LoaderCircle, RefreshCw, SearchCheck, XCircle } from 'lucide-react';
import { supabase } from '../supabaseClient';
import {
  confirmManualReviewOrder,
  listManualReviewOrders,
  rejectManualReviewOrder,
  type ManualReviewOrder,
} from '../lib/api/commercial';

function formatVnd(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Chưa có';
}

export default function PaymentReviewManager() {
  const [orders, setOrders] = React.useState<ManualReviewOrder[]>([]);
  const [selected, setSelected] = React.useState<ManualReviewOrder | null>(null);
  const [transactionId, setTransactionId] = React.useState('');
  const [receivedAmount, setReceivedAmount] = React.useState('');
  const [rejectionReason, setRejectionReason] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const loadOrders = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      const result = await listManualReviewOrders(data.session);
      setOrders(result.orders);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Không thể tải danh sách đối soát.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadOrders(); }, [loadOrders]);

  const chooseOrder = (order: ManualReviewOrder) => {
    setSelected(order);
    setTransactionId('');
    setReceivedAmount(String(order.paid_amount || order.total_amount));
    setRejectionReason('');
    setError(null);
    setMessage(null);
  };

  const confirmOrder = async () => {
    if (!selected) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      await confirmManualReviewOrder(data.session, {
        orderId: selected.id,
        transactionId: transactionId.trim(),
        receivedAmount: Number(receivedAmount),
      });
      setMessage(`Đã xác nhận ${selected.order_code}. Subscription chỉ được kích hoạt một lần.`);
      setSelected(null);
      await loadOrders();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Không thể xác nhận đơn.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const rejectOrder = async () => {
    if (!selected) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      await rejectManualReviewOrder(data.session, { orderId: selected.id, reason: rejectionReason.trim() });
      setMessage(`Đã từ chối ${selected.order_code}.`);
      setSelected(null);
      await loadOrders();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : 'Không thể từ chối đơn.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-black">Đối soát thanh toán</h2>
          <p className="text-sm font-medium text-zinc-500">Chỉ dùng khi webhook chưa xử lý được giao dịch.</p>
        </div>
        <button type="button" onClick={() => void loadOrders()} className="flex h-9 items-center gap-2 rounded-lg border border-zinc-300 px-3 text-xs font-black hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          <RefreshCw size={15} /> Làm mới
        </button>
      </div>
      {error && <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {message && <div className="m-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</div>}
      {isLoading ? (
        <div className="grid min-h-40 place-items-center"><LoaderCircle className="animate-spin text-blue-600" /></div>
      ) : orders.length === 0 ? (
        <div className="grid min-h-44 place-items-center p-6 text-center">
          <div><SearchCheck className="mx-auto text-emerald-600" size={32} /><p className="mt-2 font-black">Không có đơn chờ đối soát</p><p className="text-sm font-medium text-zinc-500">Luồng webhook tự động đang xử lý bình thường.</p></div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-950">
              <tr><th className="p-3">Đơn / trạng thái</th><th className="p-3">Khách hàng</th><th className="p-3">Gói</th><th className="p-3">Số tiền</th><th className="p-3">Yêu cầu lúc</th><th className="p-3 text-right">Thao tác</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950/60">
                  <td className="p-3"><p className="font-black">{order.order_code}</p><p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{order.status}</p></td>
                  <td className="p-3"><p className="font-bold">{order.account_name}</p><p className="text-xs text-zinc-500">{order.tenant_name}</p></td>
                  <td className="p-3 font-semibold">{order.plan_name || order.plan_code || 'Không có'}</td>
                  <td className="p-3"><p className="font-black">{formatVnd(Number(order.total_amount))}</p>{order.paid_amount != null && <p className="text-xs text-zinc-500">Ghi nhận: {formatVnd(Number(order.paid_amount))}</p>}</td>
                  <td className="p-3 text-xs font-semibold">{formatDateTime(order.manual_review_requested_at || order.created_at)}</td>
                  <td className="p-3 text-right"><button type="button" onClick={() => chooseOrder(order)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700">Kiểm tra</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="review-title">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div><h3 id="review-title" className="text-lg font-black">Đối soát {selected.order_code}</h3><p className="text-sm font-semibold text-zinc-500">{selected.account_name} · {selected.tenant_name}</p></div>
              <button type="button" title="Đóng" onClick={() => setSelected(null)} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"><XCircle size={18} /></button>
            </div>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-bold">Số tiền thực nhận<input type="number" min="1" value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-transparent px-3 font-bold dark:border-zinc-700" /></label>
              <label className="block text-sm font-bold">Mã giao dịch ngân hàng<input type="text" autoComplete="off" value={transactionId} onChange={(event) => setTransactionId(event.target.value)} placeholder="Nhập mã tham chiếu duy nhất" className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700" /></label>
              <button type="button" onClick={confirmOrder} disabled={isSubmitting || !transactionId.trim() || Number(receivedAmount) <= 0} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"><CheckCircle2 size={16} /> Xác nhận và mở khóa</button>
              <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
                <label className="block text-sm font-bold">Lý do từ chối<input type="text" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Ví dụ: Không tìm thấy giao dịch" className="mt-1 h-10 w-full rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700" /></label>
                <button type="button" onClick={rejectOrder} disabled={isSubmitting || rejectionReason.trim().length < 3} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-300 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"><XCircle size={16} /> Từ chối yêu cầu</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
