import {StrictMode, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { supabase } from './supabaseClient';
import { useTournamentStore } from './store';
import './index.css';

const queryClient = new QueryClient();

function TournamentMetadataGate() {
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const [loadingTournamentId, setLoadingTournamentId] = useState<string | null>(null);
  const requestSequence = useRef(0);

  useLayoutEffect(() => {
    if (!activeTournamentId) {
      setLoadingTournamentId(null);
      return;
    }

    const requestId = ++requestSequence.current;
    let cancelled = false;
    setLoadingTournamentId(activeTournamentId);

    void (async () => {
      const { data, error } = await supabase
        .from('tournament')
        .select('id, name, organization, location, date, settings')
        .eq('id', activeTournamentId)
        .is('deleted_at', null)
        .maybeSingle();

      if (cancelled || requestId !== requestSequence.current) return;

      if (error) {
        console.warn('[TournamentMetadataGate] Không thể tải metadata giải đấu:', error.message);
        setLoadingTournamentId(null);
        return;
      }

      if (data) {
        const currentState = useTournamentStore.getState();
        if (currentState.activeTournamentId === activeTournamentId) {
          useTournamentStore.setState({
            tournament: {
              ...currentState.tournament,
              id: data.id,
              name: data.name ?? currentState.tournament.name,
              organization: data.organization ?? currentState.tournament.organization,
              location: data.location ?? '',
              date: data.date ?? '',
              settings: data.settings || currentState.tournament.settings,
            },
          });
        }
      }

      setLoadingTournamentId(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTournamentId]);

  if (loadingTournamentId === activeTournamentId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-center text-sm font-semibold text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
        Đang tải thông tin giải đấu...
      </div>
    );
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TournamentMetadataGate />
    </QueryClientProvider>
  </StrictMode>,
);
