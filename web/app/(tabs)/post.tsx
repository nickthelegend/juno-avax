import { Image as ExpoImage } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CurvePreview } from "../../components/CurvePreview";
import { Button, Card, Pill } from "../../components/kit";
import { APP_URL, fujiClient, juno } from "../../lib/api";
import { describeTxError, explorer, FACTORY, NETWORK_NAME } from "../../lib/chain";
import { factoryAbi } from "@juno/sdk";
import { keccak256, toBytes, zeroAddress, type Address } from "viem";
import { API } from "../../lib/gas";
import { pickPhoto, type Photo } from "../../lib/photo";
import { feedChanged } from "../../lib/refresh";
import { useTabBarHeight } from "../../lib/tabbar";
import { useWallet, type SendProgress } from "../../lib/wallet";
import { theme } from "../../theme";

/**
 * Post — which here means launching a real coin on Avalanche.
 *
 * Publishing calls `createPost` on the JunoFactory, which deploys the post's
 * own contract in the same transaction: the post *is* that contract, its
 * ERC-20, its auction and its vault. Launching costs only gas; a dare bond,
 * if any, rides along as AVAX and is held by the post until the dare closes.
 *
 * The new post opens with a one-minute sealed-bid auction, a minute of
 * reveals, then its bonding curve.
 *
 * Media is a URL stored on-chain (300 characters at most). There is no Juno
 * upload server: a photo from the camera or the library is shrunk to a JPEG of
 * at most 110 kB and stored on Fuji itself, as the calldata of one
 * JunoMedia.store transaction (lib/photo.ts); the post's URL is Juno's API
 * reading that transaction back. Juno's own art or any https image URL work too.
 */

/** Juno's own art, served from this app's /art. Square, so it sits in the feed as a photo would. */
const ART = [
  "/art/juno-feature-1.webp",
  "/art/juno-feature-2.webp",
  "/art/juno-feature-3.webp",
  "/art/juno-social-square.webp",
  "/art/juno-mark.webp",
  "/art/juno-object-2.webp",
];

const KINDS = [
  { id: "plain", label: "Plain post", blurb: "A sealed-bid opening, then the curve. Holders can always redeem against the floor." },
  { id: "dare", label: "Dare post", blurb: "Put AVAX behind a promise. Holders vote on your proof; flake and the bond goes into their floor." },
] as const;

