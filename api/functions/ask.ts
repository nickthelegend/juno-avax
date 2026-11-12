import { bodyOf, cors, ipOf, send, type Req, type Res } from '../src/http.ts';
import { handleAsk } from '../src/ask.ts';
import { fujiClient } from '../src/pub.ts';

export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return send(res, { status: 405, body: { error: 'POST { question, coin? }' } });
  try {
    send(res, await handleAsk(await bodyOf(req), ipOf(req), process.env, fujiClient()));
  } catch (e) {
    send(res, { status: 500, body: { error: `Juno AI failed: ${(e as Error).message.split('\n')[0]}` } });
  }
}
