import { Icon } from "@/shared/ui/Icon.js";

interface ScrollToBottomButtonProps {
    visible: boolean;
    hasNewMessages: boolean;
    onClick: () => void;
}

export function ScrollToBottomButton({
    visible,
    hasNewMessages,
    onClick,
}: ScrollToBottomButtonProps) {
    if (!visible) {
        return null;
    }

    return (
        <button
            type="button"
            className={`chat-scroll-bottom-button ${hasNewMessages ? 'chat-scroll-bottom-button--new' : ''}`}
            onClick={onClick}
            aria-label={hasNewMessages ? 'Показать новые сообщения' : 'Прокрутить вниз'}
            title={hasNewMessages ? 'Новые сообщения' : 'Вниз'}
        >
            {hasNewMessages ? <span className="chat-scroll-bottom-button__text">Новые</span> : null}
            <Icon name="arrowDown" className="h-4 w-4" />
        </button>
    );
}
