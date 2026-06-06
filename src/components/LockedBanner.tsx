import React, { useState, useRef, useEffect } from 'react';
import { vaultUnlock } from '../lib/vault-client';
import { cn } from '../lib/utils';
import * as Icons from '../lib/icons';

interface LockedBannerProps {
  visible: boolean;
  pinLength: number;
  onUnlocked: () => void;
}

export const LockedBanner: React.FC<LockedBannerProps> = ({ visible, pinLength, onUnlocked }) => {
  const [pin, setPin] = useState<string[]>(() => new Array(pinLength).fill(''));
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (visible) {
      setPin(new Array(pinLength).fill(''));
      setError(false);
      // Defer focus so the transition completes first
      const t = setTimeout(() => inputs.current[0]?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [visible, pinLength]);

  const verify = async (full: string) => {
    setBusy(true);
    const res = await vaultUnlock(full);
    setBusy(false);
    if (res.success) {
      onUnlocked();
    } else {
      setError(true);
      setPin(new Array(pinLength).fill(''));
      inputs.current[0]?.focus();
    }
  };

  const onChange = (idx: number, v: string) => {
    if (!/^\d*$/.test(v)) return;
    const next = [...pin];
    next[idx] = v.slice(-1);
    setPin(next);
    setError(false);
    if (v && idx < pinLength - 1) inputs.current[idx + 1]?.focus();
    const full = next.join('');
    if (full.length === pinLength) verify(full);
  };

  const onKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[idx] && idx > 0) inputs.current[idx - 1]?.focus();
  };

  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[120] bg-vault-bg/85 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-300">
      <div className="w-[320px] p-6 bg-vault-cardBg border border-vault-border rounded-2xl shadow-2xl flex flex-col items-center gap-6 select-none animate-in zoom-in-95 duration-200">
        <div className="relative">
          <Icons.PinIcon size={32} className={error ? "text-red-500 animate-bounce" : "text-vault-accent"} />
          <div className="absolute -inset-1 blur-lg bg-vault-accent/20 rounded-full" />
        </div>
        
        <div className="text-center space-y-1">
          <h2 className="text-xs font-mono font-black uppercase tracking-[0.2em] text-vault-text">Authenticating</h2>
          <p className="text-[10px] text-vault-muted font-bold tracking-tighter opacity-60">Enter {pinLength}-digit sequence</p>
        </div>

        <div className="flex gap-3 justify-center">
          {pin.map((digit, idx) => (
            <input
              key={idx}
              ref={el => { inputs.current[idx] = el; }}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              disabled={busy}
              onChange={e => onChange(idx, e.target.value)}
              onKeyDown={e => onKeyDown(idx, e)}
              className={cn(
                "w-10 h-14 bg-vault-bg/50 border-2 rounded-xl text-center text-xl font-bold text-vault-text",
                "focus:border-vault-accent focus:bg-vault-accent/5 outline-none transition-all duration-150",
                error ? "border-red-500/50 animate-shake" : "border-vault-border/50",
                digit ? "border-vault-accent/50 scale-105 shadow-[0_0_15px_-5px_var(--vault-accent)]" : "",
                busy && "opacity-50"
              )}
              autoFocus={idx === 0}
            />
          ))}
        </div>

        {error && (
          <p className="text-[10px] font-black text-red-500 uppercase tracking-tighter animate-in slide-in-from-top-1">
            Invalid Access Code
          </p>
        )}

        <div className="text-[9px] text-vault-muted font-bold uppercase tracking-widest opacity-40">
          Vault-Central Security Protocol 4.0
        </div>
      </div>
    </div>
  );
};
