import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

interface FileEditorProps {
  filePath: string;
  sessionId?: string;
  readOnly?: boolean;
  onClose: () => void;
  onSave: () => void;
}

const FileEditor: React.FC<FileEditorProps> = ({ filePath, sessionId, readOnly = false, onClose, onSave }) => {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modified, setModified] = useState(false);

  useEffect(() => {
    loadFile();
  }, [filePath, sessionId]);

  const loadFile = async () => {
    setLoading(true);
    setError('');
    try {
      let result;
      if (sessionId) {
        result = await api.sshReadFile(sessionId, filePath);
      } else {
        result = await api.readFile(filePath);
      }
      setContent(result.content);
      setModified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (readOnly || saving || loading) return;
    setSaving(true);
    try {
      if (sessionId) {
        await api.sshWriteFile(sessionId, filePath, content);
      } else {
        await api.writeFile(filePath, content);
      }
      setModified(false);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="text-gray-300">
          <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
          <p className="mt-2">Loading file...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-950" onKeyDown={handleKeyDown}>
      {/* Editor Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-700">
        <div className="flex items-center gap-3">
          {sessionId ? (
            <i className="fa-solid fa-terminal text-green-400"></i>
          ) : (
            <i className="fa-solid fa-file-code text-cyan-400"></i>
          )}
          <span className="text-sm font-medium text-gray-200 truncate max-w-md">
            {sessionId && <span className="text-green-400 mr-2">[SSH]</span>}
            {filePath}
          </span>
          {readOnly && <span className="text-xs text-cyan-400">View · Read only</span>}
          {modified && !readOnly && (
            <span className="text-xs text-yellow-400 bg-yellow-900/20 px-2 py-0.5 rounded">
              Modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && <button
            onClick={handleSave}
            disabled={saving || !modified}
            className="px-3 py-1.5 text-sm bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {saving ? (
              <i className="fa-solid fa-spinner fa-spin"></i>
            ) : (
              <>
                <i className="fa-solid fa-save mr-1.5"></i>
                Save
              </>
            )}
          </button>}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-all"
          >
            <i className="fa-solid fa-xmark mr-1.5"></i>
            Close
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border-b border-red-700/50 flex items-center gap-2">
          <i className="fa-solid fa-exclamation-circle text-red-400"></i>
          <span className="text-sm text-red-300">{error}</span>
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <textarea
          autoFocus
          readOnly={readOnly}
          aria-label={readOnly ? 'File viewer' : 'File editor'}
          value={content}
          onChange={(e) => {
            if (readOnly) return;
            setContent(e.target.value);
            setModified(true);
          }}
          className="w-full h-full p-4 bg-gray-950 text-gray-100 font-mono text-sm resize-none focus:outline-none custom-scrollbar"
          spellCheck={false}
        />
      </div>

      {/* Status Bar */}
      <div className="px-4 py-1.5 bg-gray-900 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
        <span>{readOnly ? 'Read only • Esc to close' : 'Ctrl+S to save • Esc to close'}</span>
        <span>{content.length} characters • {content.split('\n').length} lines</span>
      </div>
    </div>
  );
};

export default FileEditor;
