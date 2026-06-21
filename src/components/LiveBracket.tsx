import React from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { Match, EventData } from '../types';
import { getReadableTeamName, getReadableKoMatchName, getBracketDisplayName } from '../utils/tournamentEngine';
import { getResolvedTeamName, getSeedLabel } from '../utils/scoreDisplay';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

interface LiveBracketProps {
  koMatches: Match[];
  currentEvt: EventData;
}

const findFeedingMatches = (match: Match, koMatches: Match[]): [Match | null, Match | null] => {
  if (!match || !match.id) return [null, null];
  
  // Find matches where nextMatchId (or next_match_id) matches this node's ID
  const feeding = koMatches.filter(m => {
    const nextId = m.nextMatchId !== undefined ? m.nextMatchId : (m as any).next_match_id;
    return nextId === match.id;
  });

  const childA = feeding.find(m => {
    const slot = m.nextMatchSlot !== undefined ? m.nextMatchSlot : (m as any).next_match_slot;
    return slot === 'A' || slot === 'teamA';
  }) || null;

  const childB = feeding.find(m => {
    const slot = m.nextMatchSlot !== undefined ? m.nextMatchSlot : (m as any).next_match_slot;
    return slot === 'B' || slot === 'teamB';
  }) || null;

  return [childA, childB];
}

interface MatchNodeProps {
  match: Match;
  koMatches: Match[];
  currentEvt: EventData;
  isBronze?: boolean;
}

