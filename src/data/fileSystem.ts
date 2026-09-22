import { FileItem } from '../types';

export const initialFileSystem: FileItem[] = [
  // Root level
  { id: '1', name: 'Documents', type: 'folder', size: 0, modified: new Date('2025-12-01'), parentId: null },
  { id: '2', name: 'Downloads', type: 'folder', size: 0, modified: new Date('2025-11-15'), parentId: null },
  { id: '3', name: 'Pictures', type: 'folder', size: 0, modified: new Date('2025-10-20'), parentId: null },
  { id: '4', name: 'Music', type: 'folder', size: 0, modified: new Date('2025-09-10'), parentId: null },
  { id: '5', name: 'Videos', type: 'folder', size: 0, modified: new Date('2025-08-05'), parentId: null },
  { id: '6', name: 'Projects', type: 'folder', size: 0, modified: new Date('2026-01-10'), parentId: null },
  { id: '7', name: 'readme.txt', type: 'file', size: 2048, modified: new Date('2025-12-20'), extension: 'txt', parentId: null },
  { id: '8', name: 'notes.md', type: 'file', size: 4096, modified: new Date('2026-01-05'), extension: 'md', parentId: null },
  { id: '9', name: 'config.json', type: 'file', size: 1024, modified: new Date('2026-01-12'), extension: 'json', parentId: null },

  // Documents folder
  { id: '10', name: 'Work', type: 'folder', size: 0, modified: new Date('2025-11-01'), parentId: '1' },
  { id: '11', name: 'Personal', type: 'folder', size: 0, modified: new Date('2025-10-15'), parentId: '1' },
  { id: '12', name: 'report.pdf', type: 'file', size: 524288, modified: new Date('2025-12-10'), extension: 'pdf', parentId: '1' },
  { id: '13', name: 'budget.xlsx', type: 'file', size: 102400, modified: new Date('2026-01-02'), extension: 'xlsx', parentId: '1' },
  { id: '14', name: 'presentation.pptx', type: 'file', size: 2097152, modified: new Date('2025-11-28'), extension: 'pptx', parentId: '1' },

  // Documents/Work
  { id: '15', name: 'project-plan.docx', type: 'file', size: 81920, modified: new Date('2025-11-15'), extension: 'docx', parentId: '10' },
  { id: '16', name: 'meeting-notes.txt', type: 'file', size: 4096, modified: new Date('2026-01-08'), extension: 'txt', parentId: '10' },
  { id: '17', name: 'contract.pdf', type: 'file', size: 1048576, modified: new Date('2025-10-20'), extension: 'pdf', parentId: '10' },

  // Documents/Personal
  { id: '18', name: 'diary.txt', type: 'file', size: 16384, modified: new Date('2026-01-14'), extension: 'txt', parentId: '11' },
  { id: '19', name: 'recipes.md', type: 'file', size: 8192, modified: new Date('2025-09-30'), extension: 'md', parentId: '11' },

  // Downloads folder
  { id: '20', name: 'setup.exe', type: 'file', size: 52428800, modified: new Date('2026-01-10'), extension: 'exe', parentId: '2' },
  { id: '21', name: 'archive.zip', type: 'file', size: 10485760, modified: new Date('2025-12-25'), extension: 'zip', parentId: '2' },
  { id: '22', name: 'image.png', type: 'file', size: 2097152, modified: new Date('2026-01-13'), extension: 'png', parentId: '2' },
  { id: '23', name: 'video.mp4', type: 'file', size: 104857600, modified: new Date('2025-12-18'), extension: 'mp4', parentId: '2' },
  { id: '24', name: 'font.woff2', type: 'file', size: 65536, modified: new Date('2025-11-05'), extension: 'woff2', parentId: '2' },

  // Pictures folder
  { id: '25', name: 'Vacation', type: 'folder', size: 0, modified: new Date('2025-08-15'), parentId: '3' },
  { id: '26', name: 'Screenshots', type: 'folder', size: 0, modified: new Date('2026-01-14'), parentId: '3' },
  { id: '27', name: 'wallpaper.jpg', type: 'file', size: 4194304, modified: new Date('2025-10-01'), extension: 'jpg', parentId: '3' },
  { id: '28', name: 'avatar.png', type: 'file', size: 524288, modified: new Date('2025-12-05'), extension: 'png', parentId: '3' },

  // Pictures/Vacation
  { id: '29', name: 'beach.jpg', type: 'file', size: 3145728, modified: new Date('2025-08-10'), extension: 'jpg', parentId: '25' },
  { id: '30', name: 'sunset.jpg', type: 'file', size: 2621440, modified: new Date('2025-08-12'), extension: 'jpg', parentId: '25' },
  { id: '31', name: 'mountain.jpg', type: 'file', size: 3670016, modified: new Date('2025-08-14'), extension: 'jpg', parentId: '25' },

  // Pictures/Screenshots
  { id: '32', name: 'screenshot_01.png', type: 'file', size: 1048576, modified: new Date('2026-01-14'), extension: 'png', parentId: '26' },
  { id: '33', name: 'screenshot_02.png', type: 'file', size: 819200, modified: new Date('2026-01-13'), extension: 'png', parentId: '26' },

  // Music folder
  { id: '34', name: 'Rock', type: 'folder', size: 0, modified: new Date('2025-07-20'), parentId: '4' },
  { id: '35', name: 'playlist.m3u', type: 'file', size: 512, modified: new Date('2025-09-01'), extension: 'm3u', parentId: '4' },
  { id: '36', name: 'favorite.mp3', type: 'file', size: 5242880, modified: new Date('2025-08-25'), extension: 'mp3', parentId: '4' },

  // Videos folder
  { id: '37', name: 'tutorial.mp4', type: 'file', size: 209715200, modified: new Date('2025-07-15'), extension: 'mp4', parentId: '5' },
  { id: '38', name: 'clip.avi', type: 'file', size: 52428800, modified: new Date('2025-06-20'), extension: 'avi', parentId: '5' },

  // Projects folder
  { id: '39', name: 'webapp', type: 'folder', size: 0, modified: new Date('2026-01-14'), parentId: '6' },
  { id: '40', name: 'mobile-app', type: 'folder', size: 0, modified: new Date('2026-01-10'), parentId: '6' },
  { id: '41', name: 'api-server', type: 'folder', size: 0, modified: new Date('2025-12-20'), parentId: '6' },
  { id: '42', name: 'TODO.md', type: 'file', size: 2048, modified: new Date('2026-01-14'), extension: 'md', parentId: '6' },

  // Projects/webapp
  { id: '43', name: 'index.html', type: 'file', size: 4096, modified: new Date('2026-01-14'), extension: 'html', parentId: '39' },
  { id: '44', name: 'styles.css', type: 'file', size: 8192, modified: new Date('2026-01-13'), extension: 'css', parentId: '39' },
  { id: '45', name: 'app.js', type: 'file', size: 16384, modified: new Date('2026-01-14'), extension: 'js', parentId: '39' },
  { id: '46', name: 'package.json', type: 'file', size: 1024, modified: new Date('2026-01-10'), extension: 'json', parentId: '39' },

  // Projects/mobile-app
  { id: '47', name: 'App.tsx', type: 'file', size: 12288, modified: new Date('2026-01-10'), extension: 'tsx', parentId: '40' },
  { id: '48', name: 'tsconfig.json', type: 'file', size: 2048, modified: new Date('2026-01-08'), extension: 'json', parentId: '40' },

  // Projects/api-server
  { id: '49', name: 'server.py', type: 'file', size: 20480, modified: new Date('2025-12-20'), extension: 'py', parentId: '41' },
  { id: '50', name: 'requirements.txt', type: 'file', size: 512, modified: new Date('2025-12-15'), extension: 'txt', parentId: '41' },
  { id: '51', name: 'database.sql', type: 'file', size: 4096, modified: new Date('2025-12-18'), extension: 'sql', parentId: '41' },
];
