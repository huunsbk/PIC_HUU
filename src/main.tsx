import {StrictMode, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { supabase } from './supabaseClient';
import { useTournamentStore } from './store';
import './index.css';

const queryClient = new QueryClient();

function TournamentMetadataHydrator() {
  const activeTournamentId = useTournamentStore((state) => state.activeTournamentId);
  const authBootstrapComplete = useTournamentStore((state) => state.authBootstrapComplete);
  const userRole = useTournamentStore((state) => state.userRole);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!authBootstrapComplete || userRole === 'guest' || !activeTournamentId) return;

    const requestId = ++requestSequence.current;
    let cancelled = false;
    const baseline = useTournamentStore.getState().tournament;

    void (async () => {
      const { data, error } = await supabase
        .from('tournament')
        .select('id, name, location, date')
        .eq('id', activeTournamentId)
        .is('deleted_at', null)
        .maybeSingle();

      if (cancelled || requestId !== requestSequence.current) return;

      if (error) {
        console.warn('[TournamentMetadataHydrator] Không thể tải metadata giải đấu:', error.message);
        return;
      }

      if (!data) return;

      const currentState = useTournamentStore.getState();
      const currentTournament = currentState.tournament;
      const contextStillMatches = currentState.activeTournamentId === activeTournamentId;
      const userHasNotEditedMetadata =
        currentTournament.id === baseline.id &&
        currentTournament.name === baseline.name &&
        currentTournament.location === baseline.location &&
        currentTournament.date === baseline.date;

      if (!contextStillMatches || !userHasNotEditedMetadata) return;

      useTournamentStore.setState({
        tournament: {
          ...currentTournament,
          id: data.id,
          name: data.name ?? currentTournament.name,
          location: data.location ?? '',
          date: data.date ?? '',
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTournamentId, authBootstrapComplete, userRole]);

  return null;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TournamentMetadataHydrator />
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