const MatchNode: React.FC<MatchNodeProps> = ({ match, koMatches, currentEvt, isBronze }) => {
  if (!match) return null;

  const [childA, childB] = isBronze ? [null, null] : findFeedingMatches(match, koMatches);
  const hasChildren = childA !== null || childB !== null;

  const teams = currentEvt.teams || {};
  const teamAName = getSeedLabel(match, 'A', getBracketDisplayName(match.teamAId || match.placeholderA, currentEvt.groups));
  const teamBName = getSeedLabel(match, 'B', getBracketDisplayName(match.teamBId || match.placeholderB, currentEvt.groups));
  const teamASubtitle = getResolvedTeamName(match, 'A', teams, match.teamAId);
  const teamBSubtitle = getResolvedTeamName(match, 'B', teams, match.teamBId);

  return (
    <div className="flex flex-row items-stretch">
      {hasChildren && (
        <div className="flex flex-col justify-around">
          <div className="relative flex flex-row items-center justify-end flex-1">
             <MatchNode match={childA as Match} koMatches={koMatches} currentEvt={currentEvt} />
             <div className="absolute right-0 top-1/2 w-6 h-[calc(50%_+_1px)] border-t-[2px] border-r-[2px] border-zinc-300 dark:border-zinc-700 rounded-tr-lg pointer-events-none translate-x-[100%] z-0"></div>
          </div>
          <div className="relative flex flex-row items-center justify-end flex-1">
             <MatchNode match={childB as Match} koMatches={koMatches} currentEvt={currentEvt} />
             <div className="absolute right-0 bottom-1/2 w-6 h-[calc(50%_+_1px)] border-b-[2px] border-r-[2px] border-zinc-300 dark:border-zinc-700 rounded-br-lg pointer-events-none translate-x-[100%] z-0"></div>
          </div>
        </div>
      )}
      
      <div className={`relative flex items-center shrink-0 pr-2 pb-2 ${hasChildren ? 'pl-6' : 'pl-2'} z-10`}>
        {hasChildren && <div className="absolute left-0 top-1/2 w-6 h-[2px] bg-zinc-300 dark:bg-zinc-700 pointer-events-none -mt-[1px]"></div>}
        
        {/* The Card */}
        <div className="w-[180px] p-2 bg-white dark:bg-zinc-950 border-[1.5px] border-zinc-200 dark:border-zinc-800 rounded-xl space-y-1 z-20 shadow-sm hover:border-orange-400/50 transition-colors">
          <div className="text-[9px] font-black tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 pb-[3px] mb-1 text-center whitespace-nowrap overflow-hidden text-ellipsis">
             {match.knockoutRoundName} - {getReadableKoMatchName(match.knockoutMatchId || '')}
          </div>
          <div className="flex justify-between items-center rounded-md px-1.5 py-1 bg-zinc-50 dark:bg-zinc-900">
             <span className={`text-[11px] font-bold truncate max-w-[120px] ${match.winnerId === match.teamAId ? 'text-blue-600 dark:text-blue-400 font-extrabold' : 'text-zinc-750 dark:text-zinc-300'}`}>
              {teamAName}
              {teamASubtitle && teamASubtitle !== teamAName && <span className="block text-[9px] text-zinc-500 truncate">{teamASubtitle}</span>}
             </span>
             <span className="font-mono text-[11px] font-black">{match.status === 'finished' ? match.scoreA : '-'}</span>
          </div>
          <div className="flex justify-between items-center rounded-md px-1.5 py-1 bg-zinc-50 dark:bg-zinc-900">
             <span className={`text-[11px] font-bold truncate max-w-[120px] ${match.winnerId === match.teamBId ? 'text-blue-600 dark:text-blue-400 font-extrabold' : 'text-zinc-750 dark:text-zinc-300'}`}>
              {teamBName}
              {teamBSubtitle && teamBSubtitle !== teamBName && <span className="block text-[9px] text-zinc-500 truncate">{teamBSubtitle}</span>}
             </span>
             <span className="font-mono text-[11px] font-black">{match.status === 'finished' ? match.scoreB : '-'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LiveBracket: React.FC<LiveBracketProps> = ({ koMatches, currentEvt }) => {
  if (koMatches.length === 0) {
    return <div className="py-20 text-center text-zinc-500 border border-dashed border-zinc-200 rounded-3xl bg-zinc-50/50">Chưa lập sơ đồ Knockout cho nội dung này.</div>;
  }

  // Find final match (no next match and not a bronze match)
  const finalMatch = koMatches.find(m => {
    const nextId = m.nextMatchId !== undefined ? m.nextMatchId : (m as any).next_match_id;
    const isBronze = m.knockoutRoundName?.includes('3') || m.knockoutRoundName?.includes('Hạng 3') || false;
    return !nextId && !isBronze;
  }) || koMatches[koMatches.length - 1];

  // Find bronze match
  const bronzeMatch = koMatches.find(m => {
    return m.knockoutRoundName?.includes('3') || m.knockoutRoundName?.includes('Hạng 3') || false;
  });

  return (
    <div className="bg-[#f8f9fa] dark:bg-zinc-900/50 rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden relative w-full h-full min-h-[600px]" style={{ width: '100%', height: '100%' }}>
      <TransformWrapper 
        initialScale={0.8} 
        minScale={0.2} 
        maxScale={2} 
        centerOnInit={true}
        wheel={{ step: 0.1 }}
      >
        {({ zoomIn, zoomOut, resetTransform, setTransform, state }) => (
          <React.Fragment>
            <div className="hidden md:flex absolute top-4 right-4 z-50 items-center gap-2 bg-white dark:bg-zinc-800 p-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-md">
              <button onClick={() => zoomOut()} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 pointer-events-auto transition-colors" title="Thu nhỏ">
                <ZoomOut size={18} />
              </button>
              <input 
                type="range" 
                min="0.2" max="2" step="0.05"
                value={state.scale}
                onChange={(e) => setTransform(state.positionX, state.positionY, parseFloat(e.target.value))}
                className="w-24 mx-1 accent-blue-500 cursor-pointer"
              />
              <button onClick={() => zoomIn()} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 pointer-events-auto transition-colors" title="Phóng to">
                <ZoomIn size={18} />
              </button>
              <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1"></div>
              <button onClick={() => resetTransform()} className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg text-zinc-600 dark:text-zinc-300 pointer-events-auto transition-colors" title="Vừa màn hình">
                <Maximize size={18} />
              </button>
            </div>
            <TransformComponent wrapperClass="w-full h-full" wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '3840px', height: '2160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="p-12 flex flex-col items-center justify-center w-full h-full">
                <div className="flex gap-12 items-center scale-150 transform origin-center">
                  <MatchNode match={finalMatch} koMatches={koMatches} currentEvt={currentEvt} />
                  
                  {bronzeMatch && (
                    <div className="flex flex-col justify-end">
                      <div className="pl-8 relative opacity-85 mt-20">
                         <div className="text-[10px] font-black text-amber-600/80 uppercase mb-2 absolute -top-4 left-10">Tranh Hạng 3</div>
                         <MatchNode match={bronzeMatch} koMatches={koMatches} currentEvt={currentEvt} isBronze={true} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TransformComponent>
          </React.Fragment>
        )}
      </TransformWrapper>
    </div>
  );
};
