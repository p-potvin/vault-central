import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from 'react';
import * as Icons from '../lib/icons';
export const PromptDialog = ({ message, type, onCancel, onConfirm }) => {
    const inputRef = useRef(null);
    const submit = () => onConfirm(inputRef.current?.value ?? '');
    return (_jsx("div", { className: "fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4", children: _jsxs("div", { className: "bg-vault-cardBg border border-vault-border rounded-lg shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95", children: [_jsxs("h3", { className: "text-vault-text font-bold mb-4 flex items-center gap-2", children: [_jsx(Icons.DebugIcon, { size: 20, className: "text-vault-accent" }), " Input Required"] }), _jsx("p", { className: "text-vault-muted text-sm mb-3", children: message }), _jsx("input", { ref: inputRef, autoFocus: true, type: type === 'password' ? 'password' : 'text', className: "w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:outline-none focus:border-vault-accent focus:ring-1 focus:ring-vault-accent/30", onKeyDown: (e) => {
                        if (e.key === 'Enter')
                            submit();
                        if (e.key === 'Escape')
                            onCancel();
                    } }), _jsxs("div", { className: "flex justify-end gap-3 mt-6", children: [_jsx("button", { onClick: onCancel, className: "px-4 py-1.5 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors", children: "Cancel" }), _jsx("button", { onClick: submit, className: "px-4 py-1.5 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg", children: "Submit" })] })] }) }));
};
