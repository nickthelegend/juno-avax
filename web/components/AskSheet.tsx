import { useEffect, useState } from "react";
import { TextInput } from "react-native";
import styled from "styled-components/native";

import { BottomSheet } from "./BottomSheet";
import { Body, Button, Caption, Title } from "./kit";
import { Tappable } from "./Press";
import { askJuno, type AiAnswer } from "../lib/ai";
import { theme } from "../theme";

const SUGGESTED = ["Explain this coin", "How did the opening clear?", "Floor vs. spot price?", "Who holds the most?"];

/**
 * Juno AI on a coin: ask in plain words; the answer comes from live Fuji reads
 * made by the agent on Juno's API, and each read shows as a chip. It explains;
 * it cannot sign or trade.
 */
export function AskSheet({ visible, onClose, coin, symbol }: { visible: boolean; onClose: () => void; coin: string; symbol: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAnswer(null);
    setError(null);
    setQuestion("");
  }, [visible, coin]);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setQuestion(text);
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await askJuno(text, coin));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Juno AI did not answer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Sheet>
        <Title>Ask about ${symbol}</Title>
        <Chips>
          {SUGGESTED.map((s) => (
            <Tappable key={s} onPress={() => void ask(s)} to={0.96} disabled={busy}>
              <Chip $on={question === s} accessibilityRole="button" accessibilityLabel={s}>
                <ChipText $on={question === s}>{s}</ChipText>
              </Chip>
            </Tappable>
          ))}
        </Chips>
        <Input
          value={question}
          onChangeText={setQuestion}
          placeholder="Or ask your own question"
          placeholderTextColor={theme.colors.faint}
          onSubmitEditing={() => void ask(question)}
          returnKeyType="send"
          maxLength={400}
          accessibilityLabel="Question for Juno AI"
        />
        <Button label={busy ? "Reading Fuji…" : "Ask Juno AI"} variant="lime" loading={busy} disabled={!question.trim()} onPress={() => void ask(question)} />

        {answer ? (
          <Answer>
            {answer.tools.length ? (
              <Chips>
                {answer.tools.map((t, i) => (
                  <ToolChip key={`${t.name}-${i}`}>
                    <ToolText>{t.label}</ToolText>
                  </ToolChip>
                ))}
              </Chips>
            ) : null}
            <Body>{answer.answer}</Body>
            <Caption>
              {answer.model} · {(answer.ms / 1000).toFixed(1)} s · read-only
            </Caption>
          </Answer>
        ) : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </Sheet>
    </BottomSheet>
  );
}

const Sheet = styled.View`
  gap: ${(p) => p.theme.space(3)}px;
  padding: ${(p) => p.theme.space(2)}px ${(p) => p.theme.space(5)}px ${(p) => p.theme.space(8)}px;
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

const ToolChip = styled.View`
  padding: 4px 10px;
  border-radius: 999px;
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;

const ToolText = styled.Text`
  font-size: ${(p) => p.theme.type.caption.size}px;
  font-weight: 600;
  color: ${(p) => p.theme.colors.muted};
`;

const Input = styled(TextInput)`
  height: 48px;
  padding-horizontal: 14px;
  border-radius: 14px;
  font-size: 16px;
  color: ${(p) => p.theme.colors.text};
  background-color: ${(p) => p.theme.colors.surfaceAlt};
`;

const Answer = styled.View`
  gap: 10px;
  padding: 14px;
  border-radius: ${(p) => p.theme.radius.md}px;
  background-color: ${(p) => p.theme.colors.surface};
  border-width: 1px;
  border-color: ${(p) => p.theme.colors.line};
`;

const ErrorText = styled.Text`
  font-size: ${(p) => p.theme.type.label.size}px;
  color: ${(p) => p.theme.colors.neg};
`;
