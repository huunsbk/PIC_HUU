import { secureTenantQuery, secureTenantInsert, secureTenantUpsert, secureTenantDelete } from './secureQuery';

// Repository pattern mapping tenant isolated primitives
export const repository = {
  events: {
    find: () => secureTenantQuery('events', 'id, name, tournament_id, tenant_id, settings, active_group_id, advance_selection_mode, manual_qualified_team_ids, created_at, deleted_at'),
    insert: (data: any) => secureTenantInsert('events', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('events', data, opts),
    delete: () => secureTenantDelete('events')
  },
  groups: {
    find: () => secureTenantQuery('groups', 'id, event_id, name, team_ids, tenant_id, created_at, deleted_at'),
    insert: (data: any) => secureTenantInsert('groups', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('groups', data, opts),
    delete: () => secureTenantDelete('groups')
  },
  teams: {
    find: () => secureTenantQuery('teams', 'id, event_id, name, group_id, seed, tenant_id, created_at, deleted_at'),
    insert: (data: any) => secureTenantInsert('teams', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('teams', data, opts),
    delete: () => secureTenantDelete('teams')
  },
  matches: {
    find: () => secureTenantQuery('matches', 'id, event_id, group_id, team_a_id, team_b_id, score_a, score_b, winner_id, status, round, knockout_round_name, knockout_match_id, next_match_id, next_match_slot, placeholder_a, placeholder_b, tenant_id, created_at, deleted_at'),
    insert: (data: any) => secureTenantInsert('matches', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('matches', data, opts),
    delete: () => secureTenantDelete('matches')
  },
  accounts: {
    find: () => secureTenantQuery('accounts', 'id, username, display_name, tenant_id, role, created_at'),
    // Admins insert via mapped edge cases, standard query proxy mapping below
  }
};
