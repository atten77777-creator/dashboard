import React, { useState } from 'react';
import { Modal } from './Modal';
import { Button } from './ui/Button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSet: (passphrase: string) => void;
}

export function PassphraseModal({ isOpen, onClose, onSet }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Unlock Chat History" width={480}>
      <div className="space-y-3 text-sm">
        <p className="text-white/70">Enter your chat history passphrase to decrypt your saved conversations.</p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Passphrase"
          className="glass w-full rounded-md p-2 text-xs"
        />
        {error && (
          <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!value.trim()) { setError('Passphrase required'); return; }
              setError(null);
              onSet(value);
              onClose();
            }}
          >Unlock</Button>
        </div>
      </div>
    </Modal>
  );
}