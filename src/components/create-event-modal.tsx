import React, { useState } from 'react';
import { X, Save } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTournamentStore } from '../store';
import { buildScoringConfig, tournamentRpc } from '../lib/api/tournamentRpc';
import type { CompetitionType, EventFormatType, MatchSetMode } from '../types';

export default function CreateEventModal({ onClose }: { onClose: () => void }) {
  const [eventName, setEventName] = useState('');
  const [slug, setSlug] = useState('');
  const [sportId, setSportId] = useState('sport_pickleball');
  const [competitionType, setCompetitionType] = useState<CompetitionType>('doubles');
  const [formatType, setFormatType] = useState<EventFormatType>('group_then_knockout');
  const [matchSetMode, setMatchSetMode] = useState<MatchSetMode>('single');
  const [groupCount, setGroupCount] = useState(4);
  const [courtCount, setCourtCount] = useState(1);
  const [topPerGroup, setTopPerGroup] = useState(2);
  const [bestThirdCount, setBestThirdCount] = useState(0);
  const [excludeBottomResults, setExcludeBottomResults] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();
  const activeTournamentId = useTournamentStore(state => state.activeTournamentId);
  const tournamentId = useTournamentStore(state => state.tournament.id);
  const scopedTournamentId = activeTournamentId || tournamentId;
  const setCurrentEvent = useTournamentStore(state => state.setCurrentEvent);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (!scopedTournamentId || scopedTournamentId === 't-1') {
        throw new Error('Vui lòng mở một giải đấu thật trước khi tạo nội dung thi đấu.');
      }

      const result = await tournamentRpc.createEvent({
          tournamentId: scopedTournamentId,
          name: eventName,
          sportId,
          competitionType,
          formatType,
          scoringConfig: buildScoringConfig(matchSetMode),
          rankingConfig: {
            groupCount,
            top_per_group: topPerGroup,
            best_third_count: bestThirdCount,
            exclude_bottom_results: excludeBottomResults,
            schedule_config: {
              court_count: courtCount,
              scheduling_mode: 'round_robin_balanced',
            },
            bestThirds: {
              enabled: bestThirdCount > 0,
              count: bestThirdCount,
              excludeBottomTeamResults: excludeBottomResults,
            },
          } as any,
        });

      const eventId = result.event_id || result.event?.id;
      if (eventId) {
        setCurrentEvent(eventId);
      }
      
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['matches'] });
      onClose();
    } catch (err: any) {
      alert(`Lỗi tạo nội dung thi đấu: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-zinc-200 dark:border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Tạo nội dung thi đấu mới</h2>
          <button onClick={onClose} className="p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-full">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Tên nội dung thi đấu</label>
            <input required type="text" value={eventName} onChange={e => {
              setEventName(e.target.value);
              if (!slug) {
                // simple auto slug
                setSlug(e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-'));
              }
            }} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-1">Slug nội dung</label>
            <input required type="text" value={slug} onChange={e => setSlug(e.target.value)} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono text-sm" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Môn thi đấu</label>
              <select value={sportId} onChange={e => setSportId(e.target.value)} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm">
                <option value="sport_pickleball">Pickleball</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Nội dung</label>
              <select value={competitionType} onChange={e => setCompetitionType(e.target.value as CompetitionType)} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm">
                <option value="singles">Đơn</option>
                <option value="doubles">Đôi</option>
                <option value="team">Đồng đội</option>
                <option value="individual_time">Cá nhân tính giờ</option>
                <option value="custom">Tùy chỉnh</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Thể thức</label>
              <select value={formatType} onChange={e => setFormatType(e.target.value as EventFormatType)} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm">
                <option value="round_robin_only">Chỉ vòng tròn</option>
                <option value="knockout_only">Chỉ loại trực tiếp</option>
                <option value="group_then_knockout">Vòng bảng rồi knockout</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Số séc</label>
              <select value={matchSetMode} onChange={e => setMatchSetMode(e.target.value as MatchSetMode)} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm">
                <option value="single">Một séc</option>
                <option value="best_of_3">Best of 3</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Số bảng</label>
              <input type="number" min={1} max={32} value={groupCount} onChange={e => setGroupCount(Math.min(32, Math.max(1, Number(e.target.value) || 1)))} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Số sân thi đấu</label>
              <input type="number" min={1} max={32} value={courtCount} onChange={e => setCourtCount(Math.min(32, Math.max(1, Number(e.target.value) || 1)))} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Top mỗi bảng</label>
              <input type="number" min={0} max={8} value={topPerGroup} onChange={e => setTopPerGroup(Math.max(0, Number(e.target.value) || 0))} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Hạng 3 xuất sắc</label>
              <input type="number" min={0} max={16} value={bestThirdCount} onChange={e => setBestThirdCount(Math.max(0, Number(e.target.value) || 0))} className="w-full px-3 py-2 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-zinc-600 dark:text-zinc-300 pt-6">
              <input type="checkbox" checked={excludeBottomResults} onChange={e => setExcludeBottomResults(e.target.checked)} />
              Loại kết quả gặp đội cuối bảng khi so hạng ba
            </label>
          </div>

          <div className="pt-2">
            <p className="text-xs text-zinc-500">Preview nội dung: <span className="font-mono text-blue-600">/e/{slug || '...'}</span></p>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg font-bold">Hủy</button>
            <button type="submit" disabled={isSubmitting} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2">
              <Save size={16} /> Tạo nội dung
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
