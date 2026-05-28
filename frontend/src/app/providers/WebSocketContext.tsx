import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { WebSocketService } from "@/shared/api/ws.js";

const WebSocketContext = createContext<WebSocketService | null>(null);

export const WebSocketProvider = ({ children }: { children: ReactNode }) => {
    const service = useMemo(() => new WebSocketService(), []);

    return (
        <WebSocketContext.Provider value={service}>
            {children}
        </WebSocketContext.Provider>
    );
};

export const useWebSocket = () => {
    const service = useContext(WebSocketContext);
    if (!service) {
        throw new Error('useWebSocket must be used within WebSocketProvider');
    }
    return service;
};
