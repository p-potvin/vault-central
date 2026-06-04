import browser from 'webextension-polyfill';
async function run() {
    const params = new URLSearchParams(window.location.search);
    const videoUrl = params.get('src');
    const originTitle = params.get('originTitle') || 'Captured Media';
    if (!videoUrl) {
        console.error("[ScraperPlayer] No video URL provided to scraper-player");
        return;
    }
    console.log("[ScraperPlayer] Loading video via blob fetch:", videoUrl);
    const video = document.getElementById('player') as HTMLVideoElement;
    try {
        // Fetch as blob to bypass CORS and prevent canvas tainting
        const response = await fetch(videoUrl);
        if (!response.ok)
            throw new Error(`Fetch failed: ${response.status}`);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        video.src = blobUrl;
        // Wait for metadata
        await new Promise((resolve, reject) => {
            video.onloadedmetadata = () => resolve(null);
            video.onerror = () => reject(new Error("Video load error"));
        });
        const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 60;
        console.log("[ScraperPlayer] Video loaded. Duration:", duration);
        // Capture WebP preview
        const canvas = document.createElement('canvas');
        canvas.width = 426;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error("Canvas context is null");
        /*
        // Old WebM preview capture logic (preserved in case we want it later)
        const stream = canvas.captureStream(10); // 10 fps
        let recorder: MediaRecorder;
        try {
            recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
        } catch (e) {
            recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
        }

        const chunks: Blob[] = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

        const previewPromise = new Promise<string | null>((resolve) => {
            recorder.onstop = () => {
                const webmBlob = new Blob(chunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(webmBlob);
            };
            recorder.onerror = () => resolve(null);
        });

        recorder.start();
        */
        // 10 segments
        const startOffset = duration * 0.1;
        const endOffset = duration * 0.9;
        const segmentLength = (endOffset - startOffset) / 9;
        video.muted = true;
        await video.play().catch(() => { });
        video.pause();
        const frames = [];
        for (let i = 0; i < 10; i++) {
            video.currentTime = startOffset + (i * segmentLength);
            await new Promise(r => {
                let finished = false;
                const done = () => {
                    if (finished)
                        return;
                    finished = true;
                    video.removeEventListener('seeked', seeked);
                    r(null);
                };
                const seeked = () => done();
                video.addEventListener('seeked', seeked);
                setTimeout(done, 1500); // 1.5s max seek timeout for background safety
            });
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/webp', 0.5);
            frames.push(dataUrl);
        }
        /*
        recorder.stop();
        stream.getTracks().forEach(t => t.stop());
        */
        URL.revokeObjectURL(blobUrl);
        const payload = {
            isFrames: true,
            frames: frames
        };
        const framesDataUrl = `data:application/json;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(payload))))}`;
        console.log("[ScraperPlayer] WebP frames preview generated, size:", framesDataUrl.length);
        const result = {
            src: videoUrl,
            metadata: {
                title: originTitle,
                thumbnail: framesDataUrl,
                duration,
                author: new URL(videoUrl).hostname || 'Direct Link',
                views: "",
                tags: [],
                likes: "",
                date: new Date().toISOString()
            }
        };
        await browser.runtime.sendMessage({
            action: 'scraper_result',
            success: true,
            result
        });
    }
    catch (err: any) {
        console.error("[ScraperPlayer] Failed:", err);
        await browser.runtime.sendMessage({
            action: 'scraper_result',
            success: false,
            error: err.message || 'Unknown error'
        });
    }
}
run();
