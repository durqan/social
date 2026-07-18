import { Vibration } from 'react-native';

export function lightHaptic() {
  Vibration.vibrate(8);
}
