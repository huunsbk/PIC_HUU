import accountHandler from './accounts/[id].js';
import resetHandler from './accounts/reset.js';

export default async function handler(req, res) {
  const accountId = String(req.query.id || '').trim();
  if (accountId === 'reset') return resetHandler(req, res);
  return accountHandler(req, res);
}
