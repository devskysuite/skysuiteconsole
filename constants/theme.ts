/**
 * SkySuite Console — navy/blue/teal colour palette
 */
import { Platform } from 'react-native';

export const SkySuiteColors = {
  navy:      '#0d2e5e',
  blue:      '#1565c0',
  teal:      '#00b4d8',
  lightBlue: '#eff6ff',
  lightTeal: '#e0f7fa',
};

const tintColorLight = '#1565c0';
const tintColorDark  = '#00b4d8';

export const Colors = {
  light: {
    text:            '#11181C',
    background:      '#f0f4fa',
    tint:            tintColorLight,
    icon:            '#4b6080',
    tabIconDefault:  '#4b6080',
    tabIconSelected: tintColorLight,
    primary:         '#1565c0',
    accent:          '#00b4d8',
    navy:            '#0d2e5e',
    card:            '#ffffff',
    border:          '#bfdbfe',
  },
  dark: {
    text:            '#ECEDEE',
    background:      '#0a1628',
    tint:            tintColorDark,
    icon:            '#7aa3c8',
    tabIconDefault:  '#7aa3c8',
    tabIconSelected: tintColorDark,
    primary:         '#00b4d8',
    accent:          '#1565c0',
    navy:            '#0d2e5e',
    card:            '#0d2e5e',
    border:          '#1e4080',
  },
};

export const Fonts = Platform.select({
  ios: {
    sans:    'system-ui',
    serif:   'ui-serif',
    rounded: 'ui-rounded',
    mono:    'ui-monospace',
  },
  default: {
    sans:    'normal',
    serif:   'serif',
    rounded: 'normal',
    mono:    'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
});
