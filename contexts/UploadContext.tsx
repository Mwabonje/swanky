import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase, supabaseUrl, supabaseKey } from '../services/supabase';
import * as tus from 'tus-js-client';
import exifr from 'exifr';

interface UploadContextType {
  uploading: boolean;
  progress: number;
  activeGalleryId: string | null;
  uploadFiles: (galleryId: string, files: File[], expiryHours: number) => Promise<void>;
  cancelUpload: () => void;
}

const UploadContext = createContext<UploadContextType | undefined>(undefined);

// Helper to deduce MIME type if browser fails (common with MKV, AVI, etc.)
const getMimeType = (file: File) => {
    if (file.type && file.type !== "") return file.type;
    const ext = file.name.split('.').pop()?.toLowerCase();
    
    // Video fallbacks
    if (ext === 'mp4') return 'video/mp4';
    if (ext === 'mov') return 'video/quicktime';
    if (ext === 'webm') return 'video/webm';
    if (ext === 'avi') return 'video/x-msvideo';
    if (ext === 'mkv') return 'video/x-matroska';
    if (ext === 'wmv') return 'video/x-ms-wmv';
    
    // Image fallbacks
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'heic') return 'image/heic';
    if (ext === 'heif') return 'image/heif';
    if (['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'srw', 'raw'].includes(ext || '')) return `image/x-${ext}`;
    
    return 'application/octet-stream';
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeGalleryId, setActiveGalleryId] = useState<string | null>(null);

  // We use a Ref to track progress of individual files without triggering re-renders for every byte
  const fileProgressMap = useRef<number[]>([]);
  
  const abortControllersRef = useRef<AbortController[]>([]);
  const isCancelledRef = useRef<boolean>(false);

  const cancelUpload = useCallback(() => {
    isCancelledRef.current = true;
    abortControllersRef.current.forEach(controller => controller.abort());
    abortControllersRef.current = [];
    setUploading(false);
    setProgress(0);
    setActiveGalleryId(null);
  }, []);

  const uploadFiles = useCallback(async (galleryId: string, filesToUpload: File[], expiryHours: number) => {
    if (uploading) {
        alert("An upload is already in progress. Please wait for it to finish.");
        return;
    }

    // Validate total upload size (Max 3GB)
    const MAX_TOTAL_SIZE = 3 * 1024 * 1024 * 1024; // 3GB in bytes
    const totalSize = filesToUpload.reduce((acc, f) => acc + f.size, 0);
    
    if (totalSize > MAX_TOTAL_SIZE) {
        alert(`Upload Cancelled.\n\nThe total size of the files selected (${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds the 3GB limit.\n\nPlease select fewer files or compress them before uploading.`);
        return;
    }

    setUploading(true);
    setActiveGalleryId(galleryId);
    setProgress(0);
    isCancelledRef.current = false;
    abortControllersRef.current = [];

    const totalBytes = filesToUpload.reduce((acc, f) => acc + f.size, 0);
    // Initialize progress map with 0 for each file index
    fileProgressMap.current = new Array(filesToUpload.length).fill(0);
    const uploadErrors: string[] = [];

    // Global ticker to update the React state from the Refs
    const uiInterval = setInterval(() => {
        if (isCancelledRef.current) return;
        const totalUploaded = fileProgressMap.current.reduce((a, b) => a + b, 0);
        const percentage = totalBytes > 0 ? Math.round((totalUploaded / totalBytes) * 100) : 0;
        // Cap visual progress at 95% until everything is truly resolved
        setProgress(Math.min(95, percentage));
    }, 200);

    try {
        // Helper to run promises with a concurrency limit
        const asyncPool = async <T,>(poolLimit: number, array: T[], iteratorFn: (item: T, index: number) => Promise<void>) => {
            const ret: Promise<void>[] = [];
            const executing = new Set<Promise<void>>();
            for (let i = 0; i < array.length; i++) {
                if (isCancelledRef.current) break;
                const item = array[i];
                const p = Promise.resolve().then(() => iteratorFn(item, i));
                ret.push(p);
                executing.add(p);
                const clean = () => executing.delete(p);
                p.then(clean).catch(clean);
                if (executing.size >= poolLimit) {
                    await Promise.race(executing);
                }
            }
            return Promise.all(ret);
        };

        // Limit to 3 concurrent uploads to prevent "Failed to fetch" network errors
        await asyncPool(3, filesToUpload, async (file, index) => {
            if (isCancelledRef.current) return;
            
            const controller = new AbortController();
            abortControllersRef.current.push(controller);

            // Adaptive Simulation:
            // For small files (<5MB), we simulate fast.
            // For large files (>50MB), we simulate slower but realistic.
            let estimatedSpeed = 3000000; // Default 3MB/s simulation
            if (file.size > 50 * 1024 * 1024) estimatedSpeed = 1000000; // 1MB/s for large files
            
            // Split bandwidth among concurrent files
            const bandwidthPerFile = estimatedSpeed / filesToUpload.length;
            const tickRateMs = 500;
            const bytesPerTick = (bandwidthPerFile * tickRateMs) / 1000;

            const simulationInterval = setInterval(() => {
                const current = fileProgressMap.current[index];
                // Only simulate up to 90% of the file size
                if (current < file.size * 0.90) {
                    fileProgressMap.current[index] = current + bytesPerTick;
                }
            }, tickRateMs);

            try {
                const mimeType = getMimeType(file);

                // 1. Get Presigned URL from Backend
                const presignRes = await fetch('/api/upload-url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fileName: file.name, fileType: mimeType }),
                    signal: controller.signal
                });

                if (!presignRes.ok) {
                    throw new Error(`Failed to get upload URL: ${await presignRes.text()}`);
                }
                const { presignedUrl, publicUrl, filePath } = await presignRes.json();

                // 2. Upload directly to Cloudflare R2
                clearInterval(simulationInterval);
                await new Promise<void>((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    
                    controller.signal.addEventListener('abort', () => {
                        xhr.abort();
                        reject(new Error("Upload Cancelled"));
                    });

                    xhr.upload.addEventListener("progress", (e) => {
                        if (e.lengthComputable) {
                            fileProgressMap.current[index] = e.loaded;
                        }
                    });
                    
                    xhr.addEventListener("load", () => {
                        if (xhr.status >= 200 && xhr.status < 300) {
                            resolve();
                        } else {
                            reject(new Error(`Upload failed with status ${xhr.status}`));
                        }
                    });
                    
                    xhr.addEventListener("error", () => reject(new Error("Network Error")));
                    xhr.addEventListener("abort", () => reject(new Error("Upload Aborted")));

                    xhr.open("PUT", presignedUrl);
                    // R2 needs exact Content-Type that was used to sign the URL
                    xhr.setRequestHeader("Content-Type", mimeType);
                    xhr.send(file);
                });

                // 3. Extract Thumbnail for RAW files
                let thumbPublicUrl: string | undefined = undefined;
                let thumbFilePath: string | undefined = undefined;
                if (mimeType.toLowerCase().startsWith('image/x-')) {
                    try {
                        const thumbDataUrl = await exifr.thumbnailUrl(file);
                        if (thumbDataUrl) {
                            const thumbRes = await fetch(thumbDataUrl);
                            const thumbBlob = await thumbRes.blob();
                            URL.revokeObjectURL(thumbDataUrl);
                            const thumbPresignRes = await fetch('/api/upload-url', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ fileName: 'thumb_' + file.name + '.jpg', fileType: 'image/jpeg' }),
                                signal: controller.signal
                            });

                            if (thumbPresignRes.ok) {
                                const { presignedUrl: thumbPresignedUrl, publicUrl: tpUrl, filePath: tpPath } = await thumbPresignRes.json();
                                await fetch(thumbPresignedUrl, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'image/jpeg' },
                                    body: thumbBlob,
                                    signal: controller.signal
                                });
                                thumbPublicUrl = tpUrl;
                                thumbFilePath = tpPath;
                            }
                        }
                    } catch (e) {
                         console.error("Failed to extract or upload thumbnail", e);
                    }
                }

                // 4. Insert Record into DB
                const expiresAt = new Date();
                expiresAt.setTime(expiresAt.getTime() + expiryHours * 60 * 60 * 1000);

                // Determine type for DB
                const dbFileType = mimeType.startsWith('image/') ? 'image' : 'video';

                const { error: dbError } = await supabase
                    .from('files')
                    .insert([{
                        gallery_id: galleryId,
                        file_url: publicUrl,
                        file_path: filePath,
                        file_type: dbFileType,
                        expires_at: expiresAt.toISOString()
                    }]);

                if (dbError) throw dbError;

            } catch (err: any) {
                if (isCancelledRef.current || err.message === "Upload Cancelled" || err.name === 'AbortError') {
                     // Upload was cancelled, ignore error
                } else {
                    console.error(`Failed to upload ${file.name}`, err);
                    let msg = err.message || 'Unknown error';
                    
                    // Enhance error message for common Supabase limits
                    if (msg.includes('maximum allowed size') || msg.includes('Entity Too Large')) {
                        msg = 'File exceeds server size limit. Please check Supabase Bucket settings.';
                    }
                    
                    uploadErrors.push(`${file.name}: ${msg}`);
                }
            } finally {
                clearInterval(simulationInterval);
                // Snap this file's progress to 100%
                if (!isCancelledRef.current) {
                    fileProgressMap.current[index] = file.size;
                }
                const cIdx = abortControllersRef.current.indexOf(controller);
                if (cIdx !== -1) abortControllersRef.current.splice(cIdx, 1);
            }
        });
    } catch (error) {
        if (!isCancelledRef.current) {
            console.error("Batch upload critical error", error);
            uploadErrors.push("Batch process failed critically.");
        }
    } finally {
        clearInterval(uiInterval);
        
        if (isCancelledRef.current) {
             // Let the cancelUpload method handle resetting state
             return;
        }
        
        setProgress(100);
        
        if (uploadErrors.length > 0) {
            alert(`Upload completed with errors:\n\n${uploadErrors.join('\n')}\n\nPlease try again or check your configuration.`);
        }

        // Reset state
        setTimeout(() => {
            if (isCancelledRef.current) return;
            setUploading(false);
            setActiveGalleryId(null);
            setProgress(0);
            fileProgressMap.current = [];
        }, 1500);
    }
  }, [uploading]);

  return (
    <UploadContext.Provider value={{ uploading, progress, activeGalleryId, uploadFiles, cancelUpload }}>
      {children}
    </UploadContext.Provider>
  );
};

export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) throw new Error('useUpload must be used within UploadProvider');
  return context;
};
