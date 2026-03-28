const fs = require('fs');
let code = fs.readFileSync('src/components/VaultDashboard.tsx', 'utf-8');

code = code.replace(
    const [uploadingItem, setUploadingItem] = useState<string | null>(null);

  const handleDriveUpload = async (fav: VideoData) => {
    if (!fav.rawVideoSrc) {
      alert('No video source available for this item.');
      return;
    }

    setUploadingItem(fav.url);
    try {
      // 1. Authenticate
      const token = await authenticateGoogleDrive();
      
      // 2. Fetch the video blob
      const res = await fetch(fav.rawVideoSrc);
      const blob = await res.blob();
      
      // 3. Upload to Google Drive
      const filename = fav.title ? fav.title + '.mp4' : 'Untitled-Video.mp4';
      await uploadVideoToDrive(token, blob, filename);
      
      alert('Successfully saved to Google Drive!');
    } catch (err: any) {
      console.error(err);
      alert('Failed to upload to Google Drive: ' + err.message);
    } finally {
      setUploadingItem(null);
    }
  };,

    const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const handleDriveUpload = async (fav: VideoData) => {
    if (!fav.rawVideoSrc) {
      alert('No video source available for this item.');
      return;
    }

    setUploadingItem(fav.url);
    setUploadProgress(0);
    try {
      // 1. Authenticate
      const token = await authenticateGoogleDrive();
      
      // 2. Fetch the video blob
      const res = await fetch(fav.rawVideoSrc);
      const blob = await res.blob();
      
      // 3. Upload to Google Drive
      const filename = fav.title ? fav.title + '.mp4' : 'Untitled-Video.mp4';
      await uploadVideoToDrive(token, blob, filename, (progress) => {
        setUploadProgress(progress);
      });
      
      alert('Successfully saved to Google Drive!');
    } catch (err: any) {
      console.error(err);
      alert('Failed to upload to Google Drive: ' + err.message);
    } finally {
      setUploadingItem(null);
      setUploadProgress(0);
    }
  };
);

// Inject Upload button
code = code.replace(
                                    className="thumb-action p-1.5 bg-black/60 hover:bg-vault-accent text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" title="Edit Metadata">
                                  <Edit2 size={12} />
                                </button>,
                                    className="thumb-action p-1.5 bg-black/60 hover:bg-vault-accent text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110" title="Edit Metadata">
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleDriveUpload(fav); }}
                                  className="thumb-action p-1.5 bg-black/60 hover:bg-[#34A853] text-white rounded shadow-lg backdrop-blur-md transition-all hover:scale-110 relative" title="Upload to Google Drive">
                                  {uploadingItem === fav.url ? (
                                    <>
                                      <Loader2 size={12} className="animate-spin" />
                                      <span className="absolute -top-3 -right-3 bg-vault-accent/90 text-white text-[9px] px-1 rounded font-bold">
                                        {uploadProgress}%
                                      </span>
                                    </>
                                  ) : (
                                    <UploadCloud size={12} />
                                  )}
                                </button>
);

fs.writeFileSync('src/components/VaultDashboard.tsx', code);
