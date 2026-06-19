import type { CSSProperties } from 'react';

const particles = [
    { x: -26, y: -30, rotate: -18, delay: 0 },
    { x: -10, y: -42, rotate: 12, delay: 30 },
    { x: 12, y: -38, rotate: -10, delay: 55 },
    { x: 28, y: -25, rotate: 20, delay: 20 },
];

export function ReactionBurst({ emoji, effectKey }: { emoji: string; effectKey: number }) {
    return (
        <span key={effectKey} className="reaction-burst" aria-hidden="true">
            <span className="reaction-burst__core">{emoji}</span>
            {particles.map((particle, index) => (
                <span
                    key={index}
                    className="reaction-burst__particle"
                    style={{
                        '--burst-x': `${particle.x}px`,
                        '--burst-y': `${particle.y}px`,
                        '--burst-rotate': `${particle.rotate}deg`,
                        '--burst-delay': `${particle.delay}ms`,
                    } as CSSProperties}
                >
                    {index % 2 === 0 ? emoji : '✦'}
                </span>
            ))}
        </span>
    );
}
