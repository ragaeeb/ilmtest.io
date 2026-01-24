import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface Props {
    children: ReactNode;
    delay?: number;
}

export function MotionSection({ children, delay = 0 }: Props) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay }}
        >
            {children}
        </motion.div>
    );
}
