import type { EventFormatType, CompetitionType, Match, MatchRoundKey, MatchSetMode, RankingConfig, RoundScoringRule, ScoringConfig, Sport, TournamentSettings } from '../types';
import { buildScoringConfig } from './api/tournamentRpc';

const numberOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function buildDefaultEventScoringConfig(settings?: Partial<TournamentSettings>, mode: MatchSetMode = 'single'): ScoringConfig {
  const config = buildScoringConfig(
    mode,
    numberOr(settings?.maxScore, 15),
    numberOr(settings?.capScore, 17),
  );
  return {
    ...config,
    roundSetModes: buildDefaultRoundSetModes(mode),
    roundScoringRules: buildDefaultRoundScoringRules(mode, config.maxScore, config.capScore),
  };
}

export function buildSportEventScoringConfig(
  sport: Sport | undefined,
  tournamentSettings?: Partial<TournamentSettings>,
  requestedMode?: MatchSetMode,
): ScoringConfig {
  const sportDefaults = sport?.default_settings || {};
  const useTournamentDefaults = !sport || sport.id === 'sport_pickleball';
  const mode = requestedMode || (sportDefaults.matchSetMode === 'best_of_3' ? 'best_of_3' : 'single');
  const maxScore = useTournamentDefaults
    ? numberOr(tournamentSettings?.maxScore, numberOr(sportDefaults.maxScore, 15))
    : numberOr(sportDefaults.maxScore, 15);
  const capScore = useTournamentDefaults
    ? numberOr(tournamentSettings?.capScore, numberOr(sportDefaults.capScore, maxScore))
    : numberOr(sportDefaults.capScore, maxScore);
  const config = buildDefaultEventScoringConfig({ maxScore, capScore }, mode);

  return {
    ...config,
    winByTwo: sportDefaults.winByTwo !== false,
    allowDraw: sportDefaults.allowDraw === true,
  };
}

export const ROUND_SET_MODE_LABELS: Record<MatchRoundKey, string> = {
  group: 'Vòng bảng',
  r32: 'Vòng 1/32',
  r16: 'Vòng 1/16',
  r8: 'Vòng 1/8',
  qf: 'Tứ kết',
  sf: 'Bán kết',
  final: 'Chung kết',
};

export const ROUND_SET_MODE_KEYS = Object.keys(ROUND_SET_MODE_LABELS) as MatchRoundKey[];

export function buildDefaultRoundSetModes(mode: MatchSetMode = 'single'): Record<MatchRoundKey, MatchSetMode> {
  return ROUND_SET_MODE_KEYS.reduce((acc, key) => {
    acc[key] = mode;
    return acc;
  }, {} as Record<MatchRoundKey, MatchSetMode>);
}

export function buildDefaultRoundScoringRules(
  mode: MatchSetMode = 'single',
  maxScore = 15,
  capScore = 17,
): Record<MatchRoundKey, RoundScoringRule> {
  return ROUND_SET_MODE_KEYS.reduce((acc, key) => {
    acc[key] = {
      matchSetMode: mode,
      maxScore: numberOr(maxScore, 15),
      capScore: numberOr(capScore, numberOr(maxScore, 15)),
    };
    return acc;
  }, {} as Record<MatchRoundKey, RoundScoringRule>);
}

export function normalizeRoundSetModes(scoringConfig?: Partial<ScoringConfig> | Record<string, any>): Record<MatchRoundKey, MatchSetMode> {
  const fallback = (scoringConfig?.matchSetMode === 'best_of_3' ? 'best_of_3' : 'single') as MatchSetMode;
  const raw = (scoringConfig as any)?.roundSetModes || {};
  const rawRules = (scoringConfig as any)?.roundScoringRules || {};
  return ROUND_SET_MODE_KEYS.reduce((acc, key) => {
    const ruleMode = rawRules[key]?.matchSetMode;
    acc[key] = ruleMode === 'best_of_3' || raw[key] === 'best_of_3' ? 'best_of_3' : fallback;
    return acc;
  }, {} as Record<MatchRoundKey, MatchSetMode>);
}

