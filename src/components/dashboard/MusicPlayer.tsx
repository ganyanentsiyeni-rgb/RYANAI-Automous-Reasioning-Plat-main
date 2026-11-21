import { useEffect, useMemo, useRef, useState } from 'react';
import { Disc3, ListMusic, Pause, Play, Share2, SkipBack, SkipForward, Upload, Volume2, Save, Trash2, Shuffle, Repeat, ChevronUp, ChevronDown } from 'lucide-react';
import { DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '@/lib/settingsPreferences';

interface Track { id: string; file: File; url: string; }
interface SavedPlaylist { id: string; name: string; trackIds: string[]; updatedAt: number; }
interface Props { settings?: MusicSettings; }
interface StoredTrack { id: string; name: string; type: string; lastModified: number; blob: Blob; }
const DB_NAME = 'ryanai-music-library-v1';
const TRACK_STORE = 'tracks';
const PLAYLIST_STORE = 'playlists';

function openMusicDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Persistent browser storage is unavailable.')); return; }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TRACK_STORE)) db.createObjectStore(TRACK_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PLAYLIST_STORE)) db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the music library.'));
  });
}
async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await openMusicDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => { resolve(request.result as T[]); db.close(); };
    request.onerror = () => { reject(request.error); db.close(); };
  });
}
async function writeRecord(storeName: string, record: unknown): Promise<void> {
  const db = await openMusicDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
function buildUpdatedPlaylist(playlist: SavedPlaylist, trackIds: string[]): SavedPlaylist {
  return { ...playlist, trackIds, updatedAt: Date.now() };
}

async function deleteRecord(storeName: string, id: string): Promise<void> {
  const db = await openMusicDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export default function MusicPlayer({ settings = DEFAULT_MUSIC_SETTINGS }: Props) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const tracksRef = useRef<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [playlistName, setPlaylistName] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState('all');
  const [sharing, setSharing] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const currentTrack = tracks[currentIndex];
  const playlistLabel = useMemo(() => tracks.length === 1 ? '1 track loaded' : tracks.length + ' tracks loaded', [tracks.length]);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const [storedTracks, savedPlaylists] = await Promise.all([readAll<StoredTrack>(TRACK_STORE), readAll<SavedPlaylist>(PLAYLIST_STORE)]);
        if (!active) return;
        const restored = storedTracks.map((item) => {
          const file = new File([item.blob], item.name, { type: item.type, lastModified: item.lastModified });
          return { id: item.id, file, url: URL.createObjectURL(file) };
        });
        tracksRef.current = restored;
        setTracks(restored);
        setPlaylists(savedPlaylists.sort((a, b) => b.updatedAt - a.updatedAt));
        const last = window.localStorage.getItem('ryanai:music:last-playlist');
        if (settings.restoreLastPlaylist && last && savedPlaylists.some((item) => item.id === last)) setSelectedPlaylist(last);
      } catch {
        if (active) setNotice('Persistent music storage is unavailable in this browser. Added tracks will remain available for this session only.');
      } finally { if (active) setLoadingLibrary(false); }
    }
    void restore();
    return () => { active = false; };
  }, [settings.restoreLastPlaylist]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(100, Math.max(0, settings.volume)) / 100;
  }, [settings.volume, currentTrack?.id]);

  useEffect(() => () => {
    tracksRef.current.forEach((track) => URL.revokeObjectURL(track.url));
    tracksRef.current = [];
  }, []);

  const visibleTracks = selectedPlaylist === 'all' ? tracks : tracks.filter((track) => playlists.find((p) => p.id === selectedPlaylist)?.trackIds.includes(track.id));

  function selectTrack(index: number) {
    if (index < 0 || index >= tracks.length) return;
    setCurrentIndex(index); setNotice(''); setError('');
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).filter((file) => file.type.startsWith('audio/'));
    if (!selected.length) { setError('Choose audio files supported by your browser.'); return; }
    const targetPlaylistId = selectedPlaylist;
    const next = selected.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
    const updated = [...tracksRef.current, ...next];
    tracksRef.current = updated; setTracks(updated);
    let filesPersisted = false;
    if (settings.autoSaveLibrary) {
      try {
        await Promise.all(next.map(({ id, file }) => writeRecord(TRACK_STORE, { id, name: file.name, type: file.type, lastModified: file.lastModified, blob: file } satisfies StoredTrack)));
        filesPersisted = true;
        setNotice(selected.length + ' audio file' + (selected.length === 1 ? '' : 's') + ' saved to this device’s RyanAI Music library.');
      } catch {
        setNotice(selected.length + ' track(s) added for this session, but persistent storage failed. Check browser storage permissions and available space.');
      }
    } else setNotice(selected.length + ' track(s) added for this browser session. Automatic library saving is disabled in Settings.');
    setError('');
    if (filesPersisted && targetPlaylistId !== 'all' && settings.autoSavePlaylists) {
      const existing = playlists.find((item) => item.id === targetPlaylistId);
      if (existing) {
        const changed = { ...existing, trackIds: [...existing.trackIds, ...next.map((item) => item.id)], updatedAt: Date.now() };
        try {
          await writeRecord(PLAYLIST_STORE, changed);
          setPlaylists((current) => current.map((item) => item.id === changed.id ? changed : item));
        } catch { setError('Tracks were saved, but the selected playlist could not be auto-saved.'); }
      }
    }
    if (uploadRef.current) uploadRef.current.value = '';
  }

  async function savePlaylist() {
    if (!tracks.length) { setError('Add music to the queue before saving a playlist.'); return; }
    const name = playlistName.trim() || 'My playlist';
    const playlist: SavedPlaylist = { id: selectedPlaylist !== 'all' ? selectedPlaylist : crypto.randomUUID(), name, trackIds: visibleTracks.map((track) => track.id), updatedAt: Date.now() };
    try {
      await Promise.all(tracks.map(({ id, file }) => writeRecord(TRACK_STORE, { id, name: file.name, type: file.type, lastModified: file.lastModified, blob: file } satisfies StoredTrack)));
      await writeRecord(PLAYLIST_STORE, playlist);
      setPlaylists((current) => [playlist, ...current.filter((item) => item.id !== playlist.id)]);
      setSelectedPlaylist(playlist.id); setPlaylistName('');
      try { window.localStorage.setItem('ryanai:music:last-playlist', playlist.id); } catch { /* optional convenience */ }
      setNotice('Playlist “' + name + '” saved on this device.');
      setError('');
    } catch { setError('Playlist could not be saved. Browser storage may be unavailable or full.'); }
  }

  function choosePlaylist(id: string) {
    setSelectedPlaylist(id);
    if (id === 'all') return;
    try { window.localStorage.setItem('ryanai:music:last-playlist', id); } catch { /* optional convenience */ }
    const playlist = playlists.find((item) => item.id === id);
    if (playlist) {
      const first = tracks.findIndex((track) => playlist.trackIds.includes(track.id));
      if (first >= 0) setCurrentIndex(first);
    }
  }

  async function removePlaylist(id: string) {
    try {
      await deleteRecord(PLAYLIST_STORE, id);
      setPlaylists((current) => current.filter((item) => item.id !== id));
      if (selectedPlaylist === id) setSelectedPlaylist('all');
      setNotice('Playlist deleted. Your saved audio files were kept in the music library.');
    } catch { setError('Could not delete this playlist.'); }
  }

  async function removeTrack(id: string) {
    const index = tracks.findIndex((track) => track.id === id);
    const removed = tracks[index];
    if (!removed) return;
    URL.revokeObjectURL(removed.url);
    const next = tracks.filter((track) => track.id !== id);
    tracksRef.current = next; setTracks(next);
    try { await deleteRecord(TRACK_STORE, id); } catch { /* The file may only have existed in this session. */ }
    const changedPlaylists = playlists.map((playlist) => ({ ...playlist, trackIds: playlist.trackIds.filter((trackId) => trackId !== id), updatedAt: Date.now() }));
    setPlaylists(changedPlaylists);
    if (settings.autoSavePlaylists) {
      try { await Promise.all(changedPlaylists.map((playlist) => writeRecord(PLAYLIST_STORE, playlist))); }
      catch { setError('The track was removed, but one or more saved playlists could not be updated.'); }
    }
    if (!next.length) setCurrentIndex(0);
    else if (index < currentIndex) setCurrentIndex(currentIndex - 1);
    else if (index === currentIndex) setCurrentIndex(Math.min(index, next.length - 1));
  }

  async function shareToVlc() {
    if (!currentTrack) return;
    if (!navigator.share || !navigator.canShare?.({ files: [currentTrack.file] })) {
      setError('This browser cannot share local audio files. On Android, use a browser with file sharing and choose VLC from the system share sheet.');
      return;
    }
    setSharing(true); setError(''); setNotice('');
    try {
      await navigator.share({ files: [currentTrack.file], title: currentTrack.file.name });
      setNotice('Share sheet opened. Choose VLC if it is installed and offered by Android.');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('Android could not open the file share sheet. The RyanAI player remains available.');
    } finally { setSharing(false); }
  }

  function moveTrack(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= visibleTracks.length) return;
    const ordered = [...visibleTracks];
    const first = ordered[index];
    const second = ordered[nextIndex];
    if (!first || !second) return;
    ordered[index] = second;
    ordered[nextIndex] = first;
    const ids = ordered.map((track) => track.id);
    setTracks((current) => {
      const byId = new Map(current.map((track) => [track.id, track]));
      const remaining = current.filter((track) => !ids.includes(track.id));
      const reordered = [...remaining, ...ids.map((id) => byId.get(id)!).filter(Boolean)];
      tracksRef.current = reordered; return reordered;
    });
    setCurrentIndex(ordered.findIndex((track) => track.id === currentTrack?.id));
    if (selectedPlaylist !== 'all' && settings.autoSavePlaylists) {
      const playlist = playlists.find((item) => item.id === selectedPlaylist);
      if (playlist) {
        void Promise.resolve().then(() => {
          const changed = { ...playlist, trackIds: ids, updatedAt: Date.now() };
          return writeRecord(PLAYLIST_STORE, changed).then(() => setPlaylists((current) => current.map((item) => item.id === changed.id ? changed : item)));
        }).catch(() => setError('Playlist order changed for this session but could not be saved.'));
        const changed = buildUpdatedPlaylist(playlist, ids);
        void writeRecord(PLAYLIST_STORE, changed).then(() => setPlaylists((current) => current.map((item) => item.id === changed.id ? changed : item))).catch(() => setError('Playlist order changed for this session but could not be saved.'));
      }
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-violet-300/20 bg-slate-900/80 p-5 sm:p-6" aria-labelledby="music-player-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-violet-300/25 bg-violet-300/10 text-violet-200"><Disc3 className="h-5 w-5" /></span>
          <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">RyanAI Music</p><h2 id="music-player-title" className="mt-1 text-lg font-semibold text-white">Music player</h2><p className="mt-1 text-xs text-slate-400">Save uploaded audio and playlists on this device, then share tracks to VLC on Android.</p></div>
        </div>
        <button type="button" onClick={() => uploadRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"><Upload className="h-4 w-4" /> Add music</button>
        <input ref={uploadRef} className="sr-only" type="file" accept="audio/*,.m4a" multiple onChange={(event) => void addFiles(event.currentTarget.files)} aria-label="Choose local music files" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.8fr)]">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/5 text-violet-200"><Disc3 className="h-6 w-6" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{currentTrack?.file.name ?? 'No track selected'}</p><p className="mt-1 text-xs text-slate-500">{playlistLabel}{loadingLibrary ? ' · Restoring library…' : ''}</p></div></div>
          <audio key={currentTrack?.id ?? 'empty'} ref={audioRef} className="mt-4 w-full" controls preload="metadata" src={currentTrack?.url} onEnded={() => { if (repeat) { if (audioRef.current) { audioRef.current.currentTime = 0; void audioRef.current.play(); } } else if (shuffle && tracks.length > 1) selectTrack(Math.floor(Math.random() * tracks.length)); else selectTrack(currentIndex + 1); }} aria-label="RyanAI local music playback" />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => selectTrack(currentIndex - 1)} disabled={!tracks.length || currentIndex === 0} aria-label="Previous track" className="rounded-lg border border-white/10 p-2 text-slate-300 disabled:opacity-30"><SkipBack className="h-4 w-4" /></button>
            <button type="button" onClick={() => selectTrack(currentIndex + 1)} disabled={!tracks.length || currentIndex >= tracks.length - 1} aria-label="Next track" className="rounded-lg border border-white/10 p-2 text-slate-300 disabled:opacity-30"><SkipForward className="h-4 w-4" /></button>
            <button type="button" onClick={() => setShuffle((value) => !value)} aria-pressed={shuffle} className={`rounded-lg border p-2 ${shuffle ? 'border-violet-300/40 text-violet-200' : 'border-white/10 text-slate-400'}`} aria-label="Shuffle"><Shuffle className="h-4 w-4" /></button>
            <button type="button" onClick={() => setRepeat((value) => !value)} aria-pressed={repeat} className={`rounded-lg border p-2 ${repeat ? 'border-violet-300/40 text-violet-200' : 'border-white/10 text-slate-400'}`} aria-label="Repeat"><Repeat className="h-4 w-4" /></button>
            <span className="ml-auto inline-flex items-center gap-2 text-xs text-slate-400"><Volume2 className="h-4 w-4" /> {settings.volume}%</span>
          </div>
          {settings.vlcMode !== 'embedded' && <button type="button" onClick={() => void shareToVlc()} disabled={!currentTrack || sharing} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-violet-200 disabled:opacity-40"><Share2 className="h-4 w-4" /> {sharing ? 'Opening Android share sheet…' : 'Open current track in VLC'}</button>}
          <p className="mt-3 text-[11px] leading-5 text-slate-500">VLC handoff is a user-initiated Android file share. RyanAI cannot force VLC to appear, remotely control it or read its playback state.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3"><h3 className="inline-flex items-center gap-2 text-sm font-semibold text-white"><ListMusic className="h-4 w-4 text-violet-300" /> Library & queue</h3><span className="text-xs text-slate-500">{visibleTracks.length} tracks</span></div>
          <div className="mt-3 flex gap-2"><select aria-label="Select playlist" value={selectedPlaylist} onChange={(event) => choosePlaylist(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-2 text-xs text-slate-200"><option value="all">All music</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select>{selectedPlaylist !== 'all' && <button type="button" onClick={() => void removePlaylist(selectedPlaylist)} aria-label="Delete selected playlist" className="rounded-lg border border-white/10 px-2 text-rose-300"><Trash2 className="h-4 w-4" /></button>}</div>
          <div className="mt-3 flex gap-2"><input value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="Playlist name" aria-label="Playlist name" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-xs text-white" /><button type="button" onClick={() => void savePlaylist()} disabled={!tracks.length} className="inline-flex items-center gap-1 rounded-lg bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"><Save className="h-3.5 w-3.5" /> Save</button></div>
          {visibleTracks.length ? <ul className="mt-3 max-h-52 space-y-2 overflow-y-auto">{visibleTracks.map((track, index) => { const absoluteIndex = tracks.findIndex((item) => item.id === track.id); return <li key={track.id} className={`flex items-center gap-1 rounded-lg border px-2 py-2 ${absoluteIndex === currentIndex ? 'border-violet-300/30 bg-violet-300/10' : 'border-white/5'}`}><button type="button" onClick={() => selectTrack(absoluteIndex)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-xs text-slate-200">{absoluteIndex === currentIndex ? <Play className="h-3.5 w-3.5 shrink-0 text-violet-200" /> : <Pause className="h-3.5 w-3.5 shrink-0 text-slate-500" />}<span className="truncate">{track.file.name}</span></button><button type="button" onClick={() => moveTrack(index, -1)} disabled={index === 0} aria-label={'Move ' + track.file.name + ' up'} className="p-1 text-slate-500 disabled:opacity-20"><ChevronUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => moveTrack(index, 1)} disabled={index === visibleTracks.length - 1} aria-label={'Move ' + track.file.name + ' down'} className="p-1 text-slate-500 disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void removeTrack(track.id)} aria-label={'Remove ' + track.file.name} className="px-1 text-[11px] text-slate-500 hover:text-rose-300">×</button></li>; })}</ul> : <div className="mt-3 rounded-lg border border-dashed border-white/10 p-5 text-center"><p className="text-sm text-slate-300">{selectedPlaylist === 'all' ? 'Your music library is empty' : 'This playlist has no available tracks'}</p><p className="mt-1 text-xs text-slate-500">Add MP3, WAV, M4A or another browser-supported audio file.</p></div>}
          <p className="mt-4 border-t border-white/5 pt-3 text-[11px] leading-5 text-slate-500">Saved audio and playlists are stored in this browser profile using IndexedDB. They do not sync to other devices or cloud accounts. Clearing browser site data can remove them.</p>
        </div>
      </div>
      {notice && <p role="status" className="mt-4 text-xs text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-4 text-xs text-rose-200">{error}</p>}
    </section>
  );
}
