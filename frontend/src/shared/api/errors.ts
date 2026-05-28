import { AxiosError } from 'axios';

type ErrorResponse = {
    error?: string;
    message?: string;
};

export const getApiError = (error: unknown): ErrorResponse & { networkError: boolean } => {
    if (error instanceof AxiosError) {
        return {
            error: error.response?.data?.error,
            message: error.response?.data?.message,
            networkError: error.message === 'Network Error',
        };
    }

    return { networkError: false };
};

export const getApiStatus = (error: unknown): number | undefined => {
    if (error instanceof AxiosError) {
        return error.response?.status;
    }
    return undefined;
};
