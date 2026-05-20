import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Upload, Trash2, Save, ExternalLink, RefreshCw, Eye, Lock, Unlock, Download, DollarSign, Calculator, Check, Copy, Clock, Loader2, ArrowLeft, Heart, Filter, FileDown, Edit2, Star } from 'lucide-react';

import { supabase } from '../services/supabase';
import { Gallery, GalleryFile } from '../types';
import { formatCurrency, formatDate, getOptimizedImageUrl, rewriteUrlToR2 } from '../utils/formatters';
import { useUpload } from '../contexts/UploadContext';
import { useNavigate } from 'react-router-dom';

export const GalleryManager: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [clientSelections, setClientSelections] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Use Global Upload Context
  const { uploading, progress, activeGalleryId, uploadFiles } = useUpload();
  const isUploadingThisGallery = uploading && activeGalleryId === id;
  
  // Track previous uploading state to trigger refresh on completion
  const prevUploadingRef = useRef(uploading);

  // Edit states
  const [agreedAmount, setAgreedAmount] = useState<number>(0);
  const [paid, setPaid] = useState<number>(0);
  const [paymentUpdated, setPaymentUpdated] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [editClientName, setEditClientName] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  
  // UI States
  const [viewFilter, setViewFilter] = useState<'all' | 'selected' | 'main' | 'extras'>('all');

  // Expiration settings (in hours)
  const [expiryHours, setExpiryHours] = useState<number>(24);
  const [isDragging, setIsDragging] = useState(false);

  // Load preference specific to this gallery ID
  useEffect(() => {
    if (!id) return;
    try {
        const key = `gallery_expiry_${id}`;
        const saved = localStorage.getItem(key);
        if (saved) {
            setExpiryHours(parseFloat(saved));
        } else {
            setExpiryHours(24);
        }
    } catch {
        setExpiryHours(24);
    }
  }, [id]);

  // Save preference specific to this gallery ID when it changes
  useEffect(() => {
    if (!id) return;
    const key = `gallery_expiry_${id}`;
    localStorage.setItem(key, expiryHours.toString());
  }, [expiryHours, id]);

  useEffect(() => {
    if (id) fetchGalleryData();
  }, [id]);

  // Effect to refresh data when global upload finishes
  useEffect(() => {
    const wasUploading = prevUploadingRef.current;
    if (wasUploading && !uploading) {
        fetchGalleryData();
    }
    prevUploadingRef.current = uploading;
  }, [uploading]);

  const fetchGalleryData = async () => {
    if (!id) return;
    
    // Check if new Print columns exist
    const { error: schemaErr } = await supabase.from('files').select('price').limit(1);
    if (schemaErr && schemaErr.message.includes('column')) {
        setSchemaMissing(true);
    } else {
        setSchemaMissing(false);
    }
    
    // Get Gallery
    const { data: galData, error: galError } = await supabase
      .from('galleries')
      .select('*')
      .eq('id', id)
      .single();
    
    if (galError) {
      console.error(galError);
      return;
    }
    
    setGallery(galData);
    setAgreedAmount(galData.agreed_balance);
    setPaid(galData.amount_paid);
    setEditClientName(galData.client_name);
    setEditTitle(galData.title);
    setEditCategory(galData.category || '');

    // Get Files
    let allFiles: GalleryFile[] = [];
    let hasMore = true;
    let offset = 0;
    const limit = 1000;
    
    while (hasMore) {
      const { data: fileData, error: fileError } = await supabase
        .from('files')
        .select('*')
        .eq('gallery_id', id)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
        
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

    setFiles(allFiles);

    // Get Selections - Always fetch these so the photographer can see them even if they disabled the mode
    const { data: selectionData } = await supabase
        .from('selections')
        .select('file_id')
        .eq('gallery_id', id)
        .order('created_at', { ascending: true }); // Important for counting extras
    
    if (selectionData) {
        setClientSelections(selectionData.map(s => s.file_id));
    }
  };

  const isPortfolio = Boolean(gallery?.category && gallery.category.trim() !== '');

  const filterDuplicateFiles = (fileList: FileList) => {
    const sanitizeName = (name: string) => name.replace(/[^a-zA-Z0-9.\_-]/g, "_");
    const newFiles: File[] = [];
    const duplicateFiles: string[] = [];

    Array.from(fileList).forEach(f => {
        const sanitized = sanitizeName(f.name);
        // Compare with existing file names
        const isDuplicate = files.some(existingFile => {
            const existingName = existingFile.file_path.split('/').pop();
            return existingName === sanitized;
        });
        
        if (isDuplicate) {
            duplicateFiles.push(f.name);
        } else {
            newFiles.push(f);
        }
    });

    if (duplicateFiles.length > 0) {
        if (newFiles.length === 0) {
            alert("All selected files have already been uploaded.");
        } else {
            alert(`${duplicateFiles.length} file(s) are already uploaded and will be skipped.`);
        }
    }
    
    return newFiles;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0 || !gallery) return;

    const filesToUpload = filterDuplicateFiles(fileList);
    if (filesToUpload.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
    }
    
    // Use Context
    await uploadFiles(gallery.id, filesToUpload, isPortfolio ? 876000 : expiryHours);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
        setIsDragging(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    
    const fileList = event.dataTransfer.files;
    if (!fileList || fileList.length === 0 || !gallery) return;

    const filesToUpload = filterDuplicateFiles(fileList);
    if (filesToUpload.length === 0) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
    }
    
    // Use Context
    await uploadFiles(gallery.id, filesToUpload, isPortfolio ? 876000 : expiryHours);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExtendExpiration = async () => {
    if (!gallery || files.length === 0) return;
    
    // Calculate readable expiration time for confirmation
    const newExpiry = new Date();
    newExpiry.setTime(newExpiry.getTime() + expiryHours * 60 * 60 * 1000);
    const formattedTime = newExpiry.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

    const confirmMessage = `Are you sure you want to update the expiration for all ${files.length} files?\n\nThey will be set to expire in ${expiryHours} hours from now (approx ${formattedTime}).\n\nThis will reactivate any currently expired files.`;
    
    if (!window.confirm(confirmMessage)) return;

    try {
      const { error } = await supabase
        .from('files')
        .update({ expires_at: newExpiry.toISOString() })
        .eq('gallery_id', gallery.id);
        
      if (error) throw error;
      
      // Log activity
      await supabase.from('activity_logs').insert({
        gallery_id: gallery.id,
        action: `Extended expiration for ${files.length} files by ${expiryHours} hours`
      });

      await fetchGalleryData();
      alert("Files updated successfully! The link is active again.");
    } catch (error) {
      console.error('Error updating expiration:', error);
      alert('Failed to update expiration.');
    }
  };

  const updatePayment = async () => {
    if (!gallery) return;
    
    try {
      const { error } = await supabase
        .from('galleries')
        .update({ agreed_balance: agreedAmount, amount_paid: paid })
        .eq('id', gallery.id);
      
      if (error) throw error;

      // Log activity
      await supabase.from('activity_logs').insert({
        gallery_id: gallery.id,
        action: `Payment updated: Agreed ${agreedAmount}, Paid ${paid}`
      });

      setPaymentUpdated(true);
      setTimeout(() => setPaymentUpdated(false), 3000);
      
      fetchGalleryData();
    } catch (error) {
      console.error('Error updating payment:', error);
      alert('Failed to update payment.');
    }
  };

  const updateMeta = async () => {
    if (!gallery) return;
    try {
      const { error } = await supabase
        .from('galleries')
        .update({ client_name: editClientName, title: editTitle, category: editCategory })
        .eq('id', gallery.id);
      
      if (error) throw error;

      await supabase.from('activity_logs').insert({
        gallery_id: gallery.id,
        action: `Updated gallery details`
      });

      setIsEditingMeta(false);
      fetchGalleryData();
    } catch (error) {
      console.error('Error updating metadata:', error);
      alert('Failed to update details.');
    }
  };

  const updateFileDetails = async (fileId: string, updates: Partial<GalleryFile>) => {
    try {
      const { error } = await supabase
        .from('files')
        .update(updates)
        .eq('id', fileId);
        
      if (error) throw error;
      
      setFiles(files.map(f => f.id === fileId ? { ...f, ...updates } : f));
    } catch (error: any) {
      console.error('Error updating file details:', error);
      alert('Failed to update details. You might need to update your database schema in Supabase SQL Editor. Error: ' + (error?.message || ''));
    }
  };

  const toggleStatus = async () => {
    if (!gallery) return;

    try {
      const newStatus = !gallery.link_enabled;
      
      const updatePayload: any = { link_enabled: newStatus };
      
      if (newStatus && gallery.selection_status === 'submitted') {
          if (window.confirm("The client has already submitted their selection. Do you also want to reopen the selection allowing them to edit/add their selections?")) {
              updatePayload.selection_status = 'pending';
          }
      }
      
      const { error } = await supabase
        .from('galleries')
        .update(updatePayload)
        .eq('id', gallery.id);
      
      if (error) throw error;
      
      setGallery({ ...gallery, ...updatePayload });
    } catch (error: any) {
      console.error('Error toggling status:', error);
      alert('Failed to update gallery status: ' + (error?.message || JSON.stringify(error)));
    }
  };

  const toggleSelectionMode = async () => {
      if (!gallery) return;
      
      try {
          const newStatus = !gallery.selection_enabled;
          const { error } = await supabase
            .from('galleries')
            .update({ selection_enabled: newStatus })
            .eq('id', gallery.id);
            
          if (error) throw error;
            
          setGallery({ ...gallery, selection_enabled: newStatus });
          // Note: We don't need to fetch selections here anymore because we fetch them unconditionally on load
      } catch (error: any) {
          console.error('Error toggling selection mode:', error);
          alert('Failed to update selection mode: ' + (error?.message || JSON.stringify(error)));
      }
  };

  const updateSelectionLimit = async (limit: number) => {
      if (!gallery) return;
      try {
          const { error } = await supabase
            .from('galleries')
            .update({ selection_limit: limit })
            .eq('id', gallery.id);
          if (error) throw error;
          setGallery({ ...gallery, selection_limit: limit });
      } catch (error: any) {
          console.error('Error updating selection limit:', error);
          alert('Failed to update: ' + (error?.message || 'Database column selection_limit might be missing.'));
      }
  };

  const handleToggleEdited = async (fileId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('files')
        .update({ is_edited: !currentStatus })
        .eq('id', fileId);
        
      if (error) throw error;
      
      // Update local state
      setFiles(files.map(f => f.id === fileId ? { ...f, is_edited: !currentStatus } : f));
    } catch (error: any) {
      console.error('Error toggling edited status:', error);
      alert('Failed to update edited status: ' + (error?.message || JSON.stringify(error)));
    }
  };

  const handleSetCover = async (fileId: string) => {
    if (!gallery) return;
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('files')
        .update({ created_at: now })
        .eq('id', fileId);
        
      if (error) throw error;
      
      const updatedFiles = files.map(f => f.id === fileId ? { ...f, created_at: now } : f);
      // Sort in descending order to match database sort
      updatedFiles.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      setFiles(updatedFiles);
    } catch (error: any) {
      console.error('Error setting cover:', error);
      alert(`Database Error: ${error.message || 'Error setting cover'}`);
    }
  };


  const handleExportCSV = () => {
    if (!files || files.length === 0) return;
    if (clientSelections.length === 0) {
        alert('No photos selected yet.');
        return;
    }
    
    const selectedFiles = files.filter(f => clientSelections.includes(f.id));
    
    // Create CSV content definition
    const rows = [
      ["File Name", "Uploaded At", "Status", "Edited"],
      ...selectedFiles.map(f => [
        f.file_path.split('/').pop() || 'unknown',
        new Date(f.created_at).toLocaleString(),
        "Selected",
        f.is_edited ? "Yes" : "No"
      ])
    ];

    const csvContent = rows.map(row => 
      row.map(item => `"${String(item).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    
    // Create downloaded blob
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${gallery?.client_name || 'gallery'}_selections.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopyLink = async () => {
    if (!gallery) return;
    const url = `${window.location.origin}/#/g/${gallery.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const deleteFile = async (fileId: string, filePath: string) => {
    if (!confirm('Delete this file permanently?')) return;

    try {
      // Delete from storage
      await fetch('/api/delete-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      });
      // Delete from DB
      await supabase.from('files').delete().eq('id', fileId);
      
      setFiles(files.filter(f => f.id !== fileId));
    } catch (error) {
      console.error(error);
    }
  };

  if (!gallery) return <div className="p-8">Loading...</div>;

  const remainingBalance = Math.max(0, agreedAmount - paid);
  const isVolunteer = agreedAmount === 0;

  const limit = gallery?.selection_limit || 0;
  const mainSelections = limit > 0 ? clientSelections.slice(0, limit) : clientSelections;
  const extraSelections = limit > 0 ? clientSelections.slice(limit) : [];

  let visibleFiles = files;
  if (viewFilter === 'selected') visibleFiles = files.filter(f => clientSelections.includes(f.id));
  if (viewFilter === 'main') visibleFiles = files.filter(f => mainSelections.includes(f.id));
  if (viewFilter === 'extras') visibleFiles = files.filter(f => extraSelections.includes(f.id));

  return (
    <div className="space-y-6 md:space-y-8 pb-10">
      {schemaMissing && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded text-red-700">
          <h3 className="font-bold text-lg">Database Schema Update Required</h3>
          <p className="mt-1">
             The prints features cannot be saved correctly because some database columns are missing.
             To fix this, please run the following SQL command in your <strong>Supabase SQL Editor</strong>:
          </p>
          <pre className="bg-red-100 p-3 rounded mt-2 text-[10px] sm:text-xs font-mono text-red-900 border border-red-200 overflow-x-auto whitespace-pre-wrap">
            ALTER TABLE public.files ADD COLUMN IF NOT EXISTS title text;{'\n'}
            ALTER TABLE public.files ADD COLUMN IF NOT EXISTS description text;{'\n'}
            ALTER TABLE public.files ADD COLUMN IF NOT EXISTS print_size text;{'\n'}
            ALTER TABLE public.files ADD COLUMN IF NOT EXISTS material text;{'\n'}
            ALTER TABLE public.files ADD COLUMN IF NOT EXISTS price text;{'\n'}
          </pre>
          <p className="mt-2 text-sm italic">After running this command, refresh this page so that the data saves successfully.</p>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col gap-4">
        {/* Back Button (Mobile only) */}
        <button onClick={() => navigate('/dashboard')} className="md:hidden flex items-center text-slate-500 hover:text-slate-900 mb-2 py-2 -ml-2 px-2">
            <ArrowLeft className="w-5 h-5 mr-1" /> Back to Dashboard
        </button>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex-1">
                {isEditingMeta ? (
                    <div className="space-y-3 w-full max-w-xl">
                        <input
                            type="text"
                            value={editClientName}
                            onChange={(e) => setEditClientName(e.target.value)}
                            placeholder="Gallery Name / Client Name"
                            className="w-full text-2xl md:text-3xl font-bold text-slate-900 border-b border-slate-300 focus:border-slate-900 focus:outline-none bg-transparent pb-1"
                        />
                        <textarea
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Description or Subtitle (e.g., Print Details)"
                            rows={2}
                            className="w-full text-slate-600 border border-slate-200 rounded-md p-2 text-sm focus:border-slate-400 focus:outline-none resize-none"
                        />
                        <input
                            type="text"
                            list="gallery-category-options"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            placeholder="Category (e.g. Wedding, Portraits...)"
                            className="w-full text-slate-700 border border-slate-200 rounded-md p-2 text-sm focus:border-slate-400 focus:outline-none"
                        />
                        <datalist id="gallery-category-options">
                            {["Wedding", "Portraits", "Couples", "Commercial", "Events", "Maternity", "Boudoir", "Fine Art", "Prints"].map(cat => (
                                <option key={cat} value={cat} />
                            ))}
                        </datalist>
                        <div className="flex gap-2">
                            <button
                                onClick={updateMeta}
                                className="px-3 py-1 bg-slate-900 text-white rounded text-sm hover:bg-slate-800"
                            >
                                Save Details
                            </button>
                            <button
                                onClick={() => {
                                    setIsEditingMeta(false);
                                    setEditClientName(gallery.client_name);
                                    setEditTitle(gallery.title);
                                    setEditCategory(gallery.category || '');
                                }}
                                className="px-3 py-1 bg-slate-100 text-slate-600 rounded text-sm hover:bg-slate-200"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="group flex items-start gap-3">
                        <div>
                            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 break-words flex items-center gap-3">
                                {gallery.client_name}
                                {gallery.category && (
                                    <span className="text-xs font-bold tracking-widest uppercase bg-slate-100 text-slate-500 px-2 py-1 rounded">
                                        {gallery.category}
                                    </span>
                                )}
                            </h1>
                            {gallery.title && gallery.title !== `${gallery.client_name}'s Gallery` && (
                                <p className="text-slate-600 mt-1 max-w-2xl">{gallery.title}</p>
                            )}
                            <p className="text-slate-500 text-sm mt-1">ID: <span className="font-mono">{gallery.id.slice(0, 8)}...</span></p>
                        </div>
                        <button
                            onClick={() => setIsEditingMeta(true)}
                            className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-md opacity-0 group-hover:opacity-100 transition-all mt-1"
                            title="Edit Details"
                        >
                            <Edit2 className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
                <button
                onClick={handleCopyLink}
                className="flex-1 md:flex-none justify-center px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 flex items-center gap-2 transition-all active:scale-95 text-sm font-medium shadow-sm"
                >
                {linkCopied ? (
                    <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                    </>
                ) : (
                    <>
                    <Copy className="w-4 h-4" />
                    <span className="hidden sm:inline">Copy Link</span>
                    <span className="inline sm:hidden">Copy</span>
                    </>
                )}
                </button>
                
                <a 
                href={`/#/g/${gallery.id}`}
                target="_blank" 
                rel="noreferrer"
                className={`flex-1 md:flex-none justify-center px-4 py-2 border rounded-lg flex items-center gap-2 text-sm font-medium shadow-sm transition-colors whitespace-nowrap ${
                  isPortfolio 
                    ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700' 
                    : 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
                }`}
                >
                    <Eye className="w-4 h-4" />
                    <span className="hidden sm:inline">{isPortfolio ? "Public View" : "Client Preview"}</span>
                    <span className="inline sm:hidden">{isPortfolio ? "View" : "Preview"}</span>
                </a>
                
                <button
                onClick={toggleStatus}
                className={`flex-1 md:flex-none justify-center px-4 py-2 rounded-lg flex items-center gap-2 text-white transition-colors text-sm font-medium shadow-sm ${
                    gallery.link_enabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-500 hover:bg-red-600'
                }`}
                >
                {gallery.link_enabled ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                <span>{gallery.link_enabled ? 'Active' : 'Disabled'}</span>
                </button>
            </div>
        </div>
      </div>
      
      {/* Notifications Area */}
      {!isPortfolio && gallery.selection_status === 'submitted' && (
          <div className="bg-rose-50 border border-rose-200 p-4 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                  <div className="bg-rose-100 p-2 rounded-full">
                      <Heart className="w-5 h-5 text-rose-600" />
                  </div>
                  <div>
                      <p className="font-semibold text-rose-900">Client Selection Submitted</p>
                      <p className="text-sm text-rose-700">The client has finished selecting {clientSelections.length} photos.</p>
                  </div>
              </div>
              <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      setViewFilter('selected');
                      document.getElementById('gallery-content')?.scrollIntoView({ behavior: 'smooth' });
                    }}
                    className="text-sm font-medium text-rose-700 hover:text-rose-900 underline"
                  >
                      View Selection
                  </button>
                  <button 
                    onClick={async () => {
                      if (!confirm("Are you sure you want to reopen the selection? This will allow the client to select photos again, and will reactivate the link.")) return;
                      try {
                        const { error } = await supabase
                          .from('galleries')
                          .update({ selection_status: 'pending', link_enabled: true })
                          .eq('id', gallery.id);
                        if (error) throw error;
                        setGallery({ ...gallery, selection_status: 'pending', link_enabled: true });
                        alert("Selection reopened! The link is active again.");
                      } catch (err: any) {
                        alert("Error reopening selection: " + (err?.message || JSON.stringify(err)));
                      }
                    }}
                    className="text-sm font-medium text-slate-500 hover:text-slate-700 underline"
                  >
                      Reopen Selection
                  </button>
              </div>
          </div>
      )}

      <div className={`grid grid-cols-1 ${!isPortfolio ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-6 md:gap-8`}>
        {/* Left Column: Settings */}
        {!isPortfolio ? (
            <div className="lg:col-span-1 space-y-6">
              {/* Payment Card */}
              <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-slate-500" />
                  Payment & Access
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                        Total Agreed Amount
                        <span className="text-xs font-normal text-slate-400 ml-2">(Set 0 for volunteer)</span>
                    </label>
                    <div className="relative">
                        <span className="absolute left-3 top-2 text-slate-400">KES</span>
                        <input 
                        type="number" 
                        value={agreedAmount}
                        onChange={(e) => setAgreedAmount(Number(e.target.value))}
                        className="w-full pl-12 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        placeholder="Total amount"
                        />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Amount Paid</label>
                    <div className="relative">
                        <span className="absolute left-3 top-2 text-slate-400">KES</span>
                        <input 
                        type="number" 
                        value={paid}
                        onChange={(e) => setPaid(Number(e.target.value))}
                        className="w-full pl-12 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none"
                        placeholder="Amount received"
                        />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Remaining Balance</label>
                    <div className="relative bg-slate-50 rounded-lg">
                        <span className="absolute left-3 top-2 text-slate-400">KES</span>
                        <input 
                        type="text" 
                        value={formatCurrency(remainingBalance).replace('KES', '').trim()}
                        disabled
                        className="w-full pl-12 pr-4 py-2 border border-slate-300 bg-slate-100 text-slate-500 rounded-lg outline-none cursor-not-allowed"
                        />
                        <div className="absolute right-3 top-2.5">
                          <Calculator className="w-4 h-4 text-slate-400" />
                        </div>
                    </div>
                  </div>
                  
                  <div className={`p-3 rounded-lg text-sm flex items-center justify-between ${
                    isVolunteer 
                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' 
                        : remainingBalance <= 0 
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' 
                            : 'bg-amber-50 text-amber-700 border border-amber-100'
                  }`}>
                    <span className="font-medium">
                        {isVolunteer ? 'Volunteer / Collaboration' : (remainingBalance <= 0 ? 'Fully Paid' : 'Outstanding Balance')}
                    </span>
                    {isVolunteer ? <Heart className="w-4 h-4" /> : (remainingBalance <= 0 ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />)}
                  </div>

                  <button 
                    onClick={updatePayment}
                    disabled={paymentUpdated}
                    className={`w-full py-2.5 rounded-lg flex justify-center items-center gap-2 transition-all duration-200 font-medium ${
                      paymentUpdated 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                  >
                    {paymentUpdated ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Updated!</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        <span>Update Payment</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Settings Card */}
              <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-slate-200">
                 <h2 className="text-lg font-semibold mb-4">Gallery Settings</h2>
                 
                 {/* Selection Mode Toggle */}
                 <div className="flex items-center justify-between mb-2">
                     <div>
                         <p className="font-medium text-slate-900">Client Selection</p>
                         <p className="text-xs text-slate-500 max-w-[200px]">
                             When enabled, clients can favorite photos but <strong>cannot download them</strong>.
                         </p>
                     </div>
                     <button
                        onClick={toggleSelectionMode}
                        className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${gallery.selection_enabled ? 'bg-rose-500' : 'bg-slate-300'}`}
                     >
                         <div className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${gallery.selection_enabled ? 'translate-x-5' : ''}`}></div>
                     </button>
                 </div>
                 {gallery.selection_enabled && (
                     <div className="mt-4 pt-4 border-t border-slate-100">
                         <label className="block text-sm text-slate-700 font-medium mb-1">Agreed Number of Photos</label>
                         <div className="flex gap-2">
                             <input 
                                 type="number" 
                                 className="w-full text-sm p-2 border border-slate-200 rounded-md bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-rose-500"
                                 defaultValue={gallery.selection_limit || 0}
                                 min="0"
                                 onBlur={(e) => {
                                     const val = parseInt(e.target.value);
                                     if (!isNaN(val) && val !== gallery.selection_limit) {
                                         updateSelectionLimit(val);
                                     }
                                 }}
                             />
                         </div>
                         <p className="text-xs text-slate-500 mt-1">Set to 0 for unlimited. If greater than 0, clients will be asked to confirm before selecting more (extras).</p>
                     </div>
                 )}
              </div>

              {/* Stats Card */}
              <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold mb-4">Gallery Stats</h2>
                <div className="space-y-3 text-sm text-slate-600 mb-4">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        <span>Total Files</span>
                        <span className="font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded-full">{files.length}</span>
                    </div>
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                        <span>Selected by Client</span>
                        <div className="flex items-center gap-2">
                            {gallery.selection_limit && gallery.selection_limit > 0 && clientSelections.length > gallery.selection_limit && (
                                <span className="font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full text-[10px] hidden sm:inline">
                                    {clientSelections.length - gallery.selection_limit} Extras
                                </span>
                            )}
                            <span className="font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full">{clientSelections.length}</span>
                        </div>
                    </div>
                    <div className="flex justify-between items-center">
                        <span>Total Downloads</span>
                        <span className="font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded-full">{files.reduce((acc, curr) => acc + curr.download_count, 0)}</span>
                    </div>
                </div>
                
                {clientSelections.length > 0 && (
                  <button 
                    onClick={handleExportCSV}
                    className="w-full py-2.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex justify-center items-center gap-2 transition-colors font-medium text-sm mt-4"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>Export Selections (CSV)</span>
                  </button>
                )}
              </div>
            </div>
        ) : (
            <div className="lg:col-span-1 space-y-6">
              {/* Portfolio Detail Card */}
              <div className="bg-slate-900 text-white p-6 rounded-xl shadow-md border border-slate-800">
                <h2 className="text-lg font-semibold mb-4">Portfolio Details</h2>
                <div className="space-y-4 text-sm text-slate-300">
                    <div>
                        <span className="block text-xs uppercase tracking-wider text-slate-500 mb-1">Category</span>
                        <span className="font-medium text-white px-3 py-1 bg-slate-800 rounded-lg border border-slate-700">{gallery.category}</span>
                    </div>
                    <div>
                        <span className="block text-xs uppercase tracking-wider text-slate-500 mb-1 text-left">Visibility</span>
                        <span className="font-medium text-emerald-400 flex items-center gap-2">
                            <Eye className="w-4 h-4" /> Visible on Public Site
                        </span>
                    </div>
                </div>
              </div>

              {/* Stats Card */}
              <div className="bg-white p-5 md:p-6 rounded-xl shadow-sm border border-slate-200">
                <h2 className="text-lg font-semibold mb-4">Collection Stats</h2>
                <div className="space-y-3 text-sm text-slate-600 mb-4">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span>Total Items</span>
                        <span className="font-medium text-slate-900 bg-slate-100 px-2 py-0.5 rounded-full">{files.length}</span>
                    </div>
                </div>
                <p className="text-xs text-slate-500 mt-4 leading-relaxed">
                    Portfolio collections are public indefinitely. You don't need to set an expiration time for these items.
                </p>
              </div>
            </div>
        )}

        {/* Right Column: Content */}
        <div className={!isPortfolio ? "lg:col-span-2" : "lg:col-span-3"} id="gallery-content">
            <div 
                className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-colors relative ${
                    isDragging ? 'border-emerald-500 bg-emerald-50/30 border-2 border-dashed' : 'border-slate-200'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {isDragging && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-emerald-50/80 backdrop-blur-sm pointer-events-none">
                        <div className="flex flex-col items-center text-emerald-600">
                            <Upload className="w-12 h-12 mb-4 animate-bounce" />
                            <h3 className="text-xl font-bold">Drop files to upload</h3>
                            <p className="text-sm mt-2 opacity-80">Images and videos are supported</p>
                        </div>
                    </div>
                )}
                <div className="p-4 md:p-6 border-b border-slate-200 flex flex-col md:flex-row justify-between md:items-center gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold">Gallery Content</h2>
                        {/* Filter Tabs */}
                        {!isPortfolio && (
                          <div className="bg-slate-100 p-1 rounded-lg flex text-xs font-medium flex-wrap gap-1">
                              <button 
                                  onClick={() => setViewFilter('all')}
                                  className={`px-3 py-1 rounded-md transition-all ${viewFilter === 'all' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                              >
                                  All ({files.length})
                              </button>
                              <button 
                                  onClick={() => setViewFilter('selected')}
                                  className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${viewFilter === 'selected' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-500 hover:text-rose-600'}`}
                              >
                                  <Heart className="w-3 h-3" />
                                  Selected ({clientSelections.length})
                              </button>
                              {gallery?.selection_limit && gallery.selection_limit > 0 && clientSelections.length > 0 && (
                                <>
                                  <button 
                                      onClick={() => setViewFilter('main')}
                                      className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${viewFilter === 'main' ? 'bg-white shadow-sm text-rose-600' : 'text-slate-500 hover:text-rose-600'}`}
                                  >
                                      Main ({mainSelections.length})
                                  </button>
                                  <button 
                                      onClick={() => setViewFilter('extras')}
                                      className={`px-3 py-1 rounded-md transition-all flex items-center gap-1 ${viewFilter === 'extras' ? 'bg-white shadow-sm text-amber-600' : 'text-slate-500 hover:text-amber-600'}`}
                                  >
                                      Extras ({extraSelections.length})
                                  </button>
                                </>
                              )}
                          </div>
                        )}
                    </div>

                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3">
                        {!isPortfolio && (
                            <>
                                <div className="flex items-center gap-2 bg-slate-50 px-3 py-2.5 rounded-lg border border-slate-200 flex-1 sm:flex-none">
                                   <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                                   <select 
                                     value={expiryHours}
                                     onChange={(e) => setExpiryHours(Number(e.target.value))}
                                     className="bg-transparent text-sm text-slate-700 outline-none cursor-pointer w-full sm:w-auto"
                                     title="Content Expiration"
                                     disabled={uploading}
                                   >
                                     <option value={0.5}>30 Minutes</option>
                                     <option value={1}>1 Hour</option>
                                     <option value={2}>2 Hours</option>
                                     <option value={3}>3 Hours</option>
                                     <option value={6}>6 Hours</option>
                                     <option value={12}>12 Hours</option>
                                     <option value={24}>24 Hours</option>
                                     <option value={48}>48 Hours</option>
                                     <option value={72}>3 Days</option>
                                     <option value={168}>1 Week</option>
                                   </select>

                                   {files.length > 0 && (
                                    <>
                                        <div className="w-px h-4 bg-slate-300 mx-1"></div>
                                        <button
                                            onClick={handleExtendExpiration}
                                            disabled={uploading}
                                            className="text-slate-400 hover:text-emerald-600 transition-colors p-2 md:p-1 rounded-md hover:bg-emerald-50"
                                            title="Apply this duration to all existing files (Reactivate expired)"
                                        >
                                            <RefreshCw className="w-5 h-5 md:w-4 md:h-4" />
                                        </button>
                                    </>
                                   )}
                                </div>
                                <div className="h-6 w-px bg-slate-300 hidden sm:block"></div>
                            </>
                        )}

                        <input
                            type="file"
                            multiple
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            className="hidden"
                            accept="image/*,video/*,.cr2,.cr3,.nef,.arw,.dng,.raf,.orf,.rw2,.srw,.raw"
                        />
                        
                        {isUploadingThisGallery ? (
                          <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200 flex-1 sm:flex-none">
                             <div className="flex flex-col w-full sm:w-32">
                                <div className="flex justify-between text-xs mb-1">
                                   <span className="text-slate-600 font-medium">Uploading...</span>
                                   <span className="text-emerald-600 font-bold">{progress}%</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                   <div 
                                      className="h-full bg-emerald-500 transition-all duration-300 ease-out"
                                      style={{ width: `${progress}%` }}
                                   />
                                </div>
                             </div>
                          </div>
                        ) : (
                          <button 
                              onClick={() => fileInputRef.current?.click()}
                              disabled={uploading} 
                              className={`bg-emerald-600 text-white px-4 py-2.5 rounded-lg hover:bg-emerald-700 flex justify-center items-center gap-2 font-medium transition-colors shadow-sm ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                              <Upload className="w-4 h-4" />
                              <span>Upload Files</span>
                          </button>
                        )}
                    </div>
                </div>

                {visibleFiles.length === 0 ? (
                    <div className="p-12 text-center text-slate-500">
                        {!isPortfolio && viewFilter === 'selected' ? (
                            <>
                                <Heart className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                                <p>No files selected by the client yet.</p>
                            </>
                        ) : (
                            <>
                                <Upload className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                                <p>{isPortfolio ? "No files uploaded to this portfolio yet." : "No files uploaded yet. Select an expiration time above and upload."}</p>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {visibleFiles.map((file) => {
                            const isExpired = new Date(file.expires_at) < new Date();
                            const isSelected = clientSelections.includes(file.id);
                            let isExtra = false;
                            if (isSelected && gallery.selection_limit && gallery.selection_limit > 0) {
                                const index = clientSelections.indexOf(file.id);
                                if (index >= gallery.selection_limit) {
                                    isExtra = true;
                                }
                            }
                            return (
                                <div key={file.id} className={`p-4 flex items-center justify-between hover:bg-slate-50 transition-colors ${isSelected ? 'bg-rose-50/50' : ''}`}>
                                    <div className="flex items-center gap-3 md:gap-4 overflow-hidden">
                                        <div className="relative w-14 h-14 md:w-16 md:h-16 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200">
                                            {file.file_type === 'image' ? (
                                                <img 
                                                  src={file.thumbnail_url ? getOptimizedImageUrl(file.thumbnail_url, 100, 100) : getOptimizedImageUrl(file.file_url, 100, 100)} 
                                                  alt="Thumbnail" 
                                                  className="w-full h-full object-cover" 
                                                  onError={(e) => {
                                                    const target = e.target as HTMLImageElement;
                                                    if (!target.dataset.retried) {
                                                        target.dataset.retried = 'true';
                                                        target.src = file.thumbnail_url ? rewriteUrlToR2(file.thumbnail_url) : rewriteUrlToR2(file.file_url);
                                                    }
                                                  }}
                                                />
                                            ) : (
                                                <video 
                                                    src={rewriteUrlToR2(file.file_url)} 
                                                    className="w-full h-full object-cover"
                                                    muted
                                                    preload="metadata"
                                                />
                                            )}
                                            {!isPortfolio && isSelected && (
                                                <div className="absolute inset-0 bg-rose-500/20 flex items-center justify-center">
                                                    <Heart className="w-6 h-6 text-rose-600 fill-rose-600" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-slate-900 truncate flex items-center gap-2">
                                                {file.file_path.split('/').pop()}
                                                {!isPortfolio && isSelected && (
                                                    <>
                                                        <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold">SELECTED</span>
                                                        {isExtra && (
                                                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold">EXTRA</span>
                                                        )}
                                                    </>
                                                )}
                                                {file.is_edited && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">EDITED</span>}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5">Uploaded: {formatDate(file.created_at)}</p>
                                            {!isPortfolio && (
                                                <p className={`text-xs mt-0.5 truncate ${isExpired ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                                                    {isExpired ? 'Expired: ' : 'Expires: '} {formatDate(file.expires_at)}
                                                </p>
                                            )}
                                            {isPortfolio && (
                                                <div className="mt-2 space-y-2 max-w-sm">
                                                    <input 
                                                        type="text" 
                                                        placeholder="Title (e.g. The Fisherman)" 
                                                        defaultValue={file.title || ''} 
                                                        onBlur={(e) => {
                                                            if (e.target.value !== (file.title || '')) {
                                                                updateFileDetails(file.id, { title: e.target.value });
                                                            }
                                                        }}
                                                        className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:border-slate-400 font-medium"
                                                    />
                                                    <textarea 
                                                        placeholder="Description" 
                                                        defaultValue={file.description ?? file.caption ?? ''} 
                                                        rows={2}
                                                        onBlur={(e) => {
                                                            const currentVal = file.description ?? file.caption ?? '';
                                                            if (e.target.value !== currentVal) {
                                                                updateFileDetails(file.id, { description: e.target.value });
                                                            }
                                                        }}
                                                        className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:border-slate-400 resize-none"
                                                    />
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <input 
                                                            type="text" 
                                                            placeholder="Size (e.g. A2 Landscape)" 
                                                            defaultValue={file.print_size || ''} 
                                                            onBlur={(e) => {
                                                                if (e.target.value !== (file.print_size || '')) {
                                                                    updateFileDetails(file.id, { print_size: e.target.value });
                                                                }
                                                            }}
                                                            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:border-slate-400"
                                                        />
                                                        <input 
                                                            type="text" 
                                                            placeholder="Material (e.g. Canvas)" 
                                                            defaultValue={file.material || ''} 
                                                            onBlur={(e) => {
                                                                if (e.target.value !== (file.material || '')) {
                                                                    updateFileDetails(file.id, { material: e.target.value });
                                                                }
                                                            }}
                                                            className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:border-slate-400"
                                                        />
                                                    </div>
                                                    <input 
                                                        type="text" 
                                                        placeholder="Price/Details (e.g. KES 25,000)" 
                                                        defaultValue={file.price || ''} 
                                                        onBlur={(e) => {
                                                            if (e.target.value !== (file.price || '')) {
                                                                updateFileDetails(file.id, { price: e.target.value });
                                                            }
                                                        }}
                                                        className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full focus:outline-none focus:border-slate-400 font-medium text-amber-700"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 md:gap-3 pl-2">
                                        <div className="flex items-center gap-2 mr-1 md:mr-3 bg-slate-100 px-2 py-1 rounded-md">
                                            <input 
                                                type="checkbox" 
                                                checked={file.is_edited || false}
                                                onChange={() => handleToggleEdited(file.id, file.is_edited || false)}
                                                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                                                id={`edited-${file.id}`}
                                            />
                                            <label htmlFor={`edited-${file.id}`} className="text-xs font-medium text-slate-600 cursor-pointer hidden sm:block">Edited</label>
                                        </div>
                                        <div className="hidden md:flex text-xs text-slate-400 mr-2 items-center gap-1">
                                            <Download className="w-3 h-3" />
                                            {file.download_count}
                                        </div>
                                        <a href={rewriteUrlToR2(file.file_url)} target="_blank" rel="noreferrer" className="p-3 md:p-2 text-slate-400 hover:text-emerald-600 rounded-full hover:bg-emerald-50 transition-colors title='View Original'">
                                            <Eye className="w-5 h-5 md:w-4 md:h-4" />
                                        </a>
                                        {isPortfolio && (
                                            <button
                                                onClick={() => handleSetCover(file.id)}
                                                className={`p-3 md:p-2 rounded-full transition-colors ${file.id === files[0]?.id ? 'text-amber-500 bg-amber-50' : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50'}`}
                                                title={file.id === files[0]?.id ? "Current Cover" : "Set as Cover"}
                                            >
                                                <Star className={`w-5 h-5 md:w-4 md:h-4 ${file.id === files[0]?.id ? 'fill-current' : ''}`} />
                                            </button>
                                        )}
                                        <button 
                                            onClick={() => deleteFile(file.id, file.file_path)}

                                            className="p-3 md:p-2 text-slate-400 hover:text-red-600 rounded-full hover:bg-red-50 transition-colors"
                                        >
                                            <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};