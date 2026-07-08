import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

/** Ant Design v6 enterprise theme — https://ant.design/design.md */
export const proxyTheme: ThemeConfig = {
  cssVar: { key: 'proxy' },
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#1677FF',
    colorInfo: '#1677FF',
    colorSuccess: '#52C41A',
    colorWarning: '#FAAD14',
    colorError: '#FF4D4F',
    colorBgLayout: '#F5F5F5',
    colorBgContainer: '#FFFFFF',
    colorText: '#1F1F1F',
    colorTextSecondary: '#595959',
    colorTextDisabled: '#BFBFBF',
    colorBorder: '#D9D9D9',
    colorBorderSecondary: '#F0F0F0',
    borderRadius: 6,
    borderRadiusLG: 8,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    controlHeight: 32,
    motionDurationMid: '0.2s',
    boxShadowTertiary:
      '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
    boxShadowSecondary:
      '0 6px 16px 0 rgba(0, 0, 0, 0.08), 0 3px 6px -4px rgba(0, 0, 0, 0.12), 0 9px 28px 8px rgba(0, 0, 0, 0.05)',
  },
  components: {
    Layout: {
      siderBg: '#001529',
      triggerBg: '#002140',
      headerBg: '#FFFFFF',
      bodyBg: '#F5F5F5',
      headerHeight: 56,
    },
    Menu: {
      darkItemBg: '#001529',
      darkItemSelectedBg: '#1677FF',
      darkItemHoverBg: 'rgba(255,255,255,0.08)',
      darkSubMenuItemBg: '#000c17',
      itemBorderRadius: 6,
      itemMarginInline: 8,
      itemHeight: 40,
    },
    Card: {
      borderRadiusLG: 8,
      paddingLG: 20,
      boxShadowTertiary:
        '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)',
    },
    Table: {
      headerBg: '#FAFAFA',
      headerColor: '#1F1F1F',
      rowHoverBg: '#E6F4FF',
      borderColor: '#F0F0F0',
      cellPaddingBlock: 12,
      cellPaddingInline: 16,
    },
    Button: {
      borderRadius: 6,
    },
    Segmented: {
      borderRadius: 6,
    },
    Statistic: {
      titleFontSize: 12,
      contentFontSize: 24,
    },
    Breadcrumb: {
      fontSize: 14,
      itemColor: '#595959',
      lastItemColor: '#1F1F1F',
    },
  },
};

/** Semantic chip colors — proxy domain (design doc §8) */
export const proxySemantic = {
  http: { bg: '#E6F4FF', text: '#0958D9', border: '#91CAFF' },
  socks: { bg: '#FFF0F6', text: '#9E1068', border: '#FFADD2' },
  running: { bg: '#F6FFED', text: '#52C41A' },
  error: { bg: '#FFF2F0', text: '#FF4D4F' },
} as const;