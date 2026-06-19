import { z } from 'zod';

export const MatchSetModeSchema = z.enum(['single', 'best_of_3']);
export const EventFormatTypeSchema = z.enum(['round_robin_only', 'knockout_only', 'group_then_knockout']);
export const CompetitionTypeSchema = z.enum(['singles', 'doubles', 'team', 'individual_time', 'custom']);

export const ScoringConfigSchema = z.object({
  matchSetMode: MatchSetModeSchema.default('single'),
  numberOfSets: z.union([z.literal(1), z.literal(3)]).default(1),
  setsToWin: z.union([z.literal(1), z.literal(2)]).default(1),
  maxScore: z.number().int().min(1).default(15),
  capScore: z.number().int().min(1).default(17),
  winByTwo: z.boolean().default(true),
  allowDraw: z.boolean().default(false),
}).superRefine((config, ctx) => {
  if (config.matchSetMode === 'single' && (config.numberOfSets !== 1 || config.setsToWin !== 1)) {
    ctx.addIssue({
      code: 'custom',
      message: 'single mode must use numberOfSets=1 and setsToWin=1',
      path: ['matchSetMode'],
    });
  }

  if (config.matchSetMode === 'best_of_3' && (config.numberOfSets !== 3 || config.setsToWin !== 2)) {
    ctx.addIssue({
      code: 'custom',
      message: 'best_of_3 mode must use numberOfSets=3 and setsToWin=2',
      path: ['matchSetMode'],
    });
  }

  if (config.capScore < config.maxScore) {
    ctx.addIssue({
      code: 'custom',
      message: 'capScore must be greater than or equal to maxScore',
      path: ['capScore'],
    });
  }
});

export const RankingConfigSchema = z.object({
  pointsWin: z.number().int().min(0).default(2),
  pointsLoss: z.number().int().min(0).default(1),
  pointsDraw: z.number().int().min(0).optional(),
  tieBreakers: z.array(z.enum(['points', 'setDiff', 'pointDiff', 'pointsWon', 'headToHead', 'manual']))
    .default(['points', 'pointDiff', 'pointsWon', 'headToHead']),
  bestThirds: z.object({
    enabled: z.boolean().default(false),
    count: z.number().int().min(0).default(0),
    excludeBottomTeamResults: z.boolean().default(false),
  }).optional(),
});

export const MatchSetScoreSchema = z.object({
  setNumber: z.number().int().min(1),
  scoreA: z.number().int().min(0).max(100).nullable(),
  scoreB: z.number().int().min(0).max(100).nullable(),
});

// Schema for tournament creation
export const CreateTournamentSchema = z.object({
  id: z.string().min(1, 'ID tournament không được để trống').max(50, 'ID phải ngắn hơn 50 ký tự'),
  name: z.string().min(2, 'Tên giải đấu phải có ít nhất 2 ký tự').max(100, 'Tên giải đấu tối đa 100 ký tự'),
  organization: z.string().min(2, 'Đơn vị tổ chức phải có ít nhất 2 ký tự').max(100, 'Tối đa 100 ký tự'),
  location: z.string().min(2, 'Địa điểm phải có ít nhất 2 ký tự').max(200, 'Tối đa 200 ký tự'),
  date: z.string().min(1, 'Ngày tổ chức không được để trống'),
});

// Schema for event creation
export const CreateEventSchema = z.object({
  id: z.string().min(1, 'ID sự kiện không được để trống'),
  name: z.string().min(2, 'Tên sự kiện phải có ít nhất 2 ký tự').max(100, 'Tên sự kiện tối đa 100 ký tự'),
  sport_id: z.string().min(1).default('sport_pickleball'),
  competition_type: CompetitionTypeSchema.default('doubles'),
  format_type: EventFormatTypeSchema.default('group_then_knockout'),
  scoring_config: ScoringConfigSchema.optional(),
  ranking_config: RankingConfigSchema.optional(),
  settings: z.object({
    pointsPerMatch: z.number().int().min(1),
    goldDifferenceMax: z.number().int().min(0),
    maxTeamsPerGroup: z.number().int().min(2),
  }).optional(),
});

// Schema for team creation
export const CreateTeamSchema = z.object({
  name: z.string().min(2, 'Tên đội phải có ít nhất 2 ký tự').max(100, 'Tên đội tối đa 100 ký tự'),
  seed: z.union([z.string(), z.number()]).optional(),
});

// Schema for transferring ownership
export const TransferOwnerSchema = z.object({
  targetAccountId: z.string().uuid('ID tài khoản đích phải là UUID hợp lệ'),
  confirmationHash: z.string().min(4, 'Mã bảo mật xác nhận không hợp lệ'),
});

// Schema for entering a match score
export const ScoreEntrySchema = z.object({
  scoreA: z.number().int().min(0, 'Điểm không được nhỏ hơn 0').max(100, 'Điểm tối đa là 100'),
  scoreB: z.number().int().min(0, 'Điểm không được nhỏ hơn 0').max(100, 'Điểm tối đa là 100'),
  status: z.enum(['scheduled', 'completed']),
  matchSetMode: MatchSetModeSchema.optional(),
  matchSets: z.array(MatchSetScoreSchema).optional(),
});

// Schema for importing a list of teams
export const ImportTeamSchema = z.object({
  name: z.string().min(2, 'Tên đội phải có ít nhất 2 ký tự').max(100, 'Tên đội tối đa 100 ký tự'),
  seed: z.union([z.string(), z.number()]).optional(),
});

export const ImportTeamListSchema = z.object({
  teams: z.array(ImportTeamSchema).min(1, 'Danh sách nạp phải có ít nhất 1 đội'),
});

export type CreateTournamentInput = z.infer<typeof CreateTournamentSchema>;
export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type CreateTeamInput = z.infer<typeof CreateTeamSchema>;
export type TransferOwnerInput = z.infer<typeof TransferOwnerSchema>;
export type ScoreEntryInput = z.infer<typeof ScoreEntrySchema>;
export type ImportTeamListInput = z.infer<typeof ImportTeamListSchema>;
export type ScoringConfigInput = z.infer<typeof ScoringConfigSchema>;
export type RankingConfigInput = z.infer<typeof RankingConfigSchema>;
export type MatchSetScoreInput = z.infer<typeof MatchSetScoreSchema>;