export function normalizeRoundScoringRules(scoringConfig?: Partial<ScoringConfig> | Record<string, any>): Record<MatchRoundKey, RoundScoringRule> {
  const fallbackMode = (scoringConfig?.matchSetMode === 'best_of_3' ? 'best_of_3' : 'single') as MatchSetMode;
  const fallbackMaxScore = numberOr((scoringConfig as any)?.maxScore, 15);
  const fallbackCapScore = numberOr((scoringConfig as any)?.capScore, fallbackMaxScore);
  const rawModes = (scoringConfig as any)?.roundSetModes || {};
  const rawRules = (scoringConfig as any)?.roundScoringRules || {};

  return ROUND_SET_MODE_KEYS.reduce((acc, key) => {
    const rawRule = rawRules[key] || {};
    const mode = rawRule.matchSetMode === 'best_of_3' || rawModes[key] === 'best_of_3' ? 'best_of_3' : fallbackMode;
    const maxScore = Math.max(1, numberOr(rawRule.maxScore, fallbackMaxScore));
    const capScore = Math.max(maxScore, numberOr(rawRule.capScore, fallbackCapScore));
    acc[key] = { matchSetMode: mode, maxScore, capScore };
    return acc;
  }, {} as Record<MatchRoundKey, RoundScoringRule>);
}

export function getMatchRoundKey(match: Pick<Match, 'groupId' | 'knockoutRoundName' | 'knockoutMatchId'>): MatchRoundKey {
  if (match.groupId !== 'knockout') return 'group';
  const code = String(match.knockoutMatchId || '').toUpperCase();
  const name = String(match.knockoutRoundName || '').toLowerCase();

  if (code.startsWith('R32') || name.includes('32') || name.includes('1/32')) return 'r32';
  if (code.startsWith('R16') || name.includes('16') || name.includes('1/16')) return 'r16';
  if (code.startsWith('R8') || name.includes('vòng 8') || name.includes('vong 8') || name.includes('1/8')) return 'r8';
  if (code.startsWith('QF') || name.includes('tứ kết') || name.includes('tu ket')) return 'qf';
  if (code.startsWith('SF') || name.includes('bán kết') || name.includes('ban ket')) return 'sf';
  if (code === 'F' || code === 'Y-F' || code.startsWith('F-') || name.includes('chung kết') || name.includes('chung ket')) return 'final';
  return 'r16';
}

export function getMatchSetModeForMatch(
  match: Pick<Match, 'groupId' | 'knockoutRoundName' | 'knockoutMatchId'>,
  scoringConfig?: Partial<ScoringConfig> | Record<string, any>,
): MatchSetMode {
  return normalizeRoundScoringRules(scoringConfig)[getMatchRoundKey(match)]?.matchSetMode || 'single';
}

export function getMaxSetCountForMatch(
  match: Pick<Match, 'groupId' | 'knockoutRoundName' | 'knockoutMatchId'>,
  scoringConfig?: Partial<ScoringConfig> | Record<string, any>,
) {
  return getMatchSetModeForMatch(match, scoringConfig) === 'best_of_3' ? 3 : 1;
}

export function getMatchScoringRuleForMatch(
  match: Pick<Match, 'groupId' | 'knockoutRoundName' | 'knockoutMatchId'>,
  scoringConfig?: Partial<ScoringConfig> | Record<string, any>,
): RoundScoringRule {
  return normalizeRoundScoringRules(scoringConfig)[getMatchRoundKey(match)];
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

export function buildSportEventRankingConfig(
  sport: Sport | undefined,
  tournamentSettings?: Partial<TournamentSettings>,
  overrides: Record<string, unknown> = {},
): RankingConfig & Record<string, unknown> {
  const defaults = sport?.default_ranking_config || {};
  const useTournamentDefaults = !sport || sport.id === 'sport_pickleball';
  const settings = useTournamentDefaults
    ? tournamentSettings
    : {
        winPoint: numberOr(defaults.pointsWin, 2),
        lossPoint: numberOr(defaults.pointsLoss, 0),
      };

  return {
    ...buildDefaultEventRankingConfig(settings, {
      ...overrides,
      pointsWin: overrides.pointsWin ?? defaults.pointsWin,
      pointsLoss: overrides.pointsLoss ?? defaults.pointsLoss,
      pointsDraw: overrides.pointsDraw ?? defaults.pointsDraw,
    }),
    tieBreakers: defaults.tieBreakers || ['points', 'setDiff', 'pointDiff', 'pointsWon', 'headToHead'],
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
    roundSetModes: normalizeRoundSetModes(scoring),
    roundScoringRules: normalizeRoundScoringRules(scoring),
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
