import React, { useEffect, useState } from 'react';
import { Plus, Eye, EyeOff, Image as ImageIcon, Loader2, Trash2, Heart, Bell, Clock, Globe } from 'lucide-react';
import { supabase } from '../services/supabase';
import { Gallery, ActivityLog } from '../types';
import { useNavigate } from 'react-router-dom';
import { getOptimizedImageUrl, formatDate, getProxiedMediaUrl } from '../utils/formatters';

// Extended interface for dashboard display
interface DashboardGallery extends Gallery {
  coverUrl: string | null;
  itemCount: number;
}

interface EnrichedActivityLog extends ActivityLog {
  gallery?: {
    client_name: string;
  };
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [galleries, setGalleries] = useState<DashboardGallery[]>([]);
  const [activities, setActivities] = useState<EnrichedActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newCategory, setNewCategory] = useState('Wedding');
  const [isCreating, setIsCreating] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      setUserEmail(user.email ?? null);

      // 1. Fetch Galleries
      const { data: galleriesData, error } = await supabase
        .from('galleries')
        .select('*')
        .eq('photographer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // 2. Fetch details for each gallery (Cover Image & Count)
      const enrichedGalleries = await Promise.all(
        (galleriesData || []).map(async (gallery) => {
          // Get item count
          const { count } = await supabase
            .from('files')
            .select('*', { count: 'exact', head: true })
            .eq('gallery_id', gallery.id);

          // Get latest file for cover
          const { data: files, error: filesError } = await supabase
            .from('files')
            .select('file_url, file_type')
            .eq('gallery_id', gallery.id)
            .order('created_at', { ascending: false })
            .limit(1);

          if (filesError) console.error("Files query error for gallery", gallery.id, filesError);

          return {
            ...gallery,
            itemCount: count || 0,
            coverUrl: files && files.length > 0 ? files[0].file_url : null,
            coverType: files && files.length > 0 ? files[0].file_type : null,
          };
        })
      );
      
      // Sort galleries
      const sortedGalleries = enrichedGalleries.sort((a, b) => {
          if (a.selection_status === 'submitted' && b.selection_status !== 'submitted') return -1;
          if (a.selection_status !== 'submitted' && b.selection_status === 'submitted') return 1;
          return 0;
      });

      setGalleries(sortedGalleries);

      // 3. Fetch Recent Activity
      const { data: activityData } = await supabase
        .from('activity_logs')
        .select('*, gallery:galleries(client_name)')
        .order('timestamp', { ascending: false })
        .limit(10);
        
      if (activityData) {
          // Filter out logs where gallery might have been deleted (if cascade didn't work or for safety)
          // @ts-ignore
          setActivities(activityData.filter(log => log.gallery));
      }

    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreateModal = () => {
    setNewClientName('');
    if (userEmail !== 'ringa.michael@gmail.com') {
      setNewCategory(''); // Force empty so they can only create client deliveries
    }
    setIsCreateModalOpen(true);
  };

  const createGallery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    const isPortfolio = newCategory.trim() !== '';
    const deliveriesCount = galleries.filter(g => !g.category || g.category.trim() === '').length;
    const portfolioCount = galleries.filter(g => g.category && g.category.trim() !== '').length;

    if (!isPortfolio && deliveriesCount >= 3) {
        alert("You have reached the maximum limit of 3 Client Deliveries. Please delete an existing delivery to create a new one.");
        return;
    }
    if (isPortfolio && portfolioCount >= 50) {
        alert("You have reached the maximum limit of 50 Portfolio Collections. Please delete an existing collection to create a new one.");
        return;
    }
    
    setIsCreating(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('galleries')
        .insert([{
          photographer_id: user.id,
          client_name: newClientName,
          title: `${newClientName}'s Gallery`,
          category: newCategory,
          agreed_balance: 0,
          amount_paid: 0,
          link_enabled: true
        }])
        .select()
        .single();

      if (error) throw error;
      setIsCreateModalOpen(false);
      navigate(`/gallery/${data.id}`);
    } catch (error: any) {
      alert(`Database Error: ${error.message || 'Error creating gallery'}. Did you add the 'category' column?`);
      console.error(error);
    } finally {
        setIsCreating(false);
    }
  };

  const deleteGallery = async (e: React.MouseEvent, galleryId: string, clientName: string) => {
    e.stopPropagation(); // Prevent navigation
    
    if (!window.confirm(`Are you sure you want to delete the gallery for "${clientName}"?\nThis action cannot be undone and will delete all associated files.`)) {
        return;
    }

    try {
        // Delete all files in the gallery prefix from Cloudflare R2
        await fetch('/api/delete-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folderPath: galleryId })
        });

        // Also clean up Supabase storage (backward compatibility if user had files before R2)
        try {
            const deleteFolderContents = async (folder: string) => {
                let hasMore = true;
                let offset = 0;
                while (hasMore) {
                    const { data: folderFiles } = await supabase.storage.from('gallery-files').list(folder, { limit: 100, offset });
                    if (folderFiles && folderFiles.length > 0) {
                        for (const f of folderFiles) {
                            if (f.id === null) {
                                await deleteFolderContents(`${folder}/${f.name}`);
                                await supabase.storage.from('gallery-files').remove([`${folder}/${f.name}`]);
                            } else {
                                await supabase.storage.from('gallery-files').remove([`${folder}/${f.name}`]);
                            }
                        }
                        if (folderFiles.length < 100) hasMore = false;
                        else offset += 100;
                    } else {
                        hasMore = false;
                    }
                }
            };
            
            await deleteFolderContents(galleryId);
            // And try to delete the folder itself
            await supabase.storage.from('gallery-files').remove([galleryId]);
        } catch (ignore) { }

        // Also delete specifically referenced files if not in a prefix somehow
        const { data: filesData } = await supabase
            .from('files')
            .select('file_path')
            .eq('gallery_id', galleryId);
            
        if (filesData && filesData.length > 0) {
            const paths = filesData.map(f => f.file_path);
            await fetch('/api/delete-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePaths: paths })
            });
        }

        const { error } = await supabase
            .from('galleries')
            .delete()
            .eq('id', galleryId);

        if (error) throw error;

        setGalleries(prev => prev.filter(g => g.id !== galleryId));
        // Refresh activities as some might be related to deleted gallery
        fetchData();

    } catch (err) {
        console.error("Error deleting gallery:", err);
        alert("Failed to delete gallery. Check console for details.");
    }
  };

  if (loading) return <div className="flex justify-center items-center h-full text-slate-400"><Loader2 className="animate-spin mr-2" /> Loading dashboard...</div>;

  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {/* Main Content */}
      <div className="flex-1">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-8">
            <div>
               <h1 className="text-2xl font-bold text-slate-900">Galleries</h1>
               <p className="text-slate-500 text-sm">Manage your client galleries</p>
            </div>
            <div className="flex flex-wrap w-full sm:w-auto gap-3 mt-4 sm:mt-0">
              {userId && userEmail === 'ringa.michael@gmail.com' && (
                <button
                  onClick={() => window.open(`#/p/${userId}`, '_blank')}
                  className="flex-[1_1_45%] sm:flex-none border border-slate-200 hover:bg-slate-50 text-slate-700 px-5 py-2.5 rounded-full flex items-center justify-center space-x-2 transition-all shadow-sm active:scale-95"
                >
                  <Globe className="w-4 h-4" />
                  <span className="text-sm font-medium">Live Portfolio</span>
                </button>
              )}
              <button
              onClick={handleOpenCreateModal}
              className="flex-[1_1_100%] sm:flex-none bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-full flex items-center justify-center space-x-2 transition-all shadow-lg active:scale-95"
              >
              <Plus className="w-5 h-5" />
              <span className="text-sm font-medium">New Gallery</span>
              </button>
            </div>
        </div>

        {/* Private Client Deliveries Section */}
        <div className="mb-12">
            <h2 className="text-xl font-bold text-slate-800 mb-4 border-b border-slate-200 pb-2">Client Deliveries</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {galleries.filter(g => !g.category || g.category.trim() === '').map((gallery) => (
                <div 
                    key={gallery.id} 
                    onClick={() => navigate(`/gallery/${gallery.id}`)}
                    className="group cursor-pointer flex flex-col"
                >
                    {/* Image Container */}
                    <div className="relative aspect-[3/2] bg-slate-100 rounded-xl overflow-hidden mb-3 shadow-sm transition-all duration-300 group-hover:shadow-md border border-slate-100">
                    {gallery.coverUrl ? (
                        gallery.coverType === 'video' ? (
                            <video 
                                src={getProxiedMediaUrl(gallery.coverUrl)} 
                                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                muted
                                playsInline
                                loop
                                preload="metadata"
                                onMouseOver={(e) => (e.target as HTMLVideoElement).play().catch(()=> {})}
                                onMouseOut={(e) => {
                                    const v = e.target as HTMLVideoElement;
                                    v.pause();
                                    v.currentTime = 0;
                                }}
                            />
                        ) : (
                            <img 
                            src={getOptimizedImageUrl(gallery.coverUrl, 600, 400)} 
                            alt={gallery.client_name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                            onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                if (!target.dataset.retried) {
                                    target.dataset.retried = 'true';
                                    target.src = getProxiedMediaUrl(gallery.coverUrl || '');
                                }
                            }}
                            />
                        )
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-slate-50 text-slate-300">
                        <ImageIcon className="w-10 h-10" />
                        </div>
                    )}
                    
                    {/* Status Badges Overlay */}
                    <div className="absolute top-2 left-2 flex gap-1 z-10">
                        {gallery.selection_status === 'submitted' && (
                            <div className="bg-rose-500 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-sm flex items-center gap-1 animate-bounce">
                                <Heart className="w-3 h-3 fill-current" />
                                SUBMITTED
                            </div>
                        )}
                    </div>
                    
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors duration-300" />
                    
                    {/* Delete Button */}
                    <button
                        onClick={(e) => deleteGallery(e, gallery.id, gallery.client_name)}
                        className="absolute top-2 right-2 p-3 md:p-2 bg-white/90 rounded-full text-slate-400 hover:text-red-600 hover:bg-white shadow-sm opacity-100 md:opacity-0 group-hover:opacity-100 transition-all duration-200 transform scale-100 md:scale-90 group-hover:scale-100 z-10"
                        title="Delete Gallery"
                    >
                        <Trash2 className="w-5 h-5 md:w-4 md:h-4" />
                    </button>
                    </div>

                    {/* Info Container */}
                    <div className="space-y-1 px-1">
                    {/* Title Row */}
                    <div className="flex items-center gap-2">
                        {gallery.link_enabled ? (
                        <Eye className="w-4 h-4 text-slate-400" />
                        ) : (
                        <EyeOff className="w-4 h-4 text-slate-400" />
                        )}
                        <h3 className="font-semibold text-slate-800 truncate group-hover:text-slate-600 transition-colors">
                        {gallery.client_name}
                        </h3>
                    </div>

                    {/* Status Row */}
                    <div className="flex items-center gap-2 text-xs">
                        <div className={`w-2 h-2 rounded-full ${gallery.link_enabled && gallery.itemCount > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`}></div>
                        <span className="text-slate-500">
                        {gallery.itemCount} {gallery.itemCount === 1 ? 'item' : 'items'}
                        </span>
                    </div>
                    </div>
                </div>
                ))}

                {/* Create New Gallery Card */}
                {galleries.filter(g => !g.category || g.category.trim() === '').length < 3 && (
                <div 
                    onClick={() => {
                        setNewCategory(''); // Ensure category is blank for Deliveries
                        handleOpenCreateModal();
                    }}
                    className="group cursor-pointer flex flex-col h-full"
                >
                    <div className="relative aspect-[3/2] flex flex-col items-center justify-center bg-slate-50 rounded-xl overflow-hidden mb-3 border-2 border-dashed border-slate-200 transition-all duration-300 group-hover:border-slate-400 group-hover:bg-slate-100">
                        <div className="w-12 h-12 rounded-full bg-white shadow-sm flex items-center justify-center text-slate-400 group-hover:text-slate-600 transition-colors mb-3 group-hover:scale-110">
                            <Plus className="w-6 h-6" />
                        </div>
                        <span className="font-medium text-slate-500 group-hover:text-slate-700">Add New Delivery</span>
                    </div>
                </div>
                )}
            </div>
        </div>

        {/* Portfolio Collections Section */}
        {userEmail === 'ringa.michael@gmail.com' && (
        <div className="mb-12">
            <h2 className="text-xl font-bold text-slate-800 mb-4 border-b border-slate-200 pb-2">Portfolio Collections</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {galleries.filter(g => g.category && g.category.trim() !== '').map((gallery) => (
                <div 
                    key={gallery.id} 
                    onClick={() => navigate(`/gallery/${gallery.id}`)}
                    className="group cursor-pointer flex flex-col relative"
                >
                    <div className="relative aspect-[4/5] bg-slate-900 rounded-xl overflow-hidden shadow-sm transition-all duration-300 group-hover:shadow-md">
                        {gallery.coverUrl ? (
                            gallery.coverType === 'video' ? (
                                <video 
                                    src={getProxiedMediaUrl(gallery.coverUrl)} 
                                    className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105"
                                    muted playsInline loop preload="metadata"
                                    onMouseOver={(e) => (e.target as HTMLVideoElement).play().catch(()=> {})}
                                    onMouseOut={(e) => {
                                        const v = e.target as HTMLVideoElement;
                                        v.pause(); v.currentTime = 0;
                                    }}
                                />
                            ) : (
                                <img 
                                src={getOptimizedImageUrl(gallery.coverUrl, 400, 500)} 
                                alt={gallery.client_name}
                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 group-hover:scale-105"
                                onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    if (!target.dataset.retried) {
                                        target.dataset.retried = 'true';
                                        target.src = getProxiedMediaUrl(gallery.coverUrl || '');
                                    }
                                }}
                                />
                            )
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-700">
                                <ImageIcon className="w-8 h-8" />
                            </div>
                        )}
                        
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-80" />
                        
                        <div className="absolute bottom-0 left-0 right-0 p-4">
                            <span className="text-[10px] font-bold text-white/70 uppercase tracking-wider block mb-1">
                                {gallery.category}
                            </span>
                            <h3 className="font-medium text-white line-clamp-1">
                                {gallery.client_name}
                            </h3>
                        </div>

                        {/* Delete Button matches styling above but fitted for dark background */}
                        <button
                            onClick={(e) => deleteGallery(e, gallery.id, gallery.client_name)}
                            className="absolute top-2 right-2 p-2 bg-black/40 backdrop-blur-sm rounded-full text-white/70 hover:text-red-400 hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-200 z-10"
                            title="Delete Gallery"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                ))}
                
                {/* Create New Portfolio Collection */}
                {galleries.filter(g => g.category && g.category.trim() !== '').length < 50 && (
                <div 
                    onClick={() => {
                        setNewCategory('Wedding'); // Pre-fill with a suggestion since it's portfolio
                        handleOpenCreateModal();
                    }}
                    className="group cursor-pointer flex flex-col h-full"
                >
                    <div className="relative aspect-[4/5] flex flex-col items-center justify-center bg-transparent rounded-xl overflow-hidden border-2 border-dashed border-slate-300 transition-all duration-300 group-hover:border-slate-500 group-hover:bg-slate-50">
                        <div className="w-10 h-10 rounded-full bg-slate-100 shadow-sm flex items-center justify-center text-slate-500 group-hover:text-slate-700 transition-colors mb-2 group-hover:scale-110">
                            <Plus className="w-5 h-5" />
                        </div>
                        <span className="font-medium text-sm text-slate-500 group-hover:text-slate-700">New Collection</span>
                    </div>
                </div>
                )}
            </div>
        </div>
        )}

        {/* Empty State (If literally 0 galleries total exists everywhere) */}
        {galleries.length === 0 && (
            <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
                <ImageIcon className="w-12 h-12 mb-4 text-slate-300" />
                <p className="font-medium">Welcome to your studio dashboard.</p>
                <p className="text-sm mt-1">Click "New Gallery" to create a private delivery or portfolio collection.</p>
            </div>
        )}
      </div>

      {/* Sidebar: Recent Activity */}
      <div className="w-full lg:w-80 shrink-0">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sticky top-24">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Bell className="w-5 h-5 text-slate-500" />
                Recent Activity
            </h2>
            
            {activities.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                    <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No recent activity</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {activities.map((log) => (
                        <div key={log.id} className="flex gap-3 text-sm border-b border-slate-50 pb-3 last:border-0 last:pb-0">
                            <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                                log.action.includes('submitted') ? 'bg-rose-500' : 
                                log.action.includes('Payment') ? 'bg-emerald-500' : 'bg-slate-300'
                            }`} />
                            <div>
                                <p className="text-slate-900 font-medium leading-tight mb-0.5">
                                    {log.gallery?.client_name || 'Unknown Gallery'}
                                </p>
                                <p className="text-slate-600 leading-snug mb-1">
                                    {log.action.replace(/Client submitted selection of (\d+) photos/, 'Selected $1 photos')}
                                </p>
                                <p className="text-xs text-slate-400">
                                    {formatDate(log.timestamp)}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
      </div>

      {/* Create Gallery Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-lg font-semibold text-slate-900">New Gallery</h2>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
                disabled={isCreating}
              >
                ✕
              </button>
            </div>
            <form onSubmit={createGallery} className="p-6">
              <div className="mb-4">
                <label htmlFor="clientName" className="block text-sm font-medium text-slate-700 mb-2">
                  Client Name or Event Title
                </label>
                <input
                  id="clientName"
                  type="text"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
                  placeholder="e.g. John & Jane Wedding"
                  autoFocus
                  required
                  disabled={isCreating}
                />
              </div>

              {userEmail === 'ringa.michael@gmail.com' && (
              <div className="mb-6">
                <label htmlFor="category" className="block text-sm font-medium text-slate-700 mb-2">
                  Portfolio Category
                </label>
                <input
                  id="category"
                  type="text"
                  list="category-options"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
                  placeholder="e.g. Wedding, Sports, Real Estate..."
                  disabled={isCreating}
                />
                <datalist id="category-options">
                  {Array.from(new Set([
                    "Wedding", 
                    "Portraits", 
                    "Couples",
                    "Commercial", 
                    "Events", 
                    "Maternity", 
                    "Boudoir", 
                    "Fine Art",
                    ...galleries.map(g => g.category).filter(Boolean)
                  ])).map(cat => (
                    <option key={cat as string} value={cat as string} />
                  ))}
                </datalist>
                <p className="text-xs text-slate-500 mt-2">Pick from the list or type your own to creatively group your public portfolio.</p>
              </div>
              )}

              <div className="flex gap-3 justify-end mt-8">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 font-medium text-slate-600 hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors"
                  disabled={isCreating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newClientName.trim() || isCreating}
                  className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isCreating ? 'Creating...' : 'Create Gallery'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};