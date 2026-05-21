import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Download, Clock, Lock, AlertCircle, X, ShieldAlert, FolderDown, Loader2, Mail, CheckCircle2, Heart, FileImage, FileVideo, Send, Eye, ArrowLeft, Image as ImageIcon, Edit2, ArrowUpRight } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Gallery, GalleryFile } from '../types';
import { formatCurrency, getTimeRemaining, getOptimizedImageUrl, rewriteUrlToR2, getCleanR2Url } from '../utils/formatters';
// @ts-ignore
import JSZip from 'jszip';
// @ts-ignore
import saveAs from 'file-saver';

export const ClientGallery: React.FC = () => {
  const { galleryId } = useParams<{ galleryId: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPayModal, setShowPayModal] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [showScreenshotWarning, setShowScreenshotWarning] = useState(false);
  const [acceptedExtras, setAcceptedExtras] = useState(false);
  
  // Selection Mode State
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [submittingSelection, setSubmittingSelection] = useState(false);
  const [selectionSubmitted, setSelectionSubmitted] = useState(false);
  const [viewFilter, setViewFilter] = useState<'all' | 'selected' | 'main' | 'extras'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null);
  const [lightboxFile, setLightboxFile] = useState<GalleryFile | null>(null);

  // Download states
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatusText, setDownloadStatusText] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const horizontalRef = useRef<HTMLDivElement | null>(null);

  // Ref to cancel download if needed
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (galleryId) loadGallery();
  }, [galleryId]);

  useEffect(() => {
    const el = horizontalRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.preventDefault();
            const isTrackpad = Math.abs(e.deltaY) < 40;
            if (isTrackpad) {
                el.scrollLeft += e.deltaY;
            } else {
                el.scrollBy({ left: Math.sign(e.deltaY) * 300, behavior: 'smooth' });
            }
        }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [files, viewFilter]); // re-run when content renders


  // Network Optimization: Preconnect to Supabase Storage
  useEffect(() => {
    if (files.length > 0) {
      try {
        // Extract the hostname from the first file URL to preconnect
        const url = new URL(files[0].file_url);
        const origin = url.origin;
        
        // Check if link already exists
        if (!document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) {
            const link = document.createElement('link');
            link.rel = 'preconnect';
            link.href = origin;
            document.head.appendChild(link);
        }
      } catch (e) {
        // Ignore URL parsing errors
      }
    }
  }, [files]);

  // Timer effect
  useEffect(() => {
    if (!files.length) return;
    
    // Find the earliest expiry date
    const firstFile = files[0];
    
    const updateTimer = () => {
        const { days, hours, minutes, expired } = getTimeRemaining(firstFile.expires_at);
        if (expired) {
            setTimeRemaining('Expired');
        } else if (days > 0) {
            setTimeRemaining(`${days}d ${hours}h`);
        } else {
            setTimeRemaining(`${hours}h ${minutes}m`);
        }
    };

    updateTimer(); 
    const timer = setInterval(updateTimer, 60000); 

    return () => clearInterval(timer);
  }, [files]);

  // Anti-Screenshot & Right-Click Protection
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if ((e.target as HTMLElement).tagName === 'IMG' || (e.target as HTMLElement).tagName === 'VIDEO') {
          setShowScreenshotWarning(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        setShowScreenshotWarning(true);
        try { navigator.clipboard.writeText(''); } catch (err) {}
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === 's')) {
            setShowScreenshotWarning(true);
        }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const loadGallery = async () => {
    try {
      if (!galleryId) return;

      const { data: galData, error: galError } = await supabase
        .from('galleries')
        .select('*')
        .eq('id', galleryId)
        .single();

      if (galError || !galData) {
        setError('Gallery not found or accessed denied.');
        setLoading(false);
        return;
      }

      if (!galData.link_enabled) {
        setError('This gallery is currently unavailable. Please contact the photographer.');
        setLoading(false);
        return;
      }

      setGallery(galData);
      if (galData.selection_status === 'submitted' || galData.selection_status === 'completed') {
        setSelectionSubmitted(true);
      }

      // Load Files
      let allFiles: GalleryFile[] = [];
      let hasMore = true;
      let offset = 0;
      const limit = 1000;
      
      while (hasMore) {
        const { data: fileData, error: fileError } = await supabase
          .from('files')
          .select('*')
          .eq('gallery_id', galleryId)
          .gt('expires_at', new Date().toISOString()) 
          .order('expires_at', { ascending: true })
          .range(offset, offset + limit - 1);
          
        if (fileError) throw fileError;
        
        if (fileData) {
            allFiles = [...allFiles, ...fileData];
            if (fileData.length < limit) {
                hasMore = false;
            } else {
                offset += limit;
            }
        } else {
            hasMore = false;
        }
      }

      if (allFiles.length === 0) {
         setError('This gallery link has expired. Please contact the photographer to request access.');
      } else {
         setFiles(allFiles);
      }

      // Load Selections if enabled
      if (galData.selection_enabled) {
        const { data: selectionData } = await supabase
            .from('selections')
            .select('file_id')
            .eq('gallery_id', galleryId)
            .order('created_at', { ascending: true }); // Important for counting extras
        
        if (selectionData) {
            setSelectedFileIds(new Set(selectionData.map(s => s.file_id)));
            if (selectionData.length === 0 && galData.selection_limit > 0 && galData.selection_status !== 'submitted' && galData.selection_status !== 'completed') {
                setShowWelcomeModal(true);
            }
            if (galData.selection_limit > 0 && selectionData.length >= galData.selection_limit) {
                setAcceptedExtras(true); // Don't prompt randomly if they already accepted
            }
        }
      }

    } catch (err) {
      console.error(err);
      setError('Error loading gallery.');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = async (file: GalleryFile) => {
    if (!gallery?.selection_enabled || selectionSubmitted) return;

    const isSelected = selectedFileIds.has(file.id);
    
    if (!isSelected && gallery.selection_limit && gallery.selection_limit > 0) {
        if (selectedFileIds.size >= gallery.selection_limit && !acceptedExtras) {
            const confirmExtras = window.confirm(`You have reached the agreed limit of ${gallery.selection_limit} photos.\n\nDo you want to proceed with selecting extras?`);
            if (confirmExtras) {
                setAcceptedExtras(true);
            } else {
                return;
            }
        }
    }

    const newSet = new Set(selectedFileIds);
    
    // Optimistic UI Update
    if (isSelected) {
        newSet.delete(file.id);
        setToast({ message: 'Removed from favorites', type: 'info' });
    } else {
        newSet.add(file.id);
        setToast({ message: 'Added to favorites', type: 'success' });
    }
    setSelectedFileIds(newSet);
    
    // Auto hide toast
    setTimeout(() => setToast(null), 2000);

    try {
        if (isSelected) {
            // Remove from DB
            const { error } = await supabase
                .from('selections')
                .delete()
                .eq('gallery_id', gallery.id)
                .eq('file_id', file.id);
            if (error) throw error;
        } else {
            // Add to DB
            const { error } = await supabase
                .from('selections')
                .insert({ gallery_id: gallery.id, file_id: file.id });
            if (error) throw error;
        }
    } catch (err: any) {
        console.error("Selection sync failed", err);
        // Revert on error
        setSelectedFileIds(selectedFileIds); // Revert to old state
        setToast({ message: 'Failed to update selection: ' + (err?.message || JSON.stringify(err)), type: 'info' });
    }
  };

  const submitSelection = async () => {
    if (!gallery) return;
    if (!confirm(`Are you sure you want to submit your selection of ${selectedFileIds.size} photos? This will notify the photographer.`)) return;

    setSubmittingSelection(true);
    try {
        const { error } = await supabase.rpc('submit_selection', { gallery_id: gallery.id });
        
        if (error) throw error;
        
        setSelectionSubmitted(true);
        setGallery({ ...gallery, selection_status: 'submitted', link_enabled: false });
        setError('This gallery is currently unavailable. Please contact the photographer.');
        
        alert("Selection submitted successfully! The photographer has been notified.");
    } catch (err: any) {
        console.error(err);
        alert("Failed to submit selection: " + (err?.message || JSON.stringify(err)));
    } finally {
        setSubmittingSelection(false);
    }
  };

  const unsubmitSelection = async () => {
    if (!gallery) return;
    if (!confirm(`Are you sure you want to edit your selection? This will notify the photographer that you are making changes.`)) return;

    setSubmittingSelection(true);
    try {
        const { error } = await supabase.rpc('unsubmit_selection', { gallery_id: gallery.id });
        
        if (error) throw error;
        
        setSelectionSubmitted(false);
        setGallery({ ...gallery, selection_status: 'pending' });
        
        alert("Selection re-opened for editing.");
    } catch (err: any) {
        console.error(err);
        alert("Failed to re-open selection: " + (err?.message || JSON.stringify(err)));
    } finally {
        setSubmittingSelection(false);
    }
  };

  const handleDownload = async (file: GalleryFile) => {
    if (!gallery) return;

    if (gallery.selection_enabled) {
        alert("Downloads are disabled while Selection Mode is active.");
        return;
    }

    const balance = (gallery.agreed_balance || 0) - (gallery.amount_paid || 0);
    
    if (balance > 0) {
      setShowPayModal(true);
      return;
    }

    setDownloadingId(file.id);

    try {
      await supabase.rpc('increment_download', { row_id: file.id });
      
      // Instead of fetching the blob into JS memory, let the browser handle it directly
      let fileName = file.file_path.split('/').pop() || 'download';
      try { fileName = decodeURIComponent(fileName); } catch (e) {}

      const downloadProxyUrl = `/api/proxy-download?url=${encodeURIComponent(file.file_url)}&filename=${encodeURIComponent(fileName)}`;
      
      const response = await fetch(downloadProxyUrl);
      if (!response.ok) {
        throw new Error(`Proxy error: ${response.status}`);
      }
      const blob = await response.blob();
      saveAs(blob, fileName);
      
      // Short timeout to allow the download to start before removing spinner
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      console.error('Download failed', e);
      alert(`Download failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (!gallery || !files.length) return;
    
    if (gallery.selection_enabled) {
        alert("Downloads are disabled while Selection Mode is active.");
        return;
    }

    const balance = (gallery.agreed_balance || 0) - (gallery.amount_paid || 0);
    if (balance > 0) {
      setShowPayModal(true);
      return;
    }

    setDownloadingAll(true);
    setDownloadProgress(0);
    setDownloadStatusText('Preparing list...');
    abortControllerRef.current = new AbortController();

    try {
      const zip = new JSZip();
      let processed = 0;
      const total = files.length;
      
      // We process files in batches (Concurrency Limit) to avoid choking the browser/network
      const CONCURRENCY_LIMIT = 3;
      const queue = [...files];
      const activePromises: Promise<void>[] = [];
      const signal = abortControllerRef.current.signal;

      const processFile = async (file: GalleryFile) => {
        if (signal.aborted) return;
        
        try {
          const downloadProxyUrl = `/api/proxy-download?url=${encodeURIComponent(file.file_url)}`;
          const response = await fetch(downloadProxyUrl, { signal });
          if (!response.ok) throw new Error(`Failed to fetch ${file.file_path}`);
          const blob = await response.blob();
          let fileName = file.file_path.split('/').pop() || `file-${file.id}`;
          try { fileName = decodeURIComponent(fileName); } catch (e) {}
          zip.file(fileName, blob);
        } catch (error: any) {
          if (error.name !== 'AbortError') {
             console.error(`Error downloading file: ${file.id}`, error);
          }
        } finally {
          processed++;
          setDownloadProgress(Math.round((processed / total) * 100));
          setDownloadStatusText(`Fetching files (${processed}/${total})...`);
        }
      };

      // Helper to manage concurrency
      const next = async (): Promise<void> => {
        if (queue.length === 0) return;
        const file = queue.shift();
        if (file) {
           await processFile(file);
           await next();
        }
      };

      // Start initial batch
      for (let i = 0; i < Math.min(CONCURRENCY_LIMIT, files.length); i++) {
         activePromises.push(next());
      }
      
      await Promise.all(activePromises);

      if (signal.aborted) return;

      setDownloadStatusText('Packaging... (almost done)');
      
      // Use STORE compression (no compression) which is MUCH faster for images/videos
      const content = await zip.generateAsync({ 
          type: "blob", 
          compression: "STORE" 
      });
      
      if (signal.aborted) return;

      const galleryName = gallery.client_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      saveAs(content, `${galleryName}_photos.zip`);

    } catch (error) {
      console.error('Error creating zip:', error);
      alert('Failed to download all files. Please try downloading individually.');
    } finally {
      setDownloadingAll(false);
      setDownloadProgress(0);
      setDownloadStatusText('');
      abortControllerRef.current = null;
    }
  };

  const cancelDownloadAll = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          setDownloadingAll(false);
          setDownloadStatusText('');
      }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-zinc-50"><div className="animate-spin h-8 w-8 border-2 border-zinc-900 border-t-transparent rounded-full"></div></div>;

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 p-4 text-center">
        <div className="bg-white p-8 md:p-12 rounded-sm shadow-xl border border-zinc-200 max-w-md w-full">
            <div className="w-16 h-16 bg-zinc-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Clock className="w-8 h-8 text-zinc-400" strokeWidth={1} />
            </div>
            <h1 className="text-xl font-serif text-zinc-900 mb-3 tracking-wide">Gallery Unavailable</h1>
            <p className="text-zinc-500 mb-8 leading-relaxed font-light">{error}</p>
            <div className="pt-6 border-t border-slate-100">
                <p className="text-sm border-b-[1px] border-slate-700/50 pb-4 mb-4 tracking-[0.15em] uppercase text-white/50">Swanky Gallery</p>
            </div>
        </div>
      </div>
    );
  }

  const agreedAmount = gallery?.agreed_balance || 0;
  const amountPaid = gallery?.amount_paid || 0;
  const balanceDue = Math.max(0, agreedAmount - amountPaid);
  const isLocked = balanceDue > 0;
  
  // A gallery is considered a public portfolio collection if it has a category
  const isPortfolio = Boolean(gallery?.category && gallery.category.trim() !== '');
  const isPortraitGallery = isPortfolio && Boolean(gallery?.client_name.toLowerCase().includes('portrait') || gallery?.category?.toLowerCase().includes('portrait') || gallery?.client_name.toLowerCase().includes('couple') || gallery?.category?.toLowerCase().includes('couple'));
  const isPrintsGallery = isPortfolio && Boolean(gallery?.category?.toLowerCase().includes('print'));
  const isFilmGallery = isPortfolio && files.some(f => f.file_type === 'video' || (f.file_url && f.file_url.match(/\.(mp4|mov|webm|ogg)$/i)));
  const isHorizontalLayout = isPortraitGallery || isFilmGallery;
  
  // Selection mode is not relevant for portfolio collections
  const isSelectionMode = !isPortfolio && gallery?.selection_enabled;

  const limit = gallery?.selection_limit || 0;
  const selectedArray = Array.from(selectedFileIds);
  const mainSelections = limit > 0 ? selectedArray.slice(0, limit) : selectedArray;
  const extraSelections = limit > 0 ? selectedArray.slice(limit) : [];

  let displayedFiles = files;
  if (viewFilter === 'selected') displayedFiles = files.filter(f => selectedFileIds.has(f.id));
  if (viewFilter === 'main') displayedFiles = files.filter(f => mainSelections.includes(f.id));
  if (viewFilter === 'extras') displayedFiles = files.filter(f => extraSelections.includes(f.id));

  return (
    <div className={`min-h-screen bg-zinc-50 text-zinc-900 select-none ${isSelectionMode ? 'pb-24' : ''}`}>
      {/* Header */}
      <header className="sticky top-0 z-20 shadow-sm transition-all duration-300 bg-white/95 border-b border-zinc-200">
        <div className="max-w-7xl mx-auto px-4 py-3 md:py-4 flex flex-col md:flex-row justify-between md:items-center gap-3 md:gap-4">
          <div>
            <h1 className={`text-lg md:text-2xl tracking-wide font-serif flex items-center gap-2 text-zinc-900`}>
                {viewFilter !== 'all' ? (
                    <button onClick={() => setViewFilter('all')} className="md:hidden mr-1 p-2 -ml-2 text-zinc-400">
                        <ArrowLeft className="w-6 h-6" strokeWidth={1.5} />
                    </button>
                ) : isPortfolio ? (
                    <button onClick={() => navigate(`/p/${gallery?.photographer_id}`)} className="mr-1 p-2 -ml-2 text-zinc-400 hover:text-zinc-900 transition-colors">
                        <ArrowLeft className="w-6 h-6" strokeWidth={1.5} />
                    </button>
                ) : null}
                {viewFilter === 'selected' ? "My Selection" : viewFilter === 'main' ? "Main Photos" : viewFilter === 'extras' ? "Extra Photos" : gallery?.client_name}
            </h1>
            <p className={`text-[10px] md:text-xs flex items-center gap-2 text-zinc-500 tracking-widest uppercase mt-1`}>
                {displayedFiles.length} items 
                {!isPortfolio && (
                    <>
                        <span className="text-slate-300">•</span>
                        {timeRemaining === 'Expired' ? (
                           <span className="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded text-xs uppercase tracking-wide">Expired</span>
                        ) : (
                           <span>Expires in <span className="text-red-500 font-medium">{timeRemaining}</span></span>
                        )}
                    </>
                )}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center justify-end gap-2 md:gap-3 text-sm">
             {!isPortfolio && gallery?.photographer_id && (
                 <button 
                     onClick={() => navigate(`/p/${gallery.photographer_id}`)}
                     className="flex items-center gap-1.5 px-4 h-10 bg-[#161616] text-white/90 rounded-md font-bold tracking-[0.15em] text-[10px] md:text-[11px] hover:bg-black hover:text-white transition-all shadow-sm group active:scale-[0.98]"
                 >
                     PORTFOLIO <ArrowUpRight className="w-3.5 h-3.5 text-white/70 group-hover:text-white transition-colors" />
                 </button>
             )}
             {isSelectionMode ? (
                 // Selection Mode Header Content
                 <div className="flex items-center gap-3">
                     <div className="flex items-center gap-2 px-4 h-10 bg-rose-50 text-rose-700 rounded-full font-medium border border-rose-100 shadow-sm text-xs md:text-sm animate-in fade-in">
                        <Heart className="w-4 h-4 text-rose-600 fill-rose-600" />
                        <span>Selection Mode Active</span>
                     </div>
                 </div>
             ) : !isPortfolio ? (
                // Standard Mode Header Content
                <>
                    {/* Download All Button */}
                    <button
                        onClick={handleDownloadAll}
                        disabled={downloadingAll || files.length === 0}
                        className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 h-10 rounded-lg font-medium transition-all text-sm shadow-sm ${
                            isLocked 
                            ? 'bg-slate-50 border border-slate-200 text-slate-400 cursor-not-allowed' 
                            : downloadingAll 
                                ? 'bg-[#0f1423] border border-white/5 text-slate-400 cursor-wait opacity-80'
                                : 'bg-[#0f1423] border border-white/5 text-white hover:bg-[#161d30] hover:shadow-md active:scale-[0.98]'
                        }`}
                    >
                        {downloadingAll ? (
                            <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Preparing...</span>
                            </>
                        ) : (
                            <>
                                <FolderDown className="w-4 h-4 text-slate-200" />
                                <span>Download All</span>
                            </>
                        )}
                    </button>

                    {isLocked ? (
                        <div className="flex items-center gap-2 bg-amber-50 px-4 h-10 rounded-lg border border-amber-100 shadow-sm">
                            <div className="flex flex-col text-right justify-center">
                                <span className="text-slate-500 text-[9px] uppercase tracking-wider font-semibold leading-none mb-0.5">Balance Due</span>
                                <span className="font-bold text-amber-700 text-sm leading-none">{formatCurrency(balanceDue)}</span>
                            </div>
                            <Lock className="w-4 h-4 text-amber-600" />
                        </div>
                    ) : agreedAmount === 0 ? (
                        <div className="flex items-center gap-2.5 px-4 h-10 bg-[#f4f6ff] text-indigo-700 rounded-full font-medium border border-indigo-100 shadow-sm text-sm">
                            <Heart className="w-4 h-4 text-indigo-600" />
                            <span>Collaboration</span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2.5 px-4 h-10 bg-emerald-50 text-emerald-700 rounded-full font-medium border border-emerald-100 shadow-sm text-sm">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span>Paid in Full</span>
                        </div>
                    )}
                </>
             ) : null}
          </div>
        </div>
      </header>

      {/* Grid */}
      <main className={isHorizontalLayout ? "w-full overflow-hidden" : "max-w-[1600px] mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-10"}>
        {isSelectionMode && viewFilter === 'all' && (
            <div className="mb-6 p-4 bg-rose-50 border border-rose-100 rounded-lg flex items-start gap-3 md:hidden">
                <Heart className="w-5 h-5 text-rose-500 mt-0.5 shrink-0" />
                <p className="text-sm text-rose-800">
                    <strong>Selection Mode:</strong> Tap the heart icon to select your favorites. Downloads are disabled until selection is complete.
                </p>
            </div>
        )}

        {displayedFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                {viewFilter !== 'all' ? (
                    <>
                        <Heart className="w-16 h-16 text-slate-200 mb-4" />
                        <h3 className="text-lg font-semibold text-slate-600">No Photos Selected Yet</h3>
                        <p className="text-sm mb-6 max-w-xs text-center">Tap the heart icon on photos to add them to your selection.</p>
                        <button 
                            onClick={() => setViewFilter('all')}
                            className="text-rose-600 font-medium hover:underline"
                        >
                            Browse All Photos
                        </button>
                    </>
                ) : (
                    <>
                        <ImageIcon className="w-16 h-16 text-slate-200 mb-4" />
                        <p>No photos available.</p>
                    </>
                )}
            </div>
        ) : (
            <div 
                ref={isHorizontalLayout ? horizontalRef : undefined}
                className={isHorizontalLayout 
                    ? `flex overflow-x-auto snap-x snap-mandatory md:snap-proximity gap-2 md:gap-4 pb-8 pt-4 sm:pt-8 w-full items-center h-[calc(100vh-140px)] min-h-[500px] px-4 md:px-8 max-w-[2000px] mx-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${displayedFiles.length === 1 ? 'justify-center' : ''}`
                    : isPortfolio 
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4 lg:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500" 
                        : "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 lg:gap-6 xl:grid-cols-5 gap-2 md:gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500"
                }
            >
            {(() => {
                const selectedArray = Array.from(selectedFileIds);
                return displayedFiles.map((file, index) => {
                    const isSelected = selectedFileIds.has(file.id);
                    let isExtra = false;
                    if (isSelected && gallery?.selection_limit && gallery.selection_limit > 0) {
                        const selIndex = selectedArray.indexOf(file.id);
                        if (selIndex >= gallery.selection_limit) isExtra = true;
                    }
                    return (
                    <div 
                        key={file.id} 
                        onClick={() => setLightboxFile(file)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            if (!isPortfolio) {
                                 setShowScreenshotWarning(true);
                            }
                        }}
                        className={`group relative flex flex-col ${isFilmGallery ? 'flex-none w-auto h-full min-w-[300px] snap-center justify-center items-center' : isPortraitGallery ? 'flex-none h-full aspect-[4/5] snap-center bg-slate-50' : isPrintsGallery ? 'aspect-auto w-full block bg-white border border-slate-100 p-2 shadow-sm rounded-sm' : isPortfolio ? 'aspect-auto w-full block bg-slate-50 relative' : 'aspect-square bg-slate-100'} overflow-hidden break-inside-avoid cursor-pointer shadow-sm hover:shadow-md transition-shadow ${isSelectionMode && isSelected ? 'ring-4 ring-rose-500' : ''} content-vis-auto max-w-full`}
                        style={{ contentVisibility: 'auto', WebkitTouchCallout: 'none', userSelect: 'none' }}
                    >
                    {/* Badges */}
                    {isSelectionMode && isSelected && !isPortfolio && (
                        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 pointer-events-none">
                            <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">SELECTED</span>
                            {isExtra && <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">EXTRA</span>}
                        </div>
                    )}
                    {file.file_type === 'image' && !file.file_url?.match(/\.(mp4|mov|webm|ogg)$/i) ? (
                    isPortfolio ? (
                        <img 
                            src={getOptimizedImageUrl(file.thumbnail_url || file.file_url, isPortraitGallery ? 1200 : 800, isPortraitGallery ? 1500 : 1000, 75)}
                            alt="Portfolio item" 
                            className={`w-full object-cover block transform transition-transform duration-[1.5s] pointer-events-none will-change-transform ${isPrintsGallery ? 'h-auto' : 'h-full'} ${isPortraitGallery ? '' : 'md:group-hover:scale-[1.02]'}`}
                            loading={index < 4 ? "eager" : "lazy"}
                            decoding="async"
                            // @ts-ignore
                            fetchPriority={index < 4 ? "high" : "auto"}
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (!target.dataset.retried) {
                                    target.dataset.retried = 'true';
                                    target.src = rewriteUrlToR2(file.thumbnail_url || file.file_url) || '';
                                }
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                        />
                    ) : (
                        <>
                            <img 
                                src={getOptimizedImageUrl(file.thumbnail_url || file.file_url, 400, 400, 30)}
                                srcSet={`
                                    ${getOptimizedImageUrl(file.thumbnail_url || file.file_url, 150, 150, 25)} 150w,
                                    ${getOptimizedImageUrl(file.thumbnail_url || file.file_url, 300, 300, 30)} 300w,
                                    ${getOptimizedImageUrl(file.thumbnail_url || file.file_url, 600, 600, 40)} 600w,
                                    ${getOptimizedImageUrl(file.thumbnail_url || file.file_url, 900, 900, 50)} 900w
                                `}
                                sizes="(max-width: 640px) 48vw, (max-width: 1024px) 32vw, 24vw"
                                alt="Gallery item" 
                                className="w-full h-full block object-cover transition-transform duration-500 md:group-hover:scale-105 pointer-events-none will-change-transform"
                                loading={index < 8 ? "eager" : "lazy"}
                                decoding="async"
                                // @ts-ignore
                                fetchPriority={index < 8 ? "high" : "auto"}
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.removeAttribute('srcset');
                                    target.removeAttribute('sizes');
                                    if (!target.dataset.retried) {
                                        target.dataset.retried = 'true';
                                        target.src = rewriteUrlToR2(file.thumbnail_url || file.file_url) || '';
                                    }
                                }}
                                onContextMenu={(e) => e.preventDefault()}
                            />
                            {isLocked && !isPortfolio && (
                                <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none opacity-[0.15] mix-blend-overlay">
                                    <div className="transform -rotate-45 text-white font-black text-2xl md:text-3xl tracking-[0.2em] whitespace-nowrap drop-shadow-md select-none">
                                        PREVIEW ONLY 
                                    </div>
                                </div>
                            )}
                            <div className="absolute inset-0 z-[5]" 
                                 onContextMenu={(e) => {
                                     e.preventDefault();
                                     if (!isPortfolio) {
                                         setShowScreenshotWarning(true);
                                     }
                                 }}
                                 onDragStart={(e) => e.preventDefault()}
                            />
                        </>
                    )
                ) : (
                    <video 
                        src={rewriteUrlToR2(file.file_url)} 
                        className={`block transform transition-transform duration-[1.5s] ${isFilmGallery ? 'w-auto h-full max-w-[90vw] object-contain mx-auto' : 'w-full h-full object-cover'} ${isHorizontalLayout ? '' : 'md:group-hover:scale-[1.02]'} ${isFilmGallery ? '' : isPortfolio ? 'pointer-events-none' : ''}`} 
                        controls={isFilmGallery || !isPortfolio} 
                        controlsList="nodownload" 
                        preload="metadata"
                        autoPlay={isPortfolio && !isFilmGallery}
                        muted={isPortfolio && !isFilmGallery}
                        loop={isPortfolio}
                        playsInline={isPortfolio}
                        onContextMenu={(e) => e.preventDefault()}
                    />
                )}
                
                {/* Desktop Hover Overlay */}
                <div className={`hidden md:flex absolute inset-0 z-10 ${isPortfolio ? 'bg-black/10' : 'bg-black/40'} opacity-0 group-hover:opacity-100 transition-opacity items-center justify-center gap-3 pointer-events-none`}>
                    {isSelectionMode ? (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleSelection(file);
                            }}
                            className={`pointer-events-auto p-3 rounded-full shadow-lg transform transition-all hover:scale-110 ${isSelected ? 'bg-rose-500 text-white' : 'bg-white text-slate-400 hover:text-rose-500'}`}
                            disabled={selectionSubmitted}
                        >
                            <Heart className={`w-5 h-5 ${isSelected ? 'fill-current' : ''}`} />
                        </button>
                    ) : !isPortfolio && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(file);
                            }}
                            disabled={downloadingId === file.id}
                            className="pointer-events-auto bg-white/95 hover:bg-white text-slate-900 px-4 py-2 rounded-full font-medium flex items-center gap-2 transform translate-y-4 group-hover:translate-y-0 transition-all shadow-lg text-sm disabled:opacity-75 disabled:cursor-wait"
                        >
                            {downloadingId === file.id ? <Loader2 className="w-3 h-3 animate-spin" /> : isLocked ? <Lock className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                            <span>{downloadingId === file.id ? 'Loading...' : (isLocked ? 'Locked' : 'Download')}</span>
                        </button>
                    )}
                </div>

                {/* Mobile Actions */}
                <div className="md:hidden absolute bottom-2 right-2 flex gap-2 z-10">
                    {isSelectionMode && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleSelection(file);
                            }}
                            disabled={selectionSubmitted}
                            className={`p-3 rounded-full shadow-md backdrop-blur-sm transition-all active:scale-95 border border-white/20 ${isSelected ? 'bg-rose-500 text-white' : 'bg-white/90 text-slate-400'}`}
                        >
                            <Heart className={`w-5 h-5 ${isSelected ? 'fill-current' : ''}`} />
                        </button>
                    )}
                    {!isSelectionMode && !isPortfolio && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(file);
                            }}
                            disabled={downloadingId === file.id}
                            className={`p-3 rounded-full shadow-md backdrop-blur-sm transition-all active:scale-95 border border-white/20
                                ${isLocked 
                                    ? 'bg-amber-100/90 text-amber-700' 
                                    : 'bg-white/90 text-slate-900'
                                }`}
                        >
                            {downloadingId === file.id ? <Loader2 className="w-5 h-5 animate-spin" /> : isLocked ? <Lock className="w-5 h-5" /> : <Download className="w-5 h-5" />}
                        </button>
                    )}
                </div>
                
                {/* Print Details Banner */}
                {(file.title?.trim() || (file.description ?? file.caption)?.trim() || file.print_size?.trim() || file.material?.trim() || file.price?.trim()) ? (
                    <div className={`px-2 py-4 flex flex-col gap-1 border-t mt-2 w-full ${isPrintsGallery ? 'bg-white border-slate-100' : 'bg-transparent border-slate-200'}`}>
                        {file.title?.trim() && <h3 className="font-serif text-lg font-medium text-slate-900">{file.title}</h3>}
                        {(file.description ?? file.caption)?.trim() && (
                            <p className="text-sm text-slate-600 leading-relaxed italic">
                                {file.description ?? file.caption}
                            </p>
                        )}
                        {(file.print_size?.trim() || file.material?.trim()) && (
                            <div className="text-xs text-slate-500 uppercase tracking-widest mt-2 flex flex-wrap items-center gap-2">
                                {file.print_size?.trim() && <span>{file.print_size}</span>}
                                {file.print_size?.trim() && file.material?.trim() && <span className="opacity-50">|</span>}
                                {file.material?.trim() && <span>{file.material}</span>}
                            </div>
                        )}
                        {file.price?.trim() && (
                            <p className="text-md font-bold text-amber-700 mt-1">{file.price}</p>
                        )}
                    </div>
                ) : null}
                </div>
                );
            })
            })()}
            </div>
        )}
      </main>

      {/* Selection Mode Bottom Bar */}
      {isSelectionMode && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] p-4 z-30">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4 w-full sm:w-auto">
                    <div 
                        className="flex items-center gap-2 cursor-pointer group"
                        onClick={() => setViewFilter(viewFilter === 'all' ? 'selected' : 'all')}
                    >
                        <div className={`p-2 rounded-full transition-colors ${viewFilter !== 'all' ? 'bg-rose-500 text-white' : 'bg-rose-100 text-rose-600'}`}>
                            <Heart className={`w-5 h-5 ${viewFilter !== 'all' ? 'fill-current' : ''}`} />
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 group-hover:text-rose-600 transition-colors flex items-center gap-2">
                                {selectedFileIds.size} Selected
                                {limit > 0 && selectedFileIds.size > limit && (
                                    <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold flex-shrink-0">
                                        {selectedFileIds.size - limit} Extras
                                    </span>
                                )}
                            </p>
                            <p className="text-xs text-slate-500 hidden sm:inline-block">
                                {viewFilter !== 'all' ? "Showing favorites" : "Tap heart to select"}
                            </p>
                        </div>
                    </div>
                </div>
                
                <div className="flex gap-2 w-full sm:w-auto overflow-x-auto [&::-webkit-scrollbar]:hidden items-center pb-1 sm:pb-0">
                    <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-medium">
                        <button 
                            onClick={() => setViewFilter('all')}
                            className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap ${viewFilter === 'all' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            All
                        </button>
                        <button 
                            onClick={() => setViewFilter('selected')}
                            className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap flex items-center gap-1 ${viewFilter === 'selected' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-500 hover:text-rose-600'}`}
                        >
                            <Heart className="w-3 h-3" />
                            Selected
                        </button>
                        {limit > 0 && selectedFileIds.size > 0 && (
                            <>
                                <button 
                                    onClick={() => setViewFilter('main')}
                                    className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap ${viewFilter === 'main' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-500 hover:text-rose-600'}`}
                                >
                                    Main ({mainSelections.length})
                                </button>
                                <button 
                                    onClick={() => setViewFilter('extras')}
                                    className={`px-3 py-1.5 rounded-md transition-all whitespace-nowrap ${viewFilter === 'extras' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-500 hover:text-amber-600'}`}
                                >
                                    Extras ({extraSelections.length})
                                </button>
                            </>
                        )}
                    </div>

                    {selectionSubmitted ? (
                        <div className="flex gap-2 w-full sm:w-auto">
                            <div className="flex-1 sm:flex-none bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg font-medium border border-emerald-200 flex items-center justify-center gap-2 text-sm">
                                <CheckCircle2 className="w-5 h-5" />
                                <span>Submitted</span>
                            </div>
                            <button 
                                onClick={unsubmitSelection}
                                disabled={submittingSelection}
                                className="flex-1 sm:flex-none bg-white text-slate-700 px-4 py-2 rounded-lg font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                            >
                                {submittingSelection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit2 className="w-4 h-4" />}
                                <span>Edit Selection</span>
                            </button>
                        </div>
                    ) : (
                        <button 
                            onClick={submitSelection}
                            disabled={submittingSelection || selectedFileIds.size === 0}
                            className="flex-1 sm:flex-none bg-slate-900 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                        >
                            {submittingSelection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            <span>Submit Selection</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className={`px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium ${
                toast.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-white'
            }`}>
                {toast.type === 'success' ? <Heart className="w-4 h-4 fill-current" /> : <Heart className="w-4 h-4" />}
                {toast.message}
            </div>
        </div>
      )}

      {/* Welcome/Instructions Modal */}
      {showWelcomeModal && gallery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Heart className="w-6 h-6 text-rose-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Welcome to your Gallery</h3>
            <p className="text-slate-600 mb-6 text-sm">
              Please select your agreed number of <strong>{gallery?.selection_limit} photos</strong> first.
              <br/><br/>
              If you wish to select more than {gallery?.selection_limit}, you will be asked to confirm before selecting extras.
            </p>
            <div className="space-y-3">
                <button 
                    onClick={() => setShowWelcomeModal(false)}
                    className="w-full bg-slate-900 text-white py-2.5 rounded-lg font-medium hover:bg-slate-800 transition-colors"
                >
                    Get Started
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Modal */}
      {showPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Lock className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Downloads Locked</h3>
            <p className="text-slate-600 mb-6 text-sm">
              You have a remaining balance of <strong className="text-slate-900">{formatCurrency(balanceDue)}</strong>.
              <br/>
              <span className="text-xs text-slate-500 mt-2 block">(Agreed: {formatCurrency(agreedAmount)} - Paid: {formatCurrency(amountPaid)})</span>
            </p>
            <div className="space-y-3">
                <button 
                    onClick={() => setShowPayModal(false)}
                    className="w-full bg-slate-900 text-white py-2.5 rounded-lg font-medium hover:bg-slate-800 transition-colors"
                >
                    Close
                </button>
                <p className="text-xs text-slate-400">Contact your photographer to settle payment.</p>
            </div>
          </div>
        </div>
      )}

      {/* Download Progress Modal */}
      {downloadingAll && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl animate-in zoom-in-95">
                <div className="text-center mb-6">
                    <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 relative">
                        <Loader2 className="w-7 h-7 text-emerald-600 animate-spin" />
                        <div className="absolute inset-0 border-2 border-slate-200 rounded-full"></div>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">Preparing Download</h3>
                    <p className="text-sm text-slate-500 mt-1">{downloadStatusText}</p>
                </div>
                
                <div className="mb-6">
                    <div className="flex justify-between text-xs mb-2 font-medium">
                        <span className="text-slate-600">Progress</span>
                        <span className="text-emerald-600">{downloadProgress}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-emerald-500 transition-all duration-200 ease-out" 
                            style={{ width: `${downloadProgress}%` }}
                        ></div>
                    </div>
                    <p className="text-xs text-slate-400 mt-2 text-center">
                        Please do not close this window.
                    </p>
                </div>

                <button 
                    onClick={cancelDownloadAll}
                    className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 font-medium transition-colors text-sm"
                >
                    Cancel
                </button>
            </div>
        </div>
      )}

      {/* Screenshot Warning Modal */}
      {showScreenshotWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
            <div className="relative">
                <button 
                    onClick={() => setShowScreenshotWarning(false)}
                    className="absolute right-0 top-0 text-slate-400 hover:text-slate-600 p-3 -mt-2 -mr-2"
                >
                    <X className="w-6 h-6" />
                </button>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <ShieldAlert className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Screenshotting Not Allowed</h3>
                <p className="text-slate-600 mb-6 text-sm">
                  To protect the photographer's work, screenshots are disabled. 
                  <br/><br/>
                  {isSelectionMode ? (
                      <span className="font-medium text-rose-600">Downloads are currently disabled while Selection Mode is active. Please select your favorites first.</span>
                  ) : (
                      <span>Please {isLocked ? 'complete the payment' : 'use the download button'} to access high-quality versions of these images.</span>
                  )}
                </p>
                <button 
                    onClick={() => setShowScreenshotWarning(false)}
                    className="w-full bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                >
                    I Understand
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {lightboxFile && (
        <div 
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 backdrop-blur-sm p-4 animate-in fade-in duration-200"
            onClick={() => setLightboxFile(null)}
        >
            <button 
                onClick={(e) => {
                    e.stopPropagation();
                    setLightboxFile(null);
                }}
                className="absolute top-4 right-4 text-white/70 hover:text-white p-3 md:p-2 z-50 bg-black/50 rounded-full transition-colors"
            >
                <X className="w-6 h-6" />
            </button>
            
            <div 
                className="relative w-full h-full flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (!isPortfolio) {
                        setShowScreenshotWarning(true);
                    }
                }}
            >
                {lightboxFile.file_type === 'image' ? (
                    <div className="relative max-w-full max-h-full">
                        <img 
                            src={getOptimizedImageUrl(lightboxFile.thumbnail_url || lightboxFile.file_url, 1920, undefined, 85)}
                            alt="Gallery item preview" 
                            className="max-w-full max-h-full object-contain pointer-events-none drop-shadow-2xl"
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if (!isPortfolio) {
                                    setShowScreenshotWarning(true);
                                }
                            }}
                        />
                        {isLocked && !isPortfolio && (
                            <div className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none opacity-[0.15] mix-blend-overlay">
                                <div className="transform -rotate-45 text-white font-black text-4xl sm:text-6xl md:text-8xl tracking-[0.2em] whitespace-nowrap drop-shadow-lg select-none">
                                    PREVIEW ONLY • PREVIEW ONLY • PREVIEW ONLY
                                </div>
                            </div>
                        )}
                        {/* Protection overlay to catch right-clicks / drag-and-drops from extensions */}
                        <div className="absolute inset-0 z-10" 
                             onContextMenu={(e) => {
                                 e.preventDefault();
                                 if (!isPortfolio) {
                                     setShowScreenshotWarning(true);
                                 }
                             }} 
                             onDragStart={(e) => e.preventDefault()}
                        />
                    </div>
                ) : (
                    <video 
                        src={rewriteUrlToR2(lightboxFile.file_url)} 
                        className="max-w-full max-h-full object-contain" 
                        controls 
                        controlsList="nodownload"
                        autoPlay
                        playsInline
                    />
                )}
            </div>

            {/* Print Info in Lightbox */}
            {(lightboxFile.title?.trim() || (lightboxFile.description ?? lightboxFile.caption)?.trim() || lightboxFile.print_size?.trim() || lightboxFile.material?.trim() || lightboxFile.price?.trim()) ? (
                <div className="absolute bottom-6 left-6 right-6 sm:right-auto sm:max-w-md z-50 bg-black/60 backdrop-blur-md text-white p-5 rounded-lg border border-white/10 overflow-y-auto max-h-[40vh]">
                    {lightboxFile.title?.trim() && <h3 className="font-serif text-2xl font-medium mb-1 drop-shadow-sm">{lightboxFile.title}</h3>}
                    {(lightboxFile.description ?? lightboxFile.caption)?.trim() && (
                        <p className="text-sm text-slate-300 leading-relaxed mb-3 font-light">
                            {lightboxFile.description ?? lightboxFile.caption}
                        </p>
                    )}
                    {(lightboxFile.print_size?.trim() || lightboxFile.material?.trim()) && (
                        <div className="text-xs text-slate-400 uppercase tracking-widest mt-2 flex flex-wrap items-center gap-2">
                            {lightboxFile.print_size?.trim() && <span>{lightboxFile.print_size}</span>}
                            {lightboxFile.print_size?.trim() && lightboxFile.material?.trim() && <span className="opacity-50">|</span>}
                            {lightboxFile.material?.trim() && <span>{lightboxFile.material}</span>}
                        </div>
                    )}
                    {lightboxFile.price?.trim() && (
                        <p className="text-lg font-bold text-amber-500 mt-2">{lightboxFile.price}</p>
                    )}
                </div>
            ) : null}

            {/* Selection toggle or Download in lightbox */}
            <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-50 flex gap-4">
                {isSelectionMode ? (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleSelection(lightboxFile);
                        }}
                        disabled={selectionSubmitted}
                        className={`px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 font-medium transition-all ${
                            selectedFileIds.has(lightboxFile.id) 
                                ? 'bg-rose-500 text-white hover:bg-rose-600' 
                                : 'bg-white text-slate-900 hover:bg-slate-100'
                        }`}
                    >
                        <Heart className={`w-5 h-5 ${selectedFileIds.has(lightboxFile.id) ? 'fill-current' : ''}`} />
                        <span>{selectedFileIds.has(lightboxFile.id) ? 'Selected' : 'Select Photo'}</span>
                    </button>
                ) : !isPortfolio && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(lightboxFile);
                        }}
                        disabled={downloadingId === lightboxFile.id}
                        className="px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 font-medium transition-all bg-white text-slate-900 hover:bg-slate-100 disabled:opacity-75 disabled:cursor-wait"
                    >
                        {downloadingId === lightboxFile.id ? <Loader2 className="w-5 h-5 animate-spin" /> : isLocked ? <Lock className="w-5 h-5" /> : <Download className="w-5 h-5" />}
                        <span>{downloadingId === lightboxFile.id ? 'Downloading...' : (isLocked ? 'Locked' : 'Download Photo')}</span>
                    </button>
                )}
            </div>
        </div>
      )}
    </div>
  );
};