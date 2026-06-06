import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import { vaultSetup } from '../lib/vault-client';
export const PinSetupDialog = ({ isOpen, onClose, onSuccess, onError, }) => {
    const [pinSetupLength, setPinSetupLength] = useState(4);
    const [pinSetupBoxes, setPinSetupBoxes] = useState([]);
    const [pinSetupError, setPinSetupError] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const pinSetupRefs = useRef([]);
    useEffect(() => {
        if (isOpen) {
            setPinSetupBoxes(new Array(pinSetupLength).fill(''));
            setPinSetupError(false);
            setTimeout(() => pinSetupRefs.current[0]?.focus(), 50);
        }
    }, [isOpen, pinSetupLength]);
    if (!isOpen)
        return null;
    const doConfirmPinSetup = async (pin, length) => {
        setIsSubmitting(true);
        try {
            const res = await vaultSetup(pin);
            if (!res.success) {
                onError(`PIN activation failed: ${res.error || 'unknown'}`);
                setPinSetupError(true);
                // Reset pin inputs on failure
                setPinSetupBoxes(new Array(length).fill(''));
                pinSetupRefs.current[0]?.focus();
            }
            else {
                onSuccess(length);
                onClose();
            }
        }
        catch (err) {
            onError(`PIN activation failed: ${err.message || 'setup failed'}`);
            setPinSetupError(true);
            setPinSetupBoxes(new Array(length).fill(''));
            pinSetupRefs.current[0]?.focus();
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const handlePinSetupChange = (index, value) => {
        if (!/^\d*$/.test(value))
            return;
        const newBoxes = [...pinSetupBoxes];
        newBoxes[index] = value.slice(-1);
        setPinSetupBoxes(newBoxes);
        setPinSetupError(false);
        if (value && index < newBoxes.length - 1) {
            pinSetupRefs.current[index + 1]?.focus();
        }
        const fullPin = newBoxes.join('');
        if (fullPin.length === pinSetupLength && /^\d+$/.test(fullPin)) {
            void doConfirmPinSetup(fullPin, pinSetupLength);
        }
    };
    const handlePinSetupKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !pinSetupBoxes[index] && index > 0) {
            pinSetupRefs.current[index - 1]?.focus();
        }
    };
    const handlePinSetupLengthChange = (len) => {
        setPinSetupLength(len);
        setPinSetupBoxes(new Array(len).fill(''));
        setPinSetupError(false);
    };
    const confirmPinSetup = async () => {
        const pin = pinSetupBoxes.join('');
        if (pin.length !== pinSetupLength || !/^\d+$/.test(pin)) {
            setPinSetupError(true);
            pinSetupRefs.current[0]?.focus();
            return;
        }
        void doConfirmPinSetup(pin, pinSetupLength);
    };
    return (_jsx("div", { className: "fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm", children: _jsxs("div", { className: "bg-vault-bg border border-vault-border rounded-lg shadow-2xl p-6 w-80 flex flex-col items-center gap-5 animate-in zoom-in-95 duration-200", children: [_jsxs("div", { className: "relative", children: [_jsx(Icons.PinIcon, { size: 28, className: "text-vault-accent" }), _jsx("div", { className: "absolute -inset-1 blur-lg bg-vault-accent/20 rounded-full" })] }), _jsxs("div", { className: "text-center", children: [_jsx("h3", { className: "text-sm font-black uppercase tracking-widest text-vault-text", children: "Set New PIN" }), _jsxs("p", { className: "text-[10px] text-vault-muted mt-1", children: ["Enter a ", pinSetupLength, "-digit security sequence"] })] }), _jsx("div", { className: "flex gap-2 w-full", children: [4, 6].map(len => (_jsxs("button", { onClick: () => handlePinSetupLengthChange(len), disabled: isSubmitting, className: cn("flex-1 py-1 text-[10px] font-black rounded-sm border transition-all", pinSetupLength === len
                            ? "bg-vault-accent border-vault-accent text-vault-bg"
                            : "bg-transparent border-vault-border text-vault-muted hover:border-vault-muted"), children: [len, " DIGITS"] }, len))) }), _jsx("div", { className: "flex gap-3 justify-center", children: pinSetupBoxes.map((digit, idx) => (_jsx("input", { ref: el => { pinSetupRefs.current[idx] = el; }, type: "password", inputMode: "numeric", pattern: "[0-9]*", maxLength: 1, value: digit, disabled: isSubmitting, onChange: e => handlePinSetupChange(idx, e.target.value), onKeyDown: e => handlePinSetupKeyDown(idx, e), className: cn("w-10 h-14 bg-vault-cardBg/50 border-2 rounded-xl text-center text-xl font-bold", "focus:border-vault-accent focus:bg-vault-accent/5 outline-none transition-all", pinSetupError ? 'border-red-500/50' : 'border-vault-border/50', digit ? 'border-vault-accent/50 scale-105 shadow-[0_0_12px_-4px_var(--vault-accent)]' : '') }, `${pinSetupLength}-${idx}`))) }), pinSetupError && (_jsxs("p", { className: "text-[10px] font-black text-red-500 uppercase tracking-tight animate-in slide-in-from-top-1", children: ["Enter exactly ", pinSetupLength, " numeric digits"] })), _jsxs("div", { className: "flex gap-3 w-full mt-1", children: [_jsx("button", { onClick: onClose, disabled: isSubmitting, className: "flex-1 px-4 py-2 text-xs font-bold text-vault-muted hover:text-vault-text border border-vault-border rounded hover:border-vault-muted transition-all", children: "Cancel" }), _jsx("button", { onClick: confirmPinSetup, disabled: isSubmitting, className: "flex-1 px-4 py-2 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all flex items-center justify-center gap-1", children: isSubmitting ? (_jsx(Icons.LoaderIcon, { size: 12, className: "animate-spin text-vault-bg" })) : ("Activate PIN") })] })] }) }));
};
