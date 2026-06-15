import { secureTenantQuery, secureTenantInsert, secureTenantUpsert, secureTenantDelete } from './secureQuery';

// Repository pattern mapping tenant isolated primitives
export const repository = {
  events: {
    find: () => secureTenantQuery('events'),
    insert: (data: any) => secureTenantInsert('events', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('events', data, opts),
    delete: () => secureTenantDelete('events')
  },
  groups: {
    find: () => secureTenantQuery('groups'),
    insert: (data: any) => secureTenantInsert('groups', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('groups', data, opts),
    delete: () => secureTenantDelete('groups')
  },
  teams: {
    find: () => secureTenantQuery('teams'),
    insert: (data: any) => secureTenantInsert('teams', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('teams', data, opts),
    delete: () => secureTenantDelete('teams')
  },
  matches: {
    find: () => secureTenantQuery('matches'),
    insert: (data: any) => secureTenantInsert('matches', data),
    upsert: (data: any, opts?: any) => secureTenantUpsert('matches', data, opts),
    delete: () => secureTenantDelete('matches')
  },
  accounts: {
    find: () => secureTenantQuery('accounts'),
    // Admins insert via mapped edge cases, standard query proxy mapping below
  }
};
