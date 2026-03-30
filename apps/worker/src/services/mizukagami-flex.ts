/**
 * MIZUKAGAMI 診断結果 Flex Message テンプレート
 *
 * 核/本領/見失いの3層をリッチに表示。
 * ビッグバンモデル: 核に集約する方向のみ示す。
 * 見失い: 「気づきのツール」として提示（断定しない）。
 */

// 先天螺旋の表示名マッピング
const SPIRAL_DISPLAY: Record<string, { kanji: string; color: string }> = {
  地: { kanji: "地", color: "#8B7355" },
  水: { kanji: "水", color: "#4A90E2" },
  火: { kanji: "火", color: "#E74C3C" },
  風: { kanji: "風", color: "#27AE60" },
  空: { kanji: "空", color: "#8E44AD" },
  識: { kanji: "識", color: "#F39C12" },
};

interface UnleashData {
  kaku: { name: string; description: string };
  honryou: { name: string; description: string };
  miushinai: { name: string; description: string };
}

/**
 * 診断結果の Flex Message を構築
 */
export function buildDiagnosisFlexMessage(
  spiralPrimary: string,
  unleash: UnleashData,
  confidence: number,
  consensus?: { agreementScore: number; narrative: string },
): {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
} {
  const spiral = SPIRAL_DISPLAY[spiralPrimary] ?? {
    kanji: spiralPrimary,
    color: "#FFFFFF",
  };
  const consensusPercent = consensus
    ? Math.round(consensus.agreementScore * 100)
    : Math.round(confidence * 100);

  return {
    type: "flex",
    altText: `MIZUKAGAMI 診断結果 — 核: ${unleash.kaku.name}`,
    contents: {
      type: "bubble",
      size: "giga",
      styles: {
        header: { backgroundColor: "#050008" },
        body: { backgroundColor: "#050008" },
        footer: { backgroundColor: "#0a0010" },
      },
      header: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        contents: [
          {
            type: "text",
            text: "MIZUKAGAMI",
            size: "xs",
            color: "#8E8E8E",
            align: "center",
          },
          {
            type: "text",
            text: `先天螺旋【${spiral.kanji}】`,
            weight: "bold",
            size: "xl",
            color: spiral.color,
            align: "center",
            margin: "sm",
          },
          {
            type: "text",
            text: `8叡智合意度: ${consensusPercent}%`,
            size: "xxs",
            color: "#6E6E6E",
            align: "center",
            margin: "sm",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "lg",
        paddingAll: "20px",
        contents: [
          // 核（Kaku）セクション
          buildSectionBox(
            "核 — あなたの本質",
            unleash.kaku.name,
            unleash.kaku.description,
            spiral.color,
          ),
          { type: "separator", color: "#1a1a2e" },
          // 本領（Honryou）セクション
          buildSectionBox(
            "本領 — 核につながっている時の力",
            unleash.honryou.name,
            unleash.honryou.description,
            "#C8C8C8",
          ),
          { type: "separator", color: "#1a1a2e" },
          // 見失い（Miushinai）セクション
          buildSectionBox(
            "見失い — 核から離れた時のサイン",
            unleash.miushinai.name,
            unleash.miushinai.description,
            "#7E7E9E",
          ),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        spacing: "sm",
        contents: [
          {
            type: "button",
            action: {
              type: "message",
              label: "もう一度診断する",
              text: "診断",
            },
            style: "primary",
            color: "#1a1a3e",
            height: "sm",
          },
          {
            type: "text",
            text: "同じ生年月日 = 同じ結果。\nこれがあなたの不変の核です。",
            size: "xxs",
            color: "#4E4E6E",
            align: "center",
            wrap: true,
            margin: "md",
          },
        ],
      },
    },
  };
}

function buildSectionBox(
  label: string,
  name: string,
  description: string,
  accentColor: string,
): Record<string, unknown> {
  return {
    type: "box",
    layout: "vertical",
    spacing: "sm",
    contents: [
      {
        type: "text",
        text: label,
        size: "xxs",
        color: "#6E6E8E",
      },
      {
        type: "text",
        text: name,
        weight: "bold",
        size: "lg",
        color: accentColor,
        wrap: true,
      },
      {
        type: "text",
        text: description,
        size: "sm",
        color: "#A8A8C8",
        wrap: true,
        margin: "sm",
      },
    ],
  };
}
