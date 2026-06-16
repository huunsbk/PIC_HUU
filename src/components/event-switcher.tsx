import React from 'react';
import { Layers } from 'lucide-react';
import { useEventsQuery } from './use-events-query';
import { useQueryClient } from '@tanstack/react-query';
import { useTournamentStore } from '../store';

export default function EventSwitcher() {
  const { data: events, isLoading } = useEventsQuery();
  const currentEventId = useTournamentStore(state => state.currentEventId);
  const setCurrentEvent = useTournamentStore(state => state.setCurrentEvent);
  const queryClient = useQueryClient();

  const handleSwitch = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (setCurrentEvent) {
       setCurrentEvent(val);
       // Invalidate matches, teams, groups when switching
       queryClient.invalidateQueries({ queryKey: ['matches'] });
       queryClient.invalidateQueries({ queryKey: ['teams'] });
       queryClient.invalidateQueries({ queryKey: ['groups'] });
    }
  };

  const activeEvent = events?.find(ev => ev.id === currentEventId) || events?.[0];

  return (
    <div className="flex items-center gap-2 relative">
      <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
        <Layers size={14} className="text-zinc-500" />
      </div>
      <select 
        value={activeEvent?.id || ''}
        onChange={handleSwitch}
        disabled={isLoading || !events || events.length === 0}
        className="pl-8 pr-8 py-1.5 bg-zinc-100 outline-none dark:bg-zinc-800 border-none rounded-lg text-sm font-bold text-zinc-900 dark:text-zinc-100 cursor-pointer appearance-none hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
      >
        {isLoading && <option>Đang tải...</option>}
        {!isLoading && (!events || events.length === 0) && <option>Chưa có giải</option>}
        
        {events?.map(ev => (
          <option key={ev.id} value={ev.id}>
            {ev.name}
          </option>
        ))}
      </select>
      
      <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    </div>
  );
}
