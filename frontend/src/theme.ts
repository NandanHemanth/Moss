import { theme, type ThemeConfig } from "antd";

const shared: ThemeConfig["token"] = {
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  borderRadius: 8,
  fontSize: 14,
  controlHeight: 34,
};

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...shared,
    colorPrimary: "#2f6b45",
    colorLink: "#2f6b45",
    colorInfo: "#2f63b5",
    colorSuccess: "#3f8f5a",
    colorWarning: "#c2702d",
    colorError: "#b5413b",
    colorBgLayout: "#f6f7f5",
    colorBorderSecondary: "#ebedea",
    colorText: "#1c2420",
    colorTextSecondary: "#5b655f",
  },
  components: {
    Layout: { siderBg: "#ffffff", headerBg: "#ffffff", bodyBg: "#f6f7f5" },
    Menu: { itemSelectedBg: "#e8f1eb", itemSelectedColor: "#2f6b45", itemBorderRadius: 6 },
    Card: { headerFontSize: 15 },
    Table: { headerBg: "#fafbfa" },
  },
};

export const groveTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...shared,
    colorPrimary: "#8fc46a",
    colorLink: "#8fc46a",
    colorInfo: "#7fb7d9",
    colorSuccess: "#8fc46a",
    colorWarning: "#e0a95a",
    colorError: "#e07a6a",
    colorBgBase: "#0d1712",
    colorBgLayout: "transparent",
    colorBgContainer: "rgba(22, 36, 28, 0.86)",
    colorBgElevated: "#16241c",
    colorBorder: "rgba(143, 196, 106, 0.22)",
    colorBorderSecondary: "rgba(143, 196, 106, 0.14)",
    colorText: "#e7efe2",
    colorTextSecondary: "#a9bcaa",
    colorTextLightSolid: "#0d1712",
  },
  components: {
    Layout: { siderBg: "rgba(14, 25, 19, 0.92)", headerBg: "rgba(13, 23, 18, 0.85)", bodyBg: "transparent" },
    Menu: {
      itemBg: "transparent",
      itemSelectedBg: "rgba(143, 196, 106, 0.14)",
      itemSelectedColor: "#8fc46a",
      itemBorderRadius: 6,
    },
    Card: { headerFontSize: 15 },
    Table: { headerBg: "rgba(30, 48, 38, 0.6)", rowHoverBg: "rgba(143, 196, 106, 0.06)" },
    Segmented: {
      trackBg: "rgba(30, 48, 38, 0.7)",
      itemSelectedBg: "rgba(143, 196, 106, 0.2)",
      itemSelectedColor: "#8fc46a",
    },
  },
};
