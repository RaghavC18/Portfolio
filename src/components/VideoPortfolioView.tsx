import React, { useState, useEffect, useRef } from 'react';
import { VideoReel, PortfolioInfo } from '../types';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Film,
  User,
  Sparkles,
  Mail,
  Upload,
  Maximize2,
  Check,
  Plus,
  Trash2,
  Lock,
  Unlock,
  Edit3,
  X,
  Video,
  Camera,
  Link as LinkIcon,
  RefreshCw,
} from 'lucide-react';
import {
  deleteR2Object,
  isR2Url,
  uploadFileToServer,
  saveServerPortfolio,
  formatVideoUrl,
  verifyCreatorPin,
  logoutCreator,
} from '../utils/api';

interface VideoPortfolioViewProps {
  info: PortfolioInfo;
  reels: VideoReel[];
  onUpdateReels?: (reels: VideoReel[]) => void;
  onUpdateInfo?: (info: PortfolioInfo) => void;
}

export const VideoPortfolioView: React.FC<VideoPortfolioViewProps> = ({
  info,
  reels: initialReels,
  onUpdateReels,
  onUpdateInfo,
}) => {
  const [activeScreen, setActiveScreen] = useState<'none' | 'work' | 'about' | 'skills' | 'contact'>('none');
  const [timecode, setTimecode] = useState('00:00:00:00');
  const [reels, setReels] = useState<VideoReel[]>(initialReels);

  const updateReelsAndParent = (updater: VideoReel[] | ((prev: VideoReel[]) => VideoReel[])) => {
    const next = typeof updater === 'function' ? updater(reels) : updater;
    setReels(next);
    if (onUpdateReels) {
      onUpdateReels(next);
    }
  };
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
  const [mutedVideoId, setMutedVideoId] = useState<Record<string, boolean>>({});
  const [activeReelId, setActiveReelId] = useState<string | null>(initialReels[0]?.id || null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  // Video playback progress state
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
  const [videoCurrentTime, setVideoCurrentTime] = useState<Record<string, string>>({});
  const [fullscreenReelId, setFullscreenReelId] = useState<string | null>(null);
  const [deletingReel, setDeletingReel] = useState<{ id: string; title: string } | null>(null);
  const [isDeletingReel, setIsDeletingReel] = useState(false);
  const [videoPlaybackErrors, setVideoPlaybackErrors] = useState<Record<string, boolean>>({});
  const [videoLoading, setVideoLoading] = useState<Record<string, boolean>>({});
  const [videoBuffering, setVideoBuffering] = useState<Record<string, boolean>>({});

  // File Upload State
  const [addSourceType, setAddSourceType] = useState<'file' | 'link'>('file');
  const [editSourceType, setEditSourceType] = useState<'file' | 'link'>('file');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleFileUploadForNew = async (file: File) => {
    const oldStagedUrl = newReelUrl;
    setUploadingFile(true);
    setUploadProgress(0);
    setUploadNotice(`Uploading "${file.name}" to Cloudflare R2...`);
    try {
      if (!newReelTitle.trim()) {
        const autoTitle = file.name.replace(/\.[^/.]+$/, '').toUpperCase();
        setNewReelTitle(autoTitle);
      }
      const cloudUrl = await uploadFileToServer(file, (pct) => setUploadProgress(pct));
      setNewReelUrl(cloudUrl);

      // Clean up previous staged file in R2 if creator re-selected a different file
      if (oldStagedUrl && isR2Url(oldStagedUrl) && oldStagedUrl !== cloudUrl) {
        deleteR2Object(oldStagedUrl).catch((err) =>
          console.warn('Could not clean up abandoned staged file:', err)
        );
      }

      setUploadNotice(`File "${file.name}" uploaded successfully!`);
      setTimeout(() => setUploadNotice(null), 4000);
    } catch (err: any) {
      console.error('File upload failed:', err);
      alert(`Upload failed: ${err?.message || 'Please check your connection and try again.'}`);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleFileUploadForEdit = async (file: File) => {
    if (!editingReel) return;

    // 1. Save existing/old video URL before uploading anything
    const oldVideoUrl =
      editingReel.videoUrl ||
      editingReel.serverVideoUrl ||
      reels.find((r) => r.id === editingReel.id)?.videoUrl ||
      '';

    setUploadingFile(true);
    setUploadProgress(0);
    setUploadNotice(`Uploading "${file.name}" to Cloudflare R2...`);

    try {
      // 2. Upload new video to R2 first
      const newUrl = await uploadFileToServer(file, (pct) => setUploadProgress(pct));

      // 3. Verify upload succeeded and returned a valid public URL
      if (!newUrl) {
        throw new Error('Upload completed but no public R2 URL was returned.');
      }

      // 4. Update the reel in editing state and save updated portfolio metadata
      const updatedEditing: VideoReel = {
        ...editingReel,
        videoUrl: newUrl,
        serverVideoUrl: newUrl,
      };
      setEditingReel(updatedEditing);

      const updatedReels = reels.map((r) =>
        r.id === editingReel.id ? updatedEditing : r
      );
      setReels(updatedReels);
      if (onUpdateReels) onUpdateReels(updatedReels);
      await saveServerPortfolio(portfolioInfo, updatedReels);

      // Clear video playback error state
      setVideoPlaybackErrors((prev) => ({ ...prev, [editingReel.id]: false }));

      // 5. Delete the OLD R2 object SECOND (after new upload succeeded and saved)
      let oldDeleteFailed = false;
      let oldDeleteErrorMsg = '';

      if (oldVideoUrl && isR2Url(oldVideoUrl) && oldVideoUrl !== newUrl) {
        try {
          await deleteR2Object(oldVideoUrl);
        } catch (delErr: any) {
          console.warn('Failed to delete old R2 object during replace:', delErr);
          oldDeleteFailed = true;
          oldDeleteErrorMsg = delErr?.message || 'Could not delete old R2 file';
        }
      }

      if (oldDeleteFailed) {
        setUploadNotice(
          `New video active! Warning: Old R2 file could not be deleted (${oldDeleteErrorMsg}).`
        );
      } else {
        setUploadNotice(`File "${file.name}" uploaded and old R2 video removed!`);
      }
      setTimeout(() => setUploadNotice(null), 3500);
    } catch (err: any) {
      console.error('File upload replacement failed:', err);
      // If new upload failed, the old video remains untouched!
      alert(`Upload failed: ${err?.message || 'Please check your connection and try again.'}`);
    } finally {
      setUploadingFile(false);
    }
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Creator Admin Mode state
  // The PIN is verified by the server. The frontend only remembers the
  // temporary UI state for the current browser session.
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    return sessionStorage.getItem('portfolio_is_admin') === 'true';
  });
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinError, setAdminPinError] = useState(false);
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);

  // New Reel Modal state
  const [showAddReelModal, setShowAddReelModal] = useState(false);
  const [newReelTitle, setNewReelTitle] = useState('');
  const [newReelCategory, setNewReelCategory] = useState('');
  const [newReelAspect, setNewReelAspect] = useState<'9:16' | '16:9'>('9:16');
  const [newReelUrl, setNewReelUrl] = useState('');
  const [isSubmittingReel, setIsSubmittingReel] = useState(false);

  // Edit Reel Title/Category Modal
  const [editingReel, setEditingReel] = useState<VideoReel | null>(null);

  // Portfolio Info State & About Editing
  const [portfolioInfo, setPortfolioInfo] = useState<PortfolioInfo>(info);
  const [isEditingAbout, setIsEditingAbout] = useState(false);
  const [aboutDraft, setAboutDraft] = useState(info.aboutText);

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const fullscreenVideoRef = useRef<HTMLVideoElement | null>(null);
  const fullscreenSyncRef = useRef<{
    reelId: string;
    initialTime: number;
    wasPlaying: boolean;
    isMuted: boolean;
  } | null>(null);
  const isInitializingFullscreenRef = useRef(false);
  const portraitInputRef = useRef<HTMLInputElement | null>(null);
  const reelFeedRef = useRef<HTMLDivElement | null>(null);

  // Helper to determine if a reel is muted (defaults to TRUE for browser-safe autoplay)
  const isReelMuted = (reelId: string) => mutedVideoId[reelId] ?? true;

  // Clean up detached video refs when reels change
  useEffect(() => {
    const validIds = new Set(reels.map((r) => r.id));
    Object.keys(videoRefs.current).forEach((id) => {
      if (!validIds.has(id)) {
        delete videoRefs.current[id];
      }
    });
  }, [reels]);

  // Sync props to local info & reels state
  useEffect(() => {
    setPortfolioInfo(info);
    setAboutDraft(info.aboutText);
  }, [info]);

  useEffect(() => {
    setReels(initialReels);
  }, [initialReels]);

  // Handle portrait photo upload
  const handlePortraitUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const oldPortraitUrl = portfolioInfo.portraitUrl;

    try {
      setUploadNotice('Uploading photo to server...');
      const serverUrl = await uploadFileToServer(file);
      const updated = { ...portfolioInfo, portraitUrl: serverUrl };
      setPortfolioInfo(updated);
      if (onUpdateInfo) {
        onUpdateInfo(updated);
      }
      await saveServerPortfolio(updated, reels);

      if (oldPortraitUrl && isR2Url(oldPortraitUrl) && oldPortraitUrl !== serverUrl) {
        deleteR2Object(oldPortraitUrl).catch((err) =>
          console.warn('Could not delete old portrait from R2:', err)
        );
      }

      setUploadNotice('Updated profile portrait photo across all devices!');
      setTimeout(() => setUploadNotice(null), 3000);
    } catch (err) {
      console.error('Failed to upload portrait to server:', err);
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        if (dataUrl) {
          const updated = { ...portfolioInfo, portraitUrl: dataUrl };
          setPortfolioInfo(updated);
          if (onUpdateInfo) onUpdateInfo(updated);
        }
      };
      reader.readAsDataURL(file);
      setUploadNotice('Saved photo locally.');
      setTimeout(() => setUploadNotice(null), 3000);
    }
  };

  const handleRemovePortrait = async () => {
    const oldPortraitUrl = portfolioInfo.portraitUrl;
    const updated = { ...portfolioInfo, portraitUrl: undefined };
    setPortfolioInfo(updated);
    if (onUpdateInfo) {
      onUpdateInfo(updated);
    }
    await saveServerPortfolio(updated, reels).catch(console.error);

    if (oldPortraitUrl && isR2Url(oldPortraitUrl)) {
      deleteR2Object(oldPortraitUrl).catch((err) =>
        console.warn('Could not delete portrait from R2:', err)
      );
    }

    setUploadNotice('Removed profile portrait photo.');
    setTimeout(() => setUploadNotice(null), 3000);
  };

  const handleSaveAbout = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = { ...portfolioInfo, aboutText: aboutDraft.trim() };
    setPortfolioInfo(updated);
    if (onUpdateInfo) {
      onUpdateInfo(updated);
    }
    setIsEditingAbout(false);
    setUploadNotice('Saved about bio sentences!');
    setTimeout(() => setUploadNotice(null), 3000);
  };

  // Skills Editing
  const [newSkillInput, setNewSkillInput] = useState('');

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSkillInput.trim();
    if (!trimmed) return;
    if (portfolioInfo.skills.includes(trimmed)) {
      setNewSkillInput('');
      return;
    }
    const updatedSkills = [...portfolioInfo.skills, trimmed];
    const updated = { ...portfolioInfo, skills: updatedSkills };
    setPortfolioInfo(updated);
    if (onUpdateInfo) onUpdateInfo(updated);
    setNewSkillInput('');
    setUploadNotice(`Added skill: ${trimmed}`);
    setTimeout(() => setUploadNotice(null), 3000);
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    const updatedSkills = portfolioInfo.skills.filter((s) => s !== skillToRemove);
    const updated = { ...portfolioInfo, skills: updatedSkills };
    setPortfolioInfo(updated);
    if (onUpdateInfo) onUpdateInfo(updated);
    setUploadNotice(`Removed skill: ${skillToRemove}`);
    setTimeout(() => setUploadNotice(null), 3000);
  };

  // Contact Editing
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState({
    email: info.email,
    instagram: info.instagram,
    availability: info.availability || 'READY WHEN YOU ARE',
  });

  useEffect(() => {
    setContactDraft({
      email: portfolioInfo.email,
      instagram: portfolioInfo.instagram,
      availability: portfolioInfo.availability || 'READY WHEN YOU ARE',
    });
  }, [portfolioInfo.email, portfolioInfo.instagram, portfolioInfo.availability]);

  const handleSaveContact = (e: React.FormEvent) => {
    e.preventDefault();
    const updated = {
      ...portfolioInfo,
      email: contactDraft.email.trim(),
      instagram: contactDraft.instagram.trim(),
      availability: contactDraft.availability.trim(),
    };
    setPortfolioInfo(updated);
    if (onUpdateInfo) onUpdateInfo(updated);
    setIsEditingContact(false);
    setUploadNotice('Updated contact information!');
    setTimeout(() => setUploadNotice(null), 3000);
  };


  // Fallback if video tag encounters an error loading videoUrl
  const handleVideoError = (reelId: string) => {
    setVideoLoading((prev) => ({ ...prev, [reelId]: false }));
    setVideoBuffering((prev) => ({ ...prev, [reelId]: false }));
    setVideoPlaybackErrors((prev) => ({ ...prev, [reelId]: true }));
  };

  // Gracefully retry video playback without modifying or deleting R2 objects
  const handleRetryVideo = (reelId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setVideoPlaybackErrors((prev) => ({ ...prev, [reelId]: false }));
    setVideoLoading((prev) => ({ ...prev, [reelId]: true }));
    setVideoBuffering((prev) => ({ ...prev, [reelId]: false }));

    const video = videoRefs.current[reelId];
    if (video) {
      try {
        video.load();
        video.muted = isReelMuted(reelId);
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => setPlayingVideoId(reelId))
            .catch((err) => console.log('Retry play note:', err));
        }
      } catch (err) {
        console.warn('Retry load error:', err);
      }
    }

    if (fullscreenVideoRef.current && fullscreenReelId === reelId) {
      try {
        fullscreenVideoRef.current.load();
        fullscreenVideoRef.current.muted = isReelMuted(reelId);
        fullscreenVideoRef.current.play().catch(() => {});
      } catch (err) {
        console.warn('Fullscreen retry load error:', err);
      }
    }
  };

  // Direct video file upload right from card overlay (replace video)
  const handleDirectCardUpload = async (reelId: string, file: File) => {
    const targetReel = reels.find((r) => r.id === reelId);
    const oldVideoUrl = targetReel?.videoUrl || targetReel?.serverVideoUrl || '';

    try {
      setUploadingFile(true);
      setUploadProgress(0);
      setUploadNotice(`Uploading "${file.name}" to Cloudflare R2...`);

      // 1. Upload new video to R2 first
      const serverUrl = await uploadFileToServer(file, (percent) => {
        setUploadProgress(percent);
      });

      if (!serverUrl) {
        throw new Error('Upload succeeded but no public R2 URL was returned.');
      }

      // 2. Update reel and save updated portfolio metadata
      const updated = reels.map((r) => {
        if (r.id === reelId) {
          return {
            ...r,
            videoUrl: serverUrl,
            serverVideoUrl: serverUrl,
          };
        }
        return r;
      });

      setReels(updated);
      if (onUpdateReels) onUpdateReels(updated);
      await saveServerPortfolio(portfolioInfo, updated);

      // Clear video playback error state
      setVideoPlaybackErrors((prev) => ({ ...prev, [reelId]: false }));

      // 3. Delete the OLD R2 object SECOND (after new upload succeeded)
      let oldDeleteFailed = false;
      let oldDeleteErrorMsg = '';

      if (oldVideoUrl && isR2Url(oldVideoUrl) && oldVideoUrl !== serverUrl) {
        try {
          await deleteR2Object(oldVideoUrl);
        } catch (delErr: any) {
          console.warn('Failed to delete old R2 object during replace:', delErr);
          oldDeleteFailed = true;
          oldDeleteErrorMsg = delErr?.message || 'Could not delete old R2 object';
        }
      }

      if (oldDeleteFailed) {
        setUploadNotice(
          `New video active! Warning: Old R2 file could not be deleted (${oldDeleteErrorMsg}).`
        );
      } else {
        setUploadNotice('Video replaced successfully! Old R2 file removed.');
      }
      setTimeout(() => setUploadNotice(null), 3500);
    } catch (err: any) {
      console.error('Direct video upload replacement failed:', err);
      // If upload failed, the old video remains untouched!
      alert(`Upload error: ${err.message || 'Failed to upload video file'}`);
    } finally {
      setUploadingFile(false);
      setUploadProgress(0);
    }
  };

  // Normalize video URLs on load.
  useEffect(() => {
    let isMounted = true;

    const normalizeUrls = async () => {
      let hasChanged = false;
      const normalized = reels.map((reel) => {
        if (!reel.videoUrl) return reel;
        const formatted = formatVideoUrl(reel.videoUrl);
        if (formatted === reel.videoUrl) return reel;
        hasChanged = true;
        return { ...reel, videoUrl: formatted, serverVideoUrl: formatted };
      });

      if (!isMounted || !hasChanged) return;
      updateReelsAndParent(normalized);
    };

    normalizeUrls();

    return () => {
      isMounted = false;
    };
  }, []);

  // Synchronize initial active reel
  useEffect(() => {
    if (reels.length > 0 && (!activeReelId || !reels.some((r) => r.id === activeReelId))) {
      setActiveReelId(reels[0].id);
    }
  }, [reels, activeReelId]);

  // Scroll handler to track active visible reel in the feed and update auto-play
  useEffect(() => {
    if (activeScreen !== 'work') return;

    const container = reelFeedRef.current;
    if (!container) return;

    const cards = Array.from(container.querySelectorAll<HTMLElement>('.reel-card'));

    const updateActiveCard = () => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = containerRect.top + containerRect.height / 2;

      let closestId: string | null = null;
      let minDistance = Infinity;

      cards.forEach((card: HTMLElement) => {
        const rect = card.getBoundingClientRect();
        const isVisible = rect.bottom > containerRect.top && rect.top < containerRect.bottom;
        if (!isVisible) return;

        const cardCenter = rect.top + rect.height / 2;
        const distance = Math.abs(cardCenter - containerCenter);

        if (distance < minDistance) {
          minDistance = distance;
          const id = card.getAttribute('data-reel-id');
          if (id) closestId = id;
        }
      });

      if (closestId) {
        setActiveReelId(closestId);
      }
    };

    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateActiveCard();
          ticking = false;
        });
        ticking = true;
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    updateActiveCard();

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [activeScreen, reels]);

  // Handle auto-play for active reel and ensure ONLY ONE video plays at a time
  useEffect(() => {
    // If in fullscreen modal, pause all background card videos
    if (fullscreenReelId) {
      Object.values(videoRefs.current).forEach((videoEl) => {
        const video = videoEl as HTMLVideoElement | null;
        if (video && !video.paused) {
          video.pause();
        }
      });
      return;
    }

    // If work screen is not open, pause all card videos
    if (activeScreen !== 'work') {
      Object.values(videoRefs.current).forEach((videoEl) => {
        const video = videoEl as HTMLVideoElement | null;
        if (video && !video.paused) {
          video.pause();
        }
      });
      setPlayingVideoId(null);
      return;
    }

    // Work screen is active: ensure ONLY the active reel plays (muted by default)
    Object.entries(videoRefs.current).forEach(([id, videoEl]) => {
      const video = videoEl as HTMLVideoElement | null;
      if (!video) return;
      if (id === activeReelId) {
        const muted = isReelMuted(id);
        video.muted = muted;
        if (video.paused) {
          const playPromise = video.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => setPlayingVideoId(id))
              .catch((err) => {
                console.log('Autoplay play note for reel:', id, err);
              });
          }
        } else {
          setPlayingVideoId(id);
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
      }
    });
  }, [activeReelId, activeScreen, fullscreenReelId, mutedVideoId]);

  // Timecode generator
  useEffect(() => {
    let frames = 0;
    const interval = setInterval(() => {
      frames = (frames + 1) % 24;
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      const ff = String(frames).padStart(2, '0');
      setTimecode(`${hh}:${mm}:${ss}:${ff}`);
    }, 1000 / 24);

    return () => clearInterval(interval);
  }, []);

  const handlePlayPause = (reelId: string) => {
    const video = videoRefs.current[reelId];
    if (!video) return;

    if (video.paused) {
      // Pause all other video elements
      Object.entries(videoRefs.current).forEach(([id, el]) => {
        const otherVideo = el as HTMLVideoElement | null;
        if (id !== reelId && otherVideo && !otherVideo.paused) {
          otherVideo.pause();
        }
      });
      setActiveReelId(reelId);
      video.muted = isReelMuted(reelId);
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setPlayingVideoId(reelId))
          .catch((err) => console.log('Play error:', err));
      }
    } else {
      video.pause();
      setPlayingVideoId(null);
    }
  };

  const handleFullscreenPlayPause = () => {
    if (!fullscreenVideoRef.current || !fullscreenReelId) return;
    if (fullscreenVideoRef.current.paused) {
      fullscreenVideoRef.current
        .play()
        .then(() => setPlayingVideoId(fullscreenReelId))
        .catch((err) => console.log('Fullscreen play error:', err));
    } else {
      fullscreenVideoRef.current.pause();
      setPlayingVideoId(null);
    }
  };

  // Interactive scrubber seek handler
  const handleScrub = (reelId: string, e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = clickX / rect.width;

    // 1. Update card video element
    const video = videoRefs.current[reelId];
    if (video && video.duration && !isNaN(video.duration)) {
      video.currentTime = pct * video.duration;
      setVideoProgress((prev) => ({ ...prev, [reelId]: pct * 100 }));
      setVideoCurrentTime((prev) => ({
        ...prev,
        [reelId]: `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`,
      }));
    }

    // 2. Update fullscreen video element if active
    if (fullscreenVideoRef.current && fullscreenReelId === reelId && fullscreenVideoRef.current.duration) {
      const fv = fullscreenVideoRef.current;
      fv.currentTime = pct * fv.duration;
      setVideoProgress((prev) => ({ ...prev, [reelId]: pct * 100 }));
      setVideoCurrentTime((prev) => ({
        ...prev,
        [reelId]: `${formatTime(fv.currentTime)} / ${formatTime(fv.duration)}`,
      }));
    }
  };

  const handleToggleMute = (reelId: string) => {
    const currentMuted = isReelMuted(reelId);
    const nextMuted = !currentMuted;

    // 1. Update card video element if mounted
    const video = videoRefs.current[reelId];
    if (video) {
      video.muted = nextMuted;
    }

    // 2. Update fullscreen video element if mounted and active
    if (fullscreenVideoRef.current && fullscreenReelId === reelId) {
      fullscreenVideoRef.current.muted = nextMuted;
    }

    // 3. Update React state
    setMutedVideoId((prev) => ({ ...prev, [reelId]: nextMuted }));
  };

  const handleToggleWide = (reelId: string) => {
    if (!isAdmin) {
      return;
    }

    const updated = reels.map((r) => {
      if (r.id === reelId) {
        const currentWide = r.isWide ?? (r.aspect === '16:9');
        const nextIsWide = !currentWide;
        return {
          ...r,
          isWide: nextIsWide,
          aspect: nextIsWide ? ('16:9' as const) : ('9:16' as const),
        };
      }
      return r;
    });

    setReels(updated);
    if (onUpdateReels) {
      onUpdateReels(updated);
    }
    saveServerPortfolio(portfolioInfo, updated).catch(console.error);

    const changed = updated.find((r) => r.id === reelId);
    if (changed) {
      setUploadNotice(
        `Layout: "${changed.title}" is now ${changed.isWide ? 'WIDE (16:9)' : 'PORTRAIT (9:16)'} · Synced across devices`
      );
      setTimeout(() => setUploadNotice(null), 3000);
    }
  };

  const handleFullscreen = (reelId: string) => {
    // 1. Read normal video currentTime, muted state, and whether it was playing
    const cardVideo = videoRefs.current[reelId];
    const initialTime = cardVideo && !isNaN(cardVideo.currentTime) ? cardVideo.currentTime : 0;
    const wasPlaying = cardVideo ? !cardVideo.paused : (playingVideoId === reelId);
    const muted = cardVideo ? cardVideo.muted : isReelMuted(reelId);

    // 2. Pause the normal video and any other playing card videos immediately
    Object.values(videoRefs.current).forEach((videoEl) => {
      const v = videoEl as HTMLVideoElement | null;
      if (v && !v.paused) {
        v.pause();
      }
    });

    // 3. Save sync state and set initialization flag for fullscreen modal
    isInitializingFullscreenRef.current = true;
    fullscreenSyncRef.current = {
      reelId,
      initialTime,
      wasPlaying,
      isMuted: muted,
    };

    setActiveReelId(reelId);
    setFullscreenReelId(reelId);
  };

  const handleCloseFullscreen = () => {
    isInitializingFullscreenRef.current = false;
    const fv = fullscreenVideoRef.current;
    const currentReelId = fullscreenReelId;
    const syncInfo = fullscreenSyncRef.current;

    // 1. Read fullscreen video currentTime, playback state, and muted state
    let exitTime = 0;
    let wasFullscreenPlaying = false;
    let isMutedInFullscreen = isReelMuted(currentReelId || '');

    if (fv) {
      if (!isNaN(fv.currentTime)) {
        exitTime = fv.currentTime;
      }
      wasFullscreenPlaying = !fv.paused;
      isMutedInFullscreen = fv.muted;
      // 2. Pause fullscreen video
      fv.pause();
    }

    // 3. Set normal card video's currentTime and restore state
    if (currentReelId) {
      const cardVideo = videoRefs.current[currentReelId];
      if (cardVideo) {
        if (exitTime > 0 && cardVideo.duration > 0 && !isNaN(cardVideo.duration)) {
          try {
            cardVideo.currentTime = Math.min(exitTime, cardVideo.duration - 0.1);
          } catch (err) {
            console.log('Restore card currentTime note:', err);
          }
        }
        cardVideo.muted = isMutedInFullscreen;
        setMutedVideoId((prev) => ({ ...prev, [currentReelId]: isMutedInFullscreen }));

        if (cardVideo.duration > 0 && !isNaN(cardVideo.duration)) {
          const pct = (exitTime / cardVideo.duration) * 100;
          setVideoProgress((prev) => ({ ...prev, [currentReelId]: pct }));
          setVideoCurrentTime((prev) => ({
            ...prev,
            [currentReelId]: `${formatTime(exitTime)} / ${formatTime(cardVideo.duration)}`,
          }));
        }

        // 6. Resume normal video only if it was playing before fullscreen (or while in fullscreen)
        const shouldResume = wasFullscreenPlaying || (syncInfo?.wasPlaying ?? false);
        if (shouldResume) {
          const playPromise = cardVideo.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => setPlayingVideoId(currentReelId))
              .catch((err) => console.log('Resume card video error:', err));
          }
        } else {
          cardVideo.pause();
          setPlayingVideoId(null);
        }
      }
    }

    fullscreenSyncRef.current = null;
    setFullscreenReelId(null);
  };

  // Creator Studio login via server-verified PIN
  const handleAdminAuth = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setAdminAuthLoading(true);
    setAdminPinError(false);

    try {
      const success =
        await verifyCreatorPin(
          adminPinInput
        );

      if (!success) {
        setAdminPinError(true);
        return;
      }

      setIsAdmin(true);
      sessionStorage.setItem(
        'portfolio_is_admin',
        'true'
      );
      setAdminPinInput('');
      setShowAdminModal(false);
      setUploadNotice(
        'Creator Studio Mode unlocked!'
      );
      setTimeout(
        () => setUploadNotice(null),
        3000
      );
    } catch (error) {
      console.error(
        'Creator PIN authentication failed:',
        error
      );
      setAdminPinError(true);
    } finally {
      setAdminAuthLoading(false);
    }
  };

  const handleLogoutAdmin = async () => {
    try {
      await logoutCreator();
    } catch (error) {
      console.error(
        'Creator logout failed:',
        error
      );
    } finally {
      sessionStorage.removeItem(
        'portfolio_is_admin'
      );
      setIsAdmin(false);
      setUploadNotice(
        'Returned to Client Public View'
      );
      setTimeout(
        () => setUploadNotice(null),
        3000
      );
    }
  };

  // Add a brand new reel. Uploaded files are stored permanently in Cloudflare R2.
  // A direct URL can still be used when the creator intentionally chooses the link option.
  const handleAddNewReel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReelUrl.trim()) {
      alert('Please upload a video file or enter a video URL first.');
      return;
    }
    if (!newReelTitle.trim()) {
      alert('Please enter a title for the new reel.');
      return;
    }

    setIsSubmittingReel(true);
    const newId = 'reel_' + Date.now();
    const isWide = newReelAspect === '16:9';
    const formattedUrl = formatVideoUrl(newReelUrl.trim());

    const gradients = ['one', 'two', 'three', 'four', 'five', 'six'];
    const randomGrad = gradients[Math.floor(Math.random() * gradients.length)];

    const newReel: VideoReel = {
      id: newId,
      title: newReelTitle.trim(),
      category: newReelCategory.trim() || 'Commercial · Creative Edit',
      duration: '00:30',
      aspect: isWide ? '16:9' : '9:16',
      videoUrl: formattedUrl,
      serverVideoUrl: formattedUrl,
      bgGradientClass: randomGrad,
      isWide,
    };

    const updatedReels = [...reels, newReel];
    setReels(updatedReels);
    if (onUpdateReels) onUpdateReels(updatedReels);
    saveServerPortfolio(portfolioInfo, updatedReels).catch(console.error);

    setNewReelTitle('');
    setNewReelCategory('');
    setNewReelUrl('');
    setShowAddReelModal(false);
    setIsSubmittingReel(false);

    setUploadNotice(`Added reel "${newReel.title}"! It'll show up on every device instantly.`);
    setTimeout(() => setUploadNotice(null), 3000);
  };

  // Delete a reel (opens custom confirmation modal)
  const handleDeleteReel = (reelId: string, title: string) => {
    setDeletingReel({ id: reelId, title });
  };

  const confirmDeleteReel = async () => {
    if (!deletingReel || isDeletingReel) return;
    const { id, title } = deletingReel;
    const reelToDelete = reels.find((reel) => reel.id === id);

    if (!reelToDelete) {
      setDeletingReel(null);
      return;
    }

    setIsDeletingReel(true);

    try {
      const videoUrl = reelToDelete.videoUrl || reelToDelete.serverVideoUrl;
      const isR2 = isR2Url(videoUrl);

      // If the reel has an R2 video, delete it from R2 first
      if (isR2 && videoUrl) {
        setUploadNotice(`Deleting "${title}" video from Cloudflare R2...`);
        await deleteR2Object(videoUrl);
      }

      // ONLY after R2 deletion succeeds (or if it was an external non-R2 URL), remove the reel from portfolio data
      const updatedReels = reels.filter((r) => r.id !== id);
      setReels(updatedReels);
      if (onUpdateReels) onUpdateReels(updatedReels);
      await saveServerPortfolio(portfolioInfo, updatedReels);

      setDeletingReel(null);
      setUploadNotice(`Deleted reel "${title}" and cleaned up R2 storage.`);
      setTimeout(() => setUploadNotice(null), 3500);
    } catch (error: any) {
      console.error('Failed to delete reel or R2 video file:', error);
      // DO NOT silently remove the reel from the portfolio. Keep the reel visible so user knows deletion failed.
      alert(
        `Deletion failed: ${
          error?.message || 'Could not delete video file from Cloudflare R2.'
        }\n\nThe reel has not been removed so no orphaned files are left in storage.`
      );
      setUploadNotice(`Deletion failed: ${error?.message || 'R2 error'}`);
      setTimeout(() => setUploadNotice(null), 4000);
    } finally {
      setIsDeletingReel(false);
    }
  };

  // Update Reel metadata
  const handleSaveEditReel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReel) return;

    const originalReel = reels.find((r) => r.id === editingReel.id);
    const oldVideoUrl = originalReel?.videoUrl || originalReel?.serverVideoUrl || '';
    const formatted = formatVideoUrl(editingReel.videoUrl);

    const updatedReel: VideoReel = {
      ...editingReel,
      isWide: editingReel.isWide,
      aspect: editingReel.isWide ? ('16:9' as const) : ('9:16' as const),
      videoUrl: formatted,
      serverVideoUrl: formatted && !formatted.startsWith('blob:') ? formatted : editingReel.serverVideoUrl,
    };

    const updatedReels = reels.map((r) => (r.id === editingReel.id ? updatedReel : r));
    setReels(updatedReels);
    if (onUpdateReels) onUpdateReels(updatedReels);
    await saveServerPortfolio(portfolioInfo, updatedReels).catch(console.error);

    // If URL was manually changed away from an existing R2 file, clean up old R2 object
    if (oldVideoUrl && formatted && oldVideoUrl !== formatted && isR2Url(oldVideoUrl)) {
      try {
        await deleteR2Object(oldVideoUrl);
      } catch (delErr) {
        console.warn('Could not delete old R2 object after URL change:', delErr);
      }
    }

    setVideoPlaybackErrors((prev) => ({ ...prev, [editingReel.id]: false }));
    setEditingReel(null);
    setUploadNotice(`Updated "${updatedReel.title}" layout & details · Saved to cloud`);
    setTimeout(() => setUploadNotice(null), 3000);
  };

  return (
    <div className="site select-none">
      {/* Ambient Visual Effects */}
      <div className="glow"></div>
      <div className="orb orb1"></div>
      <div className="orb orb2"></div>
      <div className="grid"></div>
      <div className="scan"></div>
      <div className="frame"></div>
      <div className="corner tl"></div>
      <div className="corner tr"></div>
      <div className="corner bl"></div>
      <div className="corner br"></div>

      {/* Header */}
      <header className="flex justify-between items-center px-4 py-3">
        <div className="available">
          <i></i> {portfolioInfo.availability || info.availability || 'AVAILABLE FOR WORK'}
        </div>
        <div className="meta">
          <span className="rec">● REC</span> <span id="timecode">{timecode}</span>
        </div>
      </header>

      {/* Toast Notification */}
      {uploadNotice ? (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-neutral-900/90 text-white border border-red-500/40 px-4 py-2.5 rounded-full backdrop-blur-xl shadow-2xl flex items-center gap-2 text-xs font-medium animate-bounce">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{uploadNotice}</span>
        </div>
      ) : null}

      {/* Creator Studio Passcode Modal */}
      {showAdminModal && !isAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
          <div className="bg-neutral-900 border border-white/20 rounded-2xl p-4 sm:p-6 max-w-sm w-full my-auto max-h-[88vh] overflow-y-auto relative shadow-2xl text-white">
            <button
              onClick={() => {
                setShowAdminModal(false);
                setAdminPinInput('');
                setAdminPinError(false);
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white p-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-red-500 font-mono text-xs tracking-wider mb-2">
              <Lock className="w-4 h-4" />
              <span>CREATOR STUDIO ACCESS</span>
            </div>

            <h3 className="text-xl font-bold mb-1">
              Enter Creator PIN
            </h3>

            <p className="text-xs text-neutral-400 mb-5 leading-relaxed">
              Unlock Creator Mode to upload new video reels, replace files, edit titles, and manage your portfolio.
            </p>

            <form
              onSubmit={handleAdminAuth}
              className="space-y-4"
            >
              <div>
                <input
                  type="password"
                  placeholder="Enter Creator PIN"
                  value={adminPinInput}
                  onChange={(e) => {
                    setAdminPinInput(
                      e.target.value
                    );
                    setAdminPinError(false);
                  }}
                  className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                  autoFocus
                />

                {adminPinError && (
                  <p className="text-xs text-red-400 mt-1">
                    Incorrect PIN. Please try again.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={adminAuthLoading}
                className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all"
              >
                {adminAuthLoading
                  ? 'Checking PIN...'
                  : 'Unlock Studio Mode'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Delete Reel Confirmation Modal */}
      {deletingReel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
          <div className="bg-neutral-900 border border-red-500/40 rounded-2xl p-4 sm:p-6 max-w-sm w-full my-auto max-h-[88vh] overflow-y-auto relative shadow-2xl text-white">
            <button
              onClick={() => setDeletingReel(null)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white p-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-red-500 font-mono text-xs tracking-wider mb-2">
              <Trash2 className="w-4 h-4" />
              <span>CONFIRM DELETION</span>
            </div>
            <h3 className="text-lg font-bold mb-2">Delete Video Reel?</h3>
            <p className="text-xs text-neutral-300 mb-6 leading-relaxed">
              Are you sure you want to delete <strong className="text-white">"{deletingReel.title}"</strong>? This will permanently remove it and its video file from Cloudflare R2 storage.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={isDeletingReel}
                onClick={() => setDeletingReel(null)}
                className="flex-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-xs transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeletingReel}
                onClick={confirmDeleteReel}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-900/50 cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isDeletingReel ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add New Reel Modal */}
      {showAddReelModal && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto overscroll-contain">
          <div className="bg-neutral-900 border border-white/20 rounded-2xl p-4 sm:p-6 max-w-md w-full my-0 sm:my-auto max-h-[calc(100dvh-16px)] sm:max-h-[calc(100dvh-32px)] overflow-y-auto overscroll-contain relative shadow-2xl text-white">
            <button
              onClick={() => setShowAddReelModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white p-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-red-500 font-mono text-xs tracking-wider mb-2">
              <Plus className="w-4 h-4" />
              <span>ADD TO PORTFOLIO</span>
            </div>
            <h3 className="text-xl font-bold mb-4">Upload New Video Reel</h3>

            <form onSubmit={handleAddNewReel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. CYBERPUNK SHOWREEL 05"
                  value={newReelTitle}
                  onChange={(e) => setNewReelTitle(e.target.value)}
                  className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1">
                  Category / Tags
                </label>
                <input
                  type="text"
                  placeholder="e.g. Motion Graphics · Visual Effects"
                  value={newReelCategory}
                  onChange={(e) => setNewReelCategory(e.target.value)}
                  className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1">
                  Aspect Ratio
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewReelAspect('9:16')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      newReelAspect === '9:16'
                        ? 'bg-red-600/30 border-red-500 text-white'
                        : 'bg-black/40 border-white/10 text-neutral-400'
                    }`}
                  >
                    9:16 (Vertical Reel)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewReelAspect('16:9')}
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      newReelAspect === '16:9'
                        ? 'bg-red-600/30 border-red-500 text-white'
                        : 'bg-black/40 border-white/10 text-neutral-400'
                    }`}
                  >
                    16:9 (Landscape / Wide)
                  </button>
                </div>
              </div>

              {/* Source Toggle: Upload File vs Paste Link */}
              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1.5">
                  Video Source *
                </label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setAddSourceType('file')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      addSourceType === 'file'
                        ? 'bg-red-600/30 border-red-500 text-white shadow-md'
                        : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAddSourceType('link')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      addSourceType === 'link'
                        ? 'bg-red-600/30 border-red-500 text-white shadow-md'
                        : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    <span>Drive / URL Link</span>
                  </button>
                </div>

                {addSourceType === 'file' ? (
                  <div className="border-2 border-dashed border-red-500/40 rounded-2xl p-4 bg-black/40 text-center hover:border-red-500 transition-all">
                    {uploadingFile ? (
                      <div className="space-y-2 py-2">
                        <div className="text-xs font-bold text-red-400 animate-pulse">
                          Uploading video file ({uploadProgress}%)
                        </div>
                        <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-red-600 h-full transition-all duration-200"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-neutral-400">Saving securely to cloud storage...</p>
                      </div>
                    ) : newReelUrl ? (
                      <div className="py-2 space-y-2">
                        <div className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-bold bg-emerald-950/60 border border-emerald-500/30 px-3 py-1 rounded-full">
                          <Check className="w-4 h-4" /> Video Uploaded & Ready!
                        </div>
                        <video
                          src={newReelUrl}
                          controls
                          className="w-full max-h-40 rounded-xl bg-black border border-white/20 object-contain mx-auto"
                        />
                        <p className="text-[10px] text-neutral-400 truncate max-w-xs mx-auto font-mono">{newReelUrl}</p>
                        <label className="inline-block px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[10px] cursor-pointer transition-colors border border-white/10">
                          <span>Choose Different Video</span>
                          <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUploadForNew(file);
                            }}
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="cursor-pointer block py-2">
                        <Upload className="w-8 h-8 text-red-500 mx-auto mb-2 animate-bounce" />
                        <span className="text-xs font-bold text-white block">Click or Drop Video File Here</span>
                        <span className="text-[10px] text-neutral-400 block mt-1">
                          Supports MP4, MOV, WEBM, MKV (Stored securely in cloud storage)
                        </span>
                        <input
                          type="file"
                          accept="video/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUploadForNew(file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div>
                    <input
                      type="url"
                      placeholder="e.g. https://example.com/video.mp4"
                      value={newReelUrl}
                      onChange={(e) => setNewReelUrl(e.target.value)}
                      className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-red-500 font-mono placeholder:font-sans placeholder:text-neutral-600"
                    />
                    <p className="text-[10px] text-neutral-400 mt-1.5 leading-relaxed">
                      💡 Enter a direct video file link (e.g. .mp4, .webm).
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-2 sticky bottom-0 z-10 bg-neutral-900/95 backdrop-blur-md pb-1 border-t border-white/5 mt-2">
                <button
                  type="submit"
                  disabled={isSubmittingReel || !newReelTitle.trim() || !newReelUrl.trim()}
                  className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Publish To Portfolio</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Reel Metadata Modal */}
      {editingReel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
          <div className="bg-neutral-900 border border-white/20 rounded-2xl p-4 sm:p-6 max-w-md w-full my-auto max-h-[88vh] overflow-y-auto relative shadow-2xl text-white">
            <button
              onClick={() => setEditingReel(null)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white p-1 rounded-full bg-white/5 hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold mb-4">Edit Reel Details</h3>

            <form onSubmit={handleSaveEditReel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={editingReel.title}
                  onChange={(e) => setEditingReel({ ...editingReel, title: e.target.value })}
                  className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1">
                  Category
                </label>
                <input
                  type="text"
                  value={editingReel.category}
                  onChange={(e) => setEditingReel({ ...editingReel, category: e.target.value })}
                  className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              {/* Video Source Option for Edit Modal */}
              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1.5">
                  Video Source
                </label>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => setEditSourceType('file')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      editSourceType === 'file'
                        ? 'bg-red-600/30 border-red-500 text-white shadow-md'
                        : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload File</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditSourceType('link')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                      editSourceType === 'link'
                        ? 'bg-red-600/30 border-red-500 text-white shadow-md'
                        : 'bg-black/40 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    <LinkIcon className="w-3.5 h-3.5" />
                    <span>Drive / URL Link</span>
                  </button>
                </div>

                {editSourceType === 'file' ? (
                  <div className="border-2 border-dashed border-red-500/40 rounded-2xl p-4 bg-black/40 text-center hover:border-red-500 transition-all">
                    {uploadingFile ? (
                      <div className="space-y-2 py-2">
                        <div className="text-xs font-bold text-red-400 animate-pulse">
                          Uploading video file ({uploadProgress}%)
                        </div>
                        <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-red-600 h-full transition-all duration-200"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : editingReel.videoUrl ? (
                      <div className="py-2 space-y-2">
                        <div className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-bold bg-emerald-950/60 border border-emerald-500/30 px-3 py-1 rounded-full">
                          <Check className="w-4 h-4" /> Current Video File Active
                        </div>
                        <video
                          src={editingReel.videoUrl}
                          controls
                          className="w-full max-h-40 rounded-xl bg-black border border-white/20 object-contain mx-auto"
                        />
                        <label className="inline-block px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg text-[10px] cursor-pointer transition-colors border border-white/10">
                          <span>Replace Video File</span>
                          <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleFileUploadForEdit(file);
                            }}
                          />
                        </label>
                      </div>
                    ) : (
                      <label className="cursor-pointer block py-2">
                        <Upload className="w-8 h-8 text-red-500 mx-auto mb-2" />
                        <span className="text-xs font-bold text-white block">Click to Upload Video File</span>
                        <span className="text-[10px] text-neutral-400 block mt-1">
                          Replaces existing video with a new cloud storage file
                        </span>
                        <input
                          type="file"
                          accept="video/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUploadForEdit(file);
                          }}
                        />
                      </label>
                    )}
                  </div>
                ) : (
                  <div>
                    <input
                      type="url"
                      placeholder="https://example.com/video.mp4"
                      value={editingReel.videoUrl || ''}
                      onChange={(e) => setEditingReel({ ...editingReel, videoUrl: e.target.value })}
                      className="w-full bg-black/60 border border-white/20 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500 font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 mb-1">
                  Panel Layout Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingReel({ ...editingReel, isWide: false, aspect: '9:16' })
                    }
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      !editingReel.isWide
                        ? 'bg-red-600/30 border-red-500 text-white'
                        : 'bg-black/40 border-white/10 text-neutral-400'
                    }`}
                  >
                    📱 Vertical (9:16)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingReel({ ...editingReel, isWide: true, aspect: '16:9' })
                    }
                    className={`py-2 rounded-xl text-xs font-bold border transition-all ${
                      editingReel.isWide
                        ? 'bg-red-600/30 border-red-500 text-white'
                        : 'bg-black/40 border-white/10 text-neutral-400'
                    }`}
                  >
                    🖥️ Horizontal / WIDE (16:9)
                  </button>
                </div>
              </div>

              <div className="pt-2 sticky bottom-0 bg-neutral-900 pb-1">
                <button
                  type="submit"
                  className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Homepage Hero */}
      <main className="home">
        <div className="hero-mark">V</div>
        <div className="kicker">{info.kicker}</div>
        <h1>
          {info.titleLine1}
          <br />
          <span className="red">{info.titleHighlight}</span>
        </h1>
        <div className="tagline">{info.tagline}</div>
      </main>

      {/* Filmstrip Deco */}
      <div className="filmstrip">
        <div className="filmtrack">
          <span>01</span><i></i><span>02</span><i></i><span>03</span><i></i><span>04</span><i></i>
          <span>05</span><i></i><span>06</span><i></i><span>07</span><i></i><span>08</span><i></i>
        </div>
      </div>

      <div className="heartbeat">
        <span>—╱╲——╱╲——╱╲—</span>
        <span>EDITOR'S CUT</span>
      </div>

      {/* Bottom Navigation */}
      <nav className="nav">
        <button onClick={() => setActiveScreen('work')}>
          <div className="icon">
            <Film className="w-5 h-5 text-red-500" />
          </div>
          <span>Work ({reels.length})</span>
          <b>01</b>
        </button>
        <button onClick={() => setActiveScreen('about')}>
          <div className="icon">
            <User className="w-5 h-5 text-red-500" />
          </div>
          <span>About</span>
          <b>02</b>
        </button>
        <button onClick={() => setActiveScreen('skills')}>
          <div className="icon">
            <Sparkles className="w-5 h-5 text-red-500" />
          </div>
          <span>Skills</span>
          <b>03</b>
        </button>
        <button onClick={() => setActiveScreen('contact')}>
          <div className="icon">
            <Mail className="w-5 h-5 text-red-500" />
          </div>
          <span>Contact</span>
          <b>04</b>
        </button>
      </nav>

      {/* Work Screen (Vertical Reel Feed) */}
      <section className={`screen work-screen ${activeScreen === 'work' ? 'open' : ''}`}>
        <div className="screen-head flex justify-between items-center">
          <div>
            <small>01 / SELECTED WORK SHOWREELS</small>
            <h2 className="flex items-center gap-3">
              <span>WORK ({reels.length})</span>
            </h2>
          </div>
          <button className="close" onClick={() => setActiveScreen('none')}>
            ×
          </button>
        </div>

        {/* Creator Studio Toolbar in Work Screen */}
        {isAdmin && (
          <div className="px-4 py-2 bg-red-950/50 border-b border-red-500/30 flex justify-between items-center">
            <div className="flex items-center gap-2 text-xs text-red-200 font-mono">
              <Unlock className="w-3.5 h-3.5 text-red-400" />
              <span>CREATOR STUDIO MODE</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddReelModal(true)}
                className="px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-lg transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>ADD NEW REEL</span>
              </button>
              <button
                onClick={handleLogoutAdmin}
                className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 border border-white/15 transition-all"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>LOG OUT</span>
              </button>
            </div>
          </div>
        )}

        <div className="reel-feed" id="reelFeed" ref={reelFeedRef}>
          {reels.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center border-2 border-dashed border-white/15 rounded-3xl bg-neutral-900/40 my-8 mx-auto max-w-lg">
              <Film className="w-12 h-12 text-red-500/80 mb-4 animate-pulse" />
              <h3 className="text-lg font-bold text-white mb-2">No Showreels in Portfolio</h3>
              <p className="text-xs text-neutral-400 max-w-sm mb-6 leading-relaxed">
                Portfolio showreels will appear here once published.
              </p>
              {isAdmin && (
                <button
                  onClick={() => setShowAddReelModal(true)}
                  className="px-5 py-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-2 shadow-xl transition-all cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>ADD NEW REEL</span>
                </button>
              )}
            </div>
          ) : (
            reels.map((reel, index) => {
            const activeIndex = reels.findIndex((r) => r.id === activeReelId);
            const isActive = activeScreen === 'work' && activeReelId === reel.id;
            const isPlaying = playingVideoId === reel.id;
            const isMuted = isReelMuted(reel.id);
            const isWide = reel.isWide ?? (reel.aspect === '16:9');
            const hasError = videoPlaybackErrors[reel.id];
            const isNearby = activeIndex !== -1 && Math.abs(index - activeIndex) === 1;
            const preloadMode = (isActive || isPlaying) ? 'auto' : (isNearby ? 'metadata' : 'none');

            return (
              <article
                key={reel.id}
                data-reel-id={reel.id}
                className={`reel-card ${isWide ? 'landscape' : ''} ${isActive ? 'active' : ''}`}
              >
                <div
                  className="reel-media cursor-pointer relative bg-black rounded-xl overflow-hidden group/media"
                  data-aspect={reel.aspect}
                  onClick={() => handlePlayPause(reel.id)}
                >
                  {/* Native video player */}
                  {reel.videoUrl ? (
                    <video
                      ref={(el) => (videoRefs.current[reel.id] = el)}
                      src={formatVideoUrl(reel.videoUrl)}
                      playsInline
                      loop
                      muted={isMuted}
                      preload={preloadMode}
                      className="w-full h-full object-contain bg-black"
                      onLoadStart={() => {
                        setVideoLoading((prev) => ({ ...prev, [reel.id]: true }));
                      }}
                      onLoadedData={() => {
                        setVideoLoading((prev) => ({ ...prev, [reel.id]: false }));
                        setVideoBuffering((prev) => ({ ...prev, [reel.id]: false }));
                      }}
                      onCanPlay={() => {
                        setVideoLoading((prev) => ({ ...prev, [reel.id]: false }));
                        setVideoBuffering((prev) => ({ ...prev, [reel.id]: false }));
                      }}
                      onPlaying={() => {
                        setVideoLoading((prev) => ({ ...prev, [reel.id]: false }));
                        setVideoBuffering((prev) => ({ ...prev, [reel.id]: false }));
                        setVideoPlaybackErrors((prev) => ({ ...prev, [reel.id]: false }));
                      }}
                      onWaiting={() => {
                        setVideoBuffering((prev) => ({ ...prev, [reel.id]: true }));
                      }}
                      onStalled={() => {
                        if (isActive || isPlaying) {
                          setVideoBuffering((prev) => ({ ...prev, [reel.id]: true }));
                        }
                      }}
                      onPlay={() => setPlayingVideoId(reel.id)}
                      onPause={() => {
                        setVideoBuffering((prev) => ({ ...prev, [reel.id]: false }));
                        if (playingVideoId === reel.id) setPlayingVideoId(null);
                      }}
                      onVolumeChange={(e) => {
                        const v = e.currentTarget;
                        setMutedVideoId((prev) => ({ ...prev, [reel.id]: v.muted }));
                      }}
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (v.duration > 0 && !isNaN(v.duration)) {
                          setVideoCurrentTime((prev) => ({
                            ...prev,
                            [reel.id]: `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`,
                          }));
                        }
                      }}
                      onTimeUpdate={(e) => {
                        const v = e.currentTarget;
                        if (videoPlaybackErrors[reel.id]) {
                          setVideoPlaybackErrors((prev) => ({ ...prev, [reel.id]: false }));
                        }
                        if (videoBuffering[reel.id]) {
                          setVideoBuffering((prev) => ({ ...prev, [reel.id]: false }));
                        }
                        if (v.duration > 0 && !isNaN(v.duration)) {
                          const pct = (v.currentTime / v.duration) * 100;
                          setVideoProgress((prev) => ({ ...prev, [reel.id]: pct }));
                          setVideoCurrentTime((prev) => ({
                            ...prev,
                            [reel.id]: `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`,
                          }));
                        }
                      }}
                      onEnded={() => {
                        setVideoProgress((prev) => ({ ...prev, [reel.id]: 0 }));
                        if (playingVideoId === reel.id) setPlayingVideoId(null);
                      }}
                      onError={(e) => {
                        const v = e.currentTarget;
                        if (v.error) {
                          console.warn(`Video error on reel ${reel.id}: code ${v.error.code} (${v.error.message})`);
                        }
                        handleVideoError(reel.id);
                      }}
                    />
                  ) : (
                    <div className={`media-bg ${reel.bgGradientClass || 'one'}`}></div>
                  )}

                  {/* Subtle Cinematic Loading / Buffering Overlay */}
                  {(videoLoading[reel.id] || videoBuffering[reel.id]) && !hasError && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-4 bg-black/40 backdrop-blur-[2px] pointer-events-none transition-opacity duration-300 select-none">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/80 border border-red-500/40 backdrop-blur-md shadow-lg shadow-red-950/40">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                        </span>
                        <span className="font-mono text-[10px] tracking-widest text-red-100 font-bold uppercase">
                          {videoBuffering[reel.id] ? 'BUFFERING' : 'LOADING'}
                        </span>
                      </div>
                      <div className="w-24 h-0.5 bg-white/10 rounded-full overflow-hidden mt-2 relative">
                        <div className="h-full bg-red-600 rounded-full w-12 animate-scanline shadow-[0_0_8px_rgba(255,22,56,0.9)]" />
                      </div>
                    </div>
                  )}

                  {/* Playback Error / Stream Retry Overlay if video stream was interrupted */}
                  {hasError && (
                    <div 
                      className="absolute inset-0 z-40 flex flex-col items-center justify-center p-4 text-center bg-neutral-950/95 text-white backdrop-blur-md overflow-y-auto"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center mb-2">
                        <RefreshCw className="w-5 h-5 text-red-400" />
                      </div>
                      <h4 className="text-xs font-bold mb-1 text-white uppercase tracking-wider">Stream Interrupted</h4>
                      <p className="text-[11px] text-neutral-300 max-w-xs mb-3 leading-relaxed">
                        Playback was interrupted. Click to retry stream playback.
                      </p>

                      <div className="flex flex-col gap-2 w-full max-w-xs items-center">
                        {/* Retry stream button (visible to all) */}
                        <button
                          type="button"
                          onClick={(e) => handleRetryVideo(reel.id, e)}
                          className="w-full py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                        >
                          <RefreshCw className="w-4 h-4" />
                          <span>RETRY PLAYBACK</span>
                        </button>

                        {/* Direct File Upload and Edit button ONLY in Admin mode */}
                        {isAdmin && (
                          <>
                            <label className="w-full py-2 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-neutral-200 text-[11px] font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                              <Upload className="w-3.5 h-3.5" />
                              <span>Upload / Replace Video File</span>
                              <input
                                type="file"
                                accept="video/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleDirectCardUpload(reel.id, file);
                                }}
                              />
                            </label>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingReel(reel);
                              }}
                              className="text-[10px] text-neutral-400 hover:text-white underline pt-1 transition-colors cursor-pointer"
                            >
                              Edit Video Link
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="media-noise pointer-events-none"></div>

                  {!reel.videoUrl && (
                    <div className="project-word">
                      PROJECT
                      <br />
                      <b>{String(index + 1).padStart(2, '0')}</b>
                    </div>
                  )}

                  {/* Top Left: Sound Indicator & Quick Toggle */}
                  {reel.videoUrl && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleMute(reel.id);
                      }}
                      className="absolute left-3 top-3 z-30 px-2.5 py-1.5 rounded-full bg-black/75 border border-white/20 text-white backdrop-blur-md hover:bg-black/90 transition-all flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer shadow-lg"
                      title={isMuted ? 'Turn Sound On' : 'Mute Video'}
                    >
                      {isMuted ? (
                        <>
                          <VolumeX className="w-3.5 h-3.5 text-neutral-400" />
                          <span>MUTED</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>SOUND ON</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* Top Right: Upload / Replace Video & Delete Button (ONLY VISIBLE IN ADMIN STUDIO MODE) */}
                  {isAdmin && (
                    <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingReel(reel);
                        }}
                        className="px-2.5 py-1.5 rounded-full bg-red-600/90 border border-red-400/30 text-white backdrop-blur-md hover:bg-red-500 transition-all flex items-center gap-1 text-[11px] font-semibold shadow-lg"
                        title="Replace video link"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>REPLACE VIDEO</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReel(reel.id, reel.title);
                        }}
                        className="p-1.5 rounded-full bg-red-950/80 border border-red-500/40 text-red-300 backdrop-blur-md hover:bg-red-800 hover:text-white transition-all"
                        title="Delete this reel"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Central Play / Pause Indicator */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayPause(reel.id);
                    }}
                    className={`reel-play transition-all duration-200 cursor-pointer ${
                      isPlaying ? 'opacity-0 group-hover/media:opacity-100' : 'opacity-100'
                    }`}
                    title={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <Pause className="w-7 h-7 text-red-500 fill-red-500" />
                    ) : (
                      <Play className="w-7 h-7 text-red-500 fill-red-500 ml-1" />
                    )}
                  </button>

                  {/* Bottom Playback Controls Bar Overlay */}
                  <div
                    className="absolute inset-x-0 bottom-0 z-30 p-3 pt-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex flex-col gap-2 pointer-events-auto"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Interactive Progress Bar & Scrubber */}
                    <div
                      className="w-full h-3 flex items-center cursor-pointer group/scrub py-1"
                      onClick={(e) => handleScrub(reel.id, e)}
                      title="Click or drag to scrub video"
                    >
                      <div className="w-full h-1 group-hover/scrub:h-2 bg-white/20 rounded-full overflow-hidden transition-all relative">
                        <div
                          className="h-full bg-red-600 rounded-full transition-all duration-100 relative shadow-[0_0_8px_rgba(255,22,56,0.8)]"
                          style={{
                            width: `${videoProgress[reel.id] ?? (isPlaying ? 100 : 0)}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Bottom Controls Row: Play/Pause, Timecode, Sound, Layout, Fullscreen */}
                    <div className="flex items-center justify-between gap-2">
                      {/* Left: Play/Pause Button + Current Playback Time */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlayPause(reel.id);
                          }}
                          className="p-1.5 rounded-full bg-white/10 hover:bg-red-600 text-white transition-all cursor-pointer flex items-center justify-center shadow"
                          title={isPlaying ? 'Pause video' : 'Play video'}
                        >
                          {isPlaying ? (
                            <Pause className="w-3.5 h-3.5 fill-current" />
                          ) : (
                            <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                          )}
                        </button>

                        <span className="font-mono text-[10px] text-neutral-300 tracking-wider select-none">
                          {videoCurrentTime[reel.id] || reel.duration || '00:00 / 00:00'}
                        </span>
                      </div>

                      {/* Right: Sound Toggle + Aspect Ratio + Fullscreen */}
                      <div className="flex items-center gap-1.5">
                        {reel.videoUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleMute(reel.id);
                            }}
                            className="px-2 py-1 rounded-full bg-black/60 hover:bg-black/90 border border-white/20 text-white text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer shadow"
                            title={isMuted ? 'Turn Sound On' : 'Mute Video'}
                          >
                            {isMuted ? (
                              <>
                                <VolumeX className="w-3 h-3 text-neutral-400" />
                                <span>MUTED</span>
                              </>
                            ) : (
                              <>
                                <Volume2 className="w-3 h-3 text-emerald-400" />
                                <span>SOUND</span>
                              </>
                            )}
                          </button>
                        )}

                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleWide(reel.id);
                            }}
                            className={`px-2 py-1 rounded-full border text-[9px] font-bold tracking-wider backdrop-blur-md transition-all shadow flex items-center gap-1 cursor-pointer ${
                              isWide
                                ? 'bg-red-600/80 border-red-400/50 text-white hover:bg-red-500'
                                : 'bg-black/70 border-white/30 text-white hover:bg-black/90'
                            }`}
                            title="Creator Mode: Toggle 9:16 Portrait / 16:9 Wide"
                          >
                            <span>{isWide ? '16:9' : '9:16'}</span>
                          </button>
                        ) : (
                          <div className="px-1.5 py-0.5 rounded bg-black/50 border border-white/10 text-neutral-400 text-[8px] font-mono select-none">
                            {isWide ? '16:9' : '9:16'}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFullscreen(reel.id);
                          }}
                          className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all cursor-pointer flex items-center justify-center shadow"
                          aria-label="Fullscreen video"
                          title="Fullscreen"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="reel-info">
                  <div className="reel-title flex justify-between items-center">
                    <div className="flex items-center gap-2">
                      <strong>{reel.title}</strong>
                      {isAdmin && (
                        <button
                          onClick={() => setEditingReel(reel)}
                          className="text-neutral-400 hover:text-white p-1"
                          title="Edit title & category"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <span>
                      {String(index + 1).padStart(2, '0')} / {String(reels.length).padStart(2, '0')}
                    </span>
                  </div>
                  <p>{reel.category}</p>
                </div>
              </article>
            );
          }))}
        </div>

        {/* Add Reel Button at bottom of work list when in Creator Mode */}
        {isAdmin && (
          <div className="p-4 flex justify-center">
            <button
              onClick={() => setShowAddReelModal(true)}
              className="w-full max-w-sm py-3 px-4 rounded-xl bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg"
            >
              <Plus className="w-4 h-4 text-red-400" />
              <span>Add Another Video Reel ({reels.length + 1})</span>
            </button>
          </div>
        )}

        <div className="reel-hint">
          SWIPE <b>↓</b>
        </div>
      </section>

      {/* About Screen */}
      <section className={`screen ${activeScreen === 'about' ? 'open' : ''}`}>
        <div className="screen-head flex justify-between items-center">
          <div>
            <small>02 / THE EDITOR</small>
            <h2>ABOUT</h2>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <button
                onClick={handleLogoutAdmin}
                className="px-2.5 py-1 rounded-full bg-red-600/90 text-white text-[10px] font-bold tracking-widest flex items-center gap-1 hover:bg-red-500 transition-all shadow-md"
                title="Creator Studio active (Click to exit to Public View)"
              >
                <Unlock className="w-3 h-3" />
                <span>STUDIO ON</span>
              </button>
            ) : (
              <button
                onClick={() => setShowAdminModal(true)}
                className="p-1.5 rounded-full bg-white/5 hover:bg-white/15 text-white/30 hover:text-white/80 transition-all"
                title="Creator Login"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
            )}
            <button className="close" onClick={() => setActiveScreen('none')}>
              ×
            </button>
          </div>
        </div>
        <div className="screen-content">
          <div className="about-grid">
            {/* Portrait Pic Frame */}
            <div className="portrait relative group overflow-hidden rounded-xl border border-red-500/20 bg-[#090304]">
              {portfolioInfo.portraitUrl ? (
                <img
                  src={portfolioInfo.portraitUrl}
                  alt="Editor Portrait"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full grid place-items-center font-mono text-[8px] text-[#555] tracking-widest leading-tight">
                  FRAME<br />01
                </div>
              )}

              {/* Creator Mode Picture Change overlay */}
              {isAdmin && (
                <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2 z-10">
                  <button
                    type="button"
                    onClick={() => portraitInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-full bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold tracking-wider flex items-center gap-1 shadow-md transition-all cursor-pointer"
                  >
                    <Camera className="w-3 h-3" />
                    <span>Change Pic</span>
                  </button>
                  {portfolioInfo.portraitUrl && (
                    <button
                      type="button"
                      onClick={handleRemovePortrait}
                      className="px-2 py-0.5 rounded-full bg-white/10 hover:bg-red-900/80 text-neutral-300 hover:text-white text-[9px] transition-all cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                  <input
                    type="file"
                    ref={portraitInputRef}
                    accept="image/*"
                    onChange={handlePortraitUpload}
                    className="hidden"
                  />
                </div>
              )}
            </div>

            {/* About Text Bio */}
            <div className="info relative">
              {isAdmin && !isEditingAbout && (
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[10px] font-mono text-red-400/80 uppercase tracking-widest flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-red-400" />
                    Creator Studio
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsEditingAbout(true)}
                    className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-white text-[10px] font-bold flex items-center gap-1 transition-all shadow-sm"
                  >
                    <Edit3 className="w-3 h-3 text-red-400" />
                    <span>Edit Bio</span>
                  </button>
                </div>
              )}

              {isEditingAbout ? (
                <form onSubmit={handleSaveAbout} className="space-y-2">
                  <div className="text-[10px] font-bold text-red-400 tracking-wider uppercase">
                    Edit Bio Sentences
                  </div>
                  <textarea
                    value={aboutDraft}
                    onChange={(e) => setAboutDraft(e.target.value)}
                    rows={4}
                    className="w-full bg-black/90 border border-red-500/50 rounded-xl p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500 leading-relaxed font-sans"
                    placeholder="Write sentences about yourself..."
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setAboutDraft(portfolioInfo.aboutText);
                        setIsEditingAbout(false);
                      }}
                      className="px-3 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3.5 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </button>
                  </div>
                </form>
              ) : (
                <p>{portfolioInfo.aboutText}</p>
              )}
            </div>
          </div>
          <div className="note">
            THE BEST EDIT IS THE ONE YOU DON'T NOTICE — YOU JUST KEEP WATCHING.
          </div>
        </div>
      </section>

      {/* Skills Screen */}
      <section className={`screen ${activeScreen === 'skills' ? 'open' : ''}`}>
        <div className="screen-head">
          <div>
            <small>03 / TOOLKIT</small>
            <h2>SKILLS</h2>
          </div>
          <button className="close" onClick={() => setActiveScreen('none')}>
            ×
          </button>
        </div>
        <div className="screen-content">
          <div className="timeline">
            <div className="timeline-head">
              <span>EDIT TIMELINE</span>
              <span>00:00 ━━━ 00:30</span>
            </div>
            <div className="tracks">
              <i></i><i></i><i></i><i></i><i></i><i></i>
            </div>
          </div>
          <div className="chips">
            {portfolioInfo.skills.map((skill, i) => (
              <div key={i} className="chip inline-flex items-center gap-1.5">
                <span>{skill}</span>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleRemoveSkill(skill)}
                    className="p-0.5 rounded-full hover:bg-red-600 text-white/70 hover:text-white transition-colors cursor-pointer"
                    title={`Remove ${skill}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add Skill form in Creator Mode */}
          {isAdmin && (
            <form onSubmit={handleAddSkill} className="mt-5 flex gap-2 max-w-sm">
              <input
                type="text"
                placeholder="Add a skill (e.g. DaVinci Resolve)"
                value={newSkillInput}
                onChange={(e) => setNewSkillInput(e.target.value)}
                className="flex-1 bg-black/90 border border-red-500/40 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1 shadow-md transition-all shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Skill</span>
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Contact Screen */}
      <section className={`screen ${activeScreen === 'contact' ? 'open' : ''}`}>
        <div className="screen-head">
          <div>
            <small>04 / START A PROJECT</small>
            <h2>CONTACT</h2>
          </div>
          <button className="close" onClick={() => setActiveScreen('none')}>
            ×
          </button>
        </div>
        <div className="screen-content">
          <div className="contact-box relative">
            {isAdmin && !isEditingContact && (
              <div className="flex justify-end mb-3">
                <button
                  type="button"
                  onClick={() => setIsEditingContact(true)}
                  className="px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-white text-[10px] font-bold flex items-center gap-1 transition-all shadow-sm cursor-pointer"
                >
                  <Edit3 className="w-3 h-3 text-red-400" />
                  <span>Edit Contact Info</span>
                </button>
              </div>
            )}

            {isEditingContact ? (
              <form onSubmit={handleSaveContact} className="space-y-3 text-left w-full max-w-md mx-auto">
                <div className="text-[10px] font-bold text-red-400 tracking-wider uppercase mb-1">
                  Edit Contact Information
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1">
                    Availability / Status Banner
                  </label>
                  <input
                    type="text"
                    value={contactDraft.availability}
                    onChange={(e) => setContactDraft({ ...contactDraft, availability: e.target.value })}
                    className="w-full bg-black/90 border border-red-500/40 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500"
                    placeholder="e.g. READY WHEN YOU ARE"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={contactDraft.email}
                    onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
                    className="w-full bg-black/90 border border-red-500/40 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500"
                    placeholder="your.email@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1">
                    Instagram Handle
                  </label>
                  <input
                    type="text"
                    value={contactDraft.instagram}
                    onChange={(e) => setContactDraft({ ...contactDraft, instagram: e.target.value })}
                    className="w-full bg-black/90 border border-red-500/40 rounded-xl px-3 py-1.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500"
                    placeholder="@yourhandle"
                    required
                  />
                </div>

                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setContactDraft({
                        email: portfolioInfo.email,
                        instagram: portfolioInfo.instagram,
                        availability: portfolioInfo.availability || 'READY WHEN YOU ARE',
                      });
                      setIsEditingContact(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Contact</span>
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="contact-ready">
                  <i></i> {portfolioInfo.availability || 'READY WHEN YOU ARE'}
                </div>
                <p>Have a project? Let's make something worth watching.</p>
                <a className="contact-link" href={`mailto:${portfolioInfo.email}`}>
                  {portfolioInfo.email} <span>↗</span>
                </a>
                <a
                  className="contact-link"
                  href={`https://instagram.com/${portfolioInfo.instagram.replace('@', '')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {portfolioInfo.instagram} <span>↗</span>
                </a>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Fullscreen Overlay Lightbox Modal */}
      {fullscreenReelId && (() => {
        const fReel = reels.find((r) => r.id === fullscreenReelId);
        if (!fReel) return null;
        const isMuted = isReelMuted(fReel.id);

        return (
          <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-2xl flex flex-col justify-between p-4 sm:p-6 animate-in fade-in duration-200 select-none">
            {/* Top Bar */}
            <div className="flex justify-between items-center z-20">
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                <div>
                  <span className="text-red-400 font-mono text-[10px] tracking-widest uppercase block">FULLSCREEN PRESENTATION</span>
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">{fReel.title}</h3>
                </div>
              </div>
              <button
                onClick={handleCloseFullscreen}
                className="p-2.5 rounded-full bg-white/10 hover:bg-red-600 text-white transition-all shadow-xl cursor-pointer"
                title="Exit Fullscreen"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Center Video Container */}
            <div
              className="flex-1 flex items-center justify-center my-2 relative overflow-hidden cursor-pointer"
              onClick={handleFullscreenPlayPause}
            >
              {fReel.videoUrl ? (
                <>
                  <video
                    ref={fullscreenVideoRef}
                    src={formatVideoUrl(fReel.videoUrl)}
                    playsInline
                    loop
                    muted={isMuted}
                    className="max-w-full max-h-[80vh] w-auto h-auto object-contain rounded-2xl shadow-2xl border border-white/10 bg-black"
                    onLoadStart={() => {
                      setVideoLoading((prev) => ({ ...prev, [fReel.id]: true }));
                    }}
                    onLoadedData={() => {
                      setVideoLoading((prev) => ({ ...prev, [fReel.id]: false }));
                    }}
                    onCanPlay={(e) => {
                      setVideoLoading((prev) => ({ ...prev, [fReel.id]: false }));
                      setVideoBuffering((prev) => ({ ...prev, [fReel.id]: false }));
                      const v = e.currentTarget;
                      const sync = fullscreenSyncRef.current;
                      if (isInitializingFullscreenRef.current && sync && sync.reelId === fReel.id) {
                        isInitializingFullscreenRef.current = false;
                        if (sync.initialTime > 0 && v.duration > 0 && !isNaN(v.duration) && Math.abs(v.currentTime - sync.initialTime) > 0.3) {
                          try {
                            v.currentTime = Math.min(sync.initialTime, v.duration - 0.1);
                          } catch (err) {}
                        }
                        if (sync.wasPlaying && v.paused) {
                          const p = v.play();
                          if (p !== undefined) {
                            p.then(() => setPlayingVideoId(fReel.id)).catch(() => {});
                          }
                        }
                      }
                    }}
                    onPlaying={() => {
                      setVideoLoading((prev) => ({ ...prev, [fReel.id]: false }));
                      setVideoBuffering((prev) => ({ ...prev, [fReel.id]: false }));
                      setVideoPlaybackErrors((prev) => ({ ...prev, [fReel.id]: false }));
                    }}
                    onWaiting={() => {
                      setVideoBuffering((prev) => ({ ...prev, [fReel.id]: true }));
                    }}
                    onStalled={() => {
                      setVideoBuffering((prev) => ({ ...prev, [fReel.id]: true }));
                    }}
                    onPlay={() => setPlayingVideoId(fReel.id)}
                    onPause={() => {
                      setVideoBuffering((prev) => ({ ...prev, [fReel.id]: false }));
                      if (playingVideoId === fReel.id) setPlayingVideoId(null);
                    }}
                    onVolumeChange={(e) => {
                      const v = e.currentTarget;
                      setMutedVideoId((prev) => ({ ...prev, [fReel.id]: v.muted }));
                    }}
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      const sync = fullscreenSyncRef.current;
                      if (isInitializingFullscreenRef.current && sync && sync.reelId === fReel.id) {
                        if (sync.initialTime > 0 && v.duration > 0 && !isNaN(v.duration)) {
                          try {
                            v.currentTime = Math.min(sync.initialTime, v.duration - 0.1);
                          } catch (err) {
                            console.log('Fullscreen initial currentTime note:', err);
                          }
                        }
                        v.muted = sync.isMuted;
                        if (sync.wasPlaying) {
                          const p = v.play();
                          if (p !== undefined) {
                            p.then(() => setPlayingVideoId(fReel.id)).catch(() => {});
                          }
                        } else {
                          v.pause();
                        }
                      }

                      if (v.duration > 0 && !isNaN(v.duration)) {
                        setVideoCurrentTime((prev) => ({
                          ...prev,
                          [fReel.id]: `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`,
                        }));
                      }
                    }}
                    onTimeUpdate={(e) => {
                      const v = e.currentTarget;
                      if (videoPlaybackErrors[fReel.id]) {
                        setVideoPlaybackErrors((prev) => ({ ...prev, [fReel.id]: false }));
                      }
                      if (videoBuffering[fReel.id]) {
                        setVideoBuffering((prev) => ({ ...prev, [fReel.id]: false }));
                      }
                      if (v.duration > 0 && !isNaN(v.duration)) {
                        const pct = (v.currentTime / v.duration) * 100;
                        setVideoProgress((prev) => ({ ...prev, [fReel.id]: pct }));
                        setVideoCurrentTime((prev) => ({
                          ...prev,
                          [fReel.id]: `${formatTime(v.currentTime)} / ${formatTime(v.duration)}`,
                        }));
                      }
                    }}
                    onEnded={() => {
                      setVideoProgress((prev) => ({ ...prev, [fReel.id]: 0 }));
                    }}
                    onError={(e) => {
                      const v = e.currentTarget;
                      if (v.error) {
                        console.warn(`Fullscreen video error on reel ${fReel.id}: code ${v.error.code} (${v.error.message})`);
                      }
                      handleVideoError(fReel.id);
                    }}
                  />
                  {/* Subtle Cinematic Loading / Buffering Overlay for Fullscreen */}
                  {(videoLoading[fReel.id] || videoBuffering[fReel.id]) && !videoPlaybackErrors[fReel.id] && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-black/40 backdrop-blur-[2px] pointer-events-none transition-opacity duration-300 rounded-2xl select-none">
                      <div className="flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-black/85 border border-red-500/40 backdrop-blur-md shadow-xl shadow-red-950/50">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600"></span>
                        </span>
                        <span className="font-mono text-xs tracking-widest text-red-100 font-bold uppercase">
                          {videoBuffering[fReel.id] ? 'BUFFERING' : 'LOADING'}
                        </span>
                      </div>
                      <div className="w-32 h-0.5 bg-white/10 rounded-full overflow-hidden mt-2.5 relative">
                        <div className="h-full bg-red-600 rounded-full w-16 animate-scanline shadow-[0_0_10px_rgba(255,22,56,1)]" />
                      </div>
                    </div>
                  )}
                  {videoPlaybackErrors[fReel.id] && (
                    <div
                      className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-neutral-950/90 text-white backdrop-blur-md rounded-2xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mb-3">
                        <RefreshCw className="w-6 h-6 text-red-400" />
                      </div>
                      <h4 className="text-sm font-bold mb-1">Stream Paused or Interrupted</h4>
                      <p className="text-[11px] text-neutral-400 max-w-xs leading-relaxed mb-4">
                        Video stream buffer encountered an issue. Tap retry to restart playback.
                      </p>
                      <button
                        type="button"
                        onClick={(e) => handleRetryVideo(fReel.id, e)}
                        className="py-2.5 px-5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>RETRY PLAYBACK</span>
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-neutral-500 font-mono text-xs">No video URL linked</div>
              )}
            </div>

            {/* Bottom Fullscreen Control Bar */}
            <div
              className="bg-neutral-900/95 border border-white/15 rounded-2xl p-3 sm:px-5 sm:py-3.5 text-xs text-white z-20 max-w-2xl mx-auto w-full backdrop-blur-xl shadow-2xl flex flex-col gap-2.5"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Fullscreen Scrubber Bar */}
              <div
                className="w-full h-3 flex items-center cursor-pointer group/fscrub py-1"
                onClick={(e) => handleScrub(fReel.id, e)}
                title="Scrub video"
              >
                <div className="w-full h-1 group-hover/fscrub:h-2 bg-white/20 rounded-full overflow-hidden transition-all relative">
                  <div
                    className="h-full bg-red-600 rounded-full transition-all duration-100 shadow-[0_0_10px_rgba(255,22,56,0.9)]"
                    style={{
                      width: `${videoProgress[fReel.id] ?? (playingVideoId === fReel.id ? 100 : 0)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Controls Row */}
              <div className="flex justify-between items-center gap-3">
                {/* Left: Play/Pause Button + Timecode + Category */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleFullscreenPlayPause}
                    className="p-2 rounded-full bg-red-600 hover:bg-red-500 text-white transition-all cursor-pointer flex items-center justify-center shadow-lg"
                    title={playingVideoId === fReel.id ? 'Pause video' : 'Play video'}
                  >
                    {playingVideoId === fReel.id ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>

                  <span className="font-mono text-xs text-neutral-300 tracking-wider">
                    {videoCurrentTime[fReel.id] || fReel.duration || '00:00 / 00:00'}
                  </span>

                  <span className="hidden sm:inline-block font-mono text-neutral-400 text-xs px-2 py-0.5 rounded bg-white/5 border border-white/10">
                    {fReel.category}
                  </span>
                </div>

                {/* Right: Sound Toggle + Close Button */}
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleToggleMute(fReel.id)}
                    className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 font-bold tracking-wider text-[11px] transition-all cursor-pointer"
                  >
                    {isMuted ? (
                      <>
                        <VolumeX className="w-4 h-4 text-neutral-400" />
                        <span>UNMUTE</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4 text-emerald-400" />
                        <span>SOUND ON</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleCloseFullscreen}
                    className="px-3.5 py-1.5 rounded-full bg-white/10 hover:bg-red-600 text-white font-bold tracking-wider text-[11px] uppercase transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default VideoPortfolioView;