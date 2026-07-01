import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/shared/ui/Button.js';
import { Icon, type IconName } from '@/shared/ui/Icon.js';

export type AppDialogVariant = 'default' | 'danger' | 'success';
export type AppDialogIcon = 'info' | 'success' | 'warning' | 'danger';
export type AppDialogType = AppDialogIcon;

export type AppAlertOptions = {
    title: string;
    message: string;
    confirmText?: string;
    icon?: AppDialogIcon;
    type?: AppDialogType;
};

export type AppConfirmOptions = {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    variant?: AppDialogVariant;
    icon?: AppDialogIcon;
    type?: AppDialogType;
};

type AppDialogRequest = {
    id: number;
    type: 'alert' | 'confirm';
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
    variant: AppDialogVariant;
    icon: AppDialogIcon;
    resolve: (confirmed: boolean) => void;
};

type AppDialogContextValue = {
    alert: (options: AppAlertOptions) => Promise<void>;
    confirm: (options: AppConfirmOptions) => Promise<boolean>;
};

type VariantConfig = {
    confirmVariant: 'primary' | 'danger';
    confirmStyle?: CSSProperties;
};

type IconConfig = {
    label: string;
    iconName: IconName;
    style: CSSProperties;
};

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

const variantConfig: Record<AppDialogVariant, VariantConfig> = {
    default: {
        confirmVariant: 'primary',
    },
    danger: {
        confirmVariant: 'danger',
    },
    success: {
        confirmVariant: 'primary',
        confirmStyle: {
            background: 'var(--app-success)',
            color: 'var(--app-text-inverse)',
        },
    },
};

const iconConfig: Record<AppDialogIcon, IconConfig> = {
    info: {
        label: 'Информация',
        iconName: 'info',
        style: {
            background: 'var(--app-accent-soft)',
            borderColor: 'var(--app-accent-border)',
            color: 'var(--app-accent)',
        },
    },
    success: {
        label: 'Готово',
        iconName: 'checkCircle',
        style: {
            background: 'var(--app-success-soft)',
            borderColor: 'var(--app-success-border)',
            color: 'var(--app-success)',
        },
    },
    warning: {
        label: 'Внимание',
        iconName: 'warning',
        style: {
            background: 'var(--app-warning-soft)',
            borderColor: 'var(--app-warning-border)',
            color: 'var(--app-warning)',
        },
    },
    danger: {
        label: 'Опасное действие',
        iconName: 'warning',
        style: {
            background: 'var(--app-error-soft)',
            borderColor: 'var(--app-error-border)',
            color: 'var(--app-error)',
        },
    },
};

function resolveAlertIcon(options: AppAlertOptions): AppDialogIcon {
    return options.icon || options.type || 'info';
}

function resolveConfirmIcon(options: AppConfirmOptions): AppDialogIcon {
    if (options.icon || options.type) {
        return options.icon || options.type || 'info';
    }

    if (options.variant === 'danger') {
        return 'danger';
    }

    if (options.variant === 'success') {
        return 'success';
    }

    return 'info';
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
    const [dialogs, setDialogs] = useState<AppDialogRequest[]>([]);
    const nextDialogIdRef = useRef(0);
    const resolvingDialogIdRef = useRef<number | null>(null);
    const activeDialog = dialogs[0] ?? null;

    useEffect(() => {
        resolvingDialogIdRef.current = null;
    }, [activeDialog?.id]);

    const enqueueDialog = useCallback((dialog: Omit<AppDialogRequest, 'id'>) => {
        nextDialogIdRef.current += 1;
        setDialogs(prev => [...prev, { ...dialog, id: nextDialogIdRef.current }]);
    }, []);

    const showAlert = useCallback((options: AppAlertOptions) => new Promise<void>(resolve => {
        enqueueDialog({
            type: 'alert',
            title: options.title,
            message: options.message,
            confirmText: options.confirmText || 'Понятно',
            cancelText: '',
            variant: 'default',
            icon: resolveAlertIcon(options),
            resolve: () => resolve(),
        });
    }), [enqueueDialog]);

    const showConfirm = useCallback((options: AppConfirmOptions) => new Promise<boolean>(resolve => {
        enqueueDialog({
            type: 'confirm',
            title: options.title,
            message: options.message,
            confirmText: options.confirmText || 'Подтвердить',
            cancelText: options.cancelText || 'Отмена',
            variant: options.variant || 'default',
            icon: resolveConfirmIcon(options),
            resolve,
        });
    }), [enqueueDialog]);

    const closeActiveDialog = useCallback((confirmed: boolean) => {
        if (!activeDialog || resolvingDialogIdRef.current === activeDialog.id) {
            return;
        }

        resolvingDialogIdRef.current = activeDialog.id;
        activeDialog.resolve(confirmed);
        setDialogs(prev => (
            prev[0]?.id === activeDialog.id
                ? prev.slice(1)
                : prev.filter(dialog => dialog.id !== activeDialog.id)
        ));
    }, [activeDialog]);

    const value = useMemo<AppDialogContextValue>(() => ({
        alert: showAlert,
        confirm: showConfirm,
    }), [showAlert, showConfirm]);

    return (
        <AppDialogContext.Provider value={value}>
            {children}
            <AppDialog
                dialog={activeDialog}
                onCancel={() => closeActiveDialog(false)}
                onConfirm={() => closeActiveDialog(true)}
            />
        </AppDialogContext.Provider>
    );
}

