export const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
  }).format(amount);
};

export const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const getTimeRemaining = (expiresAt: string) => {
  const total = Date.parse(expiresAt) - Date.now();
  const days = Math.floor(total / (1000 * 60 * 60 * 24));
  const hours = Math.floor((total / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((total / 1000 / 60) % 60);
  
  return {
    total,
    days,
    hours,
    minutes,
    expired: total <= 0
  };
};

export const rewriteUrlToR2 = (url: string) => {
  if (!url) return '';
  let cleanUrl = url.split('?')[0]; 
  
  if (cleanUrl.includes('supabase.co')) {
    const r2BaseUrl = (import.meta as any).env.VITE_R2_PUBLIC_URL || '';
    if (r2BaseUrl) {
        const parts = cleanUrl.split('/public/gallery-files/');
        if (parts.length === 2 && parts[1]) {
           return `${r2BaseUrl.replace(/\/$/, '')}/${parts[1]}`;
        }
    }
  }
  return cleanUrl;
};

export const getOptimizedImageUrl = (url: string, width: number = 800, height?: number, quality: number = 70) => {
  if (!url) return '';
  
  try {
    const cleanUrl = rewriteUrlToR2(url);
    const encodedUrl = encodeURIComponent(cleanUrl);
    
    // In production on Netlify, we return the raw url directly to prevent 404s
    // since the Cloudflare Public Dev URL might block Netlify's image optimizer.
    if (import.meta.env.PROD) {
      return cleanUrl;
    }
    
    // Proxy through our backend for local AI Studio development
    let proxyUrl = `/api/image-proxy?url=${encodedUrl}&w=${width}&q=${quality}`;
    
    if (height) {
      proxyUrl += `&h=${height}`;
    }
    
    return proxyUrl;
  } catch (e) {
    return url;
  }
};