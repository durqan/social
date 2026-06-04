interface DeleteConfirmModalProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteConfirmModal = ({ isOpen, onConfirm, onCancel }: DeleteConfirmModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
            <div className="app-card w-full max-w-sm p-5 shadow-xl sm:p-6">
                <h3 className="text-lg font-semibold mb-2">Удалить сообщения?</h3>
                <p className="text-gray-600 mb-4">Вы уверены, что хотите удалить выбранные сообщения? Это действие необратимо.</p>
                <div className="flex gap-3">
                    <button onClick={onConfirm} className="flex-1 rounded-xl bg-red-500 px-4 py-2 text-white hover:bg-red-600">
                        Удалить
                    </button>
                    <button onClick={onCancel} className="flex-1 rounded-xl bg-gray-100 px-4 py-2 text-gray-800 hover:bg-gray-200">
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
};
