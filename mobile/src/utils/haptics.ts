import { Platform, Vibration } from 'react-native';

export function lightHaptic() {
  if ((Platform.OS as string) === 'web') {
    return;
  }

  Vibration.vibrate(8);
}

export function successHaptic() {
  if ((Platform.OS as string) === 'web') {
    return;
  }

  Vibration.vibrate(14);
}
