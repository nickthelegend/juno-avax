import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { Tappable } from "./Press";
import { Button } from "./kit";
import { fujiClient, juno } from "../lib/api";
import { factoryAbi, postAbi } from "@juno/sdk";
import { FACTORY } from "../lib/chain";
import { displayAddress, explorer, FAUCET_URL, NETWORK_NAME } from "../lib/chain";
import { useApi } from "../lib/useApi";
import { canGetGas } from "../lib/gas";
import { useWallet } from "../lib/wallet";
import { useFeedRevision } from "../lib/refresh";
import { theme } from "../theme";

/**
 * The account itself: its address, what it holds, and how to fund it.
 *
 * The card shows the AVAX balance and how many posts this account holds, read
 * from Fuji. A brand-new, empty account gets its starter test AVAX from
 * Juno's gas sponsor in one tap; after that the card links to the Core faucet.
 *
 * Balances are shown as a dash when the read fails, never as zero.
 */

export function WalletCard({ address }: { address: string }) {
  const revision = useFeedRevision();
  const balances = useApi(() => juno.balances(address), [address, revision]);
  // Posts held: one balanceOf per post, read in parallel (the full portfolio read is too slow for this card on a phone).
  const held = useApi(async () => {
    if (!FACTORY) return null;
    const client = fujiClient();
    const posts = (await client.readContract({ address: FACTORY as `0x${string}`, abi: factoryAbi, functionName: "posts" })) as readonly `0x${string}`[];
    const balances = await Promise.all(posts.map((post) => client.readContract({ address: post, abi: postAbi, functionName: "balanceOf", args: [address as `0x${string}`] }) as Promise<bigint>));
    return balances.filter((b) => b > 0n).length;
  }, [address, revision]);
  const wallet = useWallet();
  const starter = useApi(() => canGetGas(address as `0x${string}`), [address, revision, wallet.gas.phase]);
  const [copied, setCopied] = useState(false);
  const shown = displayAddress(address);

  const copy = async () => {
    await Clipboard.setStringAsync(shown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const figure = (value: number | null | undefined) =>
    balances.loading
      ? "…"
      : value === null || value === undefined || balances.error
        ? "—"
        : value.toFixed(value === 0 ? 2 : value < 1 ? 4 : 2);

  const empty = balances.data?.avax !== null && balances.data?.avax !== undefined && balances.data.avax < 0.006;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.label}>Account · {NETWORK_NAME}</Text>
        <Tappable onPress={() => void copy()} to={0.95} accessibilityRole="button" accessibilityLabel="Copy address">
          <View style={styles.copy}>
            <Text style={styles.copyText}>{copied ? "Copied" : "Copy address"}</Text>
          </View>
        </Tappable>
      </View>
      <Text
        style={styles.address}
        selectable
        numberOfLines={1}
        ellipsizeMode="middle"
        onPress={() => void Linking.openURL(explorer("address", address))}
      >
        {shown}
      </Text>

      <View style={styles.balances}>
        <View style={styles.balance}>
          <Text style={styles.amount}>{figure(balances.data?.avax)}</Text>
          <Text style={styles.unit}>AVAX</Text>
        </View>
        <View style={styles.rule} />
        <View style={styles.balance}>
          <Text style={styles.amount}>{held.data === null || held.data === undefined ? (held.loading ? "…" : "—") : String(held.data)}</Text>
          <Text style={styles.unit}>posts held</Text>
        </View>
      </View>

      {empty ? (
        <Text style={styles.hint}>A sealed bid escrows 0.005 AVAX, and every call needs a little gas.</Text>
      ) : null}

      {wallet.gas.phase === "done" && wallet.gas.hash ? (
        <Text style={styles.hint}>
          {wallet.gas.amount} AVAX from Juno&apos;s gas station ·{" "}
          <Text style={styles.link} onPress={() => void Linking.openURL(explorer("tx", wallet.gas.hash!))}>
            Snowtrace
          </Text>
        </Text>
      ) : null}
      {wallet.gas.phase === "failed" && wallet.gas.error ? <Text style={[styles.message, { color: theme.colors.neg }]}>{wallet.gas.error}</Text> : null}

      {wallet.gas.phase === "asking" ? (
        <Button label="Getting test AVAX…" variant="lime" disabled onPress={() => undefined} />
      ) : starter.data && wallet.gas.phase !== "failed" ? (
        <Button label="Get free test AVAX" variant="lime" onPress={() => void wallet.getGas()} />
      ) : (
        <Button label="Get test AVAX" variant={empty ? "lime" : "quiet"} onPress={() => void Linking.openURL(FAUCET_URL)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: 16,
    gap: 12,
    ...theme.shadow.card,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 12, fontWeight: "700", color: theme.colors.muted, letterSpacing: 0.2 },
  copy: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.surfaceAlt },
  copyText: { fontSize: 12, fontWeight: "700", color: theme.colors.text },
  address: { fontSize: 13, fontWeight: "600", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  balances: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  balance: { flex: 1, flexDirection: "row", alignItems: "baseline", gap: 6 },
  amount: { fontSize: 20, fontWeight: "800", color: theme.colors.text, fontVariant: ["tabular-nums"] },
  unit: { fontSize: 12, fontWeight: "700", color: theme.colors.muted },
  rule: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: theme.colors.lineStrong, marginHorizontal: 12 },
  hint: { fontSize: 13, lineHeight: 18, color: theme.colors.muted },
  message: { fontSize: 13, lineHeight: 18 },
  link: { fontWeight: "800", color: theme.colors.focus },
  name: { fontSize: 17, fontWeight: "800", color: theme.colors.text, marginTop: 2 },
  choose: { backgroundColor: theme.colors.lime },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    paddingHorizontal: 14,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
  },
  at: { fontSize: 16, fontWeight: "800", color: theme.colors.muted, marginRight: 2 },
  nameInput: { flex: 1, fontSize: 16, fontWeight: "700", color: theme.colors.text },
});
