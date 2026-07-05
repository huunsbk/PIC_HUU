import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  handleOptions,
  json,
} from '../_shared/admin-account.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions(req);

  return json(
    req,
    {
      error: 'Edge Function admin-delete-account đã bị vô hiệu hóa. Account admin production phải đi qua Vercel API canonical.',
      code: 'EDGE_ACCOUNT_DELETE_DISABLED',
    },
    410,
  );
});
