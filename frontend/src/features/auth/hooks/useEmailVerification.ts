import { useState } from 'react';

import { getApiError } from "@/shared/api/errors.js";
import { authService } from "@/features/auth/api/authService.js";

type VerificationMessage = {
    type: 'success' | 'error';
    text: string;
};

export function useEmailVerification() {
    const [verificationLoading, setVerificationLoading] = useState(false);
    const [verificationMessage, setVerificationMessage] = useState<VerificationMessage | null>(null);

    const sendVerification = async () => {
        setVerificationLoading(true);
        setVerificationMessage(null);

        try {
            await authService.sendVerificationEmail();
            setVerificationMessage({
                type: 'success',
                text: 'Письмо для подтверждения отправлено',
            });
        } catch (error: unknown) {
            const apiError = getApiError(error);
            setVerificationMessage({
                type: 'error',
                text: apiError.message || apiError.error || 'Не удалось отправить письмо',
            });
        } finally {
            setVerificationLoading(false);
        }
    };

    return {
        verificationLoading,
        verificationMessage,
        sendVerification,
    };
}
