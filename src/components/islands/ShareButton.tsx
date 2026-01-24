import { useState } from 'react';

interface Props {
    text: string;
    label?: string;
    className?: string;
}

export function ShareButton({ text, label = 'Copy', className = '' }: Props) {
    const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(text);
            setStatus('copied');
            setTimeout(() => setStatus('idle'), 1500);
        } catch {
            setStatus('error');
            setTimeout(() => setStatus('idle'), 1500);
        }
    };

    const statusLabel = status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : label;

    return (
        <button type="button" className={`share-button ${className}`} onClick={handleCopy} aria-live="polite">
            {statusLabel}
        </button>
    );
}
