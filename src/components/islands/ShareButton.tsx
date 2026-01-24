import { Copy } from 'lucide-react';
import { useState } from 'react';

interface Props {
    text: string;
    className?: string;
    ariaLabel?: string;
}

export function ShareButton({ text, className = '', ariaLabel = 'Copy citation' }: Props) {
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

    return (
        <button
            type="button"
            className={`share-button ${status === 'copied' ? 'is-copied' : ''} ${className}`}
            onClick={handleCopy}
            aria-live="polite"
            aria-label={status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : ariaLabel}
            title={status === 'copied' ? 'Copied' : status === 'error' ? 'Copy failed' : ariaLabel}
        >
            <Copy size={18} strokeWidth={2} />
        </button>
    );
}
