import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import styled from "styled-components/native";
import Svg, { Path, Rect } from "react-native-svg";
import type { Address } from "viem";
import { postAbi } from "@juno/sdk";
import type { Keypair } from "@juno/sdk/eerc";

import { CoinArt, Identicon } from "../components/art";
import { Object3D } from "../components/art3d";
import { Handle } from "../components/Handle";
import { Tappable } from "../components/Press";
import { Body, Button, Caption, ChevronLeft, ExternalGlyph, Label, Placeholder, Row, Segmented, Skeleton } from "../components/kit";
import { fujiClient } from "../lib/api";
import { EXPLORER_NAME, explorer, sameAddress } from "../lib/chain";
import { since } from "../lib/format";
import { browserProver, warmProver } from "../lib/prover";
import { useFeedRevision } from "../lib/refresh";
import { useApi } from "../lib/useApi";
import {
  audit, checkKey, isAuditorKey, loadVault, myBags, openKey, registerStep, sendStep, shieldSteps, unshieldStep, VAULT,
  type MyBag, type VaultMove, type VaultSnapshot,
} from "../lib/vault";
import { useWallet, type SendProgress } from "../lib/wallet";
import { theme } from "../theme";

/**
 * Hide your bag.
 *
 * Every Juno post coin is a public ERC-20, so anyone can read who holds how
 * much — which is exactly what whale-watchers and copy-trading bots do. This
 * screen moves a holder's coins into the Juno eERC vault (Ava Labs'
 * EncryptedERC in converter mode) and back.
 *
 * The three tabs are the same chain state seen by three people: the public
 * (what Snowtrace shows), the holder (decrypted on this device after one
 * signature), and the auditor (whose key every proof must encrypt to).
 * What stays public is said plainly: shielding and unshielding amounts are
 * ERC-20 transfers; only what happens inside the vault is hidden.
 */
type View3 = "public" | "yours" | "auditor";
const TABS = [
  { id: "public" as const, label: "Public view" },
  { id: "yours" as const, label: "Your bag" },
  { id: "auditor" as const, label: "Auditor" },
];

export default function VaultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ coin?: string; view?: string; to?: string }>();
  const [view, setView] = useState<View3>(params.view === "auditor" ? "auditor" : params.view === "yours" || params.coin ? "yours" : "public");
  const revision = useFeedRevision();
  const [tick, setTick] = useState(0);
  const snapshot = useApi(() => loadVault(), [revision, tick]);

  useEffect(() => {
    warmProver();
  }, []);

  if (!VAULT) {
    return (
      <Page edges={["top"]}>
        <Placeholder art="warning" title="Setup required: eERC vault" detail="No vault address in deployments/fuji.json → eerc. Run scripts/eerc/fuji.ts deploy." />
      </Page>
    );
  }

  return (
    <Page edges={["top"]}>
      <Nav>
        <Back onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/social" as never))} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft />
        </Back>
        <NavTitle>Private bags</NavTitle>
        <View style={{ width: 40 }} />
      </Nav>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={snapshot.refreshing} onRefresh={snapshot.refresh} tintColor={theme.colors.muted} />}
      >
        <Hero snapshot={snapshot.data} />
        <Pad>
          <Segmented items={TABS} value={view} onChange={setView} />
        </Pad>
        {snapshot.loading && !snapshot.data ? (
          <Pad style={{ gap: 12, marginTop: 16 }}>
            <Skeleton h={76} round={18} />
            <Skeleton h={76} round={18} />
            <Skeleton h={180} round={18} />
          </Pad>
        ) : snapshot.error || !snapshot.data ? (
          <Placeholder
            art="warning"
            title="Could not read the vault"
            detail={snapshot.error ?? "The Fuji endpoints did not answer."}
            action={<Button label="Try again" onPress={snapshot.refresh} />}
          />
        ) : view === "public" ? (
          <PublicView data={snapshot.data} onOpen={(coin) => router.push(`/coin/${coin}` as never)} />
        ) : view === "yours" ? (
          <YourView data={snapshot.data} preset={params.coin ?? null} presetTo={params.to ?? null} onChanged={() => setTick((n) => n + 1)} />
        ) : (
          <AuditorView data={snapshot.data} />
        )}
      </ScrollView>
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                 */
/* ------------------------------------------------------------------ */

