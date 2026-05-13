import { toast } from 'react-hot-toast';

export const showMessageNotification = (name: string, content: string) => {
    toast(`${name}: ${content.slice(0, 50)}${content.length > 50 ? '...' : ''}`, {
        duration: 5000,
        position: 'top-right',
    });
};