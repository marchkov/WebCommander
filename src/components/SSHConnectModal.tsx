import React, { useState } from 'react';
import { api } from '../api/client';

interface SSHConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (sessionId: string, host: string, username: string) => void;
}

const SSHConnectModal: React.FC<SSHConnectModalProps> = ({ isOpen, onClose, onConnect }) => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'key'>('password');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleConnect = async () => {
    if (!host || !username) {
      setError('Host and username are required');
      return;
    }

    if (authType === 'password' && !password) {
      setError('Password is required');
      return;
    }

    if (authType === 'key' && !privateKey) {
      setError('Private key is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const sessionId = `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await api.sshConnect(sessionId, {
        host,
        port: parseInt(port),
        username,
        password: authType === 'password' ? password : undefined,
        privateKey: authType === 'key' ? privateKey : undefined,
        passphrase: authType === 'key' && passphrase ? passphrase : undefined,
      });

      onConnect(sessionId, host, username);
      
      // Reset form
      setHost('');
      setPort('22');
      setUsername('');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnect();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-700/50 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center">
            <i className="fa-solid fa-terminal text-green-400 text-sm"></i>
          </div>
          <h3 className="text-lg font-semibold text-gray-100">SSH Connection</h3>
        </div>
        
        {/* Form */}
        <div className="px-5 py-4 space-y-4" onKeyDown={handleKeyDown}>
          {/* Host & Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com or 192.168.1.100"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 placeholder-gray-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 placeholder-gray-500"
            />
          </div>

          {/* Auth Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Authentication
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAuthType('password')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  authType === 'password'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                <i className="fa-solid fa-key mr-1.5"></i>
                Password
              </button>
              <button
                type="button"
                onClick={() => setAuthType('key')}
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  authType === 'key'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                <i className="fa-solid fa-file-code mr-1.5"></i>
                SSH Key
              </button>
            </div>
          </div>

          {/* Password or Key */}
          {authType === 'password' ? (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 placeholder-gray-500"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Private Key
                </label>
                <textarea
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                  rows={4}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm font-mono focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 placeholder-gray-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Passphrase (optional)
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Key passphrase"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500/50 placeholder-gray-500"
                />
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-700/50 rounded-lg">
              <i className="fa-solid fa-exclamation-circle text-red-400"></i>
              <span className="text-sm text-red-300">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-700/50 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConnect}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <i className="fa-solid fa-spinner fa-spin"></i>
                Connecting...
              </span>
            ) : (
              <>
                <i className="fa-solid fa-plug mr-1.5"></i>
                Connect
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SSHConnectModal;
