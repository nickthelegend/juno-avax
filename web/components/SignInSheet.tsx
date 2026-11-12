import { useEffect, useState } from "react";
import { Image, Linking } from "react-native";
import styled from "styled-components/native";

import { BottomSheet } from "./BottomSheet";
import { Object3D } from "./art3d";
import { Body, Button, Title } from "./kit";
import { Tappable } from "./Press";
import { JunoIcon } from "./logo";
import type { SignInBridge } from "../lib/wallet";
import type { WalletOption } from "../lib/browser-wallet";
import { FAUCET_URL, NETWORK_LABEL } from "../lib/chain";
import { KEY_HOME, LOCAL_ID } from "../lib/local-wallet";
import { theme } from "../theme";

/**
 * Connect a wallet. The sheet lists every wallet this browser announces
 * (EIP-6963), Core first; one tap asks it for an account and moves it to
 * Avalanche Fuji. The Juno wallet (a test key made on this device) is always
 * listed, so a first try needs nothing installed: one tap creates it and gets
 * its starter test AVAX from Juno's gas sponsor.
 */
export function SignInSheet({ visible, onClose, bridge }: { visible: boolean; onClose: () => void; bridge: SignInBridge }) {
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(null);
    setStatus(null);
    setWallets(null);
    let live = true;
    bridge
      .wallets()
      .then((list) => live && setWallets(list))
      .catch(() => live && setWallets([]));
    return () => {
      live = false;
    };
  }, [visible, bridge]);

  const connect = async (id: string) => {
    setBusy(id);
    setError(null);
    setStatus(null);
    try {
      await bridge.connect(id, setStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet did not connect");
    } finally {
      setBusy(null);
      setStatus(null);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} dismissable={!busy}>
      <Sheet>
        <TitleRow>
          <Title style={{ flexShrink: 1 }}>Connect to Juno</Title>
          <Object3D art="wallet" alt="" size={64} float eager style={{ margin: "-8px 0" }} />
        </TitleRow>
        <Body muted>Your own wallet signs every bid and trade. Juno never holds your keys or your AVAX.</Body>

        {wallets === null ? (
          <Hint>Looking for wallets…</Hint>
        ) : (
          <>
            {wallets.some((w) => w.id !== LOCAL_ID) ? null : <Body>No browser wallet found. Use a Juno wallet to try it now.</Body>}
            <List>
              {wallets.map((w) => {
                const isLocal = w.id === LOCAL_ID;
                return (
                  <Tappable key={w.id} onPress={() => void connect(w.id)} to={0.98} accessibilityRole="button" accessibilityLabel={isLocal ? "Use a Juno wallet" : `Connect ${w.name}`} disabled={!!busy}>
                    <Row>
                      {isLocal ? <JunoIcon size={32} radius={8} /> : w.icon ? <Image source={{ uri: w.icon }} style={{ width: 32, height: 32, borderRadius: 8 }} accessibilityIgnoresInvertColors /> : <Blank />}
                      <Names>
                        <Name numberOfLines={1}>{w.name}</Name>
                        {isLocal ? <Sub numberOfLines={1}>Test wallet in {KEY_HOME} · free test AVAX</Sub> : null}
                      </Names>
                      <Go>{busy === w.id ? (isLocal ? status ?? "Opening…" : "Approve in wallet…") : isLocal ? "Use" : "Connect"}</Go>
                    </Row>
                  </Tappable>
                );
              })}
            </List>
            {wallets.some((w) => w.id !== LOCAL_ID) ? null : (
              <Button label="Get Core wallet" variant="quiet" onPress={() => void Linking.openURL("https://core.app")} />
            )}
          </>
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}
        <Hint>
          {NETWORK_LABEL} ·{" "}
          <Link onPress={() => void Linking.openURL(FAUCET_URL)} accessibilityRole="link">
            get test AVAX
          </Link>
        </Hint>
      </Sheet>
    </BottomSheet>
  );
}

const Sheet = styled.View`
  gap: ${(p) => p.theme.space(3)}px;
  padding: ${(p) => p.theme.space(2)}px ${(p) => p.theme.space(5)}px ${(p) => p.theme.space(8)}px;
`;

const TitleRow = styled.View`
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: ${(p) => p.theme.space(3)}px;
`;

const List = styled.View`
  gap: ${(p) => p.theme.space(2)}px;
`;

const Row = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 10px 14px;
  border-radius: ${(p) => p.theme.radius.md}px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;

const Blank = styled.View`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background-color: ${(p) => p.theme.colors.ink};
`;

const Names = styled.View`
  flex: 1;
  gap: 2px;
`;

const Sub = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  color: ${(p) => p.theme.colors.muted};
`;

const Name = styled.Text`
  font-size: ${(p) => p.theme.type.body.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.text};
`;

const Go = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  font-weight: 700;
  color: ${(p) => p.theme.colors.muted};
`;

const ErrorText = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  color: ${(p) => p.theme.colors.neg};
`;

const Hint = styled.Text`
  text-align: center;
  font-size: ${(p) => p.theme.type.caption.size}px;
  color: ${(p) => p.theme.colors.faint};
`;

const Link = styled.Text`
  color: ${(p) => p.theme.colors.focus};
  font-weight: 600;
`;
