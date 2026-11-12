/**
 * Juno AI client. The agent runs on Juno's API (claude-haiku-5-5; the key stays on the server) with read-only tools
 * over live Fuji. No wallet is needed to ask.
 */
import { API } from "./gas";

export type AiTool = { name: string; label: string };
export type AiAnswer = { id: string; answer: string; tools: AiTool[]; at: number; model: string; ms: number };

export async function askJuno(question: string, coin: string | null): Promise<AiAnswer> {
  let r: Response;
  try {
    r = await fetch(`${API}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, coin }) });
  } catch (e) {
    throw new Error(`Juno AI did not answer (${(e as Error).message}).`);
  }
  const body = (await r.json().catch(() => ({ error: `Juno AI answered ${r.status}` }))) as Partial<AiAnswer> & { error?: string };
  if (!r.ok || !body.answer) throw new Error(body.error ?? `Juno AI answered ${r.status}`);
  return body as AiAnswer;
}
