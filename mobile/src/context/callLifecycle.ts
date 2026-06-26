type ShutdownCallHandler = () => Promise<void> | void;

let shutdownHandler: ShutdownCallHandler | null = null;

export function registerCallShutdownHandler(handler: ShutdownCallHandler) {
  shutdownHandler = handler;
  return () => {
    if (shutdownHandler === handler) {
      shutdownHandler = null;
    }
  };
}

export async function shutdownCurrentCallForLogout() {
  await shutdownHandler?.();
}
