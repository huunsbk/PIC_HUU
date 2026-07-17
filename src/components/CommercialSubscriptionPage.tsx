import React from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  ArrowLeft,
  Ban,
  CalendarClock,
  Check,
  Clock3,
  ExternalLink,
  Landmark,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import bankQrImage from '../assets/bidv-nguyen-van-huu-qr.jpg';
import { supabase } from '../supabaseClient';
import { useTournamentStore } from '../store';
import CommercialOrderCancelDialog from './CommercialOrderCancelDialog';
import {
  formatVnd,
  QuotaCounter,
  TeamCapacitySelector,
} from './CommercialQuotaControls';
import {
  cancelCommercialOrder,
  createCommercialOrder,
  ensureMySelfServiceWorkspace,
  getCommercialAccessState,
  getCurrentCommercialOrder,
  listSelfServicePlans,
  requestCommercialManualReview,
  type CommercialAccessState,
  type CommercialPaymentOrder,
  type SelfServicePlan,
} from '../lib/api/commercial';

const PAYABLE_STATES = new Set(['awaiting_payment', 'manual_review', 'payment_mismatch', 'webhook_invalid']);
const DEFAULT_TEAM_CAPACITY_OPTIONS = [
  { limit: 48 as const, price_vnd: 0 },
  { limit: 64 as const, price_vnd: 50000 },
  { limit: 96 as const, price_vnd: 100000 },
];
const statusLabels: Record<string, string> = {
  awaiting_payment: 'Đang chờ thanh toán',
  manual_review: 'Đang chờ đối soát',
  payment_mismatch: 'Cần kiểm tra số tiền',
  webhook_invalid: 'Cần kiểm tra giao dịch',
};

function formatDateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Chưa có';
}

function entitlementLimit(access: CommercialAccessState, resource: string) {
  return access.entitlements?.find((item) => item.resource_type === resource)?.effective_limit ?? 0;
}