function Hero({ snapshot }: { snapshot: VaultSnapshot | null }) {
  const total = snapshot?.coins.reduce((n, c) => n + c.shielded, 0) ?? null;
  const transfers = snapshot?.moves.filter((m) => m.kind === "transfer").length ?? null;
  return (
    <HeroCard>
      <Row gap={14} align="center">
        <View style={{ flex: 1, minWidth: 0 }}>
          <HeroTitle>Hide your bag.</HeroTitle>
          <HeroBody>Shield any post coin into an encrypted balance. Whales and copy-trade bots see the vault, not you. Unshield to sell.</HeroBody>
        </View>
        <Object3D art="vault" alt="" size={92} float eager />
      </Row>
      <HeroStats>
        <HeroStat>
          <HeroFigure>{total === null ? "—" : total.toLocaleString("en-US")}</HeroFigure>
          <HeroCaption>tokens shielded</HeroCaption>
        </HeroStat>
        <HeroRule />
        <HeroStat>
          <HeroFigure>{snapshot ? snapshot.members.filter((m) => !sameAddress(m.address, snapshot.auditor)).length : "—"}</HeroFigure>
          <HeroCaption>private bags</HeroCaption>
        </HeroStat>
        <HeroRule />
        <HeroStat>
          <HeroFigure>{transfers ?? "—"}</HeroFigure>
          <HeroCaption>hidden transfers</HeroCaption>
        </HeroStat>
      </HeroStats>
      <Tappable onPress={() => void Linking.openURL(explorer("address", VAULT!.encryptedERC))}>
        <Row gap={6} align="center" style={{ marginTop: 14 }}>
          <HeroLink>Ava Labs EncryptedERC · converter mode · {EXPLORER_NAME}</HeroLink>
          <ExternalGlyph color={theme.colors.lime} />
        </Row>
      </Tappable>
    </HeroCard>
  );
}

/* ------------------------------------------------------------------ */
/* Public view                                                          */
/* ------------------------------------------------------------------ */

function PublicView({ data, onOpen }: { data: VaultSnapshot; onOpen: (coin: string) => void }) {
  const coinOf = (address: string | null) => data.coins.find((c) => sameAddress(c.address, address));
  return (
    <Pad style={{ marginTop: 18 }}>
      <Section>What anyone can read</Section>
      <Caption style={{ marginBottom: 10 }}>The vault's ERC-20 balance of each coin is public. Whose share is whose is not.</Caption>
      <Card>
        {data.coins.length === 0 ? (
          <Caption>Nothing shielded yet.</Caption>
        ) : (
          data.coins.map((coin, i) => {
            const pct = coin.supply > 0 ? coin.shielded / coin.supply : 0;
            return (
              <Tappable key={coin.address} onPress={() => onOpen(coin.address)} to={0.98}>
                <CoinRow $first={i === 0}>
                  <CoinArt uri={coin.art} seed={coin.address} size={40} radius={12} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Row justify="space-between" align="center">
                      <Label style={{ fontWeight: "700" }} numberOfLines={1}>
                        ${coin.symbol}
                      </Label>
                      <Num>
                        {coin.shielded.toLocaleString("en-US")} <Caption>of {coin.supply.toLocaleString("en-US")}</Caption>
                      </Num>
                    </Row>
                    <Bar>
                      <BarFill style={{ width: `${Math.max(2, Math.min(100, pct * 100))}%` }} />
                    </Bar>
                    <Caption>{Math.round(pct * 100)}% of supply in private bags</Caption>
                  </View>
                </CoinRow>
              </Tappable>
            );
          })
        )}
      </Card>

      <Section style={{ marginTop: 22 }}>Who holds what — as Snowtrace sees it</Section>
      <Caption style={{ marginBottom: 10 }}>Each bag is an ElGamal ciphertext on BabyJubJub. Here is a fingerprint of each one.</Caption>
      <Card>
        {data.ciphers.length === 0 ? (
          <Caption>No bags yet.</Caption>
        ) : (
          data.ciphers.map((c, i) => (
            <CipherRow key={`${c.member}:${c.coin}`} $first={i === 0}>
              <Identicon seed={c.member} size={26} />
              <Label style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                <Handle wallet={c.member} /> <Caption>· ${coinOf(c.coin)?.symbol ?? "?"}</Caption>
              </Label>
              <LockGlyph />
              <CipherText numberOfLines={1} style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{c.fingerprint}</CipherText>
            </CipherRow>
          ))
        )}
      </Card>

      <Section style={{ marginTop: 22 }}>Vault activity</Section>
      <Caption style={{ marginBottom: 10 }}>Shielding and unshielding are public token transfers. Moves inside the vault show no amount.</Caption>
      <MovesList moves={data.moves} coinOf={coinOf} />
    </Pad>
  );
}

