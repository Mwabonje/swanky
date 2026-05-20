import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://bdaqtpyzqutelkdgcoex.supabase.co';
const supabaseKey = 'sb_publishable_aQY9i_vVRwG-CEWB2Nz4lQ_GwtLYqib';
const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanOrphans() {
  console.log('Starting cleanup of orphaned folders in Supabase storage...');
  
  // 1. Get all gallery IDs from DB
  const { data: galleries, error: dbError } = await supabase.from('galleries').select('id');
  if (dbError) {
    console.error('Failed to get galleries from DB:', dbError);
    return;
  }
  
  const activeIds = new Set(galleries.map(g => g.id));
  console.log(`Found ${activeIds.size} active galleries in DB.`);

  // 2. Map root of storage
  // Note: list() with no path lists top level folders/files
  const { data: rootItems, error: storageError } = await supabase.storage.from('gallery-files').list();
  if (storageError) {
    console.error('Failed to list root of storage:', storageError);
    return;
  }
  
  if (!rootItems || rootItems.length === 0) {
    console.log('No folders found in storage.');
    return;
  }

  let deletedCount = 0;
  for (const item of rootItems) {
    // If it's a folder, its name might be a gallery id
    // We can just check if it's not active
    const folderName = item.name;
    
    // Some system folders might exist like .emptyFolderPlaceholder, ignore them
    if (folderName.startsWith('.')) continue;

    if (!activeIds.has(folderName)) {
      console.log(`Folder ${folderName} is orphaned. Deleting...`);
      
      // We need to list and delete all files in this folder first because of Supabase limitations
      let hasMore = true;
      let totalDeletedInFolder = 0;
      
      while (hasMore) {
        const { data: filesInFolder, error: listError } = await supabase.storage.from('gallery-files').list(folderName, {
            limit: 100,
            offset: 0
        });
        
        if (listError) {
            console.error(`Failed to list files in ${folderName}:`, listError);
            break;
        }
        
        if (!filesInFolder || filesInFolder.length === 0) {
            hasMore = false;
        } else {
            // Delete these files
            const pathsToRemove = filesInFolder.map(f => `${folderName}/${f.name}`);
            const { error: removeError } = await supabase.storage.from('gallery-files').remove(pathsToRemove);
            if (removeError) {
                console.error(`Failed to remove files in ${folderName}:`, removeError);
            } else {
                totalDeletedInFolder += pathsToRemove.length;
            }
        }
      }
      
      console.log(`Deleted ${totalDeletedInFolder} files in orphaned folder ${folderName}.`);
      
      // Now delete the folder itself (or that might happen automatically when empty)
      const { error: folderRemoveError } = await supabase.storage.from('gallery-files').remove([folderName]);
      if (folderRemoveError) {
          console.error(`Failed to remove folder ${folderName} itself:`, folderRemoveError);
      } else {
          deletedCount++;
      }
    } else {
        console.log(`Keeping active folder: ${folderName}`);
    }
  }

  console.log(`Cleanup complete! Removed ${deletedCount} orphaned folders.`);
}

cleanOrphans();
