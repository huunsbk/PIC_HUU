import tournamentSnapshotHandler from './tournament/[slug].js';

export default async function handler(req, res) {
  return tournamentSnapshotHandler(req, res);
}