export function useAppDialog() {
    const context = useContext(AppDialogContext);

    if (!context) {
        throw new Error('useAppDialog must be used within AppDialogProvider');
    }

    return context;
}

type AppDialogProps = {
    dialog: AppDialogRequest | null;
    onCancel: () => void;
    onConfirm: () => void;
};

export function AppDialog({ dialog, onCancel, onConfirm }: AppDialogProps) {
    const titleId = useId();
    const messageId = useId();
    const confirmButtonRef = useRef<HTMLButtonElement>(null);
    const dialogId = dialog?.id;

    useEffect(() => {
        if (dialogId == null) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        const activeElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        const frame = window.requestAnimationFrame(() => {
            confirmButtonRef.current?.focus();
        });

        document.body.style.overflow = 'hidden';

        return () => {
            window.cancelAnimationFrame(frame);
            document.body.style.overflow = previousOverflow;
            activeElement?.focus();
        };
    }, [dialogId]);

    useEffect(() => {
        if (!dialog) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }

            event.preventDefault();
            onCancel();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dialog, onCancel]);

    if (!dialog || typeof document === 'undefined') {
        return null;
    }

    const config = variantConfig[dialog.variant];
    const icon = iconConfig[dialog.icon];
    const isConfirm = dialog.type === 'confirm';

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-end justify-center bg-[var(--app-overlay)] px-3 py-4 sm:items-center sm:px-4"
            aria-hidden={false}
        >
            <div
                role={dialog.variant === 'danger' ? 'alertdialog' : 'dialog'}
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={messageId}
                className="app-card w-full max-w-md overflow-hidden shadow-2xl outline-none"
                onClick={event => event.stopPropagation()}
            >
                <div className="h-1.5" style={{ background: icon.style.color }} />
                <div className="p-5 sm:p-6">
                    <div className="flex items-start gap-4">
                        <span
                            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border"
                            style={icon.style}
                            aria-hidden="true"
                        >
                            <Icon name={icon.iconName} className="h-6 w-6" />
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--app-text-soft)]">
                                {icon.label}
                            </p>
                            <h2 id={titleId} className="text-lg font-semibold leading-6 text-[var(--app-text-primary)]">
                                {dialog.title}
                            </h2>
                            <p id={messageId} className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--app-text-secondary)]">
                                {dialog.message}
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        {isConfirm && (
                            <Button
                                type="button"
                                variant="secondary"
                                className="w-full sm:w-auto"
                                onClick={onCancel}
                            >
                                {dialog.cancelText}
                            </Button>
                        )}
                        <Button
                            ref={confirmButtonRef}
                            type="button"
                            variant={config.confirmVariant}
                            style={config.confirmStyle}
                            className="w-full sm:w-auto"
                            onClick={onConfirm}
                        >
                            {dialog.confirmText}
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
