import { Icon, type IconName } from "@/shared/ui/Icon.js";

interface EmptyStateProps {
    icon: IconName;
    title: string;
    text?: string;
    className?: string;
}

export function EmptyState({ icon, title, text, className = '' }: EmptyStateProps) {
    return (
        <div className={`empty-state-card ${className}`}>
            <div className="empty-state-card__icon" aria-hidden="true">
                <Icon name={icon} className="h-6 w-6" />
            </div>
            <p className="empty-state-card__title">{title}</p>
            {text ? <p className="empty-state-card__text">{text}</p> : null}
        </div>
    );
}
