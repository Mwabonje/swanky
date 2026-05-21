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
        <div className="min-h-screen bg-white text-slate-900 flex flex-col items-center justify-center font-sans tracking-widest uppercase p-6 text-center">
            <h1 className="text-2xl sm:text-3xl md:text-[44px] mb-4 font-bold tracking-tight md:tracking-widest w-full max-w-full break-words" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Swanky Photography</h1>
            <p className="text-slate-400 text-xs sm:text-sm tracking-widest px-4">Portfolio currently under maintenance.</p>
        </div>
    );
};
