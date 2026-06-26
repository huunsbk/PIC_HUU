import { supabase } from '../../supabaseClient';
import type {
  CompetitionType,
  EventFormatType,
  MatchSetMode,
  RankingConfig,
  ScoringConfig,
  SeedType,
} from '../../types';

export type JsonRecord = Record<string, unknown>;

export interface TournamentRpcResult extends JsonRecord {
  success?: boolean;
  event_id?: string;
  message?: string;
}

export interface TeamImportRow {
  name: string;
  seed?: SeedType;
}

export interface KnockoutCandidate {
  team_id: string;
  team_name: string;
  group_id?: string;
  group_name?: string;
  group_rank?: number;
  points?: number;
  score_diff?: number;
  set_diff?: number;
  point_diff?: number;
  source?: string;
  seed_label?: string;
  seed_source?: JsonRecord;
  suggested_seed?: number;
}

export interface ConfirmKnockoutTeamInput {
  team_id: string;
  seed: number;
  source?: string;
  source_group_id?: string;
  group_rank?: number;
  seed_label?: string;
  seed_source?: JsonRecord;
  resolved_team_id?: string;
}

export interface EventConfigInput {
  eventId: string;
  sportId: string;
  competitionType: CompetitionType;
  formatType: EventFormatType;
  scoringConfig: ScoringConfig;
  rankingConfig: RankingConfig;
}

export interface EventConfigResult extends TournamentRpcResult {
  sport_id?: string;
  format_type?: EventFormatType;
  competition_type?: CompetitionType;
  scoring_config?: ScoringConfig;
  ranking_config?: RankingConfig;
}

export interface CreateEventInput {
  tournamentId: string;
  name: string;
  sportId: string;
  competitionType: CompetitionType;
  formatType: EventFormatType;
  scoringConfig: ScoringConfig;
  rankingConfig: RankingConfig;
}

export interface EventAccessGrant {
  id: string;
  event_id: string;
  account_id: string;
  username: string;
  display_name: string | null;
  role_name: 'REFEREE' | 'EVENT_ADMIN' | string;
  permission: string;
  created_at?: string;
}

export interface EventAccessEligibleAccount {
  account_id: string;
  username: string;
  display_name: string | null;
  role_name: 'REFEREE' | 'EVENT_ADMIN' | string;
}

export interface EventAccessResult extends TournamentRpcResult {
  event?: {
    id: string;
    name: string;
    tenant_id: string;
    tournament_id: string;
  };
  grants: EventAccessGrant[];
  eligible_accounts: EventAccessEligibleAccount[];
}

const ERROR_TRANSLATIONS: Array<[RegExp, string]> = [
  [/UNAUTHENTICATED/i, 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.'],
  [/PERMISSION_DENIED|permission denied|not allowed/i, 'Bạn không có đủ quyền để thực hiện thao tác này.'],
  [/EVENT_NOT_FOUND/i, 'Không tìm thấy nội dung thi đấu. Vui lòng chọn lại nội dung thi đấu.'],
  [/MATCH_NOT_FOUND/i, 'Không tìm thấy trận đấu. Vui lòng tải lại dữ liệu.'],
  [/INVALID_CONTEXT/i, 'Sai ngữ cảnh dữ liệu. Vui lòng chọn đúng đơn vị, giải đấu và nội dung thi đấu.'],
  [/INVALID_EVENT_ID/i, 'ID nội dung thi đấu không hợp lệ. Vui lòng chọn nội dung thi đấu thật.'],
  [/Team name already exists/i, 'Tên đội đã tồn tại trong nội dung thi đấu này.'],
  [/Team count .* smaller than requested group count/i, 'Số đội ít hơn số bảng đã chọn. Vui lòng giảm số bảng hoặc nhập thêm đội.'],
  [/p_group_count must be between 1 and 32/i, 'Số bảng phải nằm trong khoảng từ 1 đến 32.'],
  [/Schedule already generated/i, 'Lịch đã được sinh. Vui lòng tạo lại lịch trước khi chuyển đội giữa bảng.'],
  [/Active knockout bracket already exists/i, 'Sơ đồ knockout đang tồn tại. Không thể tạo trùng bracket.'],
  [/GROUP_STAGE_INCOMPLETE/i, 'Vòng bảng chưa hoàn tất. Chỉ có thể xác nhận đội vào vòng trong khi mọi trận vòng bảng đã chốt kết quả.'],
  [/Match is not ready to finalize/i, 'Trận chưa đủ điều kiện chốt. Vui lòng lưu đủ séc thắng theo cấu hình trước.'],
  [/No saved set score found/i, 'Chưa có điểm séc nào được lưu cho trận này.'],
  [/Match participants are not resolved/i, 'Trận chưa đủ hai đội thi đấu. Vui lòng kiểm tra lại sơ đồ hoặc lịch đấu.'],
  [/No confirmed knockout teams found/i, 'Chưa có danh sách đội knockout đã xác nhận.'],
  [/p_bracket_size must be one of 4, 8, 16, 32/i, 'Quy mô bracket chỉ hỗ trợ 4, 8, 16 hoặc 32 đội.'],
  [/Selected team count .* exceeds bracket size/i, 'Số đội được chọn lớn hơn quy mô bracket.'],
  [/Duplicate team selected/i, 'Danh sách knockout có đội bị chọn trùng.'],
  [/Duplicate seed selected/i, 'Danh sách knockout có seed bị trùng.'],
  [/Invalid format_type/i, 'Thể thức thi đấu không hợp lệ.'],
  [/Invalid matchSetMode/i, 'Cấu hình số séc không hợp lệ.'],
  [/single mode requires/i, 'Cấu hình 1 séc phải dùng numberOfSets=1 và setsToWin=1.'],
  [/best_of_3 mode requires/i, 'Cấu hình best-of-3 phải dùng numberOfSets=3 và setsToWin=2.'],
  [/Account role must be REFEREE or EVENT_ADMIN/i, 'Chỉ có thể cấp quyền cho tài khoản REFEREE hoặc EVENT_ADMIN.'],
  [/Cross-tenant event access grant/i, 'Không thể cấp quyền cho tài khoản thuộc đơn vị khác.'],
  [/Invalid event permission/i, 'Quyền theo nội dung thi đấu không hợp lệ.'],
  [/REFEREE can only receive enter_scores/i, 'Trọng tài chỉ được cấp quyền nhập điểm.'],
];

export function normalizeRpcError(error: unknown): Error {
  const fallback = 'Thao tác không thành công. Vui lòng thử lại hoặc kiểm tra quyền truy cập.';
  const message =
    typeof error === 'object' && error && 'message' in error
      ? String((error as { message?: unknown }).message || fallback)
      : String(error || fallback);

  const translated = ERROR_TRANSLATIONS.find(([pattern]) => pattern.test(message));
  return new Error(translated?.[1] || message);
}

async function callRpc<T>(name: string, params: JsonRecord): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw normalizeRpcError(error);
  return data as T;
}

