import React from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  KeyRound,
  Landmark,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import bankQrImage from '../assets/bidv-nguyen-van-huu-qr.jpg';
import {
  createCommercialOrder,
  ensureMySelfServiceWorkspace,
  getCommercialAccessState,
  getCurrentCommercialOrder,
  listSelfServicePlans,
  requestCommercialManualReview,
  type CommercialPaymentOrder,
  type SelfServicePlan,
} from '../lib/api/commercial';

const ADDON_PRICE = 10000;
const TERMINAL_ORDER_STATES = new Set(['paid', 'rejected', 'expired', 'cancelled']);

const statusLabels: Record<string, string> = {
  awaiting_payment: 'Đang chờ thanh toán',
  manual_review: 'Đang chờ đối soát',
  payment_mismatch: 'Cần kiểm tra số tiền',
  webhook_invalid: 'Cần kiểm tra giao dịch',
  paid: 'Đã thanh toán',
  rejected: 'Đã từ chối',
  expired: 'Đã hết hạn',
  cancelled: 'Đã hủy',
};

function formatVnd(value: number) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(value);
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Chưa có';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-zinc-200 py-2 last:border-b-0 dark:border-zinc-800">
      <div>
        <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className="text-xs font-semibold text-zinc-500">+{formatVnd(ADDON_PRICE)} / đơn vị</p>
      </div>
      <div className="grid grid-cols-[36px_44px_36px] items-center overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
        <button type="button" title={`Giảm ${label}`} onClick={() => onChange(Math.max(0, value - 1))} className="grid h-9 place-items-center bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800">
          <Minus size={15} />
        </button>
        <span className="text-center text-sm font-black tabular-nums">{value}</span>
        <button type="button" title={`Tăng ${label}`} onClick={() => onChange(Math.min(100, value + 1))} className="grid h-9 place-items-center bg-zinc-50 hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800">
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}

