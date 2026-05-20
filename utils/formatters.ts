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

export const getCleanR2Url = (url: string) => {
  if (!url) return '';
  let cleanUrl = url.split('?')[0]; 
  // Disable R2 URL rewrite - Supabase storage files are not mirrored to the proxy R2 bucket
  return cleanUrl;
};

export const getProxiedMediaUrl = (url: string) => {
  if (!url) return '';
  try {
    const cleanUrl = getCleanR2Url(url);
    const encodedUrl = encodeURIComponent(cleanUrl);
    return `/api/image-proxy?url=${encodedUrl}`;
  } catch (e) {
    return url;
  }
};

export const rewriteUrlToR2 = (url: string) => {
  return getProxiedMediaUrl(url);
};

export const getOptimizedImageUrl = (url: string, width: number = 800, height?: number, quality: number = 70) => {
  if (!url) return '';
  
  try {
    const cleanUrl = getCleanR2Url(url);
    const encodedUrl = encodeURIComponent(cleanUrl);
    
    // Proxy through our backend for local AI Studio development, 
    // and through Netlify's image optimizer via redirects in production
    let proxyUrl = `/api/image-proxy?url=${encodedUrl}&w=${width}&q=${quality}`;
    
    if (height) {
      proxyUrl += `&h=${height}`;
    }
    
    return proxyUrl;
  } catch (e) {
    return url;
  }
};