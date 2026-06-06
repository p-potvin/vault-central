import React, { useState, useRef, useEffect } from 'react';
import * as Icons from '../lib/icons';
import { cn } from '../lib/utils';
import { vaultSetup } from '../lib/vault-client';

interface PinSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (length: number) => void;
  onError: (err: string) => void;
}

export const PinSetupDialog: React.FC<PinSetupDialogProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onError,
}) => {
  const [pinSetupLength, setPinSetupLength] = useState<4 | 6>(4);
  const [pinSetupBoxes, setPinSetupBoxes] = useState<string[]>([]);
  const [pinSetupError, setPinSetupError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pinSetupRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) {
      setPinSetupBoxes(new Array(pinSetupLength).fill(''));
      setPinSetupError(false);
      setTimeout(() => pinSetupRefs.current[0]?.focus(), 50);
    }
  }, [isOpen, pinSetupLength]);

  if (!isOpen) return null;

  const doConfirmPinSetup = async (pin: string, length: 4 | 6) => {
    setIsSubmitting(true);
    try {
      const res = await vaultSetup(pin);
      if (!res.success) {
        onError(`PIN activation failed: ${res.error || 'unknown'}`);
        setPinSetupError(true);
        // Reset pin inputs on failure
        setPinSetupBoxes(new Array(length).fill(''));
        pinSetupRefs.current[0]?.focus();
      } else {
        onSuccess(length);
        onClose();
      }
    } catch (err: any) {
      onError(`PIN activation failed: ${err.message || 'setup failed'}`);
      setPinSetupError(true);
      setPinSetupBoxes(new Array(length).fill(''));
      pinSetupRefs.current[0]?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePinSetupChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
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

  const handlePinSetupKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinSetupBoxes[index] && index > 0) {
      pinSetupRefs.current[index - 1]?.focus();
    }
  };

  const handlePinSetupLengthChange = (len: 4 | 6) => {
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

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl p-6 w-80 flex flex-col items-center gap-5 animate-in zoom-in-95 duration-200">
        <div className="relative">
          <Icons.PinIcon size={28} className="text-vault-accent" />
          <div className="absolute -inset-1 blur-lg bg-vault-accent/20 rounded-full" />
        </div>
        <div className="text-center">
          <h3 className="text-sm font-black uppercase tracking-widest text-vault-text">Set New PIN</h3>
          <p className="text-[10px] text-vault-muted mt-1">Enter a {pinSetupLength}-digit security sequence</p>
        </div>

        {/* Length selector */}
        <div className="flex gap-2 w-full">
          {([4, 6] as const).map(len => (
            <button
              key={len}
              onClick={() => handlePinSetupLengthChange(len)}
              disabled={isSubmitting}
              className={cn(
                "flex-1 py-1 text-[10px] font-black rounded-sm border transition-all",
                pinSetupLength === len
                  ? "bg-vault-accent border-vault-accent text-vault-bg"
                  : "bg-transparent border-vault-border text-vault-muted hover:border-vault-muted"
              )}
            >
              {len} DIGITS
            </button>
          ))}
        </div>

        {/* PIN boxes */}
        <div className="flex gap-3 justify-center">
          {pinSetupBoxes.map((digit, idx) => (
            <input
              key={`${pinSetupLength}-${idx}`}
              ref={el => { pinSetupRefs.current[idx] = el; }}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              disabled={isSubmitting}
              onChange={e => handlePinSetupChange(idx, e.target.value)}
              onKeyDown={e => handlePinSetupKeyDown(idx, e)}
              className={cn(
                "w-10 h-14 bg-vault-cardBg/50 border-2 rounded-xl text-center text-xl font-bold",
                "focus:border-vault-accent focus:bg-vault-accent/5 outline-none transition-all",
                pinSetupError ? 'border-red-500/50' : 'border-vault-border/50',
                digit ? 'border-vault-accent/50 scale-105 shadow-[0_0_12px_-4px_var(--vault-accent)]' : ''
              )}
            />
          ))}
        </div>

        {pinSetupError && (
          <p className="text-[10px] font-black text-red-500 uppercase tracking-tight animate-in slide-in-from-top-1">
            Enter exactly {pinSetupLength} numeric digits
          </p>
        )}

        <div className="flex gap-3 w-full mt-1">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 text-xs font-bold text-vault-muted hover:text-vault-text border border-vault-border rounded hover:border-vault-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={confirmPinSetup}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all flex items-center justify-center gap-1"
          >
            {isSubmitting ? (
              <Icons.LoaderIcon size={12} className="animate-spin text-vault-bg" />
            ) : (
              "Activate PIN"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