export default function CommercialUnlockPage() {
  const navigate = useNavigate();
  const currentEnterpriseUser = useTournamentStore((state) => state.currentEnterpriseUser);
  const setCommercialAccessState = useTournamentStore((state) => state.setCommercialAccessState);
  const initSupabase = useTournamentStore((state) => state.initSupabase);
  const [plans, setPlans] = React.useState<SelfServicePlan[]>([]);
  const [selectedPlanCode, setSelectedPlanCode] = React.useState<string>('SELF_7D');
  const [extraEvents, setExtraEvents] = React.useState(0);
  const [extraReferees, setExtraReferees] = React.useState(0);
  const [order, setOrder] = React.useState<CommercialPaymentOrder | null>(null);
  const [providerAvailable, setProviderAvailable] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const requestIdRef = React.useRef(crypto.randomUUID());

  const selectedPlan = plans.find((plan) => plan.code === selectedPlanCode) || plans[0];
  const totalAmount = Number(selectedPlan?.price_vnd || 0) + (extraEvents + extraReferees) * ADDON_PRICE;
  const hasPayableOrder = Boolean(order && !TERMINAL_ORDER_STATES.has(order.status));
  const manualReviewAvailable = Boolean(order && (
    ['payment_mismatch', 'webhook_invalid'].includes(order.status)
    || (order.manual_review_available_at && now >= new Date(order.manual_review_available_at).getTime())
  ));

  const moveToWorkspace = React.useCallback(async () => {
    try {
      setCommercialAccessState(true, 'ready');
      await initSupabase();
      const result = await ensureMySelfServiceWorkspace();
      navigate(`/admin/workspace/${encodeURIComponent(result.workspace.slug)}`, { replace: true });
    } catch (workspaceError) {
      setError(workspaceError instanceof Error
        ? workspaceError.message
        : 'Không thể chuẩn bị giải đấu sau khi mở khóa.');
    }
  }, [initSupabase, navigate, setCommercialAccessState]);

  const refreshOrder = React.useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const result = await getCurrentCommercialOrder(data.session);
    setOrder(result.order);
    if (result.order?.status === 'paid') await moveToWorkspace();
  }, [moveToWorkspace]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          navigate('/', { replace: true });
          return;
        }
        const [planRows, access, currentOrder] = await Promise.all([
          listSelfServicePlans(),
          getCommercialAccessState(),
          getCurrentCommercialOrder(data.session),
        ]);
        if (cancelled) return;
        setCommercialAccessState(
          access.business_access_active,
          access.account?.onboarding_status,
          access.tenant,
        );
        if (access.commercial_state === 'not_applicable' || access.business_access_active) {
          await moveToWorkspace();
          return;
        }
        setPlans(planRows);
        setSelectedPlanCode((current) => planRows.some((plan) => plan.code === current) ? current : planRows[0]?.code || 'SELF_7D');
        setOrder(currentOrder.order);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Không thể tải trang mở khóa.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [moveToWorkspace, navigate, setCommercialAccessState]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (!hasPayableOrder) return;
    const timer = window.setInterval(() => void refreshOrder(), 5000);
    const onFocus = () => void refreshOrder();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [hasPayableOrder, refreshOrder]);

  const createOrder = async () => {
    if (!selectedPlan) return;
    setIsSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      const result = await createCommercialOrder(data.session, {
        planCode: selectedPlan.code,
        extraEvents,
        extraReferees,
        clientRequestId: requestIdRef.current,
      });
      setOrder(result.order);
      setProviderAvailable(result.provider_available);
      setMessage('Đơn đã được tạo. Hệ thống sẽ tự mở khóa khi nhận xác nhận thanh toán.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không thể tạo đơn thanh toán.');
      await refreshOrder().catch(() => undefined);
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestReview = async () => {
    if (!order) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      await requestCommercialManualReview(data.session, order.id);
      setOrder((current) => current ? { ...current, status: 'manual_review', manual_review_requested_at: new Date().toISOString() } : current);
      setMessage('Đã gửi yêu cầu. SUPER_ADMIN sẽ đối soát giao dịch, yêu cầu này không tự mở khóa tài khoản.');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Không thể gửi yêu cầu đối soát.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div className="grid min-h-[50vh] place-items-center"><LoaderCircle className="animate-spin text-blue-600" size={32} /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-zinc-800">
        <div>
          <div className="mb-2 flex items-center gap-2 text-blue-700 dark:text-blue-300">
            <KeyRound size={20} />
            <span className="text-xs font-black uppercase tracking-[0.16em]">Mở khóa vận hành</span>
          </div>
          <h1 className="text-2xl font-black text-zinc-950 dark:text-white">Chọn thời hạn dùng cho giải đấu</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Thanh toán được xác minh tự động qua payOS. Tài khoản chỉ mở nghiệp vụ sau khi backend nhận webhook hợp lệ.
          </p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950/40">
          <p className="font-black text-blue-900 dark:text-blue-100">{currentEnterpriseUser?.display_name || currentEnterpriseUser?.username}</p>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">Đơn vị khách hàng tự phục vụ</p>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">{message}</div>}

      {!hasPayableOrder && order?.status !== 'paid' && (
        <>
          <section aria-labelledby="plan-heading">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="plan-heading" className="text-base font-black">1. Chọn gói</h2>
              <span className="text-xs font-semibold text-zinc-500">Mỗi gói gồm 1 giải, 3 nội dung, 1 trọng tài</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => {
                const selected = selectedPlan?.code === plan.code;
                return (
                  <button key={plan.code} type="button" onClick={() => setSelectedPlanCode(plan.code)} className={`min-h-40 rounded-lg border p-4 text-left transition ${selected ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200 dark:bg-blue-950/35 dark:ring-blue-900' : 'border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-lg font-black text-zinc-950 dark:text-white">{plan.duration_days} ngày</span>
                      <span className={`grid h-6 w-6 place-items-center rounded-full border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'border-zinc-300 text-transparent'}`}><Check size={14} /></span>
                    </div>
                    <p className="mt-3 text-2xl font-black text-blue-700 dark:text-blue-300">{formatVnd(Number(plan.price_vnd))}</p>
                    <div className="mt-3 space-y-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      <p>1 giải đang hoạt động</p><p>{plan.max_events} nội dung thi đấu</p><p>{plan.max_active_referees} tài khoản trọng tài</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-2 text-base font-black">2. Tăng giới hạn khi cần</h2>
              <Counter label="Nội dung thi đấu mua thêm" value={extraEvents} onChange={setExtraEvents} />
              <Counter label="Tài khoản trọng tài mua thêm" value={extraReferees} onChange={setExtraReferees} />
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-white dark:border-zinc-700">
              <p className="text-xs font-bold uppercase text-zinc-400">Tổng thanh toán</p>
              <p className="mt-1 text-3xl font-black">{formatVnd(totalAmount)}</p>
              <p className="mt-2 text-xs font-semibold text-zinc-400">{selectedPlan?.duration_days || 0} ngày, {3 + extraEvents} nội dung, {1 + extraReferees} trọng tài</p>
              <button type="button" onClick={createOrder} disabled={isSubmitting || !selectedPlan} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">
                {isSubmitting ? <LoaderCircle className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
                Tạo đơn an toàn
              </button>
            </div>
          </section>
        </>
      )}

      {order && !TERMINAL_ORDER_STATES.has(order.status) && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
              <div>
                <p className="text-xs font-bold uppercase text-zinc-500">Đơn {order.order_code}</p>
                <h2 className="mt-1 text-xl font-black">{statusLabels[order.status] || order.status}</h2>
              </div>
              <span className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800 dark:bg-amber-950 dark:text-amber-200">{formatVnd(Number(order.total_amount))}</span>
            </div>
            <dl className="grid gap-3 py-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs font-bold text-zinc-500">Nội dung chuyển khoản</dt><dd className="mt-1 font-black text-red-700 dark:text-red-300">{order.transfer_content}</dd></div>
              <div><dt className="text-xs font-bold text-zinc-500">Đơn hết hạn</dt><dd className="mt-1 font-bold">{formatDateTime(order.expires_at)}</dd></div>
              <div><dt className="text-xs font-bold text-zinc-500">Ngân hàng</dt><dd className="mt-1 font-bold">BIDV</dd></div>
              <div><dt className="text-xs font-bold text-zinc-500">Tài khoản nhận</dt><dd className="mt-1 font-bold">8895707574 · Nguyen Van Huu</dd></div>
            </dl>
            <div className="flex flex-wrap gap-2">
              {order.checkout_url && <a href={order.checkout_url} target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700"><ExternalLink size={16} /> Thanh toán qua payOS</a>}
              <button type="button" onClick={() => void refreshOrder()} className="flex h-10 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-black hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"><RefreshCw size={16} /> Kiểm tra trạng thái</button>
              {manualReviewAvailable && order.status !== 'manual_review' && (
                <button type="button" onClick={requestReview} disabled={isSubmitting} className="flex h-10 items-center gap-2 rounded-lg border border-amber-400 px-4 text-sm font-black text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-950"><Clock3 size={16} /> Yêu cầu kiểm tra thanh toán</button>
              )}
            </div>
            {order.status === 'manual_review' && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Yêu cầu đang được SUPER_ADMIN đối soát. Gửi yêu cầu không tự mở khóa và không cộng quota.</p>}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-center gap-2 text-sm font-black"><Landmark size={17} className="text-emerald-700" /> Quét mã để thanh toán</div>
            {order.qr_code ? (
              <div className="mx-auto w-fit rounded-lg border border-zinc-200 bg-white p-3"><QRCodeSVG value={order.qr_code} size={248} level="M" /></div>
            ) : (
              <img src={bankQrImage} alt="Mã QR BIDV Nguyen Van Huu" className="mx-auto max-h-[330px] w-full object-contain" />
            )}
            <p className="mt-3 text-xs font-semibold text-zinc-500">{providerAvailable === false ? 'QR ngân hàng dự phòng. Giữ đúng số tiền và nội dung.' : 'Trạng thái được kiểm tra tự động mỗi 5 giây.'}</p>
          </div>
        </section>
      )}

      {order?.status === 'paid' && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
          <CheckCircle2 className="mx-auto text-emerald-600" size={38} />
          <h2 className="mt-3 text-xl font-black">Thanh toán đã xác minh</h2>
          <p className="mt-1 text-sm font-semibold text-emerald-800 dark:text-emerald-200">Đang tải quyền vận hành và mở giải đấu của bạn.</p>
        </div>
      )}
    </div>
  );
}
