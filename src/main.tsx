import {StrictMode, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { supabase } from './supabaseClient';
import { useTournamentStore } from './store';
import './index.css';

const queryClient = new QueryClient();

function settingsValueChanged(currentValue: unknown, nextValue: unknown) {
  try {
    return JSON.stringify(currentValue) !== JSON.stringify(nextValue);
  } catch {
    return currentValue !== nextValue;
  }
}

function installTournamentSettingsRpcAdapter() {
  useTournamentStore.setState({
    updateSettings: async (settingsPatch: any) => {
      const state = useTournamentStore.getState();
      if (state.userRole === 'guest') return;

      const targetTournamentId = state.tournament.id || state.activeTournamentId;
      if (!targetTournamentId) {
        throw new Error('Chưa xác định giải đấu cần cập nhật cấu hình.');
      }

      const currentSettings = (state.tournament.settings || {}) as Record<string, unknown>;
      const incomingSettings = (settingsPatch || {}) as Record<string, unknown>;
      const changedPatch = Object.fromEntries(
        Object.entries(incomingSettings).filter(([key, value]) =>
          settingsValueChanged(currentSettings[key], value)
        )
      );

      if (Object.keys(changedPatch).length === 0) return;

      const { data, error } = await supabase.rpc('update_tournament_settings_v1', {
        p_tournament_id: targetTournamentId,
        p_settings_patch: changedPatch,
      });

      if (error) throw error;
      if (!data) {
        throw new Error('Không nhận được cấu hình giải đấu sau khi cập nhật.');
      }

      const latestState = useTournamentStore.getState();
      const stillSameTournament =
        latestState.tournament.id === targetTournamentId ||
        latestState.activeTournamentId === targetTournamentId;

      if (!stillSameTournament) return;

      useTournamentStore.setState({
        tournament: {
          ...latestState.tournament,
          id: String(data.id || targetTournamentId),
          name: data.name ?? latestState.tournament.name,
          organization: data.organization ?? latestState.tournament.organization,
          location: data.location ?? latestState.tournament.location,
          date: data.date ?? latestState.tournament.date,
          settings: data.settings || {
            ...latestState.tournament.settings,
            ...changedPatch,
          },
        },
        currentEventId: data.current_event_id || latestState.currentEventId,
      });

      latestState.addLog?.(
        'Cấu hình Giải',
        `Cập nhật cấu hình giải đấu: ${Object.keys(changedPatch).join(', ')}.`
      );
    },
  } as any);
}

installTournamentSettingsRpcAdapter();

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
        .select('id, name, location, date, settings')
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
      const userHasNotEditedSettings = currentTournament.settings === baseline.settings;

      if (!contextStillMatches || !userHasNotEditedMetadata) return;

      useTournamentStore.setState({
        tournament: {
          ...currentTournament,
          id: data.id,
          name: data.name ?? currentTournament.name,
          location: data.location ?? '',
          date: data.date ?? '',
          settings: userHasNotEditedSettings
            ? (data.settings || currentTournament.settings)
            : currentTournament.settings,
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