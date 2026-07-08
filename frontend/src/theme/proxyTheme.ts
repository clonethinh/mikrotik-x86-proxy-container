import type { ThemeConfig } from 'antd';
import { theme } from 'antd';

/** Ant Design v6 enterprise theme — see https://ant.design/design.md */
export const proxyTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    colorPrimary: '#1677FF',
    colorInfo: '#1677FF',
    colorSuccess: '#52C41A',
    colorWarning: '#FAAD14',
    colorError: '#FF4D4F',
    colorBgLayout: '#F5F5F5',
    colorBgContainer: '#FFFFFF',
    borderRadius: 6,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
    fontSize: 14,
    controlHeight: 32,
    motionDurationMid: '0.2s',
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
      itemBorderRadius: 6,
    },
    Card: {
      borderRadiusLG: 8,
      paddingLG: 20,
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
  },
};