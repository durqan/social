interface DeleteConfirmModalProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export const DeleteConfirmModal = ({ isOpen, onConfirm, onCancel }: DeleteConfirmModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
                <h3 className="text-lg font-semibold mb-2">Удалить сообщения?</h3>
                <p className="text-gray-600 mb-4">Вы уверены, что хотите удалить выбранные сообщения? Это действие необратимо.</p>
                <div className="flex gap-3">
                    <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600">
                        Удалить
                    </button>
                    <button onClick={onCancel} className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
};
