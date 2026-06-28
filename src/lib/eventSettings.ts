import type { EventFormatType, CompetitionType, MatchSetMode, RankingConfig, ScoringConfig, TournamentSettings } from '../types';
import { buildScoringConfig } from './api/tournamentRpc';

const numberOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function buildDefaultEventScoringConfig(settings?: Partial<TournamentSettings>, mode: MatchSetMode = 'single'): ScoringConfig {
  return buildScoringConfig(
    mode,
    numberOr(settings?.maxScore, 15),
    numberOr(settings?.capScore, 17),
  );
}

export function buildDefaultEventRankingConfig(settings?: Partial<TournamentSettings>, overrides: Record<string, unknown> = {}): RankingConfig & Record<string, unknown> {
  const bestThirdCount = numberOr(overrides.best_third_count ?? settings?.numBestThirds, 0);
  const topPerGroup = numberOr(overrides.top_per_group ?? settings?.advanceCount, 2);

  return {
    pointsWin: numberOr(overrides.pointsWin ?? settings?.winPoint, 2),
    pointsLoss: numberOr(overrides.pointsLoss ?? settings?.lossPoint, 1),
    pointsDraw: numberOr(overrides.pointsDraw, 1),
    top_per_group: topPerGroup,
    best_third_count: bestThirdCount,
    exclude_bottom_results: Boolean(overrides.exclude_bottom_results),
    groupCount: numberOr(overrides.groupCount, 4),
    schedule_config: {
      court_count: numberOr((overrides.schedule_config as any)?.court_count, 1),
      scheduling_mode: (overrides.schedule_config as any)?.scheduling_mode || 'round_robin_balanced',
    },
    bestThirds: {
      enabled: bestThirdCount > 0,
      count: bestThirdCount,
      excludeBottomTeamResults: Boolean(overrides.exclude_bottom_results),
    },
  };
}

export function getEffectiveTournamentSettings(event: any, tournamentSettings?: Partial<TournamentSettings>): TournamentSettings {
  const scoring = event?.scoring_config || {};
  const ranking = event?.ranking_config || {};
  const bestThirds = ranking.bestThirds || {};

  return {
    winPoint: numberOr(ranking.pointsWin ?? ranking.winPoint, numberOr(tournamentSettings?.winPoint, 2)),
    lossPoint: numberOr(ranking.pointsLoss ?? ranking.lossPoint, numberOr(tournamentSettings?.lossPoint, 1)),
    maxScore: numberOr(scoring.maxScore, numberOr(tournamentSettings?.maxScore, 15)),
    capScore: numberOr(scoring.capScore, numberOr(tournamentSettings?.capScore, 17)),
    advanceCount: numberOr(ranking.top_per_group ?? ranking.advanceCount, numberOr(tournamentSettings?.advanceCount, 2)),
    numBestThirds: numberOr(ranking.best_third_count ?? ranking.numBestThirds ?? bestThirds.count, numberOr(tournamentSettings?.numBestThirds, 0)),
  };
}

export function getEventConfigDefaults(event: any, tournamentSettings?: Partial<TournamentSettings>) {
  const effectiveSettings = getEffectiveTournamentSettings(event, tournamentSettings);
  const scoring = event?.scoring_config || {};
  const ranking = event?.ranking_config || {};
  const scheduleConfig = ranking.schedule_config || {};

  return {
    sportId: String(event?.sport_id || 'sport_pickleball'),
    competitionType: (event?.competition_type || 'doubles') as CompetitionType,
    formatType: (event?.format_type || 'group_then_knockout') as EventFormatType,
    matchSetMode: (scoring.matchSetMode || 'single') as MatchSetMode,
    maxScore: effectiveSettings.maxScore,
    capScore: effectiveSettings.capScore,
    winPoint: effectiveSettings.winPoint,
    lossPoint: effectiveSettings.lossPoint,
    topPerGroup: effectiveSettings.advanceCount,
    bestThirdCount: effectiveSettings.numBestThirds || 0,
    excludeBottomResults: Boolean(ranking.exclude_bottom_results || ranking.bestThirds?.excludeBottomTeamResults),
    groupCount: numberOr(ranking.groupCount, 4),
    courtCount: numberOr(scheduleConfig.court_count, 1),
  };
}
