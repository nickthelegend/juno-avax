import { useEffect, useState } from "react";
import { Image, Linking } from "react-native";
import styled from "styled-components/native";

import { BottomSheet } from "./BottomSheet";
import { Object3D } from "./art3d";
import { Body, Button, Title } from "./kit";
import { Tappable } from "./Press";
import type { SignInBridge } from "../lib/wallet";
import type { WalletOption } from "../lib/browser-wallet";
import { FAUCET_URL, NETWORK_LABEL } from "../lib/chain";
import { theme } from "../theme";

/**
 * Connect a wallet. The sheet lists every wallet this browser announces
 * (EIP-6963), Core first; one tap asks it for an account and moves it to
 * Avalanche Fuji. With no wallet installed it says so and links to Core,
 * rather than pretending.
 */
export function SignInSheet({ visible, onClose, bridge }: { visible: boolean; onClose: () => void; bridge: SignInBridge }) {
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(null);
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
    try {
      await bridge.connect(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet did not connect");
    } finally {
      setBusy(null);
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
        ) : wallets.length === 0 ? (
          <>
            <Body>No wallet found in this browser.</Body>
            <Button label="Get Core wallet" variant="lime" tall onPress={() => void Linking.openURL("https://core.app")} />
          </>
        ) : (
          <List>
            {wallets.map((w) => (
              <Tappable key={w.id} onPress={() => void connect(w.id)} to={0.98} accessibilityRole="button" accessibilityLabel={`Connect ${w.name}`} disabled={!!busy}>
                <Row>
                  {w.icon ? <Image source={{ uri: w.icon }} style={{ width: 32, height: 32, borderRadius: 8 }} accessibilityIgnoresInvertColors /> : <Blank />}
                  <Name numberOfLines={1}>{w.name}</Name>
                  <Go>{busy === w.id ? "Approve in wallet…" : "Connect"}</Go>
                </Row>
              </Tappable>
            ))}
          </List>
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

const Name = styled.Text`
  flex: 1;
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
