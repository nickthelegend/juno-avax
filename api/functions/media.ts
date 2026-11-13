import { cors, send, type Req, type Res } from '../src/http.ts';
import { fujiClient } from '../src/pub.ts';
import { MediaError, readImage } from '../src/media.ts';

/** GET /api/media?tx=0x…: the photo a post stored on Fuji with JunoMedia.store(bytes), read back from the chain. */
export default async function handler(req: Req, res: Res) {
  if (cors(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://x');
  const tx = req.query?.tx ?? url.searchParams.get('tx') ?? '';
  try {
    const img = await readImage(fujiClient(), tx);
    res.statusCode = 200;
    res.setHeader('content-type', img.type);
    res.setHeader('content-length', String(img.bytes.length));
    // A confirmed transaction never changes, so the image is immutable.
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('x-juno-stored-by', img.by);
    res.setHeader('x-juno-keccak256', img.hash);
    res.end(Buffer.from(img.bytes));
  } catch (e) {
    const status = e instanceof MediaError ? e.status : 502;
    send(res, { status, body: { error: status === 502 ? `Could not read Fuji: ${(e as Error).message.split('\n')[0]}` : (e as Error).message } });
  }
}
