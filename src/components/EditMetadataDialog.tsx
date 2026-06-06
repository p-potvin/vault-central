import React from 'react';
import * as Icons from '../lib/icons';
import { VideoData } from '../types/schemas';

interface EditMetadataDialogProps {
  editingItem: { current: VideoData; original: VideoData } | null;
  setEditingItem: (item: { current: VideoData; original: VideoData } | null) => void;
  saveEditedItem: (updatedVideo: VideoData, originalVideo: VideoData) => void;
}

export const EditMetadataDialog: React.FC<EditMetadataDialogProps> = ({
  editingItem,
  setEditingItem,
  saveEditedItem,
}) => {
  if (!editingItem) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" 
      onClick={() => setEditingItem(null)}
    >
      <div 
        className="bg-vault-bg border border-vault-border rounded-lg shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] animate-in zoom-in-95" 
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-vault-border">
          <h2 className="text-lg font-bold text-vault-text flex items-center gap-2">
            <Icons.EditIcon size={20} className="text-vault-accent" /> Edit Metadata
          </h2>
          <button 
            onClick={() => setEditingItem(null)} 
            className="vault-btn p-1.5 rounded-full hover:bg-vault-bg border-none"
          >
            <Icons.CloseIcon size={16} className="text-vault-muted" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto space-y-4">
          {['title', 'author', 'domain', 'url', 'rawVideoSrc', 'quality', 'resolution', 'size', 'description'].map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs font-bold uppercase tracking-widest text-vault-muted">{field}</label>
              {field === 'description' ? (
                 <textarea 
                   className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none min-h-[80px]"
                   value={(editingItem.current as any)[field] || ''}
                   onChange={(e) => setEditingItem({
                     ...editingItem, 
                     current: { ...editingItem.current, [field]: e.target.value }
                   })}
                 />
              ) : (
                 <input 
                   type={field === 'url' ? 'url' : 'text'}
                   className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none"
                   value={(editingItem.current as any)[field] || ''}
                   onChange={(e) => setEditingItem({
                     ...editingItem, 
                     current: { ...editingItem.current, [field]: e.target.value }
                   })}
                 />
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-widest text-vault-muted">Tags (Comma separated)</label>
            <input 
              type="text"
              className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none"
              value={editingItem.current.tags?.join(', ') || ''}
              onChange={(e) => setEditingItem({
                ...editingItem, 
                current: { ...editingItem.current, tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }
              })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold uppercase tracking-widest text-vault-muted">Actors (Comma separated)</label>
            <input 
              type="text"
              className="w-full bg-vault-bg border border-vault-border rounded p-2 text-sm text-vault-text focus:border-vault-accent outline-none"
              value={editingItem.current.actors?.join(', ') || ''}
              onChange={(e) => setEditingItem({
                ...editingItem, 
                current: { ...editingItem.current, actors: e.target.value.split(',').map(t => t.trim()).filter(Boolean) }
              })}
            />
          </div>
        </div>
        <div className="p-4 border-t border-vault-border flex justify-end gap-3 bg-vault-bg">
          <button 
            onClick={() => setEditingItem(null)} 
            className="px-5 py-2 text-xs font-bold text-vault-muted hover:text-vault-text transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => saveEditedItem(editingItem.current, editingItem.original)} 
            className="px-5 py-2 text-xs font-black bg-vault-accent text-vault-bg rounded hover:bg-vault-accentHover transition-all shadow-lg"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
