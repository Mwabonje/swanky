import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { Gallery } from '../types';
import { getOptimizedImageUrl, rewriteUrlToR2 } from '../utils/formatters';
import { Instagram, Globe, Mail, Menu, X, Youtube, Video, MessageCircle } from 'lucide-react';

interface PortfolioGallery extends Gallery {
  coverUrl?: string | null;
  coverType?: string | null;
  itemCount?: number;
}

export const Portfolio: React.FC = () => {
    const { photographerId } = useParams<{ photographerId: string }>();
    const [searchParams, setSearchParams] = useSearchParams();
    const [galleries, setGalleries] = useState<PortfolioGallery[]>([]);
    const [loading, setLoading] = useState(true);
    const activeCategory = searchParams.get('category') || 'All';
    const setActiveCategory = (cat: string) => {
        if (cat === 'All') {
            searchParams.delete('category');
            setSearchParams(searchParams);
        } else {
            setSearchParams({ category: cat });
        }
    };
    const [photographerName, setPhotographerName] = useState<string>("My Portfolio");
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const horizontalRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const fetchPortfolio = async () => {
            if (!photographerId) return;
            try {
                // Fetch public galleries for this photographer
                const { data: galleriesData, error } = await supabase
                    .from('galleries')
                    .select('*')
                    .eq('photographer_id', photographerId)
                    .order('created_at', { ascending: false });

                if (error) throw error;

                // Configure photographer name placeholder
                if (galleriesData && galleriesData.length > 0) {
                     setPhotographerName("Mwabonje"); // Updated to match inspiration style
                }

                // Filter out non-portfolio items (client deliveries without a category)
                const portfolioItems = (galleriesData || []).filter(g => g.category && g.category.trim() !== '');

                const enrichedGalleries = await Promise.all(
                    portfolioItems.map(async (gallery) => {
                        // The cover is defined as the most recently updated file (by created_at)
                        const { data: files } = await supabase
                            .from('files')
                            .select('file_url, file_type')
                            .eq('gallery_id', gallery.id)
                            .order('created_at', { ascending: false })
                            .limit(1);

                        return {
                            ...gallery,
                            coverUrl: files && files.length > 0 ? files[0].file_url : null,
                            coverType: files && files.length > 0 ? files[0].file_type : null,
                        };
                    })
                );

                // Filter out empty galleries for the public portfolio
                setGalleries(enrichedGalleries.filter(g => g.coverUrl));
            } catch (error) {
                console.error("Error loading portfolio:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchPortfolio();
    }, [photographerId]);

    const isFilmsCategory = activeCategory.toLowerCase() === 'films' || activeCategory.toLowerCase() === 'video';

    useEffect(() => {
        const el = horizontalRef.current;
        if (!el || !isFilmsCategory) return;
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
    }, [galleries, activeCategory, isFilmsCategory]);

    if (loading) {
        return (
            <div className="min-h-screen bg-white text-slate-900 flex items-center justify-center">
                <div className="animate-pulse tracking-[0.2em] uppercase text-xs text-slate-400 font-medium">Loading Portfolio...</div>
            </div>
        );
    }

    // Extract unique categories (defaulting heavily to un-categorized if not set)
    const categories = ['All', ...Array.from(new Set(galleries.map(g => g.category).filter(c => Boolean(c) && c?.toLowerCase() !== 'prints')))];
    
    const homeKeywords = ["rafiki", "lamu", "kilele"];
    
    const filteredGalleries = activeCategory === 'All' 
        ? galleries.filter(g => homeKeywords.some(keyword => g.client_name.toLowerCase().includes(keyword)))
        : galleries.filter(g => g.category === activeCategory);

    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans flex flex-col">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-100 transition-all">
                <div className="max-w-[2000px] mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-5 flex items-center justify-between">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Swanky Photography</h1>
                    
                    {/* Desktop Navigation */}
                    <nav className="hidden md:flex items-center gap-8 text-xs uppercase tracking-[0.2em] font-medium">
                        {categories.map(cat => (
                            <button 
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`transition-colors hover:text-slate-900 relative py-1 ${activeCategory === cat ? 'text-slate-900' : 'text-slate-400'}`}
                            >
                                {cat}
                                {activeCategory === cat && (
                                    <span className="absolute bottom-0 left-0 w-full h-[1px] bg-slate-900" />
                                )}
                            </button>
                        ))}
                    </nav>

                    {/* Mobile Menu Button */}
                    <button className="md:hidden p-2 -mr-2 text-slate-600 hover:text-slate-900 transition-colors" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
                        {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>
                </div>

                {/* Mobile Navigation */}
                {isMobileMenuOpen && (
                    <nav className="md:hidden border-t border-slate-100 bg-white/95 backdrop-blur-md px-4 py-4 flex flex-col gap-4 text-xs uppercase tracking-[0.2em] font-medium shadow-xl absolute w-full animate-in slide-in-from-top-2">
                        {categories.map(cat => (
                            <button 
                                key={cat}
                                onClick={() => { setActiveCategory(cat); setIsMobileMenuOpen(false); }}
                                className={`text-left p-2 transition-colors hover:text-slate-900 hover:bg-slate-50 rounded-sm ${activeCategory === cat ? 'text-slate-900 bg-slate-50' : 'text-slate-500'}`}
                            >
                                {cat}
                            </button>
                        ))}
                    </nav>
                )}
            </header>

            {/* Main Content */}
            <main className="flex-1 w-full max-w-[2000px] mx-auto px-4 sm:px-6 md:px-8 py-8 md:py-12">
                {filteredGalleries.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[50vh] text-slate-400 text-sm uppercase tracking-widest text-center px-4">
                        No collections found in this category.
                    </div>
                ) : isFilmsCategory ? (
                    <div 
                        ref={horizontalRef}
                        className="flex overflow-x-auto snap-x snap-mandatory md:snap-proximity gap-4 md:gap-8 pb-8 pt-4 w-full items-center min-h-[60vh] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
                    >
                        {filteredGalleries.map(gallery => (
                            <div key={gallery.id} className="flex-none w-[85vw] sm:w-[70vw] md:w-[60vw] lg:w-[45vw] snap-center aspect-video relative group cursor-pointer overflow-hidden rounded-sm bg-slate-50" onClick={() => window.location.href = `/gallery/${gallery.id}`}>
                                {gallery.coverType === 'video' ? (
                                    <video src={rewriteUrlToR2(gallery.coverUrl!)} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-[1.02]" muted playsInline loop autoPlay />
                                ) : (
                                    <img src={getOptimizedImageUrl(gallery.coverUrl!, 1200)} alt={gallery.title} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-[1.02]" />
                                )}
                                <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center justify-center">
                                    <h2 className="text-white text-lg md:text-2xl font-medium tracking-[0.2em] uppercase drop-shadow-md px-6 text-center">{gallery.title || gallery.client_name}</h2>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6 md:gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {filteredGalleries.map(gallery => (
                            <Link key={gallery.id} to={`/gallery/${gallery.id}`} className="group relative block aspect-[4/5] bg-slate-50 overflow-hidden rounded-sm cursor-pointer shadow-sm hover:shadow-md transition-shadow">
                                {gallery.coverType === 'video' ? (
                                    <video src={rewriteUrlToR2(gallery.coverUrl!)} className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105" muted playsInline loop autoPlay />
                                ) : (
                                    <img src={getOptimizedImageUrl(gallery.coverUrl!, 800)} alt={gallery.title} loading="lazy" className="w-full h-full object-cover transition-transform duration-[1.5s] group-hover:scale-105" />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-6">
                                    <h2 className="text-white text-sm md:text-base font-medium tracking-[0.2em] uppercase drop-shadow-sm transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">{gallery.title || gallery.client_name}</h2>
                                    <p className="text-white/70 text-xs tracking-widest uppercase mt-2 hidden group-hover:block animate-in fade-in slide-in-from-bottom-2 duration-300">View Collection</p>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="border-t border-slate-100 py-12 px-6 flex flex-col items-center justify-center gap-6 mt-auto bg-slate-50/50">
                <div className="flex gap-6 text-slate-400">
                    <a href="#" className="hover:text-slate-900 transition-colors p-2 hover:bg-slate-100 rounded-full"><Instagram className="w-5 h-5" /></a>
                    <a href="#" className="hover:text-slate-900 transition-colors p-2 hover:bg-slate-100 rounded-full"><MessageCircle className="w-5 h-5" /></a>
                    <a href="#" className="hover:text-slate-900 transition-colors p-2 hover:bg-slate-100 rounded-full"><Mail className="w-5 h-5" /></a>
                </div>
                <p className="text-[10px] text-slate-400 uppercase tracking-widest text-center">
                    &copy; {new Date().getFullYear()} Swanky Photography. All Rights Reserved.
                </p>
            </footer>
        </div>
    );
};
