import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import { vaultUnlock } from '../lib/vault-client';
import { cn } from '../lib/utils';
import * as Icons from '../lib/icons';
export const LockedBanner = ({ visible, pinLength, onUnlocked }) => {
    const [pin, setPin] = useState(() => new Array(pinLength).fill(''));
    const [error, setError] = useState(false);
    const [busy, setBusy] = useState(false);
    const inputs = useRef([]);
    useEffect(() => {
        if (visible) {
            setPin(new Array(pinLength).fill(''));
            setError(false);
            // Defer focus so the transition completes first
            const t = setTimeout(() => inputs.current[0]?.focus(), 120);
            return () => clearTimeout(t);
        }
    }, [visible, pinLength]);
    const verify = async (full) => {
        setBusy(true);
        const res = await vaultUnlock(full);
        setBusy(false);
        if (res.success) {
            onUnlocked();
        }
        else {
            setError(true);
            setPin(new Array(pinLength).fill(''));
            inputs.current[0]?.focus();
        }
    };
    const onChange = (idx, v) => {
        if (!/^\d*$/.test(v))
            return;
        const next = [...pin];
        next[idx] = v.slice(-1);
        setPin(next);
        setError(false);
        if (v && idx < pinLength - 1)
            inputs.current[idx + 1]?.focus();
        const full = next.join('');
        if (full.length === pinLength)
            verify(full);
    };
    const onKeyDown = (idx, e) => {
        if (e.key === 'Backspace' && !pin[idx] && idx > 0)
            inputs.current[idx - 1]?.focus();
    };
    if (!visible)
        return null;
    return (_jsx("div", { role: "alert", "aria-live": "polite", className: cn('fixed inset-x-0 top-0 z-[120] flex justify-center pointer-events-none transition-all duration-300'), children: _jsxs("div", { className: "pointer-events-auto mt-4 max-w-lg w-full mx-4 bg-vault-cardBg border border-vault-border rounded-xl shadow-2xl backdrop-blur-md p-5 flex items-center gap-4 animate-in slide-in-from-top-4 fade-in duration-300", children: [_jsx(Icons.PinIcon, { size: 24, className: cn('shrink-0', error ? 'text-red-400' : 'text-vault-accent') }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("h3", { className: "text-sm font-bold text-vault-text tracking-tight", children: "Vault locked" }), _jsx("p", { className: "text-[11px] text-vault-muted mt-0.5", children: error ? 'Wrong PIN — try again' : `Auto-lock fired. Enter your ${pinLength}-digit PIN to continue.` })] }), _jsx("div", { className: "flex gap-1.5 shrink-0", children: pin.map((digit, i) => (_jsx("input", { ref: el => { inputs.current[i] = el; }, type: "password", inputMode: "numeric", pattern: "[0-9]*", maxLength: 1, value: digit, disabled: busy, onChange: e => onChange(i, e.target.value), onKeyDown: e => onKeyDown(i, e), className: cn('w-7 h-9 text-center text-sm font-mono font-bold rounded-md border outline-none transition-all duration-150', 'bg-vault-bg/60 text-vault-text', error
                            ? 'border-red-400/60 text-red-400'
                            : digit
                                ? 'border-vault-accent/60'
                                : 'border-vault-border focus:border-vault-accent', busy && 'opacity-50') }, i))) })] }) }));
};
