import React from 'react';
import type { FileInfo } from '../api/client';

export default function PropertiesModal({ info, onClose }: { info: FileInfo; onClose: () => void }) {
  const fields = [
    ['Name', info.name], ['Full path', info.path], ['Type', info.type], ['Size', `${info.size} bytes`],
    ['Modified', new Date(info.modified).toLocaleString()], ['Permissions', info.permissions ?? 'Unavailable'],
    ...(info.uid === undefined ? [] : [['Owner UID', info.uid]]),
    ...(info.gid === undefined ? [] : [['Group GID', info.gid]]),
  ];
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onKeyDown={event => {
    event.stopPropagation(); if (event.key === 'Escape') onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="properties-title" className="bg-gray-900 border border-gray-700 rounded-xl p-5 w-full max-w-lg mx-4">
      <h2 id="properties-title" className="text-lg mb-4">Properties</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{fields.map(([label, value]) => <React.Fragment key={label}>
        <dt className="text-gray-400">{label}</dt><dd className="break-all">{value}</dd>
      </React.Fragment>)}</dl>
      <div className="flex justify-end mt-5"><button autoFocus onClick={onClose} className="px-4 py-2 bg-cyan-700 rounded">Close</button></div>
    </section>
  </div>;
}
