import React, { useState } from 'react';
import { Save, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTournamentStore } from '../store';
import { tournamentRpc } from '../lib/api/tournamentRpc';
import { ROUND_SET_MODE_KEYS, ROUND_SET_MODE_LABELS, buildDefaultEventRankingConfig, buildDefaultEventScoringConfig, getEventConfigDefaults } from '../lib/eventSettings';
import type { CompetitionType, EventFormatType, MatchRoundKey, MatchSetMode, RoundScoringRule } from '../types';

export default function EventConfigModal({ event, onClose }: { event: any; onClose: () => void }) {
  const tournamentSettings = useTournamentStore((state) => state.tournament.settings);
  const defaults = getEventConfigDefaults(event, tournamentSettings);
  const [sportId, setSportId] = useState(defaults.sportId);
  const [competitionType, setCompetitionType] = useState<CompetitionType>(defaults.competitionType);
  const [formatType, setFormatType] = useState<EventFormatType>(defaults.formatType);
  const [matchSetMode, setMatchSetMode] = useState<MatchSetMode>(defaults.matchSetMode);
  const [roundScoringRules, setRoundScoringRules] = useState<Record<MatchRoundKey, RoundScoringRule>>(defaults.roundScoringRules);
  const [maxScore] = useState(defaults.maxScore);
  const [capScore] = useState(defaults.capScore);
  const [winPoint, setWinPoint] = useState(defaults.winPoint);
  const [lossPoint, setLossPoint] = useState(defaults.lossPoint);
  const [topPerGroup, setTopPerGroup] = useState(defaults.topPerGroup);
  const [bestThirdCount, setBestThirdCount] = useState(defaults.bestThirdCount);
  const [excludeBottomResults, setExcludeBottomResults] = useState(defaults.excludeBottomResults);
  const [groupCount, setGroupCount] = useState(defaults.groupCount);
  const [courtCount, setCourtCount] = useState(defaults.courtCount);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const handleSubmit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    if (isSubmitting) return;

    const invalidRound = ROUND_SET_MODE_KEYS.find((roundKey) => {
      const rule = roundScoringRules[roundKey];
      return rule.capScore < rule.maxScore;
    });
    if (invalidRound) {
      alert(`${ROUND_SET_MODE_LABELS[invalidRound]}: Điểm kịch trần phải lớn hơn hoặc bằng điểm chạm đến.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const primaryRule = roundScoringRules.group || { matchSetMode, maxScore, capScore };
      const roundSetModes = ROUND_SET_MODE_KEYS.reduce((acc, key) => {
        acc[key] = roundScoringRules[key].matchSetMode;
        return acc;
      }, {} as Record<MatchRoundKey, MatchSetMode>);

      await tournamentRpc.updateEventConfig({
        eventId: event.id,
        sportId,
        competitionType,
        formatType,
        scoringConfig: {
          ...buildDefaultEventScoringConfig({ maxScore: primaryRule.maxScore, capScore: primaryRule.capScore }, primaryRule.matchSetMode),
          roundSetModes,
          roundScoringRules,
          winByTwo: event.scoring_config?.winByTwo ?? true,
          allowDraw: event.scoring_config?.allowDraw ?? false,
        },
        rankingConfig: buildDefaultEventRankingConfig(
          { winPoint, lossPoint, maxScore: primaryRule.maxScore, capScore: primaryRule.capScore, advanceCount: topPerGroup, numBestThirds: bestThirdCount },
          {
            groupCount,
            top_per_group: topPerGroup,
            best_third_count: bestThirdCount,
            exclude_bottom_results: excludeBottomResults,
            schedule_config: {
              court_count: courtCount,
              scheduling_mode: 'round_robin_balanced',
            },
          },
        ),
      });
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      await queryClient.invalidateQueries({ queryKey: ['matches'] });
      await queryClient.invalidateQueries({ queryKey: ['match_sets'] });
      onClose();
    } catch (error) {
      alert(`Không lưu được cấu hình nội dung: ${error instanceof Error ? error.message : 'Lỗi không xác định'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 p-5 dark:border-zinc-800">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cấu hình riêng nội dung</p>
            <h2 className="text-lg font-black text-zinc-900 dark:text-zinc-100">{event.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Môn thi đấu</label>
              <select value={sportId} onChange={(e) => setSportId(e.target.value)} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                <option value="sport_pickleball">Pickleball</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Loại nội dung</label>
              <select value={competitionType} onChange={(e) => setCompetitionType(e.target.value as CompetitionType)} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                <option value="singles">Đơn</option>
                <option value="doubles">Đôi</option>
                <option value="team">Đồng đội</option>
                <option value="individual_time">Cá nhân tính giờ</option>
                <option value="custom">Tùy chỉnh</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Thể thức</label>
              <select value={formatType} onChange={(e) => setFormatType(e.target.value as EventFormatType)} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                <option value="round_robin_only">Chỉ vòng tròn</option>
                <option value="knockout_only">Chỉ loại trực tiếp</option>
                <option value="group_then_knockout">Vòng bảng rồi knockout</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Số séc mặc định</label>
              <select
                value={matchSetMode}
                onChange={(e) => {
                  const nextMode = e.target.value as MatchSetMode;
                  setMatchSetMode(nextMode);
                  setRoundScoringRules((prev) => ROUND_SET_MODE_KEYS.reduce((acc, key) => {
                    acc[key] = { ...prev[key], matchSetMode: nextMode };
                    return acc;
                  }, {} as Record<MatchRoundKey, RoundScoringRule>));
                }}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="single">Một séc</option>
                <option value="best_of_3">Best of 3</option>
              </select>
            </div>
            <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase text-zinc-700 dark:text-zinc-200">Luật điểm theo từng vòng</p>
                  <p className="text-[11px] font-semibold text-zinc-500">Lấy mặc định từ Luật & Điểm Thi Đấu và số séc mặc định. Nếu vòng đã có kết quả, hệ thống sẽ yêu cầu reset điểm trước khi đổi.</p>
                </div>
              </div>
              <div className="grid gap-2">
                {ROUND_SET_MODE_KEYS.map((roundKey) => {
                  const rule = roundScoringRules[roundKey];
                  return (
                    <div key={roundKey} className="grid gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-[120px_minmax(145px,1fr)_120px_120px] sm:items-center">
                      <span className="text-xs font-black text-zinc-700 dark:text-zinc-200">{ROUND_SET_MODE_LABELS[roundKey]}</span>
                      <div className="flex items-center gap-2 text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="radio"
                            name={`round-mode-${roundKey}`}
                            checked={rule.matchSetMode === 'single'}
                            onChange={() => setRoundScoringRules((prev) => ({ ...prev, [roundKey]: { ...prev[roundKey], matchSetMode: 'single' } }))}
                          />
                          1 séc
                        </label>
                        <label className="inline-flex items-center gap-1">
                          <input
                            type="radio"
                            name={`round-mode-${roundKey}`}
                            checked={rule.matchSetMode === 'best_of_3'}
                            onChange={() => setRoundScoringRules((prev) => ({ ...prev, [roundKey]: { ...prev[roundKey], matchSetMode: 'best_of_3' } }))}
                          />
                          3 séc
                        </label>
                      </div>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-black uppercase text-zinc-500">Điểm chạm đến</span>
                        <input
                          type="number"
                          min={1}
                          value={rule.maxScore}
                          onChange={(e) => {
                            const nextMax = Math.max(1, Number(e.target.value) || 1);
                            setRoundScoringRules((prev) => ({
                              ...prev,
                              [roundKey]: {
                                ...prev[roundKey],
                                maxScore: nextMax,
                                capScore: Math.max(nextMax, prev[roundKey].capScore),
                              },
                            }));
                          }}
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] font-black uppercase text-zinc-500">Điểm kịch trần</span>
                        <input
                          type="number"
                          min={1}
                          value={rule.capScore}
                          onChange={(e) => {
                            const nextCap = Math.max(1, Number(e.target.value) || 1);
                            setRoundScoringRules((prev) => ({
                              ...prev,
                              [roundKey]: {
                                ...prev[roundKey],
                                capScore: nextCap,
                              },
                            }));
                          }}
                          className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Tỉ số thắng</label>
              <input type="number" min={0} value={winPoint} onChange={(e) => setWinPoint(Number(e.target.value) || 0)} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Tỉ số thua</label>
              <input type="number" min={0} value={lossPoint} onChange={(e) => setLossPoint(Number(e.target.value) || 0)} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Top mỗi bảng</label>
              <input type="number" min={0} max={8} value={topPerGroup} onChange={(e) => setTopPerGroup(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Hạng 3 xuất sắc</label>
              <input type="number" min={0} max={16} value={bestThirdCount} onChange={(e) => setBestThirdCount(Math.max(0, Number(e.target.value) || 0))} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Số bảng mặc định</label>
              <input type="number" min={1} max={32} value={groupCount} onChange={(e) => setGroupCount(Math.min(32, Math.max(1, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Số sân thi đấu</label>
              <input type="number" min={1} max={32} value={courtCount} onChange={(e) => setCourtCount(Math.min(32, Math.max(1, Number(e.target.value) || 1)))} className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
            </div>
            <label className="flex items-center gap-2 pt-6 text-xs font-bold text-zinc-600 dark:text-zinc-300">
              <input type="checkbox" checked={excludeBottomResults} onChange={(e) => setExcludeBottomResults(e.target.checked)} />
              Loại kết quả gặp đội cuối bảng khi so hạng ba
            </label>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200">
            Lưu cấu hình này chỉ áp dụng cho nội dung hiện tại. Trận đã có điểm cần reset trước khi đổi số séc, điểm chạm đến hoặc điểm kịch trần của vòng đó.
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-zinc-100 px-4 py-2 font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
              Hủy
            </button>
            <button type="submit" disabled={isSubmitting} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              <Save size={16} /> Lưu cấu hình
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
