import { memo, type CSSProperties } from 'react';
import type { ReactionSummary } from '@/shared/types/domain.js';

interface MessageReactionsProps {
    reactions?: ReactionSummary[];
    isOwn: boolean;
    disabled?: boolean;
    onToggle: (emoji: string) => void;
}

function MessageReactionsComponent({
    reactions = [],
    isOwn,
    disabled,
    onToggle,
}: MessageReactionsProps) {
    if (!reactions.length) {
        return null;
    }

    return (
        <div className={`message-reactions ${isOwn ? 'message-reactions--own' : ''}`}>
            {reactions.map((reaction, index) => {
                const style = { '--reaction-index': index } as CSSProperties;

                return (
                    <button
                        key={`${reaction.emoji}-${reaction.count}-${reaction.reacted_by_me}`}
                        type="button"
                        className={`message-reaction ${reaction.reacted_by_me ? 'message-reaction--selected' : ''}`}
                        style={style}
                        disabled={disabled}
                        onClick={event => {
                            const shouldAnimateRemoval = reaction.reacted_by_me
                                && reaction.count === 1
                                && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                            if (!shouldAnimateRemoval) {
                                onToggle(reaction.emoji);
                                return;
                            }
                            event.currentTarget.classList.add('message-reaction--exit');
                            window.setTimeout(() => onToggle(reaction.emoji), 150);
                        }}
                        aria-label={`${reaction.reacted_by_me ? 'Убрать' : 'Поставить'} реакцию ${reaction.emoji}`}
                    >
                        <span className="message-reaction__emoji">{reaction.emoji}</span>
                        {reaction.count > 1 && <span className="message-reaction__count">{reaction.count}</span>}
                    </button>
                );
            })}
        </div>
    );
}

export const MessageReactions = memo(MessageReactionsComponent);
