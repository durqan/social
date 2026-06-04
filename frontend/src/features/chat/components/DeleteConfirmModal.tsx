interface DeleteConfirmModalProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteConfirmModal = ({ isOpen, onConfirm, onCancel }: DeleteConfirmModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
            <div className="app-card w-full max-w-sm p-5 shadow-app sm:p-6">
                <h3 className="text-lg font-semibold mb-2 text-text">Удалить сообщения?</h3>
                <p className="text-text-secondary mb-4">Вы уверены, что хотите удалить выбранные сообщения? Это действие необратимо.</p>
                <div className="flex gap-3">
                    <button onClick={onConfirm} className="flex-1 rounded-xl bg-danger px-4 py-2 text-white hover:bg-danger">
                        Удалить
                    </button>
                    <button onClick={onCancel} className="flex-1 rounded-xl bg-surface-hover px-4 py-2 text-text hover:bg-surface">
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
};
