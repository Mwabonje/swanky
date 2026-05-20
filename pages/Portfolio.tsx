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
        <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-slate-900 selection:text-white">
            
            {/* Top Navigation Header */}
            <header className="w-full pt-8 pb-4 md:pt-24 md:pb-8 px-4 md:px-8 flex flex-col items-center relative">
                
                <div className="flex w-full justify-between items-center md:justify-center relative">
                    {/* Spacer for symmetry on mobile */}
                    <div className="w-10 md:hidden" /> 
                    
                    <h1 className="text-2xl md:text-3xl lg:text-[44px] uppercase tracking-wider font-bold md:mb-10 text-slate-800 text-center" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                        {photographerName}
                    </h1>
                    
                    {/* Mobile Hamburger Button */}
                    <button 
                        className="md:hidden text-slate-800 hover:text-black z-30 p-2 -mr-2"
                        onClick={() => setIsMobileMenuOpen(true)}
                        aria-label="Open menu"
                    >
                        <Menu className="w-8 h-8" strokeWidth={1} />
                    </button>
                </div>

                {/* Desktop Navigation Links */}
                <nav className="hidden md:flex flex-wrap justify-center items-center gap-6 md:gap-12 text-[10px] md:text-xs font-semibold tracking-[0.15em] uppercase text-slate-500">
                    {categories.length > 0 && categories.map((cat) => {
                        const isAll = cat === 'All';
                        const catGalleries = galleries.filter(g => g.category === cat);
                        const hasDropdown = !isAll && catGalleries.length > 0;
                        
                        const displayCatName = isAll ? 'HOME' : (cat.toLowerCase() === 'airbnb' ? 'HOSPITALITY' : (cat as string).toUpperCase());

                        return (
                            <div key={cat as string} className="relative group">
                                <button
                                    onClick={() => setActiveCategory(cat as string)}
                                    className={`py-4 flex items-center hover:text-slate-900 transition-colors duration-300 ${
                                        activeCategory === cat 
                                        ? 'text-slate-900' 
                                        : ''
                                    }`}
                                >
                                    {displayCatName}
                                    {hasDropdown && <span>+</span>}
                                </button>

                                {hasDropdown && (
                                    <div className="absolute left-1/2 -translate-x-1/2 top-full pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-50">
                                        <div className="bg-slate-100 px-8 py-6 shadow-xl flex flex-col gap-4 min-w-[240px] items-start">
                                            {catGalleries.map(g => (
                                                <Link 
                                                    key={g.id} 
                                                    to={`/g/${g.id}`}
                                                    className="text-[10px] md:text-[11px] font-semibold tracking-[0.15em] uppercase text-slate-500 hover:text-slate-900 transition-colors whitespace-nowrap text-left block w-full"
                                                >
                                                    {g.client_name.toUpperCase()}
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    <a href="#" onClick={(e) => e.preventDefault()} className="py-4 hover:text-slate-900 transition-colors duration-300 cursor-default">ABOUT</a>
                    <a href="https://mwabonjebooking.netlify.app/" target="_blank" rel="noopener noreferrer" className="py-4 hover:text-slate-900 transition-colors duration-300">CONTACT</a>
                    <Link to="/prints" className="py-4 hover:text-slate-900 transition-colors duration-300">PRINTS</Link>
                </nav>
            </header>

            {/* Mobile Sidebar Navigation */}
            <>
                <div 
                    className={`fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                    onClick={() => setIsMobileMenuOpen(false)}
                />
                <aside 
                    className={`fixed inset-y-0 left-0 w-64 bg-white z-50 md:hidden flex flex-col p-8 transform transition-transform duration-300 ease-in-out shadow-2xl ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
                >
                    <button 
                        className="self-end text-slate-400 hover:text-slate-900 -mr-2 p-2 mb-4"
                        onClick={() => setIsMobileMenuOpen(false)}
                        aria-label="Close menu"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    
                    <nav className="flex flex-col gap-6 text-[11px] font-semibold tracking-[0.15em] uppercase text-slate-500 mt-4">
                        {categories.length > 0 && categories.map((cat) => {
                            const isAll = cat === 'All';
                            const catGalleries = galleries.filter(g => g.category === cat);
                            const hasDropdown = !isAll && catGalleries.length > 0;
                            const displayCatName = isAll ? 'HOME' : (cat.toLowerCase() === 'airbnb' ? 'HOSPITALITY' : (cat as string).toUpperCase());

                            return (
                                <button
                                    key={cat as string}
                                    onClick={() => {
                                        setActiveCategory(cat as string);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    className={`flex items-center text-left hover:text-slate-900 transition-colors duration-300 ${
                                        activeCategory === cat 
                                        ? 'text-slate-900' 
                                        : ''
                                    }`}
                                >
                                    {displayCatName}
                                    {hasDropdown && <span>+</span>}
                                </button>
                            );
                        })}
                        <div className="h-px w-8 bg-slate-100 my-2" />
                        <a href="#" onClick={(e) => e.preventDefault()} className="hover:text-slate-900 transition-colors duration-300 cursor-default">ABOUT</a>
                        <a href="https://mwabonjebooking.netlify.app/" target="_blank" rel="noopener noreferrer" className="hover:text-slate-900 transition-colors duration-300">CONTACT</a>
                        <Link to="/prints" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-slate-900 transition-colors duration-300">PRINTS</Link>
                    </nav>

                    <div className="mt-auto pt-8">
                        <div className="flex gap-4">
                            <a href="#" onClick={(e) => e.preventDefault()} className="text-slate-400 hover:text-slate-900 transition-colors cursor-default"><Instagram className="w-4 h-4" /></a>
                            <a href="#" onClick={(e) => e.preventDefault()} className="text-slate-400 hover:text-slate-900 transition-colors cursor-default"><Globe className="w-4 h-4" /></a>
                            <a href="#" onClick={(e) => e.preventDefault()} className="text-slate-400 hover:text-slate-900 transition-colors cursor-default"><Mail className="w-4 h-4" /></a>
                        </div>
                    </div>
                </aside>
            </>

            {/* Main Content Gallery */}
            <main className={
                isFilmsCategory 
                ? "w-full overflow-hidden" 
                : "max-w-[1400px] mx-auto p-1 md:p-2 overflow-y-auto w-full"
            }>
                <div 
                    ref={isFilmsCategory ? horizontalRef : undefined}
                    className={
                        isFilmsCategory 
                        ? `flex overflow-x-auto snap-x snap-mandatory md:snap-proximity gap-2 md:gap-4 pb-8 pt-4 sm:pt-8 w-full items-center h-[calc(100vh-280px)] min-h-[500px] px-4 md:px-8 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${filteredGalleries.length === 1 ? 'justify-center' : ''}`
                        : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 md:gap-2"
                    }
                >
                    {filteredGalleries.map((gallery, index) => (
                        <Link 
                            to={`/g/${gallery.id}`} 
                            key={gallery.id}
                            className={`group block relative ${isFilmsCategory ? 'flex-none h-full snap-center aspect-[4/5]' : 'aspect-[4/5]'}`}
                        >
                            <div className="bg-slate-50 overflow-hidden relative w-full h-full">
                                {gallery.coverType === 'video' ? (
                                    <video 
                                        src={rewriteUrlToR2(gallery.coverUrl!)} 
                                        className="w-full h-full object-cover block transform transition-transform duration-[1.5s] group-hover:scale-[1.02]"
                                        muted playsInline loop preload="metadata"
                                        onMouseOver={(e) => (e.target as HTMLVideoElement).play().catch(()=> {})}
                                        onMouseOut={(e) => {
                                            const v = e.target as HTMLVideoElement;
                                            v.pause();
                                            v.currentTime = 0;
                                        }}
                                    />
                                ) : (
                                    <img 
                                        src={getOptimizedImageUrl(gallery.coverUrl!, 800, 1000, 70)}
                                        alt={gallery.client_name}
                                        className="w-full h-full object-cover block transform transition-transform duration-[1.5s] group-hover:scale-[1.02]"
                                        loading={index < 4 ? "eager" : "lazy"}
                                    />
                                )}
                                
                                {/* Title Overlay */}
                                <div className="absolute inset-x-0 bottom-10 md:bottom-16 pointer-events-none z-10 transition-transform duration-700 md:group-hover:-translate-y-3 flex justify-center">
                                    <h3 className="text-base md:text-xl font-bold tracking-[0.2em] uppercase text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] text-center px-4">
                                        {gallery.client_name}
                                    </h3>
                                </div>
                                
                                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-black/0 group-hover:from-black/60 transition-colors duration-700 pointer-events-none" />
                            </div>
                        </Link>
                    ))}
                </div>

                {filteredGalleries.length === 0 && !loading && (
                    <div className="h-full flex items-center justify-center p-32">
                        <p className="text-slate-400 tracking-[0.2em] text-xs uppercase font-medium">No collections available.</p>
                    </div>
                )}
            </main>
            
            {/* Footer */}
            <footer className="w-full py-6 md:py-12 flex flex-col items-center justify-center gap-2 md:gap-3 border-t border-slate-100 mt-6 md:mt-12 text-[#0a192f]">
                <div className="flex flex-wrap justify-center gap-4 sm:gap-6 md:gap-8 items-center text-[10px] sm:text-xs font-bold tracking-widest px-4">
                    <a href="https://www.instagram.com/mwabonje_/" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 sm:gap-2 hover:opacity-70 transition-opacity">
                        <Instagram className="w-3 h-3 sm:w-4 sm:h-4" /> INSTAGRAM
                    </a>
                    <a href="https://www.tiktok.com/@mwabonje_?is_from_webapp=1&sender_device=pc" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 sm:gap-2 hover:opacity-70 transition-opacity">
                        <Video className="w-3 h-3 sm:w-4 sm:h-4" /> TIK TOK
                    </a>
                    <a href="https://wa.me/254705268604" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 sm:gap-2 hover:opacity-70 transition-opacity">
                        <MessageCircle className="w-3 h-3 sm:w-4 sm:h-4" /> WHATSAPP
                    </a>
                </div>
                <p className="text-xs sm:text-sm font-normal text-slate-400 text-center px-4">
                    © 2026 Mwabonje Photography, All Rights Reserved
                </p>
            </footer>
        </div>
    );
};
