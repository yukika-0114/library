import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { supabase } from "./supabaseClient.js";
import {
  Upload,
  Star,
  Trash2,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  Images,
  FolderOpen,
  Tag as TagIcon,
  Loader2,
  Film,
  Check,
  Settings,
  RotateCcw,
  Sparkles,
  Menu,
  Copy,
  LogOut,
} from "lucide-react";

// ---------- helpers ----------

const DEFAULT_SETTINGS = { accent: "#35e6ff", glow: "#ff2fc0", intensity: 1 };

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hexToRgbString(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return "53,230,255";
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

function mixHex(hex, withHex, amount) {
  const a = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  const b = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(withHex || "");
  if (!a || !b) return hex;
  const mix = (i) => {
    const av = parseInt(a[i], 16);
    const bv = parseInt(b[i], 16);
    return Math.round(av + (bv - av) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${mix(1)}${mix(2)}${mix(3)}`;
}

function looksLikeImageFile(f) {
  if (f.type && f.type.startsWith("image/")) return true;
  // Some mobile browsers/webviews leave `type` empty for camera or
  // gallery-picked files — fall back to checking the extension.
  if (!f.type) {
    return /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/i.test(f.name || "");
  }
  return false;
}

function isHeicFile(f) {
  const type = (f.type || "").toLowerCase();
  const name = (f.name || "").toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.hei[cf]$/i.test(name);
}

// Resize/compress a picked file client-side, and hand back both a preview
// data URL (for the naming step) and a Blob (for uploading to storage).
function resizeImage(file, maxDim = 1000, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("blob failed"));
              return;
            }
            resolve({ blob, dataUrl, width, height });
          },
          "image/jpeg",
          quality
        );
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function mapPhotoRow(row) {
  return {
    id: row.id,
    title: row.title || "",
    url: row.url,
    path: row.path,
    tags: row.tags || [],
    favorite: !!row.favorite,
    position: row.position,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
  };
}

// ---------- small UI atoms ----------

function Sprockets() {
  const holes = Array.from({ length: 46 });
  return (
    <div className="sprockets" aria-hidden="true">
      {holes.map((_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

function FrameBadge({ n }) {
  return <span className="frame-badge">{String(n).padStart(3, "0")}</span>;
}

export default function PhotoLibrary({ library, session, onLeaveLibrary }) {
  const [photos, setPhotos] = useState(null); // null = loading
  const [albums, setAlbums] = useState([]); // [{id, name}]
  const [memberships, setMemberships] = useState(new Map()); // photoId -> [{albumId, albumName, current, target}] (ギフトボード)
  const [folders, setFolders] = useState([]); // [{id, name}] — plain アルバム, no achievement
  const [folderMemberships, setFolderMemberships] = useState(new Map()); // photoId -> [{folderId, folderName}]
  const [view, setView] = useState({ type: "all" }); // {type:'all'|'fav'|'album'|'tag', value}

  useEffect(() => {
    setMobileNavOpen(false);
  }, [view]);

  // Prevent the page from zooming — both the automatic zoom some mobile
  // browsers trigger when focusing a field, and manual pinch-zoom.
  useEffect(() => {
    let meta = document.querySelector('meta[name="viewport"]');
    const hadMeta = !!meta;
    const prevContent = meta ? meta.getAttribute("content") : null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "viewport";
      document.head.appendChild(meta);
    }
    meta.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
    );
    return () => {
      if (!meta) return;
      if (hadMeta && prevContent !== null) {
        meta.setAttribute("content", prevContent);
      } else if (!hadMeta) {
        meta.remove();
      }
    };
  }, []);

  const [query, setQuery] = useState("");
  const [lightboxId, setLightboxId] = useState(null);
  const [orderDraft, setOrderDraft] = useState("");
  const [dragCardId, setDragCardId] = useState(null); // id of the photo currently being dragged
  const [dragPreviewOrder, setDragPreviewOrder] = useState(null); // live-reordered id list while dragging
  const dragMeta = useRef({ startX: 0, startY: 0, moved: false, dragging: false });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmDeleteAlbum, setConfirmDeleteAlbum] = useState(null); // album name or null
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(null); // folder name or null
  const [confirmDeleteTag, setConfirmDeleteTag] = useState(null); // tag or null
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [confirmDeleteLibrary, setConfirmDeleteLibrary] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [pendingUploads, setPendingUploads] = useState(null); // staged items awaiting naming
  const [dragOver, setDragOver] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [newAlbumName, setNewAlbumName] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [toast, setToast] = useState(null);
  const [syncError, setSyncError] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const fileInputRef = useRef(null);
  const lbScrollRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 2600);
  }, []);

  // ---- load library from Supabase, and stay in sync across devices ----
  const loadAll = useCallback(async () => {
    const [photosRes, albumsRes, foldersRes, settingsRes] = await Promise.all([
      supabase
        .from("photos")
        .select("*")
        .eq("library_id", library.id)
        .order("position", { ascending: true }),
      supabase
        .from("albums")
        .select("*")
        .eq("library_id", library.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("folders")
        .select("*")
        .eq("library_id", library.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("library_settings")
        .select("*")
        .eq("library_id", library.id)
        .maybeSingle(),
    ]);

    if (photosRes.error || albumsRes.error || foldersRes.error) {
      console.error(photosRes.error || albumsRes.error || foldersRes.error);
      setSyncError(true);
    }
    setPhotos((photosRes.data || []).map(mapPhotoRow));
    const albumRows = albumsRes.data || [];
    setAlbums(albumRows.map((a) => ({ id: a.id, name: a.name })));
    const folderRows = foldersRes.data || [];
    setFolders(folderRows.map((f) => ({ id: f.id, name: f.name })));

    const albumIds = albumRows.map((a) => a.id);
    const albumNameById = new Map(albumRows.map((a) => [a.id, a.name]));
    const mMap = new Map();
    if (albumIds.length) {
      const { data: memRows, error: memErr } = await supabase
        .from("photo_albums")
        .select("photo_id, album_id, current, target, position")
        .in("album_id", albumIds);
      if (memErr) {
        console.error(memErr);
        setSyncError(true);
      }
      (memRows || []).forEach((row) => {
        const entry = {
          albumId: row.album_id,
          albumName: albumNameById.get(row.album_id) || "",
          current: row.current || 0,
          target: row.target || 0,
          position: row.position || 0,
        };
        if (!mMap.has(row.photo_id)) mMap.set(row.photo_id, []);
        mMap.get(row.photo_id).push(entry);
      });
    }
    setMemberships(mMap);

    const folderIds = folderRows.map((f) => f.id);
    const folderNameById = new Map(folderRows.map((f) => [f.id, f.name]));
    const fMap = new Map();
    if (folderIds.length) {
      const { data: folRows, error: folErr } = await supabase
        .from("photo_folders")
        .select("photo_id, folder_id, position")
        .in("folder_id", folderIds);
      if (folErr) {
        console.error(folErr);
        setSyncError(true);
      }
      (folRows || []).forEach((row) => {
        const entry = {
          folderId: row.folder_id,
          folderName: folderNameById.get(row.folder_id) || "",
          position: row.position || 0,
        };
        if (!fMap.has(row.photo_id)) fMap.set(row.photo_id, []);
        fMap.get(row.photo_id).push(entry);
      });
    }
    setFolderMemberships(fMap);

    if (settingsRes.data) {
      setSettings({
        accent: settingsRes.data.accent || DEFAULT_SETTINGS.accent,
        glow: settingsRes.data.glow || DEFAULT_SETTINGS.glow,
        intensity: settingsRes.data.intensity ?? DEFAULT_SETTINGS.intensity,
      });
    }
  }, [library.id]);

  useEffect(() => {
    loadAll();

    // Realtime: whenever this library's data changes on any device
    // (including a friend's), refetch so everyone stays in sync.
    const channel = supabase
      .channel(`library-${library.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photos", filter: `library_id=eq.${library.id}` },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "albums", filter: `library_id=eq.${library.id}` },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "folders", filter: `library_id=eq.${library.id}` },
        () => loadAll()
      )
      .on(
        // photo_albums has no library_id column to filter by directly, so
        // listen unfiltered and just refetch — fine at personal-library scale.
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_albums" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_folders" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "library_settings",
          filter: `library_id=eq.${library.id}`,
        },
        () => loadAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [library.id, loadAll]);

  function updateSettings(patch) {
    setSettings((s) => {
      const next = { ...s, ...patch };
      supabase
        .from("library_settings")
        .upsert({ library_id: library.id, ...next })
        .then(({ error }) => {
          if (error) {
            setSyncError(true);
            showToast("設定の保存に失敗しました");
          }
        });
      return next;
    });
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
    supabase
      .from("library_settings")
      .upsert({ library_id: library.id, ...DEFAULT_SETTINGS })
      .then(({ error }) => {
        if (error) setSyncError(true);
      });
  }

  // ---- upload flow ----
  // Step 1: read + resize selected files, then stage them so the user can
  // name each one (and set a current/target) before it's actually added.
  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(looksLikeImageFile);
    if (files.length === 0) return;
    setUploading(true);
    setUploadProgress({ done: 0, total: files.length });

    const staged = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const { dataUrl, blob } = await resizeImage(file);
        staged.push({
          tempId: genId(),
          dataUrl,
          blob,
          title: file.name.replace(/\.[^/.]+$/, ""),
        });
      } catch (e) {
        console.error(e);
        if (isHeicFile(file)) {
          showToast(
            `「${file.name}」はHEIC形式のためこの端末では読み込めませんでした。カメラの設定を「互換性優先(JPEG)」にするか、JPEG/PNGに変換してお試しください`
          );
        } else {
          showToast(`「${file.name}」を読み込めませんでした`);
        }
      }
      setUploadProgress({ done: i + 1, total: files.length });
    }

    setUploading(false);
    setUploadProgress(null);
    if (staged.length) setPendingUploads(staged);
  }

  // Step 2: user confirms (optionally renamed) titles/targets -> upload the
  // image to Supabase Storage and insert a row, then append to the library.
  async function confirmUpload(items) {
    setPendingUploads(null);
    setUploading(true);
    setUploadProgress({ done: 0, total: items.length });

    const added = [];
    let failedCount = 0;
    const basePosition = (photos || []).reduce(
      (max, p) => Math.max(max, p.position || 0),
      0
    );
    const baseAlbumPosition =
      view.type === "album" ? albumCounts.get(view.value) || 0 : 0;
    const baseFolderPosition =
      view.type === "folder" ? folderCounts.get(view.value) || 0 : 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const id = crypto.randomUUID();
      const path = `${library.id}/${id}.jpg`;
      let uploaded = false;
      try {
        const { error: upErr } = await supabase.storage
          .from("photos")
          .upload(path, item.blob, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw upErr;
        uploaded = true;
        const { data: pub } = supabase.storage.from("photos").getPublicUrl(path);
        const row = {
          id,
          library_id: library.id,
          title: item.title.trim() || "無題",
          url: pub.publicUrl,
          path,
          tags: [],
          favorite: false,
          position: basePosition + i + 1,
          created_by: session.user.id,
        };
        const { error: insErr } = await supabase.from("photos").insert(row);
        if (insErr) throw insErr;
        // If adding while viewing a specific album, drop the new photo
        // straight into that album (with fresh 0/0 progress).
        if (view.type === "album") {
          const albumId = albums.find((a) => a.name === view.value)?.id;
          if (albumId) {
            await supabase
              .from("photo_albums")
              .insert({
                photo_id: id,
                album_id: albumId,
                current: 0,
                target: 0,
                position: baseAlbumPosition + i + 1,
              })
              .then(({ error }) => {
                if (error) console.error(error);
              });
          }
        }
        // Same idea for a plain folder (no progress to set).
        if (view.type === "folder") {
          const folderId = folders.find((f) => f.name === view.value)?.id;
          if (folderId) {
            await supabase
              .from("photo_folders")
              .insert({
                photo_id: id,
                folder_id: folderId,
                position: baseFolderPosition + i + 1,
              })
              .then(({ error }) => {
                if (error) console.error(error);
              });
          }
        }
        added.push(mapPhotoRow({ ...row, created_at: new Date().toISOString() }));
      } catch (e) {
        console.error(e);
        failedCount++;
        // The image upload can succeed even when the database row fails —
        // clean up the orphaned file instead of leaving it in storage.
        if (uploaded) {
          supabase.storage.from("photos").remove([path]).catch(() => {});
        }
      }
      setUploadProgress({ done: i + 1, total: items.length });
      if (i < items.length - 1) await sleep(120); // avoid bursting requests
    }

    if (added.length) {
      setPhotos((prev) => [...(prev || []), ...added]);
      if (view.type === "album") {
        const albumMatch = albums.find((a) => a.name === view.value);
        if (albumMatch) {
          setMemberships((prev) => {
            const next = new Map(prev);
            added.forEach((p, i) => {
              next.set(p.id, [
                {
                  albumId: albumMatch.id,
                  albumName: albumMatch.name,
                  current: 0,
                  target: 0,
                  position: baseAlbumPosition + i + 1,
                },
              ]);
            });
            return next;
          });
        }
      }
      if (view.type === "folder") {
        const folderMatch = folders.find((f) => f.name === view.value);
        if (folderMatch) {
          setFolderMemberships((prev) => {
            const next = new Map(prev);
            added.forEach((p, i) => {
              next.set(p.id, [
                {
                  folderId: folderMatch.id,
                  folderName: folderMatch.name,
                  position: baseFolderPosition + i + 1,
                },
              ]);
            });
            return next;
          });
        }
      }
    }

    if (added.length && failedCount === 0) {
      showToast(
        added.length === 1 ? "1枚追加しました" : `${added.length}枚追加しました`
      );
    } else if (failedCount > 0) {
      setSyncError(true);
      showToast(
        failedCount === items.length
          ? "アップロードに失敗しました。通信環境を確認してください"
          : `${items.length}枚中${failedCount}枚のアップロードに失敗しました`
      );
    }
    setUploading(false);
    setUploadProgress(null);
  }

  function cancelUpload() {
    setPendingUploads(null);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  // ---- photo mutations ----
  async function updatePhoto(id, patch) {
    setPhotos((prev) =>
      (prev || []).map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
    const dbPatch = {};
    ["title", "tags", "favorite"].forEach((k) => {
      if (k in patch) dbPatch[k] = patch[k];
    });
    const { error } = await supabase.from("photos").update(dbPatch).eq("id", id);
    if (error) {
      console.error(error);
      setSyncError(true);
      showToast("保存に失敗しました");
    }
  }

  // Add or remove a photo from an album. Achievement (current/target) lives
  // on this membership, not on the photo — the same photo can have a
  // different goal in each album it belongs to.
  async function setPhotoAlbumMembership(photoId, albumId, isMember) {
    const newPosition = (albumCounts.get(albums.find((a) => a.id === albumId)?.name) || 0) + 1;
    setMemberships((prev) => {
      const next = new Map(prev);
      const list = next.get(photoId) ? [...next.get(photoId)] : [];
      if (isMember) {
        if (!list.some((m) => m.albumId === albumId)) {
          const album = albums.find((a) => a.id === albumId);
          list.push({
            albumId,
            albumName: album ? album.name : "",
            current: 0,
            target: 0,
            position: newPosition,
          });
        }
      } else {
        const idx = list.findIndex((m) => m.albumId === albumId);
        if (idx >= 0) list.splice(idx, 1);
      }
      next.set(photoId, list);
      return next;
    });

    if (isMember) {
      const { error } = await supabase
        .from("photo_albums")
        .upsert({
          photo_id: photoId,
          album_id: albumId,
          current: 0,
          target: 0,
          position: newPosition,
        });
      if (error) {
        console.error(error);
        setSyncError(true);
        showToast("保存に失敗しました");
      }
    } else {
      const { error } = await supabase
        .from("photo_albums")
        .delete()
        .eq("photo_id", photoId)
        .eq("album_id", albumId);
      if (error) {
        console.error(error);
        setSyncError(true);
        showToast("保存に失敗しました");
      }
    }
  }

  async function updateMembershipProgress(photoId, albumId, patch) {
    setMemberships((prev) => {
      const next = new Map(prev);
      const list = (next.get(photoId) || []).map((m) =>
        m.albumId === albumId ? { ...m, ...patch } : m
      );
      next.set(photoId, list);
      return next;
    });
    const dbPatch = {};
    if ("current" in patch) dbPatch.current = patch.current;
    if ("target" in patch) dbPatch.target = patch.target;
    const { error } = await supabase
      .from("photo_albums")
      .update(dbPatch)
      .eq("photo_id", photoId)
      .eq("album_id", albumId);
    if (error) {
      console.error(error);
      setSyncError(true);
      showToast("保存に失敗しました");
    }
  }

  // Moves photo `id` to 1-based position `newPos` within the CURRENT view's
  // own order — the global "all photos" order when view.type is 'all' (or
  // 'fav'/'tag'), or that specific album/folder's own independent order
  // when browsing one, so the two never affect each other.
  function reorderPhoto(id, newPos) {
    const current = contextList;
    const idx = current.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const clamped = Math.max(1, Math.min(current.length, Math.round(newPos)));
    const targetIdx = clamped - 1;
    if (targetIdx === idx) return clamped;
    const arr = [...current];
    const [item] = arr.splice(idx, 1);
    arr.splice(targetIdx, 0, item);

    if (view.type === "album") {
      const albumMatch = albums.find((a) => a.name === view.value);
      if (!albumMatch) return clamped;
      const renumbered = arr.map((p, i) => ({ photoId: p.id, position: i + 1 }));
      setMemberships((prev) => {
        const next = new Map(prev);
        renumbered.forEach(({ photoId, position }) => {
          const list = (next.get(photoId) || []).map((m) =>
            m.albumId === albumMatch.id ? { ...m, position } : m
          );
          next.set(photoId, list);
        });
        return next;
      });
      Promise.all(
        renumbered.map(({ photoId, position }) =>
          supabase
            .from("photo_albums")
            .update({ position })
            .eq("photo_id", photoId)
            .eq("album_id", albumMatch.id)
        )
      ).then((results) => {
        if (results.some((r) => r.error)) {
          setSyncError(true);
          showToast("並び替えの保存に失敗しました");
        }
      });
    } else if (view.type === "folder") {
      const folderMatch = folders.find((f) => f.name === view.value);
      if (!folderMatch) return clamped;
      const renumbered = arr.map((p, i) => ({ photoId: p.id, position: i + 1 }));
      setFolderMemberships((prev) => {
        const next = new Map(prev);
        renumbered.forEach(({ photoId, position }) => {
          const list = (next.get(photoId) || []).map((m) =>
            m.folderId === folderMatch.id ? { ...m, position } : m
          );
          next.set(photoId, list);
        });
        return next;
      });
      Promise.all(
        renumbered.map(({ photoId, position }) =>
          supabase
            .from("photo_folders")
            .update({ position })
            .eq("photo_id", photoId)
            .eq("folder_id", folderMatch.id)
        )
      ).then((results) => {
        if (results.some((r) => r.error)) {
          setSyncError(true);
          showToast("並び替えの保存に失敗しました");
        }
      });
    } else {
      // 'all' / 'fav' / 'tag' — reorder the whole library's global order.
      const renumbered = arr.map((p, i) => ({ ...p, position: i + 1 }));
      setPhotos((prev) => {
        const byId = new Map(renumbered.map((p) => [p.id, p]));
        return (prev || []).map((p) => byId.get(p.id) || p);
      });
      Promise.all(
        renumbered.map((p) =>
          supabase.from("photos").update({ position: p.position }).eq("id", p.id)
        )
      ).then((results) => {
        if (results.some((r) => r.error)) {
          setSyncError(true);
          showToast("並び替えの保存に失敗しました");
        }
      });
    }
    return clamped;
  }

  async function deletePhoto(id) {
    const photo = (photos || []).find((p) => p.id === id);
    setPhotos((prev) => (prev || []).filter((p) => p.id !== id));
    if (lightboxId === id) setLightboxId(null);
    if (photo?.path) {
      await supabase.storage.from("photos").remove([photo.path]).catch((e) => {
        console.error(e);
      });
    }
    const { error } = await supabase.from("photos").delete().eq("id", id);
    if (error) {
      console.error(error);
      setSyncError(true);
    }
    showToast("削除しました");
  }

  async function toggleFavorite(id) {
    const p = (photos || []).find((x) => x.id === id);
    if (p) updatePhoto(id, { favorite: !p.favorite });
  }

  async function createAlbum(name) {
    const trimmed = name.trim();
    if (!trimmed || albums.some((a) => a.name === trimmed)) return;
    const { data, error } = await supabase
      .from("albums")
      .insert({ library_id: library.id, name: trimmed })
      .select()
      .single();
    if (error) {
      console.error(error);
      setSyncError(true);
      showToast("ギフトボードの保存に失敗しました");
      return;
    }
    setAlbums((prev) => [...prev, { id: data.id, name: data.name }]);
    showToast(`ギフトボード「${trimmed}」を作成しました`);
  }

  async function deleteAlbum(name) {
    const albumMatch = albums.find((a) => a.name === name);
    setAlbums((prev) => prev.filter((a) => a.name !== name));
    setMemberships((prev) => {
      const next = new Map();
      prev.forEach((list, photoId) => {
        next.set(photoId, list.filter((m) => m.albumName !== name));
      });
      return next;
    });
    if (view.type === "album" && view.value === name) setView({ type: "all" });
    if (albumMatch) {
      // Deleting the album row cascades to remove its photo_albums rows too.
      const { error } = await supabase.from("albums").delete().eq("id", albumMatch.id);
      if (error) {
        console.error(error);
        setSyncError(true);
      }
    }
    showToast(`ギフトボード「${name}」を削除しました`);
  }

  // ---- folders (アルバム: plain grouping, no achievement) ----
  async function createFolder(name) {
    const trimmed = name.trim();
    if (!trimmed || folders.some((f) => f.name === trimmed)) return;
    const { data, error } = await supabase
      .from("folders")
      .insert({ library_id: library.id, name: trimmed })
      .select()
      .single();
    if (error) {
      console.error(error);
      setSyncError(true);
      showToast("アルバムの保存に失敗しました");
      return;
    }
    setFolders((prev) => [...prev, { id: data.id, name: data.name }]);
    showToast(`アルバム「${trimmed}」を作成しました`);
  }

  async function deleteFolder(name) {
    const folderMatch = folders.find((f) => f.name === name);
    setFolders((prev) => prev.filter((f) => f.name !== name));
    setFolderMemberships((prev) => {
      const next = new Map();
      prev.forEach((list, photoId) => {
        next.set(photoId, list.filter((m) => m.folderName !== name));
      });
      return next;
    });
    if (view.type === "folder" && view.value === name) setView({ type: "all" });
    if (folderMatch) {
      // Deleting the folder row cascades to remove its photo_folders rows too.
      const { error } = await supabase.from("folders").delete().eq("id", folderMatch.id);
      if (error) {
        console.error(error);
        setSyncError(true);
      }
    }
    showToast(`アルバム「${name}」を削除しました`);
  }

  async function setPhotoFolderMembership(photoId, folderId, isMember) {
    const newPosition = (folderCounts.get(folders.find((f) => f.id === folderId)?.name) || 0) + 1;
    setFolderMemberships((prev) => {
      const next = new Map(prev);
      const list = next.get(photoId) ? [...next.get(photoId)] : [];
      if (isMember) {
        if (!list.some((m) => m.folderId === folderId)) {
          const folder = folders.find((f) => f.id === folderId);
          list.push({ folderId, folderName: folder ? folder.name : "", position: newPosition });
        }
      } else {
        const idx = list.findIndex((m) => m.folderId === folderId);
        if (idx >= 0) list.splice(idx, 1);
      }
      next.set(photoId, list);
      return next;
    });

    if (isMember) {
      const { error } = await supabase
        .from("photo_folders")
        .upsert({ photo_id: photoId, folder_id: folderId, position: newPosition });
      if (error) {
        console.error(error);
        setSyncError(true);
        showToast("保存に失敗しました");
      }
    } else {
      const { error } = await supabase
        .from("photo_folders")
        .delete()
        .eq("photo_id", photoId)
        .eq("folder_id", folderId);
      if (error) {
        console.error(error);
        setSyncError(true);
        showToast("保存に失敗しました");
      }
    }
  }

  async function deleteTag(tag) {
    const affected = (photos || []).filter((p) => (p.tags || []).includes(tag));
    setPhotos((prev) =>
      (prev || []).map((p) =>
        (p.tags || []).includes(tag)
          ? { ...p, tags: p.tags.filter((t) => t !== tag) }
          : p
      )
    );
    if (view.type === "tag" && view.value === tag) setView({ type: "all" });
    try {
      const results = await Promise.all(
        affected.map((p) =>
          supabase
            .from("photos")
            .update({ tags: p.tags.filter((t) => t !== tag) })
            .eq("id", p.id)
        )
      );
      if (results.some((r) => r.error)) setSyncError(true);
    } catch (e) {
      console.error(e);
      setSyncError(true);
    }
    showToast(`タグ「${tag}」を削除しました`);
  }

  async function deleteAllData() {
    const paths = (photos || []).map((p) => p.path).filter(Boolean);
    setPhotos([]);
    setAlbums([]);
    setMemberships(new Map());
    setFolders([]);
    setFolderMemberships(new Map());
    setView({ type: "all" });
    setQuery("");
    try {
      if (paths.length) await supabase.storage.from("photos").remove(paths);
      await supabase.from("photos").delete().eq("library_id", library.id);
      await supabase.from("albums").delete().eq("library_id", library.id);
      await supabase.from("folders").delete().eq("library_id", library.id);
    } catch (e) {
      console.error(e);
      setSyncError(true);
    }
    showToast("すべてのデータを削除しました");
  }

  // Deletes the library itself — cascades (via foreign keys) remove its
  // photos, albums, folders, memberships, and settings automatically.
  // Storage files aren't linked by a DB foreign key, so clean those up first.
  async function deleteLibrary() {
    const paths = (photos || []).map((p) => p.path).filter(Boolean);
    try {
      if (paths.length) await supabase.storage.from("photos").remove(paths);
      const { error } = await supabase.from("libraries").delete().eq("id", library.id);
      if (error) {
        console.error(error);
        setSyncError(true);
        showToast("ライブラリの削除に失敗しました");
        return;
      }
    } catch (e) {
      console.error(e);
      setSyncError(true);
      showToast("ライブラリの削除に失敗しました");
      return;
    }
    showToast("ライブラリを削除しました");
    onLeaveLibrary();
  }

  const tagCounts = useMemo(() => {
    const m = new Map();
    (photos || []).forEach((p) =>
      (p.tags || []).forEach((t) => m.set(t, (m.get(t) || 0) + 1))
    );
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [photos]);

  const albumCounts = useMemo(() => {
    const m = new Map(albums.map((a) => [a.name, 0]));
    memberships.forEach((list) => {
      list.forEach((entry) => {
        m.set(entry.albumName, (m.get(entry.albumName) || 0) + 1);
      });
    });
    return m;
  }, [albums, memberships]);

  const folderCounts = useMemo(() => {
    const m = new Map(folders.map((f) => [f.name, 0]));
    folderMemberships.forEach((list) => {
      list.forEach((entry) => {
        m.set(entry.folderName, (m.get(entry.folderName) || 0) + 1);
      });
    });
    return m;
  }, [folders, folderMemberships]);

  // Achievement (current/target) is per (photo, album) — meaningless outside
  // an album context, so isAchieved needs to know which album to check.
  function membershipFor(photoId, albumName) {
    return (memberships.get(photoId) || []).find((m) => m.albumName === albumName);
  }

  function folderMembershipFor(photoId, folderName) {
    return (folderMemberships.get(photoId) || []).find((m) => m.folderName === folderName);
  }

  function isAchieved(photoId, albumName) {
    if (!albumName) return false;
    const m = membershipFor(photoId, albumName);
    return !!m && m.target > 0 && m.current >= m.target;
  }

  // The full, stable set relevant to the current view's own ordering —
  // NOT narrowed by search text. This is what frame numbers and reordering
  // are based on, so a search query never shifts numbers around, and
  // reordering never collides with photos hidden by the search.
  const contextList = useMemo(() => {
    if (view.type === "album") {
      return (photos || [])
        .filter((p) => (memberships.get(p.id) || []).some((m) => m.albumName === view.value))
        .slice()
        .sort(
          (a, b) =>
            (membershipFor(a.id, view.value)?.position ?? 0) -
            (membershipFor(b.id, view.value)?.position ?? 0)
        );
    }
    if (view.type === "folder") {
      return (photos || [])
        .filter((p) => (folderMemberships.get(p.id) || []).some((m) => m.folderName === view.value))
        .slice()
        .sort(
          (a, b) =>
            (folderMembershipFor(a.id, view.value)?.position ?? 0) -
            (folderMembershipFor(b.id, view.value)?.position ?? 0)
        );
    }
    // 'all' / 'fav' / 'tag' all share the same global order.
    return photos || [];
  }, [photos, view, memberships, folderMemberships]);

  // Frame numbers reflect the CURRENT view's own order — global library
  // order in "all photos"/favorites/tags, but each album/folder's own
  // independent order when inside one — based on contextList, so a search
  // query narrowing the display never shifts the numbers around.
  const frameNumbers = useMemo(() => {
    const m = new Map();
    contextList.forEach((p, i) => m.set(p.id, i + 1));
    return m;
  }, [contextList]);

  const filtered = useMemo(() => {
    let list = contextList;
    if (view.type === "fav") list = list.filter((p) => p.favorite);
    if (view.type === "tag")
      list = list.filter((p) => (p.tags || []).includes(view.value));
    const qRaw = query.trim();
    const q = qRaw.toLowerCase();
    const qTag = q.replace(/^#/, "");
    if (qRaw) {
      list = list.filter((p) => {
        const num = frameNumbers.get(p.id);
        const numStr = num != null ? String(num) : "";
        const numPadded = num != null ? String(num).padStart(3, "0") : "";
        const albumNames = (memberships.get(p.id) || []).map((m) => m.albumName);
        const folderNames = (folderMemberships.get(p.id) || []).map((m) => m.folderName);
        return (
          p.title.toLowerCase().includes(q) ||
          (p.tags || []).some((t) => t.toLowerCase().includes(qTag)) ||
          albumNames.some((n) => n.toLowerCase().includes(q)) ||
          folderNames.some((n) => n.toLowerCase().includes(q)) ||
          numStr === qRaw ||
          numPadded.includes(qRaw)
        );
      });
    }
    return list;
  }, [contextList, view, query, frameNumbers, memberships, folderMemberships]);

  // Dragging to reorder is only safe when the displayed list exactly matches
  // the context's own full order — i.e. no search narrowing it down, and not
  // a favorites/tag view (those never map cleanly onto a single position
  // scheme). "All photos"/album/folder views with no search query qualify.
  const canDrag =
    !query.trim() && (view.type === "all" || view.type === "album" || view.type === "folder");

  const displayOrder = dragPreviewOrder
    ? dragPreviewOrder.map((id) => filtered.find((p) => p.id === id)).filter(Boolean)
    : filtered;

  const longPressTimer = useRef(null);

  function clearLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function beginDrag(photoId) {
    dragMeta.current.dragging = true;
    dragMeta.current.moved = true; // suppress the click that follows release
    setDragCardId(photoId);
    setDragPreviewOrder(filtered.map((p) => p.id));
  }

  // Long-press (not an immediate drag) on the title/info block starts
  // reordering — this avoids a fiddly small drag handle, and a normal tap
  // or scroll gesture on that block is left alone unless it's held still.
  function handleFramePointerDown(e, photoId) {
    if (!canDrag) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    dragMeta.current = {
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      dragging: false,
    };
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      beginDrag(photoId);
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }, 420);
  }

  function handleFramePointerMove(e) {
    if (dragMeta.current.dragging) {
      e.preventDefault();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cardEl = el && el.closest("[data-photo-id]");
      const overId = cardEl && cardEl.getAttribute("data-photo-id");
      if (!overId || overId === dragCardId) return;
      setDragPreviewOrder((prev) => {
        if (!prev) return prev;
        const from = prev.indexOf(dragCardId);
        const to = prev.indexOf(overId);
        if (from === -1 || to === -1 || from === to) return prev;
        const arr = [...prev];
        arr.splice(from, 1);
        arr.splice(to, 0, dragCardId);
        return arr;
      });
      return;
    }
    // Still waiting on the long-press timer — a real scroll/drag-away
    // gesture should cancel it and behave like an ordinary tap/scroll.
    if (!longPressTimer.current) return;
    const dx = e.clientX - dragMeta.current.startX;
    const dy = e.clientY - dragMeta.current.startY;
    if (Math.hypot(dx, dy) > 10) clearLongPress();
  }

  function handleFramePointerUp() {
    clearLongPress();
    if (!dragMeta.current.dragging) return;
    dragMeta.current.dragging = false;
    if (!dragCardId) return;
    const id = dragCardId;
    const order = dragPreviewOrder;
    setDragCardId(null);
    setDragPreviewOrder(null);
    if (order) {
      const newIndex = order.indexOf(id);
      if (newIndex >= 0) reorderPhoto(id, newIndex + 1);
    }
    // dragMeta.current.moved is intentionally left as-is here — the
    // following click event (bubbling from the frame up to the card
    // button) checks it to decide whether to open the lightbox, then
    // clears it itself.
  }

  // Achievement only applies inside a specific album view — "all photos"
  // and other views don't track/display it at all.
  const achievedCount = useMemo(() => {
    if (view.type !== "album") return 0;
    return filtered.filter((p) => isAchieved(p.id, view.value)).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, view, memberships]);

  const lightboxPhoto = filtered.find((p) => p.id === lightboxId) || null;
  const lightboxIdx = filtered.findIndex((p) => p.id === lightboxId);

  function stepLightbox(delta) {
    if (lightboxIdx < 0 || filtered.length === 0) return;
    const next =
      (lightboxIdx + delta + filtered.length) % filtered.length;
    setLightboxId(filtered[next].id);
  }

  // Keep the horizontal-scroll strip positioned on whichever photo
  // lightboxId points to (e.g. when first opened, or moved via keyboard).
  useEffect(() => {
    if (!lightboxId || !lbScrollRef.current) return;
    const idx = filtered.findIndex((p) => p.id === lightboxId);
    if (idx < 0) return;
    const el = lbScrollRef.current;
    const target = idx * el.clientWidth;
    if (Math.abs(el.scrollLeft - target) > 4) {
      el.scrollTo({ left: target, behavior: "instant" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxId]);

  // As the user swipes/scrolls the strip, update lightboxId to match
  // whichever photo is currently centered.
  const lbScrollTimer = useRef(null);
  function handleLbScroll() {
    const el = lbScrollRef.current;
    if (!el) return;
    clearTimeout(lbScrollTimer.current);
    lbScrollTimer.current = setTimeout(() => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      const p = filtered[idx];
      if (p && p.id !== lightboxId) setLightboxId(p.id);
    }, 100);
  }

  useEffect(() => {
    if (lightboxId && lightboxPhoto) {
      setOrderDraft(String(frameNumbers.get(lightboxPhoto.id) || ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxId]);

  function commitOrder() {
    if (!lightboxPhoto) return;
    const n = Number(orderDraft);
    if (!Number.isFinite(n) || n < 1) {
      setOrderDraft(String(frameNumbers.get(lightboxPhoto.id) || ""));
      return;
    }
    const result = reorderPhoto(lightboxPhoto.id, n);
    setOrderDraft(String(result ?? (frameNumbers.get(lightboxPhoto.id) || "")));
  }

  useEffect(() => {
    if (!lightboxPhoto) return;
    function onKey(e) {
      if (confirmDeleteId) return; // let the confirm dialog handle keys
      const tag = (e.target && e.target.tagName) || "";
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") setLightboxId(null);
      else if (e.key === "Enter" && !inField) setLightboxId(null);
      else if (e.key === "ArrowRight" && !inField) stepLightbox(1);
      else if (e.key === "ArrowLeft" && !inField) stepLightbox(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxPhoto, filtered, confirmDeleteId]);

  useEffect(() => {
    if (!confirmDeleteId) return;
    function onKey(e) {
      if (e.key === "Escape") setConfirmDeleteId(null);
      if (e.key === "Enter") {
        const id = confirmDeleteId;
        setConfirmDeleteId(null);
        deletePhoto(id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmDeleteId]);

  const total = photos ? photos.length : 0;
  const favCount = (photos || []).filter((p) => p.favorite).length;

  const viewLabel =
    view.type === "all"
      ? "全ての写真"
      : view.type === "fav"
      ? "お気に入り"
      : view.type === "album" || view.type === "folder"
      ? view.value
      : `#${view.value}`;

  const rootStyle = {
    "--accent": settings.accent,
    "--accent-hover": mixHex(settings.accent, "#ffffff", 0.3),
    "--accent-deep": mixHex(settings.accent, "#000000", 0.35),
    "--accent2": settings.glow,
    "--accent-rgb": hexToRgbString(settings.accent),
    "--accent2-rgb": hexToRgbString(settings.glow),
    "--glow-intensity": settings.intensity,
  };

  return (
    <div className="pl-root" style={rootStyle}>
      <style>{CSS}</style>

      {/* ---------- mobile drawer backdrop ---------- */}
      <div
        className={`pl-mobile-backdrop ${mobileNavOpen ? "show" : ""}`}
        onClick={() => setMobileNavOpen(false)}
      />

      {/* ---------- sidebar ---------- */}
      <aside
        className={`pl-sidebar ${mobileNavOpen ? "mobile-open" : ""} ${
          sidebarCollapsed ? "collapsed" : ""
        }`}
      >
        <div className="pl-sidebar-head">
          <div className="pl-brand">
            <Film size={20} strokeWidth={1.75} />
            <span>フィルムキャビネット</span>
          </div>
          <button
            className="pl-mobile-close-btn"
            onClick={() => setMobileNavOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <button
          className="pl-upload-btn"
          onClick={() => {
            setMobileNavOpen(false);
            fileInputRef.current?.click();
          }}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Plus size={16} />
          )}
          写真を追加
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />

        <nav className="pl-nav">
          <div className="pl-nav-label">ライブラリ</div>
          <button
            className={`pl-nav-item ${view.type === "all" ? "active" : ""}`}
            onClick={() => setView({ type: "all" })}
          >
            <Images size={15} />
            <span>すべての写真</span>
            <em>{total}</em>
          </button>
          <button
            className={`pl-nav-item ${view.type === "fav" ? "active" : ""}`}
            onClick={() => setView({ type: "fav" })}
          >
            <Star size={15} />
            <span>お気に入り</span>
            <em>{favCount}</em>
          </button>
        </nav>

        <nav className="pl-nav">
          <div className="pl-nav-label-row">
            <span className="pl-nav-label">ギフトボード</span>
            <button
              className="pl-icon-btn"
              title="新しいギフトボード"
              onClick={() => setNewAlbumOpen((v) => !v)}
            >
              <Plus size={13} />
            </button>
          </div>
          {newAlbumOpen && (
            <div className="pl-new-album">
              <input
                autoFocus
                placeholder="ギフトボード名"
                value={newAlbumName}
                onChange={(e) => setNewAlbumName(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newAlbumName.trim()) {
                      createAlbum(newAlbumName);
                      setNewAlbumName("");
                    }
                    setNewAlbumOpen(false);
                  } else if (e.key === "Escape") {
                    setNewAlbumName("");
                    setNewAlbumOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="pl-icon-btn pl-new-album-add"
                onClick={() => {
                  if (newAlbumName.trim()) {
                    createAlbum(newAlbumName);
                    setNewAlbumName("");
                  }
                  setNewAlbumOpen(false);
                }}
              >
                <Check size={13} />
              </button>
            </div>
          )}
          {albums.length === 0 && !newAlbumOpen && (
            <div className="pl-empty-hint">まだありません</div>
          )}
          {albums.map((a) => (
            <div key={a.id} className="pl-nav-item-row">
              <button
                className={`pl-nav-item ${
                  view.type === "album" && view.value === a.name ? "active" : ""
                }`}
                onClick={() => setView({ type: "album", value: a.name })}
              >
                <FolderOpen size={15} />
                <span>{a.name}</span>
                <em>{albumCounts.get(a.name) || 0}</em>
              </button>
              <button
                className="pl-nav-item-del"
                title="ギフトボードを削除"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteAlbum(a.name);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </nav>

        <nav className="pl-nav">
          <div className="pl-nav-label-row">
            <span className="pl-nav-label">アルバム</span>
            <button
              className="pl-icon-btn"
              title="新しいアルバム"
              onClick={() => setNewFolderOpen((v) => !v)}
            >
              <Plus size={13} />
            </button>
          </div>
          {newFolderOpen && (
            <div className="pl-new-album">
              <input
                autoFocus
                placeholder="アルバム名"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newFolderName.trim()) {
                      createFolder(newFolderName);
                      setNewFolderName("");
                    }
                    setNewFolderOpen(false);
                  } else if (e.key === "Escape") {
                    setNewFolderName("");
                    setNewFolderOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="pl-icon-btn pl-new-album-add"
                onClick={() => {
                  if (newFolderName.trim()) {
                    createFolder(newFolderName);
                    setNewFolderName("");
                  }
                  setNewFolderOpen(false);
                }}
              >
                <Check size={13} />
              </button>
            </div>
          )}
          {folders.length === 0 && !newFolderOpen && (
            <div className="pl-empty-hint">まだありません</div>
          )}
          {folders.map((f) => (
            <div key={f.id} className="pl-nav-item-row">
              <button
                className={`pl-nav-item ${
                  view.type === "folder" && view.value === f.name ? "active" : ""
                }`}
                onClick={() => setView({ type: "folder", value: f.name })}
              >
                <FolderOpen size={15} />
                <span>{f.name}</span>
                <em>{folderCounts.get(f.name) || 0}</em>
              </button>
              <button
                className="pl-nav-item-del"
                title="アルバムを削除"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteFolder(f.name);
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </nav>

        {tagCounts.length > 0 && (
          <nav className="pl-nav">
            <div className="pl-nav-label">よく使うタグ</div>
            <div className="pl-tag-cloud">
              {tagCounts.map(([t, c]) => {
                const active = view.type === "tag" && view.value === t;
                return (
                  <span key={t} className="pl-tag-chip-wrap">
                    <button
                      className={`pl-tag-chip ${active ? "active" : ""}`}
                      onClick={() =>
                        setView(active ? { type: "all" } : { type: "tag", value: t })
                      }
                      title={active ? "クリックで絞り込み解除" : undefined}
                    >
                      #{t} {active ? <X size={11} /> : <em>{c}</em>}
                    </button>
                    <button
                      className="pl-tag-chip-del"
                      title="タグを削除"
                      onClick={() => setConfirmDeleteTag(t)}
                    >
                      <Trash2 size={10} />
                    </button>
                  </span>
                );
              })}
            </div>
          </nav>
        )}

        {syncError && (
          <div className="pl-storage-warn">
            サーバーとの通信でエラーが発生しました。ネットワーク接続を確認してください。変更はこの端末には反映されていますが、他の端末とは同期されていない可能性があります。
          </div>
        )}

        <div className="pl-library-footer">
          <div className="pl-library-name">{library.name}</div>
          <div className="pl-library-code-row">
            <span>招待コード: {library.invite_code}</span>
            <button
              title="コードをコピー"
              onClick={() => navigator.clipboard?.writeText(library.invite_code)}
            >
              <Copy size={12} />
            </button>
          </div>
          <button className="pl-library-leave" onClick={onLeaveLibrary}>
            <LogOut size={12} />
            別のライブラリに切り替え
          </button>
        </div>
      </aside>

      {/* ---------- main ---------- */}
      <main className="pl-main">
        <Sprockets />
        <header className="pl-topbar">
          <div className="pl-topbar-left">
            <button
              className="pl-sidebar-toggle-btn"
              onClick={() => {
                if (window.matchMedia("(max-width: 760px)").matches) {
                  setMobileNavOpen(true);
                } else {
                  setSidebarCollapsed((v) => !v);
                }
              }}
            >
              <Menu size={18} />
            </button>
            <div className="pl-topbar-title-group">
              <h1>{viewLabel}</h1>
              {view.type === "tag" && (
                <button
                  className="pl-clear-filter"
                  onClick={() => setView({ type: "all" })}
                >
                  <X size={11} /> フィルター解除
                </button>
              )}
            </div>
          </div>

          <div className="pl-topbar-center">
            {view.type === "album" ? (
              <span className="pl-count-ratio">
                <span className="pl-count-label">達成</span>
                <span className="pl-count-num achieved">{achievedCount}</span>
                <span className="pl-count-slash">/</span>
                <span className="pl-count-num total">{filtered.length}</span>
                <span className="pl-count-label">枚</span>
              </span>
            ) : (
              <span className="pl-count-ratio">
                <span className="pl-count-num total">{filtered.length}</span>
                <span className="pl-count-label">枚</span>
              </span>
            )}
          </div>

          <div className="pl-topbar-right">
            <div className="pl-search">
              <Search size={15} />
              <input
                placeholder="タイトル・タグ・ギフトボード・アルバムで検索"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.target.blur();
                }}
              />
              {query && (
                <button onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              className="pl-settings-btn"
              title="表示設定"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        <div
          className={`pl-dropzone ${dragOver ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {photos === null ? (
            <div className="pl-loading">
              <Loader2 size={22} className="spin" />
              <span>現像中…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="pl-empty">
              <div className="pl-empty-frame">
                <Film size={30} strokeWidth={1.3} />
              </div>
              <h2>
                {total === 0
                  ? "このロールにはまだ写真がありません"
                  : "該当する写真が見つかりません"}
              </h2>
              <p>
                {total === 0
                  ? "写真をここにドラッグするか、追加ボタンから選んでください"
                  : "検索条件やフィルターを変えてみてください"}
              </p>
              {total === 0 && (
                <button
                  className="pl-upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus size={16} />
                  写真を選ぶ
                </button>
              )}
            </div>
          ) : (
            <div className="pl-grid">
              {displayOrder.map((p, i) => {
                const src = p.url;
                const num = frameNumbers.get(p.id) || i + 1;
                const inAlbumView = view.type === "album";
                const membership = inAlbumView ? membershipFor(p.id, view.value) : null;
                const achieved = inAlbumView && isAchieved(p.id, view.value);
                return (
                  <button
                    key={p.id}
                    data-photo-id={p.id}
                    className={`pl-card ${achieved ? "achieved-glow" : ""} ${
                      dragCardId === p.id ? "dragging" : ""
                    }`}
                    onClick={() => {
                      if (dragMeta.current.moved) {
                        dragMeta.current.moved = false;
                        return;
                      }
                      setLightboxId(p.id);
                    }}
                  >
                    <div className="pl-card-img-wrap">
                      {src ? (
                        <img
                          src={src}
                          alt={p.title}
                          loading="lazy"
                          draggable={false}
                          className={inAlbumView && !achieved ? "pl-photo-mono" : ""}
                        />
                      ) : (
                        <div className="pl-card-loading">
                          <Loader2 size={16} className="spin" />
                        </div>
                      )}
                    </div>
                    <div
                      className={`pl-card-frame ${canDrag ? "pl-card-frame-draggable" : ""}`}
                      onPointerDown={(e) => {
                        if (!canDrag) return;
                        e.stopPropagation();
                        handleFramePointerDown(e, p.id);
                      }}
                      onPointerMove={handleFramePointerMove}
                      onPointerUp={handleFramePointerUp}
                      onPointerCancel={handleFramePointerUp}
                    >
                      {!inAlbumView && (
                        <span className="pl-card-num">
                          {String(num).padStart(3, "0")}
                        </span>
                      )}
                      <div className={`pl-card-frame-line1 ${!inAlbumView ? "with-num" : ""}`}>
                        <span className="pl-card-title">{p.title}</span>
                      </div>
                      {inAlbumView && membership && (
                        <div className="pl-card-frame-line2">
                          <span
                            className={`pl-card-progress-text ${
                              achieved ? "done" : ""
                            }`}
                          >
                            {membership.current}/{membership.target}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          {dragOver && (
            <div className="pl-drop-overlay">
              <Upload size={26} />
              <span>ここにドロップして追加</span>
            </div>
          )}
        </div>

        {uploading && uploadProgress && (
          <div className="pl-upload-toast">
            <Loader2 size={14} className="spin" />
            現像中 {uploadProgress.done}/{uploadProgress.total}
          </div>
        )}
        {toast && <div className="pl-toast">{toast}</div>}

        <button
          className="pl-mobile-fab"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="写真を追加"
        >
          {uploading ? (
            <Loader2 size={20} className="spin" />
          ) : (
            <Plus size={22} />
          )}
        </button>
      </main>

      {/* ---------- appearance settings ---------- */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={updateSettings}
          onReset={resetSettings}
          onClearAll={() => {
            setSettingsOpen(false);
            setConfirmClearAll(true);
          }}
          onDeleteLibrary={() => {
            setSettingsOpen(false);
            setConfirmDeleteLibrary(true);
          }}
          libraryName={library.name}
          photoCount={total}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* ---------- delete confirmation ---------- */}
      {confirmDeleteId && (
        <ConfirmDialog
          title="この写真を削除しますか？"
          message="削除すると元に戻せません。"
          confirmLabel="削除する"
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={() => {
            const id = confirmDeleteId;
            setConfirmDeleteId(null);
            deletePhoto(id);
          }}
        />
      )}

      {confirmDeleteAlbum && (
        <ConfirmDialog
          title={`ギフトボード「${confirmDeleteAlbum}」を削除しますか？`}
          message="ギフトボード自体が削除されます。写真は残り、未分類になります。"
          confirmLabel="削除する"
          onCancel={() => setConfirmDeleteAlbum(null)}
          onConfirm={() => {
            const a = confirmDeleteAlbum;
            setConfirmDeleteAlbum(null);
            deleteAlbum(a);
          }}
        />
      )}

      {confirmDeleteFolder && (
        <ConfirmDialog
          title={`アルバム「${confirmDeleteFolder}」を削除しますか？`}
          message="アルバム自体が削除されます。写真は残り、未分類になります。"
          confirmLabel="削除する"
          onCancel={() => setConfirmDeleteFolder(null)}
          onConfirm={() => {
            const f = confirmDeleteFolder;
            setConfirmDeleteFolder(null);
            deleteFolder(f);
          }}
        />
      )}

      {confirmDeleteTag && (
        <ConfirmDialog
          title={`タグ「${confirmDeleteTag}」を削除しますか？`}
          message="このタグが付いているすべての写真から削除されます。"
          confirmLabel="削除する"
          onCancel={() => setConfirmDeleteTag(null)}
          onConfirm={() => {
            const t = confirmDeleteTag;
            setConfirmDeleteTag(null);
            deleteTag(t);
          }}
        />
      )}

      {confirmClearAll && (
        <ConfirmDialog
          title="すべてのデータを削除しますか？"
          message="写真・タグ・ギフトボード・アルバムなど、ライブラリの情報がすべて完全に削除されます。元に戻せません。"
          confirmLabel="すべて削除する"
          onCancel={() => setConfirmClearAll(false)}
          onConfirm={() => {
            setConfirmClearAll(false);
            deleteAllData();
          }}
        />
      )}

      {confirmDeleteLibrary && (
        <ConfirmDialog
          title={`ライブラリ「${library.name}」を削除しますか？`}
          message="このライブラリ自体が削除され、参加している全員がアクセスできなくなります。写真・ギフトボード・アルバムなどすべての情報が完全に失われ、元に戻せません。"
          confirmLabel="ライブラリを削除する"
          onCancel={() => setConfirmDeleteLibrary(false)}
          onConfirm={() => {
            setConfirmDeleteLibrary(false);
            deleteLibrary();
          }}
        />
      )}

      {/* ---------- naming modal (staged uploads) ---------- */}
      {pendingUploads && (
        <NamingModal
          items={pendingUploads}
          onCancel={cancelUpload}
          onConfirm={confirmUpload}
        />
      )}

      {/* ---------- lightbox ---------- */}
      {lightboxPhoto && (
        <div className="pl-lightbox-overlay" onClick={() => setLightboxId(null)}>
          <div className="pl-lightbox" onClick={(e) => e.stopPropagation()}>
            <button className="pl-lb-close" onClick={() => setLightboxId(null)}>
              <X size={18} />
            </button>
            <div
              className={`pl-lb-stage-wrap ${
                view.type === "album" && isAchieved(lightboxPhoto.id, view.value)
                  ? "achieved-glow"
                  : ""
              }`}
            >
              <div
                className="pl-lb-imgstage-scroll"
                ref={lbScrollRef}
                onScroll={handleLbScroll}
              >
                {filtered.map((p) => {
                  const achievedHere =
                    view.type === "album" && isAchieved(p.id, view.value);
                  return (
                    <div className="pl-lb-imgstage-item" key={p.id}>
                      {p.url ? (
                        <img
                          src={p.url}
                          alt={p.title}
                          className={
                            view.type === "album" && !achievedHere ? "pl-photo-mono" : ""
                          }
                        />
                      ) : (
                        <Loader2 size={24} className="spin" />
                      )}
                    </div>
                  );
                })}
              </div>
              {view.type !== "album" && (
                <FrameBadge n={frameNumbers.get(lightboxPhoto.id) || lightboxIdx + 1} />
              )}
            </div>

            <div className="pl-lb-meta">
              <div className="pl-lb-meta-row">
                <input
                  className="pl-lb-title"
                  value={lightboxPhoto.title}
                  onChange={(e) =>
                    updatePhoto(lightboxPhoto.id, { title: e.target.value })
                  }
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.target.blur();
                  }}
                  placeholder="タイトルなし"
                />
                <button
                  className={`pl-lb-fav ${lightboxPhoto.favorite ? "on" : ""}`}
                  onClick={() => toggleFavorite(lightboxPhoto.id)}
                >
                  <Star
                    size={16}
                    fill={lightboxPhoto.favorite ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="pl-lb-delete"
                  onClick={() => setConfirmDeleteId(lightboxPhoto.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="pl-lb-field">
                <span>番号(並び順)</span>
                <div className="pl-lb-order-row">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={contextList.length}
                    className="pl-lb-value-input"
                    value={orderDraft}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setOrderDraft(e.target.value)}
                    onBlur={commitOrder}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.target.blur();
                    }}
                  />
                  <span className="pl-lb-order-hint">
                    / {contextList.length}枚中
                  </span>
                </div>
              </div>

              <div className="pl-lb-field">
                <span>ギフトボード(複数選択可)</span>
                {albums.length === 0 && (
                  <div className="pl-lb-no-albums">
                    まだギフトボードがありません。サイドバーの「+」から作成してください。
                  </div>
                )}
                <div className="pl-lb-folder-list">
                  {albums.map((a) => {
                    const isMember = !!membershipFor(lightboxPhoto.id, a.name);
                    return (
                      <label key={a.id} className="pl-lb-folder-check">
                        <input
                          type="checkbox"
                          checked={isMember}
                          onChange={(e) =>
                            setPhotoAlbumMembership(
                              lightboxPhoto.id,
                              a.id,
                              e.target.checked
                            )
                          }
                        />
                        <span>{a.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {view.type === "album" && membershipFor(lightboxPhoto.id, view.value) && (
                <div className="pl-lb-field pl-lb-progress-field">
                  <span>目標の進捗(「{view.value}」)</span>
                  {(() => {
                    const m = membershipFor(lightboxPhoto.id, view.value);
                    const achieved = isAchieved(lightboxPhoto.id, view.value);
                    return (
                      <div className="pl-lb-progress-row">
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          className="pl-lb-value-input"
                          value={m.current}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                          }}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : Number(e.target.value);
                            updateMembershipProgress(lightboxPhoto.id, m.albumId, {
                              current: Number.isFinite(v) ? Math.max(0, v) : 0,
                            });
                          }}
                        />
                        <span className="pl-lb-progress-slash">/</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          className="pl-lb-value-input"
                          value={m.target}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                          }}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : Number(e.target.value);
                            updateMembershipProgress(lightboxPhoto.id, m.albumId, {
                              target: Number.isFinite(v) ? Math.max(0, v) : 0,
                            });
                          }}
                        />
                        {achieved && <span className="pl-lb-achieved-badge">達成</span>}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="pl-lb-field">
                <span>アルバム(複数選択可)</span>
                {folders.length === 0 && (
                  <div className="pl-lb-no-albums">
                    まだアルバムがありません。サイドバーの「+」から作成してください。
                  </div>
                )}
                <div className="pl-lb-folder-list">
                  {folders.map((f) => {
                    const isMember = !!folderMembershipFor(lightboxPhoto.id, f.name);
                    return (
                      <label key={f.id} className="pl-lb-folder-check">
                        <input
                          type="checkbox"
                          checked={isMember}
                          onChange={(e) =>
                            setPhotoFolderMembership(
                              lightboxPhoto.id,
                              f.id,
                              e.target.checked
                            )
                          }
                        />
                        <span>{f.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <label className="pl-lb-field">
                <span>タグ</span>
                <TagEditor
                  tags={lightboxPhoto.tags || []}
                  onChange={(tags) => updatePhoto(lightboxPhoto.id, { tags })}
                />
              </label>

              <div className="pl-lb-date">
                {new Date(lightboxPhoto.createdAt).toLocaleString("ja-JP")}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onReset,
  onClearAll,
  onDeleteLibrary,
  libraryName,
  onClose,
  photoCount,
}) {
  const [section, setSection] = useState(null); // null | 'appearance' | 'reset'

  const title =
    section === "appearance" ? "表示効果" : section === "reset" ? "リセット" : "設定";

  return (
    <div className="pl-settings-overlay" onClick={onClose}>
      <div className="pl-settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pl-naming-head">
          {section ? (
            <button className="pl-settings-back" onClick={() => setSection(null)}>
              <ChevronLeft size={16} />
              {title}
            </button>
          ) : (
            <h2>{title}</h2>
          )}
          <button className="pl-lb-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {section === null && (
          <div className="pl-settings-body">
            <button
              className="pl-settings-menu-item"
              onClick={() => setSection("appearance")}
            >
              <span className="pl-settings-menu-icon">
                <Sparkles size={16} />
              </span>
              <span className="pl-settings-menu-text">
                <span>表示効果</span>
                <small>色や輝きの強さなどを変更</small>
              </span>
              <ChevronRight size={16} className="pl-settings-menu-chevron" />
            </button>

            <button
              className="pl-settings-menu-item"
              onClick={() => setSection("reset")}
            >
              <span className="pl-settings-menu-icon danger">
                <Trash2 size={16} />
              </span>
              <span className="pl-settings-menu-text">
                <span>リセット</span>
                <small>写真・タグ・ギフトボード・アルバムを一括削除</small>
              </span>
              <ChevronRight size={16} className="pl-settings-menu-chevron" />
            </button>
          </div>
        )}

        {section === "appearance" && (
          <div className="pl-settings-body">
            <div className="pl-settings-row">
              <div className="pl-settings-label">
                <span>メインカラー</span>
                <small>ボタンや達成数などに使われる色</small>
              </div>
              <input
                type="color"
                className="pl-settings-swatch"
                value={settings.accent}
                onChange={(e) => onChange({ accent: e.target.value })}
              />
            </div>

            <div className="pl-settings-row">
              <div className="pl-settings-label">
                <span>輝きの色</span>
                <small>達成した写真の光彩に使われるもう一つの色</small>
              </div>
              <input
                type="color"
                className="pl-settings-swatch"
                value={settings.glow}
                onChange={(e) => onChange({ glow: e.target.value })}
              />
            </div>

            <div className="pl-settings-row column">
              <div className="pl-settings-label">
                <span>輝きの強度</span>
                <small>達成した写真まわりの光の強さ</small>
              </div>
              <div className="pl-settings-slider-row">
                <input
                  type="range"
                  min="0.3"
                  max="2"
                  step="0.1"
                  value={settings.intensity}
                  onChange={(e) =>
                    onChange({ intensity: Number(e.target.value) })
                  }
                />
                <span className="pl-settings-slider-val">
                  {Math.round(settings.intensity * 100)}%
                </span>
              </div>
            </div>

            <div
              className="pl-settings-preview achieved-glow"
              style={{ "--glow-intensity": settings.intensity }}
            >
              プレビュー
            </div>

            <button className="pl-settings-reset-link" onClick={onReset}>
              <RotateCcw size={13} />
              表示効果を初期値に戻す
            </button>
          </div>
        )}

        {section === "reset" && (
          <div className="pl-settings-body">
            <div className="pl-settings-row">
              <div className="pl-settings-label">
                <span>すべてのデータを削除</span>
                <small>
                  写真{photoCount}枚・ギフトボード・アルバム・タグなど、ライブラリの情報を
                  すべて完全に削除します。元に戻せません。
                </small>
              </div>
              <button
                className="pl-settings-danger-btn"
                onClick={onClearAll}
                disabled={photoCount === 0}
              >
                <Trash2 size={13} />
                削除する
              </button>
            </div>

            <div className="pl-settings-row pl-settings-row-divider">
              <div className="pl-settings-label">
                <span>ライブラリ「{libraryName}」を削除</span>
                <small>
                  このライブラリ自体を削除します。参加している全員がアクセスできなくなり、
                  元に戻せません。
                </small>
              </div>
              <button className="pl-settings-danger-btn" onClick={onDeleteLibrary}>
                <Trash2 size={13} />
                削除する
              </button>
            </div>
          </div>
        )}

        <div className="pl-naming-actions">
          <button className="pl-upload-btn" onClick={onClose}>
            <Check size={16} />
            完了
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  return (
    <div className="pl-confirm-overlay" onClick={onCancel}>
      <div className="pl-confirm-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        <div className="pl-confirm-actions">
          <button className="pl-naming-cancel" onClick={onCancel}>
            {cancelLabel || "キャンセル"}
          </button>
          <button className="pl-confirm-danger" onClick={onConfirm}>
            <Trash2 size={14} />
            {confirmLabel || "削除する"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NamingModal({ items, onCancel, onConfirm }) {
  const [drafts, setDrafts] = useState(items);

  function setTitle(tempId, title) {
    setDrafts((ds) => ds.map((d) => (d.tempId === tempId ? { ...d, title } : d)));
  }

  return (
    <div className="pl-naming-overlay" onClick={onCancel}>
      <div className="pl-naming-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pl-naming-head">
          <h2>
            {drafts.length === 1
              ? "写真に名前を付ける"
              : `${drafts.length}枚の写真に名前を付ける`}
          </h2>
          <button className="pl-lb-close" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <div className="pl-naming-list">
          {drafts.map((d, i) => (
            <div className="pl-naming-item" key={d.tempId}>
              <div className="pl-naming-thumb">
                <img src={d.dataUrl} alt="" />
                <FrameBadge n={i + 1} />
              </div>
              <div className="pl-naming-fields">
                <input
                  autoFocus={i === 0}
                  className="pl-naming-title-input"
                  value={d.title}
                  placeholder="タイトルなし"
                  onChange={(e) => setTitle(d.tempId, e.target.value)}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onConfirm(drafts);
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="pl-naming-actions">
          <button className="pl-naming-cancel" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="pl-upload-btn"
            onClick={() => onConfirm(drafts)}
          >
            <Check size={16} />
            ライブラリに追加
          </button>
        </div>
      </div>
    </div>
  );
}

function TagEditor({ tags, onChange }) {
  const [draft, setDraft] = useState("");
  function commit() {
    const t = draft.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  }
  return (
    <div className="pl-tag-editor">
      {tags.map((t) => (
        <span key={t} className="pl-tag-pill">
          <TagIcon size={10} />
          {t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))}>
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        placeholder="タグを追加…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

// ---------- styles ----------

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

.pl-root {
  --bg: #05070d;
  --surface: #0b0f1c;
  --surface-raised: #121a2c;
  --photo-bg: color-mix(in srgb, var(--bg) 72%, color-mix(in srgb, var(--accent) 55%, var(--accent2) 45%) 28%);
  --border: #223049;
  --accent: #35e6ff;
  --accent-hover: #7cf1ff;
  --accent-deep: #12a8c2;
  --accent2: #ff2fc0;
  --accent-rgb: 53,230,255;
  --accent2-rgb: 255,47,192;
  --glow-intensity: 1;
  --text: #eaf3ff;
  --text-muted: #7c8ba8;
  --danger: #ff4d6d;
  font-family: 'Inter', system-ui, sans-serif;
  color: var(--text);
  background:
    radial-gradient(circle at 12% -8%, rgba(var(--accent-rgb),0.14), transparent 42%),
    radial-gradient(circle at 92% 108%, rgba(var(--accent2-rgb),0.12), transparent 46%),
    var(--bg);
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  min-height: 640px;
  max-height: 100vh;
  max-height: 100dvh;
  border-radius: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  position: relative;
}
.pl-root * { box-sizing: border-box; }
.pl-root button { font-family: inherit; cursor: pointer; }
.spin { animation: pl-spin 1s linear infinite; }
@keyframes pl-spin { to { transform: rotate(360deg); } }

/* ---- sidebar ---- */
.pl-sidebar {
  width: 236px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 20px 14px;
  display: flex;
  flex-direction: column;
  gap: 22px;
  overflow-y: auto;
}
@media (min-width: 761px) {
  .pl-sidebar.collapsed { display: none; }
}
.pl-sidebar-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
}
.pl-sidebar-toggle-btn:hover { color: var(--accent); border-color: var(--accent); }
.pl-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 15.5px;
  letter-spacing: 0.01em;
  color: var(--accent);
  padding: 0 4px;
}
.pl-upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: var(--accent);
  color: #06121a;
  border: none;
  border-radius: 7px;
  padding: 9px 14px;
  font-weight: 600;
  font-size: 13px;
  transition: background 0.15s;
}
.pl-upload-btn:hover { background: var(--accent-hover); }
.pl-upload-btn:disabled { opacity: 0.6; cursor: default; }

.pl-nav { display: flex; flex-direction: column; gap: 3px; }
.pl-nav-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: 0 8px 4px;
}
.pl-nav-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 4px;
}
.pl-icon-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 5px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pl-icon-btn:hover { color: var(--accent); border-color: var(--accent); }

.pl-nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 7px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  width: 100%;
}
.pl-nav-item span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-nav-item em {
  font-style: normal;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.7;
}
.pl-nav-item:hover { background: var(--surface-raised); color: var(--text); }
.pl-nav-item.active { background: var(--surface-raised); color: var(--accent); }
.pl-nav-item.active em { color: var(--accent); opacity: 1; }

.pl-nav-item-row {
  display: flex;
  align-items: center;
  gap: 2px;
}
.pl-nav-item-row .pl-nav-item { width: auto; flex: 1; min-width: 0; }
.pl-nav-item-del {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: 6px;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}
.pl-nav-item-row:hover .pl-nav-item-del { opacity: 0.6; }
.pl-nav-item-del:hover { opacity: 1 !important; color: var(--danger); background: rgba(255,77,109,0.12); }

.pl-clear-all-btn {
  margin-top: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--danger);
  border-radius: 7px;
  padding: 8px 12px;
  font-size: 12.5px;
  opacity: 0.75;
}
.pl-clear-all-btn:hover { opacity: 1; border-color: var(--danger); background: rgba(255,77,109,0.08); }

.pl-empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  padding: 4px 8px;
}
.pl-new-album { display: flex; align-items: center; gap: 6px; padding: 2px 4px 6px; }
.pl-new-album input {
  flex: 1;
  min-width: 0;
  background: var(--surface-raised);
  border: 1px solid var(--accent);
  border-radius: 5px;
  padding: 6px 8px;
  color: var(--text);
  font-size: 12.5px;
}
.pl-new-album input:focus { outline: none; }
.pl-new-album-add {
  width: 24px; height: 24px;
  flex-shrink: 0;
  border-color: var(--accent);
  color: var(--accent);
}
.pl-new-album-add:hover { background: var(--accent); color: #06121a; }

.pl-tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 4px; }
.pl-tag-chip-wrap {
  display: flex;
  align-items: stretch;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 20px;
  overflow: hidden;
}
.pl-tag-chip-wrap:hover { border-color: var(--accent); }
.pl-tag-chip {
  background: transparent;
  border: none;
  color: var(--text-muted);
  padding: 4px 4px 4px 9px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.pl-tag-chip em { font-style: normal; opacity: 0.65; }
.pl-tag-chip-wrap:hover .pl-tag-chip { color: var(--text); }
.pl-tag-chip-wrap:has(.pl-tag-chip.active) {
  background: var(--accent);
  border-color: var(--accent);
}
.pl-tag-chip.active { color: #06121a; }
.pl-tag-chip.active em { opacity: 0.7; }
.pl-tag-chip-del {
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
  padding-right: 7px;
}
.pl-tag-chip-wrap:hover .pl-tag-chip-del { opacity: 0.6; }
.pl-tag-chip-del:hover { opacity: 1 !important; color: var(--danger); }
.pl-tag-chip-wrap:has(.pl-tag-chip.active) .pl-tag-chip-del { color: rgba(6,18,26,0.6); }
.pl-tag-chip-wrap:has(.pl-tag-chip.active) .pl-tag-chip-del:hover { color: var(--danger); }

.pl-storage-warn {
  margin-top: auto;
  font-size: 11px;
  line-height: 1.5;
  color: var(--danger);
  background: rgba(209,87,63,0.1);
  border: 1px solid rgba(209,87,63,0.3);
  border-radius: 6px;
  padding: 8px 10px;
}

.pl-library-footer {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pl-library-name {
  font-family: 'Fraunces', serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.pl-library-code-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--text-muted);
}
.pl-library-code-row button {
  background: none;
  border: none;
  color: var(--text-muted);
  display: flex;
  flex-shrink: 0;
}
.pl-library-code-row button:hover { color: var(--accent); }
.pl-library-leave {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 0;
  text-align: left;
}
.pl-library-leave:hover { color: var(--accent); }

/* ---- main ---- */
.pl-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
}
.sprockets {
  display: flex;
  gap: 8px;
  padding: 8px 20px;
  background: #04060a;
  overflow: hidden;
}
.sprockets span {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--bg);
  flex-shrink: 0;
}

.pl-topbar {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 20px;
  padding: 22px 28px;
  border-bottom: 1px solid var(--border);
}
.pl-topbar-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pl-topbar-title-group { min-width: 0; }
.pl-topbar-left .pl-clear-filter { margin-top: 6px; }
.pl-topbar-center { display: flex; justify-content: center; }
.pl-topbar-right { display: flex; align-items: center; gap: 10px; justify-content: flex-end; }
.pl-topbar h1 {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  font-size: 26px;
  margin: 0;
  letter-spacing: -0.01em;
}
.pl-count-ratio {
  display: flex;
  align-items: baseline;
  gap: 3px;
}
.pl-count-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin: 0 3px;
}
.pl-count-num {
  font-family: 'Fraunces', serif;
  font-weight: 600;
  line-height: 1;
}
.pl-count-num.achieved {
  font-size: 34px;
  color: var(--accent);
  text-shadow: 0 2px calc(16px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.3 * var(--glow-intensity)));
}
.pl-count-num.total {
  font-size: 20px;
  color: var(--text-muted);
  font-weight: 500;
}
.pl-count-slash {
  font-family: 'Fraunces', serif;
  font-size: 20px;
  color: var(--border);
  margin: 0 1px;
}
.pl-clear-filter {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 20px;
  padding: 2px 8px;
  font-size: 11px;
}
.pl-clear-filter:hover { color: var(--accent); border-color: var(--accent); }

.pl-search {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  min-width: 260px;
  color: var(--text-muted);
}
.pl-search input {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 13px;
  flex: 1;
  min-width: 0;
}
.pl-search input:focus { outline: none; }
.pl-search input::placeholder { color: var(--text-muted); }
.pl-search button { background: none; border: none; color: var(--text-muted); display: flex; }

.pl-dropzone {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px 60px;
  position: relative;
}
.pl-dropzone.drag { background: rgba(var(--accent-rgb),0.04); }
.pl-drop-overlay {
  position: absolute;
  inset: 12px;
  border: 2px dashed var(--accent);
  border-radius: 12px;
  background: rgba(23,19,15,0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--accent);
  font-weight: 600;
  pointer-events: none;
}

.pl-loading, .pl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 10px;
  padding: 80px 20px;
  color: var(--text-muted);
}
.pl-empty-frame {
  width: 62px; height: 62px;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  margin-bottom: 6px;
}
.pl-empty h2 {
  font-family: 'Fraunces', serif;
  font-weight: 500;
  font-size: 17px;
  color: var(--text);
  margin: 0;
}
.pl-empty p { font-size: 13px; margin: 0 0 8px; max-width: 280px; }

.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 18px;
}
.pl-card {
  background: none;
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
  text-align: left;
  color: var(--text);
  transition: box-shadow 0.6s ease, border-color 0.6s ease;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.pl-card-img-wrap {
  position: relative;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  background: var(--photo-bg);
}
.achieved-glow {
  border-color: var(--accent) !important;
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 calc(18px * var(--glow-intensity)) calc(3px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.55 * var(--glow-intensity))),
    0 0 calc(40px * var(--glow-intensity)) calc(10px * var(--glow-intensity)) rgba(var(--accent2-rgb),calc(0.22 * var(--glow-intensity)));
  animation: pl-glow-pulse 2.6s ease-in-out infinite;
}
@keyframes pl-glow-pulse {
  0%, 100% {
    box-shadow:
      0 0 0 1px var(--accent),
      0 0 calc(18px * var(--glow-intensity)) calc(3px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.5 * var(--glow-intensity))),
      0 0 calc(40px * var(--glow-intensity)) calc(10px * var(--glow-intensity)) rgba(var(--accent2-rgb),calc(0.2 * var(--glow-intensity)));
  }
  50% {
    box-shadow:
      0 0 0 1px var(--accent),
      0 0 calc(26px * var(--glow-intensity)) calc(6px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.75 * var(--glow-intensity))),
      0 0 calc(56px * var(--glow-intensity)) calc(14px * var(--glow-intensity)) rgba(var(--accent2-rgb),calc(0.32 * var(--glow-intensity)));
  }
}
.pl-card-img-wrap img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform 0.25s ease, filter 0.6s ease;
}
.pl-card:hover .pl-card-img-wrap img { transform: scale(1.04); }
.pl-photo-mono {
  filter: grayscale(1) contrast(1.05) brightness(0.97);
}
.pl-card-loading {
  width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-muted);
}
.pl-card.dragging {
  opacity: 0.5;
}
.pl-card.dragging .pl-card-frame {
  background: var(--surface-raised);
}
.frame-badge {
  position: absolute;
  left: 6px; bottom: 6px;
  background: rgba(4,6,10,0.72);
  color: var(--accent);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 4px;
}

.pl-card-frame {
  position: relative;
  border-top: 1px solid var(--border);
  padding: 4px 4px 7px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--surface);
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
}
.pl-card-frame-draggable { cursor: grab; }
.pl-card.dragging .pl-card-frame-draggable { cursor: grabbing; }
.pl-card-num {
  position: absolute;
  top: 6px;
  left: 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  line-height: 1;
  color: var(--accent);
}
.pl-card-frame-line1 {
  display: flex;
  justify-content: center;
  padding: 0;
  min-width: 0;
}
.pl-card-frame-line1.with-num { margin-top: 15px; }
.pl-card-title {
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  text-align: center;
}
.pl-card-frame-line2 { display: flex; justify-content: center; padding: 0; }
.pl-card-progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-muted);
}
.pl-card-progress-text.done {
  color: var(--accent);
  font-weight: 600;
  text-shadow: 0 1px calc(6px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.4 * var(--glow-intensity)));
}


.pl-upload-toast, .pl-toast {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 9px 16px;
  border-radius: 20px;
  font-size: 12.5px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.pl-upload-toast { bottom: 66px; color: var(--accent); }

/* ---- settings ---- */
.pl-settings-btn {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 8px;
}
.pl-settings-btn:hover { color: var(--accent); border-color: var(--accent); }
.pl-settings-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4,6,10,0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 65;
  padding: 24px;
}
.pl-settings-modal {
  width: 100%;
  max-width: 420px;
  max-height: 85vh;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pl-settings-body {
  padding: 6px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.pl-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.pl-settings-row.column { flex-direction: column; align-items: stretch; gap: 8px; }
.pl-settings-row-divider {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.pl-settings-label { display: flex; flex-direction: column; gap: 2px; }
.pl-settings-label span { font-size: 13px; font-weight: 500; }
.pl-settings-label small {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--text-muted);
}
.pl-settings-swatch {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: none;
  padding: 2px;
  cursor: pointer;
}
.pl-settings-slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pl-settings-slider-row input[type="range"] {
  flex: 1;
  accent-color: var(--accent);
}
.pl-settings-slider-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--accent);
  width: 42px;
  text-align: right;
  flex-shrink: 0;
}
.pl-settings-preview {
  margin-top: 4px;
  padding: 18px;
  border-radius: 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  text-align: center;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  text-transform: uppercase;
}
.pl-settings-back {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: var(--text);
  font-family: 'Fraunces', serif;
  font-weight: 500;
  font-size: 16px;
  padding: 0;
}
.pl-settings-back:hover { color: var(--accent); }
.pl-settings-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px 14px;
  text-align: left;
}
.pl-settings-menu-item:hover { border-color: var(--accent); }
.pl-settings-menu-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--accent-rgb),0.14);
  color: var(--accent);
}
.pl-settings-menu-icon.danger { background: rgba(255,77,109,0.14); color: var(--danger); }
.pl-settings-menu-text { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pl-settings-menu-text span { font-size: 13.5px; font-weight: 500; }
.pl-settings-menu-text small {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  color: var(--text-muted);
}
.pl-settings-menu-chevron { color: var(--text-muted); flex-shrink: 0; }
.pl-settings-menu-item:hover .pl-settings-menu-chevron { color: var(--accent); }
.pl-settings-reset-link {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  padding: 2px;
}
.pl-settings-reset-link:hover { color: var(--accent); }
.pl-settings-danger-btn {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: 7px;
  padding: 8px 12px;
  font-size: 12.5px;
  font-weight: 500;
}
.pl-settings-danger-btn:hover { background: rgba(255,77,109,0.12); }
.pl-settings-danger-btn:disabled {
  opacity: 0.4;
  border-color: var(--border);
  color: var(--text-muted);
  cursor: default;
}

/* ---- confirm dialog ---- */
.pl-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10,8,6,0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
  padding: 24px;
}
.pl-confirm-modal {
  width: 100%;
  max-width: 340px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 20px;
}
.pl-confirm-modal h3 {
  font-family: 'Fraunces', serif;
  font-weight: 500;
  font-size: 16px;
  margin: 0 0 6px;
}
.pl-confirm-modal p {
  font-size: 12.5px;
  color: var(--text-muted);
  margin: 0;
}
.pl-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.pl-confirm-danger {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--danger);
  color: #fdf3ef;
  border: none;
  border-radius: 7px;
  padding: 9px 14px;
  font-size: 13px;
  font-weight: 600;
}
.pl-confirm-danger:hover { filter: brightness(1.08); }

/* ---- naming modal ---- */
.pl-naming-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10,8,6,0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
  padding: 24px;
}
.pl-naming-modal {
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.pl-naming-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pl-naming-head h2 {
  font-family: 'Fraunces', serif;
  font-weight: 500;
  font-size: 16px;
  margin: 0;
}
.pl-naming-head .pl-lb-close { position: static; background: transparent; }
.pl-naming-list {
  overflow-y: auto;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pl-naming-item {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pl-naming-thumb {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 7px;
  overflow: hidden;
  background: var(--photo-bg);
  border: 1px solid var(--border);
  flex-shrink: 0;
}
.pl-naming-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pl-naming-thumb .frame-badge { font-size: 8px; padding: 1px 4px; left: 3px; bottom: 3px; }
.pl-naming-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pl-naming-title-input {
  width: 100%;
  min-width: 0;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 7px;
  padding: 9px 10px;
  font-size: 13px;
}
.pl-naming-title-input:focus { outline: none; border-color: var(--accent); }
.pl-naming-progress-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.pl-naming-progress-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  flex-shrink: 0;
}
.pl-naming-value-input {
  width: 56px;
  min-width: 0;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 5px 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  text-align: center;
  -moz-appearance: textfield;
}
.pl-naming-value-input::-webkit-outer-spin-button,
.pl-naming-value-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.pl-naming-value-input:focus { outline: none; border-color: var(--accent); }
.pl-naming-progress-slash { color: var(--text-muted); font-family: 'JetBrains Mono', monospace; font-size: 12px; }
.pl-naming-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 18px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.pl-naming-cancel {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 7px;
  padding: 9px 14px;
  font-size: 13px;
}
.pl-naming-cancel:hover { color: var(--text); border-color: var(--text-muted); }

/* ---- lightbox ---- */
.pl-lightbox-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10,8,6,0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px;
}
.pl-lightbox {
  width: 100%;
  max-width: 980px;
  max-height: 90vh;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  display: grid;
  grid-template-columns: 1fr 300px;
  overflow: hidden;
  position: relative;
}
.pl-lb-close {
  position: absolute;
  top: 12px; right: 12px;
  background: rgba(4,6,10,0.6);
  border: none;
  color: var(--text);
  width: 30px; height: 30px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  z-index: 3;
}
.pl-lb-close:hover { color: var(--accent); }

.pl-lb-stage-wrap {
  position: relative;
  background: var(--photo-bg);
  overflow: hidden;
  min-height: 320px;
  transition: box-shadow 0.6s ease;
}
.pl-lb-imgstage-scroll {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 320px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
.pl-lb-imgstage-scroll::-webkit-scrollbar { display: none; }
.pl-lb-imgstage-item {
  flex: 0 0 100%;
  scroll-snap-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
}
.pl-lb-imgstage-item img {
  max-width: 100%;
  max-height: 88vh;
  object-fit: contain;
  transition: filter 0.6s ease;
}
.pl-lb-stage-wrap .frame-badge { top: 12px; left: 12px; bottom: auto; z-index: 3; }
.pl-lb-stage-wrap.achieved-glow {
  box-shadow:
    inset 0 0 0 2px var(--accent),
    inset 0 0 calc(46px * var(--glow-intensity)) calc(8px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.4 * var(--glow-intensity))),
    inset 0 0 calc(100px * var(--glow-intensity)) calc(24px * var(--glow-intensity)) rgba(var(--accent2-rgb),calc(0.18 * var(--glow-intensity)));
  animation: pl-glow-pulse-inset 2.6s ease-in-out infinite;
}
@keyframes pl-glow-pulse-inset {
  0%, 100% {
    box-shadow:
      inset 0 0 0 2px var(--accent),
      inset 0 0 calc(46px * var(--glow-intensity)) calc(8px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.4 * var(--glow-intensity))),
      inset 0 0 calc(100px * var(--glow-intensity)) calc(24px * var(--glow-intensity)) rgba(var(--accent2-rgb),calc(0.18 * var(--glow-intensity)));
  }
  50% {
    box-shadow:
      inset 0 0 0 2px var(--accent),
      inset 0 0 calc(64px * var(--glow-intensity)) calc(14px * var(--glow-intensity)) rgba(var(--accent-rgb),calc(0.6 * var(--glow-intensity))),
      inset 0 0 calc(120px * var(--glow-intensity)) calc(30px * var(--glow-intensity)) rgba(var(--accent2-rgb),calc(0.26 * var(--glow-intensity)));
  }
}

.pl-lb-meta {
  border-left: 1px solid var(--border);
  padding: 54px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}
.pl-lb-meta-row { display: flex; align-items: center; gap: 6px; }
.pl-lb-title {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  color: var(--text);
  font-family: 'Fraunces', serif;
  font-size: 16px;
  padding: 4px 2px;
  min-width: 0;
}
.pl-lb-title:focus { outline: none; border-bottom: 1px solid var(--accent); }
.pl-lb-fav, .pl-lb-delete {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-muted);
  width: 30px; height: 30px;
  border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.pl-lb-fav:hover { color: var(--accent); border-color: var(--accent); }
.pl-lb-fav.on { color: var(--accent); border-color: var(--accent); }
.pl-lb-delete:hover { color: var(--danger); border-color: var(--danger); }

.pl-lb-field { display: flex; flex-direction: column; gap: 6px; }
.pl-lb-field > span {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.pl-lb-field select {
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 8px;
  font-size: 13px;
}
.pl-lb-field select:focus { outline: none; border-color: var(--accent); }

.pl-lb-order-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pl-lb-order-hint {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  color: var(--text-muted);
}

.pl-lb-progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pl-lb-value-input {
  width: 64px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  text-align: center;
  /* hide native spinner arrows for a cleaner look */
  -moz-appearance: textfield;
}
.pl-lb-value-input::-webkit-outer-spin-button,
.pl-lb-value-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.pl-lb-value-input:focus { outline: none; border-color: var(--accent); }
.pl-lb-progress-slash {
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}
.pl-lb-achieved-badge {
  margin-left: 4px;
  background: rgba(var(--accent-rgb),0.16);
  color: var(--accent);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10.5px;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  border-radius: 20px;
}

.pl-lb-no-albums {
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-raised);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 10px;
}

.pl-lb-folder-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 160px;
  overflow-y: auto;
}
.pl-lb-folder-check {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 6px 12px 6px 10px;
  cursor: pointer;
}
.pl-lb-folder-check input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
  flex-shrink: 0;
}
.pl-lb-folder-check span {
  font-size: 12.5px;
  color: var(--text);
}
.pl-lb-folder-check:has(input:checked) {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb),0.1);
}

.pl-tag-editor {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
}
.pl-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--accent-rgb),0.14);
  color: var(--accent);
  border-radius: 20px;
  padding: 3px 6px 3px 8px;
  font-size: 11.5px;
  font-family: 'JetBrains Mono', monospace;
}
.pl-tag-pill button {
  background: none; border: none; color: inherit;
  display: flex; opacity: 0.7;
}
.pl-tag-pill button:hover { opacity: 1; }
.pl-tag-editor input {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 12.5px;
  flex: 1;
  min-width: 80px;
  padding: 3px 4px;
}
.pl-tag-editor input:focus { outline: none; }

.pl-lb-date {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

/* ---- mobile-only UI (hidden on desktop by default) ---- */
.pl-mobile-close-btn,
.pl-mobile-backdrop,
.pl-mobile-fab {
  display: none;
}
.pl-sidebar-head { display: contents; }

@media (max-width: 760px) {
  /* sidebar becomes an off-canvas drawer instead of a stacked/wrapped bar */
  .pl-mobile-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(2,3,6,0.6);
    z-index: 78;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
  }
  .pl-mobile-backdrop.show { opacity: 1; pointer-events: auto; }

  .pl-sidebar {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 84vw;
    max-width: 320px;
    max-height: none;
    z-index: 80;
    flex-direction: column;
    flex-wrap: nowrap;
    border-right: 1px solid var(--border);
    border-bottom: none;
    box-shadow: 10px 0 32px rgba(0,0,0,0.45);
    transform: translateX(-105%);
    transition: transform 0.25s ease;
    overflow-y: auto;
  }
  .pl-sidebar.mobile-open { transform: translateX(0); }

  .pl-sidebar-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .pl-mobile-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .pl-mobile-close-btn:hover { color: var(--accent); border-color: var(--accent); }
  .pl-topbar-title-group { min-width: 0; }

  .pl-main { flex: 1 1 auto; min-height: 0; width: 100%; }
  .pl-dropzone { min-height: 0; padding: 16px 10px 90px; }
  .pl-grid { grid-template-columns: repeat(3, 1fr); gap: 6px; }

  .pl-topbar {
    grid-template-columns: 1fr;
    padding: 14px 16px;
    gap: 8px;
  }
  .pl-topbar h1 { font-size: 20px; }
  .pl-topbar-center { justify-content: flex-start; }
  .pl-count-num.achieved { font-size: 26px; }
  .pl-topbar-right { justify-content: stretch; }
  .pl-search { flex: 1; }

  .pl-mobile-fab {
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    right: 18px;
    bottom: 22px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent);
    color: #06121a;
    border: none;
    box-shadow: 0 10px 26px rgba(0,0,0,0.45), 0 0 0 4px rgba(var(--accent-rgb),0.18);
    z-index: 40;
  }
  .pl-mobile-fab:disabled { opacity: 0.6; }

  .pl-lightbox { grid-template-columns: 1fr; overflow-y: auto; }
  .pl-lb-meta { padding-top: 20px; }
  .pl-settings-modal, .pl-naming-modal, .pl-confirm-modal { max-width: 100%; }

  /* iOS Safari auto-zooms the page when a focused field's font-size is
     under 16px — keep every field at/above that so tapping in never zooms. */
  .pl-root input, .pl-root select, .pl-root textarea {
    font-size: 16px !important;
  }
}
`;