export default function PostScreen() {
  const router = useRouter();
  const wallet = useWallet();
  const [media, setMedia] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [name, setName] = useState("");
  const { format } = useLocalSearchParams<{ format?: string }>();
  const [kind, setKind] = useState<"plain" | "dare">(format === "dare" ? "dare" : "plain");
  useEffect(() => {
    if (format === "dare" || format === "post") setKind(format === "dare" ? "dare" : "plain");
  }, [format]);
  const [dare, setDare] = useState("");
  const [bond, setBond] = useState("0.02");
  const [status, setStatus] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const note = (entry: Omit<LogEntry, "at">) => setLog((current) => [...current, { ...entry, at: new Date() }]);
  const scroller = useRef<ScrollViewInstance>(null);
  const TAB_H = useTabBarHeight().height;
  useEffect(() => {
    if (log.length > 0) setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 60);
  }, [log.length]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Names are unique on the factory: check before anything is sent (a photo stored for a taken name would be wasted).
  const [taken, setTaken] = useState<string | null>(null);

  const slug = name.trim().toLowerCase();
  const slugOk = /^[a-z0-9-]{2,32}$/.test(slug) && !slug.startsWith("-") && !slug.endsWith("-");
  const captionBytes = new TextEncoder().encode(caption.trim()).length;
  const captionOk = captionBytes <= MAX_CAPTION;
  const bondNear = Number(bond);
  const dareOk = kind === "plain" || (dare.trim().length > 0 && new TextEncoder().encode(dare.trim()).length <= 300 && bondNear > 0 && bondNear <= 2);
  const chosen = photo ? photo.uri : (media ?? (/^https:\/\/\S{6,290}$/.test(mediaUrl.trim()) ? mediaUrl.trim() : null));
  useEffect(() => {
    if (!slugOk || !FACTORY) {
      setTaken(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      nameTaken(slug)
        .then((t) => live && setTaken(t ? slug : null))
        .catch(() => undefined);
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, slugOk]);
  const canLaunch = !!chosen && slugOk && taken !== slug && captionOk && dareOk && !busy && !!FACTORY;
  const missing = !FACTORY
    ? "Setup required: EXPO_PUBLIC_JUNO_FACTORY"
    : !chosen
      ? "Choose a photo, pick art or paste an https image URL"
      : !slugOk
        ? "Name it: 2–32 lowercase letters, digits or dashes"
        : taken === slug
          ? "A post with that name already exists. Pick another name."
        : !captionOk
          ? "Caption is too long"
          : !dareOk
            ? "A dare needs its promise and a bond up to 2 AVAX"
            : null;

  async function finish(account: string) {
    setStatus("Live");
    feedChanged();
    await new Promise((resolve) => setTimeout(resolve, 3500));
    setStatus(null);
    setMedia(null);
    setPhoto(null);
    setMediaUrl("");
    setName("");
    setCaption("");
    setDare("");
    setKind("plain");
    router.push(`/coin/${account}`);
  }

  async function launch() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    setLog([]);
    try {
      await (wallet.address ? Promise.resolve(wallet.address) : wallet.connect());
      if (await nameTaken(slug)) {
        setTaken(slug);
        throw new Error("A post with that name already exists. Pick another name.");
      }
      const onProgress = (at: SendProgress) =>
        setStatus(
          at.phase === "checking"
            ? `${at.label}: checking with ${NETWORK_NAME}…`
            : at.phase === "signing"
              ? `${at.label}: approve it in ${wallet.walletName ?? "your wallet"}…`
              : at.phase === "confirming"
                ? `${at.label}: confirming on ${NETWORK_NAME}…`
                : `${at.label}: final in ${(((at.blockMs ?? at.ms) ?? 0) / 1000).toFixed(2)} s`,
        );
      let mediaFor = chosen;
      if (photo) {
        // The photo goes on Fuji first; the post then points at that transaction.
        const stored = await wallet.send(juno.buildStorePhoto(photo.hex).steps, { onProgress });
        const storeHash = stored.hashes[0]!;
        note({ label: `Photo stored on Fuji (${Math.round(photo.size / 1000)} kB) final in ${(((stored.blockMs[0] ?? stored.finalityMs[0]) ?? 0) / 1000).toFixed(2)} s`, receipt: storeHash, kind: "tx" });
        mediaFor = `${API}/api/media?tx=${storeHash}`;
      }
      setStatus("Building the launch…");
      const built = juno.buildLaunch({
        slug,
        caption: caption.trim(),
        mediaUrl: mediaFor,
        dare: kind === "dare" ? dare.trim() : "",
        dareBondAvax: kind === "dare" ? bondNear : 0,
      });
      const sent = await wallet.send(built.steps, { onProgress });
      const launchHash = sent.hashes[sent.hashes.length - 1]!;
      note({ label: `createPost final in ${(((sent.blockMs[0] ?? sent.finalityMs[0]) ?? 0) / 1000).toFixed(2)} s`, receipt: launchHash, kind: "tx" });
      const post = await juno.postFromLaunch(launchHash);
      note({ label: "Post contract deployed", receipt: post, kind: "address" });
      await finish(post);
    } catch (caught) {
      const failure = describeTxError(caught);
      setError(failure.cancelled ? null : failure.message || "Launch failed");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={[styles.body, { paddingBottom: TAB_H + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Post a photo</Text>
          <Text style={styles.lede}>
            Publishing deploys this post&apos;s own coin: a one-minute sealed-bid opening, a bonding curve in AVAX, and a
            floor every holder can redeem.
          </Text>

          <MediaPicker
            media={chosen}
            photo={photo}
            onPick={(path) => {
              setMedia(path);
              if (!path) setPhoto(null);
            }}
            onPhoto={(next) => {
              setError(null);
              setPhoto(next);
            }}
            onError={setError}
            disabled={busy}
          />
          {media || photo ? null : (
            <TextInput
              value={mediaUrl}
              onChangeText={setMediaUrl}
              placeholder="…or paste an https image URL"
              placeholderTextColor={theme.colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              maxLength={300}
            />
          )}

          <Card style={styles.form}>
            <Field
              label="Name"
              hint={name.length > 0 && !slugOk ? "2–32 lowercase letters, digits or dashes" : undefined}
              note={slugOk ? (taken === slug ? "That name is taken" : `ticker $${slug.replace(/-/g, "").slice(0, 11).toUpperCase()}`) : undefined}
            >
              <TextInput
                value={name}
                onChangeText={(next) => setName(next.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="night-market"
                placeholderTextColor={theme.colors.faint}
                autoCapitalize="none"
                style={styles.input}
                maxLength={32}
              />
            </Field>

            <Field label="Caption" hint={!captionOk ? `${captionBytes - MAX_CAPTION} bytes over the limit` : undefined}>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Say what this is"
                placeholderTextColor={theme.colors.faint}
                multiline
                style={[styles.input, styles.caption]}
                maxLength={MAX_CAPTION + 20}
              />
            </Field>
          </Card>

          <Text style={styles.sectionTitle}>Kind</Text>
          <Text style={styles.sectionLede}>
            Every post uses the same sixteen-segment curve, priced in AVAX. 20% of each buy goes into the floor.
          </Text>

          <View style={styles.presets}>
            {KINDS.map((option) => {
              const on = kind === option.id;
              return (
                <Pressable key={option.id} onPress={() => setKind(option.id)}>
                  <Card style={[styles.preset, on && styles.presetOn]}>
                    <View style={styles.presetRow}>
                      <View style={styles.presetText}>
                        <View style={styles.presetHead}>
                          <Text style={styles.presetLabel}>{option.label}</Text>
                          {on && <Pill label="Selected" tone="lime" />}
                        </View>
                        <Text style={styles.presetBlurb}>{option.blurb}</Text>
                      </View>
                      <CurvePreview preset="content" active={on} />
                    </View>
                    {on && option.id === "dare" ? (
                      <View style={{ gap: 10, marginTop: 8 }}>
                        <TextInput
                          value={dare}
                          onChangeText={setDare}
                          placeholder="I will post the sunrise from the summit by Friday"
                          placeholderTextColor={theme.colors.faint}
                          style={styles.input}
                          maxLength={300}
                        />
                        <TextInput
                          value={bond}
                          onChangeText={(next) => setBond(next.replace(/[^0-9.]/g, ""))}
                          placeholder="Bond in AVAX"
                          placeholderTextColor={theme.colors.faint}
                          keyboardType="decimal-pad"
                          style={styles.input}
                          maxLength={6}
                        />
                      </View>
                    ) : null}
                  </Card>
                </Pressable>
              );
            })}
          </View>

          {error && (
            <Card style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </Card>
          )}

          {log.length > 0 ? <LaunchLog entries={log} /> : null}

          <Button
            label={status ?? (kind === "dare" && bondNear > 0 ? `Launch post · ${bondNear} AVAX bond` : "Launch post")}
            tall
            onPress={launch}
            loading={busy}
            disabled={!canLaunch}
          />
          {!busy && missing ? <Text style={styles.missing}>{missing}</Text> : null}
          {busy && status ? <Text style={styles.missing}>{status}</Text> : null}
          <Text style={styles.footnote}>
            {photo ? "Two transactions: your photo goes on Fuji, then the launch." : "One approval in your wallet."} Your account pays the gas{kind === "dare" ? " and the bond" : ""}; the post&apos;s contract holds every bid, buy and floor from then on.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const MAX_CAPTION = 400;

/** Whether the factory already has a post with this name (names are keyed by keccak256 of the slug). */
async function nameTaken(slug: string): Promise<boolean> {
  if (!FACTORY) return false;
  const post = (await fujiClient().readContract({ address: FACTORY as Address, abi: factoryAbi, functionName: "postBySlug", args: [keccak256(toBytes(slug))] })) as Address;
  return post !== zeroAddress;
}

/** Your own photo (camera or library) first, Juno's art as a grid below it, then the pick previewed square. */
function MediaPicker({
  media,
  photo,
  onPick,
  onPhoto,
  onError,
  disabled,
}: {
  media: string | null;
  photo: Photo | null;
  onPick: (path: string | null) => void;
  onPhoto: (photo: Photo) => void;
  onError: (message: string) => void;
  disabled: boolean;
}) {
  // Yoga on iOS (RN 0.88) gives a percentage-wide cell no height from aspectRatio, so the height is set from the
  // grid's measured width (the same 31% the web renders).
  const [cell, setCell] = useState<number | null>(null);
  const [picking, setPicking] = useState<"library" | "camera" | null>(null);
  const choose = async (from: "library" | "camera") => {
    setPicking(from);
    try {
      const next = await pickPhoto(from);
      if (next) onPhoto(next);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPicking(null);
    }
  };
  if (!media) {
    return (
      <View style={[styles.drop, { paddingVertical: 18 }]}>
        <Text style={styles.dropTitle}>Your photo</Text>
        <View style={styles.photoRow}>
          <Button label={picking === "library" ? "Opening…" : "Choose photo"} onPress={() => void choose("library")} loading={picking === "library"} disabled={disabled || !!picking} style={styles.photoButton} />
          <Button label={picking === "camera" ? "Opening…" : "Take photo"} variant="ink" onPress={() => void choose("camera")} loading={picking === "camera"} disabled={disabled || !!picking} style={styles.photoButton} />
        </View>
        <Text style={styles.dropBlurb}>Stored on Fuji itself. No upload server.</Text>
        <View style={styles.orRule} />
        <Text style={styles.dropTitle}>Or pick Juno&apos;s art</Text>
        <View style={styles.grid} onLayout={(e) => setCell(Math.floor(0.31 * (e.nativeEvent.layout.width - 28)))}>
          {ART.map((path) => (
            <View key={path} style={[styles.cell, cell ? { height: cell } : null]}>
              <Pressable onPress={() => onPick(path)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Use ${path}`} style={StyleSheet.absoluteFill}>
                <ExpoImage source={{ uri: `${APP_URL}${path}` }} style={StyleSheet.absoluteFill} contentFit="cover" />
              </Pressable>
            </View>
          ))}
        </View>
        <Text style={styles.dropBlurb}>Square works best.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.preview, { aspectRatio: 1 }]}>
      <ExpoImage source={{ uri: photo ? photo.uri : (juno.media(media) ?? undefined) }} style={StyleSheet.absoluteFill} contentFit="cover" />
      {photo ? (
        <View style={styles.photoTag}>
          <Text style={styles.changeText}>{`Your photo · ${Math.round(photo.size / 1000)} kB · goes on Fuji at launch`}</Text>
        </View>
      ) : null}
      <Pressable onPress={() => onPick(null)} disabled={disabled} style={styles.change} accessibilityRole="button">
        <Text style={styles.changeText}>Change</Text>
      </Pressable>
    </View>
  );
}

function Field({ label, hint, note, children }: { label: string; hint?: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      {note ? <Text style={styles.fieldNote} numberOfLines={1}>{note}</Text> : null}
    </View>
  );
}

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

type LogEntry = { label: string; receipt: string; kind?: "tx" | "address"; at: Date };

function shorten(value: string): string {
  const bare = value.replace(/^ipfs:\/\//, "");
  return bare.length > 14 ? `${bare.slice(0, 6)}…${bare.slice(-6)}` : bare;
}

/** The launch, step by step, with each receipt and the second it landed. */
function LaunchLog({ entries }: { entries: LogEntry[] }) {
  return (
    <View style={styles.log}>
      {entries.map((entry, index) => (
        <Pressable
          key={`${entry.label}-${index}`}
          disabled={!entry.kind}
          onPress={() => (entry.kind ? void Linking.openURL(explorer(entry.kind, entry.receipt)) : undefined)}
          style={styles.logRow}
          accessibilityRole={entry.kind ? "link" : undefined}
        >
          <Text style={styles.logTick}>✓</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.logLabel}>{entry.label}</Text>
            <Text style={styles.logReceipt} numberOfLines={1}>
              {entry.kind === "tx" ? "tx " : entry.receipt.startsWith("ipfs://") ? "ipfs " : ""}
              {shorten(entry.receipt)}
            </Text>
          </View>
          <Text style={styles.logTime}>
            {entry.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  body: { paddingHorizontal: 16, paddingBottom: 140, gap: 12 },
  title: { fontSize: theme.type.screen.size, fontWeight: "800", color: theme.colors.ink },
  lede: { fontSize: theme.type.body.size, color: theme.colors.muted, lineHeight: 21 },
  form: { gap: 16 },
  fieldLabel: { fontSize: theme.type.label.size, fontWeight: "500", color: theme.colors.muted },
  fieldHint: { fontSize: theme.type.micro.size, fontWeight: "500", color: theme.colors.neg },
  fieldNote: { fontSize: theme.type.micro.size, fontWeight: "600", color: theme.colors.muted },
  grid: { alignSelf: "stretch", flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 14, justifyContent: "center" },
  cell: { width: "31%", aspectRatio: 1, borderRadius: 14, overflow: "hidden", backgroundColor: theme.colors.surfaceAlt },
  input: {
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    paddingHorizontal: 16,
    fontSize: theme.type.body.size,
    color: theme.colors.text,
  },
  sectionTitle: { fontSize: theme.type.title.size, fontWeight: "700", color: theme.colors.text, marginTop: 8 },
  sectionLede: { fontSize: theme.type.label.size, fontWeight: "500", color: theme.colors.muted, lineHeight: 19 },
  presets: { gap: 8 },
  preset: { gap: 6, padding: 16 },
  presetOn: { borderWidth: 2, borderColor: theme.colors.lime },
  presetRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  presetText: { flex: 1, gap: 6 },
  presetHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  presetLabel: { fontSize: theme.type.body.size, fontWeight: "600", color: theme.colors.ink },
  presetBlurb: { fontSize: theme.type.label.size, fontWeight: "500", color: theme.colors.muted, lineHeight: 19 },
  errorCard: { backgroundColor: "rgba(217,45,32,0.08)" },
  errorText: { fontSize: theme.type.body.size, color: theme.colors.neg, lineHeight: 21 },
  caption: { height: 88, paddingTop: 12, textAlignVertical: "top" },
  log: {
    backgroundColor: theme.colors.ink,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  logRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  logTick: { color: theme.colors.lime, fontSize: 14, fontWeight: "900" },
  logLabel: { color: theme.colors.onInk, fontSize: 14, fontWeight: "700" },
  logReceipt: { color: "#9FB09A", fontSize: 12, fontFamily: MONO, marginTop: 2 },
  logTime: { color: "#9FB09A", fontSize: 12, fontFamily: MONO },
  missing: { fontSize: theme.type.label.size, fontWeight: "600", color: theme.colors.muted, textAlign: "center" },
  drop: {
    width: "100%",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  dropDisc: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.lime,
  },
  dropPlus: { fontSize: 30, fontWeight: "600", color: theme.colors.onLime, marginTop: -3 },
  dropTitle: { fontSize: theme.type.body.size, fontWeight: "800", color: theme.colors.text },
  dropBlurb: { fontSize: theme.type.label.size, color: theme.colors.muted },
  preview: {
    width: "100%",
    borderRadius: theme.radius.lg,
    overflow: "hidden",
    backgroundColor: theme.colors.ink,
  },
  change: {
    position: "absolute",
    right: 12,
    bottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  changeText: { fontSize: 13, fontWeight: "700", color: "#FFFFFF" },
  photoRow: { flexDirection: "row", gap: 10, alignSelf: "stretch", paddingHorizontal: 14 },
  photoButton: { flex: 1 },
  orRule: { alignSelf: "stretch", height: 1, backgroundColor: theme.colors.line, marginHorizontal: 14, marginVertical: 6 },
  photoTag: {
    position: "absolute",
    left: 12,
    top: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  footnote: { fontSize: theme.type.micro.size, fontWeight: "500", color: theme.colors.faint, lineHeight: 16, marginTop: 8 },
});
