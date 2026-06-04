import type { useEmailVerification } from "@/features/auth/hooks/useEmailVerification.js";

type EmailVerificationNoticeProps = ReturnType<typeof useEmailVerification>;

export function EmailVerificationNotice({
    verificationLoading,
    verificationMessage,
    sendVerification,
}: EmailVerificationNoticeProps) {
    return (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-yellow-700">
                    Подтвердите почту в течение 2 часов, чтобы аккаунт не был удален.
                </p>

                <button
                    type="button"
                    onClick={sendVerification}
                    disabled={verificationLoading}
                    className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white transition hover:bg-amber-700 disabled:opacity-50 cursor-pointer"
                >
                    {verificationLoading ? 'Отправка...' : 'Отправить письмо'}
                </button>
            </div>

            {verificationMessage && (
                <p className={`mt-1 text-xs ${
                    verificationMessage.type === 'success'
                        ? 'text-green-700'
                        : 'text-red-700'
                }`}>
                    {verificationMessage.text}
                </p>
            )}
        </div>
    );
}
