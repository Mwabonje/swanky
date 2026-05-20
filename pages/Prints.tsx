import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { Gallery } from '../types';
import { getOptimizedImageUrl, rewriteUrlToR2 } from '../utils/formatters';

interface PrintItem {
    id: string;
    file_url: string;
    file_type: string;
    client_name: string;
    title: string;
    caption?: string;
    description?: string;
    print_size?: string;
    material?: string;
    price?: string;
}

export const Prints: React.FC = () => {
    const navigate = useNavigate();
    const [prints, setPrints] = useState<PrintItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
    const [photographerId, setPhotographerId] = useState<string | null>(null);

    const handleMediaLoad = (id: string, width: number, height: number) => {
        if (width && height && !aspectRatios[id]) {
            setAspectRatios(prev => ({
                ...prev,
                [id]: width / height
            }));
        }
    };

    useEffect(() => {
        const fetchPrints = async () => {
            try {
                // Fetch public galleries with category 'Prints'
                const { data: galleriesData, error } = await supabase
                    .from('galleries')
                    .select('id, client_name, title, photographer_id')
                    .ilike('category', 'prints')
                    .order('created_at', { ascending: false });

                if (error) throw error;

                let allPrints: PrintItem[] = [];

                if (galleriesData && galleriesData.length > 0) {
                    setPhotographerId(galleriesData[0].photographer_id);
                    const galleryIds = galleriesData.map(g => g.id);
                    
                    const { data: files } = await supabase
                        .from('files')
                        .select('*')
                        .in('gallery_id', galleryIds)
                        .order('created_at', { ascending: false });
                        
                    if (files) {
                        const galleryNameMap = new Map(galleriesData.map(g => [g.id, g.client_name]));
                        const galleryTitleMap = new Map(galleriesData.map(g => [g.id, g.title]));
                        allPrints = files.map(f => ({
                            id: f.id,
                            file_url: f.file_url,
                            file_type: f.file_type,
                            client_name: galleryNameMap.get(f.gallery_id) || 'Print',
                            title: f.title || '',
                            caption: f.caption,
                            description: f.description,
                            print_size: f.print_size,
                            material: f.material,
                            price: f.price
                        }));
                    }
                }

                setPrints(allPrints);
            } catch (error) {
                console.error("Error loading prints:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchPrints();
    }, []);

    return (
        <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-slate-900 selection:text-white flex flex-col">
            <header className="w-full flex items-center justify-between p-4 md:p-8 bg-white border-b border-slate-100 sticky top-0 z-50 transition-all duration-300">
                <button 
                    onClick={() => {
                        if (window.history.state && window.history.state.idx > 0) {
                            navigate(-1);
                        } else if (photographerId) {
                            navigate(`/p/${photographerId}`);
                        } else {
                            navigate('/');
                        }
                    }}
                    className="flex items-center gap-2 text-slate-400 hover:text-slate-900 transition-colors text-xs tracking-widest font-bold"
                >
                    <ArrowLeft className="w-4 h-4" />
                    BACK
                </button>
                <div className="font-serif tracking-widest uppercase text-xl font-bold flex-1 text-center pr-16 md:pr-[70px]">
                    PRINTS
                </div>
            </header>

            <main className="flex-1 max-w-[1400px] mx-auto w-full p-6 md:p-12">
                <div className="flex flex-col items-center justify-center text-center mb-12 md:mb-16">
                    <h1 className="text-2xl md:text-4xl font-serif tracking-widest uppercase text-slate-800 mb-4 font-bold">
                        Fine Art Prints
                    </h1>
                    <p className="max-w-xl text-slate-500 leading-relaxed text-sm md:text-base">
                        A curated collection of archival quality prints from my portfolio collections. 
                        Each piece is printed on museum-grade cotton rag paper to ensure longevity and exceptional color reproduction.
                    </p>
                </div>

                {loading ? (
                    <div className="h-[40vh] flex items-center justify-center">
                        <div className="animate-pulse tracking-[0.2em] uppercase text-xs text-slate-400 font-medium">Loading Prints...</div>
                    </div>
                ) : prints.length > 0 ? (
                    <div className="flex flex-wrap justify-center items-stretch gap-12 lg:gap-20 pt-4 md:pt-8 w-full max-w-[1600px] mx-auto">
                        {[]
                            .concat(prints.filter(p => aspectRatios[p.id] && aspectRatios[p.id] > 1))
                            .concat(prints.filter(p => aspectRatios[p.id] && aspectRatios[p.id] <= 1))
                            .concat(prints.filter(p => !aspectRatios[p.id]))
                            .map((print) => {
                            const aspect = aspectRatios[print.id];
                            
                            let mediaClass = "max-h-[40vh] lg:max-h-[45vh] max-w-[75vw] md:max-w-[45vw] lg:max-w-[30vw] xl:max-w-[25vw] w-auto h-auto block object-contain shadow-sm transition-opacity duration-300";
                            
                            if (aspect) {
                                const isLandscape = aspect > 1;
                                if (isLandscape) {
                                    mediaClass = "w-[75vw] md:w-[40vw] lg:w-[30vw] xl:w-[25vw] aspect-[3/2] object-cover block shadow-sm transition-opacity duration-300";
                                } else {
                                    mediaClass = "w-[60vw] md:w-[25vw] lg:w-[20vw] xl:w-[16vw] aspect-[2/3] object-cover block shadow-sm transition-opacity duration-300";
                                }
                            }

                            return (
                                <div 
                                    key={print.id}
                                    className="block relative flex flex-col items-center w-full md:w-auto px-4 md:px-0"
                                >
                                    <div className="bg-white border-[6px] md:border-[16px] border-[#151515] relative shadow-2xl flex items-center justify-center p-4 md:p-6 lg:p-8 w-fit shrink-0">
                                        <div className="relative shadow-[inset_0_0_1px_rgba(0,0,0,0.2)]">
                                            {print.file_type === 'video' ? (
                                                <video 
                                                    src={rewriteUrlToR2(print.file_url)} 
                                                    className={mediaClass}
                                                    muted playsInline loop autoPlay preload="metadata"
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    style={{ WebkitTouchCallout: 'none', userSelect: 'none' }}
                                                    onLoadedMetadata={(e) => handleMediaLoad(print.id, e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
                                                    ref={(video) => {
                                                        if (video && video.readyState >= 1 && video.videoWidth) {
                                                            handleMediaLoad(print.id, video.videoWidth, video.videoHeight);
                                                        }
                                                    }}
                                                />
                                            ) : print.file_url ? (
                                                <img 
                                                    src={getOptimizedImageUrl(print.file_url, 1200, undefined, 85)} 
                                                    alt={print.client_name}
                                                    className={`${mediaClass} pointer-events-none`}
                                                    draggable={false}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    style={{ WebkitTouchCallout: 'none', userSelect: 'none', pointerEvents: 'none' }}
                                                    loading="lazy"
                                                    onLoad={(e) => handleMediaLoad(print.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
                                                    ref={(img) => {
                                                        if (img && img.complete && img.naturalWidth) {
                                                            handleMediaLoad(print.id, img.naturalWidth, img.naturalHeight);
                                                        }
                                                    }}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
                                    {(print.title?.trim() || (print.description ?? print.caption)?.trim() || print.print_size?.trim() || print.material?.trim() || print.price?.trim()) ? (
                                        <div className="mt-5 md:mt-6 text-center w-0 min-w-full break-words">
                                            {print.title?.trim() && <h3 className="font-serif text-lg font-medium text-slate-900 mb-1">{print.title}</h3>}
                                            {(print.description ?? print.caption)?.trim() && (
                                                <p className="text-sm md:text-base text-slate-600 leading-relaxed font-serif italic">
                                                    {(print.description ?? print.caption ?? '').trim()}
                                                </p>
                                            )}
                                            {(print.print_size?.trim() || print.material?.trim()) && (
                                                <div className="text-xs text-slate-400 uppercase tracking-widest mt-3 flex flex-wrap justify-center items-center gap-2">
                                                    {print.print_size?.trim() && <span>{print.print_size}</span>}
                                                    {print.print_size?.trim() && print.material?.trim() && <span className="opacity-50">|</span>}
                                                    {print.material?.trim() && <span>{print.material}</span>}
                                                </div>
                                            )}
                                            {print.price?.trim() && (
                                                <p className="text-md font-bold text-amber-700 mt-2">{print.price}</p>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="h-[20vh] flex flex-col items-center justify-center text-center mt-12">
                        <div className="bg-slate-50 border border-slate-100 px-8 py-4 rounded-sm">
                            <p className="text-slate-400 tracking-[0.2em] text-[10px] uppercase font-bold">No prints available yet</p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};
