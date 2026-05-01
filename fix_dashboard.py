import os

filepath = 'src/components/VaultDashboard.tsx'
code = open(filepath, 'r', encoding='utf-8').read()

old_preview = '''const PreviewThumb: React.FC<{ video: VideoData }> = ({ video }) => {
  const [previewBlob, setPreviewBlob] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let active = true;
    const checkPreview = async () => {
      console.log("[PreviewThumb] Checking IndexedDB for preview. url:", video.url);
      const blob = await getPreviewForVideo(video);
      if (blob && active) {
        console.log("[PreviewThumb] Preview found in IndexedDB. Setting blob URL.");
        setPreviewBlob(URL.createObjectURL(blob));
      } else {
        console.log("[PreviewThumb] No preview in IndexedDB yet for:", video.url);
      }
    };
    checkPreview();
    return () => { active = false; };
  }, [video.url, video.rawVideoSrc]);

  useEffect(() => {
    return () => {
      if (previewBlob) URL.revokeObjectURL(previewBlob);
    };
  }, [previewBlob]);'''

new_preview = '''const PreviewThumb: React.FC<{ video: VideoData }> = ({ video }) => {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let active = true;
    const checkPreview = async () => {
      const dbBlob = await getPreviewForVideo(video);
      if (dbBlob && active) {
        setBlob(dbBlob);
      }
    };
    checkPreview();
    return () => { active = false; };
  }, [video.url, video.rawVideoSrc]);

  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => { URL.revokeObjectURL(url); };
  }, [blob]);'''

if old_preview in code:
    code = code.replace(old_preview, new_preview)
    # also we need to update previewBlob to previewUrl in handling and JSX
    code = code.replace('setPreviewBlob(URL.createObjectURL(blob));', 'setBlob(blob);')
    code = code.replace('setPreviewBlob(URL.createObjectURL(retryBlob));', 'setBlob(retryBlob);')
    code = code.replace('if (previewBlob) {', 'if (previewUrl) {')
    code = code.replace('previewBlob ? (', 'previewUrl ? (')
    code = code.replace('src={previewBlob}', 'src={previewUrl}')
    
    open(filepath, 'w', encoding='utf-8').write(code)
    print('Fixed VaultDashboard.tsx')
else:
    print('Could not find old_preview in VaultDashboard.tsx')

