import React, { useState, useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
  placeholder?: string;
  defaultValue?: string;
  type?: 'input' | 'confirm';
  message?: string;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  title,
  onClose,
  onConfirm,
  placeholder = '',
  defaultValue = '',
  type = 'input',
  message = '',
}) => {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) setValue(defaultValue);
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 w-full max-w-md mx-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-700/50 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center">
            <i className="fa-solid fa-terminal text-cyan-400 text-sm"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-100">{title}</h3>
        </div>
        
        <div className="px-5 py-4">
          {type === 'input' ? (
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              autoFocus
              className="w-full px-4 py-2.5 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 placeholder-gray-500"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim()) {
                  onConfirm(value.trim());
                }
                if (e.key === 'Escape') onClose();
              }}
            />
          ) : (
            <p className="text-gray-300 text-sm">{message}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-700/50 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => type === 'input' ? onConfirm(value.trim()) : onConfirm('')}
            disabled={type === 'input' && !value.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
