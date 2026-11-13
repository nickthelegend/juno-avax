import { useEffect, useState } from "react";
import { Modal, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import styled from "styled-components/native";

import { BottomSheet } from "./BottomSheet";
import { Button } from "./kit";
import { JunoIcon } from "./logo";
import { NETWORK_NAME } from "../lib/chain";
import { theme } from "../theme";

/** What the Juno wallet asks its owner to approve: a transaction, or a signature. */
export type ApprovalRequest = {
  kind: "tx" | "sign";
  /** What the app is doing, e.g. "Place sealed bid". */
  title: string;
  /** Label/value rows: amount, contract, fee, message. */
  rows: { label: string; value: string }[];
  /** The Juno wallet's own address. */
  account: string;
};

/**
 * The Juno wallet's approval sheet. Core and MetaMask open their own window for every transaction; the Juno wallet
 * (a test key on this device) used to sign silently. Now it asks too: each transaction and each signature shows
 * what it does, where it goes and what it costs, and nothing is signed until Approve is tapped. Reject cancels the
 * step with no transaction sent.
 */
export function ApproveSheet({ request: live, onAnswer }: { request: ApprovalRequest | null; onAnswer: (approved: boolean) => void }) {
  // The last request stays rendered while the sheet slides away: emptying it mid-close changed the sheet's height,
  // which interrupted the closing animation and left the backdrop on screen.
  const [request, setShown] = useState<ApprovalRequest | null>(live);
  // In its own Modal so it sits above any sheet that asked for it (the trade sheet hid it before); the Modal stays up
  // until the sheet has slid away.
  const [layer, setLayer] = useState(!!live);
  useEffect(() => {
    if (live) {
      setShown(live);
      setLayer(true);
      return;
    }
    const timer = setTimeout(() => setLayer(false), 450);
    return () => clearTimeout(timer);
  }, [live]);
  if (!layer) return null;
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={() => onAnswer(false)}>
      <GestureHandlerRootView style={{ flex: 1 }}>
    <BottomSheet visible={!!live} onClose={() => onAnswer(false)}>
      {request ? (
        <Body_>
          <Head>
            <Badge>
              <JunoIcon size={20} />
            </Badge>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: theme.colors.muted }}>Juno wallet · {short(request.account)}</Text>
              <Text style={{ fontSize: 12, color: theme.colors.faint }}>{request.kind === "tx" ? `Transaction on ${NETWORK_NAME}` : "Signature, no transaction, no gas"}</Text>
            </View>
          </Head>
          <Text style={{ fontSize: 26, fontWeight: "800", color: theme.colors.text, letterSpacing: -0.5 }}>{request.title}</Text>
          <Rows>
            {request.rows.map((row, i) => (
              <RowLine key={row.label} $first={i === 0}>
                <Text style={{ fontSize: 14, color: theme.colors.muted }}>{row.label}</Text>
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.colors.text, flexShrink: 1, textAlign: "right" }} numberOfLines={3}>
                  {row.value}
                </Text>
              </RowLine>
            ))}
          </Rows>
          <Buttons>
            <View style={{ flex: 1 }}>
              <Button label="Reject" variant="quiet" tall onPress={() => onAnswer(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Approve" tall onPress={() => onAnswer(true)} />
            </View>
          </Buttons>
        </Body_>
      ) : null}
    </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  );
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

const Body_ = styled.View`
  padding: 6px 20px 28px;
  gap: 14px;
`;
const Head = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 12px;
`;
const Badge = styled.View`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  align-items: center;
  justify-content: center;
  background-color: ${theme.colors.ink};
`;
const Rows = styled.View`
  border-radius: 16px;
  background-color: ${theme.colors.surfaceAlt};
  padding: 4px 14px;
`;
const RowLine = styled.View<{ $first?: boolean }>`
  flex-direction: row;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-top-width: ${(p) => (p.$first ? 0 : 1)}px;
  border-top-color: ${theme.colors.line};
`;
const Buttons = styled.View`
  flex-direction: row;
  gap: 10px;
  margin-top: 4px;
`;
