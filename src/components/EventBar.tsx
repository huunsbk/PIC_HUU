/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Award } from 'lucide-react';
import { useTournamentStore } from '../store';
import { useEventsQuery } from './use-events-query';

export default function EventBar() {
  const currentEventId = useTournamentStore((state) => state.currentEventId);
  const setCurrentEvent = useTournamentStore((state) => state.setCurrentEvent);
  const { data: events = [], isLoading } = useEventsQuery();

  const currentEvent = events.find((event: any) => event.id === currentEventId) || events[0];

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 mb-4 shadow-xs" id="tournament-events-bar">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-blue-50 dark:bg-blue-950/40 rounded-lg text-blue-600 dark:text-blue-400">
              <Award size={16} className="stroke-[2.5]" />
            </span>
            <span className="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Nội dung thi đấu đang chọn
            </span>
          </div>
          <h3 className="text-sm font-extrabold text-zinc-950 dark:text-zinc-50 flex items-center gap-1.5">
            {isLoading ? 'Đang tải nội dung...' : currentEvent?.name || 'Chưa có nội dung thi đấu'}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2 select-none md:justify-end flex-1">
          {events.length === 0 && !isLoading ? (
            <div className="px-3 py-1.5 rounded-lg border text-xs font-bold bg-amber-50 text-amber-700 border-amber-200">
              Tạo Đôi Nam, Đôi Nữ trong Nội dung thi đấu trước khi nhập đội
            </div>
          ) : (
            events.map((event: any) => {
              const isActive = event.id === currentEvent?.id;
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => setCurrentEvent(event.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                      : 'bg-zinc-50 dark:bg-zinc-850 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-650 dark:text-zinc-350 border-zinc-200 dark:border-zinc-800'
                  }`}
                >
                  <span className="truncate max-w-[160px]">{event.name}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
