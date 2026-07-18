/**
 * @format
 */
import { AppRegistry } from 'react-native';
import { registerGlobals } from '@livekit/react-native';
import App from './App';
import { name as appName } from './app.json';
import { registerBackgroundMessageHandler } from './src/notifications/pushNotifications';

registerGlobals();
registerBackgroundMessageHandler();
AppRegistry.registerComponent(appName, () => App);
