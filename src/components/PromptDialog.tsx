import React, { useRef } from 'react';
import * as Icons from '../lib/icons';

interface PromptDialogProps {
  message: string;
  type?: 'password' | 'text';
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export const PromptDialog: React.FC<PromptDialogProps> = ({ message, type, onCancel, onConfirm }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => onConfirm(inputRef.current?.value ?? '');
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-vault-cardBg border border-vault-border rounded-lg shadow-2xl max-w-sm w-full p-6 animate-in zoom-in-95">
        <h3 className="text-vault-text font-bold mb-4 flex items-center gap-2">
          <Icons.DebugIcon size={20} className="text-vault-accent" /> Input Required
        </h3>
        <p className="text-vault-muted text-sm mb-3">{message}</p>
        <input
          ref={inputRef}
          autoFocus
          type={type === 'password' ? 'password' : 'text'}
          className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:outline-none focus:border-vault-accent focus:ring-1 focus:ring-vault-accent/30"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onCancel} className="px-4 py-1.5 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors">Cancel</button>
          <button onClick={submit} className="px-4 py-1.5 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg">Submit</button>
        </div>
      </div>
    </div>
  );
};