function MovesList({ moves, coinOf, audited = false }: { moves: VaultMove[]; coinOf: (a: string | null) => { symbol: string } | undefined; audited?: boolean }) {
  if (moves.length === 0) return <Card><Caption>No activity yet.</Caption></Card>;
  return (
    <Card>
      {moves.map((m, i) => (
        <Tappable key={`${m.hash}:${i}`} onPress={() => void Linking.openURL(explorer("tx", m.hash))} to={0.99}>
          <MoveRow $first={i === 0}>
            <MoveDot $kind={m.kind} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label numberOfLines={1}>
                <Handle wallet={m.from} />
                {m.kind === "deposit" ? " shielded" : m.kind === "withdraw" ? " unshielded" : " → "}
                {m.kind === "transfer" && m.to ? <Handle wallet={m.to} /> : null}
              </Label>
              <Caption numberOfLines={1}>
                ${coinOf(m.coin)?.symbol ?? "?"} · {m.time ? since(new Date(m.time).toISOString()) : `block ${m.block}`}
              </Caption>
            </View>
            {m.amount === null ? (
              <Hidden>
                <LockGlyph color={theme.colors.muted} />
                <Caption>hidden</Caption>
              </Hidden>
            ) : (
              <Num style={audited && m.kind === "transfer" ? { color: theme.colors.pos } : undefined}>{m.amount.toLocaleString("en-US")}</Num>
            )}
          </MoveRow>
        </Tappable>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Your view                                                            */
/* ------------------------------------------------------------------ */

type Action = "shield" | "send" | "unshield";

function YourView({ data, preset, presetTo, onChanged }: { data: VaultSnapshot; preset: string | null; presetTo: string | null; onChanged: () => void }) {
  const wallet = useWallet();
  const account = wallet.address as Address | null;
  const [key, setKey] = useState<Keypair | null>(null);
  const [status, setStatus] = useState<"new" | "match" | "other" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ label: string; hash: string; ms: number } | null>(null);
  const [rev, setRev] = useState(0);
  const [action, setAction] = useState<Action>("shield");
  const [coin, setCoin] = useState<string | null>(preset);
  const [amount, setAmount] = useState("");
  // From "Tip the creator privately": the creator is picked; the form opens on Send once this coin is in your bag.
  const tipTo = presetTo && data.members.some((m) => sameAddress(m.address, presetTo)) ? presetTo : null;
  const [to, setTo] = useState<string | null>(tipTo);

  useEffect(() => {
    setKey(null);
    setStatus(null);
    setDone(null);
    setError(null);
  }, [account]);

  const bags = useApi(async () => (account && key && status === "match" ? myBags(account, key, data.coins) : null), [account, key, status, data, rev]);
  const tipOpened = useRef(false);
  useEffect(() => {
    if (!tipTo || tipOpened.current || !bags.data) return;
    if (bags.data.some((b) => b.balance > 0 && sameAddress(b.coin.address, coin))) {
      tipOpened.current = true;
      setAction("send");
    }
  }, [tipTo, bags.data, coin]);
  const publicHoldings = useApi(async () => {
    if (!account) return null;
    const { juno } = await import("../lib/api");
    const { coins } = await juno.coins(undefined);
    const c = fujiClient();
    const held = await Promise.all(coins.map(async (x) => ({ coin: x, balance: Number(await c.readContract({ address: x.address as Address, abi: postAbi, functionName: "balanceOf", args: [account] })) })));
    return held.filter((h) => h.balance > 0);
  }, [account, rev]);

  if (!account) {
    return (
      <Placeholder
        art="wallet"
        title="Connect to open your bag"
        detail="Your private balances are decrypted on this device with a key only your wallet can recreate."
        action={<Button label="Connect wallet" onPress={() => void wallet.connect().catch(() => undefined)} />}
      />
    );
  }

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message && message !== "Cancelled") setError(message);
    } finally {
      setBusy(null);
    }
  };

  const unlock = () =>
    run("Waiting for your signature…", async () => {
      const k = await openKey(account, wallet.signMessage);
      const s = await checkKey(account, k);
      setKey(k);
      setStatus(s);
    });

  const sendSteps = async (label: string, build: () => Promise<import("../lib/api").TxStep[]>) => {
    await run(label, async () => {
      const steps = await build();
      setBusy("Confirm in your wallet…");
      const result = await wallet.send(steps, {
        onProgress: (p: SendProgress) => setBusy(p.phase === "confirming" ? `${p.label}: waiting for Fuji…` : p.phase === "signing" ? `${p.label}: confirm in your wallet…` : `${p.label}: checking…`),
      });
      const last = result.hashes.length - 1;
      setDone({ label: steps[last]!.label, hash: result.hashes[last]!, ms: result.blockMs[last] ?? result.finalityMs[last]! });
      setAmount("");
      setRev((n) => n + 1);
      onChanged();
    });
  };

  if (!key) {
    return (
      <Pad style={{ marginTop: 18 }}>
        <Card style={{ alignItems: "center", paddingVertical: 26 }}>
          <Object3D art="envelope" alt="" size={96} float eager />
          <Label style={{ fontWeight: "800", fontSize: 18, marginTop: 6 }}>Open your private bag</Label>
          <Body muted style={{ textAlign: "center", marginTop: 6, maxWidth: 340 }}>
            One signature derives your eERC key on this device. It is not a transaction and costs nothing. Juno never stores it.
          </Body>
          <Button label={busy ?? "Sign to open"} loading={!!busy} onPress={unlock} style={{ marginTop: 16, alignSelf: "stretch" }} />
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Card>
      </Pad>
    );
  }

  if (status === "other") {
    return (
      <Placeholder
        art="warning"
        title="This signature opens a different bag"
        detail="This account registered an eERC key that this signature does not recreate. Sign with the same wallet you first opened the bag with."
      />
    );
  }

  if (status === "new") {
    return (
      <Pad style={{ marginTop: 18 }}>
        <Card style={{ paddingVertical: 22 }}>
          <Label style={{ fontWeight: "800", fontSize: 18 }}>Create your bag on Fuji</Label>
          <Body muted style={{ marginTop: 6 }}>
            Your browser builds a zero-knowledge proof that you own this key, bound to your account and to Fuji. One transaction, test AVAX gas only.
          </Body>
          <Button
            label={busy ?? "Create private bag"}
            loading={!!busy}
            style={{ marginTop: 16 }}
            onPress={() =>
              void run("Building the registration proof…", async () => {
                const step = await registerStep(account, key, browserProver);
                setBusy("Confirm in your wallet…");
                const result = await wallet.send([step]);
                setDone({ label: step.label, hash: result.hashes[0]!, ms: result.blockMs[0] ?? result.finalityMs[0]! });
                setStatus("match");
                onChanged();
              })
            }
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Card>
      </Pad>
    );
  }

  const myList = bags.data ?? [];
  const holdings = publicHoldings.data ?? [];
  const selectedBag: MyBag | undefined = myList.find((b) => sameAddress(b.coin.address, coin));
  const selectedPublic = holdings.find((h) => sameAddress(h.coin.address, coin));
  const max = action === "shield" ? selectedPublic?.balance ?? 0 : selectedBag?.balance ?? 0;
  const qty = Number(amount);
  const valid = Number.isInteger(qty) && qty > 0 && qty <= max && (action !== "send" || !!to);
  const recipients = data.members.filter((m) => !sameAddress(m.address, account) && !sameAddress(m.address, data.auditor));
  const pickable = action === "shield" ? holdings.map((h) => ({ address: h.coin.address, symbol: h.coin.symbol, n: h.balance })) : myList.filter((b) => b.balance > 0).map((b) => ({ address: b.coin.address, symbol: b.coin.symbol, n: b.balance }));

  const submit = () => {
    if (!coin || !valid) return;
    if (action === "shield") void sendSteps("Preparing…", () => shieldSteps(account, key, coin as Address, qty));
    else if (action === "send") void sendSteps("Building the transfer proof…", async () => [await sendStep(key, selectedBag!, to as Address, qty, data.auditorKey, browserProver)]);
    else void sendSteps("Building the withdraw proof…", async () => [await unshieldStep(key, selectedBag!, qty, data.auditorKey, browserProver)]);
  };

  return (
    <Pad style={{ marginTop: 18 }}>
      <Section>Your shielded bags</Section>
      <Caption style={{ marginBottom: 10 }}>Decrypted here with your key and checked against the encrypted balance on chain.</Caption>
      <Card>
        {bags.loading && !bags.data ? (
          <Skeleton h={48} round={12} />
        ) : bags.error ? (
          <ErrorText>{bags.error}</ErrorText>
        ) : myList.every((b) => b.balance === 0) ? (
          <Caption>Nothing shielded yet. Pick a coin below.</Caption>
        ) : (
          myList
            .filter((b) => b.balance > 0)
            .map((b, i) => (
              <CoinRow key={b.coin.address} $first={i === 0}>
                <CoinArt uri={b.coin.art} seed={b.coin.address} size={40} radius={12} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Label style={{ fontWeight: "700" }}>${b.coin.symbol}</Label>
                  <Caption>Public sees: a ciphertext</Caption>
                </View>
                <BigNum>{b.balance.toLocaleString("en-US")}</BigNum>
              </CoinRow>
            ))
        )}
      </Card>

      <Section style={{ marginTop: 22 }}>Move a bag</Section>
      <Card style={{ gap: 14 }}>
        <Segmented
          items={[
            { id: "shield" as const, label: "Shield" },
            { id: "send" as const, label: "Send privately" },
            { id: "unshield" as const, label: "Unshield" },
          ]}
          value={action}
          onChange={(a) => {
            setAction(a);
            setAmount("");
            setDone(null);
            setError(null);
          }}
        />
        <Caption>
          {action === "shield"
            ? "Moves public coins into your encrypted balance. The amount you shield is a public transfer; after that, nobody can see how your bag changes."
            : action === "send"
              ? "A transfer proof moves part of your bag to another private bag. Nobody but the two of you and the auditor learns the amount."
              : "A withdraw proof turns part of your bag back into public coins you can sell or redeem. The amount becomes public."}
        </Caption>
        {pickable.length === 0 ? (
          <Caption style={{ color: theme.colors.text }}>
            {action === "shield" ? "You hold no post coins publicly yet. Buy one first." : "Nothing in your private bags yet. Shield first."}
          </Caption>
        ) : (
          <Chips>
            {pickable.map((p) => (
              <Tappable key={p.address} onPress={() => setCoin(p.address)} to={0.96}>
                <Chip $on={sameAddress(coin, p.address)} accessibilityRole="button" accessibilityState={{ selected: sameAddress(coin, p.address) }}>
                  <ChipText $on={sameAddress(coin, p.address)}>
                    ${p.symbol} · {p.n.toLocaleString("en-US")}
                  </ChipText>
                </Chip>
              </Tappable>
            ))}
          </Chips>
        )}
        {action === "send" ? (
          recipients.length === 0 ? (
            <Caption>No other private bags yet.</Caption>
          ) : (
            <Chips>
              {recipients.map((m) => (
                <Tappable key={m.address} onPress={() => setTo(m.address)} to={0.96}>
                  <Chip $on={sameAddress(to, m.address)} accessibilityRole="button" accessibilityState={{ selected: sameAddress(to, m.address) }}>
                    <ChipText $on={sameAddress(to, m.address)}>
                      to <Handle wallet={m.address} />
                    </ChipText>
                  </Chip>
                </Tappable>
              ))}
            </Chips>
          )
        ) : null}
        <Row gap={10} align="center">
          <Amount
            value={amount}
            onChangeText={(t: string) => setAmount(t.replace(/[^0-9]/g, ""))}
            placeholder="Amount"
            placeholderTextColor={theme.colors.faint}
            inputMode="numeric"
            accessibilityLabel="Amount of tokens"
          />
          <Tappable onPress={() => setAmount(max > 0 ? String(max) : "")} to={0.95}>
            <MaxChip accessibilityRole="button">
              <Caption style={{ fontWeight: "700", color: theme.colors.text }}>Max {max || ""}</Caption>
            </MaxChip>
          </Tappable>
        </Row>
        <Button
          label={busy ?? (action === "shield" ? "Shield" : action === "send" ? "Send privately" : "Unshield")}
          loading={!!busy}
          disabled={!valid || !coin}
          onPress={submit}
          variant={action === "unshield" ? "ink" : "lime"}
          tall
        />
        {error ? <ErrorText>{error}</ErrorText> : null}
        {done ? (
          <Tappable onPress={() => void Linking.openURL(explorer("tx", done.hash))}>
            <DoneRow>
              <Caption style={{ color: theme.colors.pos, fontWeight: "700", flex: 1 }}>
                {done.label} final on Fuji in {(done.ms / 1000).toFixed(2)} s
              </Caption>
              <Caption style={{ color: theme.colors.focus }}>{done.hash.slice(0, 10)}…</Caption>
              <ExternalGlyph />
            </DoneRow>
          </Tappable>
        ) : null}
      </Card>
    </Pad>
  );
}

/* ------------------------------------------------------------------ */
/* Auditor view                                                         */
/* ------------------------------------------------------------------ */

function AuditorView({ data }: { data: VaultSnapshot }) {
  const wallet = useWallet();
  const [key, setKey] = useState<Keypair | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAuditor = sameAddress(wallet.address, data.auditor);
  const audited = useMemo(() => (key && isAuditorKey(data, key) ? audit(data, key) : null), [key, data]);
  const coinOf = (address: string | null) => data.coins.find((c) => sameAddress(c.address, address));
  const transfers = (audited ?? data.moves).filter((m) => m.kind === "transfer");

  return (
    <Pad style={{ marginTop: 18 }}>
      <Card style={{ gap: 8 }}>
        <Row gap={10} align="center">
          <Identicon seed={data.auditor} size={30} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label style={{ fontWeight: "700" }}>
              Auditor · <Handle wallet={data.auditor} />
            </Label>
            <Caption numberOfLines={1}>{data.auditor}</Caption>
          </View>
        </Row>
        <Caption>
          Every transfer and withdraw proof must also encrypt its amount to this key, or it does not verify. The auditor can read amounts; it cannot move anyone's coins.
        </Caption>
        {audited ? (
          <Caption style={{ color: theme.colors.pos, fontWeight: "700" }}>Auditor key open on this device.</Caption>
        ) : isAuditor ? (
          <Button
            label={busy ? "Waiting for your signature…" : "Open the auditor key"}
            loading={busy}
            onPress={async () => {
              setBusy(true);
              setError(null);
              try {
                const k = await openKey(wallet.address as Address, wallet.signMessage);
                if (!isAuditorKey(data, k)) throw new Error("This signature does not recreate the auditor key registered on chain.");
                setKey(k);
              } catch (e) {
                const m = e instanceof Error ? e.message : String(e);
                if (m !== "Cancelled") setError(m);
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : (
          <Caption style={{ color: theme.colors.text }}>You are not the auditor, so the amounts below stay sealed for you too.</Caption>
        )}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>
      <Section style={{ marginTop: 22 }}>Private transfers</Section>
      <MovesList moves={transfers} coinOf={coinOf} audited={!!audited} />
    </Pad>
  );
}

/* ------------------------------------------------------------------ */
/* Bits                                                                 */
/* ------------------------------------------------------------------ */

function LockGlyph({ color = theme.colors.faint }: { color?: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24">
      <Rect x={5} y={10} width={14} height={10} rx={2.5} fill={color} />
      <Path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke={color} strokeWidth={2.2} fill="none" />
    </Svg>
  );
}

const Page = styled(SafeAreaView)`
  flex: 1;
  background-color: ${(p) => p.theme.colors.bg};
`;
const Nav = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
`;
const NavTitle = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.text};
`;
const Back = styled.Pressable`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: ${(p) => p.theme.colors.surface};
`;
const Pad = styled.View`
  padding-horizontal: 16px;
`;
const HeroCard = styled.View`
  margin: 4px 16px 16px;
  padding: 20px;
  border-radius: ${(p) => p.theme.radius.lg}px;
  background-color: ${(p) => p.theme.colors.ink};
`;
const HeroTitle = styled.Text`
  font-size: ${(p) => p.theme.type.heading.size}px;
  line-height: ${(p) => p.theme.type.heading.height}px;
  font-weight: 800;
  letter-spacing: -0.6px;
  color: ${(p) => p.theme.colors.onInk};
`;
const HeroBody = styled.Text`
  margin-top: 6px;
  font-size: ${(p) => p.theme.type.label.size}px;
  line-height: 20px;
  color: rgba(243, 247, 238, 0.72);
`;
const HeroStats = styled.View`
  flex-direction: row;
  margin-top: 18px;
  padding-top: 14px;
  border-top-width: 1px;
  border-top-color: rgba(243, 247, 238, 0.12);
`;
const HeroStat = styled.View`
  flex: 1;
  min-width: 0;
`;
const HeroRule = styled.View`
  width: 1px;
  margin-horizontal: 12px;
  background-color: rgba(243, 247, 238, 0.12);
`;
const HeroFigure = styled.Text`
  font-size: ${(p) => p.theme.type.title.size}px;
  font-weight: 800;
  color: ${(p) => p.theme.colors.lime};
  font-variant: tabular-nums;
`;
const HeroCaption = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  color: rgba(243, 247, 238, 0.6);
`;
const HeroLink = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 600;
  color: ${(p) => p.theme.colors.lime};
`;
const Section = styled.Text`
  font-size: ${(p) => p.theme.type.lead.size}px;
  font-weight: 800;
  letter-spacing: -0.3px;
  color: ${(p) => p.theme.colors.text};
  margin-bottom: 2px;
`;
const Card = styled.View`
  padding: 14px;
  border-radius: ${(p) => p.theme.radius.md}px;
  background-color: ${(p) => p.theme.colors.surface};
`;
const CoinRow = styled.View<{ $first?: boolean }>`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  padding-vertical: 10px;
  border-top-width: ${(p) => (p.$first ? 0 : 1)}px;
  border-top-color: ${(p) => p.theme.colors.line};
`;
const CipherRow = styled(CoinRow)`
  gap: 8px;
`;
const MoveRow = styled(CoinRow)``;
const MoveDot = styled.View<{ $kind: string }>`
  width: 10px;
  height: 10px;
  border-radius: 5px;
  background-color: ${(p) => (p.$kind === "transfer" ? p.theme.colors.ink : p.$kind === "deposit" ? p.theme.colors.lime : p.theme.colors.lineStrong)};
  border-width: 1px;
  border-color: ${(p) => p.theme.colors.ink};
`;
const Bar = styled.View`
  height: 6px;
  border-radius: 3px;
  margin-vertical: 6px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
  overflow: hidden;
`;
const BarFill = styled.View`
  height: 6px;
  border-radius: 3px;
  background-color: ${(p) => p.theme.colors.ink};
`;
const Num = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.text};
  font-variant: tabular-nums;
`;
const BigNum = styled.Text`
  font-size: ${(p) => p.theme.type.title.size}px;
  font-weight: 800;
  color: ${(p) => p.theme.colors.text};
  font-variant: tabular-nums;
`;
const CipherText = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  color: ${(p) => p.theme.colors.muted};
  max-width: 132px;
`;
const Hidden = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;
const Chips = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  gap: 8px;
`;
const Chip = styled.View<{ $on?: boolean }>`
  padding: 8px 12px;
  border-radius: 999px;
  border-width: 1px;
  border-color: ${(p) => (p.$on ? p.theme.colors.ink : p.theme.colors.line)};
  background-color: ${(p) => (p.$on ? p.theme.colors.ink : p.theme.colors.surface)};
`;
const ChipText = styled.Text<{ $on?: boolean }>`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 700;
  color: ${(p) => (p.$on ? p.theme.colors.lime : p.theme.colors.text)};
`;
const Amount = styled(TextInput)`
  flex: 1;
  min-width: 0;
  height: 48px;
  padding-horizontal: 14px;
  border-radius: 14px;
  font-size: 18px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.text};
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;
const MaxChip = styled.View`
  height: 48px;
  padding-horizontal: 14px;
  border-radius: 14px;
  align-items: center;
  justify-content: center;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;
const ErrorText = styled.Text`
  margin-top: 8px;
  font-size: ${(p) => p.theme.type.caption.size}px;
  line-height: 17px;
  color: ${(p) => p.theme.colors.neg};
`;
const DoneRow = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background-color: ${(p) => p.theme.colors.posSoft};
`;