export const tournamentRpc = {
  listEventsByTournament(tournamentId: string) {
    return callRpc<any[]>('list_events_by_tournament_v1', {
      p_tournament_id: tournamentId,
    });
  },

  createEvent(input: CreateEventInput) {
    return callRpc<TournamentRpcResult & { event?: any }>('create_event_v1', {
      p_tournament_id: input.tournamentId,
      p_name: input.name,
      p_sport_id: input.sportId,
      p_competition_type: input.competitionType,
      p_format_type: input.formatType,
      p_scoring_config: input.scoringConfig,
      p_ranking_config: input.rankingConfig,
    });
  },

  updateEventStatus(event: any, status: string) {
    return callRpc<TournamentRpcResult & { event?: any }>('update_event_v1', {
      p_event_id: event.id,
      p_name: event.name,
      p_sport_id: event.sport_id || 'sport_pickleball',
      p_competition_type: event.competition_type || 'doubles',
      p_format_type: event.format_type || 'group_then_knockout',
      p_scoring_config: event.scoring_config || buildScoringConfig('single'),
      p_ranking_config: event.ranking_config || {},
      p_status: status,
    });
  },

  archiveEvent(eventId: string) {
    return callRpc<TournamentRpcResult & { event?: any }>('archive_event_v1', {
      p_event_id: eventId,
    });
  },

  restoreEvent(eventId: string) {
    return callRpc<TournamentRpcResult & { event?: any }>('restore_event_v1', {
      p_event_id: eventId,
    });
  },

  listEventAccess(eventId: string) {
    return callRpc<EventAccessResult>('list_event_access_v1', {
      p_event_id: eventId,
    });
  },

  grantEventAccess(eventId: string, accountId: string, permission = 'enter_scores') {
    return callRpc<TournamentRpcResult & { grant_id?: string }>('grant_event_access_v1', {
      p_event_id: eventId,
      p_account_id: accountId,
      p_permission: permission,
    });
  },

  revokeEventAccess(eventId: string, accountId: string, permission = 'enter_scores') {
    return callRpc<TournamentRpcResult & { revoked_rows?: number }>('revoke_event_access_v1', {
      p_event_id: eventId,
      p_account_id: accountId,
      p_permission: permission,
    });
  },

  updateEventConfig(input: EventConfigInput) {
    return callRpc<EventConfigResult>('update_event_config_v1', {
      p_event_id: input.eventId,
      p_sport_id: input.sportId,
      p_competition_type: input.competitionType,
      p_format_type: input.formatType,
      p_scoring_config: input.scoringConfig,
      p_ranking_config: input.rankingConfig,
    });
  },

  createTeam(eventId: string, name: string, seed: SeedType = 'none') {
    return callRpc<TournamentRpcResult>('create_team_v1', {
      p_event_id: eventId,
      p_name: name,
      p_seed: seed,
    });
  },

  updateTeam(teamId: string, updates: { name?: string; seed?: SeedType }) {
    return callRpc<TournamentRpcResult>('update_team_v1', {
      p_team_id: teamId,
      p_name: updates.name ?? null,
      p_seed: updates.seed ?? null,
    });
  },

  archiveTeam(teamId: string) {
    return callRpc<TournamentRpcResult>('archive_team_v1', {
      p_team_id: teamId,
    });
  },

  importTeams(eventId: string, teams: TeamImportRow[]) {
    return callRpc<TournamentRpcResult & { imported_count?: number }>('import_teams_v1', {
      p_event_id: eventId,
      p_teams: teams,
    });
  },

  setupGroups(eventId: string, groupCount: number, mode: 'balanced' | 'random' | 'seed' | 'empty' = 'balanced') {
    return callRpc<TournamentRpcResult & { group_count?: number; num_groups?: number; assigned_teams?: number }>('setup_groups_v4', {
      p_event_id: eventId,
      p_group_count: groupCount,
      p_mode: mode,
    });
  },

  assignTeamToGroup(teamId: string, groupId: string | null, beforeTeamId?: string | null, force = false) {
    return callRpc<TournamentRpcResult & { requires_regenerate?: boolean }>('assign_team_to_group_v2', {
      p_team_id: teamId,
      p_group_id: groupId,
      p_before_team_id: beforeTeamId ?? null,
      p_force: force,
    });
  },

  dissolveGroups(eventId: string) {
    return callRpc<TournamentRpcResult>('dissolve_groups_v4', {
      p_event_id: eventId,
    });
  },

  generateSchedule(eventId: string) {
    return callRpc<TournamentRpcResult & { match_count?: number; created_matches?: number }>('generate_schedule_v1', {
      p_event_id: eventId,
    });
  },

  updateMatchScore(matchId: string, scoreA: number, scoreB: number) {
    return callRpc<TournamentRpcResult & { match_id?: string; winner_id?: string | null }>('update_match_score_v1', {
      p_match_id: matchId,
      p_score_a: scoreA,
      p_score_b: scoreB,
    });
  },

  updateMatchSetScore(matchId: string, setNumber: 1 | 2 | 3, scoreA: number, scoreB: number) {
    return callRpc<TournamentRpcResult & { match_id?: string; match_status?: string; winner_id?: string | null }>('update_match_set_score_v1', {
      p_match_id: matchId,
      p_set_number: setNumber,
      p_score_a: scoreA,
      p_score_b: scoreB,
    });
  },

  finalizeMatchScore(matchId: string) {
    return callRpc<TournamentRpcResult & { match_id?: string; status?: string; winner_id?: string | null; score_a?: number; score_b?: number }>('finalize_match_score_v1', {
      p_match_id: matchId,
    });
  },

  resetMatchScore(matchId: string) {
    return callRpc<TournamentRpcResult & { match_id?: string; status?: string }>('reset_match_score_v1', {
      p_match_id: matchId,
    });
  },

  prepareKnockoutCandidates(
    eventId: string,
    topPerGroup = 2,
    bestThirdCount = 0,
    excludeBottomResults = false,
  ) {
    return callRpc<TournamentRpcResult & { candidates?: KnockoutCandidate[]; candidate_count?: number }>('prepare_knockout_candidates_v1', {
      p_event_id: eventId,
      p_top_per_group: topPerGroup,
      p_best_third_count: bestThirdCount,
      p_exclude_bottom_results: excludeBottomResults,
    });
  },

  confirmKnockoutTeams(
    eventId: string,
    teams: ConfirmKnockoutTeamInput[],
    bracketSize: 4 | 8 | 16 | 32,
    overrideReason?: string | null,
  ) {
    return callRpc<TournamentRpcResult & { selected_count?: number; bye_count?: number; teams?: ConfirmKnockoutTeamInput[] }>('confirm_knockout_teams_v1', {
      p_event_id: eventId,
      p_teams: teams,
      p_bracket_size: bracketSize,
      p_override_reason: overrideReason || null,
    });
  },

  generateKnockoutBracket(eventId: string) {
    return callRpc<TournamentRpcResult & { created_matches?: number }>('generate_knockout_bracket_v1', {
      p_event_id: eventId,
    });
  },

  clearKnockoutBracket(eventId: string) {
    return callRpc<TournamentRpcResult & { deleted_matches?: number; deleted_match_sets?: number }>('clear_knockout_bracket_v1', {
      p_event_id: eventId,
    });
  },
};

export function buildScoringConfig(mode: MatchSetMode, maxScore = 15, capScore = 17): ScoringConfig {
  return {
    matchSetMode: mode,
    numberOfSets: mode === 'best_of_3' ? 3 : 1,
    setsToWin: mode === 'best_of_3' ? 2 : 1,
    maxScore,
    capScore,
    winByTwo: true,
    allowDraw: false,
  };
}
