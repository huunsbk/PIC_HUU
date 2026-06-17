import { z } from 'zod';

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
