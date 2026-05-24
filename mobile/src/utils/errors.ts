import { Alert } from 'react-native';

export function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function alertError(error: unknown, fallback: string) {
  Alert.alert('Ошибка', getErrorMessage(error, fallback));
}