export default function CommercialSubscriptionPage() {
  const navigate = useNavigate();
  const setCommercialAccessState = useTournamentStore((state) => state.setCommercialAccessState);
  const setSelectedTab = useTournamentStore((state) => state.setSelectedTab);
  const [access, setAccess] = React.useState<CommercialAccessState | null>(null);
  const [plans, setPlans] = React.useState<SelfServicePlan[]>([]);
  const [mode, setMode] = React.useState<'renewal' | 'addon'>('renewal');
  const [selectedPlanCode, setSelectedPlanCode] = React.useState('SELF_7D');
  const [extraEvents, setExtraEvents] = React.useState(0);
  const [extraReferees, setExtraReferees] = React.useState(0);
  const [selectedTeamCapacity, setSelectedTeamCapacity] = React.useState<48 | 64 | 96>(48);
  const [order, setOrder] = React.useState<CommercialPaymentOrder | null>(null);
  const [providerAvailable, setProviderAvailable] = React.useState<boolean | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = React.useState(false);
  const [isOpeningWorkspace, setIsOpeningWorkspace] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const requestIdRef = React.useRef(crypto.randomUUID());

  const selectedPlan = plans.find((plan) => plan.code === selectedPlanCode) || plans[0];
  const payableOrder = Boolean(order && PAYABLE_STATES.has(order.status));
  const currentTeamCapacity = (access ? entitlementLimit(access, 'teams_per_event') : 0) || 48;
  const eventAddonPrice = Number(selectedPlan?.event_addon_price_vnd || 20000);
  const refereeAddonPrice = Number(selectedPlan?.referee_addon_price_vnd || 20000);
  const teamCapacityOptions = selectedPlan?.team_capacity_options?.length
    ? selectedPlan.team_capacity_options
    : DEFAULT_TEAM_CAPACITY_OPTIONS;
  const selectedTeamCapacityPrice = Number(
    teamCapacityOptions.find((option) => option.limit === selectedTeamCapacity)?.price_vnd || 0,
  );
  const currentTeamCapacityPrice = Number(
    teamCapacityOptions.find((option) => option.limit === currentTeamCapacity)?.price_vnd || 0,
  );
  const teamCapacityCharge = mode === 'addon'
    ? Math.max(0, selectedTeamCapacityPrice - currentTeamCapacityPrice)
    : selectedTeamCapacityPrice;
  const totalAmount = mode === 'addon'
    ? extraEvents * eventAddonPrice + extraReferees * refereeAddonPrice + teamCapacityCharge
    : Number(selectedPlan?.price_vnd || 0)
      + extraEvents * eventAddonPrice
      + extraReferees * refereeAddonPrice
      + teamCapacityCharge;
  const manualReviewAvailable = Boolean(order && (
    ['payment_mismatch', 'webhook_invalid'].includes(order.status)
    || (order.manual_review_available_at && now >= new Date(order.manual_review_available_at).getTime())
  ));

  const load = React.useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      navigate('/', { replace: true });
      return;
    }
    const [planRows, accessState, currentOrder] = await Promise.all([
      listSelfServicePlans(),
      getCommercialAccessState(),
      getCurrentCommercialOrder(data.session),
    ]);
    if (!accessState.business_access_active) {
      setCommercialAccessState(false, accessState.account?.onboarding_status, accessState.tenant);
      navigate('/unlock', { replace: true });
      return;
    }
    setCommercialAccessState(true, accessState.account?.onboarding_status, accessState.tenant);
    setAccess(accessState);
    setPlans(planRows);
    setSelectedPlanCode((current) => planRows.some((plan) => plan.code === current)
      ? current
      : accessState.subscription?.plan_code || planRows[0]?.code || 'SELF_7D');
    const activeTeamCapacity = entitlementLimit(accessState, 'teams_per_event') || 48;
    setSelectedTeamCapacity([48, 64, 96].includes(activeTeamCapacity)
      ? activeTeamCapacity as 48 | 64 | 96
      : 48);
    setOrder(currentOrder.order && PAYABLE_STATES.has(currentOrder.order.status) ? currentOrder.order : null);
  }, [navigate, setCommercialAccessState]);

  React.useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try { await load(); } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Không thể tải gói dịch vụ.');
      } finally { if (!cancelled) setIsLoading(false); }
    };
    void initialize();
    return () => { cancelled = true; };
  }, [load]);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshOrder = React.useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const result = await getCurrentCommercialOrder(data.session);
    if (result.order?.status === 'paid') {
      setMessage(result.order.order_type === 'addon' ? 'Quota mua thêm đã được cập nhật.' : 'Kỳ gia hạn đã được ghi nhận.');
      setOrder(null);
      setExtraEvents(0);
      setExtraReferees(0);
      requestIdRef.current = crypto.randomUUID();
      await load();
      return;
    }
    setOrder(result.order);
  }, [load]);

  React.useEffect(() => {
    if (!payableOrder) return;
    const timer = window.setInterval(() => void refreshOrder(), 5000);
    const onFocus = () => void refreshOrder();
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [payableOrder, refreshOrder]);

  React.useEffect(() => {
    if (selectedTeamCapacity < currentTeamCapacity) {
      setSelectedTeamCapacity(currentTeamCapacity as 48 | 64 | 96);
    }
  }, [currentTeamCapacity, selectedTeamCapacity]);

  const createOrder = async () => {
    if (!selectedPlan || totalAmount <= 0) return;
    setIsSubmitting(true); setError(null); setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      const result = await createCommercialOrder(data.session, {
        orderType: mode,
        planCode: selectedPlan.code,
        extraEvents,
        extraReferees,
        teamCapacity: mode === 'addon' && selectedTeamCapacity === currentTeamCapacity
          ? null
          : selectedTeamCapacity,
        clientRequestId: requestIdRef.current,
      });
      setOrder(result.order);
      setProviderAvailable(result.provider_available);
      setMessage('Đơn đã được tạo. Backend chỉ cập nhật kỳ/quota sau khi thanh toán được xác minh.');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không thể tạo đơn.');
      await refreshOrder().catch(() => undefined);
    } finally { setIsSubmitting(false); }
  };

  const cancelOrder = async () => {
    if (!order || order.status !== 'awaiting_payment') return;
    setIsCancelling(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      await cancelCommercialOrder(data.session, order.id);
      setOrder(null);
      setCancelDialogOpen(false);
      requestIdRef.current = crypto.randomUUID();
      setMessage('Đã hủy đơn. Bạn có thể lựa chọn và tạo đơn mới.');
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Không thể hủy đơn thanh toán.');
      await refreshOrder().catch(() => undefined);
    } finally {
      setIsCancelling(false);
    }
  };

  const requestReview = async () => {
    if (!order) return;
    setIsSubmitting(true); setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Phiên đăng nhập đã hết hạn.');
      await requestCommercialManualReview(data.session, order.id);
      setOrder((current) => current ? { ...current, status: 'manual_review' } : current);
      setMessage('Đã gửi yêu cầu đối soát. Yêu cầu này không tự gia hạn hoặc cộng quota.');
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Không thể gửi yêu cầu đối soát.');
    } finally { setIsSubmitting(false); }
  };

  const openEventContent = async () => {
    setIsOpeningWorkspace(true);
    setError(null);
    try {
      const result = await ensureMySelfServiceWorkspace();
      setSelectedTab('content');
      navigate(`/admin/workspace/${encodeURIComponent(result.workspace.slug)}`);
    } catch (workspaceError) {
      setError(workspaceError instanceof Error
        ? workspaceError.message
        : 'Không thể mở nội dung thi đấu của giải.');
    } finally {
      setIsOpeningWorkspace(false);
    }
  };

  if (isLoading || !access) return <div className="grid min-h-[50vh] place-items-center"><LoaderCircle className="animate-spin text-blue-600" size={32} /></div>;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-col gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
        <div>
          <div className="mb-2 flex items-center gap-2 text-blue-700 dark:text-blue-300"><CalendarClock size={20} /><span className="text-xs font-black uppercase tracking-[0.16em]">Gói dịch vụ</span></div>
          <h1 className="text-2xl font-black">Quản lý thời hạn và quota</h1>
          <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">Gia hạn không làm mất ngày còn lại. Quota mua thêm chỉ thuộc kỳ hiện tại.</p>
        </div>
        <button
          type="button"
          onClick={() => void openEventContent()}
          disabled={isOpeningWorkspace}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-800 transition-colors hover:bg-blue-100 disabled:cursor-wait disabled:opacity-60 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
        >
          {isOpeningWorkspace ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowLeft size={16} />}
          Về nội dung thi đấu
        </button>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{message}</div>}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-xs font-bold uppercase text-zinc-500">Gói hiện tại</p><p className="mt-1 text-lg font-black">{access.subscription?.plan_name}</p><p className="mt-1 text-sm font-semibold text-zinc-500">Hết hạn: {formatDateTime(access.subscription?.end_date)}</p></div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-xs font-bold uppercase text-zinc-500">Quota hiện tại</p><p className="mt-1 text-sm font-black">{entitlementLimit(access, 'events')} nội dung · {entitlementLimit(access, 'referees')} trọng tài</p><p className="mt-1 text-xs font-semibold text-zinc-500">{currentTeamCapacity} đội/nội dung · Đang dùng {access.usage?.events_used || 0} nội dung, {access.usage?.referees_used || 0} trọng tài</p></div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><p className="text-xs font-bold uppercase text-zinc-500">Kỳ kế tiếp</p>{access.scheduled_renewal ? <><p className="mt-1 text-sm font-black">{access.scheduled_renewal.plan_name}</p><p className="mt-1 text-xs font-semibold text-zinc-500">Bắt đầu {formatDateTime(access.scheduled_renewal.start_date)}</p></> : <p className="mt-2 text-sm font-semibold text-zinc-500">Chưa có kỳ gia hạn</p>}</div>
      </section>

      {!payableOrder && (
        <>
          <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900">
            <button type="button" onClick={() => setMode('renewal')} className={`rounded-md px-4 py-2 text-sm font-black ${mode === 'renewal' ? 'bg-blue-600 text-white' : ''}`}>Gia hạn</button>
            <button type="button" onClick={() => setMode('addon')} className={`rounded-md px-4 py-2 text-sm font-black ${mode === 'addon' ? 'bg-blue-600 text-white' : ''}`}>Mua thêm quota</button>
          </div>

          {mode === 'renewal' && (
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => {
                const selected = selectedPlan?.code === plan.code;
                return <button key={plan.code} type="button" onClick={() => setSelectedPlanCode(plan.code)} className={`min-h-36 rounded-lg border p-4 text-left ${selected ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-200' : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'}`}><div className="flex justify-between"><span className="text-lg font-black">{plan.duration_days} ngày</span><span className={`grid h-6 w-6 place-items-center rounded-full border ${selected ? 'border-blue-600 bg-blue-600 text-white' : 'text-transparent'}`}><Check size={14} /></span></div><p className="mt-3 text-2xl font-black text-blue-700">{formatVnd(Number(plan.price_vnd))}</p><p className="mt-2 text-xs font-semibold text-zinc-500">3 nội dung · 1 trọng tài</p></button>;
              })}
            </section>
          )}

          <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <TeamCapacitySelector options={teamCapacityOptions} value={selectedTeamCapacity} onChange={setSelectedTeamCapacity} currentLimit={currentTeamCapacity} upgradeMode={mode === 'addon'} disableBelowCurrent />
              <div><h2 className="mb-2 text-base font-black">{mode === 'renewal' ? 'Quota của kỳ gia hạn' : 'Quota cộng vào kỳ hiện tại'}</h2><QuotaCounter label="Nội dung thi đấu mua thêm" value={extraEvents} unitPrice={eventAddonPrice} onChange={setExtraEvents} /><QuotaCounter label="Tài khoản trọng tài mua thêm" value={extraReferees} unitPrice={refereeAddonPrice} onChange={setExtraReferees} /></div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-950 p-4 text-white"><p className="text-xs font-bold uppercase text-zinc-400">Tổng thanh toán</p><p className="mt-1 text-3xl font-black">{formatVnd(totalAmount)}</p><p className="mt-2 text-xs font-semibold text-zinc-400">{selectedTeamCapacity} đội/nội dung · +{extraEvents} nội dung · +{extraReferees} trọng tài</p><button type="button" onClick={createOrder} disabled={isSubmitting || totalAmount <= 0 || (mode === 'renewal' && Boolean(access.scheduled_renewal))} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-black disabled:opacity-50"><ShieldCheck size={17} />{mode === 'renewal' ? 'Tạo đơn gia hạn' : 'Tạo đơn mua thêm'}</button></div>
          </section>
        </>
      )}

      {order && payableOrder && (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap justify-between gap-3 border-b border-zinc-200 pb-4"><div><p className="text-xs font-bold uppercase text-zinc-500">Đơn {order.order_code} · {order.order_type}</p><h2 className="mt-1 text-xl font-black">{statusLabels[order.status] || order.status}</h2></div><span className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-black text-amber-800">{formatVnd(Number(order.total_amount))}</span></div>
            <dl className="grid gap-3 py-4 text-sm sm:grid-cols-2"><div><dt className="text-xs font-bold text-zinc-500">Nội dung chuyển khoản</dt><dd className="mt-1 font-black text-red-700">{order.transfer_content}</dd></div><div><dt className="text-xs font-bold text-zinc-500">Đơn hết hạn</dt><dd className="mt-1 font-bold">{formatDateTime(order.expires_at)}</dd></div><div><dt className="text-xs font-bold text-zinc-500">Ngân hàng</dt><dd className="mt-1 font-bold">BIDV</dd></div><div><dt className="text-xs font-bold text-zinc-500">Tài khoản nhận</dt><dd className="mt-1 font-bold">8895707574 · Nguyen Van Huu</dd></div></dl>
            <div className="flex flex-wrap gap-2">{order.checkout_url && <a href={order.checkout_url} target="_blank" rel="noreferrer" className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-black text-white"><ExternalLink size={16} /> Thanh toán qua payOS</a>}<button type="button" onClick={() => void refreshOrder()} className="flex h-10 items-center gap-2 rounded-lg border border-zinc-300 px-4 text-sm font-black"><RefreshCw size={16} /> Kiểm tra trạng thái</button>{manualReviewAvailable && order.status !== 'manual_review' && <button type="button" onClick={requestReview} disabled={isSubmitting} className="flex h-10 items-center gap-2 rounded-lg border border-amber-400 px-4 text-sm font-black text-amber-800"><Clock3 size={16} /> Yêu cầu kiểm tra thanh toán</button>}{order.status === 'awaiting_payment' && <button type="button" onClick={() => setCancelDialogOpen(true)} disabled={isSubmitting || isCancelling} className="flex h-10 items-center gap-2 rounded-lg border border-red-300 px-4 text-sm font-black text-red-700 hover:bg-red-50 disabled:opacity-50"><Ban size={16} /> Hủy thanh toán</button>}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4 text-center dark:border-zinc-800 dark:bg-zinc-900"><div className="mb-3 flex items-center justify-center gap-2 text-sm font-black"><Landmark size={17} className="text-emerald-700" /> Quét mã để thanh toán</div>{order.qr_code ? <div className="mx-auto w-fit rounded-lg border border-zinc-200 bg-white p-3"><QRCodeSVG value={order.qr_code} size={248} level="M" /></div> : <img src={bankQrImage} alt="Mã QR BIDV Nguyen Van Huu" className="mx-auto max-h-[330px] w-full object-contain" />}<p className="mt-3 text-xs font-semibold text-zinc-500">{providerAvailable === false ? 'QR ngân hàng dự phòng. Giữ đúng số tiền và nội dung.' : 'Trạng thái được kiểm tra tự động mỗi 5 giây.'}</p></div>
        </section>
      )}

      <CommercialOrderCancelDialog
        open={cancelDialogOpen}
        orderCode={order?.order_code}
        pending={isCancelling}
        onClose={() => setCancelDialogOpen(false)}
        onConfirm={() => void cancelOrder()}
      />
    </div>
  );
}
